/**
 * tests/acs/cli-acs-evaluate.test.ts — CLI `riskguard acs evaluate`（v0.2.0 §十七/§十八）
 *
 * 覆盖：stdin JSON → stdout Result JSON；非法输入 fail-closed（无 stack trace）；
 * strict profile；--audit JSONL；help 文本。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cmdAcsEvaluate, cmdHelp, acsHelpBlock } from '../../packages/cli/src/commands.ts';

const FIX = (name: string): string => readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'acs-v0.1', name), 'utf8');

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

test('acs evaluate：strict profile 生效（RG-S-DEL-001 替代 RG-FS-001）', () => {
  const autonomy = JSON.parse(cmdAcsEvaluate(FIX('filesystem-delete.json'))) as { decision: string; extensions: { riskguard: { ruleId: string } } };
  assert.equal(autonomy.decision, 'modify'); // Autonomy-Safe：RG-FS-001 + trash 提议 → modify
  assert.equal(autonomy.extensions.riskguard.ruleId, 'RG-FS-001');
  const strict = JSON.parse(cmdAcsEvaluate(FIX('filesystem-delete.json'), { profile: 'strict' })) as { decision: string; extensions: { riskguard: { ruleId: string } } };
  // Strict：删除能力从能力集移除（RG-S-DEL-001），仍带 trash 提议 → modify
  assert.equal(strict.decision, 'modify');
  assert.equal(strict.extensions.riskguard.ruleId, 'RG-S-DEL-001');
});

test('acs evaluate：--audit 追加脱敏 JSONL 审计行（§三十七/§三十八）', () => {
  const out = cmdAcsEvaluate(FIX('git-reset-hard.json'), { audit: true });
  const lines = out.split('\n').filter((l) => l.trim().length > 0);
  const last = JSON.parse(lines[lines.length - 1]!) as { acsVersion: string; decision: string; ruleId?: string };
  assert.equal(last.acsVersion, '0.1');
  assert.equal(last.decision, 'deny');
  // 审计行不包含 raw_command / arguments（§三十八）
  assert.ok(!out.includes('git reset') || lines.length === 1, 'audit 不得含敏感原文');
});

test('help 文本包含 acs evaluate', () => {
  assert.ok(cmdHelp().includes('acs evaluate'));
  assert.ok(acsHelpBlock().includes('ToolCallRequest'));
});
