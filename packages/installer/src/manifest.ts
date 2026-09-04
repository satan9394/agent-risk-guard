/**
 * installer/manifest.ts — 安装记录（manifest）
 *
 * 记录 RiskGuard 对每个 agent 的实际改动，供 uninstall 精确恢复：
 *   - installedFiles：本仓库部署到用户目录的文件（hook 脚本、插件……）
 *   - modifiedConfig：被修改的配置路径
 *   - riskguardEntryId：注入条目的标识符（用于从配置中精确移除）
 *   - backupDir：写入前备份所在目录（用于 restore）
 *
 * 位置：~/.riskguard/manifests/<agent>.json
 * 铁律：uninstall 只依据 manifest 精确恢复，绝不触碰用户其他配置。
 */

import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export interface ManifestArtifact {
  path: string;   // 部署到用户目录的文件（绝对路径）
  sha256: string; // 安装时该文件内容的 SHA256（卸载前校验是否仍是我方文件）
}

export interface AgentManifest {
  /** manifest schema 版本；缺省视为 1（v0.1.0 前无 schemaVersion 字段的旧 manifest） */
  schemaVersion?: number;
  product: string;          // 'riskguard'
  version: string;          // '0.1.0'
  agent: string;            // 'claude-code' | 'opencode' | 'codex' | ...
  installedAt: string;      // ISO timestamp
  installedFiles: string[]; // 部署到用户目录的文件（绝对路径；兼容旧 manifest）
  modifiedConfig: string[]; // 被修改的配置文件（绝对路径）
  riskguardEntryId: string; // 注入条目的标识符（hook id / plugin id / marker）
  backupDir: string;        // 写入前备份目录（绝对路径）
  /** 安装物逐文件 hash（v0.1.0 起写入） */
  artifacts?: ManifestArtifact[];
}

export function manifestDir(home?: string): string {
  const base = home ?? process.env.USERPROFILE ?? process.env.HOME ?? '.';
  return join(base, '.riskguard', 'manifests');
}

export function manifestPathFor(agent: string, home?: string): string {
  return join(manifestDir(home), `${agent}.json`);
}

export async function saveManifest(m: AgentManifest, home?: string): Promise<void> {
  const p = manifestPathFor(m.agent, home);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(m, null, 2), 'utf8');
}

export async function loadManifest(agent: string, home?: string): Promise<AgentManifest | null> {
  try {
    const raw = await readFile(manifestPathFor(agent, home), 'utf8');
    return JSON.parse(raw) as AgentManifest;
  } catch {
    return null;
  }
}

export async function removeManifest(agent: string, home?: string): Promise<void> {
  try {
    await rm(manifestPathFor(agent, home), { force: true });
  } catch {
    /* ignore */
  }
}

export async function hasManifest(agent: string, home?: string): Promise<boolean> {
  return (await loadManifest(agent, home)) !== null;
}