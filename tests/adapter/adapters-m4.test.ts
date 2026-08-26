/**
 * adapters-m4.test.ts — M4 Plugin Family D2 payload tested
 *
 * opencode：'tool.before' payload 形状（{ tool, input: { command } }）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateOpencode, OPENCODE_PLUGIN_SKELETON } from '../../packages/adapters/opencode/src/index.ts';
import { defaultPolicy } from '../../packages/core/src/rules/default-policy.ts';
import { evaluate } from '../../packages/core/src/policy-engine.ts';
import type { RiskEvent } from '../../packages/core/src/event.ts';

const decide = (e: RiskEvent) => evaluate(e, defaultPolicy());

test('openCode: bash 删除命令 → { error } 阻止', () => {
  const out = evaluateOpencode(
    { tool: 'bash', input: { command: 'rm -rf /tmp/x' }, cwd: 'C:\\proj' },
    decide, 'C:\\Users\\x',
  );
  assert.ok(out?.error?.includes('RiskGuard'), out?.error);
});

test('openCode: 只读命令 → undefined 放行', () => {
  const out = evaluateOpencode(
    { tool: 'bash', input: { command: 'git status' }, cwd: 'C:\\proj' },
    decide,
  );
  assert.equal(out, undefined);
});

test('openCode: Delete 文件工具 → { error } 阻止并建议 trash', () => {
  const out = evaluateOpencode(
    { tool: 'delete_file', input: { filePath: 'C:\\proj\\f.ts' } },
    decide, 'C:\\Users\\x',
  );
  assert.ok(out?.error?.includes('RiskGuard'), '删除工具应被拒');
  assert.ok(out!.error!.includes('trash'), `应建议 trash：${out!.error}`);
});

test('openCode: 插件接线样板存在', () => {
  assert.ok(OPENCODE_PLUGIN_SKELETON.includes('tool.before'));
  assert.ok(OPENCODE_PLUGIN_SKELETON.includes('evaluateOpencode'));
});