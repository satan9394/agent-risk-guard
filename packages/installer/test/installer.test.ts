/**
 * installer.test.ts — M6 测试
 *
 * 1) discovery D3 本机实测：真实 home 上 detectAgent（只读 stat）。
 * 2) deploy 计划生成：planAll() 产物结构 + 黑名单数量 + DSH patch 含 id。
 * 3) backup/rollback 回路：临时 fixture 文件 → backup → 改动 → rollback 恢复。
 * 4) doctor 结构：runDoctors 返回 checks 且不抛错。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverAgents, detectAgent, AGENT_REGISTRY } from '../src/discovery.ts';
import { planAll, planClaudeHook, defaultDenyRules } from '../src/deploy.ts';
import { backupPaths, backupRoot } from '../src/backup.ts';
import { rollbackAgent } from '../src/rollback.ts';
import { runDoctors } from '../src/doctor.ts';

const isWin = process.platform === 'win32';
const isCI = process.env.CI === 'true';

test('M6 discovery: 14 个 agent 都有探测路径且不抛错（本机 D3）', { skip: isCI }, async () => {
  const agents = discoverAgents();
  assert.equal(agents.length, AGENT_REGISTRY.length);
  for (const a of agents) {
    assert.ok(a.probeHit === null || typeof a.probeHit === 'string', `${a.id} probeHit`);
    assert.ok(a.installed === true || a.installed === false, `${a.id} installed`);
  }
  // 本机已知必装：claude-code / codex / cursor（True）
  const known = new Map(agents.map((a) => [a.id, a.installed]));
  assert.equal(known.get('claude-code'), true, 'claude-code 应已装');
  assert.equal(known.get('codex'), true, 'codex 应已装');
});

test('M6 deploy: planAll 生成 4 项且黑名单 ≥ 27 条', () => {
  const plans = planAll();
  assert.equal(plans.length, 4);
  const ids = plans.map((p) => p.agent);
  assert.ok(ids.includes('claude-code') && ids.includes('codex') && ids.includes('dsh'));
  assert.ok(defaultDenyRules().length >= 27, `黑名单 ${defaultDenyRules().length} 条`);
  const hook = JSON.parse(planClaudeHook(defaultDenyRules()).content);
  assert.ok(hook.hooks?.PreToolUse?.length >= 1);
});

test('M6 deploy: DSH patch 包含 deny-risk-commands id 与规则', () => {
  const patch = planAll().find((p) => p.agent === 'dsh')!;
  assert.ok(patch.content.includes('deny-risk-commands'));
  assert.ok(patch.content.includes("re: '"));
});

test('M6 backup/rollback: fixture 文件备份 → 覆盖 → 恢复回路', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rg-installer-'));
  // 用临时 home 隔离（铁律：不在真实 home 上做写测试）
  const fakeHome = join(dir, 'home');
  const prod = join(fakeHome, '.claude', 'settings.json');
  await mkdir(join(fakeHome, '.claude'), { recursive: true });
  await writeFile(prod, JSON.stringify({ hooks: { PreToolUse: [] } }), 'utf8');

  // 备份
  const bk = await backupPaths('claude-code', [prod], { home: fakeHome });
  assert.equal(bk.ok, true);
  assert.equal(bk.entries.length, 1);
  await writeFile(prod, JSON.stringify({ hooks: { PreToolUse: ['MUTATED'] } }), 'utf8');

  // 回滚
  const rb = await rollbackAgent('claude-code', [prod], { home: fakeHome });
  assert.equal(rb.ok, true);
  assert.equal(rb.restored.length, 1);
  const after = JSON.parse(await readFile(prod, 'utf8'));
  assert.deepEqual(after, { hooks: { PreToolUse: [] } });
});

test('M6 doctor: runDoctors 短路不抛错且有 checks', async () => {
  const report = await runDoctors();
  assert.ok(report.checks.length >= 6);
  for (const c of report.checks) {
    assert.ok(['ok', 'missing', 'stale', 'absent-agent'].includes(c.state));
  }
});