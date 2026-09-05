/**
 * tests/acs/golden-fixtures.test.ts — ACS v0.1 Golden Fixtures（v0.2.0 §四十，v0.2.1 §二十/§四十五）
 *
 * tests/fixtures/acs-v0.1/*.json 每个都是真实链路 fixture（shell-safe / git-reset-hard /
 * filesystem-delete / credential-read / mcp-tool-call），带 _expected 决策。
 * 测试经 gateway 全链路（含 JSON 解析路径）验证并做 outbound schema 校验。
 *
 * v0.2.1 行为变更（§二十）：filesystem-delete（仅 path 参数）无法安全表达 trash 改写
 * → 不再伪造 modify，输出 deny。
 * 官方 shape 的 v0.1.0 fixtures（payload/envelope）见 tests/fixtures/acs-v0.1.0/，
 * 由 tests/acs-schema-conformance/ 覆盖。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateAcsToolCall } from '../../packages/acs/src/gateway.ts';
import { validateAcsResult } from '../../packages/acs/src/outbound.ts';
import { acsToolCallToRiskEvent } from '../../packages/acs/src/tool-call-request.ts';
import { riskDecisionToAcsResult } from '../../packages/acs/src/result.ts';
import { evaluate } from '../../packages/core/src/policy-engine.ts';
import { defaultPolicy } from '../../packages/core/src/rules/default-policy.ts';

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'acs-v0.1');

function listFixtures(): string[] {
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => join(FIXTURES_DIR, f))
    .sort();
}

interface Fixture {
  name: string;
  expected: string;
  requestRaw: string;
  request: Record<string, unknown>;
}

function loadFixture(path: string): Fixture {
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const expected = typeof parsed['_expected'] === 'string' ? parsed['_expected'] : '';
  const request = { ...parsed };
  delete request['_expected'];
  delete request['_note'];
  return { name: path.split(/[\\/]/).pop() ?? path, expected, requestRaw: JSON.stringify(request), request };
}

const FIXTURES = listFixtures().map(loadFixture);

test('golden fixtures 存在且完整（§四十 五件套）', () => {
  const names = FIXTURES.map((f) => f.name).sort();
  for (const expect of ['shell-safe.json', 'git-reset-hard.json', 'filesystem-delete.json', 'credential-read.json', 'mcp-tool-call.json']) {
    assert.ok(names.includes(expect), `missing fixture ${expect}`);
  }
  assert.ok(FIXTURES.length >= 5);
});

test('golden fixtures：gateway 全链路决策与 _expected 一致', () => {
  for (const f of FIXTURES) {
    assert.ok(f.expected, `${f.name} 缺 _expected`);
    // 走字符串路径（CLI 同路径，同时测 parse）
    const out = evaluateAcsToolCall(f.requestRaw);
    assert.equal(out.result.decision, f.expected, `${f.name}: expected ${f.expected}, got ${out.result.decision}`);
    assert.equal(out.degraded, false, `${f.name} 不应 degraded`);
    // outbound schema 校验（Layer 1：官方必填 type/acs_version/request_id 等）
    const v = validateAcsResult(out.result);
    assert.equal(v.ok, true, `${f.name}: invalid ACS result — ${v.problems.join('; ')}`);
  }
});

test('golden fixtures：allow/deny/ask 决策均有覆盖（modify 由 acs-v0.1.0 官方 fixtures 覆盖）', () => {
  const decisions = new Set(FIXTURES.map((f) => f.expected));
  assert.ok(decisions.has('allow'), '缺 allow fixture');
  assert.ok(decisions.has('deny'), '缺 deny fixture');
  assert.ok(decisions.has('ask'), '缺 ask fixture（mcp-tool-call）');
  // §二十：legacy filesystem-delete（仅 path）→ deny，不再伪造 modify
  const fsDelete = FIXTURES.find((f) => f.name === 'filesystem-delete.json');
  assert.ok(fsDelete, '缺 filesystem-delete fixture');
  assert.equal(fsDelete.expected, 'deny');
});

test('round-trip：ToolCallRequest → RiskEvent → Decision → ACS Result（显式链路）', () => {
  for (const f of FIXTURES) {
    // ToolCallRequest → RiskEvent
    const mapped = acsToolCallToRiskEvent(f.request as never);
    assert.equal(mapped.ok, true, `${f.name}: mapping failed`);
    if (!mapped.ok) continue;
    // RiskEvent → RiskGuard Decision
    const decision = evaluate(mapped.event, defaultPolicy());
    // Decision → ACS Result
    const result = riskDecisionToAcsResult(decision, {
      operation: `${mapped.event.operation.domain}.${mapped.event.operation.action}`,
      capability: mapped.meta.capability,
      profile: 'autonomy-safe',
      argumentValues: Object.fromEntries(
        Object.entries((f.request['arguments'] as Record<string, unknown> | undefined) ?? {}).map(([k, v]) => [
          k,
          v !== null && typeof v === 'object' && 'value' in (v as Record<string, unknown>) ? (v as Record<string, unknown>)['value'] : v,
        ]),
      ),
    });
    // ACS Result 校验
    const v = validateAcsResult(result);
    assert.equal(v.ok, true, `${f.name}: round-trip result invalid — ${v.problems.join('; ')}`);
    // deny/modify/ask 必须带 reasoning（§十五）
    if (result.decision !== 'allow') {
      assert.ok(result.reasoning && result.reasoning.length > 5, `${f.name}: reasoning 缺失`);
      assert.ok(result.policy_references?.length, `${f.name}: policy_references 缺失`);
    }
  }
});
