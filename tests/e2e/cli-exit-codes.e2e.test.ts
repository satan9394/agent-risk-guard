/**
 * cli-exit-codes.e2e.test.ts — G1（退出码可信）+ G7（错误语义）端到端验证
 *
 * 铁律：本套件**真实 spawn CLI 进程**并断言 `spawnSync(...).status`，
 *       不只断言输出字符串（否则「退出码」这一验收点根本没被验证）。
 *
 * 覆盖：
 *   - doctor 有 FAIL            → exit 1（且 FAIL 行尾有可执行修复提示）
 *   - doctor 无 FAIL（全 SKIP） → exit 0
 *   - doctor 全部 PASS          → exit 0
 *   - doctor --json + FAIL      → exit 1 且 JSON 可解析
 *   - 未知子命令（含拼写错误）  → exit 2 + 用法提示，且不再输出 deny JSON
 *   - hook 运行时（无子命令）   → allow / deny / 空输入 / 坏 JSON 全部 exit 0
 *   - install 失败（配置损坏）  → exit 1
 *   - install 未知 agent        → exit 2
 *   - uninstall 被拒（配置损坏）→ exit 1
 *
 * 全部在临时 fake HOME 上跑，绝不触碰真实用户配置。
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { cmdInstallResult } from '../../packages/cli/src/commands.ts';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
/** 用户面对的 launcher（= packages/cli/src/index.ts 的入口，CI 与用户同一条路径） */
const LAUNCHER = join(ROOT, 'bin', 'riskguard.mjs');

interface CliRun { status: number; stdout: string; stderr: string }

/** 真实 spawn CLI 进程；status 为进程退出码（spawn 失败 → -1） */
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

/** Claude Code 存在但 RiskGuard 未接线 → doctor 必 FAIL */
function homeClaudeUnwired(): string {
  const h = tmpHome('rg-exit-cc-');
  mkdirSync(join(h, '.claude'), { recursive: true });
  writeFileSync(join(h, '.claude', 'settings.json'), JSON.stringify({ model: 'opus' }, null, 2), 'utf8');
  return h;
}
/** 空 home：本机一个 agent 都没有 → doctor 全 SKIP、无 FAIL */
function homeEmpty(): string { return tmpHome('rg-exit-empty-'); }

// ============================================================================
// doctor 退出码
// ============================================================================

test('exit: doctor 有 FAIL → exit 1，且 FAIL 行尾带可执行修复提示', () => {
  const home = homeClaudeUnwired();
  const r = cli(['doctor', '--home', home]);
  assert.equal(r.status, 1, `doctor with FAIL must exit 1 (got ${r.status})\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /FAIL\s+claude-code/);
  // Summary 行保留原格式（只追加，不重排）
  assert.match(r.stdout, /Summary: \d+ PASS \/ \d+ WARN \/ [1-9]\d* FAIL \/ \d+ SKIP/);
  // FAIL 行尾的可执行修复提示
  assert.match(r.stdout, /FAIL\s+claude-code.*→ 重跑: node bin\/riskguard\.mjs install --agent claude-code/);
});

test('exit: doctor 无 FAIL（本机无 agent → 全 SKIP）→ exit 0', () => {
  const home = homeEmpty();
  const r = cli(['doctor', '--home', home]);
  assert.equal(r.status, 0, `doctor without FAIL must exit 0 (got ${r.status})\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /Summary: \d+ PASS \/ \d+ WARN \/ 0 FAIL \/ \d+ SKIP/);
  assert.doesNotMatch(r.stdout, /^FAIL\s+\S/m);
});

