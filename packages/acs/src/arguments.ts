/**
 * acs/arguments.ts — 官方 arguments value-wrapper 解析（v0.2.1 §三十三/§三十四/§三十五）
 *
 * 官方 tool-call-request.json 的每个参数都是包装对象：
 *   { "path": { "value": "/project/test", "provenance": { ... } } }
 *
 * 本模块统一 unwrap → 内部普通值，同时保留 argument-level provenance
 * 及其原始路径（argumentPath = /arguments/<key>，供未来 FIDES / data lineage）。
 *
 * 兼容性：v0.2.0 遗留 payload 使用裸值（"path": "/x"）。unwrap 容忍裸值
 * （直接当 value），但官方 schema 校验（Layer 2）仍会拒绝裸值——conformance
 * 判据始终是官方 schema，不是本模块的宽容度。
 */

import type { AcsArguments, AcsProvenance } from './types.ts';

export interface UnwrappedArgument {
  /** unwrap 后的普通值（wrapper.value 或裸值） */
  value: unknown;
  /** wrapper 内携带的官方 provenance（无则 undefined） */
  provenance?: AcsProvenance;
  /** 原始路径（§三十五），如 /arguments/command */
  argumentPath: string;
}

export interface UnwrappedAcsArguments {
  values: Record<string, unknown>;
  entries: Record<string, UnwrappedArgument>;
  /** 仅含带 provenance 的参数（§三十四：参数级 provenance 映射到 context.metadata.provenance） */
  provenance: Array<{ argumentPath: string; provenance: AcsProvenance }>;
}

function isWrapper(v: unknown): v is { value: unknown; provenance?: AcsProvenance } {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && 'value' in (v as Record<string, unknown>);
}

/**
 * 统一 unwrap 官方 arguments（§三十三）。
 * 容忍裸值（遗留 payload）；wrapper 形状优先取 .value 并保留 .provenance。
 */
export function unwrapAcsArguments(args: AcsArguments | Record<string, unknown> | undefined | null): UnwrappedAcsArguments {
  const out: UnwrappedAcsArguments = { values: {}, entries: {}, provenance: [] };
  if (args === null || args === undefined || typeof args !== 'object') return out;

  for (const [key, raw] of Object.entries(args)) {
    const argumentPath = `/arguments/${key}`; // §三十五：保留 provenance 原始路径
    if (isWrapper(raw)) {
      out.values[key] = raw.value;
      const entry: UnwrappedArgument = { value: raw.value, argumentPath };
      if (raw.provenance && typeof raw.provenance === 'object') {
        entry.provenance = raw.provenance;
        out.provenance.push({ argumentPath, provenance: raw.provenance });
      }
      out.entries[key] = entry;
    } else {
      // 遗留裸值：直接作为 value（Layer 2 官方 schema 会拒绝，见文件头注释）
      out.values[key] = raw;
      out.entries[key] = { value: raw, argumentPath };
    }
  }
  return out;
}

/** 便捷：只取 unwrap 后的普通值映射（{ path: "/x" }） */
export function unwrapAcsArgumentValues(args: AcsArguments | Record<string, unknown> | undefined | null): Record<string, unknown> {
  return unwrapAcsArguments(args).values;
}
