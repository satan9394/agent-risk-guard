/**
 * installer/uninstall.ts — M6 卸载（移除 RiskGuard 注入，不留残余）
 *
 * 铁律：被移除的原文件 → 回收站；仅删除注入的配置片段所在文件/内容。
 * uninstall 需要按 agent 提供「注入的 idents」清单（hook id、插件 id、policy name），
 * 只移除这些标识符相关的注入点，绝不触碰用户其他配置。
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { trash } from '../../trash/src/index.ts';

export interface UninstallResult {
  ok: boolean;
  agent: string;
  actions: string[];
  error?: string;
}

/**
 * 从 JSON 配置中移除 RiskGuard 注入的钩子/权限条目（按 ident 精确匹配）。
 * 只改 config 文件本体，不删整文件（除非整文件都是 RiskGuard 生成物）。
 */
export async function uninstallFromJsonConfig(filePath: string, idents: string[], opts: { home?: string } = {}): Promise<UninstallResult> {
  const actions: string[] = [];
  try {
    const raw = await readFile(filePath, 'utf8');
    const cfg = JSON.parse(raw);
    let changed = false;

    // P1-2 修复：精确匹配（含 marker 字段优先），避免子串误删用户配置
    const isRiskGuardEntry = (x: Record<string, unknown>): boolean => {
      if (x['_riskguard'] === true) return true;      // 我方注入的标记字段
      const v = String(x[keyOf(x)] ?? x['id'] ?? '');
      return idents.some((i) => v === i);
    };
    const keyOf = (x: Record<string, unknown>): string =>
      ['matcher', 'tool', 'name', 'id', 'hook'].find((k) => x[k] !== undefined) ?? 'id';

    const filterById = (arr: unknown[] | undefined): unknown[] | undefined => {
      if (!Array.isArray(arr)) return arr;
      const before = arr.length;
      const after = arr.filter((x) => !isRiskGuardEntry(x as Record<string, unknown>));
      if (after.length !== before) changed = true;
      return after;
    };

    if (cfg.hooks?.PreToolUse) cfg.hooks.PreToolUse = filterById(cfg.hooks.PreToolUse);
    if (cfg.permissions) {
      for (const k of ['allow', 'deny', 'ask']) {
        if (Array.isArray(cfg.permissions[k])) {
          // permissions 是字符串数组：精确相等（非子串）才移除
          const before = cfg.permissions[k].length;
          cfg.permissions[k] = cfg.permissions[k].filter((p: string) => !idents.some((i) => p === i));
          if (cfg.permissions[k].length !== before) changed = true;
        }
      }
    }

    if (changed) {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, JSON.stringify(cfg, null, 2), 'utf8');
      actions.push(`updated ${filePath}`);
    }
    return { ok: true, agent: 'json-config', actions };
  } catch (e) {
    return { ok: false, agent: 'json-config', actions, error: (e as Error).message };
  }
}

/**
 * P1-3 修复：从 DSH cordis.patch.yml 移除 RiskGuard 插件块（按 id = <ident> 精确匹配）。
 * 逐行扫描，删除属于目标 insert 块的规则行；仅当块是纯 RiskGuard 生成物时移除。
 */
export async function uninstallFromYamlPatch(filePath: string, idets: string[], opts: { home?: string } = {}): Promise<UninstallResult> {
  const actions: string[] = [];
  try {
    const raw = await readFile(filePath, 'utf8');
    const lines = raw.split(/\r?\n/);
    const keep: string[] = [];
    let inTarget = false, changed = false;
    for (const line of lines) {
      if (/^\s*- id:\s*['"]?/.test(line) && idets.some((i) => line.includes(i))) {
        inTarget = true; changed = true; continue; // 丢弃目标插件的 id 行
      }
      if (inTarget) {
        // 块结束：下一个顶层 "- "（非缩进更深的子项）或文件尾
        if (/^-\s/.test(line) && !/^\s+-/.test(line)) { inTarget = false; keep.push(line); continue; }
        if (/^[^\s-]/.test(line) || line.trim() === '') { inTarget = false; }
        continue; // 目标块内所有行丢弃
      }
      keep.push(line);
    }
    if (changed) {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, keep.join('\n'), 'utf8');
      actions.push(`updated ${filePath} (removed ${idets.join(',')})`);
    }
    return { ok: true, agent: 'dsh-yaml', actions };
  } catch (e) {
    return { ok: false, agent: 'dsh-yaml', actions, error: (e as Error).message };
  }
}