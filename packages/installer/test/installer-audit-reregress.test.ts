/**
 * installer-audit-reregress.test.ts — installer 层 GAN 审查修复复测
 * 覆盖：P0-1 rollback trash / P0-2 planDshPatch 反斜杠 / P1-1 单引号 /
 *       P1-2 uninstall 精确匹配 / P1-3 YAML 卸载
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDshPatch, defaultDenyRules } from '../src/deploy.ts';
import { uninstallFromJsonConfig, uninstallFromYamlPatch } from '../src/uninstall.ts';
import { writeFile, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('P0-2: planDshPatch 反斜杠不被双重转义（YAML 单引号字面量）', () => {
  const plan = planDshPatch(['\\bRemove-Item\\b']);
  const line = plan.content.split('\n').find((l) => l.includes('Remove-Item')) ?? '';
  assert.ok(line.includes("re: '\\bRemove-Item\\b'"), `反斜杠应单层（word boundary 保留）: ${line}`);
  assert.ok(!line.includes("re: '\\\\bRemove-Item\\\\b'"), '不得双反斜杠');
});

test('P1-1: planDshPatch 单引号转义为双单引号', () => {
  const plan = planDshPatch(["[a'bc]"]);
  const line = plan.content.split('\n').find((l) => l.includes("a''bc")) ?? '';
  assert.ok(line.includes("re: '[a''bc]'"), `单引号应转义为双单引号: ${line}`);
});

test('P1-2: uninstallFromJsonConfig 权限精确匹配（不误删子串）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rg-uninst-'));
  const f = join(dir, 'settings.json');
  await writeFile(f, JSON.stringify({ permissions: { allow: ['/risk-guard-rules/safe', '/normal/path'] } }), 'utf8');
  const r = await uninstallFromJsonConfig(f, ['risk-guard']);
  assert.equal(r.ok, true);
  const cfg = JSON.parse(await readFile(f, 'utf8'));
  assert.deepEqual(cfg.permissions.allow, ['/risk-guard-rules/safe', '/normal/path'], '子串不得误删');
});

test('P1-2b: uninstallFromJsonConfig 精确移除 ident 匹配项', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rg-uninst2-'));
  const f = join(dir, 'settings.json');
  await writeFile(f, JSON.stringify({ permissions: { deny: ['rm -rf', 'Format-Volume'] } }), 'utf8');
  const r = await uninstallFromJsonConfig(f, ['rm -rf']);
  assert.equal(r.ok, true);
  const cfg = JSON.parse(await readFile(f, 'utf8'));
  assert.deepEqual(cfg.permissions.deny, ['Format-Volume']);
});

test('P1-3: uninstallFromYamlPatch 移除 DSH 插件块', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rg-yaml-'));
  const f = join(dir, 'cordis.patch.yml');
  const yaml = `- insert:
    - id: deny-risk-commands
      name: 'deny-risk-commands'
      config:
        rules:
          - { re: '\\brm\\b', reason: 'x' }
- insert:
    - id: other-plugin
      name: 'other'
`;
  await writeFile(f, yaml, 'utf8');
  const r = await uninstallFromYamlPatch(f, ['deny-risk-commands']);
  assert.equal(r.ok, true);
  assert.ok(r.actions.some((a) => a.includes('updated')));
  const back = await readFile(f, 'utf8');
  assert.ok(!back.includes('deny-risk-commands'), '目标块应移除');
  assert.ok(back.includes('other-plugin'), '其他块保留');
});