test('exit: doctor 全部 PASS（fake home 真安装后）→ exit 0', () => {
  const home = homeClaudeUnwired();
  const inst = cli(['install', '--agent', 'claude-code', '--home', home]);
  assert.equal(inst.status, 0, `install must succeed (got ${inst.status})\n${inst.stdout}${inst.stderr}`);
  const r = cli(['doctor', '--home', home]);
  assert.equal(r.status, 0, `doctor all-PASS must exit 0 (got ${r.status})\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /PASS\s+claude-code/);
  assert.doesNotMatch(r.stdout, /^FAIL\s+\S/m);
  assert.match(r.stdout, /Summary: [1-9]\d* PASS \/ \d+ WARN \/ 0 FAIL \/ \d+ SKIP/);
});

test('exit: doctor --json + FAIL → exit 1 且 JSON 可解析（CI 可消费）', () => {
  const home = homeClaudeUnwired();
  const r = cli(['doctor', '--json', '--home', home]);
  assert.equal(r.status, 1, `doctor --json with FAIL must exit 1 (got ${r.status})\n${r.stdout}${r.stderr}`);
  const report = JSON.parse(r.stdout) as { fail: number; exitCode: number; checks: { level: string; agent: string; fix?: string }[] };
  assert.ok(report.fail >= 1, 'json report must report the FAIL count');
  assert.equal(report.exitCode, 1);
  const bad = report.checks.find((c) => c.level === 'FAIL');
  assert.ok(bad, 'json report must contain the FAIL check');
  assert.match(String(bad!.fix), /install --agent/);
});

// ============================================================================
// 未知子命令（G7）
// ============================================================================

test('exit: 未知子命令 → exit 2 + 用法提示，且不再输出 deny JSON', () => {
  const r = cli(['frobnicate']);
  assert.equal(r.status, 2, `unknown command must exit 2 (got ${r.status})\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /Unknown command: frobnicate/);
  assert.match(r.stdout, /Run 'node bin\/riskguard\.mjs help' for usage\./);
  assert.doesNotMatch(r.stdout, /"decision"\s*:\s*"deny"/, 'must NOT fall through to the hook runtime');
  assert.doesNotMatch(r.stdout, /fail-closed/, 'must NOT fall through to the hook runtime');
});

test('exit: 拼写错误子命令（doctorr）→ exit 2', () => {
  const r = cli(['doctorr']);
  assert.equal(r.status, 2, `typo command must exit 2 (got ${r.status})\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /Unknown command: doctorr/);
});

test('exit: 空字符串子命令 → exit 2', () => {
  const r = cli(['']);
  assert.equal(r.status, 2, `empty argument must exit 2 (got ${r.status})\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /Unknown command/);
});

// ============================================================================
// hook 运行时契约（最高优先级：必须恒 exit 0）
// ============================================================================

test('hook: allow payload → decision JSON + exit 0', () => {
  const r = cli([], '{"tool_name":"Bash","tool_input":{"command":"echo hi"}}');
  assert.equal(r.status, 0, `hook runtime must exit 0 (got ${r.status})\n${r.stdout}${r.stderr}`);
  const out = JSON.parse(r.stdout) as { decision: string };
  assert.equal(out.decision, 'allow');
});

test('hook: 危险 payload → deny JSON + exit 0（deny 是决策，不是错误）', () => {
  const r = cli([], '{"tool_name":"Bash","tool_input":{"command":"git reset --hard HEAD"}}');
  assert.equal(r.status, 0, `hook runtime must exit 0 even on deny (got ${r.status})\n${r.stdout}${r.stderr}`);
  const out = JSON.parse(r.stdout) as { decision: string };
  assert.equal(out.decision, 'deny');
});

test('hook: 危险 payload（commandRaw 形状）→ deny JSON + exit 0', () => {
  const r = cli([], '{"commandRaw":"git reset --hard HEAD","cwd":"/repo"}');
  assert.equal(r.status, 0, `hook runtime must exit 0 even on deny (got ${r.status})\n${r.stdout}${r.stderr}`);
  assert.equal((JSON.parse(r.stdout) as { decision: string }).decision, 'deny');
});

test('hook: 空输入 → fail-closed deny + exit 0（不得改成非零）', () => {
  const r = cli([], '');
  assert.equal(r.status, 0, `empty stdin must stay exit 0 (got ${r.status})\n${r.stdout}${r.stderr}`);
  const out = JSON.parse(r.stdout) as { decision: string; degraded?: boolean };
  assert.equal(out.decision, 'deny');
  assert.equal(out.degraded, true);
});

