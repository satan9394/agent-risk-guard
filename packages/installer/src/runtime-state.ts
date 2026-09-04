/**
 * installer/runtime-state.ts — Runtime State（某台机器当前实际状态）判定
 *
 * 概念分离（v0.1.0 整改 P0-1）：
 *  - Capability（compatibility.json）：RiskGuard 对该 Agent 理论/实测支持到哪一级（D0–D4）。
 *  - Runtime State（本模块）：当前这台机器上 RiskGuard 是否真的装好并工作。
 *
 * 状态机：
 *   NOT_DETECTED — Agent 本身不存在
 *   DETECTED     — Agent 存在，但无 RiskGuard manifest / 接线
 *   INSTALLED    — 存在 manifest 与配置（已装，未进一步验证接线是否健全）
 *   ACTIVE       — manifest + hook/plugin 存在 + doctor 关键检查通过（真的在拦截）
 *   BROKEN       — manifest 存在但 hook/plugin 缺失/损坏（人为删过 / 半装 / 升级失败）
 *
 * 铁律：不能因为 compatibility != D0 就说 ACTIVE。
 */

import { statSync } from 'node:fs';
import { join } from 'node:path';
import { manifestPathFor } from './manifest.ts';

export type RuntimeState = 'NOT_DETECTED' | 'DETECTED' | 'INSTALLED' | 'ACTIVE' | 'BROKEN';

/** Agent 探测结果抽象（避免直接依赖 discovery，便于测试） */
export interface RuntimeProbe {
  /** Agent 是否安装（配置目录/二进制存在） */
  detected: boolean;
  /** 该 Agent 的 wiring 是否在位（如 settings.json 内含 RiskGuard hook / plugin 引用） */
  wired: boolean;
  /** wiring 是否健全（doctor 关键检查通过） */
  healthy: boolean;
}

export function hasManifestFile(agent: string, home?: string): boolean {
  try {
    statSync(manifestPathFor(agent, home));
    return true;
  } catch {
    return false;
  }
}

/**
 * 判定某 Agent 的 runtime state。
 * @param agent   canonical id（claude-code / opencode / codex / dsh …）
 * @param probe   探测结果（由调用方组合 discovery + wiring + doctor）
 * @param home    用户主目录
 * @param opts.manifestManaged  该 Agent 是否由 RiskGuard manifest 管理。
 *       默认 true（claude-code/opencode/codex）。dsh 的 wiring（deny-risk-commands patch）
 *       不是由本 CLI 安装/卸载的，无 manifest → 应靠 probe.healthy 判定 ACTIVE。
 */
export function runtimeState(
  agent: string,
  probe: RuntimeProbe,
  home?: string,
  opts: { manifestManaged?: boolean } = {},
): RuntimeState {
  if (!probe.detected) return 'NOT_DETECTED';
  const manifestManaged = opts.manifestManaged !== false;
  const manifest = manifestManaged && hasManifestFile(agent, home);

  if (manifestManaged) {
    if (!manifest) {
      // 无 manifest：即便 wiring 在（用户手动装过/残留）也算未受管 → DETECTED
      return 'DETECTED';
    }
    // 有 manifest
    if (probe.healthy) return 'ACTIVE';
    if (probe.wired) return 'INSTALLED'; // manifest+接线在，但 doctor 关键项未过（如 parse 不了）
    return 'BROKEN';                      // manifest 在但接线丢了/损坏
  }

  // 非 manifest 管理（dsh）：healthy=接线健全 → ACTIVE；wired 但未验证 → DETECTED
  if (probe.healthy) return 'ACTIVE';
  if (probe.wired) return 'DETECTED';
  return 'DETECTED';
}

/** 供 CLI 展示的稳定文本（含中英，便于 README/测试对照） */
export function stateLabel(s: RuntimeState): string {
  switch (s) {
    case 'NOT_DETECTED': return 'NOT_DETECTED (未检测到 Agent)';
    case 'DETECTED': return 'DETECTED (Agent 存在，RiskGuard 未安装)';
    case 'INSTALLED': return 'INSTALLED (已安装，待确认接线健全)';
    case 'ACTIVE': return 'ACTIVE (接线健全，正在拦截)';
    case 'BROKEN': return 'BROKEN (manifest 存在但接线缺失/损坏)';
  }
}
