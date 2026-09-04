/**
 * core/version.ts — 产品版本单一事实源（v0.1.1）
 *
 * package.json 的 version 字段是唯一权威；CLI / manifest / compatibility 等
 * 一律从这里读取，禁止在多处硬编码 const VERSION = '0.1.x'。
 *
 * 运行时读取 package.json（零依赖、无构建；Node ≥ 22.18 原生 ESM+type-stripping）。
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT: string = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url)); // packages/core/src
    return dirname(dirname(dirname(here)));                // repo root
  } catch {
    return process.cwd();
  }
})();

/** 产品版本（如 '0.1.1'）；读失败给兜底 '0.0.0' 但会暴露读取问题 */
export const PRODUCT_VERSION: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

/** 展示名（如 'v0.1.1 Developer Preview'） */
export function productLabel(): string {
  return `v${PRODUCT_VERSION} Developer Preview`;
}

/** CLI version 输出文本 */
export function cliVersionLine(): string {
  return `RiskGuard ${PRODUCT_VERSION} (Developer Preview)`;
}