test('hook: 坏 JSON → fail-closed deny + exit 0（不得改成非零）', () => {
  const r = cli([], '{broken');
  assert.equal(r.status, 0, `invalid json must stay exit 0 (got ${r.status})\n${r.stdout}${r.stderr}`);
  const out = JSON.parse(r.stdout) as { decision: string; degraded?: boolean };
  assert.equal(out.decision, 'deny');
  assert.equal(out.degraded, true);
});

// ============================================================================
// install / uninstall 失败路径
// ============================================================================

test('exit: install 失败（配置损坏 → abort，零写入）→ exit 1', () => {
  const home = tmpHome('rg-exit-badcfg-');
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.claude', 'settings.json'), '{"broken": ,,,}', 'utf8');
  const r = cli(['install', '--agent', 'claude', '--home', home]);
  assert.equal(r.status, 1, `aborted install must exit 1 (got ${r.status})\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /installation aborted/);
});

test('exit: install 未知 agent → exit 2', () => {
  const home = homeClaudeUnwired();
  const r = cli(['install', '--agent', 'nonsense', '--home', home]);
  assert.equal(r.status, 2, `unknown agent must exit 2 (got ${r.status})\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /Unknown agent: nonsense/);
});

// CLI argv 刻意无法注入 `_test`（生产入口不产生该字段），因此「VERIFY 失败 → 真回滚」
// 只能在单元层注入触发；这里断言的是 **index.ts 实际调用的同一个函数** 的退出码映射。
test('exit: install 回滚（VERIFY 失败 → rolled back）→ exitCode 1', async () => {
  const home = tmpHome('rg-exit-rollback-');
  mkdirSync(join(home, '.codex'), { recursive: true });
  writeFileSync(join(home, '.codex', 'hooks.json'), JSON.stringify({ hooks: { PreToolUse: [] } }, null, 2), 'utf8');
  const r = await cmdInstallResult({ only: 'codex', home, _test: { failVerify: true } });
  assert.equal(r.exitCode, 1, `rolled-back install must map to exit code 1 (got ${r.exitCode})\n${r.text}`);
  assert.match(r.text, /install verification FAILED/);
  assert.match(r.text, /rolled back/);
  // 回滚语义不变：不留 manifest、配置恢复
  assert.equal(existsSync(join(home, '.riskguard', 'manifests', 'codex.json')), false);
});

test('exit: install 幂等（已装再装）→ exit 0', () => {
  const home = homeClaudeUnwired();
  assert.equal(cli(['install', '--agent', 'claude-code', '--home', home]).status, 0);
  const again = cli(['install', '--agent', 'claude-code', '--home', home]);
  assert.equal(again.status, 0, `idempotent install must exit 0 (got ${again.status})\n${again.stdout}${again.stderr}`);
  assert.match(again.stdout, /already installed \(idempotent, no change\)/);
});

test('exit: uninstall 被拒（安装后配置损坏）→ exit 1', () => {
  const home = homeClaudeUnwired();
  assert.equal(cli(['install', '--agent', 'claude-code', '--home', home]).status, 0);
  // 安装后把配置写坏 → uninstall 必须拒绝（绝不基于不可读配置改动用户文件），并给非零退出码
  writeFileSync(join(home, '.claude', 'settings.json'), '{"broken": ,,,}', 'utf8');
  const r = cli(['uninstall', '--agent', 'claude-code', '--home', home]);
  assert.equal(r.status, 1, `refused uninstall must exit 1 (got ${r.status})\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /uninstall refused/);
});

test('exit: uninstall 未安装过的 agent → exit 0（幂等，不是错误）', () => {
  const home = homeEmpty();
  const r = cli(['uninstall', '--agent', 'claude-code', '--home', home]);
  assert.equal(r.status, 0, `uninstall of never-installed agent must exit 0 (got ${r.status})\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /not installed \(no manifest\)/);
});
