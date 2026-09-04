/**
 * installer/hash.ts — SHA256 工具（v0.1.0 整改 P0-3 / P1-3）
 *
 * 用于：
 *  - OpenCode 插件安装前：目标文件 hash == 我方 artifact hash 才允许幂等跳过，否则拒绝（防覆盖未知文件）。
 *  - manifest 记录 artifacts[{path, sha256}]，卸载前校验「现在同名文件还是不是我方安装的那份」。
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export async function sha256File(p: string): Promise<string | null> {
  try {
    const buf = await readFile(p);
    return createHash('sha256').update(buf).digest('hex');
  } catch {
    return null;
  }
}

export function sha256Text(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}
