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
import { backupRoot } from '../../installer/src/backup.ts';
import { saveManifest, loadManifest, removeManifest, hasManifest, type AgentManifest, type ManifestArtifact } from '../../installer/src/manifest.ts';
import { readConfig, describeReadFailure, type ConfigReadResult } from '../../installer/src/config-read.ts';
import { sha256File } from '../../installer/src/hash.ts';
import { InstallTransaction } from '../../installer/src/transaction.ts';
import { probeAgentRuntime } from '../../installer/src/runtime-probe.ts';
import { installRuntime, verifyRuntime, runtimeVersionDir, isRuntimeInstalled } from './runtime-install.ts';
import { PRODUCT_VERSION } from '../../core/src/version.ts';

const VERSION = PRODUCT_VERSION;
/** 仓库根目录（packages/cli/src/commands.ts → 上溯 3 层 = repo root）
 *
 * v0.1.2 Phase B：若 portable runtime（~/.riskguard/runtime/<version>）已安装，
 * 优先用它作为运行时根——这样 install 写入的 hook/plugin 指向 runtime，
 * 用户删除/移动源码仓库后 RiskGuard 仍工作。否则退回当前 repo。
 */
const REPO_ROOT: string = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url)); // packages/cli/src
    const repoRoot = dirname(dirname(dirname(here)));     // repo root
    return repoRoot;
  } catch { return process.cwd(); }
})();

