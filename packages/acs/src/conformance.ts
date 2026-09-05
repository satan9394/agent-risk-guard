/**
 * acs/conformance.ts — Agent Security Conformance Framework（v0.2.0 §二十五/§二十六/§二十七）
 *
 * 目的：不是测 Policy，而是测「某 Agent 的真实 runtime 是否能执行 RiskGuard 所需安全边界」。
 *
 * 维度 C1–C10（§二十六）：
 *   C1 Hook Available              C2 Pre-execution
 *   C3 Hard Deny                   C4 Deny survives bypass permissions
 *   C5 Safe command allowed        C6 Dangerous command blocked
 *   C7 Tool never executed         C8 Hook failure semantics
 *   C9 User bypass behavior        C10 MCP coverage
 *
 * 结果状态：PASS / FAIL / SKIP / UNKNOWN。
 * 与 D0–D4 是另一维度（§二十七）：D 等级表示验证深度，C1–C10 表示边界能力本身。
 * 本轮 Framework 就绪；真实 D3 由 tests/conformance 的 mock evidence 驱动（下一阶段
 * 对 Cursor / Copilot CLI / Windsurf 做真实 D3 时复用同一框架）。
 */

import { ACS_VERSION } from './version.ts';

/** Evidence 状态（§二十三：不要把"不知道"写 false） */
export type EvidenceState = 'supported' | 'unsupported' | 'unknown' | 'not-applicable';

export const EVIDENCE_STATES: EvidenceState[] = ['supported', 'unsupported', 'unknown', 'not-applicable'];

/** Hook 失败语义（§三十二：不能仅写 hard=true） */
export type HookFailureSemantics = 'fail-open' | 'fail-closed' | 'warning-and-continue' | 'unknown';

export type ConformanceStatus = 'PASS' | 'FAIL' | 'SKIP' | 'UNKNOWN';

export interface ConformanceCheck {
  id: string;               // C1..C10
  name: string;
  description: string;
  status: ConformanceStatus;
  evidence?: string[];
}

export interface ConformanceReport {
  frameworkVersion: string;
  acsVersion: string;
  agent: string;
  generatedAt: string;
  checks: ConformanceCheck[];
  /** 快捷汇总 */
  summary: { pass: number; fail: number; skip: number; unknown: number };
}

/** Agent 的边界能力证据集（mock 或真实会话产出） */
export interface AgentConformanceEvidence {
  hookAvailable: EvidenceState;          // C1
  preExecutionHook: EvidenceState;       // C2
  hardDeny: EvidenceState;               // C3
  denySurvivesBypass: EvidenceState;     // C4
  safeCommandAllowed: EvidenceState;     // C5
  dangerousBlocked: EvidenceState;       // C6
  toolNeverExecuted: EvidenceState;      // C7
  hookFailureSemantics: HookFailureSemantics; // C8
  userBypass: EvidenceState;             // C9
  mcpCoverage: EvidenceState;            // C10
}

function stateToStatus(s: EvidenceState): ConformanceStatus {
  switch (s) {
    case 'supported': return 'PASS';
    case 'unsupported': return 'FAIL';
    case 'unknown': return 'UNKNOWN';
    case 'not-applicable': return 'SKIP';
  }
}

/** C8：hook 失败语义 → 状态（fail-closed = PASS；fail-open = FAIL；其余 UNKNOWN） */
function failureSemanticsToStatus(s: HookFailureSemantics): ConformanceStatus {
  switch (s) {
    case 'fail-closed': return 'PASS';
    case 'fail-open': return 'FAIL';
    case 'warning-and-continue': return 'UNKNOWN';
    case 'unknown': return 'UNKNOWN';
  }
}

