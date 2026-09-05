/**
 * acs/capability-map.ts — RiskGuard 统一 Capability Taxonomy（v0.2.0 §八/§九）
 *
 * Capability = Agent 想做什么能力；Risk = 这个动作的风险是什么。二者必须分开：
 *   例如 filesystem.delete 这个 capability 可以对应 permanent-delete / protected-path /
 *   credential-destruction / workspace-destruction 等不同 risk（由 Policy Engine 的 RG 规则族判定）。
 * 因此不要把 RG-FS-001 之类 rule id 直接当 capability。
 *
 * 首版只覆盖当前实际需要的 11 个 capability（§八），不一次设计 100 个。
 */

import type { Domain, Action } from '../../core/src/risk-taxonomy.ts';
import { classifyShellCommand } from '../../core/src/normalize.ts';

/** RiskGuard capability taxonomy（首版固定集合；版本化扩展） */
export const CAPABILITIES = [
  'filesystem.read',
  'filesystem.write',
  'filesystem.delete',
  'shell.execute',
  'git.modify',
  'git.destructive',
  'process.execute',
  'network.connect',
  'credentials.read',
  'credentials.write',
  'mcp.invoke',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** ACS 官方 capability → RiskGuard capability 的归一化映射（未知 → null） */
const ACS_TO_RG: Record<string, Capability> = {
  'filesystem.read': 'filesystem.read',
  'filesystem.write': 'filesystem.write',
  'filesystem.delete': 'filesystem.delete',
  'process.execute': 'process.execute',
  'scm.git.reset': 'git.destructive',
  'scm.git.clean': 'git.destructive',
  'scm.git.force_push': 'git.destructive',
  'network.egress': 'network.connect',
  'credential.read': 'credentials.read',
  'credential.mutate': 'credentials.write',
  'mcp.invoke': 'mcp.invoke',
};

/**
 * ACS capability 字符串 → RiskGuard capability。
 * 同时接受 RiskGuard 自有 taxonomy 名（shell.execute 等）与 ACS 官方名（process.execute / scm.git.reset 等）。
 * 未映射 → null；调用方 fail-closed。
 */
export function toRiskGuardCapability(acsCapability: string): Capability | null {
  const key = String(acsCapability).trim();
  if ((CAPABILITIES as readonly string[]).includes(key)) return key as Capability;
  return ACS_TO_RG[key] ?? null;
}

export interface CapabilityOperationMapping {
  domain: Domain;
  action: Action;
  /** true = 映射精确；false = 近似（RiskGuard taxonomy 无精确等价 action，取最保守方向） */
  exact: boolean;
  /** 近似映射的说明（审计/文档用） */
  note?: string;
}

/** RiskGuard capability → RiskEvent.operation 映射（§七） */
export function capabilityToOperation(cap: Capability): CapabilityOperationMapping {
  switch (cap) {
    case 'filesystem.read':
      return { domain: 'filesystem', action: 'read', exact: true };
    case 'filesystem.write':
      return { domain: 'filesystem', action: 'write', exact: true };
    case 'filesystem.delete':
      return { domain: 'filesystem', action: 'delete', exact: true };
    case 'shell.execute':
      // shell.execute 语义上是任意 shell 命令 → 归 process.execute；
      // 具体危险分类由 raw_command 的 classifyShellCommand 细化（见 tool-call-request.ts）
      return { domain: 'process', action: 'execute', exact: true };
    case 'process.execute':
      return { domain: 'process', action: 'execute', exact: true };
    case 'git.modify':
      // 非破坏性 git 操作（commit/checkout 等）→ git_commit（无 deny 规则 → Profile B 放行）
      return { domain: 'git', action: 'git_commit', exact: false, note: 'git.modify 近似映射为 git_commit（非破坏性）' };
    case 'git.destructive':
      // 破坏性 git（reset --hard / clean -f / force push）→ git_reset（RG-GIT-001 deny）
      return { domain: 'git', action: 'git_reset', exact: true };
    case 'network.connect':
      return { domain: 'network', action: 'network_connect', exact: true };
    case 'credentials.read':
      return { domain: 'credentials', action: 'credential_read', exact: true };
    case 'credentials.write':
      // RiskGuard taxonomy 无 credential_write action → 取最保守的 credential_export
      // （写入凭据材料按凭据变更处理，保守 deny 方向）
      return { domain: 'credentials', action: 'credential_export', exact: false, note: 'credentials.write 近似映射为 credential_export（保守）' };
    case 'mcp.invoke':
      // MCP 工具调用：RiskGuard taxonomy 无 mcp 域 → 归 process.execute
      // （MCP 内容不可见，按过程执行 ask/deny 处理；§九 MCP 一等 capability 属 P1）
      return { domain: 'process', action: 'execute', exact: false, note: 'mcp.invoke 近似映射为 process.execute（MCP 域属 P1）' };
  }
}

/** capability 是否可被视为 read-only（供审计/矩阵展示） */
export function isReadCapability(cap: Capability): boolean {
  return cap === 'filesystem.read' || cap === 'credentials.read';
}

/**
 * Capability → 风险类别（§九：Capability ≠ Risk）。
 * 同一 capability 可对应多种 risk；这里给出默认/最常见的 risk 类别供 reasoning 使用，
 * 真实风险判定仍由 Policy Engine 规则（RG 规则族）负责。
 */
export function capabilityDefaultRisk(cap: Capability): string {
  switch (cap) {
    case 'filesystem.read':
    case 'filesystem.write':
    case 'git.modify':
    case 'network.connect':
      return 'low';
    case 'filesystem.delete':
    case 'git.destructive':
      return 'irreversible';
    case 'shell.execute':
    case 'process.execute':
    case 'mcp.invoke':
      return 'untrusted-execution';
    case 'credentials.read':
    case 'credentials.write':
      return 'credential-material';
  }
}

/** RiskGuard capability 全量清单（测试/矩阵生成用） */
export function listCapabilities(): Capability[] {
  return [...CAPABILITIES];
}

// ============================================================================
// Capability 推导（v0.2.1 §三十一/§三十二）
// ============================================================================
//
// ACS 官方 capability 是可选字段（§四）。缺失时从
//   tool.name / operation / raw_command / arguments
// 推导；推导不确定 → null → 调用方 fail-closed deny（§三十二）。

export interface CapabilityDerivationInput {
  toolName?: string;
  operation?: string;
  rawCommand?: string | null;
  argumentValues?: Record<string, unknown>;
}

/** 命令分类结果 → ACS capability 名（映射回官方/本地 taxonomy） */
function classifiedToCapability(domain: Domain, action: Action): string | null {
  if (domain === 'filesystem') {
    if (action === 'delete') return 'filesystem.delete';
    if (action === 'write' || action === 'overwrite' || action === 'move') return 'filesystem.write';
    return 'filesystem.read';
  }
  if (domain === 'git') {
    if (action === 'git_reset' || action === 'git_clean' || action === 'git_checkout_discard') return 'git.destructive';
    return 'git.modify';
  }
  if (domain === 'credentials') return action === 'credential_read' ? 'credential.read' : 'credential.mutate';
  if (domain === 'process') return 'process.execute';
  if (domain === 'network') return 'network.egress';
  return null;
}

/**
 * 从 tool/operation/raw_command/arguments 推导 ACS capability（§三十一）。
 * 推导不确定返回 null（§三十二：fail-closed，不能把官方 optional 变成人为 mandatory）。
 */
export function deriveAcsCapability(input: CapabilityDerivationInput): string | null {
  // 1. raw_command 优先：classifyShellCommand 已做过领域/动作细化
  //    （例：tool.name=shell + raw_command="git reset --hard" → git.destructive）
  if (input.rawCommand) {
    const classified = classifyShellCommand(input.rawCommand);
    if (classified) {
      const cap = classifiedToCapability(classified.domain, classified.action);
      if (cap) return cap;
    }
  }

  const tool = (input.toolName ?? '').trim().toLowerCase();
  const op = (input.operation ?? '').trim().toLowerCase();
  const delOp = /^(del|delete|remove|rm|unlink|erase|trash)(\b|_|\.)/.test(op) || /^(delete|remove|rm|unlink|erase|trash)$/.test(op);
  const writeOp = /^(write|create|edit|append|mv|move|copy|overwrite|put|upload)(\b|_|\.)/.test(op) || /^(write|create|edit|append|move|copy|overwrite|put|upload)$/.test(op);
  const gitDestructiveOp = /^(reset|clean|force|discard)(\b|_|\.)/.test(op) || /^(reset|clean|force|discard)$/.test(op);

  // 2. tool.name 引导
  if (tool.startsWith('mcp')) return 'mcp.invoke';
  if (tool === 'shell' || tool === 'bash' || tool === 'zsh' || tool === 'powershell' || tool === 'pwsh' || tool === 'cmd') return 'shell.execute';
  if (tool === 'process' || tool === 'exec' || tool === 'run' || tool === 'spawn') return 'process.execute';
  if (tool === 'git') return gitDestructiveOp ? 'git.destructive' : 'git.modify';
  if (tool === 'filesystem' || tool === 'fs' || tool === 'file' || tool === 'directory') {
    if (delOp) return 'filesystem.delete';
    if (writeOp) return 'filesystem.write';
    return 'filesystem.read';
  }
  if (tool === 'credentials' || tool === 'credential' || tool === 'secrets') {
    if (writeOp || /^(write|mutate|create|set|put|export|delete)$/.test(op)) return 'credential.mutate';
    return 'credential.read';
  }
  if (tool === 'network' || tool === 'http' || tool === 'fetch' || tool === 'curl' || tool === 'wget') return 'network.egress';

  // 3. 仅 operation 引导（tool 未知时保守最小集）
  if (delOp) return 'filesystem.delete';
  if (gitDestructiveOp) return 'git.destructive';
  if (writeOp) return 'filesystem.write';
  if (/^(read|cat|view|list|get|show)$/.test(op)) return 'filesystem.read';
  if (/^(execute|run|spawn|invoke|call)$/.test(op)) return 'process.execute';

  return null; // 推导不确定 → fail-closed（§三十二）
}
