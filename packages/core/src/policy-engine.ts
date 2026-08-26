/**
 * policy-engine.ts — 纯函数策略引擎（文档 §15）
 *
 * Policy Engine 是纯函数核心：evaluate(event, policy) → Decision。
 * 无文件系统副作用、无网络、无子进程、无 Agent SDK 依赖。
 *
 * Policy 结构（对应文档 §15 示例的简化内存表达）：
 *   {
 *     version: 1,
 *     defaults: { read: 'allow', reversible_workspace_write: 'allow', irreversible: 'deny', unknown_mutation: 'deny' },
 *     rules: [ { id, match: {domain, action[], targetTags[], pathScope, protected?}, decision, safeAlternative? } ]
 *   }
 */

import type { RiskEvent } from './event.ts';
import type { Decision } from './decision.ts';
import { allow, deny, monotonicDeny, ask, combineDecisions, failClosed } from './decision.ts';
import type { Action, Domain, RiskLevel } from './risk-taxonomy.ts';

export interface PolicyRule {
  id: string;
  match: {
    domain?: Domain | Domain[];
    action?: Action | Action[];
    targetTags?: string[];       // 任一命中即匹配
    pathScope?: 'workspace' | 'system' | 'any';
    protected?: boolean;         // 命中受保护资源（Guard 自保护）
    reversible?: boolean;        // 匹配事件的 reversible 标志
  };
  decision: 'allow' | 'deny' | 'ask';
  monotonic?: boolean;           // 文档 RG-I03：guard 级不变量，不可被后续覆盖
  risk?: RiskLevel;
  reason?: string;
  safeAlternative?: { operation: string; description?: string };
}

export interface Policy {
  version: number;
  defaults: {
    read: 'allow';
    reversibleWorkspaceWrite: 'allow' | 'deny';
    irreversible: 'deny';
    unknownMutation: 'deny' | 'ask';
  };
  rules: PolicyRule[];
}

/** 单条规则匹配：返回 null 表示未命中 */
function matchRule(rule: PolicyRule, event: RiskEvent): boolean {
  const { domain, action, targetTags, pathScope, protected: isProtected, reversible } = rule.match;

  if (domain) {
    const domains = Array.isArray(domain) ? domain : [domain];
    if (!domains.includes(event.operation.domain)) return false;
  }
  if (action) {
    const actions = Array.isArray(action) ? action : [action];
    if (!actions.includes(event.operation.action)) return false;
  }
  if (reversible !== undefined && event.operation.reversible !== reversible) return false;

  if (targetTags && targetTags.length > 0) {
    const allTags = new Set<string>();
    for (const t of event.targets) for (const tag of t.tags ?? []) allTags.add(tag);
    if (!targetTags.some((tag) => allTags.has(tag))) return false;
  }

  if (pathScope && pathScope !== 'any') {
    const anyTarget = event.targets.length > 0;
    if (!anyTarget) return false;
    if (pathScope === 'workspace') {
      if (!event.targets.every((t) => !t.scope || t.scope === 'workspace')) return false;
    } else if (pathScope === 'system') {
      if (!event.targets.some((t) => t.scope === 'system')) return false;
    }
  }

  void isProtected; // protected 判定由 Protected Resources 助手完成（见 rules/default-policy.ts）
  return true;
}

/**
 * 纯函数评估：输入事件 + 策略，输出决策。
 * 规则按声明顺序评估，第一条命中即返回（deny 优先由 rules 顺序保证）。
 * monotonic deny 标记不可被覆盖。
 */
export function evaluate(event: RiskEvent, policy: Policy): Decision {
  for (const rule of policy.rules) {
    if (!matchRule(rule, event)) continue;
    switch (rule.decision) {
      case 'deny':
        return rule.monotonic
          ? monotonicDeny(rule.id, rule.reason ?? 'denied by rule', rule.safeAlternative)
          : deny(rule.id, rule.reason ?? 'denied by rule', rule.safeAlternative, rule.risk ?? 'critical');
      case 'ask':
        return ask(rule.id, rule.reason ?? 'requires confirmation');
      case 'allow':
        return allow(rule.id, rule.reason);
    }
  }

  // 无规则命中 → 走 defaults（P1-6 修复：defaults 不再是死代码）
  const d = policy.defaults;
  if (event.operation.action === 'read') {
    return d.read === 'deny' ? deny('default', 'read denied by defaults') : allow('default', 'read allowed');
  }
  if (event.operation.destructive) {
    // destructive（不可逆）：irreversible 默认 deny
    return d.irreversible === 'allow'
      ? allow('default', 'irreversible allowed by defaults')
      : deny('default', 'irreversible operation denied by defaults', undefined, 'critical');
  }
  // 可逆 mutation：reversibleWorkspaceWrite 默认 allow，unknown 默认跟随（未知写保守 deny）
  if (d.unknownMutation === 'deny' && !event.operation.reversible) {
    return deny('default', 'unknown mutation denied by defaults');
  }
  return d.reversibleWorkspaceWrite === 'deny'
    ? deny('default', 'reversible write denied by defaults')
    : allow('default', 'reversible operation allowed');
}

/** 组合多个 policy（如 defaults + 用户 policy + guard invariants） */
export function evaluateAll(events: RiskEvent[], policies: Policy[]): Decision {
  let acc: Decision = { decision: 'allow' };
  for (const event of events) {
    for (const policy of policies) {
      acc = combineDecisions(acc, evaluate(event, policy));
    }
  }
  return acc;
}

/** 解析失败兜底（RG-I04 禁止 Fail Open） */
export function parseFailureDecision(reason: string): Decision {
  return failClosed('RG-PARSE-000', `critical mutation parse failure: ${reason}`);
}