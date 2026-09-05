/**
 * packages/acs/test/acs.test.ts — ACS Gateway 单元测试（v0.2.0 §三十九 核心子集）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAcsToolCall, acsGatewayInfo } from '../src/gateway.ts';
import { acsToolCallToRiskEvent } from '../src/tool-call-request.ts';
import { riskDecisionToAcsResult, buildAcsReasoning, failClosedAcsResult } from '../src/result.ts';
import { validateAcsToolCallRequest, parseAcsToolCallRequest } from '../src/inbound.ts';
import { validateAcsResult } from '../src/outbound.ts';
import { deny, ask, allow, type Decision } from '../../core/src/decision.ts';
import { ACS_VERSION, ACS_DECISIONS } from '../src/version.ts';
import { toRiskGuardCapability, capabilityToOperation, listCapabilities } from '../src/capability-map.ts';
import type { AcsToolCallRequest } from '../src/types.ts';

function req(partial: Partial<AcsToolCallRequest> & Pick<AcsToolCallRequest, 'capability'>): AcsToolCallRequest {
  return {
    tool: { name: 'shell', provider: 'test' },
    operation: 'execute',
    capability: partial.capability,
    ...partial,
  };
}

// ============================================================================
// 版本固定（§四）
// ============================================================================

test('ACS v0.1 显式固定', () => {
  assert.equal(ACS_VERSION, '0.1');
  assert.deepEqual(ACS_DECISIONS, ['allow', 'deny', 'modify', 'ask', 'defer']);
});

test('capability taxonomy 首版集合（§八）', () => {
  const caps = listCapabilities();
  assert.ok(caps.includes('filesystem.read'));
  assert.ok(caps.includes('filesystem.delete'));
  assert.ok(caps.includes('shell.execute'));
  assert.ok(caps.includes('git.destructive'));
  assert.ok(caps.includes('mcp.invoke'));
  // 11 个，不一次设计 100 个
  assert.equal(caps.length, 11);
});

test('ACS capability → RiskGuard capability 映射', () => {
  assert.equal(toRiskGuardCapability('filesystem.delete'), 'filesystem.delete');
  assert.equal(toRiskGuardCapability('scm.git.reset'), 'git.destructive');
  assert.equal(toRiskGuardCapability('mcp.invoke'), 'mcp.invoke');
  assert.equal(toRiskGuardCapability('does.not.exist'), null);
  // capability ≠ risk：filesystem.delete 的 risk 由 policy 判定，不在 taxonomy 层
  assert.equal(capabilityToOperation('filesystem.delete').action, 'delete');
});

// ============================================================================
// inbound（§十八：非法输入 fail-closed）
// ============================================================================

test('valid ToolCallRequest 通过校验', () => {
  const v = validateAcsToolCallRequest(req({ capability: 'process.execute', raw_command: 'git status' }));
  assert.equal(v.ok, true);
});

test('invalid request → fail closed（缺 tool / capability）', () => {
  assert.equal(validateAcsToolCallRequest(null).ok, false);
  assert.equal(validateAcsToolCallRequest({}).ok, false);
  assert.equal(validateAcsToolCallRequest({ tool: { name: 'x' } }).ok, false);
  assert.equal(parseAcsToolCallRequest('not json').ok, false);
  assert.equal(parseAcsToolCallRequest('').ok, false);
});

test('非法 ACS 输入 → gateway 输出 deny + degraded=true，不抛错', () => {
  const out = evaluateAcsToolCall('{bad json');
  assert.equal(out.degraded, true);
  assert.equal(out.result.decision, 'deny');
  assert.equal(out.result.extensions?.riskguard?.degraded, true);
  assert.ok(out.result.reasoning?.includes('Invalid ACS ToolCallRequest'));
});

// ============================================================================
// ToolCallRequest → RiskEvent（§六/§七）
// ============================================================================

test('ToolCallRequest → RiskEvent：tool/operation/raw_command/intent 映射', () => {
  const out = acsToolCallToRiskEvent(req({
    capability: 'shell.execute',
    intent: { description: 'run custom tool' },
  }));
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.event.source.surface, 'acs.tool_call');
  assert.equal(out.event.source.tool, 'shell');
  // shell.execute 无 raw_command → process.execute
  assert.equal(out.event.operation.domain, 'process');
  assert.equal(out.event.operation.action, 'execute');
  // intent → context.metadata（evidence 不参与决策）
  assert.equal((out.event.context?.metadata?.intent as { description?: string }).description, 'run custom tool');
});

test('只读命令（ls -la）→ filesystem.read（Profile B 放行）', () => {
  const out = acsToolCallToRiskEvent(req({ capability: 'shell.execute', raw_command: 'ls -la' }));
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.event.operation.domain, 'filesystem');
  assert.equal(out.event.operation.action, 'read');
  const gw = evaluateAcsToolCall(req({ capability: 'shell.execute', raw_command: 'ls -la' }));
  assert.equal(gw.result.decision, 'allow');
});

test('raw_command 细化：shell.execute + "rm -rf x" → filesystem.delete', () => {
  const out = acsToolCallToRiskEvent(req({
    capability: 'shell.execute',
    raw_command: 'rm -rf project',
  }));
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.event.operation.domain, 'filesystem');
  assert.equal(out.event.operation.action, 'delete');
  assert.equal(out.event.command?.raw, 'rm -rf project');
});

test('unknown capability → fail（fail-closed 方向）', () => {
  const out = acsToolCallToRiskEvent(req({ capability: 'magic.teleport' as never }));
  assert.equal(out.ok, false);
});

// ============================================================================
// gateway 决策（§十一/§十二）
// ============================================================================

test('filesystem delete → 内部 deny（RG-FS-001）→ ACS modify（§十二 安全替代提议）', () => {
  const out = evaluateAcsToolCall(req({
    capability: 'filesystem.delete',
    arguments: { path: 'C:\\work\\project' },
  }));
  // 底层 RiskGuard Decision 是 deny + RG-FS-001（携带 safeAlternative → 映射为 modify）
  assert.equal(out.result.extensions?.riskguard?.ruleId, 'RG-FS-001');
  assert.equal(out.result.decision, 'modify');
  assert.ok(out.result.reasoning?.includes('RG-FS-001'));
});

test('git reset --hard → deny（RG-GIT-001）', () => {
  const out = evaluateAcsToolCall(req({
    capability: 'shell.execute',
    raw_command: 'git reset --hard HEAD',
  }));
  assert.equal(out.result.decision, 'deny');
  assert.equal(out.result.extensions?.riskguard?.ruleId, 'RG-GIT-001');
  assert.ok(out.result.reason_codes?.includes('riskguard.git.deny'));
});

test('safe shell → allow', () => {
  const out = evaluateAcsToolCall(req({
    capability: 'shell.execute',
    raw_command: 'npm test',
  }));
  assert.equal(out.result.decision, 'allow');
});

test('safeAlternative → modify（§十二：Modification Proposal，不执行）', () => {
  const out = evaluateAcsToolCall(req({
    capability: 'filesystem.delete',
    arguments: { path: 'C:\\work\\project' },
  }));
  // RG-FS-001 携带 safeAlternative trash → modify
  assert.equal(out.result.decision, 'modify');
  assert.ok(Array.isArray(out.result.modifications) && out.result.modifications.length > 0);
  assert.equal(out.result.modifications![0]!.operation, 'trash');
  assert.ok(out.result.modifications![0]!.description?.includes('Not executed'));
});

test('ask mapping（§十三：非默认策略）', () => {
  const dec: Decision = ask('RG-PROC-001', '危险进程执行需确认');
  const result = riskDecisionToAcsResult(dec);
  assert.equal(result.decision, 'ask');
  assert.ok(result.ask_details?.prompt);
  assert.ok(result.reasoning);
});

test('defer 协议支持（§十四：类型 + 校验识别，默认映射不产生）', () => {
  assert.ok(ACS_DECISIONS.includes('defer'));
  const v = validateAcsResult({ decision: 'defer', reasoning: 'deferred for external policy' });
  assert.equal(v.ok, true);
  // 默认映射永不产生 defer
  const dec: Decision = deny('RG-FS-001', 'permanent delete');
  assert.notEqual(riskDecisionToAcsResult(dec).decision, 'defer');
});

// ============================================================================
// reasoning（§十五）
// ============================================================================

test('reasoning 始终可解释：含 rule ID + risk category + operation + reason', () => {
  const dec: Decision = deny('RG-GIT-001', 'git 不可逆丢失操作禁止', undefined, 'high');
  const r = buildAcsReasoning(dec, { operation: 'git.reset' });
  assert.ok(r.includes('RG-GIT-001'));
  assert.ok(r.includes('high-risk operation'));
  assert.ok(r.includes('git.reset'));
  assert.ok(r.includes('git 不可逆丢失操作禁止'));
  // 禁止无意义文本
  assert.ok(!/^blocked$|^dangerous$|^denied$/.test(r));
});

test('ACS output schema validation（outbound）', () => {
  // deny 必须有 reasoning
  assert.equal(validateAcsResult({ decision: 'deny' } as never).ok, false);
  // modify 必须有 modifications
  assert.equal(validateAcsResult({ decision: 'modify', reasoning: 'x' } as never).ok, false);
  // 合法 allow 通过
  assert.equal(validateAcsResult({ decision: 'allow' }).ok, true);
  // 非法 evaluator 拒绝
  assert.equal(validateAcsResult({ decision: 'allow', metadata: { evaluator: 'ai' as never } }).ok, false);
});

test('failClosedAcsResult：deny + degraded（§十八）', () => {
  const r = failClosedAcsResult('Invalid ACS ToolCallRequest');
  assert.equal(r.decision, 'deny');
  assert.equal(r.extensions?.riskguard?.degraded, true);
  assert.equal(r.extensions?.riskguard?.acsVersion, '0.1');
});

test('gateway 信息：版本/profile/decisions', () => {
  const info = acsGatewayInfo();
  assert.equal(info.acsVersion, '0.1');
  assert.equal(info.profile, 'experimental-0.1');
  assert.deepEqual(info.decisions, ['allow', 'deny', 'modify', 'ask', 'defer']);
});
