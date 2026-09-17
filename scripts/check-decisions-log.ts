/**
 * check-decisions-log.ts — 防漂移：`docs/decisions.md` 必须覆盖每一个已发布版本。
 *
 * 为什么需要它：一个手工维护的"决策账本"如果没有机器校验，一定会腐烂——这正是本项目
 * 反复强调的「文档声称 A、实际是 B」。所以本文件做和 `generate-agent-security-matrix.ts --check`
 * 同一件事：把"表是否还完整"变成 CI 上的一条硬判据。
 *
 * 判据（双向）：
 *   A. `docs/release-notes/v<X>.md` 里的每一个版本，在 decisions.md 的 A 表里都要有一行
 *   B. decisions.md 的 A 表里出现的每个版本，都要有对应的 release-notes 文件
 * 任一条不满足 → 退出码 1，并打印缺失项与修复方法。
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const NOTES_DIR = join(ROOT, 'docs', 'release-notes');
const DECISIONS = join(ROOT, 'docs', 'decisions.md');

const VERSION_RE = /^v\d+\.\d+\.\d+$/;

/** release-notes 目录里的版本（排除 README / TEMPLATE 等非版本文件） */
function versionsFromNotes(): string[] {
  return readdirSync(NOTES_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -3))
    .filter((v) => VERSION_RE.test(v))
    .sort();
}

/** decisions.md 里 A 表（已发布版本）出现的版本 */
function versionsFromDecisions(): string[] {
  const text = readFileSync(DECISIONS, 'utf8');
  const found = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;          // 只看表格行
    const m = line.match(/^\|\s*`(v\d+\.\d+\.\d+)`\s*\|/);
    if (m) found.add(m[1]);
  }
  return [...found].sort();
}

if (!existsSync(DECISIONS)) {
  console.error(`FAIL: 缺少 ${DECISIONS} —— 每个已发布版本都必须在决策账本里有一行。`);
  process.exit(1);
}

const inNotes = versionsFromNotes();
const inDecisions = versionsFromDecisions();
const setNotes = new Set(inNotes);
const setDec = new Set(inDecisions);

const missing = inNotes.filter((v) => !setDec.has(v));   // 有发行说明但账本漏记
const orphan = inDecisions.filter((v) => !setNotes.has(v)); // 账本记了但没有发行说明

console.log(`release-notes 版本: ${inNotes.join(', ') || '(none)'}`);
console.log(`decisions A 表版本: ${inDecisions.join(', ') || '(none)'}`);

let bad = false;
if (missing.length) {
  bad = true;
  for (const v of missing) {
    console.error(`FAIL: docs/decisions.md 的 A 表缺少 \`${v}\` —— 请在表里补一行（版本 / 日期 / 裁决 / 依据）。`);
  }
}
if (orphan.length) {
  bad = true;
  for (const v of orphan) {
    console.error(`FAIL: docs/decisions.md 记了 \`${v}\`，但 docs/release-notes/${v}.md 不存在。`);
  }
}

if (bad) {
  console.error('\n决策账本与发行说明不一致。规则见 docs/decisions.md 顶部。');
  process.exit(1);
}

console.log(`OK: decisions.md 覆盖全部 ${inNotes.length} 个已发布版本，且无多余条目。`);