export interface InstallAgentOpts {
  home?: string;
  dryRun?: boolean;
  verbose?: boolean;
  only?: string;             // 只安装指定 agent（可选）
  /** 测试专用故障注入（仅 tests/transaction 使用；生产 CLI 不产生该字段） */
  _test?: { failAt?: 'config-write' | 'manifest-save' | 'verify'; failVerify?: boolean };
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
    buildInjection: (root) => ({
      _riskguard: true, id: CLAUDE_HOOK_ID,
      matcher: 'Bash|PowerShell',
      hooks: [{
        type: 'command',
        command: `node "${join(root, 'packages', 'cli', 'src', 'hooks', 'pre-tool-hook.ts')}" --agent claude`,
        statusMessage: 'RiskGuard: checking dangerous commands',
        timeout: 10,
      }],
    }),
  },
  codex: {
    id: 'codex', display: 'Codex CLI',
    planConfigPath: (h) => join(h, '.codex', 'hooks.json'),
    buildInjection: (root) => ({
      _riskguard: true, id: CODEX_HOOK_ID,
      matcher: 'Bash',
      hooks: [{
        type: 'command',
        command: `node "${join(root, 'packages', 'cli', 'src', 'hooks', 'pre-tool-hook.ts')}" --agent codex`,
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

/**
 * 解析 install 实际使用的运行时根（v0.1.2 Phase B）：
 *  portable runtime 已装（~/.riskguard/runtime/<ver>/runtime-manifest.json 存在且完整）→ 用 runtime，
 *  使 hook 指向 runtime；否则退回当前仓库。这样用户删除源码仓库后 RiskGuard 仍工作。
 */
async function resolveActiveRoot(home: string): Promise<{ root: string; source: 'runtime' | 'repo' }> {
  if (isRuntimeInstalled(home)) {
    const v = await verifyRuntime({ home });
    if (v.ok) return { root: runtimeVersionDir(home), source: 'runtime' };
  }
  return { root: REPO_ROOT, source: 'repo' };
}

export function mergeForAgent(id: string, repoRoot: string, existing: Record<string, unknown> | null | undefined, home: string): { config: Record<string, unknown>; changed: boolean } {
  if (id === 'claude-code') return mergeClaudeSettings(existing, installers['claude-code'].buildInjection(repoRoot));
  if (id === 'codex') return mergeCodexHooks(existing, installers.codex.buildInjection(repoRoot));
  if (id === 'opencode') return mergeOpencodePlugins(existing, installers.opencode.buildInjection(repoRoot));
  return { config: (existing ?? {}), changed: false };
}

export interface InstallOutcome {
  agent: string;
  display: string;
  state: 'installed' | 'repaired' | 'skipped' | 'error' | 'already' | 'aborted';
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
/**
 * 事务式单 Agent 安装（v0.1.1 真事务状态机）：
 *   PRECHECK → SNAPSHOT/BACKUP → WRITE → (provisional manifest) → VERIFY(runtime self-test)
 *   → PASS → FINALIZE manifest + COMMIT
 *   任一步失败 → ROLLBACK（restore 精确备份 / trash 移除本轮创建文件），随后自验证。
 *
 * 铁律：
 *   - backup 任一已存在目标失败 → 立即 ABORT（禁止 best-effort）。
 *   - rollback 只使用本轮事务产生的 backup，禁止扫描历史目录。
 *   - 原配置不存在 → rollback 移除本轮创建文件（trash）。
 *   - VERIFY FAIL → 自动 rollback，绝不留下「表面成功」。
 */
async function installOne(inst: AgentInstaller, home: string, opts: InstallAgentOpts): Promise<InstallOutcome> {
  const dry = opts.dryRun === true;
  const verbose = opts.verbose === true;
  const manifestPath = join(home, '.riskguard', 'manifests', `${inst.id}.json`);

  // —— PRECHECK：Agent 已装？——
  const installed = detectAgent(
    AGENT_REGISTRY.find((d) => d.id === inst.id) ?? { id: inst.id, display: inst.display, mechanisms: [], probePaths: [] },
    { home: HOMES.get(home) },
  ).installed;
  if (!installed) {
    return { agent: inst.id, display: inst.display, state: 'skipped', message: `${inst.display} not detected. Skipped.`, dryRun: dry };
  }

  const configPath = inst.planConfigPath(home);
  // —— PRECHECK：类型化读取；任何无法确定原配置内容的情况都禁止写入 ——
  const read = await readConfig(configPath);
  if (read.state === 'invalid-json' || read.state === 'permission-denied' || read.state === 'io-error') {
    return {
      agent: inst.id, display: inst.display, state: 'aborted', dryRun: dry,
      message: `${inst.display} installation aborted.\n\nReason:\n${describeReadFailure(read, configPath)}\n\nRiskGuard made no changes.\nPlease repair the configuration and retry.`,
    };
  }
  const existingRaw = read.state === 'valid' ? read.data : null;

  // —— Phase B：解析实际运行时根（runtime 已装则 hook 指向 runtime，不绑 git clone） ——
  const active = await resolveActiveRoot(home);
  const activeRoot = active.root;

  const merged = (() => {
    if (inst.id === 'claude-code') return mergeClaudeSettings(existingRaw, inst.buildInjection(activeRoot));
    if (inst.id === 'codex') return mergeCodexHooks(existingRaw, inst.buildInjection(activeRoot));
    if (inst.id === 'opencode') return mergeOpencodePlugins(existingRaw, inst.buildInjection(activeRoot));
    return { config: (existingRaw ?? {}), changed: false };
  })();

  // —— PRECHECK：OpenCode artifact 预检（目标存在且非我方文件 → ABORT，绝不覆盖） ——
  let artifactDst: string | null = null;
  let artifactSrc: string | null = null;
  const artifactExistsBefore = inst.copyArtifacts && inst.id === 'opencode' && (() => {
    artifactSrc = join(activeRoot, 'assets', 'opencode', `${OPENCODE_PLUGIN_ID}.ts`);
    artifactDst = join(home, '.config', 'opencode', 'plugins', `${OPENCODE_PLUGIN_ID}.ts`);
    return existsSync(artifactDst);
  })();
  if (inst.copyArtifacts && inst.id === 'opencode' && artifactExistsBefore) {
    const dstHash = await sha256File(artifactDst!);
    const srcHash = await sha256File(artifactSrc!);
    if (dstHash !== srcHash) {
      return {
        agent: inst.id, display: inst.display, state: 'aborted', dryRun: dry,
        message: `${inst.display} plugin installation aborted.\n\nTarget already exists:\n${artifactDst}\n\nThe existing file is not owned by this RiskGuard installation (SHA256 mismatch).\nNo files were overwritten.\nPlease inspect or remove it, then retry.`,
      };
    }
  }

  // —— 已装状态判定（fresh / repair / already） ——
  // v0.1.2：manifest 存在但 wiring 损坏 → install 是 repair，绝不短路成 already。
  const manifestExistedBefore = await hasManifest(inst.id, home);
  const healthProbe = manifestExistedBefore ? await probeAgentRuntime(inst.id, { home, deep: true }) : null;
  const healthyAlready = manifestExistedBefore && healthProbe?.state === 'ACTIVE';
  const isRepair = manifestExistedBefore && !healthyAlready;

  // —— dry-run：只输出将修改，不落盘 ——
  if (dry) {
    const wouldLines = ['Would modify:', `  ${configPath}`];
    if (inst.copyArtifacts && !artifactExistsBefore) wouldLines.push('Would create:', `  ${artifactDst ?? `<opencode plugins>/${OPENCODE_PLUGIN_ID}.ts`}`);
    const dryState = isRepair ? 'repaired' : (merged.changed || (inst.copyArtifacts && !artifactExistsBefore)) ? 'installed' : 'already';
    return { agent: inst.id, display: inst.display, state: dryState, message: [inst.display, ...wouldLines, '  (dry-run, no files changed)', ''].join('\n'), dryRun: true };
  }

  // —— 幂等短路：仅当「无改动 AND 已装 AND 健康(ACTIVE)」才算 already ——
  if (!merged.changed && !(inst.copyArtifacts && !artifactExistsBefore) && healthyAlready) {
    return { agent: inst.id, display: inst.display, state: 'already', backupDir: join(backupRoot(home), inst.id), manifestFile: manifestPath, message: `${inst.display}: already installed (idempotent, no change)`, dryRun: dry };
  }

  // ============ 事务体 ============
  const tx = new InstallTransaction(inst.id, home);
  const artifactRecords: ManifestArtifact[] = [];
  const createdFiles: string[] = [];
  try {
    // —— SNAPSHOT + BACKUP：记录每个目标的本轮状态（已存在文件必须备份成功） ——
    const snapshotPaths = [configPath];
    if (inst.copyArtifacts && inst.id === 'opencode' && artifactDst && existsSync(artifactDst)) snapshotPaths.push(artifactDst);
    await tx.snapshot(snapshotPaths);

    // —— WRITE：config + artifact（原子写） ——
    if (merged.changed) {
      await tx.writeJsonAtomic(configPath, merged.config);
    }
    if (opts._test?.failAt === 'config-write') throw new Error('INJECTED: config-write failure');

    if (inst.copyArtifacts && inst.id === 'opencode' && artifactSrc && artifactDst && !artifactExistsBefore) {
      await tx.writeArtifactAtomic(artifactSrc, artifactDst);
      createdFiles.push(artifactDst);
      const h = await sha256File(artifactDst);
      if (h) artifactRecords.push({ path: artifactDst, sha256: h, createdByInstall: true });
    } else if (inst.copyArtifacts && inst.id === 'opencode' && artifactDst && artifactExistsBefore) {
      const h = await sha256File(artifactDst);
      if (h) artifactRecords.push({ path: artifactDst, sha256: h, createdByInstall: false });
    }
    if (opts._test?.failAt === 'artifact-write') throw new Error('INJECTED: artifact-write failure');

    // —— provisional manifest（含 transactionId；VERIFY 通过后再 finalize） ——
    // v0.1.2：manifest 是普通 TransactionTarget——writeJsonAtomic 写前自动 snapshot：
    //   旧 manifest 存在 → backup exact + beforeSha256（rollback 会 restore）
    //   manifest 不存在 → existedBefore=false（rollback 会 trash 移除新建的）
    const provisional: AgentManifest = {
      schemaVersion: 2, product: 'riskguard', version: VERSION, agent: inst.id,
      transactionId: tx.id, installedAt: new Date().toISOString(),
      installedFiles: createdFiles,
      modifiedConfig: merged.changed ? [configPath] : [],
      riskguardEntryId: inst.id === 'claude-code' ? CLAUDE_HOOK_ID : inst.id === 'codex' ? CODEX_HOOK_ID : OPENCODE_PLUGIN_ID,
      backupDir: join(backupRoot(home), inst.id),
      artifacts: artifactRecords,
      runtimeVerification: { verifiedAt: new Date().toISOString(), result: 'FAIL', detail: 'pending verification' },
    };
    await tx.writeJsonAtomic(manifestPath, provisional);
    if (opts._test?.failAt === 'manifest-save') throw new Error('INJECTED: manifest-save failure');

    // —— VERIFY：runtime self-test（真实验证运行链路，非字符串） ——
    const probe = await probeAgentRuntime(inst.id, { home, deep: true });
    const verifyPass = opts._test?.failVerify === true ? false : (probe.state === 'ACTIVE' || (probe.selfTestPassed && probe.configValid && probe.wired && (inst.id === 'opencode' ? probe.artifactIntegrity !== false : probe.hookTargetExists)));
    if (!verifyPass) {
      const rollback = await tx.rollback('verification FAIL');
      return {
        agent: inst.id, display: inst.display, state: 'error', dryRun: dry,
        message: `${inst.display}: install verification FAILED and was ${rollback.state === 'rolled-back' ? 'rolled back' : 'NOT fully rolled back'}.\n  Reason: runtime self-test failed.\n  Evidence: ${(probe.evidence ?? []).join(' | ')}\n  ${rollback.state === 'rolled-back' ? 'Rollback complete: system restored to pre-install state.' : `ROLLBACK_INCOMPLETE: ${rollback.message}. Manual review required.`}`,
      };
    }

    // —— FINALIZE：runtimeVerification=PASS 后 commit（仍是事务内原子写，manifest target 已 snapshot） ——
    const final: AgentManifest = { ...provisional, runtimeVerification: { verifiedAt: new Date().toISOString(), result: 'PASS', detail: probe.selfTestDetail } };
    await tx.writeJsonAtomic(manifestPath, final);
    tx.commit();

    const finalState = isRepair ? 'repaired' : 'installed';
    const verb = isRepair ? 'repaired successfully (was BROKEN/INSTALLED)' : 'installed (merge-preserving)';
    return {
      agent: inst.id, display: inst.display, state: finalState,
      backupDir: join(backupRoot(home), inst.id), manifestFile: manifestPath,
      message: `${inst.display}: ${verb}${createdFiles.length ? `; installed ${createdFiles.length} artifact(s)` : ''}; runtime self-test ${verifyPass ? 'PASS' : 'FAIL'}${verbose ? `\n  modified: ${configPath}\n  self-test: ${probe.selfTestDetail ?? ''}` : ''}`,
      dryRun: dry,
    };
  } catch (e) {
    // —— ROLLBACK：任何 BACKUP/WRITE/VERIFY/COMMIT 阶段失败 ——
    const rollback = await tx.rollback((e as Error).message).catch(() => ({ state: 'rollback-incomplete' as const, message: `rollback threw: ${(e as Error).message}`, perTarget: [] }));
    const clean = rollback.state === 'rolled-back';
    return {
      agent: inst.id, display: inst.display, state: 'error', dryRun: dry,
      message: `${inst.display}: install failed and was ${clean ? 'rolled back' : 'NOT fully rolled back'}.\n  Reason: ${(e as Error).message}\n  ${clean ? 'Rollback complete: system restored to pre-install state.' : `ROLLBACK_INCOMPLETE: ${rollback.message}. Manual review required.`}`,
    };
  }
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
    // ACTIVE 必须经完整 runtime self-test（deep）
    const probe = await probeAgentRuntime(id, { home, deep: true });
    const lvl = c?.verification[platform];
    lines.push(`${c?.display ?? id}`);
    lines.push(`Integration: ${c?.integration ?? '—'}`);
    lines.push(`Capability: ${lvl ?? 'D0'} (${c?.enforcement === 'hard' ? 'hard blocking' : c?.enforcement === 'soft' ? 'soft only' : 'none'})`);
    lines.push(`Runtime: ${probe.state}${describeRuntime(probe.state)}`);
    lines.push(`Verification: ${probe.verificationMode}${probe.verificationMode === 'dynamic' ? ' (real interception runtime self-test)' : probe.verificationMode === 'static' ? ' (wiring + artifact + integrity)' : ''}`);
    if (probe.verificationMode === 'dynamic' && probe.selfTestDetail) lines.push(`  self-test: ${probe.selfTestDetail}`);
    if (probe.verificationMode === 'static' && probe.artifactIntegrity === false) lines.push(`  integrity: MISMATCH`);
    lines.push('');
  }
  return lines.join('\n');
}

function describeRuntime(state: string): string {
  switch (state) {
    case 'ACTIVE': return ' — full runtime self-test PASS';
    case 'BROKEN': return ' — manifest present but wiring/artifact defective';
    case 'DETECTED': return ' — agent present, RiskGuard not installed';
    case 'INSTALLED': return ' — manifest + wiring present, self-test not fully verified';
    default: return ' — agent not detected';
  }
}

// ============================================================================
// doctor
// ============================================================================

export async function cmdDoctor(opts: { home?: string; verbose?: boolean }): Promise<string> {
  const home = HOMES.get(opts.home);
  const lines = ['RiskGuard Doctor:', ''];
  // 统一 probe：status / doctor / install-verification 共用同一 runtime 判定
  const order = ['claude-code', 'codex', 'opencode', 'dsh'];
  const counts = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const id of order) {
    const probe = await probeAgentRuntime(id, { home, deep: true });
    const display = loadCompatibility().agents[id]?.display ?? id;
    if (!probe.detected) {
      counts.skip++;
      lines.push(`SKIP  ${id.padEnd(14)} agent 未安装`);
      continue;
    }
    // claude/codex：核心检查是 wiring + hook target + self-test
    if (id === 'claude-code' || id === 'codex') {
      if (!probe.configValid) { counts.fail++; lines.push(`FAIL  ${id.padEnd(14)} 配置损坏`); }
      else if (!probe.wired) { counts.fail++; lines.push(`FAIL  ${id.padEnd(14)} RiskGuard hook 注入缺失`); }
      else if (!probe.hookTargetExists) { counts.fail++; lines.push(`FAIL  ${id.padEnd(14)} hook 目标文件缺失`); }
      else if (!probe.runtimeAvailable) { counts.fail++; lines.push(`FAIL  ${id.padEnd(14)} node 运行时不可用`); }
      else if (!probe.selfTestPassed) { counts.fail++; lines.push(`FAIL  ${id.padEnd(14)} runtime self-test 未通过`); }
      else { counts.pass++; lines.push(`PASS  ${id.padEnd(14)} PreToolUse hook + runtime self-test`); }
    } else if (id === 'opencode') {
      if (!probe.configValid) { counts.fail++; lines.push(`FAIL  ${id.padEnd(14)} 配置损坏`); }
      else if (!probe.wired) { counts.fail++; lines.push(`FAIL  ${id.padEnd(14)} plugin 引用缺失`); }
      else if (!probe.artifactPresent) { counts.fail++; lines.push(`FAIL  ${id.padEnd(14)} 插件文件缺失`); }
      else if (probe.artifactIntegrity === false) { counts.warn++; lines.push(`WARN  ${id.padEnd(14)} 插件文件 hash 与仓库不符（可能被改）`); }
      else { counts.pass++; lines.push(`PASS  ${id.padEnd(14)} plugin 注册 + artifact 完整性`); }
    } else if (id === 'dsh') {
      if (!probe.wired) { counts.fail++; lines.push(`FAIL  ${id.padEnd(14)} deny-risk-commands patch 缺失`); }
      else { counts.pass++; lines.push(`PASS  ${id.padEnd(14)} pre-execute patch（deny-risk-commands）`); }
    }
    lines.push(`       runtime verification: ${probe.verificationMode}`);
    if (opts.verbose) for (const e of probe.evidence) lines.push(`        → ${e}`);
  }
  // 其它 registry agent（未纳入 probe 的）→ SKIP（未装）或按 doctor 旧逻辑
  for (const desc of AGENT_REGISTRY) {
    if (['claude-code', 'codex', 'opencode', 'dsh'].includes(desc.id)) continue;
    const inst = detectAgent(desc, { home });
    if (!inst.installed) { counts.skip++; lines.push(`SKIP  ${desc.id.padEnd(14)} agent 未安装`); }
  }
  lines.push('');
  lines.push(`Summary: ${counts.pass} PASS / ${counts.warn} WARN / ${counts.fail} FAIL / ${counts.skip} SKIP`);
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

// ============================================================================
// bootstrap（Phase B：portable runtime 安装）
// ============================================================================

export async function cmdBootstrap(opts: { home?: string; force?: boolean }): Promise<string> {
  const home = HOMES.get(opts.home);
  const installed = isRuntimeInstalled(home);
  if (installed && opts.force !== true) {
    // 已装：校验完整性
    const v = await verifyRuntime({ home });
    const dir = runtimeVersionDir(home);
    if (v.ok) return `RiskGuard runtime already installed and verified.\n  Runtime: ${dir}\n  Version: ${PRODUCT_VERSION}\n\nUse --force to reinstall.`;
    return `RiskGuard runtime exists but is INCOMPLETE (${v.issues.length} issue(s)):\n${v.issues.slice(0, 10).map((i) => `  - ${i}`).join('\n')}\n\nRun 'riskguard bootstrap --force' to repair.`;
  }
  try {
    const r = await installRuntime({ home, force: opts.force });
    const v = await verifyRuntime({ home });
    const integrity = v.ok ? 'OK' : `ISSUES: ${v.issues.join('; ')}`;
    return `RiskGuard runtime installed.\n  Runtime: ${r.dir}\n  Version: ${PRODUCT_VERSION}\n  Files: ${r.files}\n  Integrity: ${integrity}`;
  } catch (e) {
    return `RiskGuard bootstrap failed.\n  Reason: ${(e as Error).message}\nNo changes to agent configs were made.`;
  }
}

export function cmdVersion(): string {
  return `RiskGuard ${VERSION} (Developer Preview)`;
}

export function cmdHelp(): string {
  return [
    'RiskGuard — deterministic safety guardrails for AI coding agents.',
    '',
    'Usage:  node bin/riskguard.mjs <command> [options]',
    '        (or: node packages/cli/src/index.ts <command> [options])',
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
    '  bootstrap         Install portable RiskGuard runtime to ~/.riskguard/runtime/<version>',
    '    --force         reinstall even if already installed',
    '  version           Show version',
    '  help              Show this help',
  ].join('\n');
}

// re-export helpers for tests
export { HOMES, REPO_ROOT, normalizeAgentId, CANONICAL_AGENTS, removeInjection };