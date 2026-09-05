/**
 * scripts/verify-acs-schema-snapshot.ts — ACS vendor schema 快照完整性校验（v0.2.1 §五十四/§五十六）
 *
 * 检查 tests/vendor/owasp-acs-v0.1.0/：
 *   1. 文件数量与清单齐全
 *   2. 每个文件 SHA-256 与 SCHEMA_SHA256SUMS 一致（防止“为了让测试通过而改官方 schema”）
 *   3. README 中的 pinned upstream commit 元数据一致
 *
 * 用法：node scripts/verify-acs-schema-snapshot.ts
 * 退出码：0 = 通过；1 = 失败（CI 中作为普通校验步骤，§五十四）
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SNAPSHOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'vendor', 'owasp-acs-v0.1.0');
const PINNED_COMMIT = 'f46d260d22fe6d6ad71e4d979be7e25d063c468e';
const EXPECTED_FILES = [
  'request-envelope.json',
  'response-envelope.json',
  'hooks/tool-call-request.json',
  'modifications.json',
  'ask-details.json',
  'defer-details.json',
  'provenance.json',
];

export interface SnapshotReport {
  ok: boolean;
  dir: string;
  pinnedCommit: string;
  checked: number;
  problems: string[];
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function verifyAcsSchemaSnapshot(dir: string = SNAPSHOT_DIR): SnapshotReport {
  const problems: string[] = [];
  const checked: string[] = [];

  // 1. 清单齐全
  for (const rel of EXPECTED_FILES) {
    if (!existsSync(join(dir, rel))) {
      problems.push(`missing schema file: ${rel}`);
    }
  }

  // 2. 无多余文件（除 README.md / SCHEMA_SHA256SUMS 之外必须恰好是清单）
  const all: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else all.push(relative(dir, p).replace(/\\/g, '/'));
    }
  };
  if (existsSync(dir)) walk(dir);
  const allowed = new Set([...EXPECTED_FILES, 'README.md', 'SCHEMA_SHA256SUMS']);
  for (const rel of all) {
    if (!allowed.has(rel)) problems.push(`unexpected file in snapshot dir: ${rel}`);
  }

  // 3. SHA-256 与 SCHEMA_SHA256SUMS 一致
  const sumsPath = join(dir, 'SCHEMA_SHA256SUMS');
  if (!existsSync(sumsPath)) {
    problems.push('missing SCHEMA_SHA256SUMS');
  } else {
    const sums = new Map<string, string>();
    for (const line of readFileSync(sumsPath, 'utf8').split(/\r?\n/)) {
      const m = line.trim().match(/^([0-9a-f]{64})\s+(.+)$/);
      if (m) sums.set(m[2]!, m[1]!);
    }
    for (const rel of EXPECTED_FILES) {
      const p = join(dir, rel);
      if (!existsSync(p)) continue;
      const actual = sha256File(p);
      const expected = sums.get(rel);
      if (!expected) {
        problems.push(`no checksum entry for ${rel}`);
      } else if (actual !== expected) {
        problems.push(`SHA-256 mismatch for ${rel}: expected ${expected}, got ${actual}`);
      } else {
        checked.push(rel);
      }
    }
  }

  // 4. README pinned commit 元数据
  const readmePath = join(dir, 'README.md');
  if (!existsSync(readmePath)) {
    problems.push('missing README.md (upstream provenance record, §二十五)');
  } else {
    const readme = readFileSync(readmePath, 'utf8');
    if (!readme.includes(PINNED_COMMIT)) problems.push(`README.md missing pinned commit ${PINNED_COMMIT}`);
    if (!readme.includes('GenAI-Security-Project/agent-control-standard')) problems.push('README.md missing upstream repo');
    if (!readme.includes('Apache-2.0')) problems.push('README.md missing license record');
  }

  return { ok: problems.length === 0, dir, pinnedCommit: PINNED_COMMIT, checked: checked.length, problems };
}

// 直接运行（node scripts/verify-acs-schema-snapshot.ts）
const isDirectRun = process.argv[1] !== undefined && (() => {
  try {
    const a = process.argv[1]!.replace(/\\/g, '/');
    const b = fileURLToPath(import.meta.url).replace(/\\/g, '/');
    return a === b;
  } catch { return false; }
})();
if (isDirectRun) {
  const report = verifyAcsSchemaSnapshot();
  if (report.ok) {
    console.log(`ACS schema snapshot OK: ${report.checked}/${EXPECTED_FILES.length} files verified against pinned commit ${report.pinnedCommit}`);
    process.exit(0);
  }
  console.error(`ACS schema snapshot INVALID (pinned ${report.pinnedCommit}):`);
  for (const p of report.problems) console.error(`  - ${p}`);
  process.exit(1);
}
