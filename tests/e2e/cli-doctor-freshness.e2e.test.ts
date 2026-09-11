/**
 * cli-doctor-freshness.e2e.test.ts — G2：doctor 新鲜度 WARN 不破坏退出码契约
 *
 * 真实 spawn `bin/riskguard.mjs doctor`（CI 与用户同一条路径），断言：
 *   - dsh patch 规则数 < 仓库单源 → `WARN  dsh`，**exit 0**（WARN ≠ FAIL）
 *   - dsh patch 规则数 = 仓库单源 → `PASS  dsh`，无 WARN，exit 0
 *   - claude/codex hook 脚本与仓库单源不一致 → `WARN  codex`，**exit 0**
 *   - `--json` 同样反映 WARN 且 exitCode=0
 *
 * 上轮契约（提交 552fca3）不变：doctor 有 FAIL → 1；无 FAIL → 0；hook 运行时恒 0。
 * 全部在临时 fake HOME 上跑，绝不触碰真实用户配置。
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, appendFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { countPatchRules } from '../../packages/installer/src/doctor.ts';
import { readFileSync } from 'node:fs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const LAUNCHER = join(ROOT, 'bin', 'riskguard.mjs');
const DSH_SINGLE_SOURCE = join(ROOT, 'assets', 'dsh', 'deny-risk-commands.patch.yml');
const PS1_SINGLE_SOURCE = join(ROOT, 'assets', 'hooks', 'dangerous-commands.ps1');

interface CliRun { status: number; stdout: string; stderr: string }
function cli(args: string[], input = ''): CliRun {
  const r = spawnSync(process.execPath, [LAUNCHER, ...args], { input, encoding: 'utf8', timeout: 120000 });
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const homes: string[] = [];
function tmpHome(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  homes.push(d);
  return d;
}
after(() => {
  while (homes.length) {
    const d = homes.pop()!;
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

const REPO_DSH_RULES = countPatchRules(readFileSync(DSH_SINGLE_SOURCE, 'utf8'));

/** 生成含 N 条规则的 cordis.patch.yml 片段 */
function makeDshPatch(ruleCount: number): string {
  const rules = Array.from({ length: ruleCount }, (_, i) => `          - { re: 'rg-g2-rule-${i}', reason: 'test' }`).join('\n');
  return ['- insert:', '    - id: deny-risk-commands', "      name: 'deny-risk-commands'", '      config:', '        rules:', rules, ''].join('\n');
}

function dshHome(ruleCount: number): string {
  const h = tmpHome('rg-g2e-dsh-');
  const dir = join(h, '.dsh', 'profiles', 'web');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'cordis.patch.yml'), makeDshPatch(ruleCount), 'utf8');
  return h;
}

