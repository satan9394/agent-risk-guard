/**
 * installer/compatibility.ts — 兼容性单一事实源（v0.2.0：Compatibility Schema v2）
 *
 * v1（schemaVersion "1.0"）：agent / integration / enforcement / verification(D0–D4) / notes
 * v2（schemaVersion "2.0"）：在 v1 基础上增加真实执行边界描述（v0.2.0 目标 §二十~§三十六）：
 *   - surfaces（shell/filesystem/git/mcp/network → EvidenceState）
 *   - enforcementDetail（pre/post hook、hardDeny、failMode）
 *   - sandbox / policy（含 policyScope: user|machine|enterprise，§三十）
 *   - bypass（userCanDisable / agentCanBypass，§三十五 不作"绝对硬拦截"宣传）
 *   - hookFailureSemantics（fail-open/fail-closed/warning-and-continue/unknown，§三十二）
 *   - conditionalAvailability（如 Windsurf Restricted Mode → hooks 不加载，§三十一）
 *   - securityBoundaries（L0–L5 分层，§三十三/§三十四）
 *   - capabilities（per-capability matrix：enforcement × D 等级）
 *   - componentInventory（AGBoM 预留，§三十六：只记录组件清单，不做完整 AGBoM）
 *
 * 迁移承诺（§四十一）：loader 兼容 schemaVersion 1 与 2，旧安装 v0.1.2 数据升级后
 * CLI/doctor/status 不 crash——至少一个版本周期。
 *
 * README 支持矩阵、CLI `status`、`doctor` 均以本模块为准，禁止在别处维护第二套事实。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EvidenceState, HookFailureSemantics } from '../../acs/src/conformance.ts';

export type VerificationLevel = 'D0' | 'D1' | 'D2' | 'D3' | 'D4';
export type Enforcement = 'hard' | 'soft' | 'mixed' | 'none';

/** v1 核心字段（v2 保留；status/doctor/README 依赖） */
export interface AgentCompatibility {
  display: string;
  integration: string;
  enforcement: Enforcement;
  verification: Record<string, VerificationLevel>;
  notes?: string;
}

export interface ConditionalAvailability {
  feature: string;
  condition: string;
  state: EvidenceState;
}

export interface CapabilityEntry {
  enforcement: Enforcement | 'unknown';
  verification: Record<string, VerificationLevel | EvidenceState>;
}

/** v2 扩展字段（真实执行边界） */
export interface AgentCompatibilityV2 extends AgentCompatibility {
  surfaces?: Record<string, EvidenceState>;
  enforcementDetail?: {
    preExecutionHook?: EvidenceState;
    postExecutionHook?: EvidenceState;
    hardDeny?: EvidenceState;
    failMode?: HookFailureSemantics;
  };
  sandbox?: { available?: EvidenceState; osEnforced?: EvidenceState };
  policy?: {
    userLevel?: EvidenceState;
    systemLevel?: EvidenceState;
    enterpriseLevel?: EvidenceState;
    policyScope?: Array<'user' | 'machine' | 'enterprise'>;
  };
  bypass?: { userCanDisable?: EvidenceState; agentCanBypass?: EvidenceState };
  hookFailureSemantics?: HookFailureSemantics;
  conditionalAvailability?: ConditionalAvailability[];
  securityBoundaries?: string[]; // L0..L5（§三十三）
  capabilities?: Record<string, CapabilityEntry>;
  componentInventory?: Record<string, string>;
}

export interface CompatibilitySchemaV2 {
  schemaVersion: string;
  productVersion: string;
  acsProfile?: string;
  levels: Record<VerificationLevel, string>;
  agents: Record<string, AgentCompatibilityV2>;
}

const COMPAT_PATH = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'compatibility.json');

/** 未声明的 v2 字段默认值：unknown（§二十三：不要把"不知道"写 false） */
function migrateV1(agent: AgentCompatibility): AgentCompatibilityV2 {
  return {
    ...agent,
    surfaces: {},
    enforcementDetail: {
      preExecutionHook: agent.enforcement === 'hard' ? 'supported' : agent.enforcement === 'none' ? 'not-applicable' : 'unknown',
      hardDeny: agent.enforcement === 'hard' ? 'supported' : agent.enforcement === 'none' ? 'not-applicable' : 'unknown',
      failMode: agent.enforcement === 'hard' ? 'fail-closed' : agent.enforcement === 'none' ? 'not-applicable' : 'unknown',
    },
    sandbox: {},
    policy: { policyScope: [] },
    bypass: {},
    hookFailureSemantics: agent.enforcement === 'hard' ? 'fail-closed' : agent.enforcement === 'none' ? 'unknown' : 'unknown',
    conditionalAvailability: [],
    securityBoundaries: [],
    capabilities: {},
  };
}

