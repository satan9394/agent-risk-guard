/**
 * tests/compatibility/compatibility-v2.test.ts — Compatibility Schema v2（v0.2.0 §二十~§三十六）
 *
 * 覆盖：v2 字段加载 / v1→v2 迁移（§四十一）/ 访问器 / Windsurf conditional availability（§三十一）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadCompatibility,
  parseCompatibility,
  agentSurfaces,
  agentFailMode,
  agentPolicyScope,
  agentBypass,
  agentConditionalAvailability,
  agentSecurityBoundaries,
  agentCapabilities,
} from '../../packages/installer/src/compatibility.ts';

test('v2: schemaVersion=2.0 + acsProfile 存在', () => {
  const c = loadCompatibility();
  assert.equal(c.schemaVersion, '2.0');
  assert.equal(c.acsProfile, 'experimental-0.1');
  // D0–D4 定义保留（check-compatibility-docs 依赖；§二十七 不替换 D 等级）
  assert.ok(c.levels.D3.includes('Real agent execution verified'));
});

test('v2: claude-code 真实执行边界字段齐全（§二十二 最小覆盖）', () => {
  const cc = loadCompatibility().agents['claude-code'];
  // surfaces
  assert.equal(cc.surfaces?.['shell'], 'supported');
  assert.equal(cc.surfaces?.['mcp'], 'unknown');
  // enforcement
  assert.equal(cc.enforcementDetail?.hardDeny, 'supported');
  assert.equal(cc.enforcementDetail?.failMode, 'fail-closed');
  // sandbox / policy scope
  assert.equal(cc.sandbox?.available, 'unknown');
  assert.deepEqual(cc.policy?.policyScope, ['user']);
  // bypass（§三十五：诚实，不做"绝对硬拦截"宣传）
  assert.equal(cc.bypass?.userCanDisable, 'supported');
  assert.equal(cc.bypass?.agentCanBypass, 'unsupported');
  // hook failure semantics（§三十二：hard 与 crash 行为分开描述）
  assert.equal(cc.hookFailureSemantics, 'fail-closed');
  // security boundaries（§三十三/§三十四）
  assert.deepEqual(cc.securityBoundaries, ['L0', 'L1', 'L2']);
  // per-capability matrix
  assert.equal(cc.capabilities?.['shell.execute']?.enforcement, 'hard');
  assert.equal(cc.capabilities?.['shell.execute']?.verification?.['windows'], 'D3');
  assert.equal(cc.capabilities?.['mcp.invoke']?.enforcement, 'unknown');
  // component inventory（AGBoM 预留 §三十六）
  assert.ok(cc.componentInventory?.['adapter']);
});

test('v2: EvidenceState 不允许裸 boolean（§二十三：不知道 ≠ false）', () => {
  const c = loadCompatibility();
  const okStates = ['supported', 'unsupported', 'unknown', 'not-applicable'];
  for (const a of Object.values(c.agents)) {
    for (const [k, v] of Object.entries(a.surfaces ?? {})) {
      assert.ok(okStates.includes(v), `${a.display}.surfaces.${k}=${String(v)} 不是 EvidenceState`);
    }
    for (const v of Object.values(a.enforcementDetail ?? {})) {
      if (v !== undefined) {
        assert.ok(okStates.includes(v) || ['fail-open', 'fail-closed', 'warning-and-continue', 'unknown'].includes(v), `enforcementDetail 非法值: ${String(v)}`);
      }
    }
  }
});

test('v2: Windsurf conditional availability — Restricted Mode → hooks 不加载（§三十一）', () => {
  const ws = loadCompatibility().agents['windsurf'];
  const ca = ws.conditionalAvailability ?? [];
  assert.ok(ca.some((x) => x.feature === 'hook' && x.condition.includes('Restricted Mode') && x.state === 'supported'));
});

test('v2: grok 诚实 fail-open（软约束，不误报 hard）', () => {
  const g = loadCompatibility().agents['grok'];
  assert.equal(g.enforcement, 'soft');
  assert.equal(g.hookFailureSemantics, 'fail-open');
  assert.equal(g.enforcementDetail?.hardDeny, 'unsupported');
});

test('v1 → v2 迁移：旧数据不 crash，缺省 unknown（§四十一）', () => {
  const v1 = JSON.stringify({
    schemaVersion: '1.0',
    productVersion: '0.1.2',
    levels: { D0: 'Unsupported', D1: 'Implementation exists', D2: 'Automated test verified', D3: 'Real agent execution verified', D4: 'Repeated / production verified' },
    agents: {
      'claude-code': {
        display: 'Claude Code', integration: 'PreToolUse hook', enforcement: 'hard',
        verification: { windows: 'D3', macos: 'D1', linux: 'D1' },
        notes: 'old v1 data',
      },
      'pi': {
        display: 'Pi', integration: 'none', enforcement: 'none', verification: { windows: 'D0' },
      },
    },
  });
  const migrated = parseCompatibility(v1);
  assert.equal(migrated.schemaVersion, '1.0'); // 保留原版本标记
  // 核心字段保留
  assert.equal(migrated.agents['claude-code'].verification['windows'], 'D3');
  assert.equal(migrated.agents['claude-code'].enforcement, 'hard');
  // v2 字段补默认：unknown 而非 false（§二十三）
  assert.equal(migrated.agents['claude-code'].surfaces?.['shell'], undefined);
  assert.equal(migrated.agents['claude-code'].enforcementDetail?.hardDeny, 'supported'); // hard → supported
  assert.equal(migrated.agents['claude-code'].enforcementDetail?.failMode, 'fail-closed');
  assert.deepEqual(migrated.agents['claude-code'].policy?.policyScope, []);
  assert.equal(migrated.agents['claude-code'].bypass?.userCanDisable, undefined); // 无证据 → 不伪造
  assert.deepEqual(migrated.agents['claude-code'].securityBoundaries, []);
  assert.equal(migrated.agents['pi'].enforcementDetail?.hardDeny, 'not-applicable');
});

test('v2 访问器：surfaces / failMode / policyScope / bypass / boundaries / capabilities', () => {
  assert.equal(agentSurfaces('claude-code')['shell'], 'supported');
  assert.equal(agentFailMode('claude-code'), 'fail-closed');
  assert.equal(agentFailMode('grok'), 'fail-open');
  assert.deepEqual(agentPolicyScope('claude-code'), ['user']);
  const b = agentBypass('claude-code');
  assert.equal(b.userCanDisable, 'supported');
  assert.equal(b.agentCanBypass, 'unsupported');
  assert.ok(agentConditionalAvailability('windsurf').length >= 1);
  assert.ok(agentSecurityBoundaries('claude-code').includes('L2'));
  assert.equal(agentCapabilities('opencode')['shell.execute']?.enforcement, 'hard');
});
