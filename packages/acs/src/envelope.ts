/**
 * acs/envelope.ts — ACS JSON-RPC Request / Response Envelope（v0.2.1 §七/§十/§十二/§三十八/§四十一）
 *
 * 官方传输结构（§七）：
 *   JSON-RPC Request Envelope → params → metadata → payload
 *
 * 本模块只做 envelope 层的 shape 校验与构造（Layer 1，fail-closed 方向）；
 * 最终 conformance 判据是官方 request-envelope.json / response-envelope.json
 * （tests/acs-schema-conformance）。
 *
 * 错误语义（§三十九/§四十/§四十一）：
 *   invalid JSON               → -32700 Parse error（id = null）
 *   invalid envelope 结构      → -32600 Invalid Request（id 尽力回显）
 *   params 必填缺失/类型错误   → -32602 Invalid params（id 回显）
 *   payload 形状非法           → -32602 Invalid params（payload 属 params 一部分）
 *   payload 合法但安全映射失败 → ACS deny + degraded=true（result envelope，非协议错误）
 */

import type { AcsRequestEnvelope, AcsRequestParams, AcsResponseEnvelope, AcsResult } from './types.ts';
import { ACS_JSONRPC_CODES } from './types.ts';

export interface EnvelopeValidationOk {
  ok: true;
  envelope: AcsRequestEnvelope;
}

export interface EnvelopeValidationFail {
  ok: false;
  /** request = envelope 层（-32600）；params = params 层（-32602） */
  kind: 'request' | 'params';
  reason: string;
}

export type EnvelopeValidationOutcome = EnvelopeValidationOk | EnvelopeValidationFail;

const METHOD_RE = /^(steps\/|protocols\/|agbom\/|trace\/|system\/|handshake\/|wrapped:).+/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isValidDateString(v: unknown): boolean {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v));
}

/** Layer 1：校验已解析的 Request Envelope（镜像官方 request-envelope.json 必填集） */
export function validateAcsRequestEnvelope(input: unknown): EnvelopeValidationOutcome {
  if (!isPlainObject(input)) {
    return { ok: false, kind: 'request', reason: 'envelope must be a JSON object' };
  }
  const env = input as Record<string, unknown>;

  if (env['jsonrpc'] !== '2.0') {
    return { ok: false, kind: 'request', reason: 'jsonrpc must be "2.0"' };
  }
  if (typeof env['method'] !== 'string' || !METHOD_RE.test(env['method'])) {
    return { ok: false, kind: 'request', reason: 'method must match steps/|protocols/|agbom/|trace/|system/|handshake/|wrapped: namespace' };
  }
  const id = env['id'];
  if (typeof id !== 'string' && typeof id !== 'number') {
    return { ok: false, kind: 'request', reason: 'id must be a string or number' };
  }
  if (!isPlainObject(env['params'])) {
    return { ok: false, kind: 'request', reason: 'params is required' };
  }

  const p = env['params'] as Record<string, unknown>;
  if (typeof p['acs_version'] !== 'string' || !SEMVER_RE.test(p['acs_version'])) {
    return { ok: false, kind: 'params', reason: `params.acs_version must be full semver (e.g. 0.1.0), got: ${String(p['acs_version'])}` };
  }
  if (typeof p['request_id'] !== 'string' || !UUID_RE.test(p['request_id'])) {
    return { ok: false, kind: 'params', reason: `params.request_id must be a valid UUID, got: ${String(p['request_id'])}` };
  }
  if (!isValidDateString(p['timestamp'])) {
    return { ok: false, kind: 'params', reason: 'params.timestamp must be an ISO 8601 date-time' };
  }
  const metadata = p['metadata'];
  if (!isPlainObject(metadata)) {
    return { ok: false, kind: 'params', reason: 'params.metadata is required' };
  }
  if (typeof metadata['agent_id'] !== 'string' || metadata['agent_id'].trim().length === 0) {
    return { ok: false, kind: 'params', reason: 'params.metadata.agent_id is required' };
  }
  if (typeof metadata['session_id'] !== 'string' || !UUID_RE.test(metadata['session_id'])) {
    return { ok: false, kind: 'params', reason: 'params.metadata.session_id must be a valid UUID' };
  }
  if (!isPlainObject(p['payload'])) {
    return { ok: false, kind: 'params', reason: 'params.payload is required' };
  }

  return { ok: true, envelope: input as AcsRequestEnvelope };
}

/** 解析 stdin/字符串 → envelope 校验（gateway 据此区分协议错误） */
export function parseAcsRequestEnvelope(raw: string): EnvelopeValidationOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, kind: 'request', reason: 'invalid JSON' };
  }
  return validateAcsRequestEnvelope(parsed);
}

/** 尽力回显 id（parse error / invalid request 场景；无法确定 → null） */
export function extractEnvelopeId(input: unknown): string | number | null {
  if (!isPlainObject(input)) return null;
  const id = input['id'];
  return typeof id === 'string' || typeof id === 'number' ? id : null;
}

/** 构造成功 Response Envelope（§十二/§三十八：id 回显 request.id） */
export function buildAcsResultEnvelope(id: string | number | null, result: AcsResult): AcsResponseEnvelope {
  return { jsonrpc: '2.0', id, result };
}

/** 构造 JSON-RPC Error Envelope（§四十一） */
export function buildAcsErrorEnvelope(id: string | number | null, code: number, message: string): AcsResponseEnvelope {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

export { ACS_JSONRPC_CODES };

/** 便捷：提取 params（供调用方取 request_id / metadata / payload） */
export function envelopeParams(env: AcsRequestEnvelope): AcsRequestParams {
  return env.params;
}
