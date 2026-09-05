/**
 * acs/inbound.ts — ACS ToolCallRequest 校验（v0.2.0 §十六/§十八）
 *
 * 非法 ACS 输入必须 fail-closed（不抛 stack trace，由 gateway 输出 deny + degraded）。
 * 本模块只做 shape 校验，不参与决策。
 */

import type { AcsToolCallRequest } from './types.ts';

export interface AcsValidationOk {
  ok: true;
  request: AcsToolCallRequest;
}

export interface AcsValidationFail {
  ok: false;
  reason: string;
}

export type AcsValidationOutcome = AcsValidationOk | AcsValidationFail;

/** 必填字段（ACS v0.1 ToolCallRequest 最小集：tool + capability） */
function requireString(v: unknown, name: string): string | null {
  if (typeof v === 'string' && v.trim().length > 0) return v;
  return null;
}

/**
 * 校验一个已解析的 ACS ToolCallRequest 形状。
 * 严格性说明：tool.name / capability 必填；raw_command 非字符串或 arguments 非对象 → 拒绝
 * （保持 fail-closed 方向）。
 */
export function validateAcsToolCallRequest(input: unknown): AcsValidationOutcome {
  if (input === null || typeof input !== 'object') {
    return { ok: false, reason: 'request must be a JSON object' };
  }
  const req = input as Record<string, unknown>;

  const tool = req['tool'];
  if (tool === null || typeof tool !== 'object') {
    return { ok: false, reason: 'missing required field: tool' };
  }
  const toolName = requireString((tool as Record<string, unknown>)['name'], 'tool.name');
  if (!toolName) {
    return { ok: false, reason: 'missing required field: tool.name' };
  }

  const capability = requireString(req['capability'], 'capability');
  if (!capability) {
    return { ok: false, reason: 'missing required field: capability' };
  }

  if (req['arguments'] !== undefined && (req['arguments'] === null || typeof req['arguments'] !== 'object' || Array.isArray(req['arguments']))) {
    return { ok: false, reason: 'arguments must be an object' };
  }
  if (req['raw_command'] !== undefined && req['raw_command'] !== null && typeof req['raw_command'] !== 'string') {
    return { ok: false, reason: 'raw_command must be a string' };
  }
  if (req['intent'] !== undefined && (req['intent'] === null || typeof req['intent'] !== 'object')) {
    return { ok: false, reason: 'intent must be an object' };
  }
  if (req['provenance'] !== undefined && !Array.isArray(req['provenance'])) {
    return { ok: false, reason: 'provenance must be an array' };
  }
  if (req['environment'] !== undefined && (req['environment'] === null || typeof req['environment'] !== 'object')) {
    return { ok: false, reason: 'environment must be an object' };
  }

  return { ok: true, request: input as AcsToolCallRequest };
}

/** 解析 stdin/字符串 → 校验；任何失败返回 fail（gateway 据此 fail-closed） */
export function parseAcsToolCallRequest(raw: string): AcsValidationOutcome {
  if (!raw || raw.trim().length === 0) {
    return { ok: false, reason: 'empty input' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid JSON' };
  }
  return validateAcsToolCallRequest(parsed);
}

/** 提取 tool.name（fail-closed 场景的稳定回显） */
export function acsToolName(input: unknown): string {
  try {
    const t = (input as Record<string, unknown>)['tool'] as Record<string, unknown> | undefined;
    const n = t?.['name'];
    return typeof n === 'string' ? n : 'unknown';
  } catch {
    return 'unknown';
  }
}
