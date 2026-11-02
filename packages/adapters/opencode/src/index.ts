/**
 * @riskguard/adapter-opencode — OpenCode TS 插件前置拦截（M4）
 *
 * OpenCode 插件模型（V2，`@opencode/cli` >= 2.0；2026-11-02 在 2.2.5 上复验）：
 *   export default { id, async setup(ctx) { await ctx.tool.hook('execute.before', (event) => {…}) } }
 * `execute.before` 的事件形如 { tool, input, sessionID, agent, messageID, id }，**抛错即拒绝该次调用**；
 * 它是 V2 里唯一可以 fail 的钩子域（shell 域是 never，拦不住）。
 * V1（1.18.x）仍用 `'tool.before'` + `{ error }` 返回。
 * 本模块是「纯决策函数」：不依赖 opencode 运行时，给出 RiskEvent 决策与
 * opencode 输出形状（`{ error: string }` 或 undefined = 放行）。接线样板见文件末尾。
 */

import type { RiskEvent } from '../../../core/src/event.ts';
import type { Decision } from '../../../core/src/decision.ts';
import { normalizeEvent, classifyShellCommand, isReadOnlyCommand } from '../../../core/src/normalize.ts';
import type { NormalizeOutcome } from '../../../core/src/normalize.ts';

export interface OpencodePayload {
  tool?: string;
  input?: { command?: string; filePath?: string; path?: string } & Record<string, unknown>;
  cwd?: string;
  sessionID?: string;
  // 变体
  sessionId?: string;
}

export function parseOpencodePayload(payload: OpencodePayload, home?: string): NormalizeOutcome {
  const tool = payload.tool ?? '';
  const input = payload.input ?? {};
  const cwd = payload.cwd;
  const toolName = tool.split(':').pop() ?? tool;

  if (typeof input.command === 'string' && input.command.length > 0) {
    const classified = classifyShellCommand(input.command);
    if (classified) {
      return normalizeEvent({
        agent: 'opencode', surface: 'tool.before', tool,
        domain: classified.domain, action: classified.action, destructive: classified.destructive,
        commandRaw: input.command, cwd, home, workspaceRoot: cwd,
      });
    }
    if (isReadOnlyCommand(input.command)) {
      return normalizeEvent({
        agent: 'opencode', surface: 'tool.before', tool,
        domain: 'filesystem', action: 'read', commandRaw: input.command, cwd, home, workspaceRoot: cwd,
      });
    }
    return normalizeEvent({
      agent: 'opencode', surface: 'tool.before', tool,
      domain: 'process', action: 'execute', commandRaw: input.command, cwd, home, workspaceRoot: cwd,
    });
  }

  // 结构化文件工具
  const path = input.filePath ?? input.path;
  const lower = toolName.toLowerCase();
  const action =
    /delete/i.test(lower) ? 'delete' :
    /write|create/i.test(lower) ? 'write' :
    /edit|patch/i.test(lower) ? 'edit' :
    'unknown';

  return normalizeEvent({
    agent: 'opencode', surface: 'tool.before', tool,
    domain: 'filesystem', action: action as never,
    targetsRaw: path ? [path as string] : [],
    cwd, home, workspaceRoot: cwd,
  });
}

/** Decision → V1 `'tool.before'` 返回值（{ error } 阻止；undefined 放行）。V2 直接抛错。 */
export function renderOpencodeDecision(decision: Decision): { error?: string } | undefined {
  if (decision.decision === 'deny') {
    return { error: `RiskGuard: ${decision.reason ?? 'denied'}` + (decision.safeAlternative ? ` — 请改用 ${decision.safeAlternative.operation}` : '') };
  }
  return undefined;
}

export function evaluateOpencode(payload: OpencodePayload, decide: (e: RiskEvent) => Decision, home?: string): { error?: string } | undefined {
  const out = parseOpencodePayload(payload, home);
  if (!out.ok) {
    return { error: 'RiskGuard: payload 解析失败 (fail-closed)' };
  }
  return renderOpencodeDecision(decide(out.event));
}

/** OpenCode V2 插件接线样板（复制到 `~/.config/opencode/plugins/` 使用） */
export const OPENCODE_PLUGIN_SKELETON = `import { evaluateOpencode } from '@riskguard/adapter-opencode';

export default {
  id: 'riskguard',
  async setup(ctx) {
    await ctx.tool.hook('execute.before', (event) => {
      if (event.tool !== 'shell' && event.tool !== 'bash') return;
      const blocked = evaluateOpencode(
        { tool: event.tool, input: event.input, cwd: process.cwd() },
        (e) => /* RiskGuard policy */ ({ decision: 'allow' }),
      );
      if (blocked) throw new Error(blocked.error);
    });
  },
};`;