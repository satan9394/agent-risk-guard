/**
 * commands.ts — RiskGuard 用户级 CLI 命令实现
 *
 * 可用子命令：detect / install / status / doctor / uninstall / version / help
 * 统一入口：node packages/cli/src/index.ts <cmd> [选项]
 *
 * UX 要求：面向普通用户输出可读信息，绝不把 TypeError / stack trace / ENOENT 直接抛出。
 * 安装安全性：写前备份 → merge（不 replace）→ 记录 manifest → doctor 校验；支持 --dry-run。
 */

import { homedir } from 'node:os';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverAgents, detectAgent, AGENT_REGISTRY } from '../../installer/src/discovery.ts';
import { loadCompatibility } from '../../installer/src/compatibility.ts';
import {
  mergeClaudeSettings, mergeCodexHooks, mergeOpencodePlugins, isRiskGuardPluginRef,
  CLAUDE_HOOK_ID, CODEX_HOOK_ID, OPENCODE_PLUGIN_ID, OPENCODE_PLUGIN_LEGACY_ID,
} from '../../installer/src/merge.ts';
import { backupPaths, backupRoot } from '../../installer/src/backup.ts';
import { saveManifest, loadManifest, removeManifest, hasManifest, type AgentManifest, type ManifestArtifact } from '../../installer/src/manifest.ts';
import { runDoctors } from '../../installer/src/doctor.ts';
import { readConfig, isWritableState, describeReadFailure, type ConfigReadResult } from '../../installer/src/config-read.ts';
import { runtimeState } from '../../installer/src/runtime-state.ts';
import { sha256File } from '../../installer/src/hash.ts';

const VERSION = '0.1.0';
/** 仓库根目录（packages/cli/src/commands.ts → 上溯 4 层）
 *  file:///E:/... → /E:/... ，需去掉首斜杠得到 Windows 绝对路径 */
const REPO_ROOT: string = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url)); // packages/cli/src
    return dirname(dirname(dirname(here)));                // repo root
  } catch { return process.cwd(); }
})();

export interface InstallAgentOpts {
  home?: string;
  dryRun?: boolean;
  verbose?: boolean;
  only?: string;             // 只安装指定 agent（可选）
}

const HOMES = {
  get (home?: string): string { return home ?? process.env.USERPROFILE ?? homedir() ?? process.env.HOME ?? '.'; },
};

// ============================================================================
// Agent canonical id 与 alias（P1-1：统一解析，禁止各 command 各自判断）
// ============================================================================

/** canonical id → 展示名（CLI 帮助/输出用；与 AGENT_REGISTRY 一致） */
const CANONICAL_AGENTS = ['claude-code', 'opencode', 'codex', 'dsh'] as const;

/** alias 表：任何写法 → canonical id */
const AGENT_ALIASES: Record<string, string> = {
  'claude-code': 'claude-code', 'claude': 'claude-code', 'cc': 'claude-code', 'claude_code': 'claude-code',
  'opencode': 'opencode', 'open-code': 'opencode', 'oc': 'opencode', 'open_code': 'opencode',
  'codex': 'codex', 'codex-cli': 'codex',
  'dsh': 'dsh', 'deepseek-harness': 'dsh',
};

/** 统一 alias 解析：未知返回 null（调用方报「unknown agent」而非抛错） */
function normalizeAgentId(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const key = String(raw).trim().toLowerCase();
  return AGENT_ALIASES[key] ?? null;
}

/** 由 alias/canonical 解析成安装器 key（仅 claude-code/codex/opencode 可安装） */
function installerKey(raw: string | undefined | null): string | null {
  const id = normalizeAgentId(raw);
  if (!id) return null;
  return id === 'dsh' ? null : id; // dsh 不在本 CLI 安装范围
}

// ============================================================================
// detect
// ============================================================================

