/**
 * runtime-probe-agy.test.ts — Antigravity CLI (agy) 纳入 runtime probe / doctor 的覆盖
 *
 * 为什么有这个文件（2026-09-21 修复的缺陷）：
 *   `HOOK_SINGLE_SOURCE_MAP` 早有 `agy-dangerous-commands.ps1` 条目，但
 *   `probeAgentRuntime` **没有 agy 分支**、`cmdDoctor` 的 `order` 里也没有 agy。
 *   cmdDoctor 对「不在 order 里的 registry agent」只在**未安装**时打 SKIP ——
 *   于是**已安装的 agy 在 doctor 输出里一行都没有**（既不是 PASS 也不是 FAIL），
 *   那条单源新鲜度校验永远不会被走到。本文件把这三件事钉住：
 *     ① agy 必须出现在 doctor 里（PASS 或 SKIP，**不得静默缺席**）；
 *     ② wiring / config / target / fresh / self-test 五条判据都能真的报错；
 *     ③ self-test 不得被 fail-closed 路径骗成 PASS。
 *
 * 铁律：全部用**临时 home**（mkdtemp），绝不读写真实的 ~/.gemini、~/.codex。
 *   ⚠️ 唯一例外：agy 适配器内部把规则引擎硬编码在 `$env:USERPROFILE\.codex\hooks\`，
 *      无法用 home 参数重定向 —— 所以 self-test 的断言按「本机是否有该引擎」分支，
 *      两侧都是有意义的判据（有 → 真 deny；无 → 必须识别为 fail-closed 并报错）。
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, copyFile, appendFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { probeAgentRuntime } from '../src/runtime-probe.ts';
import { cmdDoctor } from '../../cli/src/commands.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const AGY_SINGLE_SOURCE = join(REPO, 'assets', 'hooks', 'agy-dangerous-commands.ps1');
/** 适配器内部硬编码的规则引擎（`$main = Join-Path $env:USERPROFILE '.codex\hooks\dangerous-commands.ps1'`） */
const AGY_ENGINE = join(process.env.USERPROFILE ?? homedir(), '.codex', 'hooks', 'dangerous-commands.ps1');

