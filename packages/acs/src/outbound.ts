/**
 * acs/outbound.ts — ACS Result 输出校验（v0.2.0 §十六 最后一环，v0.2.1 §十六）
 *
 * Layer 1（本模块）：快速、错误信息友好、fail-closed 的本地校验。
 * Layer 2（tests/acs-schema-conformance）：官方 response-envelope.json，是最终判据。
 *
 * v0.2.1 必须检查官方必填项（§十六）：
 *   type == "final" / acs_version 合法 SemVer / request_id 合法 UUID / decision 合法
 * 以及官方决策条件约束（deny/modify/ask/defer 必带 reasoning；modify 必带官方
 * modifications 结构；ask 必带官方 ask_details；defer 必带官方 defer_details）。
 *
 * Gateway 在产出 ACS Result 后必须再校验一次（validate ACS result），
 * 防止映射层 bug 输出非法 verdict。校验失败 → fail-closed deny。
 */

import { ACS_DECISIONS } from './version.ts';
import type { AcsResult } from './types.ts';

export interface AcsResultValidation {
  ok: boolean;
  problems: string[];
}

const REASONING_REQUIRED = new Set(['deny', 'modify', 'ask', 'defer']);

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DEFER_REASONS = new Set(['insufficient_context', 'conflicting_policies', 'low_confidence', 'pending_dependency']);
const DEFER_RESOLUTIONS = new Set(['additional_context', 'human_approval', 'timeout']);
const ASK_APPROVER_TYPES = new Set(['human', 'agent', 'service']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** 校验官方 modifications 结构（§十七/§二十一）：modified_content XOR (redactions / parameter_overrides) */
function validateModifications(mods: unknown, problems: string[]): void {
  if (!isPlainObject(mods)) {
    problems.push('modify requires modifications object (official shape)');
    return;
  }
  const hasContent = typeof mods['modified_content'] === 'string';
  const hasRedactions = Array.isArray(mods['redactions']);
  const hasOverrides = isPlainObject(mods['parameter_overrides']);
  const structured = hasRedactions || hasOverrides;

  if (!hasContent && !structured) {
    problems.push('modifications must contain modified_content or redactions/parameter_overrides (description-only is not a modification)');
    return;
  }
  if (hasContent && structured) {
    problems.push('modifications must not combine modified_content with redactions/parameter_overrides');
  }
  if (hasRedactions && mods['redactions']!.length === 0 && !hasOverrides) {
    problems.push('modifications redactions must be non-empty when used without parameter_overrides');
  }
}

/** 校验官方 ask-details（§二十二）：approver / question / timeout_seconds 必填 */
function validateAskDetails(d: unknown, problems: string[]): void {
  if (!isPlainObject(d)) {
    problems.push('ask requires ask_details object (official shape)');
    return;
  }
  const approver = d['approver'];
  if (!isPlainObject(approver) || typeof approver['type'] !== 'string' || !ASK_APPROVER_TYPES.has(approver['type'] as string) || typeof approver['id'] !== 'string') {
    problems.push('ask_details.approver requires type (human|agent|service) and id');
  }
  if (typeof d['question'] !== 'string' || d['question'].trim().length === 0) {
    problems.push('ask_details.question is required');
  }
  if (typeof d['timeout_seconds'] !== 'number' || d['timeout_seconds'] < 1) {
    problems.push('ask_details.timeout_seconds is required (integer >= 1)');
  }
}

/** 校验官方 defer-details（§二十三）：reason / resolution_method / resolution_timeout_ms 必填 */
function validateDeferDetails(d: unknown, problems: string[]): void {
  if (!isPlainObject(d)) {
    problems.push('defer requires defer_details object (official shape)');
    return;
  }
  if (typeof d['reason'] !== 'string' || !DEFER_REASONS.has(d['reason'] as string)) {
    problems.push(`defer_details.reason must be one of ${[...DEFER_REASONS].join(', ')}`);
  }
  if (typeof d['resolution_method'] !== 'string' || !DEFER_RESOLUTIONS.has(d['resolution_method'] as string)) {
    problems.push(`defer_details.resolution_method must be one of ${[...DEFER_RESOLUTIONS].join(', ')}`);
  }
  if (typeof d['resolution_timeout_ms'] !== 'number' || d['resolution_timeout_ms'] < 0) {
    problems.push('defer_details.resolution_timeout_ms is required (integer >= 0)');
  }
}

/** 校验 AcsResult 是否满足 ACS v0.1.0 官方必填 + 决策条件约束（Layer 1） */
export function validateAcsResult(result: AcsResult): AcsResultValidation {
  const problems: string[] = [];

  if (!result || typeof result !== 'object') {
    return { ok: false, problems: ['result is not an object'] };
  }

  // §十六：官方必填
  if (result.type !== 'final') {
    problems.push(`type must be "final", got: ${String(result.type)}`);
  }
  if (typeof result.acs_version !== 'string' || !SEMVER_RE.test(result.acs_version)) {
    problems.push(`acs_version must be full semver (e.g. 0.1.0), got: ${String(result.acs_version)}`);
  }
  if (typeof result.request_id !== 'string' || !UUID_RE.test(result.request_id)) {
    problems.push(`request_id must be a valid UUID, got: ${String(result.request_id)}`);
  }
  if (!ACS_DECISIONS.includes(result.decision)) {
    problems.push(`invalid decision: ${String(result.decision)}`);
  }

  if (REASONING_REQUIRED.has(result.decision)) {
    if (!result.reasoning || result.reasoning.trim().length === 0) {
      problems.push(`${result.decision} requires non-empty reasoning`);
    }
  }
  if (result.decision === 'modify') {
    validateModifications(result.modifications, problems);
  }
  if (result.decision === 'ask') {
    validateAskDetails(result.ask_details, problems);
  }
  if (result.decision === 'defer') {
    validateDeferDetails(result.defer_details, problems);
  }
  if (result.metadata && result.metadata.evaluator) {
    const ev = result.metadata.evaluator;
    if (ev !== 'deterministic' && ev !== 'agent' && ev !== 'composite') {
      problems.push(`invalid evaluator: ${String(ev)}`);
    }
  }
  return { ok: problems.length === 0, problems };
}

/** 便捷：抛错版（内部使用；gateway 捕获后 fail-closed） */
export function assertValidAcsResult(result: AcsResult): void {
  const v = validateAcsResult(result);
  if (!v.ok) {
    throw new Error(`invalid ACS result: ${v.problems.join('; ')}`);
  }
}
