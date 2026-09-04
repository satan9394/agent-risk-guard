/**
 * installer/compatibility.ts — 兼容性单一事实源（D0–D4 等级）
 *
 * 读取 packages/installer/compatibility.json，作为所有 Agent 支持等级的权威来源。
 * README 支持矩阵、CLI `status`、`doctor` 均以本模块为准，禁止在别处维护第二套事实。
 * 等级语义：D0=Unsupported  D1=Implementation exists  D2=Automated test verified
 *           D3=Real agent execution verified  D4=Repeated / production verified
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type VerificationLevel = 'D0' | 'D1' | 'D2' | 'D3' | 'D4';
export type Enforcement = 'hard' | 'soft' | 'mixed' | 'none';

export interface AgentCompatibility {
  display: string;
  integration: string;
  enforcement: Enforcement;
  verification: Record<string, VerificationLevel>;
  notes?: string;
}

export interface CompatibilitySchema {
  schemaVersion: string;
  productVersion: string;
  levels: Record<VerificationLevel, string>;
  agents: Record<string, AgentCompatibility>;
}

const COMPAT_PATH = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'compatibility.json');

/** 从磁盘加载兼容性表（单一事实源） */
export function loadCompatibility(): CompatibilitySchema {
  const raw = readFileSync(COMPAT_PATH, 'utf8');
  return JSON.parse(raw) as CompatibilitySchema;
}

/** 判定某平台是否达到至少某等级（如 D3） */
export function levelAtLeast(actual: VerificationLevel | undefined, min: VerificationLevel): boolean {
  const order: VerificationLevel[] = ['D0', 'D1', 'D2', 'D3', 'D4'];
  const a = actual ? order.indexOf(actual) : 0;
  const m = order.indexOf(min);
  return a >= m;
}

/** 取某 agent 在某平台的支持状态文本（用于 README / status 展示） */
export function describeAgent(agent: string, platform: string): { level: VerificationLevel; enforcement: Enforcement } {
  const compat = loadCompatibility();
  const src = compat.agents[agent];
  if (!src) return { level: 'D0', enforcement: 'none' };
  const level = src.verification[platform] ?? 'D1';
  return { level, enforcement: src.enforcement };
}