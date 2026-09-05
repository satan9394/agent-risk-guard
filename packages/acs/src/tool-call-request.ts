/**
 * acs/tool-call-request.ts — ACS ToolCallRequest → RiskEvent（v0.2.0 §六/§七，v0.2.1 §三十一~§三十六）
 *
 * 映射原则：
 *   tool        → RiskEvent.operation.domain（经 capability 归一）
 *   operation   → RiskEvent.operation.action
 *   raw_command → RiskEvent.command.raw（并触发 classifyShellCommand 细化 domain/action）
 *   arguments   → 经 unwrapAcsArguments 解析 value-wrapper（§三十三）后提取
 *                 path / target / url / host / repo / branch 等 target
 *   intent      → RiskEvent.context.metadata.intent（contextual evidence）
 *   argument-level provenance → RiskEvent.context.metadata.provenance（§三十四/§三十五）
 *   envelope metadata → RiskEvent.context.metadata.acs（§三十六；Core 不解释）
 *
 * intent / provenance 绝不直接决定 allow（§七）：只是上下文证据，策略判定仍由 Policy Engine 完成。
 *
 * capability 解析（§三十一/§三十二）：
 *   capability present → 官方名归一（未知 → fail-closed）
 *   capability absent  → 从 tool/operation/raw_command/arguments 推导（§三十一）
 *   derive 成功        → RiskEvent
 *   derive 不确定      → fail-closed（返回 null，由 gateway 决定 deny）
 */

import { createEvent, type RiskEvent, type EventTarget } from '../../core/src/event.ts';
import { classifyShellCommand, extractTargetsFromCommand, isReadOnlyCommand, normalizeEvent } from '../../core/src/normalize.ts';
import { toRiskGuardCapability, capabilityToOperation, deriveAcsCapability } from './capability-map.ts';
import { unwrapAcsArguments } from './arguments.ts';
import type { AcsToolCallRequest, AcsRequestMetadata } from './types.ts';

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
    /** explicit = 请求自带；derived = 从 tool/operation/raw_command 推导（§三十一） */
    source: 'explicit' | 'derived';
    intent?: string;
  };
}

export type AcsMappingOutcome = AcsMappingOk | AcsMappingFail;

/** 映射上下文（envelope 模式透传 metadata，§三十六） */
export interface AcsMappingCtx {
  acsMetadata?: AcsRequestMetadata;
}

/** 从 unwrap 后的 arguments 提取路径/目标类字符串（path/target/url/host/repo/branch/file/directory） */
function extractTargetsFromArgumentValues(args: Record<string, unknown>): string[] {
  const out: string[] = [];
  const keys = ['path', 'target', 'url', 'host', 'repo', 'branch', 'file', 'directory', 'dest', 'source'];
  const push = (v: unknown): void => {
    if (typeof v === 'string' && v.trim()) out.push(v.trim());
    else if (Array.isArray(v)) for (const item of v) push(item);
  };
  for (const k of keys) {
    if (k in args) push(args[k]);
  }
  return out;
}

/**
 * ACS ToolCallRequest → RiskEvent。
 * 步骤：
 *   1. capability：显式 → 归一；缺失 → deriveAcsCapability（§三十一）；均失败 → fail
 *   2. capability → base {domain, action}
 *   3. raw_command（显式或 arguments.command）→ classifyShellCommand 细化
 *   4. targets：unwrap 后的 arguments 提取 + raw_command 提取（§三十三）
 *   5. intent / provenance / envelope metadata → context.metadata（仅 evidence）
 */
