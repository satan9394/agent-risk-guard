/**
 * trash/linux.ts — Linux freedesktop.org Trash 实现（文档 §6）
 * D1：规范实现见 spec https://specifications.freedesktop.org/trash-spec/latest/
 *   - 同文件系统：移动到 ~/.local/share/Trash/files/ + 写 .trashinfo
 *   - 跨文件系统：挂载点根 /.Trash-$uid/ 或 /.Trash/
 * 首选命令：gio trash（GNOME 系）或 trash-cli。
 * 本机为 Windows，此实现未实测（标注 D1）。
 */

import { execFile } from 'node:child_process';

export interface TrashResult {
  ok: boolean;
  path: string;
  error?: string;
}

export async function trash(absPath: string, command: 'gio' | 'trash' = 'gio'): Promise<TrashResult> {
  return new Promise((resolve) => {
    const bin = command === 'gio' ? 'gio' : 'trash';
    const args = command === 'gio' ? ['trash', absPath] : [absPath];
    execFile(bin, args, { timeout: 30000 }, (err) => {
      if (err) resolve({ ok: false, path: absPath, error: err.message });
      else resolve({ ok: true, path: absPath });
    });
  });
}