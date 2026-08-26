/**
 * event.ts — RiskEvent v1 统一中间表示（文档 §7）
 *
 * RiskGuard Core 不允许直接理解具体 Agent（Claude Code / Cursor / Codex...），
 * 那些属于 Adapter 层。Core 只接收统一事件。
 */

import type { Action, Domain, RiskLevel } from './risk-taxonomy.ts';

/** 事件来源：哪个 Agent、什么 surface */
export interface EventSource {
  agent: string;
  agentVersion?: string;
  surface: string; // preToolUse / pre-execute / tool.execute.before / tool_call ...
  tool?: string;
  toolCallId?: string;
}

/** 被操作对象 */
export interface EventTarget {
  kind: 'path' | 'uri' | 'process' | 'credential' | 'guard-config' | 'unknown';
  raw?: string | null;
  canonical?: string | null;
  scope?: 'workspace' | 'project' | 'home' | 'system' | 'unknown';
  tags?: string[];
}

/** 原始命令（若来自 shell） */
export interface CommandInfo {
  raw?: string | null;
  shell?: string | null;
  argv?: string[] | null;
  parseConfidence?: number; // 0..1
}

/** 执行上下文 */
export interface EventContext {
  cwd?: string;
  interactive?: boolean;
  sandbox?: string; // workspace-write / read-only / none ...
  env?: Record<string, string>;
}

/** 统一风险事件 */
export interface RiskEvent {
  schemaVersion: string;
  source: EventSource;
  operation: {
    domain: Domain;
    action: Action;
    destructive: boolean;
    reversible: boolean;
  };
  targets: EventTarget[];
  command?: CommandInfo;
  context?: EventContext;
}

/** 事件构造辅助 */
export function createEvent(partial: Omit<RiskEvent, 'schemaVersion'>): RiskEvent {
  return { schemaVersion: '1.0', ...partial };
}