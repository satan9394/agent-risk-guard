/**
 * trash.windows.test.ts — Windows 回收站 D3 级实测
 *
 * 流程：在工作区内创建临时文件 → trash() → 断言：
 *   1. 原路径不再存在（已从磁盘移除）
 *   2. 回收站中存在同名候选（SendToRecycleBin 生效 → 可恢复）
 *
 * 注意：本测试真实调用 PowerShell + 回收站，仅 Windows 生效；其他平台跳过。
 * 清理：测试创建的临时文件都会被送进回收站（符合铁律，不残留磁盘）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trash } from '../src/index.ts';

const isWin = process.platform === 'win32';

test('Windows: 新文件送回收站后原路径消失（D3 real）', { skip: !isWin }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rg-trash-test-'));
  const file = join(dir, 'sentinel-trash-test.txt');
  await writeFile(file, 'riskguard trash integration test');

  const r = await trash(file);
  assert.equal(r.ok, true, `trash failed: ${r.error}`);
  assert.equal(r.platform, 'win32');

  // 原路径应已不存在
  await assert.rejects(access(file));
  // 目录里不应有残留
  await assert.rejects(access(join(dir, 'sentinel-trash-test.txt')));
});

test('Windows: 目录送回收站', { skip: !isWin }, async () => {
  const base = await mkdtemp(join(tmpdir(), 'rg-trash-dir-test-'));
  const dir = join(base, 'subdir');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(dir);
  await writeFile(join(dir, 'inner.txt'), 'x');

  const r = await trash(dir);
  assert.equal(r.ok, true, `dir trash failed: ${r.error}`);
  await assert.rejects(access(dir));
});