function codexHomeWithStaleHook(): string {
  const h = tmpHome('rg-g2e-codex-');
  const hooksDir = join(h, '.codex', 'hooks');
  mkdirSync(hooksDir, { recursive: true });
  const script = join(hooksDir, 'dangerous-commands.ps1');
  copyFileSync(PS1_SINGLE_SOURCE, script);
  appendFileSync(script, '\n# riskguard-g2-e2e-marker: deliberate local edit\n', 'utf8');
  writeFileSync(join(h, '.codex', 'hooks.json'), JSON.stringify({
    hooks: {
      PreToolUse: [{
        _riskguard: true, id: 'riskguard-codex-hook', matcher: 'Bash',
        hooks: [{ type: 'command', command: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${script}"`, timeout: 10 }],
      }],
    },
  }, null, 2), 'utf8');
  const mp = join(h, '.riskguard', 'manifests', 'codex.json');
  mkdirSync(dirname(mp), { recursive: true });
  writeFileSync(mp, JSON.stringify({
    schemaVersion: 2, product: 'riskguard', version: '0.3.0', agent: 'codex',
    installedAt: new Date().toISOString(), installedFiles: [], modifiedConfig: [],
    riskguardEntryId: 'riskguard-codex-hook', backupDir: join(h, '.riskguard', 'backups', 'codex'),
  }, null, 2), 'utf8');
  return h;
}

// ============================================================================
// dsh 规则数陈旧 → WARN（不是 FAIL，不改退出码）
// ============================================================================

test('e2e G2: dsh patch 规则数少于仓库单源 → WARN dsh + exit 0（WARN ≠ FAIL）', () => {
  const home = dshHome(REPO_DSH_RULES - 1);
  const r = cli(['doctor', '--home', home]);
  assert.equal(r.status, 0, `新鲜度 WARN 不得触发 exit 1（got ${r.status}）\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /WARN\s+dsh\s+patch 规则数少于仓库单源/);
  assert.doesNotMatch(r.stdout, /^FAIL\s+\S/m, '不得因新鲜度产生 FAIL');
  assert.match(r.stdout, /Summary: \d+ PASS \/ 1 WARN \/ 0 FAIL \/ \d+ SKIP/);
  assert.doesNotMatch(r.stdout, /Exit code 1/, '无 FAIL 时不得打印 Exit code 提示');
});

test('e2e G2: dsh 陈旧信号在 --verbose evidence 可见（rules N < repo M）', () => {
  const home = dshHome(REPO_DSH_RULES - 1);
  const r = cli(['doctor', '--verbose', '--home', home]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, new RegExp(`rules ${REPO_DSH_RULES - 1} < repo ${REPO_DSH_RULES}`));
});

test('e2e G2: dsh 陈旧信号在 --json 可见且 exitCode=0（CI 可消费）', () => {
  const home = dshHome(REPO_DSH_RULES - 1);
  const r = cli(['doctor', '--json', '--home', home]);
  assert.equal(r.status, 0, `doctor --json 有 WARN 无 FAIL → exit 0（got ${r.status}）\n${r.stdout}${r.stderr}`);
  const report = JSON.parse(r.stdout) as { warn: number; fail: number; exitCode: number; checks: { level: string; agent: string; message: string }[] };
  assert.equal(report.fail, 0);
  assert.equal(report.warn, 1);
  assert.equal(report.exitCode, 0);
  const warn = report.checks.find((c) => c.level === 'WARN' && c.agent === 'dsh');
  assert.ok(warn, `--json 应含 dsh 的 WARN 检查：${JSON.stringify(report.checks)}`);
  assert.match(warn!.message, /patch 规则数少于仓库单源/);
});

test('e2e G2: dsh patch 规则数与仓库单源一致 → PASS dsh + 0 WARN + exit 0（不误报）', () => {
  const home = dshHome(REPO_DSH_RULES);
  const r = cli(['doctor', '--home', home]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /PASS\s+dsh\s+pre-execute patch/);
  assert.doesNotMatch(r.stdout, /WARN\s+dsh/);
  assert.match(r.stdout, /Summary: \d+ PASS \/ 0 WARN \/ 0 FAIL \/ \d+ SKIP/);
});

// ============================================================================
// claude/codex hook 脚本陈旧 → WARN（不是 FAIL，不改退出码）
// 仅 Windows 可跑：ps1 self-test 需要 powershell.exe（其余平台 hook 会先 self-test FAIL）
// ============================================================================

test('e2e G2: codex hook 脚本与仓库单源不一致 → WARN codex + exit 0', { skip: process.platform !== 'win32' ? 'ps1 hook self-test 需要 powershell.exe' : false }, () => {
  const home = codexHomeWithStaleHook();
  const r = cli(['doctor', '--home', home]);
  assert.equal(r.status, 0, `新鲜度 WARN 不得触发 exit 1（got ${r.status}）\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /WARN\s+codex\s+hook 脚本与仓库单源不一致/);
  assert.doesNotMatch(r.stdout, /^FAIL\s+\S/m);
  assert.match(r.stdout, /Summary: \d+ PASS \/ 1 WARN \/ 0 FAIL \/ \d+ SKIP/);

  const verbose = cli(['doctor', '--verbose', '--home', home]);
  assert.match(verbose.stdout, /script differs from repo single source \(possibly stale\)/);
  assert.match(verbose.stdout, /self-test PASS/, '实弹 self-test 仍被执行且通过（不因新鲜度削弱）');
});

// ============================================================================
// 上轮退出码契约回归（新鲜度改动后仍成立）
// ============================================================================

test('e2e G2 回归: hook 运行时（无子命令）仍恒 exit 0 —— allow 与 deny 都是决策', () => {
  const allow = cli([], '{"tool_name":"Bash","tool_input":{"command":"echo hi"}}');
  assert.equal(allow.status, 0);
  assert.equal((JSON.parse(allow.stdout) as { decision: string }).decision, 'allow');
  const deny = cli([], '{"tool_name":"Bash","tool_input":{"command":"git reset --hard HEAD"}}');
  assert.equal(deny.status, 0, 'deny 是正常决策，仍须 exit 0');
  assert.equal((JSON.parse(deny.stdout) as { decision: string }).decision, 'deny');
});

test('e2e G2 回归: 未知子命令 → exit 2（不受新鲜度改动影响）', () => {
  const r = cli(['frobnicate']);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /Unknown command: frobnicate/);
});
