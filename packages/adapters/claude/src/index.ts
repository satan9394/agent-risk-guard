/**
 * @riskguard/adapter-claude — Claude Code PreToolUse Adapter（M3，D1 文档确认）
 *
 * payload 形状（官方）：{ tool_name, tool_input: { command, ... }, ... }
 * 阻断输出（官方，exit 0）：
 *   { hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: '...' } }
 * parse error：stderr 纯文本 + exit 2。
 *
 * 覆盖工具：Bash / PowerShell / Edit / Write / MCP（文档 §10.2 要求废弃只判断 Bash 的旧版）。
 */

import type { RiskEvent } from '../../../core/src/event.ts';
import type { Decision } from '../../../core/src/decision.ts';
import { normalizeEvent, classifyShellCommand, isReadOnlyCommand } from '../../../core/src/normalize.ts';
import type { NormalizeOutcome } from '../../../core/src/normalize.ts';

export interface ClaudePayload {
  tool_name?: string;
  tool_input?: Record<string, unknown> & { command?: string; file_path?: string; filePath?: string };
  workspace_roots?: string[];
  cwd?: string;
  tool_call_id?: string;
}

/** 工具名 → domain/action（非 shell 工具的静态映射） */
const TOOL_MAP: Record<string, { domain: 'filesystem' | 'process'; action: 'write' | 'edit' | 'delete' | 'execute' }> = {
  Bash: { domain: 'process', action: 'execute' },
  PowerShell: { domain: 'process', action: 'execute' },
  Write: { domain: 'filesystem', action: 'write' },
  Edit: { domain: 'filesystem', action: 'edit' },
  MultiEdit: { domain: 'filesystem', action: 'edit' },
};

/**
 * Claude payload → RiskEvent。
 * 失败返回 { ok:false }，调用方必须 fail-closed（RG-I04）。
 */
export function parseClaudePayload(payload: ClaudePayload, home?: string): NormalizeOutcome {
  const tool = payload.tool_name ?? '';
  const input = payload.tool_input ?? {};
  const cwd = payload.cwd ?? payload.workspace_roots?.[0];

  // shell 工具（P0-29 修复：大小写不敏感 + 全 shell 集合；空 command → fail-closed）
  const t = tool.toLowerCase();
  const isShell = ['bash', 'powershell', 'pwsh', 'sh', 'zsh', 'cmd'].includes(t);
  if (isShell) {
    if (typeof input.command !== 'string' || input.command.trim().length === 0) {
      return { ok: false, reason: `invalid/empty command for shell tool ${tool}`, raw: payload };
    }
    const classified = classifyShellCommand(input.command);
    if (classified) {
      return normalizeEvent({
        agent: 'claude-code', surface: 'PreToolUse', tool,
        domain: classified.domain, action: classified.action, destructive: classified.destructive,
        commandRaw: input.command, cwd, home, workspaceRoot: cwd,
      });
    }
    // 未分类的 shell 命令 → 只读家族归 read，其余归 execute（由 policy 决定 ask/allow）
    if (isReadOnlyCommand(input.command)) {
      return normalizeEvent({
        agent: 'claude-code', surface: 'PreToolUse', tool,
        domain: 'filesystem', action: 'read', commandRaw: input.command, cwd, home, workspaceRoot: cwd,
      });
    }
    return normalizeEvent({
      agent: 'claude-code', surface: 'PreToolUse', tool,
      domain: 'process', action: 'execute', commandRaw: input.command, cwd, home, workspaceRoot: cwd,
    });
  }

  const mapped = TOOL_MAP[tool];
  if (mapped) {
    return normalizeEvent({
      agent: 'claude-code', surface: 'PreToolUse', tool,
      domain: mapped.domain, action: mapped.action,
      targetsRaw: [input.file_path ?? input.filePath].filter(Boolean) as string[],
      cwd, home, workspaceRoot: cwd,
    });
  }

  // MCP 等未知工具：无法可靠分类 → 保守 unknown write（fail-closed 方向）
  return normalizeEvent({
    agent: 'claude-code', surface: 'PreToolUse', tool: tool || 'MCP',
    domain: 'filesystem', action: 'write',
    targetsRaw: [input.file_path ?? input.filePath].filter(Boolean) as string[],
    cwd, home, workspaceRoot: cwd,
  });
}

/** Decision → Claude 阻断输出 JSON（exit 0）。Claude Code 要求 hookSpecificOutput.hookEventName='PreToolUse' */
export function renderClaudeDecision(decision: Decision): string {
  if (decision.decision === 'deny') {
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: decision.reason ?? 'denied by RiskGuard',
      },
      systemMessage: `RiskGuard: ${decision.reason ?? 'denied'}` +
        (decision.safeAlternative ? ` — 请改用 ${decision.safeAlternative.operation}` : ''),
    });
  }
  return '{}';
}

/** 完整入口：payload → 决策 JSON 字符串（供 hook 直接 print） */
export function evaluateClaude(payload: ClaudePayload, decide: (e: RiskEvent) => Decision): string {
  const out = parseClaudePayload(payload);
  if (!out.ok) {
    return JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `RiskGuard parse failure (fail-closed): ${out.reason}` },
      systemMessage: 'RiskGuard: payload 解析失败，fail-closed 拒绝',
    });
  }
  return renderClaudeDecision(decide(out.event));
}