/**
 * installer/doctor.ts — M6 健康检查（只读诊断）
 *
 * 对已安装的 agent 检查 RiskGuard 注入是否在位（hook id / policy name / patch id），
 * 输出每项 state: 'ok' | 'missing' | 'stale' | 'absent-agent'。
 *
 * ⚠️ 本模块的 `checkXxx` / `runDoctors` 是**子串级**的历史实现（见 runDoctors 的
 *    @deprecated 说明）。CLI（doctor / status / install-verify）实际走
 *    `runtime-probe.ts` 的 `probeAgentRuntime()`（含实弹 self-test）。
 *    本模块中被 runtime-probe 复用、并在 G2 增强为「规则数 vs 仓库单源」的是
 *    `checkDshPatch` / `checkDshPatchDeep`。
 */

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectAgent, AGENT_REGISTRY } from './discovery.ts';

/** 仓库根（doctor.ts 位于 packages/installer/src → 上溯 3 = repo root；portable runtime 内布局相同） */
const REPO_ROOT: string = (() => {
  try { return join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'); } catch { return process.cwd(); }
})();

/** DSH patch 仓库单源（相对仓库根） */
const DSH_PATCH_SOURCE_REL = ['assets', 'dsh', 'deny-risk-commands.patch.yml'] as const;

export interface DoctorCheck {
  agent: string;
  check: string;
  state: 'ok' | 'missing' | 'stale' | 'absent-agent';
  detail: string;
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
}

/** 识别 RiskGuard hook 是否在配置里（新 CLI hook：_riskguard/id:riskguard-* 或 pre-tool-hook.ts 命令；兼容旧的 dangerous-commands 接线） */
export function hasRiskGuardHook(raw: string): boolean {
  if (raw.includes('_riskguard')) return true;
  if (raw.includes('riskguard-pre-tool-hook') || raw.includes('riskguard-codex-hook')) return true;
  if (raw.includes('pre-tool-hook.ts')) return true;
  return raw.includes('dangerous-commands');
}

/** Claude Code：检查 settings.json 是否含 RiskGuard PreToolUse hook */
export async function checkClaudeHook(home?: string): Promise<DoctorCheck> {
  const base = home ?? process.env.USERPROFILE ?? process.env.HOME ?? '.';
  const p = join(base, '.claude', 'settings.json');
  try {
    const raw = await readFile(p, 'utf8');
    const hitCurrent = raw.includes('PreToolUse') && hasRiskGuardHook(raw);
    const hitLegacy = raw.includes('PreToolUse') && raw.includes('hookSpecificOutput');
    return { agent: 'claude-code', check: 'PreToolUse hook 注入', state: hitCurrent || hitLegacy ? 'ok' : 'missing', detail: hitCurrent ? '发现 RiskGuard PreToolUse hook' : hitLegacy ? '发现旧版 hook 接线' : 'settings.json 无 RiskGuard hook' };
  } catch {
    return { agent: 'claude-code', check: 'PreToolUse hook 注入', state: 'missing', detail: `未找到 ${p}` };
  }
}

/**
 * 统计一段 cordis.patch.yml 文本里 deny-risk-commands 的**规则条数**（G2 新鲜度信号）。
 *
 * 支持三种 YAML 写法：
 *   - flow mapping（逐行）：`- { re: '...', reason: '...' }`
 *   - flow mapping（内联数组）：`rules: [{ re: '...' }, { re: '...' }]`
 *   - block mapping：`- re: '...'`
 * 计数限定在 `id: deny-risk-commands` 这个 insert 块内（缩进比 `- id:` 更深，直到同级
 * 的下一个 `- ` 列表项）；找不到该块时退化为全文计数（兼容「文件本身就是纯 rules 列表」
 * 的裁剪场景）。注释行与空行不计。
 *
 * 为什么不做完整 YAML 解析：本仓库运行时零依赖（不引入 yaml 包），且下发模板与
 * dsh profile 的 patch 形态稳定；此处用缩进启发式 + 两种 mapping 覆盖，并对
 * 「解析不到任何规则」退化处理，避免把格式差异误判成「陈旧」。
 */
export function countPatchRules(raw: string): number {
  /** 注释/空行之外的每一行（保留缩进用于块边界判定） */
  const rows = raw.split(/\r?\n/)
    .map((text) => ({ text, trimmed: text.trim(), indent: text.length - text.trimStart().length }))
    .filter((r) => r.trimmed && !r.trimmed.startsWith('#'));
  /** 统计文本片段中的规则条目：flow（含同一行内联数组）+ block */
  const countIn = (text: string): number =>
    (text.match(/\{\s*re\s*:/g) ?? []).length + (text.match(/^\s*-\s*re\s*:/gm) ?? []).length;

  const start = rows.findIndex((r) => /^-\s*id\s*:\s*['"]?deny-risk-commands['"]?\s*$/.test(r.trimmed));
  if (start < 0) return countIn(rows.map((r) => r.text).join('\n'));

  const blockIndent = rows[start].indent;
  const block: string[] = [];
  for (let i = start + 1; i < rows.length; i++) {
    // 回到同级/更浅的列表项 ⇒ 已离开本 insert 块（下一个插件/顶层条目）
    if (rows[i].indent <= blockIndent && /^-\s/.test(rows[i].trimmed)) break;
    block.push(rows[i].text);
  }
  return countIn(block.join('\n'));
}

/** 单个 profile 的 dsh patch 观测结果 */
export interface DshPatchProfile {
  profile: string;
  /** deny-risk-commands 规则条数（无 patch 时为 0） */
  rules: number;
  /** 该 profile 的 cordis.patch.yml 是否含 deny-risk-commands */
  hasPatch: boolean;
}

/** DSH 深度检查结果（G2：子串匹配 → 规则数 vs 仓库单源） */
export interface DshPatchDeep {
  /** 与旧 checkDshPatch 完全同形的检查结果（state: ok | missing） */
  check: DoctorCheck;
  /** 每个存在 cordis.patch.yml 的 profile 的规则数 */
  profiles: DshPatchProfile[];
  /** 仓库单源规则数；null = 单源缺失/不可读（**未校验**，不得据此 FAIL） */
  repoRuleCount: number | null;
  /** 仓库单源路径（未找到时为计算出的候选路径） */
  repoSourcePath: string;
  /** true=所有已注入 profile 的规则数 ≥ 单源；false=有条数不足（陈旧）；null=未校验 */
  freshness: boolean | null;
  /** 人类可读说明（陈旧明细 / 未校验原因） */
  notes: string[];
}

/**
 * DSH 深度检查（G2）：patch 是否存在 + 每个 profile 的**规则条数** + 与**仓库单源**比对。
 *
 * 语义边界：
 *   - patch 不存在的 profile 跳过（沿用旧语义，不影响 state）。
 *   - 仓库单源缺失 → `repoRuleCount = null`、`freshness = null`（**未校验**，绝不 FAIL）。
 *   - 规则数 **少于** 单源 → `freshness = false`（陈旧信号，建议按 WARN 语义消费）。
 *     规则数 ≥ 单源视为同步（用户自行加规则是合法增强，不算陈旧）。
 */
export async function checkDshPatchDeep(home?: string, opts: { repoRoot?: string } = {}): Promise<DshPatchDeep> {
  const base = home ?? process.env.USERPROFILE ?? process.env.HOME ?? '.';
  const profilesDir = join(base, '.dsh', 'profiles');
  const repoSourcePath = join(opts.repoRoot ?? REPO_ROOT, ...DSH_PATCH_SOURCE_REL);
  const notes: string[] = [];
  const profiles: DshPatchProfile[] = [];

  // 仓库单源规则数（缺失 → null，未校验）
  let repoRuleCount: number | null = null;
  try {
    repoRuleCount = countPatchRules(await readFile(repoSourcePath, 'utf8'));
  } catch {
    repoRuleCount = null;
  }

  let entries: string[];
  try {
    const { readdir } = await import('node:fs/promises');
    entries = await readdir(profilesDir);
  } catch {
    return {
      check: { agent: 'dsh', check: 'pre-execute patch', state: 'missing', detail: `未找到 ${profilesDir}` },
      profiles, repoRuleCount, repoSourcePath, freshness: null,
      notes: [`profile 目录不存在：${profilesDir}`],
    };
  }

  for (const prof of entries) {
    const p = join(profilesDir, prof, 'cordis.patch.yml');
    let raw: string;
    try { raw = await readFile(p, 'utf8'); } catch { continue; } // 无 patch → 跳过（旧语义）
    const hasPatch = raw.includes('deny-risk-commands');
    profiles.push({ profile: prof, rules: hasPatch ? countPatchRules(raw) : 0, hasPatch });
  }

  const injected = profiles.filter((p) => p.hasPatch);
  let freshness: boolean | null = null;
  if (injected.length > 0) {
    if (repoRuleCount === null) {
      notes.push(`repo single source unavailable — dsh rule-count freshness not checked: ${repoSourcePath}`);
    } else {
      const stale = injected.filter((p) => p.rules < repoRuleCount);
      freshness = stale.length === 0;
      for (const p of stale) notes.push(`rules ${p.rules} < repo ${repoRuleCount} (profile: ${p.profile})`);
    }
  }

  return {
    check: {
      agent: 'dsh', check: 'pre-execute patch（deny-risk-commands）',
      state: injected.length ? 'ok' : 'missing',
      detail: injected.length
        ? `已注入：${injected.map((p) => `${p.profile} ✓ (${p.rules} rules)`).join(', ')}`
        : '无 profile 含 deny-risk-commands',
    },
    profiles, repoRuleCount, repoSourcePath, freshness, notes,
  };
}

/** DSH：检查任意 profile 的 cordis.patch.yml 是否含 deny-risk-commands（子串级；深度信息见 checkDshPatchDeep） */
export async function checkDshPatch(home?: string): Promise<DoctorCheck> {
  return (await checkDshPatchDeep(home)).check;
}

/** Codex（R16 改进）：检查 hooks.json 是否注册 PreToolUse 门禁 */
export async function checkCodexHook(home?: string): Promise<DoctorCheck> {
  const base = home ?? process.env.USERPROFILE ?? process.env.HOME ?? '.';
  const p = join(base, '.codex', 'hooks.json');
  try {
    const raw = await readFile(p, 'utf8');
    const hit = raw.includes('PreToolUse') && hasRiskGuardHook(raw);
    return {
      agent: 'codex', check: 'PreToolUse hook 注入（hooks.json）',
      state: hit ? 'ok' : 'missing',
      detail: hit ? '发现 RiskGuard PreToolUse 门禁' : 'hooks.json 无 RiskGuard 门禁',
    };
  } catch {
    return { agent: 'codex', check: 'PreToolUse hook 注入（hooks.json）', state: 'missing', detail: `未找到 ${p}` };
  }
}

/** OpenCode：检查 opencode.json 的 plugin 数组是否注册 RiskGuard 插件（R25：R17 实测仅放 plugins/ 不生效；v0.1.0 认 agent-risk-guard 新名 + 兼容旧名） */
export async function checkOpencodePlugin(home?: string): Promise<DoctorCheck> {
  const base = home ?? process.env.USERPROFILE ?? process.env.HOME ?? '.';
  const p = join(base, '.config', 'opencode', 'opencode.json');
  try {
    const raw = await readFile(p, 'utf8');
    const hitNew = raw.includes('agent-risk-guard');
    const hitLegacy = raw.includes('destructive-operation-guard');
    const hit = hitNew || hitLegacy;
    return {
      agent: 'opencode', check: 'plugin 注册（opencode.json）',
      state: hit ? 'ok' : 'missing',
      detail: hitNew ? '发现 agent-risk-guard 插件注册' : hitLegacy ? '发现旧名 destructive-operation-guard 插件注册（建议重装升级到 agent-risk-guard）' : 'opencode.json plugin 未注册 RiskGuard',
    };
  } catch {
    return { agent: 'opencode', check: 'plugin 注册（opencode.json）', state: 'missing', detail: `未找到 ${p}` };
  }
}

/**
 * 全员体检（**已废弃 / DEPRECATED**）。
 *
 * @deprecated 自 v0.1.2 起，CLI（`doctor` / `status` / install verification）已**统一**走
 *   `probeAgentRuntime()`（packages/installer/src/runtime-probe.ts）。本函数只保留给
 *   历史调用方与单元测试；新代码请勿使用——两套 doctor 并存会得出「两个真相」
 *   （G2：两份独立审计报告都读了本旧实现，据此误判「doctor 只查字符串在位」）。
 *
 * 已知局限（为什么不能作为验收入口）：
 *   1. **子串级**：`raw.includes('_riskguard' | 'deny-risk-commands' | ...)` 即判 ok；
 *      文件被改坏、脚本被删、规则被删、patch 陈旧（条数不足）都可能仍报 ok。
 *   2. **无实弹 self-test**：不会真正喂 payload 验证 hook 的 allow / deny 行为。
 *   3. **无新鲜度**：不比对「已装产物 vs 仓库单源」（SHA256 / 规则条数）。
 *   4. **无 state / verificationMode**：不产出 NOT_DETECTED/DETECTED/INSTALLED/ACTIVE/BROKEN。
 *
 * 迁移：`await probeAgentRuntime(agent, { home, deep: true })`。
 * 计划：下一个大版本移除本函数及 `packages/installer/src/index.ts` 中的导出。
 */
export async function runDoctors(opts: { home?: string } = {}): Promise<DoctorReport> {
  const home = opts.home ?? process.env.USERPROFILE ?? process.env.HOME ?? '.';
  const checks: DoctorCheck[] = [];
  checks.push(await checkClaudeHook(home));
  checks.push(await checkDshPatch(home));
  checks.push(await checkCodexHook(home)); // R16：codex hooks.json 真实接线检查
  checks.push(await checkOpencodePlugin(home)); // R25：opencode.json plugin 注册检查
  // 其他 agent：按 discovery 判断「已装但无注入」为 missing（供报告），未装为 absent-agent
  for (const desc of AGENT_REGISTRY) {
    if (desc.id === 'codex' || desc.id === 'opencode') continue; // 已由专属检查覆盖
    const inst = detectAgent(desc, { home });
    if (inst.installed && desc.mechanisms.includes('hooks') === false && desc.id !== 'claude-code') {
      checks.push({ agent: desc.id, check: '注入检查（rules/policy）', state: 'missing', detail: `${desc.display} 已安装，注入点待接入` });
    }
    if (!inst.installed && !['dsh', 'claude-code', 'codex'].includes(desc.id)) {
      checks.push({ agent: desc.id, check: 'agent 未安装', state: 'absent-agent', detail: `${desc.display} 未检测到` });
    }
  }
  return { ok: checks.every((c) => c.state === 'ok' || c.state === 'absent-agent'), checks };
}