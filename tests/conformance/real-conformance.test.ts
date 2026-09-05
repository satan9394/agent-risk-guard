/**
 * tests/conformance/real-conformance.test.ts — Real Agent D3 Evidence 格式（v0.3.0 §二十~§四十八）
 *
 * 只测 evidence 格式 / 校验 / 新鲜度 / 脱敏（机器可读，CI 可跑）。
 * 真实 Agent 会话是 local/manual 步骤（§四十五）；本套件不伪装 CI = D3（§四十六）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildD3Evidence,
  validateD3Evidence,
  computeFreshness,
  d3EvidenceToJson,
  summarizeCapabilityD3,
  D3_TESTS,
} from '../../packages/acs/src/real-conformance.ts';

function validEvidence(partial: Partial<Parameters<typeof buildD3Evidence>[0]> = {}) {
  return buildD3Evidence({
    agent: 'cursor',
    agentVersion: '1.0.0',
    platform: 'windows',
    test: 'git-reset-hard',
    riskguardDecision: 'deny',
    toolExecuted: false,
    sideEffectPreserved: true,
    hookFailureSemantics: 'fail-closed',
    result: 'PASS',
    ...partial,
  });
}

test('§十七/§二十：D3 五类场景 + 必填字段完整', () => {
  assert.deepEqual([...D3_TESTS], ['safe-command', 'git-reset-hard', 'permanent-delete', 'safe-replacement', 'hook-failure']);
  const v = validateD3Evidence(validEvidence());
  assert.equal(v.ok, true, v.problems.join('; '));
});

test('§四十六：CI 只校验 evidence schema（缺必填 → fail，不伪装 D3）', () => {
  const missing = validEvidence() as Record<string, unknown>;
  delete missing['toolExecuted'];
  assert.equal(validateD3Evidence(missing).ok, false);
  // 非法 agent / test / result 拒绝
  assert.equal(validateD3Evidence({ ...validEvidence(), agent: 'gemini' }).ok, false);
  assert.equal(validateD3Evidence({ ...validEvidence(), test: 'nuke' }).ok, false);
  assert.equal(validateD3Evidence({ ...validEvidence(), result: 'MAYBE' }).ok, false);
  // 非对象 / null 拒绝
  assert.equal(validateD3Evidence(null).ok, false);
  assert.equal(validateD3Evidence([]).ok, false);
});

test('§四十一/§四十二：D3 核心判据是「工具没执行 + 副作用保留」，不是「deny 文本」', () => {
  // 只有 deny 输出但工具实际执行了 → 不是 D3 证据（toolExecuted=true 会被诚实记录）
  const e = validEvidence({ riskguardDecision: 'deny', toolExecuted: true, sideEffectPreserved: false, result: 'FAIL' });
  assert.equal(validateD3Evidence(e).ok, true); // schema 仍合法，但结果 FAIL（诚实）
  assert.equal(e.result, 'FAIL');
});

test('§四十八：freshness current / stale / unknown，只提示不自动降级', () => {
  assert.equal(computeFreshness('1.0.0', '1.0.0'), 'current');
  assert.equal(computeFreshness('1.0.0', '1.1.0'), 'stale');
  assert.equal(computeFreshness(undefined, '1.0.0'), 'unknown');
  assert.equal(computeFreshness('1.0.0', undefined), 'unknown');
});

test('§三十八：evidence 序列化出口脱敏（token/API key/path 不回显明文）', () => {
  const e = validEvidence({ notes: 'token=sk-abcdef1234567890abcdef1234567890 secret leaked' });
  const json = d3EvidenceToJson(e);
  assert.ok(!json.includes('sk-abcdef1234567890abcdef1234567890'), 'API key 不得明文');
  assert.ok(json.includes('[REDACTED]'), '敏感串应替换为占位符');
  // 仍是合法 JSON
  const parsed = JSON.parse(json) as { notes: string };
  assert.ok(parsed.notes.includes('[REDACTED]'));
});

test('§三十五：per-capability D3 汇总（deny 且未执行 → D3；否则不标 D3）', () => {
  const records = [
    validEvidence({ capability: 'shell.execute' }),
    validEvidence({ capability: 'shell.execute', test: 'permanent-delete' }),
  ];
  const caps = summarizeCapabilityD3('cursor', '1.0.0', records);
  const shell = caps.find((c) => c.capability === 'shell.execute');
  assert.equal(shell?.verification, 'D3');
  assert.equal(shell?.hardDeny, true);
  assert.equal(shell?.lastVerifiedAgentVersion, '1.0.0');
  // 工具实际执行（FAIL）→ 不标 D3
  const failed = summarizeCapabilityD3('cursor', '1.0.0', [
    validEvidence({ capability: 'filesystem.delete', toolExecuted: true, sideEffectPreserved: false, result: 'FAIL' }),
  ]);
  assert.equal(failed[0]?.verification, 'D2');
  assert.equal(failed[0]?.hardDeny, undefined);
});
