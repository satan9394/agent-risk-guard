/**
 * packages/acs/test/acs.test.ts — ACS Gateway 单元测试（v0.2.0 §三十九 核心子集，v0.2.1 对齐官方）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAcsToolCall, evaluateAcsEnvelope, acsGatewayInfo } from '../src/gateway.ts';
import { acsToolCallToRiskEvent } from '../src/tool-call-request.ts';
import { riskDecisionToAcsResult, buildAcsReasoning, failClosedAcsResult, newAcsRequestId } from '../src/result.ts';
import { validateAcsToolCallRequest, parseAcsToolCallRequest } from '../src/inbound.ts';
import { validateAcsRequestEnvelope } from '../src/envelope.ts';
import { validateAcsResult } from '../src/outbound.ts';
import { unwrapAcsArguments } from '../src/arguments.ts';
import { deny, ask, allow, type Decision } from '../../core/src/decision.ts';
import { ACS_VERSION, ACS_SPEC_VERSION, ACS_DECISIONS } from '../src/version.ts';
import { toRiskGuardCapability, capabilityToOperation, listCapabilities, deriveAcsCapability } from '../src/capability-map.ts';
import type { AcsToolCallRequest } from '../src/types.ts';

function req(partial: Partial<AcsToolCallRequest> & Pick<AcsToolCallRequest, 'capability'>): AcsToolCallRequest {
  return {
    tool: { name: 'shell', provider: 'test' },
    operation: 'execute',
    capability: partial.capability,
    arguments: {},
    ...partial,
  };
}

// ============================================================================
// 版本固定（§三/§四）
// ============================================================================

test('ACS v0.1.0 显式固定（完整 SemVer，§三）', () => {
  assert.equal(ACS_VERSION, '0.1.0');
  assert.equal(ACS_SPEC_VERSION, '0.1.0');
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

test('§三十一：capability 推导（tool/raw_command → git.destructive）', () => {
  assert.equal(deriveAcsCapability({ toolName: 'shell', rawCommand: 'git reset --hard HEAD' }), 'git.destructive');
  assert.equal(deriveAcsCapability({ toolName: 'filesystem', operation: 'delete' }), 'filesystem.delete');
  assert.equal(deriveAcsCapability({ toolName: 'mcp__fetch' }), 'mcp.invoke');
  assert.equal(deriveAcsCapability({ toolName: 'mystery' }), null);
});

// ============================================================================
// inbound（§十八：非法输入 fail-closed；§四：arguments 必填、capability 可选）
// ============================================================================

test('valid ToolCallRequest 通过校验', () => {
  const v = validateAcsToolCallRequest(req({ capability: 'process.execute', raw_command: 'git status' }));
  assert.equal(v.ok, true);
});

test('§四：capability 可选、arguments 必填', () => {
  // capability 缺失仍通过
  const noCap = validateAcsToolCallRequest({ tool: { name: 'shell' }, arguments: { command: { value: 'ls' } } });
  assert.equal(noCap.ok, true);
  // arguments 缺失 → fail（官方 required）
  assert.equal(validateAcsToolCallRequest({ tool: { name: 'x' } }).ok, false);
});

test('invalid request → fail closed（缺 tool / arguments / 非法 JSON）', () => {
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

test('raw_command 细化：shell.execute + "rm -rf project" → filesystem.delete', () => {
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

test('§三十二：显式未知 capability → fail（fail-closed，不静默 reinterpret）', () => {
  const out = acsToolCallToRiskEvent(req({ capability: 'magic.teleport' as never }));
  assert.equal(out.ok, false);
});

test('§三十二：capability 缺失 + 推导不确定 → fail（fail-closed）', () => {
  const out = acsToolCallToRiskEvent({
    tool: { name: 'mystery-tool' },
    operation: 'blah',
    arguments: { x: { value: 1 } },
  });
  assert.equal(out.ok, false);
});

test('§三十三：arguments value-wrapper 正确解析（不把 wrapper 当字符串）', () => {
  const out = acsToolCallToRiskEvent(req({
    capability: 'filesystem.delete',
    arguments: { path: { value: 'C:\\work\\project' }, mode: { value: 'permanent' } },
  }));
  assert.equal(out.ok, true);
  if (!out.ok) return;
  const targets = out.event.targets.map((t) => t.raw);
  assert.ok(targets.includes('C:\\work\\project'));
});

// ============================================================================
// gateway 决策（§十一/§十二/§二十）
// ============================================================================

test('§二十：filesystem delete（仅 path，无法安全表达改写）→ deny RG-FS-001（不伪造 modify）', () => {
  const out = evaluateAcsToolCall(req({
    capability: 'filesystem.delete',
    arguments: { path: { value: 'C:\\work\\project' } },
  }));
  assert.equal(out.result.decision, 'deny');
  assert.equal(out.result.extensions?.riskguard?.ruleId, 'RG-FS-001');
  assert.ok(out.result.reasoning?.includes('RG-FS-001'));
  assert.ok(out.result.reasoning?.includes('Safe replacement is available conceptually'));
});

test('§十九：filesystem delete（带 mode=permanent）→ modify（官方 parameter_overrides）', () => {
  const out = evaluateAcsToolCall(req({
    capability: 'filesystem.delete',
    arguments: { path: { value: 'C:\\work\\project' }, mode: { value: 'permanent' } },
  }));
  assert.equal(out.result.decision, 'modify');
  assert.equal(out.result.extensions?.riskguard?.ruleId, 'RG-FS-001');
  const mods = out.result.modifications as { parameter_overrides?: Record<string, unknown> };
  assert.ok(mods.parameter_overrides && mods.parameter_overrides['mode'] !== undefined);
  // 官方必填字段
  assert.equal(out.result.type, 'final');
  assert.equal(out.result.acs_version, '0.1.0');
  assert.match(out.result.request_id, /^[0-9a-f-]{36}$/i);
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

test('ask mapping（§十三/§二十二：官方 ask_details）', () => {
  const dec: Decision = ask('RG-PROC-001', '危险进程执行需确认');
  const result = riskDecisionToAcsResult(dec);
  assert.equal(result.decision, 'ask');
  assert.equal(result.ask_details?.question, '危险进程执行需确认');
  assert.equal(result.ask_details?.approver.type, 'human');
  assert.ok(typeof result.ask_details?.timeout_seconds === 'number' && result.ask_details.timeout_seconds >= 1);
  assert.ok(result.reasoning);
});

test('defer 协议支持（§十四/§二十三：类型 + 校验识别，默认映射不产生）', () => {
  assert.ok(ACS_DECISIONS.includes('defer'));
  const v = validateAcsResult({
    type: 'final',
    acs_version: '0.1.0',
    request_id: newAcsRequestId(),
    decision: 'defer',
    reasoning: 'deferred for external policy',
    defer_details: { reason: 'insufficient_context', resolution_method: 'additional_context', resolution_timeout_ms: 30000 },
  });
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

test('ACS output schema validation（outbound，§十六 官方必填）', () => {
  // 缺 type/acs_version/request_id → fail
  assert.equal(validateAcsResult({ decision: 'allow' } as never).ok, false);
  assert.equal(validateAcsResult({ type: 'final', acs_version: '0.1.0', request_id: newAcsRequestId(), decision: 'allow' }).ok, true);
  // deny 必须有 reasoning
  assert.equal(validateAcsResult({ type: 'final', acs_version: '0.1.0', request_id: newAcsRequestId(), decision: 'deny' } as never).ok, false);
  // modify 必须有官方 modifications
  assert.equal(validateAcsResult({ type: 'final', acs_version: '0.1.0', request_id: newAcsRequestId(), decision: 'modify', reasoning: 'x' } as never).ok, false);
  // acs_version 必须完整 SemVer（§十六：0.1 → FAIL）
  assert.equal(validateAcsResult({ type: 'final', acs_version: '0.1', request_id: newAcsRequestId(), decision: 'allow' } as never).ok, false);
  // 非法 evaluator 拒绝
  assert.equal(validateAcsResult({ type: 'final', acs_version: '0.1.0', request_id: newAcsRequestId(), decision: 'allow', metadata: { evaluator: 'ai' as never } }).ok, false);
});

test('failClosedAcsResult：deny + degraded（§十八）', () => {
  const r = failClosedAcsResult('Invalid ACS ToolCallRequest');
  assert.equal(r.decision, 'deny');
  assert.equal(r.type, 'final');
  assert.equal(r.acs_version, '0.1.0');
  assert.match(r.request_id, /^[0-9a-f-]{36}$/i);
  assert.equal(r.extensions?.riskguard?.degraded, true);
  assert.equal(r.extensions?.riskguard?.acsVersion, '0.1.0');
});

test('gateway 信息：版本/profile/decisions（§三：0.1.0 与 experimental-0.1 分离）', () => {
  const info = acsGatewayInfo();
  assert.equal(info.acsVersion, '0.1.0');
  assert.equal(info.profile, 'experimental-0.1');
  assert.deepEqual(info.decisions, ['allow', 'deny', 'modify', 'ask', 'defer']);
});

// ============================================================================
// envelope（§七/§十/§十二/§三十七/§三十八/§四十一）
// ============================================================================

const VALID_ENVELOPE = {
  jsonrpc: '2.0',
  method: 'steps/toolCallRequest',
  id: 42,
  params: {
    acs_version: '0.1.0',
    request_id: '11111111-2222-4333-8444-555555555555',
    timestamp: '2026-08-21T10:00:00.000Z',
    metadata: { agent_id: 'test-agent', session_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' },
    payload: { tool: { name: 'shell' }, arguments: { command: { value: 'npm test' } }, raw_command: 'npm test' },
  },
};

test('§十：Request Envelope 必填字段校验', () => {
  assert.equal(validateAcsRequestEnvelope(VALID_ENVELOPE).ok, true);
  assert.equal(validateAcsRequestEnvelope({ ...VALID_ENVELOPE, jsonrpc: '1.0' }).ok, false);
  assert.equal(validateAcsRequestEnvelope({ ...VALID_ENVELOPE, method: 'custom/method' }).ok, false);
  assert.equal(validateAcsRequestEnvelope({ ...VALID_ENVELOPE, params: { ...VALID_ENVELOPE.params, acs_version: '0.1' } }).ok, false);
  assert.equal(validateAcsRequestEnvelope({ ...VALID_ENVELOPE, params: { ...VALID_ENVELOPE.params, request_id: 'test-1' } }).ok, false);
  assert.equal(validateAcsRequestEnvelope({ ...VALID_ENVELOPE, params: { ...VALID_ENVELOPE.params, metadata: { agent_id: 'x' } } }).ok, false);
});

test('§四十一：wire 模式协议错误 → JSON-RPC error（-32700/-32600/-32602）', () => {
  const parseErr = evaluateAcsEnvelope('{broken');
  assert.equal(parseErr.envelope.error?.code, -32700);
  assert.equal(parseErr.envelope.id, null);
  const invalidReq = evaluateAcsEnvelope({ jsonrpc: '2.0', id: 9, params: {} });
  assert.equal(invalidReq.envelope.error?.code, -32600);
  const invalidParams = evaluateAcsEnvelope({ ...VALID_ENVELOPE, params: { ...VALID_ENVELOPE.params, acs_version: '0.1' } });
  assert.equal(invalidParams.envelope.error?.code, -32602);
  assert.equal(invalidParams.envelope.id, 42);
});

test('§三十七/§三十八：result.request_id 与 response.id 回显', () => {
  const out = evaluateAcsEnvelope(JSON.stringify(VALID_ENVELOPE));
  assert.equal(out.envelope.id, 42);
  assert.equal(out.envelope.result?.request_id, '11111111-2222-4333-8444-555555555555');
  assert.equal(out.envelope.result?.type, 'final');
  assert.equal(out.envelope.result?.acs_version, '0.1.0');
});

test('unwrapAcsArguments：wrapper + provenance + argumentPath（§三十三/§三十五）', () => {
  const u = unwrapAcsArguments({
    path: { value: '/x', provenance: { provenance_id: 'p1', origin: 'user_input' } },
    plain: 'legacy-bare',
  });
  assert.equal(u.values['path'], '/x');
  assert.equal(u.values['plain'], 'legacy-bare');
  assert.equal(u.provenance[0]?.argumentPath, '/arguments/path');
});
