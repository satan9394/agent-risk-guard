/**
 * path-resolver.ts — 路径规范化与保护判定（文档 T10 路径绕过）
 *
 * 所有 Path Policy 必须基于 canonical path，而不是原始字符串。
 * 纯函数实现：Node path 解析 + 字符串规范化（../、相对路径、大小写、UNC）。
 * 注：symlink/junction/hardlink 的真实解析依赖 fs.realpath，Core 保持纯函数——
 *     由 Adapter 在产生事件时通过 realpath 补充 canonical 字段。
 */

import * as nodePath from 'node:path';

export interface PathAnalysis {
  raw: string;
  canonical: string;   // 规范化后的绝对路径（未做 fs.realpath，字符串级）
  isAbsolute: boolean;
  normalized: string;  // 路径分隔符统一为平台默认并解析 ..
  parts: string[];
  lower?: string;      // 大小写不敏感平台用
}

/**
 * 规范化路径（纯字符串级）：
 * - 展开 ~/ 与 %USERPROFILE% / $HOME
 * - 解析 .. 与 .
 * - Windows 盘符统一大写，分隔符统一
 */
export function resolvePath(raw: string, cwd?: string, home?: string): PathAnalysis {
  const input = String(raw ?? '').trim();
  if (input.length === 0) throw new Error('empty path');

  let expanded = input;
  // 环境变量/家目录展开
  if (home) {
    expanded = expanded.replace(/^~([\\/])/, home + '$1').replace(/^~$/, home);
  }
  expanded = expanded
    .replace(/%USERPROFILE%/gi, home ?? '')
    .replace(/\$HOME/gi, home ?? '');

  const resolved = nodePath.resolve(cwd ?? process.cwd(), expanded);
  const normal = nodePath.normalize(resolved);

  // Windows: 盘符大写、分隔符统一反斜杠（windows 下 path 已用 \）
  let canonical = normal;
  if (/^[a-zA-Z]:/.test(canonical)) {
    canonical = canonical.charAt(0).toUpperCase() + canonical.slice(1);
  }

  const parts = canonical.split(/[\\/]+/).filter(Boolean);
  return {
    raw: input,
    canonical,
    isAbsolute: nodePath.isAbsolute(expanded),
    normalized: normal,
    parts,
    lower: process.platform === 'win32' ? canonical.toLowerCase() : undefined,
  };
}

/** 比较两条路径是否指向同一对象（大小写不敏感平台 lower 比较） */
export function pathsEqual(a: PathAnalysis, b: PathAnalysis): boolean {
  if (a.lower && b.lower) return a.lower === b.lower;
  return a.canonical === b.canonical;
}

/**
 * 判定 path 是否位于 protected root 之下（含自身）。
 * 基于 canonical；对 Windows 做 lower 比较。
 */
export function isWithin(analysis: PathAnalysis, protectedRoots: string[]): boolean {
  const cmp = analysis.lower ?? analysis.canonical;
  for (const root of protectedRoots) {
    const r = root.startsWith('~') ? root : root;
    const rLower = analysis.lower ? r.toLowerCase() : r;
    const rNorm = nodePath.normalize(rLower).replace(/[\\/]+$/, '');
    const cNorm = cmp.replace(/[\\/]+$/, '');
    if (cNorm === rNorm || cNorm.startsWith(rNorm + (analysis.lower ? '\\' : nodePath.sep))) {
      return true;
    }
  }
  return false;
}

/** workspace 范围判定（文档语义：相对工作区的路径） */
export function inWorkspace(analysis: PathAnalysis, workspaceRoot?: string): boolean {
  if (!workspaceRoot) return analysis.scope !== 'system';
  return isWithin(analysis, [workspaceRoot]);
}

/** 判断是否为明显越权逃逸路径（含 .. 穿越到 workspace 之外） */
export function isEscapeAttempt(raw: string): boolean {
  const parts = raw.split(/[\\/]+/);
  return parts.some((p) => p === '..');
}

/**
 * realpath 解析（M7 行为级：symlink/junction/hardlink 逃逸检测）。
 *
 * 字符串级 canonical 看不见符号链接目标——删除 `workspace/link`（指向 workspace 外
 * 的 junction）在字符串级判定为「workspace 内」，实际删除的是外部目录。
 * 本函数返回 fs.realpath 的真实物理路径，调用方据此做 T10 逃逸防护。
 *
 * 用法（Adapter 产生事件时）：
 *   const real = await resolveReal(targetRaw);
 *   if (real && !isWithin(real, [workspaceRoot])) → 逃逸，拒绝
 */
export async function resolveReal(raw: string, cwd?: string, home?: string): Promise<PathAnalysis | null> {
  const a = resolvePath(raw, cwd, home);
  try {
    const { realpath } = await import('node:fs/promises');
    const rp = await realpath(a.normalized);
    return resolvePath(rp, cwd, home);
  } catch {
    return null; // 路径不存在/不可达 → 无法解析（调用方决定 fail-closed）
  }
}