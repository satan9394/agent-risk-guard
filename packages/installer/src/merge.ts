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
 */

/** 每个 agent 注入的标识符（README/status/uninstall 共用） */
export const CLAUDE_HOOK_ID = 'riskguard-pre-tool-hook';
export const CODEX_HOOK_ID = 'riskguard-codex-hook';
export const OPENCODE_PLUGIN_ID = 'destructive-operation-guard';

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

/** OpenCode opencode.json merge：把 RiskGuard 插件加入 plugin 数组（保留已有插件） */
export function mergeOpencodePlugins(
  existing: Record<string, unknown> | null | undefined,
  pluginPath: string,
): MergeResult<Record<string, unknown>> {
  const cfg = existing && typeof existing === 'object' && !Array.isArray(existing)
    ? { ...existing }
    : {};
  const plugins = Array.isArray(cfg['plugin']) ? [...cfg['plugin']] : [];
  const norm = (p: unknown): string => String(p ?? '').replace(/\\/g, '/');
  const already = plugins.some((p) => norm(p).includes(OPENCODE_PLUGIN_ID) || norm(p).includes(norm(pluginPath)));
  if (already) return { config: cfg, changed: false };
  plugins.push(pluginPath);
  return { config: { ...cfg, plugin: plugins }, changed: true };
}