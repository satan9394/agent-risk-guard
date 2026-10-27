/**
 * mcode-adapter.test.ts — MiniMax Code (mcode 0.7.0) PreToolUse Adapter 单测
 *
 * 依据（2026-10-27 本机 mcode 0.7.0 实测 + 反编译核对）：
 *   - 插件落点 ~/.minimax/plugins/<name>/{.claude-plugin/plugin.json,hooks/hooks.json}
 *   - stdin JSON 与 Claude Code 同形状；工具名双形态：
 *       映射成功 = Bash / PowerShell(win32) / Read / Write / Edit / Agent
 *       映射校验失败 = 内部名 bash / read / write / edit / task
 *   - 输出 hookSpecificOutput.permissionDecision（deny/ask/allow），exit 0
 *
 * 这里钉住 4 条会导致 fail-open 或漏拦的关键断言：
 *   ① 内部名 bash 与映射名 PowerShell 得到同样的风险归类
 *   ② shell 工具取不到非空 command → fail-closed（不是「当写入放行」）
 *   ③ 非 deny 一律输出 {}（不把内部 ask 直译成平台审批，跨端行为一致）
 *   ④ matcher 必须覆盖 bash（内部名），否则该调用根本不进 hook
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMcodePayload,
  renderMcodeDecision,
  evaluateMcode,
  MCODE_HOOK_MATCHER,
  MCODE_HOOK_ID,
} from '../../packages/adapters/mcode/src/index.ts';
import type { Decision } from '../../packages/core/src/decision.ts';

const denyDelete: Decision = { decision: 'deny', reason: 'permanent deletion is blocked, use the trash instead' };

test('shell 双形态：PowerShell（映射名）与 bash（内部名）同样识别为破坏性删除', () => {
  const mapped = parseMcodePayload({
    hook_event_name: 'PreToolUse',
    tool_name: 'PowerShell',
    tool_input: { command: 'Remove-Item C:\\proj\\x -Recurse -Force' },
    cwd: 'C:\\proj',
  });
  const internal = parseMcodePayload({
    hook_event_name: 'PreToolUse',
    tool_name: 'bash',
    tool_input: { command: 'Remove-Item C:\\proj\\x -Recurse -Force' },
    cwd: 'C:\\proj',
  });
  assert.equal(mapped.ok, true);
  assert.equal(internal.ok, true);
  if (!mapped.ok || !internal.ok) return;
  assert.equal(mapped.event.operation.destructive, true);
  assert.equal(internal.event.operation.destructive, true);
  assert.equal(mapped.event.command?.raw, internal.event.command?.raw);
});

test('shell 工具 command 缺失/空白 → fail-closed（不得当写入放行）', () => {
  for (const tool_input of [{}, { command: '' }, { command: '   ' }, { command: 42 }]) {
    const out = parseMcodePayload({ tool_name: 'bash', tool_input: tool_input as never, cwd: 'C:\\proj' });
    assert.equal(out.ok, false, `expected fail-closed for ${JSON.stringify(tool_input)}`);
  }
  // 端到端：解析失败渲染成 deny，而不是 {}
  const rendered = JSON.parse(evaluateMcode({ tool_name: 'bash', tool_input: {} }, () => ({ decision: 'allow' }))) as {
    hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
  };
  assert.equal(rendered.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(rendered.hookSpecificOutput.permissionDecisionReason, /fail-closed/);
});

test('只读命令归类为非破坏性（不误伤 Get-ChildItem / git status / Get-Content）', () => {
  for (const command of ['Get-ChildItem C:\\proj', 'git status', 'Get-Content README.md']) {
    const out = parseMcodePayload({ tool_name: 'PowerShell', tool_input: { command }, cwd: 'C:\\proj' });
    assert.equal(out.ok, true, command);
    if (!out.ok) continue;
    // 适配层只做形状转换：read-only 判定由 core 策略负责，这里钉住「不被打上 destructive」
    assert.equal(out.event.operation.destructive, false, command);
    assert.notEqual(out.event.operation.action, 'delete', command);
  }
  // git status 走 core 的 read-only 家族（域=filsystem/动作=read），作为分类参照
  const gitStatus = parseMcodePayload({ tool_name: 'PowerShell', tool_input: { command: 'git status' } });
  assert.equal(gitStatus.ok && gitStatus.event.operation.action, 'read');
});

test('文件工具：内部名 path 与 Claude 形状 file_path 都能取到目标', () => {
  const internal = parseMcodePayload({ tool_name: 'write', tool_input: { path: 'C:\\proj\\a.txt', content: 'x' } });
  const compatible = parseMcodePayload({ tool_name: 'Write', tool_input: { file_path: 'C:\\proj\\a.txt', content: 'x' } });
  assert.equal(internal.ok, true);
  assert.equal(compatible.ok, true);
  if (!internal.ok || !compatible.ok) return;
  assert.deepEqual((internal.event.targets ?? []).map((t) => t.raw), ['C:\\proj\\a.txt']);
  assert.deepEqual((compatible.event.targets ?? []).map((t) => t.raw), ['C:\\proj\\a.txt']);
  assert.equal(internal.event.operation.action, 'write');
});

test('edit / task 归类', () => {
  const edit = parseMcodePayload({ tool_name: 'edit', tool_input: { path: 'C:\\proj\\a.ts' } });
  const task = parseMcodePayload({ tool_name: 'task', tool_input: { description: 'x', prompt: 'y' } });
  assert.equal(edit.ok && edit.event.operation.action, 'edit');
  assert.equal(task.ok && task.event.operation.domain, 'process');
  assert.equal(task.ok && task.event.operation.action, 'execute');
});

test('未知工具（MCP）→ 保守 filesystem.write（fail-closed 方向）', () => {
  const out = parseMcodePayload({ tool_name: 'mcp_invoke', tool_input: { tool_name: 'fs.write' } });
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.event.operation.domain, 'filesystem');
  assert.equal(out.event.operation.action, 'write');
});

test('render：deny 输出 Claude 兼容形状 + systemMessage；非 deny 输出 {}', () => {
  const deny = JSON.parse(renderMcodeDecision({ ...denyDelete, safeAlternative: { operation: 'trash' } } as Decision)) as {
    hookSpecificOutput: { hookEventName: string; permissionDecision: string; permissionDecisionReason: string };
    systemMessage: string;
  };
  assert.equal(deny.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(deny.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(deny.hookSpecificOutput.permissionDecisionReason, /trash/);
  assert.match(deny.systemMessage, /^RiskGuard: /);
  assert.match(deny.systemMessage, /trash/);

  for (const decision of [{ decision: 'allow' }, { decision: 'ask' }] as Decision[]) {
    assert.equal(renderMcodeDecision(decision), '{}');
  }
});

test('evaluateMcode：deny 决策透传 reason', () => {
  const out = JSON.parse(evaluateMcode(
    { tool_name: 'PowerShell', tool_input: { command: 'Remove-Item x -Force' } },
    () => denyDelete,
  )) as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } };
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /trash/);
});

test('接线常量：matcher 必须覆盖内部名 bash（大小写敏感正则）', () => {
  const re = new RegExp(`^(?:${MCODE_HOOK_MATCHER})$`);
  for (const name of ['Bash', 'PowerShell', 'bash']) assert.ok(re.test(name), name);
  assert.equal(MCODE_HOOK_ID, 'riskguard-mcode-hook');
});