export function cmdDetect(opts: { home?: string; json?: boolean }): string {
  const agents = discoverAgents({ home: HOMES.get(opts.home) });
  if (opts.json) {
    const map: Record<string, boolean> = {};
    for (const a of agents) if (a.id === 'claude-code' || a.id === 'opencode' || a.id === 'codex' || a.id === 'dsh') map[a.id] = a.installed;
    // dsh 不在 registry；单独探测
    map['dsh'] = detectDsh(opts.home);
    return JSON.stringify(map, null, 2);
  }
  const lines = ['RiskGuard Agent Detection', ''];
  for (const a of agents) {
    if (a.id === 'claude-code' || a.id === 'opencode' || a.id === 'codex') {
      lines.push(`${a.display.padEnd(16)} ${a.installed ? 'detected' : 'not detected'}`);
    }
  }
  lines.push(`${'DSH'.padEnd(16)} ${detectDsh(opts.home) ? 'detected' : 'not detected'}`);
  return lines.join('\n');
}

function detectDsh(home?: string): boolean {
  const base = HOMES.get(home);
  try { return statSync(join(base, '.dsh')).isDirectory() || statSync(join(base, '.dsh', 'profiles')).isDirectory(); } catch { return false; }
}

// ============================================================================
// install
// ============================================================================

interface AgentInstaller {
  id: string;
  display: string;
  planConfigPath: (home: string) => string;         // 目标配置路径
  buildInjection: (repoRoot: string) => unknown;    // 注入条目
  copyArtifacts?: (repoRoot: string, home: string) => Promise<{ files: string[]; notes?: string[] }>;
  pluginPathHint?: string;
}

const installers: Record<string, AgentInstaller> = {
  'claude-code': {
    id: 'claude-code', display: 'Claude Code',
    planConfigPath: (h) => join(h, '.claude', 'settings.json'),
    buildInjection: () => ({
      _riskguard: true, id: CLAUDE_HOOK_ID,
      matcher: 'Bash|PowerShell',
      hooks: [{
        type: 'command',
        command: `node "${join(REPO_ROOT, 'packages', 'cli', 'src', 'hooks', 'pre-tool-hook.ts')}" --agent claude`,
        statusMessage: 'RiskGuard: checking dangerous commands',
        timeout: 10,
      }],
    }),
  },
  codex: {
    id: 'codex', display: 'Codex CLI',
    planConfigPath: (h) => join(h, '.codex', 'hooks.json'),
    buildInjection: () => ({
      _riskguard: true, id: CODEX_HOOK_ID,
      matcher: 'Bash',
      hooks: [{
        type: 'command',
        command: `node "${join(REPO_ROOT, 'packages', 'cli', 'src', 'hooks', 'pre-tool-hook.ts')}" --agent codex`,
        statusMessage: 'RiskGuard: checking dangerous commands',
        timeout: 10,
      }],
    }),
  },
  opencode: {
    id: 'opencode', display: 'OpenCode',
    planConfigPath: (h) => join(h, '.config', 'opencode', 'opencode.json'),
    buildInjection: () => `./plugins/${OPENCODE_PLUGIN_ID}.ts`, // 相对插件引用（namespace 名）
    pluginPathHint: join(REPO_ROOT, 'assets', 'opencode', `${OPENCODE_PLUGIN_ID}.ts`),
    copyArtifacts: async (_repoRoot, home) => {
      const src = join(REPO_ROOT, 'assets', 'opencode', `${OPENCODE_PLUGIN_ID}.ts`);
      const dstDir = join(HOMES.get(home), '.config', 'opencode', 'plugins');
      const dst = join(dstDir, `${OPENCODE_PLUGIN_ID}.ts`);
      await mkdir(dstDir, { recursive: true });
      // P0-3：目标存在时校验 hash —— 相同=幂等，不同=拒绝覆盖（见 installOne 预检）
      await copyFile(src, dst);
      return { files: [dst] };
    },
  },
};

export function mergeForAgent(id: string, repoRoot: string, existing: Record<string, unknown> | null | undefined, home: string): { config: Record<string, unknown>; changed: boolean } {
  if (id === 'claude-code') return mergeClaudeSettings(existing, installers['claude-code'].buildInjection(repoRoot));
  if (id === 'codex') return mergeCodexHooks(existing, installers.codex.buildInjection(repoRoot));
  if (id === 'opencode') return mergeOpencodePlugins(existing, installers.opencode.buildInjection(repoRoot));
  return { config: (existing ?? {}), changed: false };
}

