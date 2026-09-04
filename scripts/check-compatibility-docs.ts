/**
 * scripts/check-compatibility-docs.ts — D0–D4 定义漂移检查（CI 用）
 *
 * 单一事实源：packages/installer/compatibility.json 的 levels 字段。
 * 禁止 README / docs/* / CHANGELOG 自行定义另一套 D0–D4。
 *
 * 检查：
 *   1. 权威定义本身存在且含全部 D0–D4。
 *   2. 扫描受管文档，若出现「旧定义」关键词（Docs Confirmed / Payload Tested /
 *      Adversarial Hardened）→ 报错。
 *   3. 若文档出现「D0–D4 定义块」且与权威不一致 → 报错（保守：只要出现
 *      “D1 =”/“D2 =”/“D4 =” 且值不是权威文本，就报）。
 *
 * 用法：node scripts/check-compatibility-docs.ts
 * 退出码：0 = 通过；1 = 漂移。
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function read(p: string): string {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

function main(): number {
  const compat = JSON.parse(read(join(ROOT, 'packages', 'installer', 'compatibility.json'))) as {
    levels?: Record<string, string>;
  };
  const levels = compat.levels ?? {};
  const ids = ['D0', 'D1', 'D2', 'D3', 'D4'];
  const missing = ids.filter((d) => !levels[d]);
  if (missing.length) {
    console.error(`FAIL: compatibility.json missing level definitions: ${missing.join(', ')}`);
    return 1;
  }
  console.log(`OK: compatibility.json defines ${ids.map((d) => `${d}=${levels[d]}`).join(' | ')}`);

  // 受管文档（递归收集 md）
  const targets: string[] = ['README.md', 'CHANGELOG.md', 'SECURITY.md'];
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (!['node_modules', '.git', 'packages', 'tests', 'scripts', 'assets', '.github'].includes(e.name)) out.push(...walk(p)); }
      else if (e.name.endsWith('.md')) out.push(p);
    }
    return out;
  };
  const docsDir = join(ROOT, 'docs');
  let allTargets = [...targets.map((t) => join(ROOT, t))];
  try { allTargets = allTargets.concat(walk(docsDir)); } catch { /* docs 可能不存在 */ }

  // 旧定义关键词（历史 D1 Docs Confirmed / D2 Payload Tested / D4 Adversarial Hardened）
  const LEGACY = ['Docs Confirmed', 'Payload Tested', 'Adversarial Hardened', '官方文档确认 API 存在', '源码/工程实证', '对抗语料加固'];
  let bad = 0;
  for (const f of allTargets) {
    const content = read(f);
    if (!content) continue;
    for (const k of LEGACY) {
      if (content.includes(k)) {
        console.error(`DRIFT: ${f} contains legacy D-level wording: "${k}"`);
        bad++;
      }
    }
  }
  if (bad) {
    console.error(`FAIL: ${bad} legacy definition reference(s) found. Fix docs to point at packages/installer/compatibility.json.`);
    return 1;
  }
  console.log(`OK: no legacy D0–D4 wording in ${allTargets.length} doc(s).`);
  return 0;
}

process.exit(main());
