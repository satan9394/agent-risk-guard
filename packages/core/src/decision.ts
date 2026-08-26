/**
 * decision.ts — Decision v1（文档 §7 统一返回）
 *
 * Policy Engine 的纯函数输出。deny 时携带 rule_id 与安全替代方案。
 */

import type { RiskLevel } from './risk-taxonomy.ts';

export type DecisionKind = 'allow' | 'deny' | 'ask';

export interface SafeAlternative {
  operation: string; // 例如 'trash'
  description?: string;
}

export interface Decision {
  decision: DecisionKind;
  risk?: RiskLevel;
  ruleId?: string;       // 命中规则，如 'RG-FS-001'
  reason?: string;       // 人类可读原因
  safeAlternative?: SafeAlternative; // deny 时的建议
  /** 单调性来源：guard() 产生的 deny 不可被后续 allow 覆盖（文档 RG-I03） */
  monotonic?: boolean;
  degraded?: boolean;    // Critical Adapter Failure → 明确 Degraded 状态
}

// ---- 便捷构造 ----

export function allow(ruleId?: string, reason?: string): Decision {
  return { decision: 'allow', ruleId, reason };
}

export function deny(
  ruleId: string,
  reason: string,
  safeAlternative?: SafeAlternative,
  risk: RiskLevel = 'critical',
): Decision {
  return { decision: 'deny', ruleId, reason, safeAlternative, risk };
}

export function ask(ruleId: string, reason: string): Decision {
  return { decision: 'ask', ruleId, reason };
}

/**
 * 单调拒绝（文档 RG-I03）：guard() 产生，只能 deny 或 abstain，
 * 后续 listener 无法撤销。allow 与 deny 相遇 = deny。
 */
export function monotonicDeny(ruleId: string, reason: string, safeAlternative?: SafeAlternative): Decision {
  return { ...deny(ruleId, reason, safeAlternative), monotonic: true };
}

/** 组合：RG-I03 单调性 —— ALLOW + DENY = DENY，DENY 永远优先 */
export function combineDecisions(a: Decision, b: Decision): Decision {
  if (a.monotonic && a.decision === 'deny') return a;
  if (b.monotonic && b.decision === 'deny') return b;
  if (a.decision === 'deny') return a;
  if (b.decision === 'deny') return b;
  if (a.decision === 'ask' || b.decision === 'ask') return { decision: 'ask', ruleId: a.ruleId ?? b.ruleId };
  return b; // 全 allow，取后者（可含规则信息）
}

/** 决策失败兜底：RG-I04 禁止 Fail Open，Critical 解析失败 → DENY */
export function failClosed(ruleId: string, reason: string): Decision {
  return { ...deny(ruleId, reason), degraded: true };
}