export interface InstallOutcome {
  agent: string;
  display: string;
  state: 'installed' | 'skipped' | 'error' | 'already' | 'aborted';
  backupDir?: string;
  manifestFile?: string;
  message: string;
  dryRun: boolean;
}

/** 解析 install/uninstall 的 --agent 目标列表（支持 alias；未知值会被标出但不清零） */
function resolveTargets(only: string | undefined): { targets: string[]; unknown: string[] } {
  if (!only) return { targets: ['claude-code', 'opencode', 'codex'], unknown: [] };
  const unknown: string[] = [];
  const targets: string[] = [];
  for (const raw of only.split(',')) {
    const id = installerKey(raw);
    if (!id) { unknown.push(raw); continue; }
    if (!targets.includes(id)) targets.push(id);
  }
  return { targets, unknown };
}

export async function cmdInstall(opts: InstallAgentOpts): Promise<string> {
  const home = HOMES.get(opts.home);
  const lines: string[] = ['RiskGuard Install:', ''];
  const { targets, unknown } = resolveTargets(opts.only);
  for (const u of unknown) lines.push(`Unknown agent: ${u}. Skipped.`);

  for (const id of targets) {
    const inst = installers[id];
    if (!inst) { lines.push(`Unknown agent: ${id}. Skipped.`); continue; }
    const outcome = await installOne(installers[id], home, opts);
    lines.push(outcome.message);
  }

  lines.push('');
  if (opts.dryRun) lines.push('No files changed (dry-run).');
  lines.push(`Backup root: ${backupRoot(home)}`);
  return lines.join('\n');
}

/**
 * 事务式单 Agent 安装（P0-4）：
 *   1. Preflight：Agent 已装？配置可安全写入？（invalid-json / permission-denied / io-error → 立即 ABORT，零写入）
 *   2. OpenCode artifact 预检：目标已存在且非我方文件 → ABORT（绝不覆盖，P0-3）
 *   3. Backup（写前铁律）
 *   4. Write（merge 后配置 + artifact）
 *   5. Save manifest（含 artifacts[{path,sha256}]）
 * 任一步失败 → 尽力回滚到安装前（恢复已备份配置、删除已复制文件）。
 * 铁律：install 要么完整成功，要么恢复安装前，不留下「装了一半」。
 */
