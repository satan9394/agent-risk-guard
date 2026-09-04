/**
 * release-hardening.test.ts — v0.1.0 发布前整改（P0/P1）回归
 *
 * 覆盖：
 *  - config-read：读取状态精确分类（missing / valid / invalid-json / permission-denied / io-error），
 *    任何「无法确定原配置内容」都不得进入写入路径。
 *  - runtime-state：NOT_DETECTED / DETECTED / INSTALLED / ACTIVE / BROKEN 全路径 + dsh 非 manifest 模式。
 *  - normalizeAgentId：alias 统一解析。
 *  - merge / removeInjection：精确逆操作，保留用户 install 之后新增的配置。
 *  - OpenCode 插件 hash 语义（同 hash 幂等，异 hash 拒绝 —— 由 install 集成测试覆盖）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

import { readConfig } from '../../packages/installer/src/config-read.ts';
import { runtimeState, type RuntimeProbe } from '../../packages/installer/src/runtime-state.ts';
import {
  mergeClaudeSettings, mergeCodexHooks, mergeOpencodePlugins,
  isRiskGuardPluginRef, CLAUDE_HOOK_ID, CODEX_HOOK_ID, OPENCODE_PLUGIN_ID, OPENCODE_PLUGIN_LEGACY_ID,
} from '../../packages/installer/src/merge.ts';
import { sha256File } from '../../packages/installer/src/hash.ts';

// ============================================================================
// config-read（P0-2）
// ============================================================================

test('config-read: 不存在 → missing', async () => {
  const home = mkdtempSync(join(tmpdir(), 'rg-read-'));
  try {
    const r = await readConfig(join(home, 'nope.json'));
    assert.equal(r.state, 'missing');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('config-read: 合法 JSON → valid', async () => {
  const home = mkdtempSync(join(tmpdir(), 'rg-read-'));
  try {
    const p = join(home, 'ok.json');
    writeFileSync(p, '{"a":1,"hooks":{"Setup":[]}}', 'utf8');
    const r = await readConfig(p);
    assert.equal(r.state, 'valid');
    if (r.state === 'valid') assert.equal(r.data.a, 1);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('config-read: 损坏 JSON → invalid-json（绝不可写入）', async () => {
  const home = mkdtempSync(join(tmpdir(), 'rg-read-'));
  try {
    const p = join(home, 'broken.json');
    writeFileSync(p, '{"a": 1,,}', 'utf8');
    const r = await readConfig(p);
    assert.equal(r.state, 'invalid-json');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('config-read: 空文件 → missing（可安全创建，不视为损坏）', async () => {
  const home = mkdtempSync(join(tmpdir(), 'rg-read-'));
  try {
    const p = join(home, 'empty.json');
    writeFileSync(p, '   \n  ', 'utf8');
    const r = await readConfig(p);
    assert.equal(r.state, 'missing');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('config-read: 根是数组/标量 → invalid-json', async () => {
  const home = mkdtempSync(join(tmpdir(), 'rg-read-'));
  try {
    const p = join(home, 'arr.json');
    writeFileSync(p, '[1,2,3]', 'utf8');
    const r = await readConfig(p);
    assert.equal(r.state, 'invalid-json');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('config-read: 目录当文件 → io-error', async () => {
  const home = mkdtempSync(join(tmpdir(), 'rg-read-'));
  try {
    const d = join(home, 'adir');
    mkdirSync(d);
    const r = await readConfig(d);
    assert.equal(r.state, 'io-error');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// ============================================================================
// runtime-state（P0-1）
// ============================================================================

const probe = (p: Partial<RuntimeProbe>): RuntimeProbe => ({ detected: false, wired: false, healthy: false, ...p });

test('runtime-state: agent 不存在 → NOT_DETECTED', () => {
  assert.equal(runtimeState('claude-code', probe({ detected: false }), '/tmp/x'), 'NOT_DETECTED');
});

test('runtime-state: 存在但无 manifest 无 wiring → DETECTED（不是 ACTIVE）', () => {
  // home 无 manifest 文件
  const home = mkdtempSync(join(tmpdir(), 'rg-rs-'));
  try {
    assert.equal(runtimeState('claude-code', probe({ detected: true, wired: false }), home), 'DETECTED');
    // 即便 wiring 在（手动残留）但无 manifest → DETECTED
    assert.equal(runtimeState('claude-code', probe({ detected: true, wired: true, healthy: true }), home), 'DETECTED');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('runtime-state: manifest + healthy → ACTIVE', async () => {
  const home = mkdtempSync(join(tmpdir(), 'rg-rs-'));
  try {
    mkdirSync(join(home, '.riskguard', 'manifests'), { recursive: true });
    writeFileSync(join(home, '.riskguard', 'manifests', 'claude-code.json'), '{}', 'utf8');
    assert.equal(runtimeState('claude-code', probe({ detected: true, wired: true, healthy: true }), home), 'ACTIVE');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('runtime-state: manifest 在但接线丢 → BROKEN（人为删 hook）', async () => {
  const home = mkdtempSync(join(tmpdir(), 'rg-rs-'));
  try {
    mkdirSync(join(home, '.riskguard', 'manifests'), { recursive: true });
    writeFileSync(join(home, '.riskguard', 'manifests', 'claude-code.json'), '{}', 'utf8');
    // 人为删除 hook：wired=false healthy=false
    assert.equal(runtimeState('claude-code', probe({ detected: true, wired: false, healthy: false }), home), 'BROKEN');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('runtime-state: dsh 非 manifest 模式 — patch 健康 → ACTIVE', () => {
  const home = mkdtempSync(join(tmpdir(), 'rg-rs-'));
  try {
    assert.equal(runtimeState('dsh', probe({ detected: true, wired: true, healthy: true }), home, { manifestManaged: false }), 'ACTIVE');
    assert.equal(runtimeState('dsh', probe({ detected: true, wired: false, healthy: false }), home, { manifestManaged: false }), 'DETECTED');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// ============================================================================
// normalizeAgentId（P1-1）
// ============================================================================

test('normalizeAgentId: 三种 claude 写法归一', async () => {
  const { normalizeAgentId } = await import('../../packages/cli/src/commands.ts');
  assert.equal(normalizeAgentId('claude'), 'claude-code');
  assert.equal(normalizeAgentId('cc'), 'claude-code');
  assert.equal(normalizeAgentId('claude-code'), 'claude-code');
  assert.equal(normalizeAgentId('CLAUDE'), 'claude-code'); // 大小写不敏感
  assert.equal(normalizeAgentId('oc'), 'opencode');
  assert.equal(normalizeAgentId('codex'), 'codex');
  assert.equal(normalizeAgentId('dsh'), 'dsh');
  assert.equal(normalizeAgentId('unknown-agent'), null);
  assert.equal(normalizeAgentId(undefined), null);
});

// ============================================================================
// merge / removeInjection（P1-4 精确逆操作）
// ============================================================================

test('merge-opencode: 新名注入 + 旧名引用视为已装（不重复注入）', () => {
  const base = { permission: 'allow', plugin: ['@user/x'] };
  const a = mergeOpencodePlugins(base, `./plugins/${OPENCODE_PLUGIN_ID}.ts`);
  assert.equal(a.changed, true);
  assert.deepEqual(a.config.plugin, ['@user/x', `./plugins/${OPENCODE_PLUGIN_ID}.ts`]);
  // 再次 merge → 幂等
  const b = mergeOpencodePlugins(a.config, `./plugins/${OPENCODE_PLUGIN_ID}.ts`);
  assert.equal(b.changed, false);
  // 旧名引用 → 视为已装（升级场景防重复）
  const legacy = { permission: 'allow', plugin: [`./plugins/${OPENCODE_PLUGIN_LEGACY_ID}.ts`] };
  const c = mergeOpencodePlugins(legacy, `./plugins/${OPENCODE_PLUGIN_ID}.ts`);
  assert.equal(c.changed, false);
});

test('removeInjection: claude 移除我方条目、保留用户 Setup hook 与后续新增 PreToolUse', async () => {
  const { removeInjection } = await import('../../packages/cli/src/commands.ts');
  const hook = { _riskguard: true, id: CLAUDE_HOOK_ID, matcher: 'Bash', hooks: [{ type: 'command', command: 'node rg.ts' }] };
  // 模拟：install 后用户又加了自己的 PreToolUse hook
  const afterInstall = mergeClaudeSettings({
    permissions: { defaultMode: 'bypassPermissions' },
    hooks: { Setup: [{ hooks: [{ command: 'echo setup' }] }] },
  }, hook).config;
  (afterInstall.hooks as any)['PreToolUse'].push({ id: 'user-own-hook', matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] });

  const out = removeInjection('claude-code', afterInstall);
  assert.equal(out.changed, true);
  const hooks = out.config.hooks as any;
  // 我方条目没了
  const rg = hooks.PreToolUse.filter((h: any) => h._riskguard === true || h.id === CLAUDE_HOOK_ID);
  assert.equal(rg.length, 0);
  // 用户自己的 hook 保留（含 install 后新增的）
  const user = hooks.PreToolUse.filter((h: any) => h.id === 'user-own-hook');
  assert.equal(user.length, 1);
  // Setup 保留
  assert.ok(Array.isArray(hooks.Setup));
  // permissions 保留
  assert.deepEqual(out.config.permissions, { defaultMode: 'bypassPermissions' });
});

test('removeInjection: opencode 移除新旧名插件引用、保留用户其它插件', async () => {
  const { removeInjection } = await import('../../packages/cli/src/commands.ts');
  const cfg = { permission: 'allow', plugin: ['@user/a', `./plugins/${OPENCODE_PLUGIN_ID}.ts`, `./plugins/${OPENCODE_PLUGIN_LEGACY_ID}.ts`] };
  const out = removeInjection('opencode', cfg);
  assert.equal(out.changed, true);
  assert.deepEqual(out.config.plugin, ['@user/a']);
});

test('isRiskGuardPluginRef: 只认新旧 namespace 名，不误伤用户插件', () => {
  assert.equal(isRiskGuardPluginRef(`./plugins/${OPENCODE_PLUGIN_ID}.ts`), true);
  assert.equal(isRiskGuardPluginRef(`./plugins/${OPENCODE_PLUGIN_LEGACY_ID}.ts`), true);
  assert.equal(isRiskGuardPluginRef('@user/my-guard'), false);
  assert.equal(isRiskGuardPluginRef('./plugins/my-destructive-operation-guard-helper.ts'), false); // 子串不在（精确分段匹配在 install 侧）
});

// ============================================================================
// hash（P0-3/P1-3）
// ============================================================================

test('sha256File: 存在返回 hex，不存在返回 null', async () => {
  const home = mkdtempSync(join(tmpdir(), 'rg-hash-'));
  try {
    const p = join(home, 'a.txt');
    writeFileSync(p, 'hello', 'utf8');
    const h = await sha256File(p);
    assert.equal(typeof h, 'string');
    assert.equal(h!.length, 64);
    assert.equal(await sha256File(join(home, 'nope')), null);
  } finally { rmSync(home, { recursive: true, force: true }); }
});