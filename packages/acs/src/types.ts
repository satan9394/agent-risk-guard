/**
 * acs/types.ts — ACS v0.1 最小类型集（v0.2.0）
 *
 * 只映射本工程实际使用的 schema/interface（目标 §五：不 vendor 整个 OWASP ACS 仓库）。
 * 依据研究报告核查的 ACS v0.1 Public Preview 形状：
 *   - ToolCallRequest 顶层字段：tool / operation / capability / arguments / raw_command / intent
 *     （外加 provenance / environment 上下文）
 *   - AcsResult 决策：allow / deny / modify / ask / defer
 *     reasoning：deny/modify/ask/defer 必填；modify 必带 modifications；
 *     metadata.evaluator ∈ deterministic | agent | composite
 *
 * 版本策略（§四）：本文件即 acs-v0.1 版本面；未来 v1 并存时新增 acs-v1 目录，
 * 不修改本文件的历史语义。
 */

import type { AcsDecision } from './version.ts';

// ============================================================================
// ACS v0.1 ToolCallRequest（inbound）
// ============================================================================

/** ACS 官方 capability 枚举（报告实测 v0.1.0/tool-call-request.json） */
export type AcsCapability =
  | 'filesystem.read'
  | 'filesystem.write'
  | 'filesystem.delete'
  | 'process.execute'
  | 'scm.git.reset'
  | 'scm.git.clean'
  | 'scm.git.force_push'
  | 'network.egress'
  | 'credential.read'
  | 'credential.mutate'
  | 'mcp.invoke'
  | 'agent.spawn'
  | 'skill.load'
  | 'memory.store'
  | (string & {}); // 扩展名：未知 capability 允许，但 mapping 时 fail-closed 处理

export interface AcsTool {
  name: string;
  provider?: string;
  protocol?: 'native' | 'mcp' | 'a2a' | 'shell';
}

export interface AcsProvenanceEntry {
  sourceType: 'user' | 'model' | 'tool' | 'mcp' | 'file' | 'web' | 'memory';
  sourceId?: string;
  trust?: 'trusted' | 'unknown' | 'untrusted';
  derivedFrom?: string[];
}

export interface AcsEnvironment {
  os: string;
  cwd?: string;
  sandboxed?: boolean;
}

/** ACS v0.1 ToolCallRequest（本工程实际使用的字段子集） */
export interface AcsToolCallRequest {
  tool: AcsTool;
  operation?: string;
  capability: AcsCapability;
  arguments?: Record<string, unknown>;
  raw_command?: string | null;
  intent?: { description?: string; goal?: string };
  provenance?: AcsProvenanceEntry[];
  environment?: AcsEnvironment;
  /** 透传标识（非 ACS 字段；仅用于审计回显，不做决策依据） */
  requestId?: string;
}

// ============================================================================
// ACS v0.1 AcsResult（outbound）
// ============================================================================

export type AcsEvaluator = 'deterministic' | 'agent' | 'composite';

export interface AcsPolicyReference {
  policy_id?: string;
  policy_version?: string;
  rule_id?: string;
}

/** modify 决策的改写提议：只提出，不执行（v0.2.0 §十二） */
export interface AcsModification {
  tool?: string;
  capability?: string;
  operation?: string;
  arguments?: Record<string, unknown>;
  raw_command?: string;
  description?: string;
}

export interface AcsAskDetails {
  prompt?: string;
  options?: string[];
  context?: Record<string, unknown>;
}

export interface AcsDeferDetails {
  reason?: string;
  deferral?: string;
}

export interface AcsMetadata {
  evaluator: AcsEvaluator;
  [k: string]: unknown;
}

/**
 * RiskGuard Extension Namespace（§十九）：
 * 不往 ACS 官方 schema 顶层加字段；RiskGuard 特有信息统一放 extensions.riskguard。
 */
export interface RiskGuardExtensions {
  ruleId?: string;
  degraded?: boolean;
  verification?: 'dynamic' | 'static' | 'none';
  monotonic?: boolean;
  profile?: string;
  acsVersion?: string;
}

export interface AcsResult {
  decision: AcsDecision;
  /** deny/modify/ask/defer 必填；至少含 rule ID + risk category + operation + reason（§十五） */
  reasoning?: string;
  reason_codes?: string[];
  policy_references?: AcsPolicyReference[];
  policy_data?: Record<string, unknown>;
  cited_provenance_ids?: string[];
  /** modify 必填：改写提议（本轮只提议，不执行） */
  modifications?: AcsModification[];
  ask_details?: AcsAskDetails;
  defer_details?: AcsDeferDetails;
  chain_hash?: string;
  signature?: string;
  metadata?: AcsMetadata;
  /** RiskGuard 扩展命名空间（§十九） */
  extensions?: { riskguard: RiskGuardExtensions };
}
