/**
 * @riskguard/adapter-grok — Grok CLI PreToolUse Adapter（M3，D1 文档确认）
 *
 * payload 形状（claw-hooks 实测确认，接受 camelCase + legacy snake_case）：
 *   { hookEventName: 'PreToolUse' | hook_event_name, toolName | tool_name, toolInput | tool_input: { command }, ... }
 * 阻断输出：{ "decision": "deny", "reason": "..." } 且 exit 2。
 * 注意：Grok hook 是 fail-open（文档 §10.7），关键边界必须由 Rules/Sandbox 兜底。
 */

import type { RiskEvent } from '../../../core/src/event.ts';
import type { Decision } from '../../../core/src/decision.ts';
import { normalizeEvent, classifyShellCommand, isReadOnlyCommand } from '../../../core/src/normalize.ts';
import type { NormalizeOutcome } from '../../../core/src/normalize.ts';

export interface GrokPayload {
  hookEventName?: string;
  hook_event_name?: string;
  toolName?: string;
  tool_name?: string;
  toolInput?: Record<string, unknown> & { command?: string; file_path?: string };
  tool_input?: Record<string, unknown> & { command?: string; file_path?: string };
  cwd?: string;
  workspaceRoot?: string;
}

export function parseGrokPayload(payload: GrokPayload, home?: string): NormalizeOutcome {
  const tool = payload.toolName ?? payload.tool_name;
  // P1-33 修复：缺工具名 → fail-closed（不再默认 Bash，避免空 payload 被误当 shell 命令）
  if (!tool) {
    return { ok: false, reason: 'missing tool name in Grok payload', raw: payload };
  }
  const input = payload.toolInput ?? payload.tool_input ?? {};
  const cwd = payload.cwd ?? payload.workspaceRoot;

  if (typeof input.command === 'string' && input.command.trim().length > 0) {
    const classified = classifyShellCommand(input.command);
    if (classified) {
      return normalizeEvent({
        agent: 'grok', surface: 'PreToolUse', tool,
        domain: classified.domain, action: classified.action, destructive: classified.destructive,
        commandRaw: input.command, cwd, home, workspaceRoot: cwd,
      });
    }
    if (isReadOnlyCommand(input.command)) {
      return normalizeEvent({
        agent: 'grok', surface: 'PreToolUse', tool,
        domain: 'filesystem', action: 'read', commandRaw: input.command, cwd, home, workspaceRoot: cwd,
      });
    }
    return normalizeEvent({
      agent: 'grok', surface: 'PreToolUse', tool,
      domain: 'process', action: 'execute', commandRaw: input.command, cwd, home, workspaceRoot: cwd,
    });
  }

  // 非命令工具：按文件名归类写操作
  return normalizeEvent({
    agent: 'grok', surface: 'PreToolUse', tool,
    domain: 'filesystem', action: 'write',
    targetsRaw: input.file_path ? [input.file_path] : [],
    cwd, home, workspaceRoot: cwd,
  });
}

/** Decision → Grok 阻断输出（{ decision: deny } + exit 2） */
export function renderGrokDecision(decision: Decision): string {
  if (decision.decision === 'deny') {
    return JSON.stringify({ decision: 'deny', reason: `RiskGuard: ${decision.reason ?? 'denied'}` });
  }
  return '{}';
}

export function evaluateGrok(payload: GrokPayload, decide: (e: RiskEvent) => Decision): string {
  const out = parseGrokPayload(payload);
  if (!out.ok) {
    return JSON.stringify({ decision: 'deny', reason: 'RiskGuard: payload 解析失败 (fail-closed)' });
  }
  return renderGrokDecision(decide(out.event));
}

/** exit code：deny → 2（Grok 约定阻断），allow → 0 */
export function grokExitCode(decisionText: string): number {
  return decisionText.includes('"decision":"deny"') ? 2 : 0;
}