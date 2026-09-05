/**
 * acs/gateway.ts — ACS Gateway 统一入口（v0.2.0 §十六，v0.2.1 §八/§九/§三十七/§三十八/§三十九/§四十）
 *
 * 两种输入模式（§八）：
 *   Mode A — Payload Only：evaluateAcsToolCall(request)
 *            内部 adapter / 测试 / developer tooling 使用；fail-closed deny 保留（§四十）
 *   Mode B — Official Envelope：evaluateAcsEnvelope(envelope)
 *            official ACS v0.1.0 wire mode；Request Envelope → Response Envelope
 *            是唯一官方 conformance 对象（§九）
 *
 * 内部固定管线（payload）：
 *   validate ACS input → ACS → RiskEvent → RiskGuard evaluate() → Decision
 *     → Decision → ACS Result → validate ACS result
 * 任何一步失败 → fail-closed deny + degraded=true（§十八），绝不抛 stack trace。
 *
 * wire 模式错误语义（§三十九/§四十/§四十一）：
 *   invalid JSON / invalid envelope → JSON-RPC error（-32700 / -32600 / -32602）
 *   valid request 但安全映射失败 → ACS deny + degraded=true（policy 层，非协议错误）
 *
 * CLI / hooks 一律走本 Gateway，禁止各自重复实现映射。
 */

import { evaluate, type Policy } from '../../core/src/policy-engine.ts';
import { defaultPolicy, strictPolicy } from '../../core/src/rules/default-policy.ts';
import type { Decision } from '../../core/src/decision.ts';
import { validateAcsToolCallRequest, parseAcsToolCallRequest } from './inbound.ts';
import { acsToolCallToRiskEvent } from './tool-call-request.ts';
import { unwrapAcsArgumentValues } from './arguments.ts';
import {
  validateAcsRequestEnvelope,
  parseAcsRequestEnvelope,
  extractEnvelopeId,
  buildAcsResultEnvelope,
  buildAcsErrorEnvelope,
  ACS_JSONRPC_CODES,
} from './envelope.ts';
import { riskDecisionToAcsResult, failClosedAcsResult, securityMappingDenyResult, newAcsRequestId } from './result.ts';
import { validateAcsResult } from './outbound.ts';
import { ACS_SPEC_VERSION, ACS_PROFILE } from './version.ts';
import type { AcsResult, AcsRequestEnvelope, AcsResponseEnvelope, AcsRequestMetadata } from './types.ts';
import type { AcsResultMappingOpts } from './result.ts';
import type { RiskEvent } from '../../core/src/event.ts';

