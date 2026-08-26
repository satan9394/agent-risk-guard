/**
 * classify-fuzz.test.ts — M7 确定性模糊测试
 *
 * 固定种子伪随机组合命令片段，验证不变量：
 *   - 含破坏性关键词的命令必须被 classify 为破坏性（delete/overwrite/credential_export）
 *   - 纯只读/普通开发命令不得被误分类为 delete（避免误伤）
 *
 * 确定性：种子固定 → 结果可复现（非随机测试）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyShellCommand, isReadOnlyCommand } from '../src/normalize.ts';

/** 确定性 PRNG（mulberry32） */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DESTRUCTIVE_SEEDS = [
  'rm -rf', 'Remove-Item -Recurse', 'del /s /q', 'shutil.rmtree',
  'os.remove', 'rimraf', 'git clean -fdx', 'Format-Volume',
  'diskpart', 'rmdir /s', 'rd /s', 'unlink', 'shred', 'find -delete',
];
const FN_SEEDS = ['fs.rmSync', 'os.remove', 'shutil.rmtree', 'Path.unlink'];
const SAFE_SEEDS = [
  'git status', 'ls -la', 'cat file.txt', 'npm test', 'echo hi',
  'pwd', 'grep pattern file', 'mkdir newdir', 'head -5 x', 'date',
];
const MIDDLE = [' ', ' && ', '; ', ' | ', ' '];
const FN_MIDDLE = ['(', "('", '("'];
const SUFFIX = [' /tmp/x', ' C:\\proj\\f', ' files', " 'build'", ' node_modules'];
const FN_SUFFIX = ["/tmp/x')", "C:\\proj\\f')", "'build')", '"x")'];

test('M7 fuzz: 破坏性关键词任何拼法都必须归类 delete/destructive', () => {
  const rand = mulberry32(20260824);
  let checked = 0;
  for (let i = 0; i < 400; i++) {
    const isFn = rand() < 0.4;
    const cmd = isFn
      ? FN_SEEDS[Math.floor(rand() * FN_SEEDS.length)] + FN_MIDDLE[Math.floor(rand() * FN_MIDDLE.length)] + FN_SUFFIX[Math.floor(rand() * FN_SUFFIX.length)]
      : DESTRUCTIVE_SEEDS[Math.floor(rand() * DESTRUCTIVE_SEEDS.length)] + MIDDLE[Math.floor(rand() * MIDDLE.length)] + SUFFIX[Math.floor(rand() * SUFFIX.length)];

    const cls = classifyShellCommand(cmd);
    const destructive = cls?.action === 'delete' || cls?.action === 'recursive_delete' ||
      cls?.action === 'git_clean' || cls?.action === 'git_reset' || cls?.action === 'git_checkout_discard' ||
      cls?.destructive === true;
    assert.ok(destructive, `破坏性未识别: [${cmd}] → ${JSON.stringify(cls)}`);
    checked++;
    if (checked >= 120) break; // 400 内断言足够
  }
});

test('M7 fuzz: 安全命令不得误分类为 delete', () => {
  const rand = mulberry32(777);
  let checked = 0;
  for (let i = 0; i < 200; i++) {
    const cmd = SAFE_SEEDS[Math.floor(rand() * SAFE_SEEDS.length)] + MIDDLE[Math.floor(rand() * MIDDLE.length)] + SUFFIX[Math.floor(rand() * SUFFIX.length)];
    const cls = classifyShellCommand(cmd);
    const isDelete = cls?.action === 'delete' || cls?.action === 'recursive_delete';
    assert.ok(!isDelete, `安全命令误伤为 delete: [${cmd}] → ${JSON.stringify(cls)}`);
    checked++;
  }
});

test('M7 回归: cp/mv 不再是只读白名单成员', () => {
  assert.equal(isReadOnlyCommand('cp a.txt b.txt'), false, 'cp 是写操作，不得归只读');
  assert.equal(isReadOnlyCommand('mv a.txt b.txt'), false, 'mv 是写操作，不得归只读');
  assert.equal(isReadOnlyCommand('ls -la'), true);
  assert.equal(isReadOnlyCommand('git status'), true);
});