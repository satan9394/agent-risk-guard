/**
 * path-junction.test.ts — M7 行为级：junction 逃逸实测（Windows D3）
 *
 * 场景（文档 T10 路径逃逸）：
 *   workspaceRoot/link 是指向外部目录的 junction（New-Item -ItemType Junction）。
 *   删除 link 内文件在字符串级 canonical 判定为「workspace 内」，
 *   但 fs.realpath 揭示真实物理路径在 workspace 外 → 必须拒绝。
 *
 * 验证：
 *   1. junction 创建成功（跳过 = 无权限/非 Windows）
 *   2. resolvePath（字符串级）误判为 workspace 内 → 证明绕过存在
 *   3. resolveReal（fs.realpath）揭穿逃逸 → isWithin 判定为外 → 拒绝路径成立
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { resolvePath, resolveReal, isWithin, pathsEqual } from '../src/path-resolver.ts';

const isWin = process.platform === 'win32';

function makeJunction(link: string, target: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('cmd.exe', ['/c', 'mklink', '/J', link, target], { timeout: 15000 }, (err) => {
      resolve(!err);
    });
  });
}

test('M7 junction: 字符串级 canonical 看不见逃逸 → realpath 揭穿（Windows D3）', { skip: !isWin }, async () => {
  const base = await mkdtemp(join(tmpdir(), 'rg-junction-'));
  // workspaceRoot 与外部目标同盘（junction 要求同卷）
  const ws = join(base, 'workspace');
  const outside = join(base, 'outside-secret');
  const link = join(ws, 'junction-link');
  await mkdir(ws);
  await mkdir(outside);
  await writeFile(join(outside, 'secret.txt'), 'secret data');

  const created = await makeJunction(link, outside);
  if (!created) {
    // 无 junction 权限则跳过（无法实测）
    return;
  }

  // 1. 字符串级：link\secret.txt 被判定为 workspace 内 → 绕过成立（证明问题存在）
  const strLevel = resolvePath(join(link, 'secret.txt'));
  assert.equal(isWithin(strLevel, [ws]), true, '字符串级误判为 workspace 内（绕过存在的证据）');

  // 2. realpath 级：真实物理路径在 workspace 外
  const real = await resolveReal(join(link, 'secret.txt'));
  assert.ok(real, 'resolveReal 应解析成功');
  assert.equal(isWithin(real, [ws]), false, 'realpath 级判定为 workspace 外 → 必须拒绝');
  assert.ok(real!.canonical.toLowerCase().includes('outside-secret'), `应为 outside-secret：${real!.canonical}`);

  // 3. 两条路径并不 equal（字符串级 vs 真实）
  assert.equal(pathsEqual(strLevel, real!), false);
});