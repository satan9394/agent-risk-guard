/**
 * trash.linux.test.ts — Linux trash 兜底实现（2026-10-27）
 *
 * 背景：CI 的 ubuntu-latest 在镜像切换期并非每台都装了 `gio` / `trash`；
 * 旧实现只调外部命令，缺失时 `trash()` 返回 ok:false，安装事务回滚因此判 REMOVE-FAILED。
 * 这里把「外部命令不可用时按 freedesktop 规范自实现」这条路径钉死：
 * 清空 PATH 后仍必须把文件搬进 $XDG_DATA_HOME/Trash 并写 `.trashinfo`，且源路径消失。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { trash } from '../src/linux.ts';

const linuxOnly = process.platform === 'linux' ? test : test.skip;

function makeWorkspace(): { home: string; dataHome: string; file: string } {
  const home = mkdtempSync(join(tmpdir(), 'rg-trash-linux-'));
  const dataHome = join(home, 'share');
  mkdirSync(join(home, 'work'), { recursive: true });
  const file = join(home, 'work', 'sentinel.txt');
  writeFileSync(file, 'keep-me', 'utf8');
  return { home, dataHome, file };
}

linuxOnly('fallback: PATH 里没有 gio/trash 时仍进回收站，并写 .trashinfo', async () => {
  const { dataHome, file } = makeWorkspace();
  const prevPath = process.env.PATH;
  const prevXdg = process.env.XDG_DATA_HOME;
  process.env.PATH = '';
  process.env.XDG_DATA_HOME = dataHome;
  try {
    const r = await trash(file);
    assert.equal(r.ok, true, `trash must succeed without gio/trash on PATH: ${r.error ?? ''}`);
    assert.equal(existsSync(file), false, 'source file must be gone after trash');
    const filesDir = join(dataHome, 'Trash', 'files');
    assert.deepEqual(readdirSync(filesDir), ['sentinel.txt']);
    const info = readFileSync(join(dataHome, 'Trash', 'info', 'sentinel.txt.trashinfo'), 'utf8');
    assert.match(info, /^\[Trash Info\]/);
    assert.match(info, /DeletionDate=/);
  } finally {
    process.env.PATH = prevPath;
    if (prevXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = prevXdg;
  }
});

linuxOnly('fallback: 同名项已存在时加后缀，不覆盖回收站里的旧项', async () => {
  const { dataHome, file } = makeWorkspace();
  const prevPath = process.env.PATH;
  const prevXdg = process.env.XDG_DATA_HOME;
  process.env.PATH = '';
  process.env.XDG_DATA_HOME = dataHome;
  try {
    const filesDir = join(dataHome, 'Trash', 'files');
    mkdirSync(filesDir, { recursive: true });
    writeFileSync(join(filesDir, 'sentinel.txt'), 'older-entry', 'utf8');
    const r = await trash(file);
    assert.equal(r.ok, true);
    assert.equal(readFileSync(join(filesDir, 'sentinel.txt'), 'utf8'), 'older-entry', 'existing entry must not be overwritten');
    assert.deepEqual(readdirSync(filesDir).sort(), ['sentinel.1.txt', 'sentinel.txt']);
  } finally {
    process.env.PATH = prevPath;
    if (prevXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = prevXdg;
  }
});
