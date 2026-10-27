/**
 * trash/linux.ts — Linux freedesktop.org Trash 实现（文档 §6）
 * D2：外部命令（gio / trash-cli）优先，失败则按 spec 自实现兜底。
 *   - 同文件系统：移动到 $XDG_DATA_HOME/Trash/files/ + 写 .trashinfo
 *   - 跨文件系统：先复制进 Trash，再移除源（spec 允许）
 *   - 2026-10-27：CI 的 ubuntu-latest 在镜像切换期**并非每台都装了 gio**，
 *     原先只调 `gio trash` 时一旦该命令缺失，`trash()` 就返回 ok:false，
 *     调用方（安装事务回滚）据此判 REMOVE-FAILED → 回滚不完整、用例红。
 *     现改成「外部命令 → 另一条外部命令 → 自实现」三级，屏蔽对系统包的依赖。
 */

import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';

export interface TrashResult {
  ok: boolean;
  path: string;
  error?: string;
}

function runCommand(bin: string, args: string[]): Promise<TrashResult> {
  return new Promise((resolve) => {
    const absPath = args[args.length - 1];
    execFile(bin, args, { timeout: 30000 }, (err) => {
      if (err) resolve({ ok: false, path: absPath, error: err.message });
      else resolve({ ok: true, path: absPath });
    });
  });
}

/** 按 freedesktop 规范直接搬进 Trash（不依赖外部命令）。 */
function freeDesktopTrash(absPath: string): TrashResult {
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  const filesDir = join(dataHome, 'Trash', 'files');
  const infoDir = join(dataHome, 'Trash', 'info');
  try {
    mkdirSync(filesDir, { recursive: true });
    mkdirSync(infoDir, { recursive: true });
    // 同名冲突时按 spec 加后缀，避免覆盖回收站里已有的同名项
    const ext = extname(absPath);
    const stem = basename(absPath, ext);
    let name = basename(absPath);
    let target = join(filesDir, name);
    for (let i = 1; existsSync(target); i += 1) {
      name = `${stem}.${i}${ext}`;
      target = join(filesDir, name);
    }
    try {
      renameSync(absPath, target);
    } catch {
      // 跨设备（EXDEV）等：复制后移除源，语义仍是「进回收站」
      cpSync(absPath, target, { recursive: true });
      rmSync(absPath, { recursive: true, force: true });
    }
    if (existsSync(absPath)) {
      return { ok: false, path: absPath, error: 'trash fallback left the source in place' };
    }
    const now = new Date();
    const pitch = now.toISOString().slice(0, 19);
    writeFileSync(
      join(infoDir, `${name}.trashinfo`),
      `[Trash Info]\nPath=${encodeURIComponent(absPath)}\nDeletionDate=${pitch}\n`,
      'utf8'
    );
    return { ok: true, path: absPath };
  } catch (e) {
    return { ok: false, path: absPath, error: (e as Error).message };
  }
}

export async function trash(absPath: string, command: 'gio' | 'trash' = 'gio'): Promise<TrashResult> {
  const primary = command === 'gio' ? 'gio' : 'trash';
  const secondary = command === 'gio' ? 'trash' : 'gio';
  const first = primary === 'gio' ? await runCommand('gio', ['trash', absPath]) : await runCommand('trash', [absPath]);
  if (first.ok && !existsSync(absPath)) return first;
  const second = secondary === 'gio' ? await runCommand('gio', ['trash', absPath]) : await runCommand('trash', [absPath]);
  if (second.ok && !existsSync(absPath)) return second;
  const fallback = freeDesktopTrash(absPath);
  return fallback;
}
