/**
 * copilot-adapter.test.ts — GitHub Copilot CLI preToolUse Adapter（v0.3.0 §二十六~§二十九，D2 payload 单测）
 *
 * 官方机制 2026-09 核查（docs.github.com/copilot/reference/hooks-reference）：
 *   - 配置 { version:1, hooks: { preToolUse: [ { type:"command", exec|bash|powershell|command, cwd, env, timeoutSec } ] } }
 *   - 加载顺序 policy → user → project → plugins
 *   - Policy（machine-wide）：C:\ProgramData\GitHub\Copilot\policy.d\*.json + HKLM\...\Copilot（每 subkey 一个 Policy REG_SZ）
 *   - 阻断输出：hookSpecificOutput.permissionDecision=deny 或顶层 permissionDecision 或 exit 2
 * 诚实定位：adapter D1/D2；真实 D3 待本机安装 Copilot CLI（当前 SKIP）；issue #3874 显示 deny 有版本回归。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateCopilot,
  copilotPolicyHookConfig,
  copilotUserHookConfig,
  COPILOT_POLICY_DIR_WINDOWS,
  COPILOT_POLICY_REGISTRY_KEY,
  COPILOT_POLICY_DIR_POSIX,
  COPILOT_USER_HOOKS_DIR_WINDOWS,
} from '../../packages/adapters/copilot/src/index.ts';
import { defaultPolicy } from '../../packages/core/src/rules/default-policy.ts';
import { evaluate } from '../../packages/core/src/policy-engine.ts';
import type { RiskEvent } from '../../packages/core/src/event.ts';

const decide = (e: RiskEvent) => evaluate(e, defaultPolicy());

test('Copilot preToolUse: Bash rm → deny（hookSpecificOutput + exit 2）', () => {
  const out = evaluateCopilot({ tool_name: 'Bash', tool_input: { command: 'rm -rf /tmp/x' }, cwd: 'C:\\proj' }, decide, 'C:\\Users\\x');
  assert.equal(out.exitCode, 2);
  const parsed = JSON.parse(out.output) as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } };
  assert.equal(parsed.hookSpecificOutput.permissionDecision, 'deny');
  assert.ok(parsed.hookSpecificOutput.permissionDecisionReason.includes('RiskGuard'));
});

test('Copilot preToolUse: 只读命令 → allow（exit 0，{}）', () => {
  const out = evaluateCopilot({ tool_name: 'Bash', tool_input: { command: 'git status' } }, decide);
  assert.equal(out.exitCode, 0);
  assert.equal(out.output, '{}');
});

test('Copilot preToolUse: Delete 工具 → deny', () => {
  const out = evaluateCopilot({ tool_name: 'Delete', tool_input: { file_path: 'C:\\proj\\important.txt' } }, decide, 'C:\\Users\\x');
  assert.equal(out.exitCode, 2);
  assert.ok(out.output.includes('deny'));
});

test('Copilot preToolUse: payload 解析失败 → fail-closed deny（exit 2）', () => {
  // 空 tool（无法可靠分类）→ fail-closed
  assert.equal(evaluateCopilot({ tool_name: '', tool_input: {} }, decide).exitCode, 2);
  // 非对象 → fail-closed（RG-I04）
  assert.equal(evaluateCopilot(null as never, decide).exitCode, 2);
  // shell 工具空 command → fail-closed
  assert.equal(evaluateCopilot({ tool_name: 'Bash', tool_input: { command: '' } }, decide).exitCode, 2);
});

test('§二十八：machine policy / user hook 配置模板 + 官方路径常量', () => {
  assert.equal(COPILOT_POLICY_DIR_WINDOWS, 'C:\\ProgramData\\GitHub\\Copilot\\policy.d');
  assert.equal(COPILOT_POLICY_REGISTRY_KEY, 'HKLM\\Software\\Policies\\GitHub\\Copilot');
  assert.equal(COPILOT_POLICY_DIR_POSIX, '/etc/github-copilot/policy.d');
  assert.equal(COPILOT_USER_HOOKS_DIR_WINDOWS, '%USERPROFILE%\\.copilot\\hooks');

  const policy = JSON.parse(copilotPolicyHookConfig('riskguard')) as { version: number; hooks: { preToolUse: Array<{ type: string; exec: string }> } };
  assert.equal(policy.version, 1);
  assert.equal(policy.hooks.preToolUse[0].type, 'command');
  assert.equal(policy.hooks.preToolUse[0].exec, 'riskguard');

  const user = JSON.parse(copilotUserHookConfig('riskguard')) as { version: number };
  assert.equal(user.version, 1);
});
