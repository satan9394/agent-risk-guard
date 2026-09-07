/**
 * install-ux.test.ts — T7 安装器 UX 增强验证（detect 全量 / install 交互选择 / 非交互 fallback）
 *
 * 覆盖：
 *  - cmdDetect 遍历全部 AGENT_REGISTRY（含新增 agy），非 --json 列出完整 detected/not detected，
 *    --json 返回全量 map。
 *  - parseSelectionInput 把 "1,3"/"all"/"" 正确映射到索引 / 全量；非法输入返回 null。
 *  - interactiveSelectChoices 在注入 readable + isTTY=true 时确定性返回「子集选择」。
 *  - cmdInstall 非交互（无 --agent 无 TTY）默认全装已检测到的可安装 agent（绝不卡死）；
 *    --agent 精确指定保留；--yes 跳过交互。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable, Writable } from 'node:stream';
import { cmdDetect } from '../../packages/cli/src/commands.ts';

/** readline Interface 需要 output 是 EventEmitter（.on/.write/.isTTY）；用一个吞掉输出的 Writable */
function silentOut(): Writable {
  return new Writable({ write(_c, _e, cb) { cb(); } });
}
import {
  cmdInstall, parseSelectionInput, formatChoiceList, interactiveSelectChoices,
} from '../../packages/cli/src/commands.ts';

// ============================================================================
// cmdDetect —— 全量遍历（含 agy）
// ============================================================================

test('detect: 非 --json 列出全部 registry 且含 agy 行', () => {
  const out = cmdDetect({});
  // 关键既有四件套（claude-code/opencode/codex/dsh）仍在 detected 列表
  for (const id of ['Claude Code', 'Codex CLI', 'OpenCode', 'DSH']) {
    assert.ok(out.includes(id), `output should mention ${id}`);
  }
  // T7：新增 agy 必须出现在列表（detected 或 not detected 之一），且确实在列表里
  assert.ok(out.includes('Antigravity CLI (agy)'), 'output should list Antigravity CLI (agy)');
  // 每个 registry 条目都要有一行（完整列出，非只四件套）
  const rows = out.split('\n').filter((l) => /\s(detected|not detected)$/.test(l.trim()));
  assert.ok(rows.length >= 13, `expected full registry listing (>=13 rows incl DSH), got ${rows.length}`);
});

test('detect: --json 返回全量 map 且含 agy / dsh', () => {
  const j = JSON.parse(cmdDetect({ json: true }));
  assert.equal(typeof j['claude-code'], 'boolean');
  assert.equal(typeof j['opencode'], 'boolean');
  assert.equal(typeof j['codex'], 'boolean');
  assert.equal(typeof j['dsh'], 'boolean');
  assert.equal(typeof j['agy'], 'boolean', 'agy must be present in detect --json');
});

