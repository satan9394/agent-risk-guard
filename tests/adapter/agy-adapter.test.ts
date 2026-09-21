/**
 * agy-adapter.test.ts — Antigravity CLI (agy) PreToolUse Adapter（v0.1，D2 payload 单测 + D3 证据引用）
 *
 * 官方机制 2026-09-06 核查（antigravity.google/docs/hooks）：
 *   - 全局 hooks ~/.gemini/config/hooks.json；PreToolUse matcher run_command
 *   - stdin { toolCall.args.CommandLine }；stdout 顶层 { decision, reason }；exit 0 恒
 * 真实 D3（本机 2026-09-06）：真实 agy 会话尝试 `git reset --hard HEAD` → hook deny，
 *   未提交修改保留（M file.txt 仍存在）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractAgyCommand,
  renderAgyDecision,
  agyHooksConfig,
  AGY_HOOKS_GLOBAL,
  AGY_HOOKS_WORKSPACE,
} from '../../packages/adapters/agy/src/index.ts';

test('extractAgyCommand：CommandLine / command 兼容提取', () => {
  assert.equal(extractAgyCommand({ toolCall: { name: 'run_command', args: { CommandLine: 'git status' } } }), 'git status');
  assert.equal(extractAgyCommand({ toolCall: { name: 'run_command', args: { command: 'ls' } } }), 'ls');
  assert.equal(extractAgyCommand({ toolCall: { args: {} } }), undefined);
  assert.equal(extractAgyCommand({}), undefined);
  assert.equal(extractAgyCommand({ toolCall: { args: { CommandLine: '   ' } } }), undefined);
});

test('renderAgyDecision：deny 顶层 decision + reason；allow 无 reason', () => {
  const deny = JSON.parse(renderAgyDecision({ decision: 'deny', reason: 'git reset hard blocked' })) as { decision: string; reason: string };
  assert.equal(deny.decision, 'deny');
  assert.ok(deny.reason.includes('git reset hard blocked'));
  assert.ok(deny.reason.startsWith('RiskGuard:'));
  const allow = JSON.parse(renderAgyDecision({ decision: 'allow' })) as { decision: string; reason?: string };
  assert.equal(allow.decision, 'allow');
  assert.equal(allow.reason, undefined);
});

test('agyHooksConfig：hooks.json 形状 + matcher run_command + 绝对路径', () => {
  const cfg = JSON.parse(agyHooksConfig('C:\\Users\\x\\.gemini\\config\\hooks\\agy-dangerous-commands.ps1')) as {
    'riskguard-dangerous-commands': { PreToolUse: Array<{ matcher: string; hooks: Array<{ type: string; command: string; timeout: number }> }> };
  };
  const entry = cfg['riskguard-dangerous-commands'];
  assert.equal(entry.PreToolUse[0].matcher, 'run_command');
  assert.equal(entry.PreToolUse[0].hooks[0].type, 'command');
  assert.ok(entry.PreToolUse[0].hooks[0].command.includes('powershell.exe'));
  assert.ok(entry.PreToolUse[0].hooks[0].command.includes('agy-dangerous-commands.ps1'));
  // 2026-09-21：默认 timeout 对齐**实测在用**的 15s（适配器还要再 spawn 一次规则引擎）。
  //   生成器不得比实测值更紧 —— 本机 hooks.json 用的就是 15。
  assert.equal(entry.PreToolUse[0].hooks[0].timeout, 15);
  // 生成值与本机手工值的两处已知差异（有意保留）：引擎 powershell.exe vs pwsh、guard 名不同。
  // 钉住「生成器仍写 powershell.exe」以免有人顺手改成 pwsh 而让无 pwsh 的机器装不上。
  assert.match(entry.PreToolUse[0].hooks[0].command, /^powershell\.exe /);
});

test('官方路径常量', () => {
  assert.equal(AGY_HOOKS_GLOBAL, '~/.gemini/config/hooks.json');
  assert.equal(AGY_HOOKS_WORKSPACE, '.agents/hooks.json');
});
