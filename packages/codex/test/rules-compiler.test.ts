/**
 * rules-compiler.test.ts — M5 Codex Rules Compiler 测试
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileRules, writeRulesFile } from '../src/rules-compiler.ts';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('M5: compileRules 生成 AGENTS.md，含铁律与策略明细', () => {
  const out = compileRules({ target: 'AGENTS.md' });
  assert.ok(out.content.includes('# RiskGuard 安全规则'));
  assert.ok(out.content.includes('## 铁律'));
  assert.ok(out.content.includes('回收站'));
  assert.ok(out.content.includes('## 策略明细'));
  assert.ok(out.ruleCount >= 8, `规则 ${out.ruleCount} 条`);
  // 关键规则必须出现
  assert.match(out.content, /RG-FS-001/);
  assert.match(out.content, /RG-GUARD-002/);
  assert.match(out.content, /RG-PROC-002/);
  assert.match(out.content, /RG-CRED-001/);
  // R16 补全：铁律必须覆盖新向量（防回归）
  assert.match(out.content, /certutil/, '铁律应含 certutil');
  assert.match(out.content, /switch -C/, '铁律应含 git switch -C');
  assert.match(out.content, /docker system prune/, '铁律应含 docker prune');
  assert.match(out.content, /全角/, '铁律应含全角变体警示');
  assert.match(out.content, /subprocess/, '铁律应含 subprocess 动态执行');
});

test('M5: compileRules 可生成 CLAUDE.md 变体', () => {
  const out = compileRules({ target: 'CLAUDE.md' });
  assert.ok(out.target === 'CLAUDE.md');
  assert.ok(out.content.startsWith('# RiskGuard'));
});

test('M5: writeRulesFile 落盘可读回', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rg-codex-'));
  const p = join(dir, 'AGENTS.md');
  const w = await writeRulesFile(p);
  assert.equal(w.ok, true);
  assert.ok(w.bytes > 200);
  const back = await readFile(p, 'utf8');
  assert.ok(back.includes('RiskGuard'));
});