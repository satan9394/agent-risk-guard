/**
 * acs/version.ts — ACS 对齐版本显式固定（v0.2.0 建立，v0.2.1 升级为完整 SemVer）
 *
 * 铁律（v0.2.0 目标 §四）：
 *   - 对齐对象必须是显式固定的版本号，禁止 latest / current / auto-detect GitHub。
 *   - 未来 ACS v1 / v2 / v3 与 v0.1 并存时，通过 versioned 目录（acs-v0.1 / acs-v1）承载。
 *
 * v0.2.1（§三）必须区分两个概念：
 *   - ACS_SPEC_VERSION：官方 wire spec 版本（完整 SemVer，写进 ACS wire payload）
 *   - ACS_PROFILE：profile / namespace（experimental 前缀表明非正式 conformance）
 *
 * 当前对齐对象：OWASP Agent Control Standard v0.1.0（官方 schema 快照 pinned 于
 * tests/vendor/owasp-acs-v0.1.0/，见该目录 README.md 的 upstream commit）。
 * 定位声明（§五十七）：实验性对齐（aligned），禁止 compliant / certified / fully compatible。
 */

/** 官方 wire spec 版本（完整 SemVer；写进 acs_version / extensions.acsVersion） */
export const ACS_SPEC_VERSION = '0.1.0';

/** 兼容别名：旧代码 import { ACS_VERSION } 继续可用，值 = 官方 wire spec 版本 */
export const ACS_VERSION = ACS_SPEC_VERSION;

/**
 * RiskGuard 支持的 ACS wire 版本（v0.2.2 §一/§二，精确 pin）。
 *
 * Public Preview 阶段必须精确 pin，禁止：
 *   - 0.1.x / 0.x 自动兼容
 *   - latest / semver range
 *   - version negotiation / handshake
 * schema-valid 与 supported 是两个独立概念（§三）：`9.9.9` 满足 x.y.z
 * 但不在本列表 → RiskGuard unsupported（gateway 返回 -32001，非 policy deny）。
 */
export const SUPPORTED_ACS_SPEC_VERSIONS = ['0.1.0'] as const;

/**
 * 精确判断某 ACS 版本是否被 RiskGuard 支持（§二）。
 * 只接受完整 SemVer 且精确等于受支持版本；无 range / 自动兼容语义。
 */
export function isSupportedAcsVersion(version: string): boolean {
  return (SUPPORTED_ACS_SPEC_VERSIONS as readonly string[]).includes(version);
}

/** 返回支持的版本集合（§六：只提供 getter，本轮不实现 negotiation / handshake） */
export function getSupportedAcsVersions(): string[] {
  return [...SUPPORTED_ACS_SPEC_VERSIONS];
}

/** ACS profile / namespace（compatibility.json acsProfile 使用；experimental 前缀表明非正式 conformance） */
export const ACS_PROFILE = 'experimental-0.1';

/** 遗留 fixture 目录名（tests/fixtures/acs-v0.1/ 对应此值；v0.2.0 兼容集，不删除） */
export const ACS_FIXTURE_NS = 'acs-v0.1';

/** 官方 fixture 目录名（tests/fixtures/acs-v0.1.0/ 对应此值；v0.2.1 官方 shape 集） */
export const ACS_FIXTURE_NS_V010 = 'acs-v0.1.0';

/** ACS v0.1.0 支持的决策集合（allow / deny / modify / ask / defer） */
export const ACS_DECISIONS = ['allow', 'deny', 'modify', 'ask', 'defer'] as const;
export type AcsDecision = (typeof ACS_DECISIONS)[number];

/** 声明文本：仅允许 "aligned"，禁止 compliant / certified / fully compatible */
export function acsAlignmentLabel(): string {
  return `OWASP ACS v${ACS_SPEC_VERSION} aligned (experimental)`;
}
