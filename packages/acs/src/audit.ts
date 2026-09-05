/**
 * acs/audit.ts — SecurityAuditEvent（v0.2.0 §三十七/§三十八）
 *
 * 本轮只统一事件格式，只做 JSONL / structured log——
 * ❌ 不上数据库 / Elasticsearch / 云日志 / Dashboard。
 *
 * 隐私铁律（§三十八）：raw_command / arguments / credential path / token / secret
 * 一律经 core/redact.ts 脱敏后再序列化。ACS 对齐不能降低 RiskGuard 现有隐私保护。
 */

import { redactSecrets } from '../../core/src/redact.ts';
import type { Decision } from '../../core/src/decision.ts';
import type { RiskEvent } from '../../core/src/event.ts';
import { ACS_VERSION } from './version.ts';

export interface SecurityAuditEvent {
  timestamp: string;
  agent: string;
  tool?: string;
  capability?: string;
  decision: string;
  ruleId?: string;
  acsVersion: string;
  verificationMode?: 'dynamic' | 'static' | 'none';
  degraded?: boolean;
  /** 不记录 raw_command / arguments / 凭据路径（§三十八） */
}

/** 从评估上下文构造 SecurityAuditEvent（不含敏感参数） */
export function toSecurityAuditEvent(input: {
  agent?: string;
  tool?: string;
  capability?: string;
  decision: Decision | { decision: string; ruleId?: string; degraded?: boolean };
  verificationMode?: 'dynamic' | 'static' | 'none';
}): SecurityAuditEvent {
  const dec = input.decision;
  return {
    timestamp: new Date().toISOString(),
    agent: input.agent ?? 'unknown',
    tool: input.tool,
    capability: input.capability,
    decision: dec.decision,
    ruleId: dec.ruleId,
    acsVersion: ACS_VERSION,
    verificationMode: input.verificationMode,
    degraded: 'degraded' in dec ? dec.degraded : undefined,
  };
}

/** JSONL 序列化（出口统一脱敏，Local First） */
export function securityAuditToJson(event: SecurityAuditEvent): string {
  return redactSecrets(JSON.stringify(event));
}

/** 便捷：直接生成并序列化为一行 JSONL */
export function securityAuditLine(input: Parameters<typeof toSecurityAuditEvent>[0]): string {
  return securityAuditToJson(toSecurityAuditEvent(input));
}

/** RiskEvent → audit 行（供 gateway/CLI 记录） */
export function auditLineFromEvent(event: RiskEvent | null, decision: Decision | { decision: string; ruleId?: string; degraded?: boolean }, verificationMode?: 'dynamic' | 'static' | 'none'): string {
  return securityAuditLine({
    agent: event?.source.agent ?? 'acs',
    tool: event?.source.tool,
    capability: event ? `${event.operation.domain}.${event.operation.action}` : undefined,
    decision,
    verificationMode,
  });
}
