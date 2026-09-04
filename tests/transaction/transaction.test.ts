/**
 * transaction.test.ts — v0.1.1 事务故障注入测试（Release Gate 核心）
 *
 * 人为模拟每个阶段失败，验证 rollback 精确性：
 *   Case 1: 原配置存在 + manifest 保存失败 → 最终配置 hash == 安装前
 *   Case 2: 原配置不存在 + verification FAIL → 新配置被 rollback 移除（trash）
 *   Case 3: backup 失败 → install 立即中止，目标零变化，无 manifest
 *   Case 4: OpenCode artifact 创建后 config write FAIL → artifact 移除 + 配置恢复
 *   Case 5: manifest 写入后 verification FAIL → manifest 移除 + config 恢复
 *   Case 6: hook target 丢失 → status BROKEN（不能 ACTIVE）
 *   Case 7: opencode artifact hash 改变 → status BROKEN
 *   Case 8: runtime 不可用 → BROKEN（注入 runtimeAvailableOverride=false）
 *
 * 全部在 fresh fake HOME 上进行，不触碰真实用户配置。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { cmdInstall } from '../../packages/cli/src/commands.ts';
import { probeAgentRuntime } from '../../packages/installer/src/runtime-probe.ts';
import { InstallTransaction } from '../../packages/installer/src/transaction.ts';
import { sha256File } from '../../packages/installer/src/hash.ts';
import { manifestPathFor } from '../../packages/installer/src/manifest.ts';

function makeHome(): { home: string; cc: string } {
  const home = mkdtempSync(join(tmpdir(), 'rg-tx-'));
  mkdirSync(join(home, '.claude'), { recursive: true });
  const cc = join(home, '.claude', 'settings.json');
  writeFileSync(cc, JSON.stringify({ permissions: { defaultMode: 'bypassPermissions' }, model: 'opus' }, null, 2), 'utf8');
  return { home, cc };
}

test('Case1: config 存在 + manifest 保存失败 → config hash 恢复为安装前', async () => {
  const { home, cc } = makeHome();
  try {
    const before = await sha256File(cc);
    const out = await cmdInstall({ only: 'claude', home, _test: { failAt: 'manifest-save' } });
    assert.match(out, /install failed and was rolled back/);
    assert.match(out, /Rollback complete/);
    const after = await sha256File(cc);
    assert.equal(after, before, 'config hash must equal pre-install hash');
    // manifest 不存在（provisional 被移除）
    assert.equal(existsSync(manifestPathFor('claude-code', home)), false, 'no manifest left behind');
    // status 显示未装
    const p = await probeAgentRuntime('claude-code', { home, deep: true });
    assert.equal(p.state, 'DETECTED');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('Case2: 原配置不存在 + verification FAIL → 新配置被 rollback 移除', async () => {
  const home = mkdtempSync(join(tmpdir(), 'rg-tx-'));
  try {
    // 该 home 无 .codex → config 不存在（先建 .codex 目录但不建 hooks.json？detect 需 .codex 目录存在）
    mkdirSync(join(home, '.codex'), { recursive: true });
    const hooksPath = join(home, '.codex', 'hooks.json');
    assert.equal(existsSync(hooksPath), false);
    const out = await cmdInstall({ only: 'codex', home, _test: { failVerify: true } });
    assert.match(out, /install verification FAILED/);
    assert.match(out, /rolled back/);
    assert.equal(existsSync(hooksPath), false, 'transaction-created config must be removed on rollback');
    assert.equal(existsSync(manifestPathFor('codex', home)), false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('Case3: backup 失败 → snapshot 抛错（install 立即中止语义）', async () => {
  const home = mkdtempSync(join(tmpdir(), 'rg-tx-'));
  try {
    const target = join(home, 'settings.json');
    writeFileSync(target, '{"a":1}', 'utf8');
    const beforeHash = await sha256File(target);
    const tx = new InstallTransaction('claude-code', home, {
      backupImpl: async () => ({ ok: false, entries: [] }), // 模拟 backup 失败
    });
    await assert.rejects(() => tx.snapshot([target]), /Backup failed/);
    // 目标零变化（snapshot 失败发生在写之前）
    const afterHash = await sha256File(target);
    assert.equal(afterHash, beforeHash);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('Case4: opencode artifact 创建后 config-write FAIL → artifact 移除', async () => {
  const home = mkdtempSync(join(tmpdir(), 'rg-tx-'));
  try {
    mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
    // opencode 需要 .config/opencode 存在 + plugin 引用
    writeFileSync(join(home, '.config', 'opencode', 'opencode.json'), JSON.stringify({ permission: 'allow', plugin: ['@u/x'] }, null, 2), 'utf8');
    const ocCfg = join(home, '.config', 'opencode', 'opencode.json');
    const plugFile = join(home, '.config', 'opencode', 'plugins', 'agent-risk-guard.ts');
    const cfgBefore = readFileSync(ocCfg, 'utf8');

    const out = await cmdInstall({ only: 'oc', home, _test: { failAt: 'config-write' } });
    assert.match(out, /install failed and was rolled back|install verification FAILED/);
    // artifact 未创建（config-write 失败发生在 artifact 之前？实际顺序：config write → artifact write → manifest。
    // 注入在 config-write 后 artifact 前。若 config 先写失败 → artifact 未写。验证 artifact 不存在或已被清。
    // 这里注入点在 config write 之后，所以 artifact 可能已写？见注入位置：config-write 在 config 后、artifact 前抛错 → artifact 未写。
    assert.equal(existsSync(plugFile), false, 'artifact must not exist when config-write fails');
    // config 恢复
    assert.equal(readFileSync(ocCfg, 'utf8'), cfgBefore);
    assert.equal(existsSync(manifestPathFor('opencode', home)), false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('Case5: manifest 写入后 verification FAIL → manifest 移除 + config 恢复 + artifact 移除', async () => {
  const home = mkdtempSync(join(tmpdir(), 'rg-tx-'));
  try {
    mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
    writeFileSync(join(home, '.config', 'opencode', 'opencode.json'), JSON.stringify({ permission: 'allow', plugin: ['@u/x'] }, null, 2), 'utf8');
    const ocCfg = join(home, '.config', 'opencode', 'opencode.json');
    const plugFile = join(home, '.config', 'opencode', 'plugins', 'agent-risk-guard.ts');
    const cfgBefore = readFileSync(ocCfg, 'utf8');

    const out = await cmdInstall({ only: 'oc', home, _test: { failVerify: true } });
    assert.match(out, /install verification FAILED/);
    // manifest 移除（provisional）
    assert.equal(existsSync(manifestPathFor('opencode', home)), false, 'manifest removed on rollback');
    // config 恢复原样
    assert.equal(readFileSync(ocCfg, 'utf8'), cfgBefore, 'config restored');
    // artifact 移除（createdByTransaction=true → trash）
    assert.equal(existsSync(plugFile), false, 'artifact removed on rollback');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('Case6: hook target 丢失 → status BROKEN 不能 ACTIVE', async () => {
  const home = mkdtempSync(join(tmpdir(), 'rg-tx-'));
  try {
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ hooks: {} }, null, 2), 'utf8');
    const cc = join(home, '.claude', 'settings.json');
    // 装一个指向不存在 hook 文件的假 wiring + manifest
    mkdirSync(join(home, '.riskguard', 'manifests'), { recursive: true });
    writeFileSync(manifestPathFor('claude-code', home), JSON.stringify({ product: 'riskguard', version: '0.1.1', agent: 'claude-code', installedAt: new Date().toISOString(), installedFiles: [], modifiedConfig: [cc], riskguardEntryId: 'riskguard-pre-tool-hook', backupDir: '' }), 'utf8');
    writeFileSync(cc, JSON.stringify({
      hooks: { PreToolUse: [{ _riskguard: true, id: 'riskguard-pre-tool-hook', matcher: 'Bash', hooks: [{ type: 'command', command: `node "E:\\nonexistent\\pre-tool-hook.ts" --agent claude` }] }] },
    }, null, 2), 'utf8');
    const p = await probeAgentRuntime('claude-code', { home, deep: true });
    assert.equal(p.state, 'BROKEN', 'missing hook target must be BROKEN, not ACTIVE');
    assert.equal(p.hookTargetExists, false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('Case7: opencode artifact hash 改变 → status BROKEN（不能 ACTIVE）', async () => {
  const home = mkdtempSync(join(tmpdir(), 'rg-tx-'));
  try {
    // 先正常安装（自检通过）
    mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
    writeFileSync(join(home, '.config', 'opencode', 'opencode.json'), JSON.stringify({ permission: 'allow', plugin: ['@u/x'] }, null, 2), 'utf8');
    const out = await cmdInstall({ only: 'oc', home });
    assert.match(out, /installed/, out);
    // 修改 artifact 内容（hash 改变）
    const plugFile = join(home, '.config', 'opencode', 'plugins', 'agent-risk-guard.ts');
    writeFileSync(plugFile, '// tampered by user\n', 'utf8');
    const p = await probeAgentRuntime('opencode', { home, deep: true });
    assert.equal(p.artifactIntegrity, false, 'integrity mismatch detected');
    assert.equal(p.state, 'BROKEN', 'tampered artifact must be BROKEN, not ACTIVE');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('Case8: runtime 不可用 → BROKEN（注入 runtimeAvailableOverride）', async () => {
  const home = mkdtempSync(join(tmpdir(), 'rg-tx-'));
  try {
    // 模拟已安装（manifest + 真实 hook wiring 指向真实 REPO script）
    mkdirSync(join(home, '.claude'), { recursive: true });
    mkdirSync(join(home, '.riskguard', 'manifests'), { recursive: true });
    const cc = join(home, '.claude', 'settings.json');
    const repoRoot = join(new URL('.', import.meta.url).pathname, '..', '..');
    const realHook = join(repoRoot, 'packages', 'cli', 'src', 'hooks', 'pre-tool-hook.ts');
    writeFileSync(manifestPathFor('claude-code', home), JSON.stringify({ product: 'riskguard', version: '0.1.1', agent: 'claude-code', installedAt: new Date().toISOString(), installedFiles: [], modifiedConfig: [cc], riskguardEntryId: 'riskguard-pre-tool-hook', backupDir: '' }), 'utf8');
    writeFileSync(cc, JSON.stringify({
      hooks: { PreToolUse: [{ _riskguard: true, id: 'riskguard-pre-tool-hook', matcher: 'Bash', hooks: [{ type: 'command', command: `node "${realHook}" --agent claude` }] }] },
    }, null, 2), 'utf8');
    const p = await probeAgentRuntime('claude-code', { home, deep: true, runtimeAvailableOverride: false });
    assert.equal(p.runtimeAvailable, false);
    assert.equal(p.state, 'BROKEN', 'runtime unavailable must be BROKEN');
  } finally { rmSync(home, { recursive: true, force: true }); }
});