/** 从磁盘加载兼容性表（单一事实源）；自动迁移 v1 → v2 */
export function loadCompatibility(): CompatibilitySchemaV2 {
  const raw = readFileSync(COMPAT_PATH, 'utf8');
  return parseCompatibility(raw);
}

/** 解析 + 迁移（供测试注入 v1 形状数据） */
export function parseCompatibility(raw: string): CompatibilitySchemaV2 {
  const parsed = JSON.parse(raw) as Partial<CompatibilitySchemaV2>;
  const schemaVersion = parsed.schemaVersion ?? '1.0';
  const isV1 = schemaVersion === '1.0' || schemaVersion === '1';
  const agents: Record<string, AgentCompatibilityV2> = {};
  for (const [id, a] of Object.entries(parsed.agents ?? {})) {
    if (isV1 || !a) {
      agents[id] = migrateV1(a as AgentCompatibility);
    } else {
      agents[id] = a as AgentCompatibilityV2;
    }
  }
  return {
    schemaVersion: isV1 ? '1.0' : schemaVersion,
    productVersion: parsed.productVersion ?? '0.0.0',
    acsProfile: parsed.acsProfile,
    levels: parsed.levels ?? ({} as CompatibilitySchemaV2['levels']),
    agents,
  };
}

/** 判定某平台是否达到至少某等级（如 D3） */
export function levelAtLeast(actual: VerificationLevel | undefined, min: VerificationLevel): boolean {
  const order: VerificationLevel[] = ['D0', 'D1', 'D2', 'D3', 'D4'];
  const a = actual ? order.indexOf(actual) : 0;
  const m = order.indexOf(min);
  return a >= m;
}

/** 取某 agent 在某平台的支持状态文本（用于 README / status 展示） */
export function describeAgent(agent: string, platform: string): { level: VerificationLevel; enforcement: Enforcement } {
  const compat = loadCompatibility();
  const src = compat.agents[agent];
  if (!src) return { level: 'D0', enforcement: 'none' };
  const level = src.verification[platform] ?? 'D1';
  return { level, enforcement: src.enforcement };
}

// ---- v2 访问器（真实执行边界；未声明字段一律 unknown / 空，绝不伪造 false） ----

/** agent 的 surface 证据（shell/filesystem/git/mcp/network） */
export function agentSurfaces(agent: string): Record<string, EvidenceState> {
  return loadCompatibility().agents[agent]?.surfaces ?? {};
}

/** agent 的 fail mode（§三十二：fail-open/fail-closed/...） */
export function agentFailMode(agent: string): HookFailureSemantics {
  const a = loadCompatibility().agents[agent];
  return a?.hookFailureSemantics ?? a?.enforcementDetail?.failMode ?? 'unknown';
}

/** agent 的 policy scope（§三十：user/machine/enterprise） */
export function agentPolicyScope(agent: string): Array<'user' | 'machine' | 'enterprise'> {
  return loadCompatibility().agents[agent]?.policy?.policyScope ?? [];
}

/** agent 的 bypass 语义（§三十五：userCanDisable / agentCanBypass） */
export function agentBypass(agent: string): { userCanDisable: EvidenceState; agentCanBypass: EvidenceState } {
  const b = loadCompatibility().agents[agent]?.bypass;
  return { userCanDisable: b?.userCanDisable ?? 'unknown', agentCanBypass: b?.agentCanBypass ?? 'unknown' };
}

/** agent 的 conditional availability（§三十一：如 Windsurf Restricted Mode） */
export function agentConditionalAvailability(agent: string): ConditionalAvailability[] {
  return loadCompatibility().agents[agent]?.conditionalAvailability ?? [];
}

/** agent 的 security boundaries（§三十三/§三十四：L0–L5） */
export function agentSecurityBoundaries(agent: string): string[] {
  return loadCompatibility().agents[agent]?.securityBoundaries ?? [];
}

/** agent 的 per-capability matrix（§二十一：enforcement × D 等级） */
export function agentCapabilities(agent: string): Record<string, CapabilityEntry> {
  return loadCompatibility().agents[agent]?.capabilities ?? {};
}