const homes: string[] = [];
async function tmpHome(prefix: string): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), prefix));
  homes.push(d);
  return d;
}
after(async () => {
  while (homes.length) {
    const d = homes.pop()!;
    try { await rm(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

type AgyHomeOpts = {
  /** guard 名（本机真实是 dangerous-commands-guard；仓库生成器写 riskguard-dangerous-commands） */
  guardName?: string;
  /** matcher（默认 run_command） */
  matcher?: string;
  /** 适配器脚本：拷贝单源 / 拷贝后有意改动 / 指向不存在的路径 / 就地引用仓库单源 */
  script?: 'copy-clean' | 'copy-stale' | 'missing' | 'in-place';
  /** hooks.json 内容：正常 / 非法 JSON / 不含 agy 适配器 */
  config?: 'ok' | 'invalid-json' | 'no-adapter';
};

/** 建一个含 agy hook 接线的临时 home */
async function agyHome(opts: AgyHomeOpts = {}): Promise<{ home: string; script: string }> {
  const home = await tmpHome('rg-agy-');
  const cfgDir = join(home, '.gemini', 'config');
  await mkdir(cfgDir, { recursive: true });
  const scriptPath = join(cfgDir, opts.script === 'in-place' ? '' : 'agy-dangerous-commands.ps1');
  let command = '';
  if (opts.script === 'in-place') {
    command = `pwsh -NoProfile -File ${AGY_SINGLE_SOURCE}`;
  } else if (opts.script === 'missing') {
    command = `pwsh -NoProfile -File ${join(cfgDir, 'agy-dangerous-commands.ps1')}`;
  } else {
    await copyFile(AGY_SINGLE_SOURCE, scriptPath);
    if (opts.script === 'copy-stale') {
      await appendFile(scriptPath, '\n# riskguard-agy-test-marker: deliberate local edit\n', 'utf8');
    }
    command = `pwsh -NoProfile -File ${scriptPath}`;
  }

  const cfg: Record<string, unknown> = opts.config === 'no-adapter'
    ? { 'some-other-guard': { PreToolUse: [{ matcher: 'run_command', hooks: [{ type: 'command', command: 'pwsh -NoProfile -File C:\\other\\hook.ps1' }] }] } }
    : {
        [opts.guardName ?? 'dangerous-commands-guard']: {
          PreToolUse: [{ matcher: opts.matcher ?? 'run_command', hooks: [{ type: 'command', command, timeout: 15 }] }],
        },
      };
  await writeFile(join(cfgDir, 'hooks.json'), opts.config === 'invalid-json' ? '{ "broken": ' : JSON.stringify(cfg, null, 2), 'utf8');
  return { home, script: opts.script === 'in-place' ? AGY_SINGLE_SOURCE : scriptPath };
}

// ============================================================================
// ① 回归本体：agy 必须出现在 doctor 里，不得静默缺席
// ============================================================================

test('agy: doctor 输出必须含 agy 一行（PASS/WARN/FAIL/SKIP 任一，但不得缺席）', async () => {
  const home = await tmpHome('rg-agy-doctor-');
  const r = await cmdDoctor({ home, json: true });
  const checks = JSON.parse(r.text).checks as { level: string; agent: string }[];
  const agy = checks.filter((c) => c.agent === 'agy');
  assert.equal(agy.length, 1, `doctor 必须给出恰好一条 agy 结论，实际 ${agy.length} 条（缺陷：已安装的 agy 一行都不输出）`);
  assert.ok(['PASS', 'WARN', 'FAIL', 'SKIP'].includes(agy[0].level), `未预期的 level: ${agy[0].level}`);
});

test('agy: 未接线（空 home）→ doctor 判 FAIL 且给出不含 install --agent agy 的修复提示', async () => {
  const home = await tmpHome('rg-agy-nowire-');
  const r = await cmdDoctor({ home, json: true });
  const checks = JSON.parse(r.text).checks as { level: string; agent: string; fix?: string }[];
  const agy = checks.find((c) => c.agent === 'agy')!;
  // 空 home 时：若本机装着 agy（Windows 上 %LOCALAPPDATA% 探针命中）→ FAIL；否则 SKIP。
  if (agy.level === 'SKIP') return; // CI 上 agy 未安装：SKIP 是正确结论
  assert.equal(agy.level, 'FAIL');
  assert.match(String(agy.fix), /hooks\.json/i, '修复提示应指向 hooks.json 的手工接线');
  assert.doesNotMatch(String(agy.fix), /install --agent agy/, 'CLI install 不支持 agy，不得把用户指过去');
});

// ============================================================================
// ② 五条判据各自能真的报错
// ============================================================================

test('agy: wiring 在位 + 适配器与单源一致 → wired/fresh，且不报陈旧', async () => {
  const { home, script } = await agyHome({ script: 'copy-clean' });
  const p = await probeAgentRuntime('agy', { home, deep: false });
  assert.equal(p.detected, true);
  assert.equal(p.wired, true, 'hooks.json 的 PreToolUse 指向 agy 适配器 → wired');
  assert.equal(p.configValid, true);
  assert.equal(p.hookTargetExists, true);
  assert.equal(p.hookScriptFreshness, true, '与仓库单源同字节 → fresh');
  assert.equal(p.artifactIntegrity, true, '与 claude/codex 同口径外传同一信号');
  assert.equal(p.verificationMode, 'dynamic');
  assert.ok(p.evidence.some((e) => e.includes('matcher(s) for the agy adapter: run_command')), p.evidence.join(' | '));
  assert.equal(p.state, 'INSTALLED', '非 deep：wiring 在位但未跑 self-test → INSTALLED（不得报 ACTIVE）');
  assert.equal(script.endsWith('agy-dangerous-commands.ps1'), true);
});

test('agy: guard 名不影响识别（dangerous-commands-guard 与 riskguard-dangerous-commands 都认）', async () => {
  for (const guardName of ['dangerous-commands-guard', 'riskguard-dangerous-commands']) {
    const { home } = await agyHome({ script: 'copy-clean', guardName });
    const p = await probeAgentRuntime('agy', { home, deep: false });
    assert.equal(p.wired, true, `guard 名 ${guardName} 下仍应识别出适配器接线`);
  }
});

test('agy: 适配器被本地改动 → hookScriptFreshness=false（WARN 语义），不得降 BROKEN', async () => {
  const { home, script } = await agyHome({ script: 'copy-stale' });
  const p = await probeAgentRuntime('agy', { home, deep: false });
  assert.equal(p.wired, true);
  assert.equal(p.hookScriptFreshness, false, '与单源不同 → 陈旧');
  assert.equal(p.artifactIntegrity, false);
  assert.ok(p.evidence.some((e) => e.includes(`possibly stale): ${resolve(script)}`)), p.evidence.join(' | '));
  assert.notEqual(p.state, 'BROKEN', '陈旧是 WARN，不得降 BROKEN');
  assert.equal(p.state, 'INSTALLED', '陈旧 + 非 deep → INSTALLED');
});

test('agy: 配置引用了适配器但文件缺失 → hookTargetExists=false + state=BROKEN', async () => {
  const { home } = await agyHome({ script: 'missing' });
  const p = await probeAgentRuntime('agy', { home, deep: true });
  assert.equal(p.wired, true);
  assert.equal(p.hookTargetExists, false);
  assert.equal(p.state, 'BROKEN', '接线指向不存在的文件 = 显式损坏');
  assert.ok(p.evidence.some((e) => e.includes('hook target MISSING')), p.evidence.join(' | '));
});

test('agy: hooks.json 非法 JSON → configValid=false + state=BROKEN', async () => {
  const { home } = await agyHome({ config: 'invalid-json' });
  const p = await probeAgentRuntime('agy', { home, deep: true });
  assert.equal(p.configValid, false);
  assert.equal(p.wired, false);
  assert.equal(p.state, 'BROKEN');
  assert.ok(p.evidence.some((e) => e.includes('config invalid')), p.evidence.join(' | '));
});

test('agy: hooks.json 里没有 agy 适配器 → wired=false + state=DETECTED（不是 BROKEN）', async () => {
  const { home } = await agyHome({ config: 'no-adapter' });
  const p = await probeAgentRuntime('agy', { home, deep: true });
  assert.equal(p.configValid, true);
  assert.equal(p.wired, false);
  assert.equal(p.state, 'DETECTED', '装着但没接线 = DETECTED（用户还没装护栏），不是损坏');
  assert.ok(p.evidence.some((e) => e.includes('no agy adapter hook found')), p.evidence.join(' | '));
});

test('agy: matcher 不覆盖 run_command → 仍在位但给出明确警告证据', async () => {
  const { home } = await agyHome({ script: 'copy-clean', matcher: 'Bash' });
  const p = await probeAgentRuntime('agy', { home, deep: false });
  assert.equal(p.wired, true, 'adapter 在位仍算 wired');
  assert.ok(
    p.evidence.some((e) => e.includes('no matcher covers run_command')),
    `matcher 不覆盖 run_command 时必须留证据（否则「接线在但永不触发」无人发现）：${p.evidence.join(' | ')}`,
  );
});

test('agy: 仓库单源缺失 → freshness=null（未校验），不得 FAIL、不得抛错', async () => {
  const { home } = await agyHome({ script: 'copy-stale' });
  const emptyRoot = await tmpHome('rg-agy-emptyrepo-');
  const p = await probeAgentRuntime('agy', { home, deep: false, repoRoot: emptyRoot });
  assert.equal(p.hookScriptFreshness, null);
  assert.equal(p.artifactIntegrity, null);
  assert.ok(p.evidence.some((e) => e.startsWith('repo single source unavailable — freshness not checked')), p.evidence.join(' | '));
  assert.notEqual(p.state, 'BROKEN');
});

// ============================================================================
// ③ self-test：agy 的协议面（stdout JSON + exit 0），且不得被 fail-closed 骗过
// ============================================================================

test('agy self-test：真实 spawn 适配器（无害=allow / 危险=deny）', {
  skip: process.platform !== 'win32' ? 'agy 适配器是 ps1，需要 Windows PowerShell' : false,
}, async () => {
  const { home } = await agyHome({ script: 'copy-clean' });
  const p = await probeAgentRuntime('agy', { home, deep: true });

  if (existsSync(AGY_ENGINE)) {
    // 本机装了规则引擎：必须真 deny，且 ACTIVE
    assert.equal(p.selfTestPassed, true, `self-test 应通过：${p.selfTestDetail}`);
    assert.match(String(p.selfTestDetail), /harmless=allow, dangerous=deny/);
    assert.equal(p.state, 'ACTIVE');
  } else {
    // 没有规则引擎：适配器会走 fail-closed 并回一条 deny —— 必须被识别为「未通过」，
    // 否则引擎缺失的机器会显示「保护已生效」（这正是本判据存在的理由）。
    assert.equal(p.selfTestPassed, false, '缺少规则引擎时不得判 PASS');
    assert.match(String(p.selfTestDetail), /fail-closed/);
    assert.equal(p.state, 'INSTALLED', 'self-test 未过 → INSTALLED，不得 ACTIVE');
  }
  assert.equal(p.verificationMode, 'dynamic');
});

test('agy self-test：引擎缺失时不得把 fail-closed 的 deny 当成 PASS（判据本身的自测）', async () => {
  const { home } = await agyHome({ script: 'copy-clean' });
  // 把适配器改成一个「永远 fail-closed deny」的替身：模拟规则引擎缺失时适配器的行为。
  // 它确实回 deny，但 —— 那是"护栏没工作"的信号，不是"护栏工作了"。
  const fake = join(home, '.gemini', 'config', 'agy-dangerous-commands.ps1');
  await writeFile(fake, [
    'param()',
    '$null = [Console]::In.ReadToEnd()',
    '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)',
    "Write-Output '{\"decision\":\"deny\",\"reason\":\"RiskGuard: rules engine missing: X (fail-closed)\"}'",
    'exit 0',
  ].join('\n'), 'utf8');
  const p = await probeAgentRuntime('agy', { home, deep: true });
  if (process.platform !== 'win32') return; // 无 powershell 时走不到 spawn
  assert.equal(p.wired, true);
  assert.equal(p.selfTestPassed, false, 'fail-closed 的 deny 不得算 PASS');
  assert.match(String(p.selfTestDetail), /fail-closed/, `实际：${p.selfTestDetail}`);
});
