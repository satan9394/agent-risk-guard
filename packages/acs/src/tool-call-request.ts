/**
 * acs/tool-call-request.ts — ACS ToolCallRequest → RiskEvent（v0.2.0 §六/§七）
 *
 * 映射原则：
 *   tool        → RiskEvent.operation.domain（经 capability 归一）
 *   operation   → RiskEvent.operation.action
 *   raw_command → RiskEvent.command.raw（并触发 classifyShellCommand 细化 domain/action）
 *   arguments   → 提取 path / target / url / host / repo / branch 等 target
 *   intent      → RiskEvent.context.metadata.intent（contextual evidence）
 *
 * intent 绝不直接决定 allow（§七）：它只是上下文证据，策略判定仍由 Policy Engine 完成。
 * 未知 capability → fail-closed（返回 null，由 gateway 决定 deny）。
 */

import { createEvent, type RiskEvent, type EventTarget } from '../../core/src/event.ts';
import { classifyShellCommand, extractTargetsFromCommand, isReadOnlyCommand, normalizeEvent } from '../../core/src/normalize.ts';
import { toRiskGuardCapability, capabilityToOperation } from './capability-map.ts';
import type { AcsToolCallRequest } from './types.ts';

export interface AcsMappingFail {
  ok: false;
  reason: string;
}

export interface AcsMappingOk {
  ok: true;
  event: RiskEvent;
  /** capability 归一信息（审计用） */
  meta: {
    capability: string;
    exact: boolean;
    intent?: string;
  };
}

export type AcsMappingOutcome = AcsMappingOk | AcsMappingFail;

/** 从 arguments 提取路径/目标类字符串（path/target/url/host/repo/branch/file/directory） */
function extractTargetsFromArguments(args: Record<string, unknown>): string[] {
  const out: string[] = [];
  const keys = ['path', 'target', 'url', 'host', 'repo', 'branch', 'file', 'directory', 'dest', 'source'];
  const push = (v: unknown): void => {
    if (typeof v === 'string' && v.trim()) out.push(v.trim());
    else if (Array.isArray(v)) for (const item of v) push(item);
  };
  for (const k of keys) {
    if (k in args) push(args[k]);
  }
  // 嵌套 command 对象（自测 payload 形状：arguments.command.value）
  const cmd = args['command'];
  if (cmd && typeof cmd === 'object') {
    const cmdObj = cmd as Record<string, unknown>;
    if (typeof cmdObj['value'] === 'string') push(cmdObj['value']);
  }
  return out;
}

/** 从 arguments.command.value 提取 raw_command（自测/规范化 payload 支持） */
function rawCommandFromArguments(args: Record<string, unknown>): string | null {
  const cmd = args['command'];
  if (cmd && typeof cmd === 'object') {
    const v = (cmd as Record<string, unknown>)['value'];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return null;
}

/**
 * ACS ToolCallRequest → RiskEvent。
 * 步骤：
 *   1. capability → RiskGuard capability（未知 → fail）
 *   2. capability → base {domain, action}
 *   3. raw_command（显式或 arguments.command.value）→ classifyShellCommand 细化
 *      （shell.execute + "rm -rf x" → filesystem.delete 等）
 *   4. targets：arguments 提取 + raw_command 提取
 *   5. intent → context.metadata.intent（仅 evidence）
 */
export function acsToolCallToRiskEvent(request: AcsToolCallRequest): AcsMappingOutcome {
  const rgCap = toRiskGuardCapability(request.capability);
  if (!rgCap) {
    return { ok: false, reason: `unknown capability: ${request.capability}` };
  }
  const base = capabilityToOperation(rgCap);

  let domain = base.domain;
  let action = base.action;
  let destructiveOverride: boolean | undefined;
  const rawCommand = request.raw_command ?? rawCommandFromArguments(request.arguments ?? {});

  // raw_command 触发命令分类：shell/process execute 但内容实际是删除/git 破坏 → 细化
  if (rawCommand) {
    const classified = classifyShellCommand(rawCommand);
    if (classified) {
      domain = classified.domain;
      action = classified.action;
      destructiveOverride = classified.destructive;
    } else if ((rgCap === 'shell.execute' || rgCap === 'process.execute') && isReadOnlyCommand(rawCommand)) {
      // 未分类但明确只读的安全命令 → filesystem.read（Profile B 放行，与 vendor adapter 同模式）
      domain = 'filesystem';
      action = 'read';
    }
  }

  const targetsRaw: string[] = extractTargetsFromArguments(request.arguments ?? {});
  const out = normalizeEvent({
    agent: 'acs',
    surface: 'acs.tool_call',
    domain,
    action,
    destructive: destructiveOverride,
    commandRaw: rawCommand,
    targetsRaw,
    cwd: request.environment?.cwd,
    tool: request.tool.name,
  });
  if (!out.ok) {
    return { ok: false, reason: out.reason };
  }

  // intent → context.metadata.intent（非破坏式；不参与决策）
  const event = out.event;
  if (request.intent?.description || request.intent?.goal) {
    event.context = {
      ...(event.context ?? {}),
      metadata: { intent: { description: request.intent.description, goal: request.intent.goal } },
    };
  }
  // provenance trust 也仅作 evidence（不直接决定 allow）
  if (request.provenance?.length) {
    event.context = {
      ...(event.context ?? {}),
      metadata: {
        ...(event.context?.metadata ?? {}),
        provenance: request.provenance.map((p) => ({ sourceType: p.sourceType, trust: p.trust ?? 'unknown' })),
      },
    };
  }

  return {
    ok: true,
    event,
    meta: { capability: rgCap, exact: base.exact, intent: request.intent?.description ?? request.intent?.goal },
  };
}

/** 从 raw_command 中提取更多路径目标（供 target 覆盖） */
export function extractAcsTargets(rawCommand: string | null | undefined, cwd?: string, home?: string): EventTarget[] {
  if (!rawCommand) return [];
  return extractTargetsFromCommand(rawCommand, cwd, home);
}

/** 便捷：完全重建（供测试/调试） */
export function buildRiskEvent(request: AcsToolCallRequest): RiskEvent | null {
  const out = acsToolCallToRiskEvent(request);
  return out.ok ? out.event : null;
}

// re-export for tests
export { createEvent };
