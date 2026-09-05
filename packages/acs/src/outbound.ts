/**
 * acs/outbound.ts — ACS Result 输出校验（v0.2.0 §十六 最后一环）
 *
 * Gateway 在产出 ACS Result 后必须再校验一次（validate ACS result），
 * 防止映射层 bug 输出非法 verdict（例如 modify 缺 modifications、deny 缺 reasoning）。
 * 校验失败 → fail-closed deny。
 */

import { ACS_DECISIONS } from './version.ts';
import type { AcsResult } from './types.ts';

export interface AcsResultValidation {
  ok: boolean;
  problems: string[];
}

const REASONING_REQUIRED = new Set(['deny', 'modify', 'ask', 'defer']);

/** 校验 AcsResult 是否满足 ACS v0.1 基本约束 */
export function validateAcsResult(result: AcsResult): AcsResultValidation {
  const problems: string[] = [];

  if (!result || typeof result !== 'object') {
    return { ok: false, problems: ['result is not an object'] };
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
    if (!Array.isArray(result.modifications) || result.modifications.length === 0) {
      problems.push('modify requires non-empty modifications');
    }
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
