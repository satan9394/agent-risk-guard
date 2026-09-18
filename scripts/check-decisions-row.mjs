/**
 * check-decisions-row.mjs — **代码变更必须同时更新 `docs/decisions.md`**。
 *
 * 为什么需要：`docs/decisions.md` 的规则写着「任何变更在合并那一刻就要在这里有一行」，
 * 但 `check-decisions-log.ts` 只校验 A 表（已发布版本）——**管不到未发布的切片**。
 * 结果是规则写了一半、机器只盯另一半：PR #4 就是这么漏掉的。
 * 本检查把另一半补上。
 *
 * 判据：本 PR 若改动了**代码路径**，则 `docs/decisions.md` 必须同时被改动。
 *
 * 范围说明（故意如此）：
 *   · 只盯代码（packages / scripts / bin / assets / skills / tests）——用户要的是「代码变更
 *     要记录谁提的、何时裁决」。纯文档改动（README、docs/、.github/）不强制记账，
 *     否则改一个错字也要加一行，规则会被绕过而不是被遵守。
 *   · 依赖升级类 PR（Dependabot 只动 .github/ 与 package*.json）天然落在代码路径之外，
 *     不需要单独记账；它们会在发版时并入该版本的记录。
 *
 * 用法：BASE_REF=main node scripts/check-decisions-row.mjs
 */

import { execSync } from 'node:child_process';

const BASE_REF = process.env.BASE_REF || 'main';
const LEDGER = 'docs/decisions.md';
const CODE_PREFIXES = ['packages/', 'scripts/', 'bin/', 'assets/', 'skills/', 'tests/'];

const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();

function changedFiles() {
  // 可注入：便于本地做变异测试与单测，无需真造分支
  if (process.env.CHANGED_FILES) {
    const list = process.env.CHANGED_FILES.split(',').map((s) => s.trim()).filter(Boolean);
    console.log(`（CHANGED_FILES 注入，共 ${list.length} 个文件）`);
    return list;
  }
  for (const range of [`origin/${BASE_REF}...HEAD`, `${BASE_REF}...HEAD`, `origin/${BASE_REF}..HEAD`]) {
    try {
      const out = sh(`git diff --name-only ${range}`);
      if (out) return out.split('\n').filter(Boolean);
    } catch { /* 换下一个 range 再试 */ }
  }
  throw new Error(`无法计算与 ${BASE_REF} 的差异（CI 里请确保 fetch-depth: 0）`);
}

const changed = changedFiles();
const code = changed.filter((f) => CODE_PREFIXES.some((p) => f.startsWith(p)));
const touchedLedger = changed.includes(LEDGER);

console.log(`base = ${BASE_REF}`);
console.log(`变更文件 ${changed.length} 个，其中代码 ${code.length} 个`);
if (code.length) console.log(`代码文件：${code.slice(0, 12).join(', ')}${code.length > 12 ? ` …(+${code.length - 12})` : ''}`);

if (code.length === 0) {
  console.log(`OK: 本次改动不含代码路径，无需在 ${LEDGER} 记账。`);
  process.exit(0);
}

if (!touchedLedger) {
  console.error(`\nFAIL: 本 PR 改动了代码，但没有更新 ${LEDGER}。`);
  console.error('规则见 docs/decisions.md 顶部：任何变更在合并那一刻就要有一行，');
  console.error('写明 日期 / 贡献者 / 改了什么 / 裁决 / 依据 / 落在哪个版本。');
  console.error('被拒绝的变更同样要记 —— "哪些想法被否决过、为什么"和"哪些被采纳"一样有价值。');
  process.exit(1);
}

console.log(`OK: 代码变更同时更新了 ${LEDGER}。`);