test('detect: 空 home（无任何 agent）仍列出全部 registry 为 not detected', () => {
  const home = mkdtempSync(join(tmpdir(), 'rg-detect-empty-'));
  try {
    const out = cmdDetect({ home });
    const s = out.toLowerCase();
    assert.ok(s.includes('antigravity cli (agy)'));
    assert.ok(s.includes('claude code'));
    assert.ok(s.includes('not detected'));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// ============================================================================
// parseSelectionInput
// ============================================================================

test('parseSelectionInput: "1,3" → [0,2]（1-based 索引）', () => {
  assert.deepEqual(parseSelectionInput('1,3', 3), [1, 3]);
  assert.deepEqual(parseSelectionInput('3,1', 3), [3, 1]);
});

test('parseSelectionInput: 空串 / "all" → "all"', () => {
  assert.equal(parseSelectionInput('', 3), 'all');
  assert.equal(parseSelectionInput('  ', 3), 'all');
  assert.equal(parseSelectionInput('all', 3), 'all');
  assert.equal(parseSelectionInput('ALL', 3), 'all');
});

test('parseSelectionInput: 非法（越界 / 非数字）→ null', () => {
  assert.equal(parseSelectionInput('0', 3), null);
  assert.equal(parseSelectionInput('4', 3), null);
  assert.equal(parseSelectionInput('abc', 3), null);
  assert.equal(parseSelectionInput('1,x', 3), null);
});

test('parseSelectionInput: 去重', () => {
  assert.deepEqual(parseSelectionInput('1,1,2', 3), [1, 2]);
});

// ============================================================================
// formatChoiceList
// ============================================================================

test('formatChoiceList: 编号从 1 开始', () => {
  const s = formatChoiceList([
    { id: 'claude-code', display: 'CC' },
    { id: 'codex', display: 'CX' },
    { id: 'opencode', display: 'OC' },
  ]);
  assert.ok(s.includes('1. CC'));
  assert.ok(s.includes('2. CX'));
  assert.ok(s.includes('3. OC'));
});

// ============================================================================
// interactiveSelectChoices —— 注入 readable + isTTY=true 确定性验证「选子集」
// ============================================================================

test('interactiveSelectChoices: 非 TTY → 直接全装（不阻塞、不读输入）', async () => {
  const choices = [
    { id: 'claude-code', display: 'CC' },
    { id: 'codex', display: 'CX' },
    { id: 'opencode', display: 'OC' },
  ];
  const out = await interactiveSelectChoices(choices, { isTTY: false });
  assert.deepEqual(out, ['claude-code', 'codex', 'opencode']);
});

test('interactiveSelectChoices: isTTY=true + 注入 "2\n" → 只选中第 2 项', async () => {
  const choices = [
    { id: 'claude-code', display: 'CC' },
    { id: 'codex', display: 'CX' },
    { id: 'opencode', display: 'OC' },
  ];
  const input = Readable.from(['2\n']);
  const out = await interactiveSelectChoices(choices, { input, output: silentOut(), isTTY: true }, 5000);
  assert.deepEqual(out, ['codex']);
});

test('interactiveSelectChoices: isTTY=true + 注入 "1,3\n" → 只选中第 1、3 项', async () => {
  const choices = [
    { id: 'claude-code', display: 'CC' },
    { id: 'codex', display: 'CX' },
    { id: 'opencode', display: 'OC' },
  ];
  const input = Readable.from(['1,3\n']);
  const out = await interactiveSelectChoices(choices, { input, output: silentOut(), isTTY: true }, 5000);
  assert.deepEqual(out, ['claude-code', 'opencode']);
});

test('interactiveSelectChoices: 回车（空）→ 全装', async () => {
  const choices = [
    { id: 'claude-code', display: 'CC' },
    { id: 'codex', display: 'CX' },
  ];
  const input = Readable.from(['\n']);
  const out = await interactiveSelectChoices(choices, { input, output: silentOut(), isTTY: true }, 5000);
  assert.deepEqual(out, ['claude-code', 'codex']);
});

// ============================================================================
// cmdInstall —— 非交互 fallback 默认全装 + --agent 保留（用临时 home + dryRun，绝不写生产）
// ============================================================================

/** 建一个检测到 claude-code / opencode / codex 的临时 home（各 agent 探测目录在在位） */
function fakeHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'rg-ux-'));
  mkdirSync(join(home, '.codex'), { recursive: true });
  mkdirSync(join(home, '.config', 'opencode', 'plugins'), { recursive: true });
  mkdirSync(join(home, '.claude'), { recursive: true });
  return home;
}

test('cmdInstall: 无 --agent + 非 TTY（dryRun）→ 默认全装已检测到（claude/opencode/codex）且不卡死', async () => {
  const home = fakeHome();
  try {
    const out = await cmdInstall({ home, dryRun: true });
    assert.ok(out.includes('Installing all detected agents'), 'should default-install all detected');
    assert.ok(out.includes('Claude Code'));
    assert.ok(out.includes('Codex CLI'));
    assert.ok(out.includes('OpenCode'));
    assert.ok(out.includes('(dry-run, no files changed)'));
    assert.ok(!out.includes('No installable agents detected'), 'should have candidates');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('cmdInstall: --agent codex（dryRun）→ 只处理 codex（精确指定保留）', async () => {
  const home = fakeHome();
  try {
    const out = await cmdInstall({ home, dryRun: true, only: 'codex' });
    assert.ok(out.includes('Codex CLI'));
    assert.ok(!out.includes('Claude Code'), 'only codex should be targeted');
    assert.ok(!out.includes('OpenCode'), 'only codex should be targeted');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('cmdInstall: --yes（dryRun）→ 跳过交互直接全装', async () => {
  const home = fakeHome();
  try {
    const out = await cmdInstall({ home, dryRun: true, yes: true });
    assert.ok(out.includes('Installing all detected agents'));
    assert.ok(out.includes('Claude Code'));
    assert.ok(out.includes('Codex CLI'));
    assert.ok(out.includes('OpenCode'));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('cmdInstall: 无检测到任何可安装 agent → 友好提示不崩', async () => {
  const home = mkdtempSync(join(tmpdir(), 'rg-ux-empty-'));
  try {
    const out = await cmdInstall({ home, dryRun: true });
    assert.ok(out.includes('No installable agents detected'));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});