/**
 * tests/acs-schema-conformance/snapshot-integrity.test.ts
 * — ACS vendor schema 快照完整性（v0.2.1 §五十四/§五十五/§五十六）
 *
 * CI 校验：vendor schema 必须与 SCHEMA_SHA256SUMS 一致、文件齐全、
 * pinned upstream commit 元数据一致。防止“为了让测试通过而改官方 schema”。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyAcsSchemaSnapshot } from '../../scripts/verify-acs-schema-snapshot.ts';

const SNAPSHOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'owasp-acs-v0.1.0');

test('§五十四/§五十六：vendor schema 快照完整性（hash / 数量 / upstream 元数据）', () => {
  const report = verifyAcsSchemaSnapshot(SNAPSHOT_DIR);
  assert.equal(report.ok, true, `snapshot 校验失败：\n${report.problems.map((p) => `  - ${p}`).join('\n')}`);
  assert.equal(report.checked, 7);
  assert.equal(report.pinnedCommit, 'f46d260d22fe6d6ad71e4d979be7e25d063c468e');
});

test('§五十五：vendor schema 只读——快照目录不允许出现非清单文件', () => {
  const report = verifyAcsSchemaSnapshot(SNAPSHOT_DIR);
  assert.equal(report.ok, true);
});
