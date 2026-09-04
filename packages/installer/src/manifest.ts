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

import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export interface ManifestArtifact {
  path: string;   // 部署到用户目录的文件（绝对路径）
  sha256: string; // 安装时该文件内容的 SHA256（卸载前校验是否仍是我方文件）
  /** 该文件是否由本次 install 创建（true）还是仅引用既有文件（false） */
  createdByInstall?: boolean;
}

export interface RuntimeVerificationRecord {
  verifiedAt: string; // ISO
  result: 'PASS' | 'FAIL';
  detail?: string;
}

export interface AgentManifest {
  /** manifest schema：2 = v0.1.1+（含 transactionId / createdByInstall / runtimeVerification）；缺省/1 = 旧 */
  schemaVersion?: number;
  product: string;          // 'riskguard'
  version: string;          // 产品版本（0.1.1）
  agent: string;            // 'claude-code' | 'opencode' | 'codex' | ...
  /** v0.1.1+：install 事务 id（rollback 只使用本事务 backup） */
  transactionId?: string;
  installedAt: string;      // ISO timestamp
  installedFiles: string[]; // 部署到用户目录的文件（绝对路径；兼容旧 manifest）
  modifiedConfig: string[]; // 被修改的配置文件（绝对路径）
  riskguardEntryId: string; // 注入条目的标识符（hook id / plugin id / marker）
  backupDir: string;        // 写入前备份目录（绝对路径）
  /** 安装物逐文件 hash（v0.1.0 起写入） */
  artifacts?: ManifestArtifact[];
  /** v0.1.1+：install 后的 runtime verification 记录 */
  runtimeVerification?: RuntimeVerificationRecord;
}

export function manifestDir(home?: string): string {
  const base = home ?? process.env.USERPROFILE ?? process.env.HOME ?? '.';
  return join(base, '.riskguard', 'manifests');
}

export function manifestPathFor(agent: string, home?: string): string {
  return join(manifestDir(home), `${agent}.json`);
}

/** 原子写：temp → rename，避免进程中断留下半个 JSON */
export async function saveManifest(m: AgentManifest, home?: string): Promise<void> {
  const p = manifestPathFor(m.agent, home);
  await mkdir(dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(m, null, 2), 'utf8');
  await rename(tmp, p);
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