/**
 * @riskguard/adapter-cursor — Cursor preToolUse Adapter（M3，D1 文档确认）
 *
 * payload 形状（Claude 兼容，claw-hooks/context-mode 实测确认）：
 *   { tool_name, tool_input: { command | file_path ... }, cwd, workspace_roots, ... }
 * 阻断输出（官方，仅 exit 0 时 Cursor 读取 stdout）：
 *   { "permission": "deny", "user_message": "...", "agent_message": "..." }
 * failClosed: true 建议（Cursor 默认 fail-open：crash/timeout 放行）。
 *
 * 覆盖：preToolUse（Shell/Read/Write/Delete/Task/MCP:*）+ Delete Tool（文档 §10.3 强调）。
 */

import type { RiskEvent } from '../../../core/src/event.ts';
import type { Decision } from '../../../core/src/decision.ts';
import { normalizeEvent, classifyShellCommand, isReadOnlyCommand } from '../../../core/src/normalize.ts';
import type { NormalizeOutcome } from '../../../core/src/normalize.ts';

export interface CursorPayload {
  tool_name?: string;
  toolName?: string;
  tool?: string;
  name?: string;
  tool_input?: Record<string, unknown> & { command?: string; file_path?: string; filePath?: string; path?: string };
  toolInput?: Record<string, unknown> & { command?: string; file_path?: string; filePath?: string; path?: string };
  input?: Record<string, unknown> & { command?: string; file_path?: string; filePath?: string; path?: string };
  args?: Record<string, unknown> & { command?: string; file_path?: string; filePath?: string; path?: string };
  cwd?: string;
  workspace_roots?: string[];
  workspaceRoots?: string[];
}

export function parseCursorPayload(payload: CursorPayload, home?: string): NormalizeOutcome {
  const tool = payload.tool_name ?? payload.toolName ?? payload.tool ?? payload.name ?? '';
  const input = payload.tool_input ?? payload.toolInput ?? payload.input ?? payload.args ?? {};
  const cwd = payload.cwd ?? payload.workspace_roots?.[0] ?? payload.workspaceRoots?.[0];

  // Shell 命令（preToolUse Shell / beforeShellExecution 共用）
  if (typeof input.command === 'string') {
    const classified = classifyShellCommand(input.command);
    if (classified) {
      return normalizeEvent({
        agent: 'cursor', surface: 'preToolUse', tool,
        domain: classified.domain, action: classified.action, destructive: classified.destructive,
        commandRaw: input.command, cwd, home, workspaceRoot: cwd,
      });
    }
    if (isReadOnlyCommand(input.command)) {
      return normalizeEvent({
        agent: 'cursor', surface: 'preToolUse', tool,
        domain: 'filesystem', action: 'read', commandRaw: input.command, cwd, home, workspaceRoot: cwd,
      });
    }
    return normalizeEvent({
      agent: 'cursor', surface: 'preToolUse', tool,
      domain: 'process', action: 'execute', commandRaw: input.command, cwd, home, workspaceRoot: cwd,
    });
  }

  // 结构化工具（含 Delete Tool / Write / Edit / MCP）
  const path = input.file_path ?? input.filePath ?? input.path;
  const domain = tool.toLowerCase().includes('mcp') ? 'network' : 'filesystem';
  const action =
    /delete/i.test(tool) ? 'delete' :
    /write|create/i.test(tool) ? 'write' :
    /edit|patch/i.test(tool) ? 'edit' :
    'unknown';

  return normalizeEvent({
    agent: 'cursor', surface: 'preToolUse', tool,
    domain: domain === 'network' ? 'network' : 'filesystem',
    action: (action as never),
    targetsRaw: path ? [path as string] : [],
    cwd, home, workspaceRoot: cwd,
  });
}

/** Decision → Cursor 阻断输出（exit 0 + stdout JSON） */
export function renderCursorDecision(decision: Decision): string {
  if (decision.decision === 'deny') {
    return JSON.stringify({
      permission: 'deny',
      user_message: `RiskGuard: ${decision.reason ?? 'denied'}`,
      agent_message: `RiskGuard 拦截：${decision.reason ?? ''}` +
        (decision.safeAlternative ? ` 安全替代：${decision.safeAlternative.operation}` : ''),
    });
  }
  return '{}';
}

export function evaluateCursor(payload: CursorPayload, decide: (e: RiskEvent) => Decision): string {
  const out = parseCursorPayload(payload);
  if (!out.ok) {
    return JSON.stringify({ permission: 'deny', user_message: 'RiskGuard: payload 解析失败 (fail-closed)', agent_message: 'RiskGuard parse failure (fail-closed)' });
  }
  return renderCursorDecision(decide(out.event));
}