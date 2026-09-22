/**
 * installer/merge.ts — 非破坏性配置 merge（纯函数，可单测）
 *
 * 铁律：只「加入」RiskGuard 自己的注入，绝不 replace 用户已有字段。
 * - Claude settings.json：追加 PreToolUse hook 到已有 hooks.PreToolUse（保留 Setup/其他字段/权限）。
 * - Codex hooks.json：追加 PreToolUse Bash 条目到已有 hooks.PreToolUse。
 * - OpenCode opencode.json：把 RiskGuard 插件加入已有 plugin 数组（不覆盖已有插件）。
 * 每条注入都带 `_riskguard: true` 标记或可精确识别的 id，供 uninstall 精确移除。
 *
 * merge 失败/幂等：若对应注入已存在（按 marker/id 精确判定），返回未改动（幂等）。
 *
 * OpenCode 双形态（2026-09-22）：
 *   - V1（`plugin` 数组）：插件必须显式登记，值为 `./plugins/agent-risk-guard.ts`。
 *   - V2（`plugins` 数组）：`.ts` 文件路径**不再可登记**（会报 "must be a directory"）；
 *     V2 会自动发现 `~/.config/opencode/plugins/*.ts`，因此不再写配置，只清理 V1 遗留引用。
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** 每个 agent 注入的标识符（README/status/uninstall 共用） */
export const CLAUDE_HOOK_ID = 'riskguard-pre-tool-hook';
export const CODEX_HOOK_ID = 'riskguard-codex-hook';
/** OpenCode 插件 namespace（v0.1.0 整改 P0-3：不再用通用名，避免覆盖用户同名文件） */
export const OPENCODE_PLUGIN_ID = 'agent-risk-guard';
/** 旧插件名（1.0.0 时代部署）；识别用兼容，不再作为新部署名 */
export const OPENCODE_PLUGIN_LEGACY_ID = 'destructive-operation-guard';

export interface MergeResult<T> {
  config: T;        // merge 后的配置
  changed: boolean; // 是否发生了改动（幂等时 false）
}

/** 判定 Claude hook 对象是否被我方注入（按 matcher + id marker） */
function isClaudeRiskGuardHook(h: unknown): boolean {
  if (typeof h !== 'object' || h === null) return false;
  const obj = h as Record<string, unknown>;
  return obj['_riskguard'] === true || obj['id'] === CLAUDE_HOOK_ID;
}

/** Claude Code settings.json merge：追加 PreToolUse hook（保留用户全部字段与既有 hook） */
export function mergeClaudeSettings(
  existing: Record<string, unknown> | null | undefined,
  hookEntry: unknown,
): MergeResult<Record<string, unknown>> {
  const cfg = existing && typeof existing === 'object' && !Array.isArray(existing)
    ? { ...existing }
    : {};
  const hooks = (cfg['hooks'] ?? {}) as Record<string, unknown>;
  const pretool = Array.isArray(hooks['PreToolUse']) ? [...hooks['PreToolUse']] : hooks['PreToolUse'] !== undefined && typeof hooks['PreToolUse'] === 'object' && hooks['PreToolUse'] !== null
    ? [hooks['PreToolUse']]
    : [];
  if (pretool.some(isClaudeRiskGuardHook)) return { config: cfg, changed: false };
  pretool.push(hookEntry);
  return { config: { ...cfg, hooks: { ...hooks, PreToolUse: pretool } }, changed: true };
}

/** Codex hooks.json PreToolUse Bash 条目是否已存在（按 id marker） */
function isCodexRiskGuardEntry(h: unknown): boolean {
  if (typeof h !== 'object' || h === null) return false;
  const obj = h as Record<string, unknown>;
  return obj['_riskguard'] === true || obj['id'] === CODEX_HOOK_ID;
}

/** Codex hooks.json merge：追加 PreToolUse Bash 条目 */
export function mergeCodexHooks(
  existing: Record<string, unknown> | null | undefined,
  entry: unknown,
): MergeResult<Record<string, unknown>> {
  const cfg = existing && typeof existing === 'object' && !Array.isArray(existing)
    ? { ...existing }
    : {};
  const hooks = (cfg['hooks'] ?? {}) as Record<string, unknown>;
  const pretool = Array.isArray(hooks['PreToolUse']) ? [...hooks['PreToolUse']] : [];
  if (pretool.some(isCodexRiskGuardEntry)) return { config: cfg, changed: false };
  pretool.push(entry);
  return { config: { ...cfg, hooks: { ...hooks, PreToolUse: pretool } }, changed: true };
}

