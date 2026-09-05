/**
 * acs/result.ts — RiskGuard Decision → ACS Result（v0.2.0 §十/§十一/§十二/§十三/§十四/§十五）
 *
 * 映射表（首版）：
 *   RiskGuard allow            → ACS allow
 *   RiskGuard deny             → ACS deny（保留 reasoning / ruleId）
 *   RiskGuard deny + safeAlt   → ACS modify（Modification Proposal；不自动执行，§十二）
 *   RiskGuard ask              → ACS ask（§十三：非默认策略，仅 context insufficient / ambiguous）
 *   defer                      → 仅协议支持（类型 + 校验），默认映射不产生 defer（§十四）
 *
 * reasoning 约束（§十五）：必须含 rule ID / risk category / operation / reason；
 * 禁止输出 blocked / dangerous / denied 这类无意义文本。
 */

import type { Decision } from '../../core/src/decision.ts';
import { ACS_VERSION } from './version.ts';
import type { AcsResult, AcsModification, RiskGuardExtensions } from './types.ts';

export interface AcsResultMappingOpts {
  /** 被评估的 capability（reasoning 引用） */
  capability?: string;
  /** 被评估的操作（reasoning 引用，如 filesystem.delete / shell.execute） */
  operation?: string;
  /** RiskGuard profile（extensions.profile） */
  profile?: string;
  /** verificationMode（extensions.verification） */
  verification?: 'dynamic' | 'static' | 'none';
}

/** RG 规则前缀 → 风险域（reasoning / reason_codes 用） */
const RG_DOMAIN: Record<string, string> = {
  'RG-FS': 'filesystem',
  'RG-DISK': 'filesystem',
  'RG-GIT': 'git',
  'RG-PROC': 'process',
  'RG-NET': 'network',
  'RG-CRED': 'credentials',
  'RG-GUARD': 'guard',
  'RG-TRASH': 'filesystem',
  'RG-UNKNOWN': 'unknown',
  'RG-CLI': 'cli',
  'RG-PARSE': 'parse',
};

export function ruleDomain(ruleId: string | undefined): string {
  if (!ruleId) return 'policy';
  const prefix = ruleId.split('-').slice(0, 2).join('-');
  return RG_DOMAIN[prefix] ?? 'policy';
}

/** risk level → 人类可读 risk category 文本 */
function riskCategoryText(risk: Decision['risk']): string {
  switch (risk) {
    case 'critical': return 'critical irreversible operation';
    case 'high': return 'high-risk operation';
    case 'medium': return 'medium-risk ambiguous operation';
    case 'low': return 'low-risk operation';
    default: return 'policy decision';
  }
}

/**
 * 统一构建 ACS reasoning（§十五）：
 * 格式：`<ruleId> denied <risk category>: <operation> — <reason>`
 * 保证 rule ID + risk category + operation + reason 四项齐全。
 */
export function buildAcsReasoning(decision: Decision, opts: AcsResultMappingOpts = {}): string {
  const rule = decision.ruleId ?? 'default';
  const category = riskCategoryText(decision.risk);
  const operation = opts.operation ?? ruleDomain(rule);
  const reason = decision.reason?.trim() || 'blocked by RiskGuard policy';
  return `${rule} ${decision.decision} ${category}: ${operation} — ${reason}`;
}

/** 从 Decision 构造 extensions.riskguard（§十九） */
export function buildRiskGuardExtensions(decision: Decision, opts: AcsResultMappingOpts = {}): RiskGuardExtensions {
  const ext: RiskGuardExtensions = {
    ruleId: decision.ruleId,
    degraded: decision.degraded === true,
    acsVersion: ACS_VERSION,
  };
  if (decision.monotonic) ext.monotonic = true;
  if (opts.profile) ext.profile = opts.profile;
  if (opts.verification) ext.verification = opts.verification;
  return ext;
}

/** trash 改写提议（§十二：只提议不执行；由上游 Agent/runtime 决定是否执行） */
function trashModification(decision: Decision): AcsModification {
  const detail = decision.safeAlternative?.description ? ` — ${decision.safeAlternative.description}` : '';
  return {
    tool: 'filesystem',
    capability: 'filesystem.delete',
    operation: 'trash',
    description: `Proposed modification: replace permanent delete with ${decision.safeAlternative?.operation ?? 'trash'}${detail}. Not executed by RiskGuard; upstream decides.`,
  };
}

/**
 * RiskGuard Decision → ACS Result（默认映射）。
 * 注意：defer 只在自定义映射中产生；本函数永不主动输出 defer（§十四）。
 */
export function riskDecisionToAcsResult(decision: Decision, opts: AcsResultMappingOpts = {}): AcsResult {
  const extensions: AcsResult['extensions'] = { riskguard: buildRiskGuardExtensions(decision, opts) };
  const metadata = { evaluator: 'deterministic' as const };
  const domain = ruleDomain(decision.ruleId);

  switch (decision.decision) {
    case 'allow':
      return { decision: 'allow', reasoning: buildAcsReasoning(decision, opts), metadata, extensions };
    case 'deny': {
      if (decision.safeAlternative) {
        // §十二：safeAlternative → modify（Modification Proposal）
        return {
          decision: 'modify',
          reasoning: buildAcsReasoning(decision, opts),
          reason_codes: [`riskguard.${domain}.modify-proposal`],
          policy_references: [{ policy_id: 'riskguard-default', rule_id: decision.ruleId }],
          modifications: [trashModification(decision)],
          metadata,
          extensions,
        };
      }
      return {
        decision: 'deny',
        reasoning: buildAcsReasoning(decision, opts),
        reason_codes: [`riskguard.${domain}.deny`],
        policy_references: [{ policy_id: 'riskguard-default', rule_id: decision.ruleId }],
        metadata,
        extensions,
      };
    }
    case 'ask':
      return {
        decision: 'ask',
        reasoning: buildAcsReasoning(decision, opts),
        reason_codes: [`riskguard.${domain}.ask`],
        policy_references: [{ policy_id: 'riskguard-default', rule_id: decision.ruleId }],
        ask_details: {
          prompt: decision.reason ?? 'Confirm this operation',
          context: { ruleId: decision.ruleId },
        },
        metadata,
        extensions,
      };
  }
}

/** fail-closed 结果（§十八：非法 ACS 输入 → deny + degraded=true，不抛 stack trace） */
export function failClosedAcsResult(reason: string, opts: AcsResultMappingOpts = {}): AcsResult {
  return {
    decision: 'deny',
    reasoning: `Invalid ACS ToolCallRequest: ${reason}`,
    reason_codes: ['riskguard.input.invalid'],
    policy_references: [{ policy_id: 'riskguard-default', rule_id: 'RG-ACS-INVALID-001' }],
    metadata: { evaluator: 'deterministic' },
    extensions: {
      riskguard: {
        ruleId: 'RG-ACS-INVALID-001',
        degraded: true,
        acsVersion: ACS_VERSION,
        ...(opts.profile ? { profile: opts.profile } : {}),
        ...(opts.verification ? { verification: opts.verification } : {}),
      },
    },
  };
}
