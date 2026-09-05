/**
 * acs/real-conformance.ts — Real Agent D3 Evidence（v0.3.0 §十五~§二十一、§三十四~§四十八）
 *
 * 目的：把「真实 Agent 会话」的 D3 验证结果固化为机器可读 evidence，供自动校验与追溯。
 *
 * 核心原则（§二十一/§四十一/§四十二）：
 *   - 优先 JSON / stdout / stderr / hook logs / filesystem state / git diff-hash，不靠截图。
 *   - D3 ≠ "hook 输出了 deny"，而是「危险工具实际上没有执行」（toolExecuted=false + sideEffectPreserved=true）。
 *   - D3 与 Enforcement 分开（§三十四/§三十五）：hook 能跑 ≠ hardDeny D3；按 capability 粒度记录。
 *   - 任何 token / API key / cookies / account id / 个人路径不得写进 evidence（§三十八，出口统一脱敏）。
 */

import { redactJsonValue } from '../../core/src/redact.ts';
import { PRODUCT_VERSION } from '../../core/src/version.ts';

// ============================================================================
// 类型（§二十/§四十四/§四十七）
// ============================================================================

/** D3 五类必测场景（§十七） */
export const D3_TESTS = ['safe-command', 'git-reset-hard', 'permanent-delete', 'safe-replacement', 'hook-failure'] as const;
export type D3TestId = (typeof D3_TESTS)[number];

/** 测试结果等级（§四十四）：环境不存在→SKIP；机制无法确认→UNKNOWN；不符→FAIL；真实验证→PASS */
export type D3Result = 'PASS' | 'FAIL' | 'SKIP' | 'UNKNOWN';

/** RiskGuard 对本次调用给出的决策（hook 未介入 / 不适用时记 'n-a'） */
export type EvidenceDecision = 'allow' | 'deny' | 'modify' | 'ask' | 'defer' | 'n-a';

/** 验证新鲜度（§四十八）：current / stale / unknown；仅提示，不自动降级 D3 */
export type VerificationFreshness = 'current' | 'stale' | 'unknown';

export interface D3Evidence {
  schemaVersion: '1.0';
  /** agent id（cursor / copilot / windsurf） */
  agent: string;
  /** 被测 Agent 版本（§四十七：固定版本，否则证据会随升级失效） */
  agentVersion: string;
  /** RiskGuard 版本（写入证据时固定） */
  riskguardVersion: string;
  /** 平台（windows / macos / linux） */
  platform: string;
  /** 五类场景之一 */
  test: D3TestId;
  /** 测试时间（ISO 8601） */
  testTimestamp: string;
  /** RiskGuard verdict */
  riskguardDecision: EvidenceDecision;
  /** 危险工具是否真实执行（D3 核心判据：必须 false） */
  toolExecuted: boolean;
  /** 副作用是否被保留（哨兵存在 / hash 不变 / git diff 保留；D3 核心判据：必须 true） */
  sideEffectPreserved: boolean;
  /** hook 失败语义（§三十二/§四十二 记录 Agent 实际行为） */
  hookFailureSemantics: 'fail-open' | 'fail-closed' | 'warning-and-continue' | 'unknown';
  /** 本轮结果等级 */
  result: D3Result;
  /** 可选：per-capability 粒度（§三十五：shell.execute / filesystem.delete / mcp.invoke） */
  capability?: string;
  /** 可选：实测说明（脱敏后落盘） */
  notes?: string;
  /** 可选：证据产物相对路径（stdout/stderr/hook log/filesystem state 等，非截图优先） */
  artifacts?: string[];
}

/** per-capability D3 记录（§三十五）：capability → 等级 + 最近验证版本/时间（§四十七/§四十八） */
export interface CapabilityD3Record {
  capability: string;
  verification: 'D0' | 'D1' | 'D2' | 'D3' | 'D4';
  hardDeny?: boolean;
  lastVerifiedAgentVersion?: string;
  lastVerifiedAt?: string;
}

// ============================================================================
// 校验（§四十六：CI 只验证 evidence schema，不伪装 CI = D3）
// ============================================================================