export function acsToolCallToRiskEvent(request: AcsToolCallRequest, ctx: AcsMappingCtx = {}): AcsMappingOutcome {
  const argUnwrapped = unwrapAcsArguments(request.arguments);
  const argValues = argUnwrapped.values;

  // 1. capability 解析（§三十一/§三十二）
  //    capability 显式出现 → 官方名归一（未知 → fail-closed，绝不静默 reinterpret）
  //    capability 缺失      → 从 tool/operation/raw_command/arguments 推导；推导不确定 → fail-closed
  let rgCap: ReturnType<typeof toRiskGuardCapability> = null;
  let capSource: 'explicit' | 'derived' = 'explicit';
  const hasExplicitCap = request.capability !== undefined && request.capability !== null && String(request.capability).trim().length > 0;
  if (hasExplicitCap) {
    const mapped = toRiskGuardCapability(request.capability!);
    if (!mapped) {
      return { ok: false, reason: `unknown capability: ${request.capability}` };
    }
    rgCap = mapped;
  } else {
    const derived = deriveAcsCapability({
      toolName: request.tool.name,
      operation: request.operation,
      rawCommand: request.raw_command ?? (typeof argValues['command'] === 'string' ? argValues['command'] : null),
      argumentValues: argValues,
    });
    if (!derived) {
      return { ok: false, reason: 'cannot derive capability from tool/operation/raw_command/arguments' };
    }
    const mapped = toRiskGuardCapability(derived);
    if (!mapped) {
      return { ok: false, reason: `derived capability not mappable: ${derived}` };
    }
    rgCap = mapped;
    capSource = 'derived';
  }
  const base = capabilityToOperation(rgCap);

  let domain = base.domain;
  let action = base.action;
  let destructiveOverride: boolean | undefined;
  const rawCommand = request.raw_command ?? (typeof argValues['command'] === 'string' ? argValues['command'] : null);

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

  const targetsRaw: string[] = extractTargetsFromArgumentValues(argValues);
  const out = normalizeEvent({
    agent: 'acs',
    surface: 'acs.tool_call',
    domain,
    action,
    destructive: destructiveOverride,
    commandRaw: rawCommand,
    targetsRaw,
    tool: request.tool.name,
  });
  if (!out.ok) {
    return { ok: false, reason: out.reason };
  }

  // 5. contextual evidence → context.metadata（非破坏式；不参与决策）
  const event = out.event;
  const metadata: Record<string, unknown> = { ...(event.context?.metadata ?? {}) };

  if (request.intent?.description || request.intent?.goal) {
    metadata['intent'] = { description: request.intent.description, goal: request.intent.goal };
  }

  // §三十四：argument-level provenance → context.metadata.provenance（保留 argumentPath §三十五）
  if (argUnwrapped.provenance.length > 0) {
    metadata['provenance'] = argUnwrapped.provenance.map((p) => ({
      argumentPath: p.argumentPath,
      provenance_id: p.provenance.provenance_id,
      origin: p.provenance.origin,
      source_id: p.provenance.source_id,
      derived_from: p.provenance.derived_from,
    }));
  }

  // §三十六：envelope metadata → context.metadata.acs（Core 不解释 ACS）
  if (ctx.acsMetadata) {
    const m = ctx.acsMetadata;
    metadata['acs'] = {
      agentId: m.agent_id,
      agentName: m.agent_name,
      sessionId: m.session_id,
      turnId: m.turn_id,
      platform: m.platform,
      environment: m.environment,
    };
  }

  if (Object.keys(metadata).length > 0) {
    event.context = { ...(event.context ?? {}), metadata };
  }

  return {
    ok: true,
    event,
    meta: {
      capability: rgCap,
      exact: base.exact,
      source: capSource,
      intent: request.intent?.description ?? request.intent?.goal,
    },
  };
}

/** 从 raw_command 中提取更多路径目标（供 target 覆盖） */
export function extractAcsTargets(rawCommand: string | null | undefined, cwd?: string, home?: string): EventTarget[] {
  if (!rawCommand) return [];
  return extractTargetsFromCommand(rawCommand, cwd, home);
}

/** 便捷：完全重建（供测试/调试） */
export function buildRiskEvent(request: AcsToolCallRequest, ctx?: AcsMappingCtx): RiskEvent | null {
  const out = acsToolCallToRiskEvent(request, ctx);
  return out.ok ? out.event : null;
}

// re-export for tests
export { createEvent };