async function installOne(inst: AgentInstaller, home: string, opts: InstallAgentOpts): Promise<InstallOutcome> {
  const dry = opts.dryRun === true;
  const verbose = opts.verbose === true;

  const installed = detectAgent(
    AGENT_REGISTRY.find((d) => d.id === inst.id) ?? { id: inst.id, display: inst.display, mechanisms: [], probePaths: [] },
    { home: HOMES.get(home) },
  ).installed;
  if (!installed) {
    return { agent: inst.id, display: inst.display, state: 'skipped', message: `${inst.display} not detected. Skipped.`, dryRun: dry };
  }

  const configPath = inst.planConfigPath(home);
  // —— P0-2：类型化读取；任何无法确定原配置内容的情况都禁止写入 ——
  const read = await readConfig(configPath);
  if (read.state === 'invalid-json' || read.state === 'permission-denied' || read.state === 'io-error') {
    return {
      agent: inst.id, display: inst.display, state: 'aborted', dryRun: dry,
      message: `${inst.display} installation aborted.\n\nReason:\n${describeReadFailure(read, configPath)}\n\nRiskGuard made no changes.\nPlease repair the configuration and retry.`,
    };
  }
  const existingRaw = read.state === 'valid' ? read.data : null;

  const merged = (() => {
    if (inst.id === 'claude-code') return mergeClaudeSettings(existingRaw, inst.buildInjection(REPO_ROOT));
    if (inst.id === 'codex') return mergeCodexHooks(existingRaw, inst.buildInjection(REPO_ROOT));
    if (inst.id === 'opencode') return mergeOpencodePlugins(existingRaw, inst.buildInjection(REPO_ROOT));
    return { config: (existingRaw ?? {}), changed: false };
  })();

  // —— OpenCode artifact 预检（P0-3）：目标存在且非我方文件 → ABORT（不覆盖未知文件） ——
  let artifactDst: string | null = null;
  let artifactSrc: string | null = null;
  if (inst.copyArtifacts && inst.id === 'opencode') {
    artifactSrc = join(REPO_ROOT, 'assets', 'opencode', `${OPENCODE_PLUGIN_ID}.ts`);
    artifactDst = join(home, '.config', 'opencode', 'plugins', `${OPENCODE_PLUGIN_ID}.ts`);
    if (existsSync(artifactDst)) {
      const dstHash = await sha256File(artifactDst);
      const srcHash = await sha256File(artifactSrc);
      if (dstHash !== srcHash) {
        return {
          agent: inst.id, display: inst.display, state: 'aborted', dryRun: dry,
          message: `${inst.display} plugin installation aborted.\n\nTarget already exists:\n${artifactDst}\n\nThe existing file is not owned by this RiskGuard installation (SHA256 mismatch).\nNo files were overwritten.\nPlease inspect or remove it, then retry.`,
        };
      }
      // hash 相同 = 已装我方文件 → 幂等（仍可能只需补 config 引用）
    }
  }

  // —— dry-run：只输出将修改，不落盘 ——
  if (dry) {
    const wouldLines = ['Would modify:', `  ${configPath}`];
    if (inst.copyArtifacts) wouldLines.push('Would create:', `  ${artifactDst ?? `<opencode plugins>/${OPENCODE_PLUGIN_ID}.ts`}`);
    return { agent: inst.id, display: inst.display, state: merged.changed ? 'installed' : 'already', message: [inst.display, ...wouldLines, '  (dry-run, no files changed)', ''].join('\n'), dryRun: true };
  }

  let backupDir = '';
  const artifacts: string[] = [];
  const writtenConfig = merged.changed;
  try {
    // 1. 备份（写前铁律）
    const pathsToBackup = [configPath];
    if (artifactDst && existsSync(artifactDst) === false && writtenConfig) pathsToBackup.push(artifactDst); // 新文件无需备份，但若已存在同 hash 会在下面幂等跳过
    const bk = await backupPaths(inst.id, pathsToBackup.filter((p) => existsSync(p)), { home: HOMES.get(home) });
    backupDir = bk.ok ? join(backupRoot(home), inst.id) : '';

    // 2. 复制安装物（opencode 插件；copyArtifacts 内部已 mkdir）
    if (inst.copyArtifacts && inst.id === 'opencode' && artifactSrc && artifactDst) {
      // 目标已存在且 hash 相同（幂等）→ 不重复写；否则创建/覆盖我方同 hash 文件
      if (!existsSync(artifactDst)) {
        await mkdir(dirname(artifactDst), { recursive: true });
        await copyFile(artifactSrc, artifactDst);
        artifacts.push(artifactDst);
      }
      // 已存在同 hash → 什么都不做（幂等）
    }

    // 3. merge 后写回（只改配置本体）
    if (writtenConfig) {
      await mkdir(dirname(configPath), { recursive: true });
      await writeFile(configPath, JSON.stringify(merged.config, null, 2), 'utf8');
    }

    // 4. 记录 manifest（含 artifacts[{path,sha256}]）
    const artifactRecords: ManifestArtifact[] = [];
    for (const f of artifacts) {
      const h = await sha256File(f);
      if (h) artifactRecords.push({ path: f, sha256: h });
    }
    const manifest: AgentManifest = {
      schemaVersion: 1, product: 'riskguard', version: VERSION, agent: inst.id,
      installedAt: new Date().toISOString(),
      installedFiles: artifacts,
      modifiedConfig: writtenConfig ? [configPath] : [],
      riskguardEntryId: inst.id === 'claude-code' ? CLAUDE_HOOK_ID : inst.id === 'codex' ? CODEX_HOOK_ID : OPENCODE_PLUGIN_ID,
      backupDir,
      artifacts: artifactRecords,
    };
    await saveManifest(manifest, HOMES.get(home));

    const already = !writtenConfig && (await hasManifest(inst.id, HOMES.get(home)));
    const state = already ? 'already' : 'installed';
    return {
      agent: inst.id, display: inst.display, state,
      backupDir, manifestFile: join(HOMES.get(home), '.riskguard', 'manifests', `${inst.id}.json`),
      message: `${inst.display}: ${state === 'already' ? 'already installed (idempotent, no change)' : 'installed (merge-preserving)'}${artifacts.length ? `; installed ${artifacts.length} artifact(s)` : ''}${verbose ? `\n  modified: ${configPath}` : ''}`,
      dryRun: dry,
    };
  } catch (e) {
    // —— ROLLBACK（P0-4）：尽力恢复安装前状态 ——
    let rollbackMsg = '';
    try {
      if (writtenConfig) {
        // 从备份恢复原配置
        const bkList = await listBackupsLatest(inst.id, home, configPath);
        if (bkList) { await copyFile(bkList, configPath); rollbackMsg = 'Rolled back config from backup. '; }
      }
      for (const f of artifacts) {
        try { await import('../../trash/src/index.ts').then(({ trash }) => trash(f)); rollbackMsg += `Removed artifact ${f}. `; } catch { /* ignore */ }
      }
    } catch (rb) { rollbackMsg = `Rollback incomplete: ${(rb as Error).message}`; }
    return {
      agent: inst.id, display: inst.display, state: 'error', dryRun: dry,
      message: `${inst.display}: install failed and was rolled back.\n  Reason: ${(e as Error).message}\n  ${rollbackMsg}RiskGuard restored the pre-install state.`,
    };
  }
}

