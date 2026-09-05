/**
 * tests/acs-schema-conformance/schema-conformance.test.ts
 * — ACS v0.1.0 Official JSON Schema Conformance（v0.2.1 §二十九/§三十/§三十七~§四十四/§六十）
 *
 * Layer 2：官方 JSON Schema（pinned 于 tests/vendor/owasp-acs-v0.1.0/，ajv Draft 2020-12）
 * 是最终 conformance 判据；本地 validator（Layer 1）不能替代它。
 *
 * 覆盖（§六十 全部 + 协议错误语义 §三十九/§四十/§四十一）：
 *   official valid request envelope PASS / toolCallRequest PASS
 *   capability omitted but valid PASS（推导 §三十一）
 *   arguments missing FAIL / argument wrapper shape FAIL
 *   safe allow / deny / modify / ask / defer response PASS（response-envelope）
 *   response request_id echo PASS（§三十七）/ jsonrpc id echo PASS（§三十八）
 *   acs_version 0.1 FAIL / 0.1.0 PASS
 *   result type missing FAIL / description-only modification FAIL
 *   parse error -32700 / invalid request -32600 / invalid params -32602
 *   security mapping failure → deny + degraded（非协议错误，§三十九/§四十）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { evaluateAcsEnvelope, evaluateAcsToolCall } from '../../packages/acs/src/gateway.ts';
import { validateAcsToolCallRequest } from '../../packages/acs/src/inbound.ts';
import { validateAcsResult } from '../../packages/acs/src/outbound.ts';
import { unwrapAcsArguments } from '../../packages/acs/src/arguments.ts';
import { deriveAcsCapability } from '../../packages/acs/src/capability-map.ts';
import { UNREPRESENTABLE_MODIFY_REASON } from '../../packages/acs/src/result.ts';
import type { AcsResult, AcsResponseEnvelope } from '../../packages/acs/src/types.ts';
import type { Decision } from '../../packages/core/src/decision.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = join(ROOT, 'vendor', 'owasp-acs-v0.1.0');
const FIX = (rel: string): string => readFileSync(join(ROOT, 'fixtures', 'acs-v0.1.0', rel), 'utf8');
const VEND = (rel: string): unknown => JSON.parse(readFileSync(join(VENDOR, rel), 'utf8'));

// ---------------------------------------------------------------------------
// Ajv Draft 2020-12（§二十八：使用成熟 validator，不自己实现 JSON Schema 引擎）
// ---------------------------------------------------------------------------

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
// 先注册全部 vendor schema（$id 引用解析：../provenance.json、modifications.json 等）
for (const rel of [
  'request-envelope.json',
  'response-envelope.json',
  'hooks/tool-call-request.json',
  'modifications.json',
  'ask-details.json',
  'defer-details.json',
  'provenance.json',
]) {
  ajv.addSchema(VEND(rel));
}
const validateRequestEnvelope = ajv.getSchema('https://acs.org/schema/v0.1.0/request-envelope.json')!;
const validateResponseEnvelope = ajv.getSchema('https://acs.org/schema/v0.1.0/response-envelope.json')!;
const validateToolCallRequest = ajv.getSchema('https://acs.org/schema/v0.1.0/hooks/tool-call-request.json')!;
const validateModifications = ajv.getSchema('https://acs.org/schema/v0.1.0/modifications.json')!;

// fixture 期望决策表（fixture 文件保持纯官方形状，元数据放在测试里）
const ENVELOPE_EXPECTED: Record<string, string> = {
  'shell-safe.json': 'allow',
  'git-reset-hard.json': 'deny',
  'git-reset-hard-no-capability.json': 'deny',
  'filesystem-delete.json': 'modify',
  'credential-read.json': 'allow',
  'mcp-tool-call.json': 'ask',
};

function loadEnvelope(name: string): { raw: string; parsed: Record<string, unknown> } {
  const raw = FIX(join('envelope', name));
  return { raw, parsed: JSON.parse(raw) as Record<string, unknown> };
}

function resultOf(envelope: Record<string, unknown>): AcsResult {
  return (envelope as unknown as AcsResponseEnvelope).result!;
}

// ============================================================================
// Layer 2：官方 Request Envelope（§四十三）
// ============================================================================

test('§四十三/§六十：official valid request envelope PASS（全部 envelope fixtures）', () => {
  for (const name of Object.keys(ENVELOPE_EXPECTED)) {
    const { parsed } = loadEnvelope(name);
    const ok = validateRequestEnvelope(parsed);
    assert.equal(ok, true, `envelope/${name} 应通过官方 request-envelope.json：${JSON.stringify(validateRequestEnvelope.errors)}`);
  }
});

test('§四十三：params.payload 单独通过 tool-call-request schema（两层都验证）', () => {
  for (const name of Object.keys(ENVELOPE_EXPECTED)) {
    const { parsed } = loadEnvelope(name);
    const payload = (parsed['params'] as Record<string, unknown>)['payload'];
    const ok = validateToolCallRequest(payload);
    assert.equal(ok, true, `envelope/${name} 的 payload 应通过官方 tool-call-request.json：${JSON.stringify(validateToolCallRequest.errors)}`);
  }
});

test('§六十：official valid toolCallRequest PASS（payload fixtures）', () => {
  for (const name of ['shell-safe.json', 'git-reset-hard.json', 'filesystem-delete.json', 'credential-read.json', 'mcp-tool-call.json']) {
    const payload = JSON.parse(FIX(join('payload', name)));
    const ok = validateToolCallRequest(payload);
    assert.equal(ok, true, `payload/${name} 应通过官方 tool-call-request.json：${JSON.stringify(validateToolCallRequest.errors)}`);
  }
});

// ============================================================================
// §三十一/§三十二：capability optional
// ============================================================================

test('§三十/§六十：capability omitted 但官方 schema 仍 PASS，gateway 不拒绝', () => {
  const raw = FIX(join('envelope', 'git-reset-hard-no-capability.json'));
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  // Layer 2：官方 schema PASS（capability 可选）
  assert.equal(validateRequestEnvelope(parsed), true);
  assert.equal(validateToolCallRequest((parsed['params'] as Record<string, unknown>)['payload']), true);
  // Layer 1：本地校验也通过（capability 不是必填）
  assert.equal(validateAcsToolCallRequest((parsed['params'] as Record<string, unknown>)['payload']).ok, true);
  // gateway 全链路：推导 git.destructive → RG-GIT-001 deny（不是“缺 capability 直接拒绝”）
  const out = evaluateAcsEnvelope(raw);
  assert.equal(out.envelope.error, undefined);
  assert.equal(out.envelope.result?.decision, 'deny');
  assert.equal(out.envelope.result?.extensions?.riskguard?.ruleId, 'RG-GIT-001');
});

test('§三十一：推导示例 tool.name=shell + raw_command=git reset --hard → git.destructive', () => {
  const derived = deriveAcsCapability({ toolName: 'shell', operation: 'execute', rawCommand: 'git reset --hard HEAD' });
  assert.equal(derived, 'git.destructive');
});

test('§三十二：推导不确定 → fail-closed deny + degraded（不是协议错误）', () => {
  const out = evaluateAcsToolCall({
    tool: { name: 'mystery-tool' },
    operation: 'do-something-unknown',
    arguments: { foo: { value: 'bar' } },
  });
  assert.equal(out.degraded, true);
  assert.equal(out.result.decision, 'deny');
  assert.equal(out.result.extensions?.riskguard?.degraded, true);
  assert.ok(out.result.reasoning?.includes('Security mapping failed'));
});

// ============================================================================
// §三十三/§三十四/§三十五：arguments value-wrapper + provenance
// ============================================================================

test('§三十三：unwrapAcsArguments 解析 value-wrapper（不把 wrapper 对象当字符串）', () => {
  const unwrapped = unwrapAcsArguments({
    path: { value: '/project/test' },
    command: { value: 'ls -la', provenance: { provenance_id: 'p-1', origin: 'user_input' } },
  });
  assert.equal(unwrapped.values['path'], '/project/test');
  assert.equal(unwrapped.values['command'], 'ls -la');
  assert.equal(unwrapped.provenance.length, 1);
  assert.equal(unwrapped.provenance[0]!.argumentPath, '/arguments/command'); // §三十五
  assert.equal(unwrapped.provenance[0]!.provenance.provenance_id, 'p-1');
});

test('§三十三：arguments 裸值（遗留 payload）也被容忍，但官方 schema 拒绝（Layer 2 判据）', () => {
  const bare = { tool: { name: 'filesystem' }, arguments: { path: '/x' } };
  // Layer 1 容忍（兼容 v0.2.0 遗留）
  assert.equal(validateAcsToolCallRequest(bare).ok, true);
  // Layer 2 官方 schema 拒绝（§六十：argument wrapper shape FAIL）
  assert.equal(validateToolCallRequest(bare), false);
});

test('§三十四/§三十五：参数级 provenance 映射进 RiskEvent context.metadata.provenance（含 argumentPath）', () => {
  const payload = {
    tool: { name: 'filesystem' },
    capability: 'filesystem.delete',
    arguments: {
      path: { value: '/project', provenance: { provenance_id: 'p-7', origin: 'user_input', source_id: 'user-42' } },
      mode: { value: 'permanent' },
    },
  };
  const out = evaluateAcsToolCall(payload);
  assert.equal(out.result.decision, 'modify');
  // event 上的 provenance 证据（mapping 层；Core 不解释）
  const provenance = (out.event?.context?.metadata as Record<string, unknown> | undefined)?.['provenance'] as Array<Record<string, unknown>> | undefined;
  assert.ok(Array.isArray(provenance) && provenance.length === 1);
  assert.equal(provenance![0]!['argumentPath'], '/arguments/path');
  assert.equal(provenance![0]!['provenance_id'], 'p-7');
});

test('§三十六：envelope metadata → context.metadata.acs（Core 不解释 ACS）', () => {
  // 经 evaluateAcsEnvelope 全链路后，event 上应带 acs metadata
  const out = evaluateAcsEnvelope(FIX(join('envelope', 'shell-safe.json')));
  const acsMeta = (out.event?.context?.metadata as Record<string, unknown> | undefined)?.['acs'] as Record<string, unknown> | undefined;
  assert.equal(acsMeta?.['agentId'], 'acs-conformance-agent');
  assert.equal(acsMeta?.['sessionId'], '7a2d9f01-6c8b-4e3a-b5d2-1f0e9c8b7a65');
});

// ============================================================================
// Layer 2：官方 Response Envelope（§四十二）
// ============================================================================

test('§四十二/§六十：allow/deny/modify/ask 响应全部通过官方 response-envelope.json', () => {
  for (const name of Object.keys(ENVELOPE_EXPECTED)) {
    const out = evaluateAcsEnvelope(FIX(join('envelope', name)));
    assert.equal(out.envelope.error, undefined, `envelope/${name} 不应是协议错误`);
    const ok = validateResponseEnvelope(out.envelope);
    assert.equal(ok, true, `envelope/${name} 响应应通过官方 response-envelope.json：${JSON.stringify(validateResponseEnvelope.errors)}`);
    assert.equal(out.envelope.result?.decision, ENVELOPE_EXPECTED[name], `envelope/${name} 决策`);
  }
});

test('§六十：defer 响应通过官方 response-envelope.json（自定义 mapDecision 产生）', () => {
  const deferMapper = (_dec: Decision, opts: { requestId?: string }): AcsResult => ({
    type: 'final',
    acs_version: '0.1.0',
    request_id: opts.requestId ?? '00000000-0000-4000-8000-000000000000',
    decision: 'defer',
    reasoning: 'deferred for external policy review',
    defer_details: {
      reason: 'insufficient_context',
      resolution_method: 'human_approval',
      resolution_timeout_ms: 60000,
      timeout_decision: 'deny',
      required_context: ['additional user confirmation'],
    },
    metadata: { evaluator: 'deterministic' },
    extensions: { riskguard: { ruleId: 'RG-ACS-DEFER-001', acsVersion: '0.1.0' } },
  });
  const out = evaluateAcsEnvelope(FIX(join('envelope', 'git-reset-hard.json')), { mapDecision: deferMapper });
  assert.equal(out.envelope.result?.decision, 'defer');
  const ok = validateResponseEnvelope(out.envelope);
  assert.equal(ok, true, `defer 响应应通过官方 response-envelope.json：${JSON.stringify(validateResponseEnvelope.errors)}`);
});

test('§六十：modify 使用官方 modifications shape（parameter_overrides，非 description 文字）', () => {
  const out = evaluateAcsEnvelope(FIX(join('envelope', 'filesystem-delete.json')));
  const result = out.envelope.result!;
  assert.equal(result.decision, 'modify');
  // 官方 modifications.json 校验
  const ok = validateModifications(result.modifications);
  assert.equal(ok, true, `modifications 应通过官方 modifications.json：${JSON.stringify(validateModifications.errors)}`);
  // 必须是结构化改写，不是 description-only（§二十一）
  const mods = result.modifications as { parameter_overrides?: Record<string, unknown> };
  assert.ok(mods.parameter_overrides && Object.keys(mods.parameter_overrides).length > 0);
  assert.equal(result.reasoning?.includes('please use trash instead'), false);
});

test('§二十：无法安全表达 modify → deny（reasoning 含固定说明），不伪造 modify', () => {
  const out = evaluateAcsEnvelope(FIX(join('envelope', 'git-reset-hard.json')));
  assert.equal(out.envelope.result?.decision, 'deny');
  const legacy = evaluateAcsToolCall({
    tool: { name: 'filesystem' },
    capability: 'filesystem.delete',
    arguments: { path: { value: 'C:\\work\\x' } }, // 只有 path，无法表达 operation/mode 改写
  });
  assert.equal(legacy.result.decision, 'deny');
  assert.ok(legacy.result.reasoning?.includes(UNREPRESENTABLE_MODIFY_REASON));
});

// ============================================================================
// §三十七/§三十八：request_id / id 回显
// ============================================================================

test('§三十七：result.request_id == request.params.request_id', () => {
  for (const name of Object.keys(ENVELOPE_EXPECTED)) {
    const { parsed } = loadEnvelope(name);
    const out = evaluateAcsEnvelope(FIX(join('envelope', name)));
    const expectReqId = (parsed['params'] as Record<string, unknown>)['request_id'] as string;
    assert.equal(out.envelope.result?.request_id, expectReqId, `envelope/${name} request_id 回显`);
  }
});

test('§三十八：response.id == request.id（成功场景）', () => {
  for (const name of Object.keys(ENVELOPE_EXPECTED)) {
    const { parsed } = loadEnvelope(name);
    const out = evaluateAcsEnvelope(FIX(join('envelope', name)));
    assert.equal(out.envelope.id, parsed['id'], `envelope/${name} id 回显`);
  }
});

// ============================================================================
// §四十四：negative tests（官方 schema FAIL）
// ============================================================================

test('§六十/§四十四：arguments missing → official schema FAIL', () => {
  const bad = { tool: { name: 'shell' }, capability: 'shell.execute' };
  assert.equal(validateToolCallRequest(bad), false);
});

test('§六十：argument wrapper shape FAIL（裸值参数）', () => {
  const bad = { tool: { name: 'shell' }, arguments: { command: 'npm test' } };
  assert.equal(validateToolCallRequest(bad), false);
});

test('§六十/§四十四：acs_version = 0.1 → FAIL；0.1.0 → PASS', () => {
  const env010 = JSON.parse(FIX(join('envelope', 'shell-safe.json'))) as Record<string, unknown>;
  const env01 = structuredClone(env010) as Record<string, unknown>;
  ((env01['params'] as Record<string, unknown>)['acs_version']) = '0.1';
  assert.equal(validateRequestEnvelope(env01), false, 'acs_version=0.1 必须 FAIL（官方要求完整 SemVer）');
  assert.equal(validateRequestEnvelope(env010), true, 'acs_version=0.1.0 PASS');
  // Layer 1 同样 fail-closed
  const out = evaluateAcsEnvelope(JSON.stringify(env01));
  assert.equal(out.envelope.error?.code, -32602);
});

test('§六十/§四十四：result type missing → official response schema FAIL', () => {
  const out = evaluateAcsEnvelope(FIX(join('envelope', 'shell-safe.json')));
  const result = out.envelope.result!;
  const noType = { ...result };
  delete (noType as { type?: string }).type;
  assert.equal(validateResponseEnvelope({ jsonrpc: '2.0', id: 1, result: noType }), false);
});

test('§六十/§四十四：result missing request_id → FAIL', () => {
  const out = evaluateAcsEnvelope(FIX(join('envelope', 'shell-safe.json')));
  const result = out.envelope.result!;
  const noReqId = { ...result };
  delete (noReqId as { request_id?: string }).request_id;
  assert.equal(validateResponseEnvelope({ jsonrpc: '2.0', id: 1, result: noReqId }), false);
});

test('§六十/§二十一/§四十四：description-only modification → FAIL（官方 modifications + response schema）', () => {
  const fake = { description: 'please use trash instead' };
  assert.equal(validateModifications(fake), false, 'description-only 不是合法 modification');
  const result: AcsResult = {
    type: 'final',
    acs_version: '0.1.0',
    request_id: '11111111-2222-4333-8444-555555555555',
    decision: 'modify',
    reasoning: 'replace permanent delete with trash',
    modifications: fake as never,
  };
  assert.equal(validateResponseEnvelope({ jsonrpc: '2.0', id: 1, result }), false);
  // Layer 1 同样拒绝
  assert.equal(validateAcsResult(result).ok, false);
});

test('§六十：modify modifications=[] → FAIL', () => {
  const result: AcsResult = {
    type: 'final',
    acs_version: '0.1.0',
    request_id: '11111111-2222-4333-8444-555555555555',
    decision: 'modify',
    reasoning: 'x',
    modifications: [] as never,
  };
  assert.equal(validateResponseEnvelope({ jsonrpc: '2.0', id: 1, result }), false);
  assert.equal(validateAcsResult(result).ok, false);
});

// ============================================================================
// §三十九/§四十/§四十一：协议错误 vs policy deny
// ============================================================================

test('§四十一：invalid JSON → -32700 Parse error（id null），不是伪造 ACS result', () => {
  const out = evaluateAcsEnvelope('{broken json');
  assert.equal(out.envelope.jsonrpc, '2.0');
  assert.equal(out.envelope.id, null);
  assert.equal(out.envelope.error?.code, -32700);
  assert.equal(out.envelope.result, undefined);
});

test('§四十一：invalid envelope 结构 → -32600 Invalid Request（id 尽力回显）', () => {
  const missingMethod = JSON.stringify({ jsonrpc: '2.0', id: 99, params: {} });
  const out = evaluateAcsEnvelope(missingMethod);
  assert.equal(out.envelope.error?.code, -32600);
  assert.equal(out.envelope.id, 99);
});

test('§四十一：invalid params（缺必填）→ -32602 Invalid params（id 回显）', () => {
  const bad = JSON.stringify({
    jsonrpc: '2.0', method: 'steps/toolCallRequest', id: 7,
    params: { acs_version: '0.1.0', request_id: '11111111-2222-4333-8444-555555555555' }, // 缺 timestamp/metadata/payload
  });
  const out = evaluateAcsEnvelope(bad);
  assert.equal(out.envelope.error?.code, -32602);
  assert.equal(out.envelope.id, 7);
});

test('§三十九：payload 形状非法（arguments missing）→ -32602，不是 deny 也不是 -32700', () => {
  const env = JSON.parse(FIX(join('envelope', 'shell-safe.json'))) as Record<string, unknown>;
  const bad = structuredClone(env) as Record<string, unknown>;
  (bad['params'] as Record<string, unknown>)['payload'] = { tool: { name: 'shell' }, capability: 'shell.execute' };
  const out = evaluateAcsEnvelope(JSON.stringify(bad));
  assert.equal(out.envelope.error?.code, -32602);
  assert.equal(out.envelope.result, undefined);
});

test('§三十九/§四十：安全映射失败 → ACS deny + degraded=true（result envelope，非协议错误）', () => {
  const env = JSON.parse(FIX(join('envelope', 'shell-safe.json'))) as Record<string, unknown>;
  const bad = structuredClone(env) as Record<string, unknown>;
  (bad['params'] as Record<string, unknown>)['payload'] = {
    tool: { name: 'shell' },
    capability: 'magic.teleport',
    arguments: { target: { value: 'x' } },
  };
  const out = evaluateAcsEnvelope(JSON.stringify(bad));
  // 不是协议错误：没有 error 字段
  assert.equal(out.envelope.error, undefined);
  assert.equal(out.envelope.result?.decision, 'deny');
  assert.equal(out.envelope.result?.extensions?.riskguard?.degraded, true);
  assert.equal(out.envelope.result?.request_id, (bad['params'] as Record<string, unknown>)['request_id']);
});

// ============================================================================
// Layer 1 vs Layer 2（§二十九）
// ============================================================================

test('§二十九：Layer 1 本地 validator 与 Layer 2 官方 schema 都保留', () => {
  // Layer 1：快速、友好
  const v1 = validateAcsToolCallRequest({ tool: { name: 'x' } });
  assert.equal(v1.ok, false);
  assert.ok(typeof v1.ok === 'boolean' && 'reason' in v1);
  // Layer 2：官方 schema 判据
  assert.equal(validateToolCallRequest({ tool: { name: 'x' } }), false);
});
