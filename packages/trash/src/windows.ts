/**
 * trash/windows.ts — Windows 回收站实现（文档 §6 统一 Trash 能力）
 *
 * 内部经 PowerShell 调用 Microsoft.VisualBasic.FileIO.FileSystem::DeleteFile/DeleteDirectory
 * 带 SendToRecycleBin（本机已验证的可靠路径，见 agent-risk-guard-audit skill 铁律）。
 * 返回结果对象，不抛异常（失败时返回 error 字段）。
 */

import { execFile } from 'node:child_process';

export interface TrashResult {
  ok: boolean;
  path: string;
  error?: string;
}

function runPowershell(script: string): Promise<string> {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 30000 }, (err, stdout) => {
      if (err) resolve(stdout ?? '');
      else resolve(stdout ?? '');
    });
  });
}

/** 单引号转义（PowerShell 内嵌） */
function psQuote(p: string): string {
  return p.replace(/'/g, "''");
}

/** 移动单个文件到回收站 */
export async function trashFile(absPath: string): Promise<TrashResult> {
  const script =
    `Add-Type -AssemblyName Microsoft.VisualBasic; ` +
    `[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${psQuote(absPath)}', 'OnlyErrorDialogs', 'SendToRecycleBin')`;
  try {
    await runPowershell(script);
    return { ok: true, path: absPath };
  } catch (e) {
    return { ok: false, path: absPath, error: (e as Error).message };
  }
}

/** 移动单个目录（含内容）到回收站 */
export async function trashDirectory(absPath: string): Promise<TrashResult> {
  const script =
    `Add-Type -AssemblyName Microsoft.VisualBasic; ` +
    `[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('${psQuote(absPath)}', 'OnlyErrorDialogs', 'SendToRecycleBin')`;
  try {
    await runPowershell(script);
    return { ok: true, path: absPath };
  } catch (e) {
    return { ok: false, path: absPath, error: (e as Error).message };
  }
}

/** 根据路径是否存在文件/目录决定走哪个 API */
export async function trash(absPath: string): Promise<TrashResult> {
  const { stat } = await import('node:fs/promises');
  try {
    const s = await stat(absPath);
    return s.isDirectory() ? trashDirectory(absPath) : trashFile(absPath);
  } catch {
    return { ok: false, path: absPath, error: 'path not found or not accessible' };
  }
}