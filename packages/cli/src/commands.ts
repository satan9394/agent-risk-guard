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
import { mkdir, writeFile, copyFile, readFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverAgents, detectAgent, AGENT_REGISTRY } from '../../installer/src/discovery.ts';
import { loadCompatibility, type VerificationLevel } from '../../installer/src/compatibility.ts';
import {
  mergeClaudeSettings, mergeCodexHooks, mergeOpencodePlugins,
  CLAUDE_HOOK_ID, CODEX_HOOK_ID, OPENCODE_PLUGIN_ID,
} from '../../installer/src/merge.ts';
import { backupPaths, backupRoot } from '../../installer/src/backup.ts';
import { saveManifest, loadManifest, removeManifest, type AgentManifest } from '../../installer/src/manifest.ts';
import { runDoctors } from '../../installer/src/doctor.ts';

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
    buildInjection: () => `./plugins/${OPENCODE_PLUGIN_ID}.ts`, // 相对插件引用
    pluginPathHint: join(REPO_ROOT, 'assets', 'opencode', 'destructive-operation-guard.ts'),
    copyArtifacts: async (_repoRoot, home) => {
      const src = join(REPO_ROOT, 'assets', 'opencode', 'destructive-operation-guard.ts');
      const dstDir = join(HOMES.get(home), '.config', 'opencode', 'plugins');
      const dst = join(dstDir, `${OPENCODE_PLUGIN_ID}.ts`);
      await mkdir(dstDir, { recursive: true });
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
  state: 'installed' | 'skipped' | 'error' | 'already';
  backupDir?: string;
  manifestFile?: string;
  message: string;
  dryRun: boolean;
}

export async function cmdInstall(opts: InstallAgentOpts): Promise<string> {
  const home = HOMES.get(opts.home);
  const lines: string[] = ['RiskGuard Install:', ''];
  const targets = opts.only ? [opts.only] : ['claude-code', 'opencode', 'codex'];

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
  const existingRaw = await safeRead(configPath);

  const merged = (() => {
    if (inst.id === 'claude-code') return mergeClaudeSettings(existingRaw, inst.buildInjection(REPO_ROOT));
    if (inst.id === 'codex') return mergeCodexHooks(existingRaw, inst.buildInjection(REPO_ROOT));
    if (inst.id === 'opencode') return mergeOpencodePlugins(existingRaw, inst.buildInjection(REPO_ROOT));
    return { config: (existingRaw ?? {}), changed: false };
  })();

  let backupDir = '';
  const artifacts: string[] = [];

  // —— dry-run：只输出将修改，不落盘 ——
  if (dry) {
    const wouldLines = ['Would modify:', `  ${configPath}`];
    if (inst.copyArtifacts) wouldLines.push('Would create:', `  <opencode plugins>/${OPENCODE_PLUGIN_ID}.ts`);
    return { agent: inst.id, display: inst.display, state: merged.changed ? 'installed' : 'already', message: [inst.display, ...wouldLines, '  (dry-run, no files changed)', ''].join('\n'), dryRun: true };
  }

  try {
    // 1. 备份（写前铁律）
    const bk = await backupPaths(inst.id, [configPath], { home: HOMES.get(home) });
    backupDir = bk.backupRoot && bk.entries.length ? join(bk.backupRoot, inst.id) : '';

    // 2. 复制安装物（插件文件）
    if (inst.copyArtifacts) {
      const r = await inst.copyArtifacts(REPO_ROOT, home);
      artifacts.push(...r.files);
    }

    // 3. merge 后写回（只改配置本体）
    if (merged.changed || artifacts.length) {
      await mkdir(dirname(configPath), { recursive: true });
      await writeFile(configPath, JSON.stringify(merged.config, null, 2), 'utf8');
    }

    // 4. 记录 manifest
    const manifest: AgentManifest = {
      product: 'riskguard', version: VERSION, agent: inst.id,
      installedAt: new Date().toISOString(),
      installedFiles: artifacts,
      modifiedConfig: merged.changed ? [configPath] : [],
      riskguardEntryId: inst.id === 'claude-code' ? CLAUDE_HOOK_ID : inst.id === 'codex' ? CODEX_HOOK_ID : OPENCODE_PLUGIN_ID,
      backupDir,
    };
    await saveManifest(manifest, HOMES.get(home));

    const state = merged.changed ? 'installed' : (await loadManifest(inst.id, HOMES.get(home)) ? 'already' : 'installed');
    return {
      agent: inst.id, display: inst.display, state,
      backupDir, manifestFile: join(HOMES.get(home), '.riskguard', 'manifests', `${inst.id}.json`),
      message: `${inst.display}: ${state === 'already' ? 'already installed (idempotent, no change)' : (merged.changed ? 'installed (merge-preserving)' : 'installed')}${artifacts.length ? `; copied ${artifacts.length} artifact(s)` : ''}${verbose ? `\n  modified: ${configPath}` : ''}`,
      dryRun: dry,
    };
  } catch (e) {
    return { agent: inst.id, display: inst.display, state: 'error', message: `${inst.display}: could not update config.\n  Reason: ${(e as Error).message}\n  No additional changes were made.`, dryRun: dry };
  }
}

