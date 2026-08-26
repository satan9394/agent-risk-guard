/**
 * @riskguard/adapter-windsurf — Windsurf Cascade Hooks Adapter（M3，D1 文档确认）
 *
 * events：pre_read_code / pre_write_code / pre_run_command / pre_mcp_tool_use
 * 阻断约定（文档 §10.8）：pre-hook 返回 exit 2 即阻断（stderr 纯文本，非 JSON）。
 * 覆盖：pre_run_command（命令拦截）+ pre_write_code + pre_mcp_tool_use。
 */

import type { RiskEvent } from '../../../core/src/event.ts';
import type { Decision } from '../../../core/src/decision.ts';
import { normalizeEvent, classifyShellCommand, isReadOnlyCommand } from '../../../core/src/normalize.ts';
import type { NormalizeOutcome } from '../../../core/src/normalize.ts';

export interface WindsurfPayload {
  hookEventName?: string;           // pre_run_command / pre_write_code / pre_mcp_tool_use
  command?: string;
  file_path?: string;
  filePath?: string;
  cwd?: string;
  workspace_root?: string;
  mcp?: { server?: string; tool?: string; args?: Record<string, unknown> };
}

export function parseWindsurfPayload(payload: WindsurfPayload, home?: string): NormalizeOutcome {
  const event = payload.hookEventName ?? 'pre_run_command';
  const cwd = payload.cwd ?? payload.workspace_root;

  if (event === 'pre_run_command') {
    if (typeof payload.command !== 'string' || payload.command.trim().length === 0) {
      return { ok: false, reason: 'invalid/empty command in windsurf pre_run_command', raw: payload };
    }
    const classified = classifyShellCommand(payload.command);
    if (classified) {
      return normalizeEvent({
        agent: 'windsurf', surface: event, tool: 'Shell',
        domain: classified.domain, action: classified.action, destructive: classified.destructive,
        commandRaw: payload.command, cwd, home, workspaceRoot: cwd,
      });
    }
    if (isReadOnlyCommand(payload.command)) {
      return normalizeEvent({
        agent: 'windsurf', surface: event, tool: 'Shell',
        domain: 'filesystem', action: 'read', commandRaw: payload.command, cwd, home, workspaceRoot: cwd,
      });
    }
    return normalizeEvent({
      agent: 'windsurf', surface: event, tool: 'Shell',
      domain: 'process', action: 'execute', commandRaw: payload.command, cwd, home, workspaceRoot: cwd,
    });
  }

  const path = payload.file_path ?? payload.filePath;
  if (path) {
    // P1-34 修复：pre_read_code → read（读操作不应标 write）；pre_write_code → write
    const action = event === 'pre_read_code' ? 'read' : 'write';
    return normalizeEvent({
      agent: 'windsurf', surface: event, tool: event === 'pre_read_code' ? 'Read' : 'Write',
      domain: 'filesystem', action, targetsRaw: [path], cwd, home, workspaceRoot: cwd,
    });
  }

  if (event === 'pre_mcp_tool_use') {
    return normalizeEvent({
      agent: 'windsurf', surface: event, tool: payload.mcp?.tool ?? 'MCP',
      domain: 'network', action: 'network_connect', cwd, home, workspaceRoot: cwd,
    });
  }

  return { ok: false, reason: `unhandled windsurf event: ${event}` };
}

/** decision → exit code（Windsurf 约定：2 = 阻断）与 stderr 文本 */
export function renderWindsurfDecision(decision: Decision): { exitCode: number; stderr: string } {
  if (decision.decision === 'deny') {
    return { exitCode: 2, stderr: `RiskGuard: ${decision.reason ?? 'denied'}` };
  }
  return { exitCode: 0, stderr: '' };
}

export function evaluateWindsurf(payload: WindsurfPayload, decide: (e: RiskEvent) => Decision): { exitCode: number; stderr: string } {
  const out = parseWindsurfPayload(payload);
  if (!out.ok) {
    return { exitCode: 2, stderr: 'RiskGuard: payload 解析失败 (fail-closed)' };
  }
  return renderWindsurfDecision(decide(out.event));
}