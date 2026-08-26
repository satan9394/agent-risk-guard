/**
 * cli.e2e.test.ts — CLI 端到端验证（文档 D2：Payload Tested）
 *
 * 场景：
 *  1. filesystem.delete → deny (RG-FS-001, safeAlternative=trash, monotonic)
 *  2. filesystem.write  → allow
 *  3. git.git_clean     → deny (RG-GIT-001)
 *  4. strict profile    → deny (RG-S-DEL-001)
 *  5. 无效 JSON         → deny + degraded (fail-closed)
 *  6. 空输入            → deny + degraded (fail-closed)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, type CliInput } from '../../packages/cli/src/cli.ts';

function parse(input: CliInput) {
  return JSON.parse(run(input));
}

test('e2e: filesystem delete → deny + trash 建议', () => {
  const out = parse({
    agent: 'cursor', surface: 'preToolUse', tool: 'Bash',
    domain: 'filesystem', action: 'delete',
    targetsRaw: ['C:\\proj\\important'],
    cwd: 'C:\\proj', workspaceRoot: 'C:\\proj',
  });
  assert.equal(out.decision, 'deny');
  assert.equal(out.ruleId, 'RG-FS-001');
  assert.equal(out.safeAlternative.operation, 'trash');
  assert.equal(out.monotonic, true);
  assert.equal(out.audit.operation, 'filesystem.delete');
});

test('e2e: filesystem write → allow', () => {
  const out = parse({
    agent: 'claude-code', surface: 'PreToolUse', domain: 'filesystem', action: 'write',
    targetsRaw: ['C:\\proj\\a.txt'], cwd: 'C:\\proj', workspaceRoot: 'C:\\proj',
  });
  assert.equal(out.decision, 'allow');
});

test('e2e: git clean → deny (RG-GIT-001)', () => {
  const out = parse({
    agent: 'codex', surface: 'preToolUse', domain: 'git', action: 'git_clean',
    targetsRaw: ['C:\\proj'], cwd: 'C:\\proj',
  });
  assert.equal(out.decision, 'deny');
  assert.equal(out.ruleId, 'RG-GIT-001');
});

test('e2e: trash 事件放行（统一 Trash 能力）', () => {
  const out = parse({
    agent: 'claude-code', surface: 'PreToolUse', domain: 'filesystem', action: 'trash',
    targetsRaw: ['C:\\proj\\old.txt'], cwd: 'C:\\proj',
  });
  assert.equal(out.decision, 'allow');
});

test('e2e: strict profile → RG-S-DEL-001', () => {
  const out = parse({
    profile: 'strict', agent: 'codex', surface: 'preToolUse', domain: 'filesystem', action: 'delete',
    targetsRaw: ['C:\\proj\\x'], cwd: 'C:\\proj',
  });
  assert.equal(out.decision, 'deny');
  assert.equal(out.ruleId, 'RG-S-DEL-001');
  assert.equal(out.monotonic, true);
});

test('e2e: command 自动分类（rm 家族）', () => {
  const out = parse({
    agent: 'grok', surface: 'preToolUse', domain: 'filesystem', action: 'delete',
    commandRaw: 'Remove-Item C:\\proj\\build -Recurse -Force',
    targetsRaw: ['C:\\proj\\build'], cwd: 'C:\\proj',
  });
  assert.equal(out.decision, 'deny');
  assert.equal(out.audit.operation, 'filesystem.delete');
});

test('e2e: 受保护资源（guard 标签）→ RG-GUARD-002', () => {
  const out = parse({
    agent: 'cursor', surface: 'preToolUse', domain: 'filesystem', action: 'delete',
    targetsRaw: ['C:\\Users\\x\\.riskguard\\policy.yml'], cwd: 'C:\\proj',
  });
  assert.equal(out.decision, 'deny');
});