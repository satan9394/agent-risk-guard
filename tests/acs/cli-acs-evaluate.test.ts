/**
 * tests/acs/cli-acs-evaluate.test.ts — CLI `riskguard acs evaluate`（v0.2.0 §十七/§十八，v0.2.1 §四十七/§四十八）
 *
 * 覆盖：stdin JSON → stdout Result JSON；非法输入 fail-closed（无 stack trace）；
 * strict profile；--audit JSONL；--wire 官方 Envelope → Envelope；help 文本。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cmdAcsEvaluate, cmdHelp, acsHelpBlock } from '../../packages/cli/src/commands.ts';

const FIX = (name: string): string => readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'acs-v0.1', name), 'utf8');
const FIX010 = (name: string): string => readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'acs-v0.1.0', 'envelope', name), 'utf8');

test('acs evaluate：shell-safe → allow JSON', () => {
  const out = cmdAcsEvaluate(FIX('shell-safe.json'));
  const result = JSON.parse(out) as { decision: string };
  assert.equal(result.decision, 'allow');
});

test('acs evaluate：git-reset-hard → deny + reasoning 可解释', () => {
  const out = cmdAcsEvaluate(FIX('git-reset-hard.json'));
  const result = JSON.parse(out) as { decision: string; reasoning: string; extensions: { riskguard: { ruleId: string } } };
  assert.equal(result.decision, 'deny');
  assert.equal(result.extensions.riskguard.ruleId, 'RG-GIT-001');
  assert.ok(result.reasoning.includes('RG-GIT-001'));
});

test('acs evaluate：非法输入 fail-closed，无 stack trace（§十八）', () => {
  const out = cmdAcsEvaluate('{broken json');
  const result = JSON.parse(out) as { decision: string; reasoning: string; extensions: { riskguard: { degraded: boolean } } };
  assert.equal(result.decision, 'deny');
  assert.equal(result.extensions.riskguard.degraded, true);
  assert.ok(result.reasoning.includes('Invalid ACS ToolCallRequest'));
  // 绝不输出 stack trace
  assert.ok(!out.includes('Error:') && !out.includes('at '));
});

test('acs evaluate：空输入 → fail-closed', () => {
  const out = cmdAcsEvaluate('');
  assert.equal((JSON.parse(out) as { decision: string }).decision, 'deny');
});

test('acs evaluate：strict profile 生效（§二十：仅 path 参数 → 两个 profile 都 deny）', () => {
  const autonomy = JSON.parse(cmdAcsEvaluate(FIX('filesystem-delete.json'))) as { decision: string; extensions: { riskguard: { ruleId: string } } };
  // Autonomy-Safe：RG-FS-001 deny + trash 提议，但仅 path 参数无法安全表达改写 → deny（§二十）
  assert.equal(autonomy.decision, 'deny');
  assert.equal(autonomy.extensions.riskguard.ruleId, 'RG-FS-001');
  const strict = JSON.parse(cmdAcsEvaluate(FIX('filesystem-delete.json'), { profile: 'strict' })) as { decision: string; extensions: { riskguard: { ruleId: string } } };
  assert.equal(strict.decision, 'deny');
  assert.equal(strict.extensions.riskguard.ruleId, 'RG-S-DEL-001');
});

test('acs evaluate：--audit 追加脱敏 JSONL 审计行（§三十七/§三十八）', () => {
  const out = cmdAcsEvaluate(FIX('git-reset-hard.json'), { audit: true });
  const lines = out.split('\n').filter((l) => l.trim().length > 0);
  const last = JSON.parse(lines[lines.length - 1]!) as { acsVersion: string; decision: string; ruleId?: string };
  assert.equal(last.acsVersion, '0.1.0');
  assert.equal(last.decision, 'deny');
  // 审计行不包含 raw_command / arguments（§三十八）
  assert.ok(!out.includes('git reset') || lines.length === 1, 'audit 不得含敏感原文');
});

test('acs evaluate --wire：官方 Request Envelope → Response Envelope（§四十七）', () => {
  const out = cmdAcsEvaluate(FIX010('shell-safe.json'), { wire: true });
  const envelope = JSON.parse(out) as { jsonrpc: string; id: number; result?: { decision: string; request_id: string; type: string; acs_version: string }; error?: { code: number } };
  assert.equal(envelope.jsonrpc, '2.0');
  assert.equal(envelope.id, 1);
  assert.equal(envelope.error, undefined);
  assert.equal(envelope.result?.decision, 'allow');
  assert.equal(envelope.result?.type, 'final');
  assert.equal(envelope.result?.acs_version, '0.1.0');
  assert.equal(envelope.result?.request_id, '5f1c9c3e-2b4a-4f6d-9a3e-8f2b1d0c4a77');
});

test('acs evaluate --wire：危险请求 → deny Response Envelope（非协议错误）', () => {
  const out = cmdAcsEvaluate(FIX010('git-reset-hard.json'), { wire: true });
  const envelope = JSON.parse(out) as { result?: { decision: string; extensions: { riskguard: { ruleId: string } } } };
  assert.equal(envelope.result?.decision, 'deny');
  assert.equal(envelope.result?.extensions?.riskguard?.ruleId, 'RG-GIT-001');
});

test('acs evaluate --wire：非法 JSON → JSON-RPC Parse error（-32700）', () => {
  const out = cmdAcsEvaluate('{broken', { wire: true });
  const envelope = JSON.parse(out) as { error: { code: number }; id: null };
  assert.equal(envelope.error.code, -32700);
  assert.equal(envelope.id, null);
});

test('help 文本包含 acs evaluate 与 --wire（§四十八：两种模式必须明确）', () => {
  assert.ok(cmdHelp().includes('acs evaluate'));
  assert.ok(acsHelpBlock().includes('ToolCallRequest'));
  assert.ok(acsHelpBlock().includes('--wire'));
  assert.ok(acsHelpBlock().includes('payload compatibility mode') || acsHelpBlock().includes('payload mode'));
  assert.ok(acsHelpBlock().includes('Request Envelope'));
});
