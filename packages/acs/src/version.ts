/**
 * acs/version.ts — ACS 对齐版本显式固定（v0.2.0）
 *
 * 铁律（v0.2.0 目标 §四）：
 *   - 对齐对象必须是显式固定的版本号，禁止 latest / current / auto-detect GitHub。
 *   - 未来 ACS v1 / v2 / v3 与 v0.1 并存时，通过 versioned 目录（acs-v0.1 / acs-v1）承载。
 *
 * 当前对齐对象：OWASP Agent Control Standard v0.1 Public Preview。
 * 定位声明（§四十二）：实验性对齐（aligned），不宣称 compliant / certified。
 */

/** OWASP ACS 对齐版本（显式固定，唯一对齐对象） */
export const ACS_VERSION = '0.1';

/** ACS profile 标识（compatibility.json acsProfile 使用；experimental 前缀表明非正式 conformance） */
export const ACS_PROFILE = 'experimental-0.1';

/** 版本化 fixture/测试目录名（tests/fixtures/acs-v0.1/ 对应此值） */
export const ACS_FIXTURE_NS = 'acs-v0.1';

/** ACS v0.1 支持的决策集合（allow / deny / modify / ask / defer） */
export const ACS_DECISIONS = ['allow', 'deny', 'modify', 'ask', 'defer'] as const;
export type AcsDecision = (typeof ACS_DECISIONS)[number];

/** 声明文本：仅允许 "aligned"，禁止 compliant / certified / fully compatible */
export function acsAlignmentLabel(): string {
  return `OWASP ACS v${ACS_VERSION} aligned (experimental)`;
}
