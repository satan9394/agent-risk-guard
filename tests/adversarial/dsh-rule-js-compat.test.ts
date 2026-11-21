/**
 * dsh-rule-js-compat.test.ts — DSH 规则集的「JS 可编译」闸门
 *
 * 背景（2026-11-12 本机实测，DSH 0.2.2-rc.2）：
 *   DSH 的 deny-risk-commands 插件用 JS `new RegExp(rule.re, 'i')` 逐条编译
 *   `cordis.patch.yml` 里 `config.rules` 的每条规则。JS 不支持 PCRE 的内联标志
 *   `(?m)` / `(?s)`，一条规则写错就会让整个 `apply()` 抛错 → 插件整行不激活
 *   （启动日志 `dsh: warning: 1 entry did not activate`），**删除门禁静默失效（fail-open）**。
 *   实测原始报错（E:\DeepSeek_Harness\.dsh-daily\logs\dsh-2026_11_12.err.log）：
 *     deny-risk-commands (deny-risk-commands): SyntaxError: Invalid regular expression:
 *     /(?m)^\s*\*\*\*\s*(?:Delete File|Move to):/i: Invalid group
 *
 * 结论（写进规则集的硬约束）：行锚点一律用 `(?:^|[\r\n])`（或 `(?:^|\n)`），
 * **不要用 `(?m)`**；规则集里出现任何 PCRE-only 语法都算缺陷。
 *
 * 本文件是回归闸门：DSH patch 与 defaultDenyRules() 的每条规则都必须能被
 * `new RegExp(re, 'i')` 编译；任何一条失败即红。第 3 个用例同时验证闸门本身有牙齿
 * （PCRE 内联标志在 JS 里确实抛错），避免闸门退化成恒真。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { defaultDenyRules } from '../../packages/installer/src/deploy.ts';

const REPO_PATCH = join(import.meta.dirname, '..', '..', 'assets', 'dsh', 'deny-risk-commands.patch.yml');
const SKILL_PATCH = join(import.meta.dirname, '..', '..', '..', 'agent-risk-guard-audit', 'assets', 'dsh', 'deny-risk-commands.patch.yml');
const PATCH = existsSync(REPO_PATCH) ? REPO_PATCH : SKILL_PATCH;

/** 与 rule-alignment.test.ts 相同的提取规则：YAML 单引号串里的 '' 还原为 ' */
function extractPatchRules(raw: string): string[] {
  return [...raw.matchAll(/re: '((?:[^']|'')+)'/g)].map((m) => m[1].replace(/''/g, "'"));
}

function assertAllCompile(rules: string[], source: string): void {
  assert.ok(rules.length > 0, `${source}：没提取到任何规则（提取器或文件形状变了？）`);
  const bad: string[] = [];
  for (const re of rules) {
    try {
      // 与 deny-risk-commands 插件同形：不带任何 JS 之外的能力
      new RegExp(re, 'i');
    } catch (error) {
      bad.push(`  ${re}\n    → ${(error as Error).message}`);
    }
  }
  assert.equal(bad.length, 0, `${source}：${bad.length}/${rules.length} 条规则无法被 JS new RegExp 编译（DSH 插件会整行不激活 → 门禁 fail-open）:\n${bad.join('\n')}`);
}

test('DSH patch：每条规则都能被 JS new RegExp(re, "i") 编译', () => {
  assert.ok(existsSync(PATCH), `找不到 DSH deny 规则 patch: ${PATCH}`);
  assertAllCompile(extractPatchRules(readFileSync(PATCH, 'utf8')), 'assets/dsh/deny-risk-commands.patch.yml');
});

test('defaultDenyRules()：每条规则都能被 JS new RegExp(re, "i") 编译', () => {
  // 同一份规则也下发给 Claude Code 的 filter matcher 与 OpenCode 插件（都是 JS 正则），
  // 所以这条不只是 DSH 的事：任何 PCRE-only 写法在三个宿主上都会炸。
  assertAllCompile(defaultDenyRules(), 'defaultDenyRules()');
});

test('闸门有牙齿：PCRE 内联标志在 JS 里必须抛错', () => {
  // 若这条变绿失败（= JS 开始接受 (?m)），说明运行时的正则方言变了，本闸门的假设要重新评估。
  for (const pcreOnly of ['(?m)^x', '(?s)a.b', '(?i)abc', '(?im)^x']) {
    assert.throws(() => new RegExp(pcreOnly, 'i'), `JS 不应接受 PCRE 内联标志: ${pcreOnly}`);
  }
});

test('apply_patch Delete File 规则：段首/换行后/CRLF 都命中（不依赖 (?m)）', () => {
  const rules = extractPatchRules(readFileSync(PATCH, 'utf8'));
  const rule = rules.find((r) => r.includes('Delete File|Move to'));
  assert.ok(rule, '规则集里找不到 apply_patch 的 Delete File|Move to 规则');
  const re = new RegExp(rule!, 'i');
  // positive：段首、段中（换行后）、CRLF、带前导空格
  assert.ok(re.test('*** Delete File: tracked.txt'), '段首应命中');
  assert.ok(re.test('*** Begin Patch\n*** Delete File: tracked.txt\n*** End Patch'), '换行后应命中');
  assert.ok(re.test('*** Begin Patch\r\n  *** Delete File: tracked.txt\r\n*** End Patch'), 'CRLF + 前导空格应命中');
  assert.ok(re.test('*** Begin Patch\n*** Move to: b.txt\n*** End Patch'), 'Move to 应命中');
  // negative：没有 `***` 标记的普通文本与无害命令不得命中
  assert.ok(!re.test('Delete File: 只是文档标题'), '缺 *** 标记不应命中');
  assert.ok(!re.test('git status --short'), '无害命令不应命中');
});
