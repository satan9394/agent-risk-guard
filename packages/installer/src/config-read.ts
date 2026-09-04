/**
 * installer/config-read.ts — 类型化配置读取（v0.1.0 整改 P0-2）
 *
 * 铁律：任何无法确定原配置内容的情况下，都禁止写入。
 *
 * 旧的 safeRead() 把「文件不存在 / JSON 损坏 / 权限不足 / IO 错误」全部压成 null，
 * 调用方无法区分，可能 null → {} → merge → write 覆盖用户损坏配置。
 * 本模块把读取结果建模为可区分联合，由调用方按状态决定 install 行为：
 *
 *   missing           → 可以创建
 *   valid             → backup → merge
 *   invalid-json      → 立即终止
 *   permission-denied → 立即终止
 *   io-error          → 立即终止
 */

import { readFile } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { statSync } from 'node:fs';

export type ConfigReadResult =
  | { state: 'missing' }
  | { state: 'valid'; data: Record<string, unknown> }
  | { state: 'invalid-json'; error: string }
  | { state: 'permission-denied'; error: string }
  | { state: 'io-error'; error: string };

export function isWritableState(r: ConfigReadResult): boolean {
  return r.state === 'missing' || r.state === 'valid';
}

/** 尝试读取并解析 JSON 配置文件；按错误类型精确归类 */
export async function readConfig(p: string): Promise<ConfigReadResult> {
  // 1. 文件不存在 → missing（stat 失败要区分 ENOENT 与其他）
  let st: Stats;
  try {
    st = statSync(p);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { state: 'missing' };
    if (code === 'EACCES' || code === 'EPERM') return { state: 'permission-denied', error: (e as Error).message };
    return { state: 'io-error', error: (e as Error).message };
  }
  // 2. 目录误当文件
  if (st.isDirectory()) return { state: 'io-error', error: `${p} is a directory, expected a file` };

  // 3. 读文件
  let raw: string;
  try {
    raw = await readFile(p, 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') return { state: 'permission-denied', error: (e as Error).message };
    return { state: 'io-error', error: (e as Error).message };
  }

  // 4. 空文件 / 纯空白 → 视为无配置（等同 missing，可安全创建）
  if (raw.trim().length === 0) return { state: 'missing' };

  // 5. 解析 JSON
  try {
    const data = JSON.parse(raw) as unknown;
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return { state: 'invalid-json', error: 'JSON root must be an object' };
    }
    return { state: 'valid', data: data as Record<string, unknown> };
  } catch (e) {
    return { state: 'invalid-json', error: (e as Error).message };
  }
}

/** 人类可读的错误行（install 中断时打印） */
export function describeReadFailure(r: Extract<ConfigReadResult, { state: 'invalid-json' | 'permission-denied' | 'io-error' }>, path: string): string {
  switch (r.state) {
    case 'invalid-json':
      return `${path} contains invalid JSON.\n  Parse error: ${r.error}`;
    case 'permission-denied':
      return `${path} is not readable (permission denied).\n  ${r.error}`;
    case 'io-error':
      return `${path} could not be read (I/O error).\n  ${r.error}`;
  }
}
