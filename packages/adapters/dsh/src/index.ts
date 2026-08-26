/**
 * @riskguard/adapter-dsh — DeepSeek Harness pre-execute Adapter（M2，Reference Adapter）
 *
 * DSH 工具执行链路（D2：官方源码确认，2026-08-24 自本机 v22.19.0 dsh-tools 实证）：
 *   tools/pre-execute 瀑布（ctx.on，可扩展，先到先得）→ serviceAsk(ask) → tools.guard()
 *   单调拒绝段（guard 只能拒绝不能放行被拒项）→ dispatch
 *
 * 实证 API（源码片段，dsh-tools/lib/index.js）：
 *   - ctx.on('tools/pre-execute', (exec, next) => PreToolDecision)
 *     PreToolDecision = {kind:'allow'} | {kind:'deny', reason} | {kind:'ask', reason?}
 *     exec = { name, arguments, signal, agent?, parent? }（arguments 为已解析参数对象，
 *     pwsh/bash 命令文本位于 exec.arguments.command）
 *   - ctx.tools.guard(guardFn)：注册单调 guard；guardFn(exec) 返回 string 即拒绝；
 *     "no guard can force-allow a call another guard denied"（= 文档 RG-I03）
 *   - 实现片段：denialReason = decision.kind === "allow" ? guardReason(exec) : decision.reason
 *   - 拒绝结果：模型看到 `Error: <reason>`
 *   - guard 作用域：ctx 全局 / agent.ctx 仅该 agent；exec.agent 标识归属
 *
 * RiskGuard DSH Adapter 设计约束（文档 §10.1）：
 *   - tools/pre-execute listener 为 PURE DECISION FUNCTION：
 *     禁止 child_process / 写文件 / 网络请求 / 业务副作用
 *   - 真正的不变量（永久删除、Guard 自保护）走 ctx.tools.guard()（单调最终拒绝）
 *   - 本包只提供 payload 形状映射与决策函数；接线代码由安装包 @riskguard/dsh 提供
 */

import type { RiskEvent } from '../../../core/src/event.ts';
import type { Decision } from '../../../core/src/decision.ts';
import { normalizeEvent, classifyShellCommand, isReadOnlyCommand, normalizeFullWidth } from '../../../core/src/normalize.ts';
import type { NormalizeOutcome } from '../../../core/src/normalize.ts';

/** DSH pre-execute exec 对象（D2 实证形状） */
export interface DshPayload {
  name?: string;                 // 工具名：'pwsh' | 'bash' | ...
  arguments?: { command?: string; cwd?: string } & Record<string, unknown>;
  args?: string[];
  agent?: string;                // agent 作用域（guard 归属判定）
  parent?: string;
  signal?: unknown;
  sessionId?: string;
}

export function parseDshPayload(payload: DshPayload, home?: string): NormalizeOutcome {
  const tool = payload.name ?? 'shell';
  const input = (payload.arguments ?? {}) as { command?: string; cwd?: string };
  const cwd = input.cwd;

  // P0-24 修复：command 存在但非字符串 → fail-closed（不降级为 execute）
  if (input.command !== undefined && typeof input.command !== 'string') {
    return { ok: false, reason: `invalid command type: ${typeof input.command} (expected string)`, raw: payload };
  }

  if (typeof input.command === 'string' && input.command.length > 0) {
    const classified = classifyShellCommand(input.command);
    if (classified) {
      return normalizeEvent({
        agent: 'dsh', surface: 'tools/pre-execute', tool,
        domain: classified.domain, action: classified.action, destructive: classified.destructive,
        commandRaw: input.command, cwd, home, workspaceRoot: cwd,
      });
    }
    if (isReadOnlyCommand(input.command)) {
      return normalizeEvent({
        agent: 'dsh', surface: 'tools/pre-execute', tool,
        domain: 'filesystem', action: 'read', commandRaw: input.command, cwd, home, workspaceRoot: cwd,
      });
    }
    return normalizeEvent({
      agent: 'dsh', surface: 'tools/pre-execute', tool,
      domain: 'process', action: 'execute', commandRaw: input.command, cwd, home, workspaceRoot: cwd,
    });
  }

  // 结构化工具调用（无 command）：按工具名归类（P1-28 修复：Unicode 规范化）
  const t = normalizeFullWidth(tool).toLowerCase();
  // P2-26 修复：清理路径分隔符（防审计日志注入）
  const cleanTool = tool.replace(/[\\/]+/g, '_');
  const domain = t.includes('bash') || t.includes('shell') || t.includes('pwsh') || t.includes('exec')
    ? 'process' : 'filesystem';
  // 非 shell 的未知结构化调用（如 MCP 工具）无法可靠分类 → 归 write（保守，fail-closed 方向）
  return normalizeEvent({
    agent: 'dsh', surface: 'tools/pre-execute', tool: cleanTool || 'unknown',
    domain, action: domain === 'process' ? 'execute' : 'write', cwd, home, workspaceRoot: cwd,
  });
}

/** pre-execute 决策（纯函数）：返回 Decision + 是否为 guard 级不变量 */
export interface DshDecision extends Decision {
  viaGuard?: boolean; // true = 建议走 ctx.tools.guard()（单调最终拒绝）
}

export function evaluateDsh(payload: DshPayload, decide: (e: RiskEvent) => Decision, home?: string): DshDecision {
  const out = parseDshPayload(payload, home);
  if (!out.ok) {
    return { decision: 'deny', degraded: true, ruleId: 'RG-PARSE-000', reason: `RiskGuard DSH parse failure (fail-closed): ${out.reason}` };
  }
  const d = decide(out.event);
  return d.monotonic ? { ...d, viaGuard: true } : d;
}

/**
 * guard 接线（D2 实证签名）：预注册单调 guards。
 *
 * ctx.tools.guard(guardFn) — guardFn(exec) 返回 string 即拒绝该执行；
 *   - 注册在 tools/pre-execute 瀑布之后执行（单调最终拒绝）
 *   - 任何 guard 都不能 force-allow 已被另一 guard 拒绝的调用（= RG-I03）
 *   - ctx 注册 → 全局；agent.ctx 注册 → 仅该 agent
 *   - 返回 disposer 用于 HMR/卸载清理
 *
 * RiskGuard 用 guard 承载不可撤销不变量：永久删除 / Guard 自保护 /
 * 受保护路径 / Strict Profile 禁用的工具。pre-execute 只做可放行的动态策略。
 */
export function guardAdvisory(): { target: string; usage: string } {
  return {
    target: 'ctx.tools.guard()',
    usage: 'RiskGuard 不变量（永久删除/自保护/受保护路径）— 单调最终拒绝；pre-execute 瀑布只做可放行策略；guard 返回 string 即 deny，任何 guard 不得 force-allow 已被拒绝的调用',
  };
}