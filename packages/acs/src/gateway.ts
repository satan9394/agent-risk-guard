/**
 * acs/gateway.ts — ACS Gateway 统一入口（v0.2.0 §十六）
 *
 * evaluateAcsToolCall(request) 内部固定管线：
 *   validate ACS input
 *     ↓
 *   ACS → RiskEvent
 *     ↓
 *   RiskGuard evaluate()
 *     ↓
 *   Decision
 *     ↓
 *   Decision → ACS Result
 *     ↓
 *   validate ACS result
 *
 * 任何一步失败 → fail-closed deny + degraded=true（§十八），绝不抛 stack trace。
 * CLI / hooks 一律走本 Gateway，禁止各自重复实现映射。
 */

import { evaluate, type Policy } from '../../core/src/policy-engine.ts';
import { defaultPolicy, strictPolicy } from '../../core/src/rules/default-policy.ts';
import type { Decision } from '../../core/src/decision.ts';
import { validateAcsToolCallRequest, parseAcsToolCallRequest } from './inbound.ts';
import { acsToolCallToRiskEvent } from './tool-call-request.ts';
import { riskDecisionToAcsResult, failClosedAcsResult } from './result.ts';
import { validateAcsResult } from './outbound.ts';
import { ACS_VERSION } from './version.ts';
import type { AcsResult } from './types.ts';
import type { RiskEvent } from '../../core/src/event.ts';

export interface AcsEvaluateOptions {
  policy?: Policy;
  profile?: 'autonomy-safe' | 'strict';
  /** extensions.riskguard.verification（默认 dynamic：真实链路自测） */
  verification?: 'dynamic' | 'static' | 'none';
  /** 自定义 Decision → ACS Result 映射（预留 defer / 多评估器扩展；默认映射永不产生 defer） */
  mapDecision?: (decision: Decision, event: RiskEvent | null) => AcsResult;
  /** 透传给自定义映射的附加上下文 */
  context?: Record<string, unknown>;
}

export interface AcsEvaluateResult {
  /** 合法输出（可能 allow/deny/modify/ask） */
  result: AcsResult;
  /** fail-closed 是否触发（非法输入 / 映射失败） */
  degraded: boolean;
  /** 命中 rule（extensions.riskguard.ruleId 快捷访问） */
  ruleId?: string;
  /** 映射过程中产生的 RiskEvent（调试/审计用） */
  event?: RiskEvent;
}

/**
 * 统一评估入口。request 可以是：
 *   - 已解析的 AcsToolCallRequest 对象
 *   - JSON 字符串（CLI stdin 场景）
 * 任何校验/映射/评估异常都被捕获 → fail-closed。
 */
export function evaluateAcsToolCall(request: unknown, opts: AcsEvaluateOptions = {}): AcsEvaluateResult {
  const profile = opts.profile ?? 'autonomy-safe';
  const verification = opts.verification ?? 'dynamic';

  // 1. validate ACS input（字符串先 parse）
  const parsed = typeof request === 'string' ? parseAcsToolCallRequest(request) : validateAcsToolCallRequest(request);
  if (!parsed.ok) {
    return { result: failClosedAcsResult(parsed.reason, { profile, verification }), degraded: true };
  }

  let event: RiskEvent | null = null;
  try {
    // 2. ACS → RiskEvent
    const mapped = acsToolCallToRiskEvent(parsed.request);
    if (!mapped.ok) {
      return { result: failClosedAcsResult(mapped.reason, { profile, verification }), degraded: true };
    }
    event = mapped.event;

    // 3. RiskGuard evaluate()
    const policy = opts.policy ?? (profile === 'strict' ? strictPolicy() : defaultPolicy());
    const decision = evaluate(mapped.event, policy);

    // 4. Decision → ACS Result
    const mapDecision = opts.mapDecision ?? riskDecisionToAcsResult;
    const result = mapDecision(
      decision,
      mapped.event
        ? {
            operation: `${mapped.event.operation.domain}.${mapped.event.operation.action}`,
            capability: mapped.meta.capability,
            profile,
            verification,
          }
        : { profile, verification },
    );
    if (opts.context) {
      result.extensions = {
        ...(result.extensions ?? {}),
        riskguard: { ...(result.extensions?.riskguard ?? {}), ...(opts.context as Record<string, unknown>) },
      };
    }

    // 5. validate ACS result
    const v = validateAcsResult(result);
    if (!v.ok) {
      return {
        result: failClosedAcsResult(`internal mapping error: ${v.problems.join('; ')}`, { profile, verification }),
        degraded: true,
        ruleId: decision.ruleId,
        event,
      };
    }

    return {
      result,
      degraded: result.extensions?.riskguard?.degraded === true,
      ruleId: result.extensions?.riskguard?.ruleId,
      event,
    };
  } catch (e) {
    // 不可预料的内部错误 → fail-closed（不泄露 stack trace）
    return {
      result: failClosedAcsResult(`internal error: ${(e as Error).message}`, { profile, verification }),
      degraded: true,
      event: event ?? undefined,
    };
  }
}

/** 版本信息（CLI / 文档用） */
export function acsGatewayInfo(): { acsVersion: string; profile: string; decisions: string[] } {
  return { acsVersion: ACS_VERSION, profile: 'experimental-0.1', decisions: ['allow', 'deny', 'modify', 'ask', 'defer'] };
}
