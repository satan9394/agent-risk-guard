/**
 * installer/backup.ts — M6 备份（写入前安全备份，对齐 skill 既定约定）
 *
 * 铁律：任何 GoLive 写入前先备份目标文件/目录到 %USERPROFILE%\.risk-guard-backup\<agent>\<timestamp>\。
 * 备份为拷贝（非移动），原文件保持不动，可重复备份（自动按时间戳分目录）。
 */

import { mkdir, copyFile, readdir, stat, cp } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';

export interface BackupResult {
  ok: boolean;
  backupRoot: string;
  agent: string;
  /** 本次备份的精确条目（rollback 只允许使用这些 dst，禁止扫描历史目录） */
  entries: { src: string; dst: string }[];
  transactionId?: string;
  error?: string;
}

export function backupRoot(home?: string): string {
  return join(home ?? process.env.USERPROFILE ?? process.env.HOME ?? '.', '.risk-guard-backup');
}

/** 路径 → 备份内相对唯一名（盘符_路径各段，防同名覆盖；rollback 用同函数还原匹配） */
export function relPath(p: string): string {
  return p.replace(/^([A-Za-z]):/, '$1_').replace(/[\\/]+/g, '_').replace(/^[._]+/, '');
}

/** 备份一组文件/目录 → <backupRoot>/<agent>/<ts>/（P1-4 修复：保留相对结构防同名覆盖）
 *
 * v0.1.1 语义：任一「已存在」目标备份失败 → 整体 ok:false（install 必须 ABORT）。
 * 返回 entries[{src,dst}] 精确映射，rollback 只使用这些 dst。
 */
export async function backupPaths(agent: string, paths: string[], opts: { home?: string } = {}): Promise<BackupResult> {
  const root = backupRoot(opts.home);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dstDir = join(root, agent, ts);
  const transactionId = `${ts}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const entries: BackupResult['entries'] = [];
  try {
    await mkdir(dstDir, { recursive: true });
    for (const p of paths) {
      try {
        const st = await stat(p);
        // 相对唯一名（防同名覆盖，与 relPath 一致）
        const rel = relPath(p);
        const dst = join(dstDir, rel);
        if (st.isDirectory()) {
          await cp(p, dst, { recursive: true });
        } else {
          await mkdir(dirname(dst), { recursive: true });
          await copyFile(p, dst);
        }
        entries.push({ src: p, dst });
      } catch (e) {
        // 已存在但备份失败 → 整体失败（安全优先，禁止 best-effort）
        return { ok: false, backupRoot: root, agent, entries, transactionId, error: `backup failed for ${p}: ${(e as Error).message}` };
      }
    }
    return { ok: true, backupRoot: root, agent, entries, transactionId };
  } catch (e) {
    return { ok: false, backupRoot: root, agent, entries, transactionId, error: (e as Error).message };
  }
}

/** 列出某 agent 的历史备份（报告用） */
export async function listBackups(agent: string, opts: { home?: string } = {}): Promise<string[]> {
  const root = join(backupRoot(opts.home), agent);
  try {
    return (await readdir(root)).sort().reverse();
  } catch {
    return [];
  }
}