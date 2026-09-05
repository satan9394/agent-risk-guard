/**
 * acs/result.ts — RiskGuard Decision → ACS Result（v0.2.0 §十~§十五，v0.2.1 §十三~§二十一）
 *
 * 映射表（首版）：
 *   RiskGuard allow            → ACS allow
 *   RiskGuard deny             → ACS deny（保留 reasoning / ruleId）
 *   RiskGuard deny + safeAlt   → 仅当 arguments 能安全表达 operation/path/mode 时
 *                                → ACS modify（官方 parameter_overrides 结构，§十八/§十九）
 *                                否则 → ACS deny（§二十：安全优先，不伪造 modify）
 *   RiskGuard ask              → ACS ask（官方 ask_details，§二十二）
 *   defer                      → 仅协议支持（类型 + 校验），默认映射不产生 defer（§二十三）
 *
 * v0.2.1 官方必填（§十三/§十四/§十五）：
 *   type = "final" / acs_version = "0.1.0" / request_id = 请求回显（或 gateway 生成 UUID）
 *   request_id 是官方顶层字段，禁止塞进 extensions。
 *
 * reasoning 约束（§十五）：必须含 rule ID / risk category / operation / reason；
 * 禁止输出 blocked / dangerous / denied 这类无意义文本。
 */

import { randomUUID } from 'node:crypto';
import type { Decision } from '../../core/src/decision.ts';
import { ACS_SPEC_VERSION } from './version.ts';
import type { AcsResult, AcsModifications, RiskGuardExtensions } from './types.ts';

export interface AcsResultMappingOpts {
  /** 被评估的 capability（reasoning 引用） */
  capability?: string;
  /** 被评估的操作（reasoning 引用，如 filesystem.delete / shell.execute） */
  operation?: string;
  /** RiskGuard profile（extensions.profile） */
  profile?: string;
  /** verificationMode（extensions.verification） */
  verification?: 'dynamic' | 'static' | 'none';
  /** 官方必填 request_id（wire 模式回显 params.request_id；payload 模式由 gateway 生成） */
  requestId?: string;
  /** unwrap 后的 arguments 普通值（§十九：判断能否安全表达 trash 改写） */
  argumentValues?: Record<string, unknown>;
}

/** 生成合法 UUID（§十一：不伪造 UUID 语义；gateway 在 payload 模式无 request_id 时使用） */
export function newAcsRequestId(): string {
  return randomUUID();
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
    acsVersion: ACS_SPEC_VERSION,
  };
  if (decision.monotonic) ext.monotonic = true;
  if (opts.profile) ext.profile = opts.profile;
  if (opts.verification) ext.verification = opts.verification;
  return ext;
}

/**
 * §二十：无法安全表达 modify 时的固定说明。
 * 必须原样出现，供测试锁定“不伪造 modify”行为。
 */
export const UNREPRESENTABLE_MODIFY_REASON =
  'Safe replacement is available conceptually but cannot be represented safely in this ACS payload.';

/** 官方必填字段骨架（§十三/§十四/§十五） */
function officialResultBase(opts: AcsResultMappingOpts): Pick<AcsResult, 'type' | 'acs_version' | 'request_id'> {
  return {
    type: 'final',
    acs_version: ACS_SPEC_VERSION,
    request_id: opts.requestId ?? newAcsRequestId(),
  };
}

/**
 * §十九：尝试把 trash 改写表达为官方 parameter_overrides。
 * 仅当原 ToolCallRequest arguments 能明确表达 operation / path / mode 语义时才可能成功；
 * 否则返回 null（调用方必须 deny，§二十）。
 *
 * 注意：parameter_overrides 的值保持官方 arguments 的 value-wrapper 形状
 * （{ value: ... }），这样应用改写后的请求仍能通过官方 tool-call-request.json。
 */
function tryTrashModification(argumentValues: Record<string, unknown> | undefined): AcsModifications | null {
  if (!argumentValues || typeof argumentValues !== 'object') return null;
  const overrides: Record<string, unknown> = {};
  for (const key of ['operation', 'action', 'method']) {
    const v = argumentValues[key];
    if (typeof v === 'string' && /^(delete|remove|rm|erase|unlink|del|purge)$/i.test(v.trim())) {
      overrides[key] = { value: 'trash' };
    }
  }
  for (const key of ['mode']) {
    const v = argumentValues[key];
    if (typeof v === 'string' && /^(permanent|hard|force|overwrite)$/i.test(v.trim())) {
      overrides[key] = { value: 'recycle' };
    }
  }
  return Object.keys(overrides).length > 0 ? { parameter_overrides: overrides } : null;
}

