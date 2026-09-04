/**
 * lifecycle.e2e.test.ts — v0.1.0 发布前整改：完整生命周期 E2E（关键验收）
 *
 * 场景（Fresh fake HOME）：
 *   detect → install → status → doctor → 再次 install（幂等）→
 *   用户后续修改自己的配置 → uninstall → 确认用户原配置 + 后续新增配置全部保留。
 *
 * 价值高于几十个简单单测：真实走 CLI 代码路径（spawn node index.ts），
 * 覆盖 P0-2（损坏配置拒装）、P0-3（同名异内容拒装）、P0-4（事务）、P1-4（保留用户后续修改）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const CLI = join(ROOT, 'packages', 'cli', 'src', 'index.ts');

function rg(args: string[], home: string): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [CLI, ...args, '--home', home], { encoding: 'utf8' });
  return { stdout: (r.stdout ?? ''), stderr: (r.stderr ?? ''), status: r.status ?? -1 };
}

function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'rg-life-'));
  // —— 真实风格 Agent 配置 ——
  // Claude：Setup hook + permissions（bypassPermissions）
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({
    permissions: { defaultMode: 'bypassPermissions' },
    hooks: { Setup: [{ hooks: [{ command: 'echo user-setup', type: 'command' }] }] },
    model: 'opus',
  }, null, 2), 'utf8');
  // OpenCode：用户已有插件
  mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
  writeFileSync(join(home, '.config', 'opencode', 'opencode.json'), JSON.stringify({
    permission: 'allow', plugin: ['@user/existing-plugin'],
  }, null, 2), 'utf8');
  // Codex：用户已有 Bash hook
  mkdirSync(join(home, '.codex'), { recursive: true });
  writeFileSync(join(home, '.codex', 'hooks.json'), JSON.stringify({
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo user-hook' }] }] },
  }, null, 2), 'utf8');
  return home;
}

const CLAUDE_SETTINGS = (h: string) => join(h, '.claude', 'settings.json');
const OPENCODE_CFG = (h: string) => join(h, '.config', 'opencode', 'opencode.json');
const CODEX_HOOKS = (h: string) => join(h, '.codex', 'hooks.json');

test('lifecycle: detect 全部 detected', () => {
  const home = makeHome();
  try {
    const r = rg(['detect'], home);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Claude Code\s+detected/);
    assert.match(r.stdout, /OpenCode\s+detected/);
    assert.match(r.stdout, /Codex CLI\s+detected/);
    const j = rg(['detect', '--json'], home);
    const map = JSON.parse(j.stdout);
    assert.deepEqual(map, { 'claude-code': true, codex: true, opencode: true, dsh: false });
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('lifecycle: install → status ACTIVE → doctor PASS → 二次 install 幂等', () => {
  const home = makeHome();
  try {
    // 1. 安装前 status：DETECTED（不是 ACTIVE）
    const before = rg(['status'], home);
    assert.match(before.stdout, /Claude Code[\s\S]*?Runtime: DETECTED/);

    // 2. install 全部
    const inst = rg(['install'], home);
    assert.equal(inst.status, 0, inst.stderr);
    assert.match(inst.stdout, /installed/);

    // 3. status → ACTIVE
    const after = rg(['status'], home);
    assert.match(after.stdout, /Claude Code[\s\S]*?Runtime: ACTIVE/);
    assert.match(after.stdout, /OpenCode[\s\S]*?Runtime: ACTIVE/);
    assert.match(after.stdout, /Codex CLI[\s\S]*?Runtime: ACTIVE/);

    // 4. doctor → 3 PASS（agent 相关），无 FAIL
    const doc = rg(['doctor'], home);
    assert.match(doc.stdout, /PASS\s+claude-code/);
    assert.match(doc.stdout, /PASS\s+codex/);
    assert.match(doc.stdout, /PASS\s+opencode/);

    // 5. 再次 install → 幂等，不重复注入（各 agent 恰好 1 条我方条目）
    const inst2 = rg(['install'], home);
    assert.equal(inst2.status, 0);
    assert.match(inst2.stdout, /already installed \(idempotent, no change\)/);
    const cc = JSON.parse(readFileSync(CLAUDE_SETTINGS(home), 'utf8'));
    const rgHooks = cc.hooks.PreToolUse.filter((h: any) => h._riskguard === true || h.id === 'riskguard-pre-tool-hook');
    assert.equal(rgHooks.length, 1);
    const cx = JSON.parse(readFileSync(CODEX_HOOKS(home), 'utf8'));
    const rgCodex = cx.hooks.PreToolUse.filter((h: any) => h._riskguard === true || h.id === 'riskguard-codex-hook');
    assert.equal(rgCodex.length, 1);
    const oc = JSON.parse(readFileSync(OPENCODE_CFG(home), 'utf8'));
    assert.equal(oc.plugin.filter((p: string) => p.includes('agent-risk-guard')).length, 1);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('lifecycle: 用户 install 后新增配置 → uninstall 后全部保留', () => {
  const home = makeHome();
  try {
    const inst = rg(['install'], home);
    assert.equal(inst.status, 0, inst.stderr);

    // —— 用户在 RiskGuard 安装后，又修改了自己的配置 ——
    // Claude：加了新 env + 新 PreToolUse 用户 hook
    const ccPath = CLAUDE_SETTINGS(home);
    const cc = JSON.parse(readFileSync(ccPath, 'utf8'));
    cc.env = { MY_FLAG: '1' };
    cc.hooks.PreToolUse.push({ id: 'user-later-hook', matcher: 'Bash', hooks: [{ type: 'command', command: 'echo later' }] });
    writeFileSync(ccPath, JSON.stringify(cc, null, 2), 'utf8');
    // OpenCode：加了新插件
    const ocPath = OPENCODE_CFG(home);
    const oc = JSON.parse(readFileSync(ocPath, 'utf8'));
    oc.plugin.push('@user/later-plugin');
    writeFileSync(ocPath, JSON.stringify(oc, null, 2), 'utf8');

    // —— uninstall ——
    const un = rg(['uninstall'], home);
    assert.equal(un.status, 0, un.stderr);
    assert.match(un.stdout, /uninstalled/);

    // —— 验证：用户原配置 + 后续新增全部保留，RiskGuard 条目已移除 ——
    const cc2 = JSON.parse(readFileSync(ccPath, 'utf8'));
    assert.deepEqual(cc2.permissions, { defaultMode: 'bypassPermissions' });      // 原配置
    assert.equal(cc2.env.MY_FLAG, '1');                                            // 后续新增 env
    assert.equal(cc2.hooks.Setup[0].hooks[0].command, 'echo user-setup');          // 原 Setup
    const userHooks = cc2.hooks.PreToolUse.filter((h: any) => h.id === 'user-later-hook');
    assert.equal(userHooks.length, 1);                                             // 后续新增用户 hook
    const rgLeft = cc2.hooks.PreToolUse.filter((h: any) => h._riskguard === true || h.id === 'riskguard-pre-tool-hook');
    assert.equal(rgLeft.length, 0);                                                // RiskGuard 已移除

    const oc2 = JSON.parse(readFileSync(ocPath, 'utf8'));
    assert.ok(oc2.plugin.includes('@user/existing-plugin'));                       // 原插件
    assert.ok(oc2.plugin.includes('@user/later-plugin'));                          // 后续新增插件
    assert.equal(oc2.plugin.filter((p: string) => p.includes('agent-risk-guard') || p.includes('destructive-operation-guard')).length, 0);

    const cx2 = JSON.parse(readFileSync(CODEX_HOOKS(home), 'utf8'));
    assert.equal(cx2.hooks.PreToolUse[0].hooks[0].command, 'echo user-hook');      // 原用户 hook
    const rgCx = cx2.hooks.PreToolUse.filter((h: any) => h._riskguard === true || h.id === 'riskguard-codex-hook');
    assert.equal(rgCx.length, 0);

    // manifest 已移除
    assert.equal(existsSync(join(home, '.riskguard', 'manifests', 'claude-code.json')), false);
    // 二次 uninstall → 幂等
    const un2 = rg(['uninstall'], home);
    assert.match(un2.stdout, /not installed \(no manifest\)/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('lifecycle: invalid JSON 配置 → install 拒绝且零写入（P0-2）', () => {
  const home = makeHome();
  try {
    writeFileSync(CLAUDE_SETTINGS(home), '{"broken": ,,,}', 'utf8');
    const before = readFileSync(CLAUDE_SETTINGS(home), 'utf8');
    const r = rg(['install', '--agent', 'claude'], home);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /installation aborted/);
    assert.match(r.stdout, /contains invalid JSON/);
    assert.match(r.stdout, /made no changes/);
    const after = readFileSync(CLAUDE_SETTINGS(home), 'utf8');
    assert.equal(after, before); // 零写入
    // 无 manifest 产生
    assert.equal(existsSync(join(home, '.riskguard', 'manifests', 'claude-code.json')), false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('lifecycle: alias 安装（--agent claude / oc / codex 等价 canonical）', () => {
  const home = makeHome();
  try {
    const r = rg(['install', '--agent', 'claude'], home);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Claude Code: installed/);
    // 只有 claude 被装，opencode 未被装
    const oc = JSON.parse(readFileSync(OPENCODE_CFG(home), 'utf8'));
    assert.equal(oc.plugin.includes('./plugins/agent-risk-guard.ts'), false);
    // 未知 alias → 提示跳过，不崩
    const u = rg(['install', '--agent', 'nonsense'], home);
    assert.equal(u.status, 0);
    assert.match(u.stdout, /Unknown agent: nonsense/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('lifecycle: 人为删 hook → status BROKEN（P0-1）', () => {
  const home = makeHome();
  try {
    rg(['install', '--agent', 'claude'], home);
    // 人为删除 RiskGuard hook
    const cc = JSON.parse(readFileSync(CLAUDE_SETTINGS(home), 'utf8'));
    cc.hooks.PreToolUse = cc.hooks.PreToolUse.filter((h: any) => !(h._riskguard === true));
    writeFileSync(CLAUDE_SETTINGS(home), JSON.stringify(cc, null, 2), 'utf8');
    const st = rg(['status'], home);
    assert.match(st.stdout, /Claude Code[\s\S]*?Runtime: BROKEN/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('lifecycle: OpenCode 插件同名异内容 → 拒绝安装（P0-3）', () => {
  const home = makeHome();
  try {
    // 预置一个与 RiskGuard 同名但内容不同的文件
    const plugDir = join(home, '.config', 'opencode', 'plugins');
    mkdirSync(plugDir, { recursive: true });
    writeFileSync(join(plugDir, 'agent-risk-guard.ts'), '// user owns this file\n', 'utf8');
    const before = readFileSync(join(plugDir, 'agent-risk-guard.ts'), 'utf8');
    const r = rg(['install', '--agent', 'oc'], home);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /plugin installation aborted/);
    assert.match(r.stdout, /not owned by this RiskGuard installation/);
    assert.match(r.stdout, /No files were overwritten/);
    // 文件未被覆盖，opencode.json 未被修改（config 引用不会加入）
    const after = readFileSync(join(plugDir, 'agent-risk-guard.ts'), 'utf8');
    assert.equal(after, before);
    const oc = JSON.parse(readFileSync(OPENCODE_CFG(home), 'utf8'));
    assert.equal(oc.plugin.includes('./plugins/agent-risk-guard.ts'), false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});