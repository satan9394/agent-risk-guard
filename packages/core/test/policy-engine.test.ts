/**
 * policy-engine.test.ts — Policy Engine 单元测试（RG-I01..I04 + §15 规则）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEvent, type RiskEvent } from '../src/event.ts';
import { evaluate, evaluateAll, parseFailureDecision } from '../src/policy-engine.ts';
import { defaultPolicy, strictPolicy } from '../src/rules/default-policy.ts';
import { deny, allow, ask, monotonicDeny, combineDecisions, failClosed } from '../src/decision.ts';

function fsEvent(action: string, extra: Partial<RiskEvent> = {}): RiskEvent {
  return createEvent({
    source: { agent: 'test', surface: 'unit' },
    operation: { domain: 'filesystem', action: action as never, destructive: false, reversible: true },
    targets: [],
    ...extra,
  });
}

test('RG-I01: 永久删除默认 deny（RG-FS-001）', () => {
  const d = evaluate(fsEvent('delete', {
    operation: { domain: 'filesystem', action: 'delete', destructive: true, reversible: false },
  }), defaultPolicy());
  assert.equal(d.decision, 'deny');
  assert.equal(d.ruleId, 'RG-FS-001');
  assert.equal(d.safeAlternative?.operation, 'trash');
  assert.equal(d.monotonic, true);
});

test('RG-I01: recursive_delete 同样 deny', () => {
  const d = evaluate(fsEvent('recursive_delete', {
    operation: { domain: 'filesystem', action: 'recursive_delete', destructive: true, reversible: false },
  }), defaultPolicy());
  assert.equal(d.decision, 'deny');
  assert.equal(d.ruleId, 'RG-FS-001');
});

test('RG-I01: trash 放行（§6 统一 Trash 能力）', () => {
  // trash 是安全替代能力，默认放行（RG-TRASH-001 语义：filesystem.trash → ALLOW）
  const d = evaluate(fsEvent('trash'), defaultPolicy());
  assert.equal(d.decision, 'allow');
});

test('RG-I02: guard 自保护单调 deny（RG-GUARD-001/002）', () => {
  const d = evaluate(createEvent({
    source: { agent: 'test', surface: 'unit' },
    operation: { domain: 'guard', action: 'guard_modify', destructive: true, reversible: false },
    targets: [],
  }), defaultPolicy());
  assert.equal(d.decision, 'deny');
  assert.equal(d.monotonic, true);
  assert.equal(d.ruleId, 'RG-GUARD-001');

  const d2 = evaluate(createEvent({
    source: { agent: 'test', surface: 'unit' },
    operation: { domain: 'filesystem', action: 'delete', destructive: true, reversible: false },
    targets: [{ kind: 'path', raw: '~/.riskguard/policy.yml', canonical: 'C:\\Users\\x\\.riskguard\\policy.yml', scope: 'home', tags: ['riskguard'] }],
  }), defaultPolicy());
  assert.equal(d2.decision, 'deny');
  assert.equal(d2.ruleId, 'RG-GUARD-002');
});

test('RG-I03: 单调性 ALLOW + DENY = DENY', () => {
  assert.equal(combineDecisions(allow(), deny('X', 'x')).decision, 'deny');
  assert.equal(combineDecisions(deny('X', 'x'), allow()).decision, 'deny');
  assert.equal(combineDecisions(deny('X', 'x'), deny('Y', 'y')).decision, 'deny');
  assert.equal(combineDecisions(monotonicDeny('G', 'guard'), allow()).decision, 'deny');
  assert.equal(combineDecisions(allow(), monotonicDeny('G', 'guard')).decision, 'deny');
  assert.equal(combineDecisions(ask('A', 'a'), allow()).decision, 'ask');
  assert.equal(combineDecisions(allow(), allow()).decision, 'allow');
});

test('RG-I04: parse failure fail-closed → deny + degraded', () => {
  const d = parseFailureDecision('invalid json');
  assert.equal(d.decision, 'deny');
  assert.equal(d.degraded, true);
  assert.ok(d.ruleId.startsWith('RG-PARSE'));
});

test('RG-I04: failClosed 不返回 allow', () => {
  const d = failClosed('RG-FS-999', 'unknown mutation');
  assert.equal(d.decision, 'deny');
  assert.equal(d.degraded, true);
});

test('默认策略: 普通 workspace 写入放行（RG-UNKNOWN-001）', () => {
  const d = evaluate(fsEvent('write'), defaultPolicy());
  assert.equal(d.decision, 'allow');
});

test('默认策略: 磁盘格式化 deny（RG-DISK-001）', () => {
  const d = evaluate(fsEvent('delete', {
    operation: { domain: 'filesystem', action: 'delete', destructive: true, reversible: false },
    targets: [{ kind: 'path', raw: 'C:', canonical: 'C:', scope: 'system', tags: ['disk-format'] }],
  }), defaultPolicy());
  assert.equal(d.decision, 'deny');
});

test('默认策略: git 不可逆操作 deny（RG-GIT-001）', () => {
  const d = evaluate(createEvent({
    source: { agent: 'test', surface: 'unit' },
    operation: { domain: 'git', action: 'git_clean', destructive: true, reversible: false },
    targets: [{ kind: 'path', raw: '.', canonical: 'C:\\proj', scope: 'workspace' }],
  }), defaultPolicy());
  assert.equal(d.decision, 'deny');
  assert.equal(d.ruleId, 'RG-GIT-001');
});

test('默认策略: 凭据导出 deny（RG-CRED-001）', () => {
  const d = evaluate(createEvent({
    source: { agent: 'test', surface: 'unit' },
    operation: { domain: 'credentials', action: 'credential_export', destructive: true, reversible: false },
    targets: [],
  }), defaultPolicy());
  assert.equal(d.decision, 'deny');
  assert.equal(d.ruleId, 'RG-CRED-001');
});

test('Strict 策略: 删除能力从能力集移除（单调 deny）', () => {
  const d = evaluate(fsEvent('delete', {
    operation: { domain: 'filesystem', action: 'delete', destructive: true, reversible: false },
  }), strictPolicy());
  assert.equal(d.decision, 'deny');
  assert.equal(d.monotonic, true);
});

test('evaluateAll 多事件多策略组合', () => {
  const ev = createEvent({
    source: { agent: 'test', surface: 'unit' },
    operation: { domain: 'filesystem', action: 'delete', destructive: true, reversible: false },
    targets: [],
  });
  const d = evaluateAll([ev], [defaultPolicy()]);
  assert.equal(d.decision, 'deny');
});