const REQUIRED_FIELDS: Array<keyof D3Evidence> = [
  'schemaVersion',
  'agent',
  'agentVersion',
  'riskguardVersion',
  'platform',
  'test',
  'testTimestamp',
  'riskguardDecision',
  'toolExecuted',
  'sideEffectPreserved',
  'hookFailureSemantics',
  'result',
];

export interface EvidenceValidation {
  ok: boolean;
  problems: string[];
}

/** Layer 1：evidence 必填字段 / 类型校验（机器可读，供 CI --check） */
export function validateD3Evidence(input: unknown): EvidenceValidation {
  const problems: string[] = [];
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, problems: ['evidence must be a JSON object'] };
  }
  const e = input as Record<string, unknown>;

  for (const field of REQUIRED_FIELDS) {
    if (e[field] === undefined) problems.push(`missing required field: ${field}`);
  }
  if (e['schemaVersion'] !== '1.0') problems.push(`schemaVersion must be "1.0", got: ${String(e['schemaVersion'])}`);
  if (typeof e['agent'] !== 'string' || !['cursor', 'copilot', 'windsurf'].includes(e['agent'] as string)) {
    problems.push(`agent must be cursor|copilot|windsurf, got: ${String(e['agent'])}`);
  }
  if (typeof e['test'] !== 'string' || !D3_TESTS.includes(e['test'] as D3TestId)) {
    problems.push(`test must be one of ${D3_TESTS.join('|')}, got: ${String(e['test'])}`);
  }
  if (typeof e['toolExecuted'] !== 'boolean') problems.push('toolExecuted must be boolean');
  if (typeof e['sideEffectPreserved'] !== 'boolean') problems.push('sideEffectPreserved must be boolean');
  if (!['PASS', 'FAIL', 'SKIP', 'UNKNOWN'].includes(e['result'] as string)) problems.push('result must be PASS|FAIL|SKIP|UNKNOWN');
  if (e['capability'] !== undefined && typeof e['capability'] !== 'string') problems.push('capability must be a string when present');

  return { ok: problems.length === 0, problems };
}

// ============================================================================
// 新鲜度（§四十八：只提示 stale，不自动降级 D3）
// ============================================================================

export function computeFreshness(lastVerifiedVersion: string | undefined, currentVersion: string | undefined): VerificationFreshness {
  if (!lastVerifiedVersion || !currentVersion) return 'unknown';
  return lastVerifiedVersion === currentVersion ? 'current' : 'stale';
}

// ============================================================================
// 序列化（§三十八：出口统一脱敏；§二十一：机器可读 JSON）
// ============================================================================

/** evidence 序列化（JSON，脱敏后落盘） */
export function d3EvidenceToJson(evidence: D3Evidence): string {
  const redacted = redactJsonValue(evidence);
  return JSON.stringify(redacted, null, 2);
}

/** 构造一条 evidence 的便捷入口（补齐 riskguardVersion / testTimestamp） */
export function buildD3Evidence(input: Omit<D3Evidence, 'schemaVersion' | 'riskguardVersion' | 'testTimestamp'>): D3Evidence {
  return {
    schemaVersion: '1.0',
    riskguardVersion: PRODUCT_VERSION,
    testTimestamp: new Date().toISOString(),
    ...input,
  };
}

/** 汇总某 Agent 的 evidence 列表 → per-capability D3（§三十五：不写 agent-wide 营销标签） */
export function summarizeCapabilityD3(agent: string, agentVersion: string, records: D3Evidence[]): CapabilityD3Record[] {
  const byCap = new Map<string, D3Evidence[]>();
  for (const r of records) {
    const cap = r.capability ?? 'shell.execute';
    const list = byCap.get(cap) ?? [];
    list.push(r);
    byCap.set(cap, list);
  }
  const out: CapabilityD3Record[] = [];
  for (const [cap, list] of byCap) {
    const allDenyNotExecuted = list.filter((r) => r.riskguardDecision === 'deny' && r.toolExecuted === false);
    const d3 = allDenyNotExecuted.length > 0 && list.every((r) => r.result === 'PASS' || r.result === 'SKIP');
    out.push({
      capability: cap,
      verification: d3 ? 'D3' : 'D2',
      hardDeny: allDenyNotExecuted.length > 0 ? true : undefined,
      lastVerifiedAgentVersion: agentVersion,
      lastVerifiedAt: new Date().toISOString(),
    });
  }
  return out;
}