/**
 * RiskGuard Decision → ACS Result（默认映射）。
 * 注意：defer 只在自定义映射中产生；本函数永不主动输出 defer（§二十三）。
 */
export function riskDecisionToAcsResult(decision: Decision, opts: AcsResultMappingOpts = {}): AcsResult {
  const base = officialResultBase(opts);
  const extensions: AcsResult['extensions'] = { riskguard: buildRiskGuardExtensions(decision, opts) };
  const metadata = { evaluator: 'deterministic' as const };
  const domain = ruleDomain(decision.ruleId);

  switch (decision.decision) {
    case 'allow':
      return { ...base, decision: 'allow', reasoning: buildAcsReasoning(decision, opts), metadata, extensions };
    case 'deny': {
      if (decision.safeAlternative) {
        // §十八/§十九：safeAlternative → modify（官方 parameter_overrides），仅当能安全表达
        const modifications = tryTrashModification(opts.argumentValues);
        if (modifications) {
          return {
            ...base,
            decision: 'modify',
            reasoning: buildAcsReasoning(decision, opts),
            reason_codes: [`riskguard.${domain}.modify-proposal`],
            policy_references: [{ policy_id: 'riskguard-default', rule_id: decision.ruleId }],
            modifications,
            metadata,
            extensions,
          };
        }
        // §二十：无法精确、安全表达 → 不伪造 modify → deny
        return {
          ...base,
          decision: 'deny',
          reasoning: `${buildAcsReasoning(decision, opts)} ${UNREPRESENTABLE_MODIFY_REASON}`,
          reason_codes: [`riskguard.${domain}.deny`, `riskguard.${domain}.modify-unrepresentable`],
          policy_references: [{ policy_id: 'riskguard-default', rule_id: decision.ruleId }],
          metadata,
          extensions,
        };
      }
      return {
        ...base,
        decision: 'deny',
        reasoning: buildAcsReasoning(decision, opts),
        reason_codes: [`riskguard.${domain}.deny`],
        policy_references: [{ policy_id: 'riskguard-default', rule_id: decision.ruleId }],
        metadata,
        extensions,
      };
    }
    case 'ask':
      // §二十二：官方 ask-details.json 必填 approver / question / timeout_seconds
      return {
        ...base,
        decision: 'ask',
        reasoning: buildAcsReasoning(decision, opts),
        reason_codes: [`riskguard.${domain}.ask`],
        policy_references: [{ policy_id: 'riskguard-default', rule_id: decision.ruleId }],
        ask_details: {
          approver: { type: 'human', id: 'operator' },
          question: decision.reason ?? 'Confirm this operation',
          timeout_seconds: 30,
          options: ['allow', 'deny'],
          timeout_disposition: 'deny',
        },
        metadata,
        extensions,
      };
  }
}

/** fail-closed 结果（§十八：非法 ACS 输入 → deny + degraded=true，不抛 stack trace） */
export function failClosedAcsResult(reason: string, opts: AcsResultMappingOpts = {}): AcsResult {
  return {
    ...officialResultBase(opts),
    decision: 'deny',
    reasoning: `Invalid ACS ToolCallRequest: ${reason}`,
    reason_codes: ['riskguard.input.invalid'],
    policy_references: [{ policy_id: 'riskguard-default', rule_id: 'RG-ACS-INVALID-001' }],
    metadata: { evaluator: 'deterministic' },
    extensions: {
      riskguard: {
        ruleId: 'RG-ACS-INVALID-001',
        degraded: true,
        acsVersion: ACS_SPEC_VERSION,
        ...(opts.profile ? { profile: opts.profile } : {}),
        ...(opts.verification ? { verification: opts.verification } : {}),
      },
    },
  };
}

/**
 * 安全映射失败结果（§三十九/§三十二：valid ACS request 但 unknown operation /
 * ambiguous capability → ACS deny + degraded=true）。
 * 与协议错误（JSON-RPC error）严格区分（§四十）：这是 policy 层的 deny，不是协议错误。
 */
export function securityMappingDenyResult(reason: string, opts: AcsResultMappingOpts = {}): AcsResult {
  return {
    ...officialResultBase(opts),
    decision: 'deny',
    reasoning: `Security mapping failed: ${reason}`,
    reason_codes: ['riskguard.mapping.failed'],
    policy_references: [{ policy_id: 'riskguard-default', rule_id: 'RG-ACS-MAP-001' }],
    metadata: { evaluator: 'deterministic' },
    extensions: {
      riskguard: {
        ruleId: 'RG-ACS-MAP-001',
        degraded: true,
        acsVersion: ACS_SPEC_VERSION,
        ...(opts.profile ? { profile: opts.profile } : {}),
        ...(opts.verification ? { verification: opts.verification } : {}),
      },
    },
  };
}
