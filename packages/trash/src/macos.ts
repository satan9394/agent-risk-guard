/**
 * trash/macos.ts — macOS Trash 实现（文档 §6）
 * D1：使用系统 `trash` 命令（如未安装可提示 brew install trash）。
 * 本机为 Windows，此实现未实测（标注 D1）。
 */

import { execFile } from 'node:child_process';

export interface TrashResult {
  ok: boolean;
  path: string;
  error?: string;
}

export async function trash(absPath: string): Promise<TrashResult> {
  return new Promise((resolve) => {
    execFile('trash', [absPath], { timeout: 30000 }, (err) => {
      if (err) resolve({ ok: false, path: absPath, error: err.message });
      else resolve({ ok: true, path: absPath });
    });
  });
}

/** macOS 文件名转义由 execFile 数组参数处理，无需手动 quote */