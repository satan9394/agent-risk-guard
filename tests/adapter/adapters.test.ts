/**
 * adapters.test.ts — M3 各家 Adapter D2 payload tested
 *
 * 用真实 vendor payload 形状（claw-hooks / agento11y / context-mode 实测确认）：
 *  - Claude Code:  { tool_name, tool_input: { command } }
 *  - Cursor:       { tool_name, tool_input: { command }, cwd, workspace_roots }
 *  - Grok:         { hook_event_name, tool_name, tool_input: { command } }（snake_case 兼容）
 *  - Windsurf:     { hookEventName: 'pre_run_command', command, cwd }
 *  - DSH:          { name: 'bash', arguments: { command } }（D2 实证）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateClaude } from '../../packages/adapters/claude/src/index.ts';
import { evaluateCursor } from '../../packages/adapters/cursor/src/index.ts';
import { evaluateGrok, grokExitCode } from '../../packages/adapters/grok/src/index.ts';
import { evaluateWindsurf } from '../../packages/adapters/windsurf/src/index.ts';
import { evaluateDsh, guardAdvisory } from '../../packages/adapters/dsh/src/index.ts';
import { defaultPolicy } from '../../packages/core/src/rules/default-policy.ts';
import { evaluate } from '../../packages/core/src/policy-engine.ts';

const decide = (e: any) => evaluate(e, defaultPolicy());

test('Claude payload: Bash rm → deny + permissionDecision', () => {
  const payload = {
    tool_name: 'Bash',
    tool_input: { command: 'rm -rf /tmp/test' },
    cwd: 'C:\\proj',
  };
  const out = JSON.parse(evaluateClaude(payload, decide));
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
});

test('Claude payload: 普通命令 → {}（放行）', () => {
  const payload = { tool_name: 'Bash', tool_input: { command: 'git status' } };
  const out = evaluateClaude(payload, decide);
  assert.equal(out, '{}');
});

test('Claude payload: Write 工具（非 shell）→ 归 filesystem.write', () => {
  const payload = { tool_name: 'Write', tool_input: { file_path: 'C:\\proj\\a.txt' }, cwd: 'C:\\proj' };
  const out = JSON.parse(evaluateClaude(payload, decide));
  assert.equal(out.hookSpecificOutput?.permissionDecision ?? '{}', '{}');
});

test('Cursor payload: Delete Tool（独立删除工具，无 shell）→ deny', () => {
  const payload = {
    tool_name: 'Delete', tool_input: { file_path: 'C:\\proj\\important' },
    cwd: 'C:\\proj', workspace_roots: ['C:\\proj'],
  };
  const out = JSON.parse(evaluateCursor(payload, decide));
  assert.equal(out.permission, 'deny');
  assert.ok(out.user_message);
});

test('Cursor payload: beforeShellExecution 形状（command 直传）', () => {
  // claw-hooks 映射：beforeShellExecution 的 command 字段
  const payload = { tool_name: 'Shell', tool_input: { command: 'Remove-Item C:\\x -Force' }, cwd: 'C:\\proj' };
  const out = JSON.parse(evaluateCursor(payload, decide));
  assert.equal(out.permission, 'deny');
});

test('Grok payload: snake_case + rm 家族 → deny（exit 2）', () => {
  const payload = {
    hook_event_name: 'PreToolUse', tool_name: 'Bash',
    tool_input: { command: 'shutil.rmtree("C:\\proj\\build")' },
  };
  const out = evaluateGrok(payload, decide);
  assert.equal(JSON.parse(out).decision, 'deny');
  assert.equal(grokExitCode(out), 2);
});

test('Grok payload: camelCase + 白名单 → allow（exit 0）', () => {
  const payload = { hookEventName: 'PreToolUse', toolName: 'Bash', toolInput: { command: 'ls' } };
  const out = evaluateGrok(payload, decide);
  assert.equal(out, '{}');
  assert.equal(grokExitCode(out), 0);
});

test('Windsurf pre_run_command: 删除命令 → exit 2 + stderr', () => {
  const payload = { hookEventName: 'pre_run_command', command: 'rm -rf /tmp/x', cwd: 'C:\\proj' };
  const out = evaluateWindsurf(payload, decide);
  assert.equal(out.exitCode, 2);
  assert.ok(out.stderr.includes('RiskGuard'));
});

test('Windsurf pre_write_code: 写文件 → exit 0（放行）', () => {
  const payload = { hookEventName: 'pre_write_code', file_path: 'C:\\proj\\a.txt' };
  const out = evaluateWindsurf(payload, decide);
  assert.equal(out.exitCode, 0);
});

test('Windsurf pre_mcp_tool_use: → exit 0 或 ask 处理', () => {
  const payload = { hookEventName: 'pre_mcp_tool_use', mcp: { server: 'github', tool: 'create_issue' } };
  const out = evaluateWindsurf(payload, decide);
  assert.ok(out.exitCode === 0 || out.exitCode === 2);
});

test('DSH payload: exec 结构（{name, arguments}，D2 实证形状）+ 删除命令 → deny', () => {
  const payload = {
    name: 'bash',
    arguments: { command: 'rm -rf C:\\proj\\build', cwd: 'C:\\proj' },
    agent: 'main',
  };
  const d = evaluateDsh(payload, decide);
  assert.equal(d.decision, 'deny');
  assert.equal(d.ruleId, 'RG-FS-001');
  // RG-FS-001 是 monotonic → 建议走 guard
  assert.equal(d.viaGuard, true);
});

test('DSH payload: 无命令的 bash 调用 → 归 process.execute（policy ask）', () => {
  const d = evaluateDsh({ name: 'bash', arguments: {} }, decide);
  assert.equal(d.decision, 'ask'); // RG-PROC-001：危险进程执行需确认
  assert.equal(d.ruleId, 'RG-PROC-001');
});

test('DSH guardAdvisory: D2 实证签名存在', () => {
  const a = guardAdvisory();
  assert.equal(a.target, 'ctx.tools.guard()');
  assert.ok(a.usage.includes('单调'));
  assert.ok(a.usage.includes('force-allow'));
});