/**
 * standalone.e2e.test.ts — v0.1.2 Phase B：artifact / portable runtime standalone smoke
 *
 * 证明 CLI 能离开源码 repo 独立工作：
 *   1. 从 release artifact（dist/agent-risk-guard-v<ver>/bin/riskguard.mjs）跑完整生命周期（fake HOME）。
 *   2. bootstrap portable runtime 到 fake HOME → install → hook 指向 runtime；
 *      随后模拟源码/artifact 不可达（直接对 runtime hook 喂 payload），self-test 仍 PASS。
 *
 * 依赖：先运行 node scripts/build-release.ts 生成 dist/。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { PRODUCT_VERSION } from '../../packages/core/src/version.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ART_DIR = join(REPO, 'dist', `agent-risk-guard-v${PRODUCT_VERSION}`);
const LAUNCHER = join(ART_DIR, 'bin', 'riskguard.mjs');
const CLI = join(REPO, 'packages', 'cli', 'src', 'index.ts');

function run(cli: string, args: string[], home: string): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [cli, ...args, '--home', home], { encoding: 'utf8' });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status ?? -1 };
}

function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'rg-dist-'));
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ permissions: { defaultMode: 'bypassPermissions' }, model: 'opus' }), 'utf8');
  mkdirSync(join(home, '.codex'), { recursive: true });
  writeFileSync(join(home, '.codex', 'hooks.json'), JSON.stringify({ hooks: { PreToolUse: [] } }), 'utf8');
  mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
  writeFileSync(join(home, '.config', 'opencode', 'opencode.json'), JSON.stringify({ permission: 'allow', plugin: ['@u/x'] }), 'utf8');
  return home;
}

test('artifact 存在（先跑 node scripts/build-release.ts）', () => {
  assert.equal(existsSync(LAUNCHER), true, `launcher missing: ${LAUNCHER}. Run: node scripts/build-release.ts`);
});

test('artifact standalone: launcher 全生命周期（fake HOME，不依赖 repo）', () => {
  if (!existsSync(LAUNCHER)) return;
  const home = makeHome();
  try {
    const ver = run(LAUNCHER, ['version'], home);
    assert.match(ver.stdout, /0\.1\.2/);

    const det = run(LAUNCHER, ['detect', '--json'], home);
    assert.equal(det.status, 0, det.stdout + det.stderr);
    const map = JSON.parse(det.stdout) as Record<string, boolean>;
    assert.equal(map['claude-code'], true);

    const inst = run(LAUNCHER, ['install', '--agent', 'claude'], home);
    assert.equal(inst.status, 0, inst.stdout + inst.stderr);
    assert.match(inst.stdout, /installed|repaired/);

    const st = run(LAUNCHER, ['status'], home);
    assert.match(st.stdout, /Runtime: ACTIVE/);

    // hook command 指向 artifact 内的 script（artifact 自包含，不依赖 git checkout）
    const cc = readFileSync(join(home, '.claude', 'settings.json'), 'utf8');
    const hookCmd = JSON.parse(cc).hooks.PreToolUse[0].hooks[0].command as string;
    const m = hookCmd.match(/node "([^"]+)"/);
    assert.ok(m, `hook command parse failed: ${hookCmd}`);
    const hookScript = m![1];
    assert.ok(existsSync(hookScript), `hook script must exist: ${hookScript}`);
    assert.ok(hookScript.startsWith(ART_DIR), `hook must live inside the artifact (self-contained), got: ${hookScript}`);

    const doc = run(LAUNCHER, ['doctor'], home);
    assert.match(doc.stdout, /PASS/);

    const un = run(LAUNCHER, ['uninstall', '--agent', 'claude'], home);
    assert.match(un.stdout, /uninstalled/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('bootstrap: runtime 装入 fake HOME，hook 指向 runtime，repo/artifact 删除后仍工作', () => {
  if (!existsSync(CLI)) return;
  const home = makeHome();
  try {
    const boot = run(CLI, ['bootstrap'], home);
    assert.equal(boot.status, 0, boot.stdout);
    assert.match(boot.stdout, /runtime installed/);
    const runtimeDir = join(home, '.riskguard', 'runtime', PRODUCT_VERSION);
    assert.ok(existsSync(join(runtimeDir, 'runtime-manifest.json')));

    // 用 runtime CLI install（resolveActiveRoot → runtime）
    const rtCli = join(runtimeDir, 'packages', 'cli', 'src', 'index.ts');
    const inst = run(rtCli, ['install', '--agent', 'claude'], home);
    assert.equal(inst.status, 0, inst.stdout);

    // hook 指向 runtime 路径（含 .riskguard/runtime）
    const cc = readFileSync(join(home, '.claude', 'settings.json'), 'utf8');
    const hookCmd = JSON.parse(cc).hooks.PreToolUse[0].hooks[0].command as string;
    assert.ok(hookCmd.includes(join('.riskguard', 'runtime').replace(/\\/g, '\\')), `hook must point at runtime: ${hookCmd}`);
    assert.ok(!hookCmd.includes('agent-risk-guard\\packages'), `hook must not point at git clone: ${hookCmd}`);

    // 模拟源码不可达：直接 spawn runtime 内 hook（无害→allow，危险→deny）
    const rtHook = join(runtimeDir, 'packages', 'cli', 'src', 'hooks', 'pre-tool-hook.ts');
    const safe = spawnSync(process.execPath, [rtHook, '--agent', 'claude'], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo ok' } }), encoding: 'utf8' });
    assert.equal((safe.stdout ?? '').trim(), '{}');
    const danger = spawnSync(process.execPath, [rtHook, '--agent', 'claude'], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git reset --hard HEAD' } }), encoding: 'utf8' });
    assert.match((danger.stdout ?? ''), /deny/);

    // runtime CLI status → ACTIVE
    const st = run(rtCli, ['status'], home);
    assert.match(st.stdout, /Runtime: ACTIVE/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