async function safeRead(p: string): Promise<Record<string, unknown> | null> {
  try { return JSON.parse(await readFile(p, 'utf8')) as Record<string, unknown>; }
  catch { return null; }
}

// ============================================================================
// status
// ============================================================================

export function cmdStatus(opts: { home?: string }): string {
  const compat = loadCompatibility();
  const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
  const home = HOMES.get(opts.home);
  const lines = ['Agent RiskGuard Status', ''];
  const order = ['claude-code', 'opencode', 'codex', 'dsh'];
  for (const id of order) {
    const c = compat.agents[id];
    let installed = false;
    if (id === 'dsh') installed = detectDsh(home);
    else {
      const inst = detectAgent(
        AGENT_REGISTRY.find((d) => d.id === id) ?? { id, display: c?.display ?? id, mechanisms: [], probePaths: [] },
        { home },
      );
      installed = inst.installed;
    }
    const lvl = c?.verification[platform];
    const active = installed && lvl && lvl !== 'D0';
    lines.push(`${c?.display ?? id}`);
    lines.push(`Integration: ${c?.integration ?? '—'}`);
    lines.push(`Hard blocking: ${c?.enforcement === 'hard' ? 'enabled' : c?.enforcement === 'soft' ? 'soft only' : 'none'}`);
    lines.push(`Verification: ${lvl ?? 'D0'}`);
    lines.push(`Status: ${active ? 'ACTIVE' : installed ? 'DETECTED' : 'NOT DETECTED'}`);
    if (c?.enforcement === 'soft') lines.push('Enforcement: soft');
    lines.push('');
  }
  return lines.join('\n');
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
  const targets = opts.only ? [opts.only] : ['claude-code', 'opencode', 'codex'];
  const lines = ['RiskGuard Uninstall:', ''];

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
    // 1. 从配置中精确移除我方条目（merge 的反向）
    const configPath = inst.planConfigPath(home);
    const existing = await safeRead(configPath);
    if (existing) {
      const after = removeInjection(id, existing);
      if (after.changed) {
        await writeFile(configPath, JSON.stringify(after.config, null, 2), 'utf8');
      }
    }
    // 2. 移除我方复制出的文件（进回收站：走 trash 能力）
    for (const f of m.installedFiles) {
      try {
        await import('../../trash/src/index.ts').then(({ trash }) => trash(f));
      } catch { /* ignore */ }
    }
    // 3. 移除 manifest
    await removeManifest(id, home);
    return { agent: id, display, state: 'uninstalled', message: `${display}: uninstalled; RiskGuard entries removed, user config preserved.` };
  } catch (e) {
    return { agent: id, display, state: 'error', message: `${display}: could not uninstall safely.\n  Reason: ${(e as Error).message}\n  Run 'riskguard status' / 'restore' to inspect.` };
  }
}

function removeInjection(id: string, cfg: Record<string, unknown>): { config: Record<string, unknown>; changed: boolean } {
  const entryId = id === 'claude-code' ? CLAUDE_HOOK_ID : id === 'codex' ? CODEX_HOOK_ID : OPENCODE_PLUGIN_ID;
  let config = { ...cfg };
  let changed = false;

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

  // opencode plugin 数组移除
  if (id === 'opencode') {
    const plugins = Array.isArray(config['plugin']) ? config['plugin'] : [];
    const keptPlugins = plugins.filter((p) => !String(p ?? '').includes(OPENCODE_PLUGIN_ID));
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
    '  install           Install RiskGuard into detected agents (backup + merge-preserving)',
    '    --agent <id>    only install one agent (claude | opencode | codex)',
    '    --dry-run       show changes without writing',
    '    --verbose       show detail',
    '  status            Show per-agent integration / enforcement / verification / status',
    '  doctor            Health-check RiskGuard wiring (PASS/WARN/FAIL/SKIP)',
    '    --verbose       show evidence detail',
    '  uninstall         Remove RiskGuard entries based on manifest (preserves user config)',
    '    --agent <id>    only uninstall one agent',
    '    --dry-run       show changes without writing',
    '  version           Show version',
    '  help              Show this help',
  ].join('\n');
}

// re-export helpers for tests
export { HOMES, REPO_ROOT };