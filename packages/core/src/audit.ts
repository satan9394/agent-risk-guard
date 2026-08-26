/**
 * audit.ts — Audit 数据模型（文档 §21）
 *
 * 每次决策记录。原则：不记录完整敏感文件、不默认上传云端、Local First。
 */

import type { RiskEvent } from './event.ts';
import type { Decision } from './decision.ts';

export interface AuditRecord {
  timestamp: string;
  agent: string;
  agentVersion?: string;
  tool?: string;
  operation: string;          // 例如 filesystem.delete
  target?: string;            // canonical 路径
  risk?: string;
  decision: string;
  rule?: string;
  adapterVersion?: string;
  policyVersion?: string;
}

export function toAuditRecord(event: RiskEvent, decision: Decision): AuditRecord {
  return {
    timestamp: new Date().toISOString(),
    agent: event.source.agent,
    agentVersion: event.source.agentVersion,
    tool: event.source.tool,
    operation: `${event.operation.domain}.${event.operation.action}`,
    target: event.targets[0]?.canonical ?? event.targets[0]?.raw ?? undefined,
    risk: decision.risk,
    decision: decision.decision,
    rule: decision.ruleId,
  };
}

/** 审计记录序列化（Local First，不含敏感原文） */
export function auditToJson(record: AuditRecord): string {
  return JSON.stringify(record);
}