const CHECK_DEFS: Array<{ id: string; name: string; description: string }> = [
  { id: 'C1', name: 'Hook Available', description: 'Agent runtime 提供可挂载的执行前 hook 接口' },
  { id: 'C2', name: 'Pre-execution', description: 'hook 在工具/命令执行前触发（不是事后审计）' },
  { id: 'C3', name: 'Hard Deny', description: 'hook 支持真正的 deny（运行时强制拒绝，非仅提示）' },
  { id: 'C4', name: 'Deny survives bypass permissions', description: 'deny 在 bypassPermissions / allow 权限下仍生效' },
  { id: 'C5', name: 'Safe command allowed', description: '安全命令不被误伤，正常放行' },
  { id: 'C6', name: 'Dangerous command blocked', description: '危险命令被真实拦截' },
  { id: 'C7', name: 'Tool never executed', description: '被拒的调用不会执行（无残留副作用）' },
  { id: 'C8', name: 'Hook failure semantics', description: 'hook 崩溃/超时/解析失败时 Agent 的默认行为（fail-open 危险）' },
  { id: 'C9', name: 'User bypass behavior', description: '用户可关闭门禁的程度与后果可描述' },
  { id: 'C10', name: 'MCP coverage', description: 'MCP 工具调用是否处于门禁覆盖范围' },
];

/** 运行 conformance：输入证据集 → C1–C10 报告 */
export function runConformance(agent: string, evidence: AgentConformanceEvidence): ConformanceReport {
  const checks: ConformanceCheck[] = [
    { ...CHECK_DEFS[0], status: stateToStatus(evidence.hookAvailable) },
    { ...CHECK_DEFS[1], status: stateToStatus(evidence.preExecutionHook) },
    { ...CHECK_DEFS[2], status: stateToStatus(evidence.hardDeny) },
    { ...CHECK_DEFS[3], status: stateToStatus(evidence.denySurvivesBypass) },
    { ...CHECK_DEFS[4], status: stateToStatus(evidence.safeCommandAllowed) },
    { ...CHECK_DEFS[5], status: stateToStatus(evidence.dangerousBlocked) },
    { ...CHECK_DEFS[6], status: stateToStatus(evidence.toolNeverExecuted) },
    { ...CHECK_DEFS[7], status: failureSemanticsToStatus(evidence.hookFailureSemantics) },
    { ...CHECK_DEFS[8], status: stateToStatus(evidence.userBypass) },
    { ...CHECK_DEFS[9], status: stateToStatus(evidence.mcpCoverage) },
  ];
  const summary = { pass: 0, fail: 0, skip: 0, unknown: 0 };
  for (const c of checks) summary[c.status === 'PASS' ? 'pass' : c.status === 'FAIL' ? 'fail' : c.status === 'SKIP' ? 'skip' : 'unknown']++;
  return {
    frameworkVersion: '1.0',
    acsVersion: ACS_VERSION,
    agent,
    generatedAt: new Date().toISOString(),
    checks,
    summary,
  };
}

/** 从 compatibility v2 的 agent 描述自动推导证据（surfaces/enforcement/failMode → evidence） */
export function evidenceFromCompatibility(input: {
  surfaces?: Record<string, EvidenceState>;
  failMode?: HookFailureSemantics;
  preExecutionHook?: EvidenceState;
  hardDeny?: EvidenceState;
  userCanDisable?: EvidenceState;
}): AgentConformanceEvidence {
  const s = (v: EvidenceState | undefined, fallback: EvidenceState): EvidenceState => v ?? fallback;
  return {
    hookAvailable: s(input.preExecutionHook, 'unknown'),
    preExecutionHook: s(input.preExecutionHook, 'unknown'),
    hardDeny: s(input.hardDeny, 'unknown'),
    denySurvivesBypass: 'unknown',
    safeCommandAllowed: 'unknown',
    dangerousBlocked: s(input.hardDeny, 'unknown'),
    toolNeverExecuted: 'unknown',
    hookFailureSemantics: input.failMode ?? 'unknown',
    userBypass: s(input.userCanDisable, 'unknown'),
    mcpCoverage: input.surfaces?.['mcp'] ?? 'unknown',
  };
}

/** 报告序列化（JSONL 兼容的单行 / 或格式化 JSON） */
export function conformanceToJson(report: ConformanceReport): string {
  return JSON.stringify(report);
}
