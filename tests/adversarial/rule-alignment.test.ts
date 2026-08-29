/**
 * rule-alignment.test.ts — 单一事实源对齐（M7）
 *
 * 铁律：skill 侧 assets/dsh/deny-risk-commands.patch.yml 与 monorepo
 * defaultDenyRules() 必须逐条一致，防止双源漂移。
 * 未来任何一边增删规则，此测试立刻报错提醒同步。
 * R3 生态融合：支持 YAML 双单引号转义（''），计数动态化不再硬编码。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { defaultDenyRules } from '../../packages/installer/src/deploy.ts';

// 单一事实源 patch：优先仓库内副本（CI 可跑），skill 工作区存在时仍校验真身。
const REPO_PATCH = join(import.meta.dirname, '..', '..', 'assets', 'dsh', 'deny-risk-commands.patch.yml');
const SKILL_PATCH = join(import.meta.dirname, '..', '..', '..', 'agent-risk-guard-audit', 'assets', 'dsh', 'deny-risk-commands.patch.yml');
const PATCH = existsSync(REPO_PATCH) ? REPO_PATCH : SKILL_PATCH;

// YAML 单引号字符串中 '' 是转义的单引号 → 提取时还原为 '（R3：新增规则含 ['"] 字符类）
function extractPatchRules(raw: string): string[] {
  return [...raw.matchAll(/re: '((?:[^']|'')+)'/g)].map((m) => m[1].replace(/''/g, "'"));
}

test('M7: skill deny 规则与 defaultDenyRules 逐条一致（动态计数）', () => {
  assert.ok(existsSync(PATCH), `找不到 deny 规则 patch: ${PATCH}`);
  const skillRaw = readFileSync(PATCH, 'utf8');
  const skillRules = extractPatchRules(skillRaw);
  const mono = defaultDenyRules();
  assert.equal(mono.length, skillRules.length, `skill 与 monorepo 规则数不一致（skill=${skillRules.length}, mono=${mono.length}）`);
  const sSet = new Set(skillRules);
  for (const r of mono) {
    assert.ok(sSet.has(r), `规则只在 monorepo 存在（skill 缺失）: ${r}`);
  }
  const mSet = new Set(mono);
  for (const r of skillRules) {
    assert.ok(mSet.has(r), `规则只在 skill 存在（monorepo 缺失）: ${r}`);
  }
});