export interface AcsEvaluateOptions {
  policy?: Policy;
  profile?: 'autonomy-safe' | 'strict';
  /** extensions.riskguard.verification（默认 dynamic：真实链路自测） */
  verification?: 'dynamic' | 'static' | 'none';
  /**
   * 自定义 Decision → ACS Result 映射（预留 defer / 多评估器扩展；默认映射永不产生 defer）。
   * 第二参数是映射 opts（含官方必填 requestId / unwrap 后的 argumentValues，§十九/§二十三）。
   */
  mapDecision?: (decision: Decision, opts: AcsResultMappingOpts) => AcsResult;
  /** 透传给自定义映射的附加上下文 */
  context?: Record<string, unknown>;
  /** envelope 模式透传的 ACS metadata（§三十六；payload 模式忽略） */
  acsMetadata?: AcsRequestMetadata;
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

export interface AcsEnvelopeEvaluateResult {
  /** 官方 Response Envelope（result 或 error） */
  envelope: AcsResponseEnvelope;
  /** policy 层 degrade（协议错误不算 degraded；§四十） */
  degraded: boolean;
  ruleId?: string;
  event?: RiskEvent;
}

/** 公共：payload 模式的完整决策管线（wire 模式复用，§八 不重复实现） */
function runPipeline(payload: unknown, opts: AcsEvaluateOptions, requestId?: string): AcsEvaluateResult {
  const profile = opts.profile ?? 'autonomy-safe';
  const verification = opts.verification ?? 'dynamic';

  // 1. validate ACS input（字符串先 parse）
  const parsed = typeof payload === 'string' ? parseAcsToolCallRequest(payload) : validateAcsToolCallRequest(payload);
  if (!parsed.ok) {
    return { result: failClosedAcsResult(parsed.reason, { profile, verification, requestId }), degraded: true };
  }

  let event: RiskEvent | null = null;
  try {
    // 2. ACS → RiskEvent（§三十六：envelope metadata → context.metadata.acs）
    const mapped = acsToolCallToRiskEvent(parsed.request, { acsMetadata: opts.acsMetadata });
    if (!mapped.ok) {
      // §三十二：推导不确定 → fail-closed deny（payload 模式与 wire 模式同方向）
      return { result: securityMappingDenyResult(mapped.reason, { profile, verification, requestId }), degraded: true };
    }
    event = mapped.event;

    // 3. RiskGuard evaluate()
    const policy = opts.policy ?? (profile === 'strict' ? strictPolicy() : defaultPolicy());
    const decision = evaluate(mapped.event, policy);

    // 4. Decision → ACS Result（官方必填 type/acs_version/request_id 由映射层补齐）
    const mapDecision = opts.mapDecision ?? riskDecisionToAcsResult;
    const result = mapDecision(decision, {
      operation: `${mapped.event.operation.domain}.${mapped.event.operation.action}`,
      capability: mapped.meta.capability,
      profile,
      verification,
      requestId,
      argumentValues: unwrapAcsArgumentValues(parsed.request.arguments),
    });
    if (opts.context) {
      result.extensions = {
        ...(result.extensions ?? {}),
        riskguard: { ...(result.extensions?.riskguard ?? {}), ...(opts.context as Record<string, unknown>) },
      };
    }

    // 5. validate ACS result（Layer 1）
    const v = validateAcsResult(result);
    if (!v.ok) {
      return {
        result: failClosedAcsResult(`internal mapping error: ${v.problems.join('; ')}`, { profile, verification, requestId }),
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
      result: failClosedAcsResult(`internal error: ${(e as Error).message}`, { profile, verification, requestId }),
      degraded: true,
      event: event ?? undefined,
    };
  }
}

/**
 * Mode A — Payload Only（§八）。
 * request 可以是：已解析的 AcsToolCallRequest 对象 / JSON 字符串（CLI stdin 场景）。
 * payload 模式无官方 request_id 输入 → gateway 生成合法 UUID（§十一 不伪造语义）。
 */
export function evaluateAcsToolCall(request: unknown, opts: AcsEvaluateOptions = {}): AcsEvaluateResult {
  return runPipeline(request, opts, newAcsRequestId());
}

/**
 * Mode B — Official Envelope（§八/§九）。
 * input 可以是：已解析的 AcsRequestEnvelope 对象 / JSON 字符串（CLI --wire stdin 场景）。
 *
 * 错误语义（§三十九/§四十/§四十一）：
 *   - invalid JSON               → -32700 Parse error（id null）
 *   - invalid envelope 结构      → -32600 Invalid Request（id 尽力回显）
 *   - params / payload 非法      → -32602 Invalid params（id 回显）
 *   - 安全映射失败               → ACS deny + degraded=true（result envelope）
 * 成功/deny/modify/ask/defer 全部走 result envelope；result.request_id 回显
 * params.request_id（§三十七），response.id 回显 request.id（§三十八）。
 */
export function evaluateAcsEnvelope(input: unknown, opts: AcsEvaluateOptions = {}): AcsEnvelopeEvaluateResult {
  // 1. parse（-32700）
  let parsed: unknown;
  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input);
    } catch {
      return { envelope: buildAcsErrorEnvelope(null, ACS_JSONRPC_CODES.PARSE_ERROR, 'Parse error'), degraded: true };
    }
  } else {
    parsed = input;
  }

  // 2. envelope shape（-32600 / -32602）
  const v = validateAcsRequestEnvelope(parsed);
  if (!v.ok) {
    const id = extractEnvelopeId(parsed);
    const code = v.kind === 'params' ? ACS_JSONRPC_CODES.INVALID_PARAMS : ACS_JSONRPC_CODES.INVALID_REQUEST;
    return { envelope: buildAcsErrorEnvelope(id, code, v.reason), degraded: true };
  }
  const env: AcsRequestEnvelope = v.envelope;

  // 3. params.payload → ToolCallRequest（Layer 1；payload 属 params 一部分 → -32602）
  const pv = validateAcsToolCallRequest(env.params.payload);
  if (!pv.ok) {
    return {
      envelope: buildAcsErrorEnvelope(env.id, ACS_JSONRPC_CODES.INVALID_PARAMS, `invalid params.payload: ${pv.reason}`),
      degraded: true,
    };
  }

  // 4. 复用 payload 管线，注入官方 request_id + envelope metadata（§三十六）
  const out = runPipeline(pv.request, { ...opts, acsMetadata: env.params.metadata }, env.params.request_id);
  return {
    envelope: buildAcsResultEnvelope(env.id, out.result),
    degraded: out.degraded,
    ruleId: out.ruleId,
    event: out.event,
  };
}

/** 版本信息（CLI / 文档用；§三：spec version 0.1.0 与 profile 分离） */
export function acsGatewayInfo(): { acsVersion: string; profile: string; decisions: string[] } {
  return {
    acsVersion: ACS_SPEC_VERSION,
    profile: ACS_PROFILE,
    decisions: ['allow', 'deny', 'modify', 'ask', 'defer'],
  };
}