/** 判断 plugin 引用是否命中 RiskGuard（精确匹配 basename：agent-risk-guard 或旧名 destructive-operation-guard） */
export function isRiskGuardPluginRef(p: unknown, pluginPath?: string): boolean {
  const s = String(p ?? '').replace(/\\/g, '/').trim();
  // 取路径最后一段文件名（去 .ts/.js 后缀）
  const base = s.split('/').pop() ?? '';
  const name = base.replace(/\.(ts|js|mjs|cjs)$/i, '');
  if (name === OPENCODE_PLUGIN_ID || name === OPENCODE_PLUGIN_LEGACY_ID) return true;
  if (pluginPath && s === String(pluginPath).replace(/\\/g, '/')) return true;
  return false;
}

/** OpenCode 配置形态：V1 用 `plugin`，V2 用 `plugins`（V2 的本地插件改为目录自动发现）。 */
export type OpencodeConfigMode = 'v1' | 'v2';

/**
 * 判定 opencode.json 属于 V1 还是 V2 形态。
 *
 * 顺序：配置已用的键优先（`plugins` → V2，`plugin` → V1）；两者都没有时，
 * 用 `cli.json`（V2 首次启动会写、V1 不写）作旁证；仍无线索则退回 V1（向后兼容）。
 */
export function detectOpencodeConfigMode(
  cfg: Record<string, unknown> | null | undefined,
  home?: string,
): OpencodeConfigMode {
  if (cfg && typeof cfg === 'object') {
    if (Array.isArray(cfg['plugins'])) return 'v2';
    if (Array.isArray(cfg['plugin'])) return 'v1';
  }
  if (home && existsSync(join(home, '.config', 'opencode', 'cli.json'))) return 'v2';
  return 'v1';
}

/** 在 opencode.json 中查找 RiskGuard 插件引用（V1 `plugin` 与 V2 `plugins` 都查）。 */
export function findOpencodeRiskGuardRef(
  cfg: Record<string, unknown> | null | undefined,
  pluginPath?: string,
): { found: boolean; key: 'plugin' | 'plugins' | null } {
  if (!cfg || typeof cfg !== 'object') return { found: false, key: null };
  for (const key of ['plugin', 'plugins'] as const) {
    const list = cfg[key];
    if (Array.isArray(list) && list.some((p) => isRiskGuardPluginRef(p, pluginPath))) {
      return { found: true, key };
    }
  }
  return { found: false, key: null };
}

/**
 * OpenCode opencode.json merge。
 *
 * - V1：把 RiskGuard 插件加入 `plugin` 数组（保留已有插件；旧名引用视为已装，不重复注入）。
 * - V2：**不写配置**（V2 自动发现 `~/.config/opencode/plugins/*.ts`），只把 V1 时代遗留的
 *   文件路径引用从 `plugin` / `plugins` 里清掉，避免 V2 报 "configured plugin path must be a directory"。
 */
export function mergeOpencodePlugins(
  existing: Record<string, unknown> | null | undefined,
  pluginPath: string,
  opts: { mode?: OpencodeConfigMode; home?: string } = {},
): MergeResult<Record<string, unknown>> {
  const cfg = existing && typeof existing === 'object' && !Array.isArray(existing)
    ? { ...existing }
    : {};
  const mode = opts.mode ?? detectOpencodeConfigMode(cfg, opts.home);

  if (mode === 'v2') {
    let changed = false;
    const next: Record<string, unknown> = { ...cfg };
    for (const key of ['plugin', 'plugins'] as const) {
      const list = next[key];
      if (!Array.isArray(list)) continue;
      const kept = list.filter((p) => !isRiskGuardPluginRef(p, pluginPath));
      if (kept.length === list.length) continue;
      changed = true;
      if (kept.length) next[key] = kept;
      else delete next[key];
    }
    return { config: changed ? next : cfg, changed };
  }

  const plugins = Array.isArray(cfg['plugin']) ? [...cfg['plugin']] : [];
  if (plugins.some((p) => isRiskGuardPluginRef(p, pluginPath))) return { config: cfg, changed: false };
  plugins.push(pluginPath);
  return { config: { ...cfg, plugin: plugins }, changed: true };
}