/**
 * opencode-config-mode.test.ts — OpenCode V1/V2 配置形态判定与 merge 语义（2026-09-22）
 *
 * 背景：V2（`@opencode/cli` >= 2.0）的本地插件改为 `~/.config/opencode/plugins/` **目录自动发现**，
 * 配置里再写 `.ts` 文件路径会报 `configured plugin path must be a directory`。
 * 因此 installer 必须按形态分流：
 *   - V1（`plugin` 数组）→ 追加 `./plugins/agent-risk-guard.ts`（原行为不变）；
 *   - V2（`plugins` 数组，或有 `cli.json` 旁证）→ 不写配置，并清理 V1 遗留的文件路径引用。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  mergeOpencodePlugins,
  detectOpencodeConfigMode,
  findOpencodeRiskGuardRef,
  isRiskGuardPluginRef,
} from '../src/merge.ts';

const REF = './plugins/agent-risk-guard.ts';

test('mode: plugin 数组 → v1', () => {
  assert.equal(detectOpencodeConfigMode({ plugin: ['@u/x'] }), 'v1');
});

test('mode: plugins 数组 → v2', () => {
  assert.equal(detectOpencodeConfigMode({ plugins: ['some-pkg'] }), 'v2');
});

test('mode: 两个键都没有时，cli.json 存在 → v2；无线索 → v1（向后兼容）', () => {
  const home = mkdtempSync(join(tmpdir(), 'rg-ocmode-'));
  try {
    mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
    writeFileSync(join(home, '.config', 'opencode', 'cli.json'), '{}', 'utf8');
    assert.equal(detectOpencodeConfigMode({}, home), 'v2');
    assert.equal(detectOpencodeConfigMode({}, undefined), 'v1');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('v1 merge: 追加引用并保留用户插件；再跑一次幂等', () => {
  const first = mergeOpencodePlugins({ permission: 'allow', plugin: ['@u/x'] }, REF);
  assert.equal(first.changed, true);
  assert.deepEqual((first.config as any).plugin, ['@u/x', REF]);
  const again = mergeOpencodePlugins(first.config, REF);
  assert.equal(again.changed, false);
  assert.deepEqual((again.config as any).plugin, ['@u/x', REF]);
});

test('v2 merge: 不写配置；清理 plugin / plugins 两处的遗留文件路径引用', () => {
  const r = mergeOpencodePlugins({ permission: 'allow', plugins: ['some-pkg', REF], plugin: [REF, '@u/x'] }, REF);
  assert.equal(r.changed, true);
  assert.deepEqual((r.config as any).plugins, ['some-pkg']);
  assert.deepEqual((r.config as any).plugin, ['@u/x']);
  assert.equal((r.config as any).permission, 'allow');
});

test('v2 merge: 干净的 V2 配置无需改动（幂等）', () => {
  const r = mergeOpencodePlugins({ plugins: ['some-pkg'] }, REF);
  assert.equal(r.changed, false);
  assert.deepEqual((r.config as any).plugins, ['some-pkg']);
});

test('v2 merge: 我方是唯一条目时删除空数组键，不留 `plugin: []`', () => {
  const r = mergeOpencodePlugins({ plugin: [REF] }, REF, { mode: 'v2' });
  assert.equal(r.changed, true);
  assert.equal(Object.prototype.hasOwnProperty.call(r.config, 'plugin'), false);
});

test('findOpencodeRiskGuardRef: V1/V2 两键都查并回报命中键', () => {
  assert.deepEqual(findOpencodeRiskGuardRef({ plugin: [REF] }), { found: true, key: 'plugin' });
  assert.deepEqual(findOpencodeRiskGuardRef({ plugins: [REF] }), { found: true, key: 'plugins' });
  assert.deepEqual(findOpencodeRiskGuardRef({ plugins: ['some-pkg'] }), { found: false, key: null });
});

test('isRiskGuardPluginRef: 新名 / 旧名 / 绝对路径都算我方，他人插件不算', () => {
  assert.equal(isRiskGuardPluginRef(REF), true);
  assert.equal(isRiskGuardPluginRef('./plugins/destructive-operation-guard.ts'), true);
  assert.equal(isRiskGuardPluginRef('C:\\x\\plugins\\agent-risk-guard.ts'), true);
  assert.equal(isRiskGuardPluginRef('@u/x'), false);
});
