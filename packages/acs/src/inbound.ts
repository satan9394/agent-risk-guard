/**
 * acs/inbound.ts — ACS ToolCallRequest 校验（v0.2.0 §十六/§十八，v0.2.1 §四/§三十二）
 *
 * Layer 1（本模块）：快速、错误信息友好、fail-closed 的本地校验。
 * Layer 2（tests/acs-schema-conformance）：官方 JSON Schema，是最终 conformance 判据。
 *
 * v0.2.1 对齐官方 tool-call-request.json：
 *   required = tool + arguments
 *   capability = OPTIONAL（缺失不拒绝；由 gateway 推导，推导失败才 fail-closed deny）
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

/** 必填字符串（trim 后非空才算存在） */
function requireString(v: unknown, name: string): string | null {
  if (typeof v === 'string' && v.trim().length > 0) return v;
  return null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Layer 1：校验已解析的 ACS ToolCallRequest 形状（对齐官方 required 集）。
 * 严格性说明：
 *   - tool.name 必填、arguments 必填（官方 required）；capability 可选
 *   - arguments 为对象（value-wrapper 形状在 Layer 2 由官方 schema 把关；
 *     Layer 1 容忍裸值以兼容 v0.2.0 遗留 payload，unwrap 层统一处理 §三十三）
 *   - raw_command / intent 类型检查保持 fail-closed 方向
 */
export function validateAcsToolCallRequest(input: unknown): AcsValidationOutcome {
  if (!isPlainObject(input)) {
    return { ok: false, reason: 'request must be a JSON object' };
  }
  const req = input as Record<string, unknown>;

  const tool = req['tool'];
  if (!isPlainObject(tool)) {
    return { ok: false, reason: 'missing required field: tool' };
  }
  const toolName = requireString(tool['name'], 'tool.name');
  if (!toolName) {
    return { ok: false, reason: 'missing required field: tool.name' };
  }

  // §四：arguments 官方 required
  if (!isPlainObject(req['arguments'])) {
    return { ok: false, reason: 'missing required field: arguments' };
  }

  // §四：capability 官方 optional；出现则必须是非空字符串
  if (req['capability'] !== undefined && !requireString(req['capability'], 'capability')) {
    return { ok: false, reason: 'capability must be a non-empty string when present' };
  }

  if (req['operation'] !== undefined && !requireString(req['operation'], 'operation')) {
    return { ok: false, reason: 'operation must be a non-empty string when present' };
  }
  if (req['raw_command'] !== undefined && typeof req['raw_command'] !== 'string') {
    return { ok: false, reason: 'raw_command must be a string' };
  }
  if (req['intent'] !== undefined && !isPlainObject(req['intent'])) {
    return { ok: false, reason: 'intent must be an object' };
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
