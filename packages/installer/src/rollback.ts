/**
 * installer/rollback.ts — M6 回滚
 *
 * 将某个 agent 的最新备份恢复到位：先备份当前现场（现场也进回收站？不——
 * 现场是「正在工作的文件」，恢复语义是覆盖，因此先把现场 move 到回收站再拷贝备份回来）。
 * 铁律遵守：被替换的原文件进回收站，不硬删。
 */

import { cp, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { backupRoot, relPath } from './backup.ts';
import { trash } from '../../trash/src/index.ts';

export interface RollbackResult {
  ok: boolean;
  agent: string;
  restored: { src: string; dst: string }[];
  error?: string;
}

/** 用最新备份恢复 agent 的指定文件/目录（dst 为当前生产路径） */
export async function rollbackAgent(agent: string, dstPaths: string[], opts: { home?: string; backupTs?: string } = {}): Promise<RollbackResult> {
  const home = opts.home ?? process.env.USERPROFILE ?? process.env.HOME ?? '.';
  const agentRoot = join(backupRoot(home), agent);
  const tsList = opts.backupTs ? [opts.backupTs] : await listBackupTimestamps(agentRoot);
  if (tsList.length === 0) return { ok: false, agent, restored: [], error: `无备份：${agentRoot}` };
  const tsDir = join(agentRoot, tsList[0]);
  const restored: RollbackResult['restored'] = [];
  try {
    for (const dst of dstPaths) {
      const src = join(tsDir, relPath(dst));
      try {
        // P0-1 修复（audit 4.5）：回滚是覆盖语义，被替换的当前现场先进回收站（铁律：不硬删）
        const dstParent = dirname(dst);
        await mkdir(dstParent, { recursive: true });
        try { await trash(dst); } catch { /* 目标不存在/不可回收 → 静默继续 */ }
        await cp(src, dst, { recursive: true });
        restored.push({ src, dst });
      } catch { /* 备份中没有对应文件 */ }
    }
    return { ok: true, agent, restored };
  } catch (e) {
    return { ok: false, agent, restored, error: (e as Error).message };
  }
}

async function listBackupTimestamps(agentRoot: string): Promise<string[]> {
  try {
    const { readdir } = await import('node:fs/promises');
    return (await readdir(agentRoot)).sort().reverse();
  } catch { return []; }
}