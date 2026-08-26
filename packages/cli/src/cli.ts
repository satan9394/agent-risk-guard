/**
 * cli.ts — RiskGuard CLI runtime（文档 §14）
 *
 * stdin JSON → riskguard → stdout JSON
 * 供 Claude / Cursor / Windsurf / Grok 等 command hook 使用。
 *
 * 输入（两种形状）：
 *   A. 完整 RiskEvent（含 schemaVersion）
 *   B. 简化 vendor 形状：{ agent, surface, domain, action, targetsRaw?, commandRaw?, cwd?, workspaceRoot?, profile? }
 *
 * 输出：Decision JSON（含 ruleId / safeAlternative / audit 字段）
 */

import { evaluate, parseFailureDecision } from '../../core/src/policy-engine.ts';
import { defaultPolicy, strictPolicy } from '../../core/src/rules/default-policy.ts';
import { normalizeEvent, classifyShellCommand } from '../../core/src/normalize.ts';
import { toAuditRecord } from '../../core/src/audit.ts';
import type { RiskEvent } from '../../core/src/event.ts';
import type { Policy } from '../../core/src/policy-engine.ts';
import type { Domain, Action } from '../../core/src/risk-taxonomy.ts';

export interface CliInput {
  schemaVersion?: string;
  // 简化为归一化事件或 vendor 简化形状
  agent?: string;
  surface?: string;
  domain?: Domain;
  action?: Action;
  targetsRaw?: string[];
  commandRaw?: string | null;
  cwd?: string;
  workspaceRoot?: string;
  tool?: string;
  profile?: 'autonomy-safe' | 'strict';
  event?: RiskEvent;
}

export function selectPolicy(profile: 'autonomy-safe' | 'strict' | undefined): Policy {
  return profile === 'strict' ? strictPolicy() : defaultPolicy();
}

export function evaluateInput(input: CliInput): { decision: ReturnType<typeof evaluate>; audit: ReturnType<typeof toAuditRecord> } {
  let event: RiskEvent;

  if (input.event) {
    event = input.event;
  } else {
    // 支持纯命令字符串输入时自动分类
    let { domain, action } = input;
    let destructiveOverride: boolean | undefined;
    if ((!domain || !action) && input.commandRaw) {
      const classified = classifyShellCommand(input.commandRaw);
      if (classified) {
        domain = domain ?? classified.domain;
        action = action ?? classified.action;
        destructiveOverride = classified.destructive;
      }
    }
    const out = normalizeEvent({
      agent: input.agent ?? 'unknown',
      surface: input.surface ?? 'cli',
      domain: domain ?? 'filesystem',
      action: action ?? 'write',
      destructive: destructiveOverride,
      commandRaw: input.commandRaw,
      targetsRaw: input.targetsRaw,
      cwd: input.cwd,
      workspaceRoot: input.workspaceRoot,
      tool: input.tool,
    });
    if (!out.ok) {
      const dec = parseFailureDecision(out.reason);
      return { decision: dec, audit: { timestamp: new Date().toISOString(), agent: 'unknown', operation: 'parse.error', decision: 'deny', rule: dec.ruleId } };
    }
    event = out.event;
  }

  const policy = selectPolicy(input.profile);
  const decision = evaluate(event, policy);
  const audit = toAuditRecord(event, decision);
  return { decision, audit };
}

// ---- 直接可执行入口（被 cli-index.ts 包装为 bin） ----
export function run(input: CliInput): string {
  const { decision, audit } = evaluateInput(input);
  return JSON.stringify({ ...decision, audit }, null, 2);
}