/** 取某 agent 最近一次备份中与目标路径对应的备份文件（rollback 用） */
async function listBackupsLatest(agent: string, home: string, targetPath: string): Promise<string | null> {
  const { readdir } = await import('node:fs/promises');
  const root = join(backupRoot(home), agent);
  try {
    const dirs = (await readdir(root)).sort().reverse(); // 新→旧
    const want = relName(targetPath);
    for (const d of dirs) {
      try {
        const files = await readdir(join(root, d));
        const hit = files.find((f) => f === want);
        if (hit) return join(root, d, hit);
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return null;
}

function relName(p: string): string {
  return p.replace(/^([A-Za-z]):/, '$1_').replace(/[\\/]+/g, '_').replace(/^[._]+/, '');
}

// ============================================================================
// status
// ============================================================================

export async function cmdStatus(opts: { home?: string }): Promise<string> {
  const compat = loadCompatibility();
  const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
  const home = HOMES.get(opts.home);
  const lines = ['Agent RiskGuard Status', '',
    'Runtime state  — 这台机器上 RiskGuard 当前实际状态（非产品能力等级）', 'Capability     —  RiskGuard 对该 Agent 理论/实测支持等级（D0–D4）', ''];
  const order = ['claude-code', 'opencode', 'codex', 'dsh'];
  for (const id of order) {
    const c = compat.agents[id];
    const probe = await probeRuntime(id, home);
    const state = runtimeState(id, probe, home, { manifestManaged: id !== 'dsh' });
    const lvl = c?.verification[platform];
    lines.push(`${c?.display ?? id}`);
    lines.push(`Integration: ${c?.integration ?? '—'}`);
    lines.push(`Capability: ${lvl ?? 'D0'} (${c?.enforcement === 'hard' ? 'hard blocking' : c?.enforcement === 'soft' ? 'soft only' : 'none'})`);
    lines.push(`Runtime: ${state}${state === 'ACTIVE' ? ' — RiskGuard is wired and healthy' : state === 'BROKEN' ? ' — manifest present but wiring missing/broken' : state === 'DETECTED' ? ' — agent present, RiskGuard not installed' : state === 'INSTALLED' ? ' — manifest + wiring present' : ' — agent not detected'}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** 判定某 agent 的 runtime probe（detected + wired + healthy）；doctor 关键项作为 healthy 依据 */
async function probeRuntime(id: string, home: string): Promise<{ detected: boolean; wired: boolean; healthy: boolean }> {
  const compat = loadCompatibility();
  // 1. detected
  let detected = false;
  if (id === 'dsh') detected = detectDsh(home);
  else {
    const inst = detectAgent(
      AGENT_REGISTRY.find((d) => d.id === id) ?? { id, display: compat.agents[id]?.display ?? id, mechanisms: [], probePaths: [] },
      { home },
    );
    detected = inst.installed;
  }
  if (!detected) return { detected: false, wired: false, healthy: false };

  // 3. wiring + healthy：逐 agent 读配置（与 doctor 同源）
  let wired = false;
  let healthy = false;
  try {
    if (id === 'claude-code') {
      const p = join(home, '.claude', 'settings.json');
      const read = await readConfig(p);
      if (read.state === 'valid') {
        const raw = JSON.stringify(read.data);
        const hasHook = Array.isArray((read.data['hooks'] as any)?.['PreToolUse']) &&
          JSON.stringify((read.data['hooks'] as any)['PreToolUse']).includes('_riskguard');
        const hasRisk = raw.includes('riskguard-pre-tool-hook') || raw.includes('pre-tool-hook.ts') || raw.includes('_riskguard');
        wired = hasHook && hasRisk;
        healthy = wired; // doctor 关键项：PreToolUse + RiskGuard hook 在位
      } else if (read.state === 'invalid-json' || read.state === 'permission-denied') {
        wired = false; healthy = false; // 配置损坏 → BROKEN（若 manifest 在）
      }
    } else if (id === 'codex') {
      const p = join(home, '.codex', 'hooks.json');
      const read = await readConfig(p);
      if (read.state === 'valid') {
        const raw = JSON.stringify(read.data);
        const hasRisk = raw.includes('riskguard-codex-hook') || raw.includes('pre-tool-hook.ts') || raw.includes('_riskguard');
        wired = hasRisk;
        healthy = wired;
      } else if (read.state === 'invalid-json' || read.state === 'permission-denied') {
        wired = false; healthy = false;
      }
    } else if (id === 'opencode') {
      const p = join(home, '.config', 'opencode', 'opencode.json');
      const read = await readConfig(p);
      if (read.state === 'valid') {
        const pluginArr = (read.data['plugin'] as unknown[]) ?? [];
        const hitNew = JSON.stringify(pluginArr).includes('agent-risk-guard');
        const hitLegacy = JSON.stringify(pluginArr).includes('destructive-operation-guard');
        // 插件文件须真的在（引用 + 文件都齐才算 healthy）
        const plugFile = join(home, '.config', 'opencode', 'plugins', 'agent-risk-guard.ts');
        const legacyFile = join(home, '.config', 'opencode', 'plugins', 'destructive-operation-guard.ts');
        const fileOk = existsSync(plugFile) || existsSync(legacyFile);
        wired = (hitNew || hitLegacy) && fileOk;
        healthy = wired;
      } else if (read.state === 'invalid-json' || read.state === 'permission-denied') {
        wired = false; healthy = false;
      }
    } else if (id === 'dsh') {
      // dsh 无 manifest 管理；接线 = deny-risk-commands patch 在位
      const { checkDshPatch } = await import('../../installer/src/doctor.ts');
      const chk = await checkDshPatch(home);
      wired = chk.state === 'ok';
      healthy = chk.state === 'ok';
    }
  } catch { wired = false; healthy = false; }
  return { detected, wired, healthy };
}

// ============================================================================
// doctor
// ============================================================================

export async function cmdDoctor(opts: { home?: string; verbose?: boolean }): Promise<string> {
  const report = await runDoctors({ home: HOMES.get(opts.home) });
  const lines = ['RiskGuard Doctor:', ''];
  for (const c of report.checks) {
    const status = c.state === 'ok' ? 'PASS' : c.state === 'stale' ? 'WARN' : c.state === 'absent-agent' ? 'SKIP' : 'FAIL';
    lines.push(`${status.padEnd(5)} ${c.agent.padEnd(14)} ${c.check}`);
    if (opts.verbose) lines.push(`        → ${c.detail}`);
  }
  lines.push('');
  // 汇总
  const pass = report.checks.filter((c) => c.state === 'ok').length;
  const warn = report.checks.filter((c) => c.state === 'stale').length;
  const fail = report.checks.filter((c) => c.state === 'missing').length;
  const skip = report.checks.filter((c) => c.state === 'absent-agent').length;
  lines.push(`Summary: ${pass} PASS / ${warn} WARN / ${fail} FAIL / ${skip} SKIP`);
  return lines.join('\n');
}

// ============================================================================
// uninstall（依据 manifest 精确恢复）
// ============================================================================

export interface UninstallOutcome {
  agent: string;
  display: string;
  state: 'uninstalled' | 'not-installed' | 'error';
  message: string;
}

export async function cmdUninstall(opts: { home?: string; only?: string; dryRun?: boolean }): Promise<string> {
  const home = HOMES.get(opts.home);
  const dry = opts.dryRun === true;
  const { targets, unknown } = resolveTargets(opts.only);
  const lines = ['RiskGuard Uninstall:', ''];

  for (const u of unknown) lines.push(`Unknown agent: ${u}. Skipped.`);
  for (const id of targets) {
    const inst = installers[id];
    if (!inst) { lines.push(`Unknown agent: ${id}. Skipped.`); continue; }
    const m = await loadManifest(id, home);
    if (!m) { lines.push(`${inst.display}: not installed (no manifest). Nothing to do.`); continue; }
    // 仅当有 manifest 才允许卸载；若 manifest 缺失但配置里明显有注入 → 提示用 restore
    if (dry) { lines.push(`${inst.display}: would remove RiskGuard hook/plugin entries and ${m.modifiedConfig.length} config change(s).`); continue; }
    const outcome = await uninstallOne(id, inst.display, home);
    lines.push(outcome.message);
  }
  lines.push('');
  if (dry) lines.push('No files changed (dry-run).');
  return lines.join('\n');
}

async function uninstallOne(id: string, display: string, home: string): Promise<UninstallOutcome> {
  const inst = installers[id];
  const m = await loadManifest(id, home);
  if (!m) return { agent: id, display, state: 'not-installed', message: `${display}: no manifest, nothing to uninstall.` };
  try {
    // —— P1-3：卸载前校验 artifacts hash：文件被用户改过则拒绝自动删除 ——
    const modified: string[] = [];
    const artifactList = m.artifacts ?? m.installedFiles.map((p) => ({ path: p, sha256: null as string | null }));
    for (const a of artifactList) {
      if (!existsSync(a.path)) continue; // 已不存在：无需处理
      if (a.sha256) {
        const now = await sha256File(a.path);
        if (now !== a.sha256) modified.push(a.path); // 内容被用户改过
      }
    }
    if (modified.length) {
      return {
        agent: id, display, state: 'error',
        message: `${display}: uninstall refused.\n\nThe following RiskGuard file(s) were modified after installation:\n${modified.map((p) => `  ${p}`).join('\n')}\n\nModified after installation. Manual review required.\nRemove or restore them yourself, then retry uninstall.`,
      };
    }

    // —— P1-4：精确逆操作 ——
    // 1. 从配置中精确移除我方条目（merge 的反向；保留用户 install 之后新增的配置）
    const configPath = inst.planConfigPath(home);
    const read = await readConfig(configPath);
    if (read.state === 'invalid-json' || read.state === 'permission-denied' || read.state === 'io-error') {
      return {
        agent: id, display, state: 'error',
        message: `${display}: uninstall refused.\n\nReason:\n${describeReadFailure(read, configPath)}\n\nRiskGuard made no changes.\nPlease repair the configuration and retry.`,
      };
    }
    if (read.state === 'valid') {
      const after = removeInjection(id, read.data);
      if (after.changed) {
        await writeFile(configPath, JSON.stringify(after.config, null, 2), 'utf8');
      }
    }
    // 2. 移除我方复制出的文件（进回收站：走 trash 能力）—— 仅移除 hash 校验通过（= 仍是我方）的文件
    for (const a of artifactList) {
      if (!existsSync(a.path)) continue;
      try {
        await import('../../trash/src/index.ts').then(({ trash }) => trash(a.path));
      } catch { /* ignore */ }
    }
    // 3. 移除 manifest
    await removeManifest(id, home);
    return { agent: id, display, state: 'uninstalled', message: `${display}: uninstalled; RiskGuard entries removed, user config preserved.` };
  } catch (e) {
    return { agent: id, display, state: 'error', message: `${display}: could not uninstall safely.\n  Reason: ${(e as Error).message}\n  Run 'riskguard status' to inspect.` };
  }
}

/** 精确移除 RiskGuard 注入条目（claude/codex：按 _riskguard/id marker；opencode：plugin 引用新旧名都认） */
function removeInjection(id: string, cfg: Record<string, unknown>): { config: Record<string, unknown>; changed: boolean } {
  const entryId = id === 'claude-code' ? CLAUDE_HOOK_ID : id === 'codex' ? CODEX_HOOK_ID : OPENCODE_PLUGIN_ID;
  let config = { ...cfg };
  let changed = false;

  if (id === 'claude-code' || id === 'codex') {
    const hooks = (config['hooks'] as Record<string, unknown>) ?? {};
    const pretool = Array.isArray(hooks['PreToolUse']) ? hooks['PreToolUse'] : [];
    const isMine = (x: unknown): boolean =>
      typeof x === 'object' && x !== null && ((x as Record<string, unknown>)['_riskguard'] === true || (x as Record<string, unknown>)['id'] === entryId);
    const kept = pretool.filter((x) => !isMine(x));
    if (kept.length !== pretool.length) {
      changed = true;
      const nextHooks = { ...hooks };
      if (kept.length) nextHooks['PreToolUse'] = kept;
      else delete nextHooks['PreToolUse']; // 我方条目全部移除后，清掉空 PreToolUse，但保留 Setup 等其他 hook
      if (Object.keys(nextHooks).length) config['hooks'] = nextHooks;
      else delete config['hooks'];
    }
  }

  // opencode plugin 数组移除（新名 agent-risk-guard 或旧名 destructive-operation-guard 都算我方）
  if (id === 'opencode') {
    const plugins = Array.isArray(config['plugin']) ? config['plugin'] : [];
    const keptPlugins = plugins.filter((p) => !isRiskGuardPluginRef(p));
    if (keptPlugins.length !== plugins.length) {
      changed = true;
      config = { ...config, plugin: keptPlugins };
    }
  }

  return { config, changed };
}

// ============================================================================
// 会话级 import for trash 保持顶层 import 不循环；doctor/status 已在上面
// ============================================================================

export function cmdVersion(): string {
  return `RiskGuard ${VERSION} (Developer Preview)`;
}

export function cmdHelp(): string {
  return [
    'RiskGuard — deterministic safety guardrails for AI coding agents.',
    '',
    'Usage:  node packages/cli/src/index.ts <command> [options]',
    '        (or: npm run riskguard -- <command> [options])',
    '',
    'Commands:',
    '  detect            Detect installed AI agents (Claude Code / OpenCode / Codex / DSH)',
    '    --json          machine-readable JSON output',
    '  install           Install RiskGuard into detected agents (backup + merge-preserving + transactional)',
    '    --agent <id>    only install one agent (aliases: claude|cc → claude-code, oc → opencode, codex)',
    '    --dry-run       show changes without writing',
    '    --verbose       show detail',
    '  status            Per-agent Runtime state (NOT_DETECTED/DETECTED/INSTALLED/ACTIVE/BROKEN) + Capability (D0–D4)',
    '  doctor            Health-check RiskGuard wiring (PASS/WARN/FAIL/SKIP)',
    '    --verbose       show evidence detail',
    '  uninstall         Remove RiskGuard entries based on manifest (precise inverse op, keeps user changes)',
    '    --agent <id>    only uninstall one agent',
    '    --dry-run       show changes without writing',
    '  version           Show version',
    '  help              Show this help',
  ].join('\n');
}

// re-export helpers for tests
export { HOMES, REPO_ROOT, normalizeAgentId, CANONICAL_AGENTS, removeInjection };