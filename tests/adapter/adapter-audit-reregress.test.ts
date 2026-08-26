/**
 * adapter-audit-reregress.test.ts — adapter 层 GAN 审查修复复测
 * 覆盖：P0-29/27/24/31 + P1-33/34/35/30
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyShellCommand, normalizeFullWidth, extractTargetsFromCommand } from '../../packages/core/src/normalize.ts';
import { defaultPolicy } from '../../packages/core/src/rules/default-policy.ts';
import { evaluate } from '../../packages/core/src/policy-engine.ts';
import { parseClaudePayload } from '../../packages/adapters/claude/src/index.ts';
import { parseDshPayload } from '../../packages/adapters/dsh/src/index.ts';
import { parseGrokPayload } from '../../packages/adapters/grok/src/index.ts';
import { parseWindsurfPayload } from '../../packages/adapters/windsurf/src/index.ts';
import { parseCursorPayload } from '../../packages/adapters/cursor/src/index.ts';

test('P0-29: Claude tool_name 小写 bash 识别为 shell 并拦删除', () => {
  const out = parseClaudePayload({ tool_name: 'bash', tool_input: { command: 'rm -rf /tmp/x' } });
  assert.equal(out.ok, true);
  if (out.ok) {
    assert.equal(out.event.operation.domain, 'filesystem');
    assert.equal(out.event.operation.action, 'delete');
    const d = evaluate(out.event, defaultPolicy());
    assert.equal(d.decision, 'deny');
  }
});

test('P1-30: Claude 空 command fail-closed', () => {
  const out = parseClaudePayload({ tool_name: 'Bash', tool_input: { command: '' } });
  assert.equal(out.ok, false);
});

test('P0-27: 全角字符 rm 被识别为删除', () => {
  const cls = classifyShellCommand('ｒｍ　－ｒｆ　／tmp');
  assert.ok(cls, '全角 rm 应被分类');
  assert.equal(cls!.action, 'delete');
  assert.equal(normalizeFullWidth('ｒｍ　－ｒｆ'), 'rm -rf');
});

test('P0-24: DSH 非字符串 command fail-closed', () => {
  const out = parseDshPayload({ name: 'bash', arguments: { command: { malicious: 'rm -rf /' } } });
  assert.equal(out.ok, false);
});

test('P0-31: Cursor 未知工具 → unknown action → policy deny', () => {
  const out = parseCursorPayload({ tool_name: 'UnknownTool', tool_input: {} });
  assert.equal(out.ok, true);
  if (out.ok) {
    const d = evaluate(out.event, defaultPolicy());
    assert.equal(d.decision, 'deny', `未知工具应 deny，got ${d.decision} [${d.ruleId}]`);
  }
});

test('P1-33: Grok 空 payload（无 toolName）fail-closed', () => {
  const out = parseGrokPayload({});
  assert.equal(out.ok, false);
});

test('P1-34: Windsurf pre_read_code → read（非 write）', () => {
  const out = parseWindsurfPayload({ hookEventName: 'pre_read_code', file_path: '/etc/passwd' });
  assert.equal(out.ok, true);
  if (out.ok) assert.equal(out.event.operation.action, 'read');
});

test('P1-35: Windsurf 空 command fail-closed', () => {
  const out = parseWindsurfPayload({ hookEventName: 'pre_run_command', command: '' });
  assert.equal(out.ok, false);
});

test('P2-32: rm -rf 不把 flags 提取为目标', () => {
  const t = extractTargetsFromCommand('rm -rf /tmp/x');
  if (t.some((x) => x.raw.startsWith('-'))) {
    assert.fail('flags 不应被提取为目标');
  }
  assert.ok(t.some((x) => x.raw.includes('/tmp/x')), '真实路径应被提取');
});