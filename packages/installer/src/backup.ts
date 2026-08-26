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
  entries: { src: string; dst: string }[];
  error?: string;
}

export function backupRoot(home?: string): string {
  return join(home ?? process.env.USERPROFILE ?? process.env.HOME ?? '.', '.risk-guard-backup');
}

/** 路径 → 备份内相对唯一名（盘符_路径各段，防同名覆盖；rollback 用同函数还原匹配） */
export function relPath(p: string): string {
  return p.replace(/^([A-Za-z]):/, '$1_').replace(/[\\/]+/g, '_').replace(/^[._]+/, '');
}

function ts(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/** 备份一组文件/目录 → <backupRoot>/<agent>/<ts>/（P1-4 修复：保留相对结构防同名覆盖） */
export async function backupPaths(agent: string, paths: string[], opts: { home?: string } = {}): Promise<BackupResult> {
  const root = backupRoot(opts.home);
  const dstDir = join(root, agent, ts());
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
        // 单个文件失败不中断整体（可能已移动/不存在）
      }
    }
    return { ok: true, backupRoot: root, agent, entries };
  } catch (e) {
    return { ok: false, backupRoot: root, agent, entries, error: (e as Error).message };
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