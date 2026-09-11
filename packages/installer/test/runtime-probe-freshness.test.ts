/**
 * runtime-probe-freshness.test.ts — G2：doctor 验证深度（新鲜度）
 *
 * 覆盖三项能力中的两项（第三项「双实现收敛」以源码契约断言）：
 *   ① dsh 门禁：从子串匹配升级为「规则数 vs 仓库单源」（少/等/多 + 单源缺失）
 *   ② claude/codex：已装 hook 脚本 vs 仓库单源的 SHA256 新鲜度（异/同/就地引用/单源缺失）
 *   ③ runDoctors 的 @deprecated 标注与局限说明
 *
 * 铁律：
 *   - 全部使用**临时 home**（mkdtemp），绝不读写真实 ~/.claude、~/.codex、~/.dsh。
 *   - 新鲜度是 **WARN 语义**：不一致不得把 ACTIVE 降成 BROKEN、不得让 selfTestPassed 变 false。
 *   - 单源缺失 / hash 读不到 → 未校验（null），不得 FAIL、不得抛错。
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { probeAgentRuntime, checkHookScriptFreshness, aggregateHookFreshness } from '../src/runtime-probe.ts';
import { countPatchRules, checkDshPatchDeep } from '../src/doctor.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DSH_SINGLE_SOURCE = join(REPO, 'assets', 'dsh', 'deny-risk-commands.patch.yml');
const PS1_SINGLE_SOURCE = join(REPO, 'assets', 'hooks', 'dangerous-commands.ps1');
const NODE_HOOK_SINGLE_SOURCE = join(REPO, 'packages', 'cli', 'src', 'hooks', 'pre-tool-hook.ts');

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

/** 生成一个含 N 条 deny-risk-commands 规则的 cordis.patch.yml 片段 */
function makeDshPatch(ruleCount: number): string {
  const rules = Array.from({ length: ruleCount }, (_, i) => `          - { re: 'rg-g2-rule-${i}', reason: 'test' }`).join('\n');
  return ['- insert:', '    - id: deny-risk-commands', "      name: 'deny-risk-commands'", '      config:', '        rules:', rules, ''].join('\n');
}

/** 临时 home 里放一个 dsh profile patch（web profile） */
async function writeDshHome(home: string, ruleCount: number): Promise<void> {
  const dir = join(home, '.dsh', 'profiles', 'web');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'cordis.patch.yml'), makeDshPatch(ruleCount), 'utf8');
}

/** 临时 home 里放一个 codex 安装记录（让 state 进入「有 manifest」分支） */
async function writeManifest(home: string, agent: string): Promise<void> {
  const p = join(home, '.riskguard', 'manifests', `${agent}.json`);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify({
    schemaVersion: 2, product: 'riskguard', version: '0.3.0', agent,
    installedAt: new Date().toISOString(), installedFiles: [], modifiedConfig: [],
    riskguardEntryId: agent === 'codex' ? 'riskguard-codex-hook' : 'riskguard-pre-tool-hook',
    backupDir: join(home, '.riskguard', 'backups', agent),
  }, null, 2), 'utf8');
}

/** 临时 home 里放 codex hooks.json，wiring 指向一个 ps1（可选：就地引用仓库单源 / 拷贝后改动） */
async function codexHomeWithPs1Hook(opts: { mode: 'copy-clean' | 'copy-stale' | 'in-place' }): Promise<{ home: string; script: string }> {
  const home = await tmpHome('rg-g2-hook-');
  const hooksDir = join(home, '.codex', 'hooks');
  await mkdir(hooksDir, { recursive: true });
  let script: string;
  if (opts.mode === 'in-place') {
    script = PS1_SINGLE_SOURCE;
  } else {
    script = join(hooksDir, 'dangerous-commands.ps1');
    await copyFile(PS1_SINGLE_SOURCE, script);
    // 有意本地改动（模拟「用户装的是旧版/改过的 hook」）
    if (opts.mode === 'copy-stale') await appendFile(script, '\n# riskguard-g2-test-marker: deliberate local edit\n', 'utf8');
  }
  await writeFile(join(home, '.codex', 'hooks.json'), JSON.stringify({
    hooks: {
      PreToolUse: [{
        _riskguard: true, id: 'riskguard-codex-hook', matcher: 'Bash',
        hooks: [{ type: 'command', command: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${script}"`, timeout: 10 }],
      }],
    },
  }, null, 2), 'utf8');
  return { home, script };
}

/** 临时 home 里放 codex hooks.json，wiring 指向一个 node 型 pre-tool-hook.ts 拷贝 */
async function codexHomeWithNodeHook(stale: boolean): Promise<{ home: string; script: string }> {
  const home = await tmpHome('rg-g2-nodehook-');
  const hooksDir = join(home, '.codex', 'hooks');
  await mkdir(hooksDir, { recursive: true });
  const script = join(hooksDir, 'pre-tool-hook.ts');
  await copyFile(NODE_HOOK_SINGLE_SOURCE, script);
  if (stale) await appendFile(script, '\n// riskguard-g2-test-marker: deliberate local edit\n', 'utf8');
  await writeFile(join(home, '.codex', 'hooks.json'), JSON.stringify({
    hooks: {
      PreToolUse: [{
        _riskguard: true, id: 'riskguard-codex-hook', matcher: 'Bash',
        hooks: [{ type: 'command', command: `node "${script}" --agent codex`, timeout: 10 }],
      }],
    },
  }, null, 2), 'utf8');
  return { home, script };
}

const repoDshRuleCount = async (): Promise<number> => countPatchRules(await readFile(DSH_SINGLE_SOURCE, 'utf8'));

// ============================================================================
// ① dsh：规则数 vs 仓库单源
// ============================================================================

test('G2 countPatchRules: 只统计 deny-risk-commands 块内的规则（flow/block 两种写法）', async () => {
  const raw = await readFile(DSH_SINGLE_SOURCE, 'utf8');
  const n = countPatchRules(raw);
  assert.ok(n > 0, '仓库单源必须解析出规则');
  assert.equal(n, (raw.match(/^\s*-\s*\{\s*re\s*:/gm) ?? []).length, 'flow 写法计数应与逐行计数一致');

  assert.equal(countPatchRules(makeDshPatch(0)), 0);
  assert.equal(countPatchRules(makeDshPatch(3)), 3);
  assert.equal(countPatchRules('- insert:\n    - id: deny-risk-commands\n      config:\n        rules:\n          - re: \'a\'\n          - re: \'b\'\n'), 2, 'block 写法 `- re:` 也应计数');
  assert.equal(
    countPatchRules('- insert:\n    - id: deny-risk-commands\n      config:\n        rules: [{ re: \'a\' }, { re: \'b\' }, { re: \'c\' }]\n'),
    3,
    '同一行内联 flow 数组也要计数（不得因格式差异误判为解析失败/0 条）',
  );

  // 块外（其它 insert）的 re: 规则不得混入计数
  const other = makeDshPatch(3) + "- insert:\n    - id: other-plugin\n      config:\n        rules:\n          - { re: 'nope', reason: 'x' }\n";
  assert.equal(countPatchRules(other), 3, '只数 deny-risk-commands 块内的规则');

  // 注释里的 re: 不算规则
  assert.equal(countPatchRules("- insert:\n    # - { re: 'commented-out' }\n    - id: deny-risk-commands\n      config:\n        rules:\n          - { re: 'real', reason: 'x' }\n"), 1);
});

test('G2 dsh 新鲜度：规则数少于仓库单源 → freshness=false + evidence「rules N < repo M」，且不降级、不削弱 self-test', async () => {
  const repoRules = await repoDshRuleCount();
  assert.ok(repoRules > 1, '仓库单源规则数应 > 1，才能构造「少一条」反例');
  const home = await tmpHome('rg-g2-dsh-stale-');
  await writeDshHome(home, repoRules - 1);

  const p = await probeAgentRuntime('dsh', { home, deep: true });
  assert.equal(p.detected, true);
  assert.equal(p.wired, true, 'patch 在位 → wired');
  assert.equal(p.dshPatchFreshness, false, '条数不足 → 陈旧');
  assert.equal(p.dshRepoRuleCount, repoRules);
  assert.deepEqual(p.dshRuleCounts, [{ profile: 'web', rules: repoRules - 1 }]);
  assert.ok(
    p.evidence.includes(`rules ${repoRules - 1} < repo ${repoRules} (profile: web)`),
    `evidence 应写明条数不足：${p.evidence.join(' | ')}`,
  );
  // WARN 语义：陈旧不得降级、不得削弱既有实弹 self-test 语义
  assert.equal(p.state, 'ACTIVE', '新鲜度不参与 state 判定（WARN ≠ 降级）');
  assert.equal(p.selfTestPassed, true, '既有 selfTestPassed 语义保持不变');
  assert.equal(p.verificationMode, 'static');
});

test('G2 dsh 新鲜度：规则数与仓库单源相等 → 不报陈旧', async () => {
  const repoRules = await repoDshRuleCount();
  const home = await tmpHome('rg-g2-dsh-eq-');
  await writeDshHome(home, repoRules);

  const p = await probeAgentRuntime('dsh', { home, deep: true });
  assert.equal(p.dshPatchFreshness, true);
  assert.equal(p.dshRepoRuleCount, repoRules);
  assert.ok(p.evidence.includes(`dsh rule count in sync with repo single source (repo ${repoRules})`), p.evidence.join(' | '));
  assert.ok(!p.evidence.some((e) => e.includes('< repo')), '相等时不得出现条数不足行');
  assert.equal(p.state, 'ACTIVE');
});

test('G2 dsh 新鲜度：规则数多于单源（用户自加规则）→ 视为同步，不报陈旧', async () => {
  const repoRules = await repoDshRuleCount();
  const home = await tmpHome('rg-g2-dsh-more-');
  await writeDshHome(home, repoRules + 5);

  const p = await probeAgentRuntime('dsh', { home, deep: true });
  assert.equal(p.dshPatchFreshness, true, '≥ 单源不算陈旧（用户自加规则是合法增强）');
  assert.ok(!p.evidence.some((e) => e.includes('< repo')));
});

test('G2 dsh 新鲜度：仓库单源缺失 → 未校验（null），不得 FAIL/抛错，state 不受影响', async () => {
  const repoRules = await repoDshRuleCount();
  const home = await tmpHome('rg-g2-dsh-nosrc-');
  await writeDshHome(home, repoRules - 1);
  const emptyRoot = await tmpHome('rg-g2-emptyrepo-');

  const p = await probeAgentRuntime('dsh', { home, deep: true, repoRoot: emptyRoot });
  assert.equal(p.dshRepoRuleCount, null);
  assert.equal(p.dshPatchFreshness, null);
  assert.ok(p.evidence.includes('repo single source unavailable — dsh rule-count freshness not checked'), p.evidence.join(' | '));
  assert.equal(p.state, 'ACTIVE', '单源缺失是「未校验」，不是用户环境坏了');
  assert.equal(p.wired, true, 'patch 仍在位');

  const deep = await checkDshPatchDeep(home, { repoRoot: emptyRoot });
  assert.equal(deep.repoRuleCount, null);
  assert.equal(deep.freshness, null);
  assert.equal(deep.check.state, 'ok');
  assert.match(deep.notes.join(' '), /repo single source unavailable/);
});

test('G2 dsh：profile 目录不存在 → 维持既有缺失语义（wired=false，不因新鲜度改动）', async () => {
  const home = await tmpHome('rg-g2-dsh-noprof-');
  await mkdir(join(home, '.dsh'), { recursive: true }); // 有 .dsh 但无 profiles

  const p = await probeAgentRuntime('dsh', { home, deep: true });
  assert.equal(p.detected, true);
  assert.equal(p.wired, false);
  assert.equal(p.selfTestPassed, false);
  assert.equal(p.dshPatchFreshness, null);
  assert.equal(p.state, 'DETECTED');

  const deep = await checkDshPatchDeep(home);
  assert.equal(deep.check.state, 'missing');
  assert.deepEqual(deep.profiles, []);
});

// ============================================================================
// ② claude/codex：已装 hook 脚本 vs 仓库单源（SHA256）
// ============================================================================

test('G2 claude/codex 新鲜度：hook 脚本与仓库单源不同 → freshness=false + evidence「script differs...」，且不降 BROKEN', async () => {
  const { home, script } = await codexHomeWithPs1Hook({ mode: 'copy-stale' });
  await writeManifest(home, 'codex');

  const p = await probeAgentRuntime('codex', { home, deep: false });
  assert.equal(p.wired, true);
  assert.equal(p.hookTargetExists, true);
  assert.equal(p.hookScriptFreshness, false, '内容不同 → 陈旧');
  assert.equal(p.artifactIntegrity, false, 'G2 约定：claude/codex 用 artifactIntegrity 外传同一信号');
  assert.equal(p.hookScriptChecks?.length, 1);
  assert.equal(p.hookScriptChecks?.[0]?.source, resolve(PS1_SINGLE_SOURCE));
  assert.ok(
    p.evidence.some((e) => e.startsWith('script differs from repo single source (possibly stale):') && e.includes(resolve(script))),
    `evidence 应含「script differs...」：${p.evidence.join(' | ')}`,
  );
  assert.notEqual(p.state, 'BROKEN', '新鲜度不一致不得降 BROKEN（用户可能有意改过）');
});

test('G2 claude/codex 新鲜度：陈旧但拦截链路仍工作 → 保留 ACTIVE（实弹 self-test 不被削弱）', { skip: process.platform !== 'win32' ? 'ps1 hook self-test 需要 powershell.exe（Windows）' : false }, async () => {
  const { home } = await codexHomeWithPs1Hook({ mode: 'copy-stale' });
  await writeManifest(home, 'codex');

  const p = await probeAgentRuntime('codex', { home, deep: true });
  assert.equal(p.hookScriptFreshness, false);
  assert.equal(p.selfTestPassed, true, '实弹 self-test 仍然执行并通过（无害→allow、危险→deny）');
  assert.equal(p.state, 'ACTIVE', '陈旧只降新鲜度，不降 ACTIVE→BROKEN');
});

test('G2 claude/codex 新鲜度：hook 脚本与仓库单源相同 → 不报陈旧', async () => {
  const { home } = await codexHomeWithPs1Hook({ mode: 'copy-clean' });
  await writeManifest(home, 'codex');

  const p = await probeAgentRuntime('codex', { home, deep: false });
  assert.equal(p.hookScriptFreshness, true);
  assert.equal(p.artifactIntegrity, true);
  assert.ok(p.evidence.includes('hook script matches repo single source (sha256)'), p.evidence.join(' | '));
  assert.ok(!p.evidence.some((e) => e.includes('differs from repo single source')));
});

test('G2 claude/codex 新鲜度：hook 直接引用仓库单源（就地）→ 视为同步', async () => {
  const { home } = await codexHomeWithPs1Hook({ mode: 'in-place' });
  await writeManifest(home, 'codex');

  const p = await probeAgentRuntime('codex', { home, deep: false });
  assert.equal(p.hookScriptFreshness, true);
  assert.ok(p.evidence.includes('hook script is the repo single source itself (in-place reference)'), p.evidence.join(' | '));
});

test('G2 claude/codex 新鲜度：node 型 pre-tool-hook.ts 也走单源比对', async () => {
  const { home, script } = await codexHomeWithNodeHook(true);
  await writeManifest(home, 'codex');

  const p = await probeAgentRuntime('codex', { home, deep: false });
  assert.equal(p.hookTargetExists, true);
  assert.equal(p.hookScriptFreshness, false);
  assert.equal(p.hookScriptChecks?.[0]?.source, resolve(NODE_HOOK_SINGLE_SOURCE));
  assert.ok(p.evidence.some((e) => e.includes(`possibly stale): ${resolve(script)}`)), p.evidence.join(' | '));
});

test('G2 claude/codex 新鲜度：仓库单源缺失 → 未校验（null），不是 FAIL', async () => {
  const { home } = await codexHomeWithPs1Hook({ mode: 'copy-stale' });
  await writeManifest(home, 'codex');
  const emptyRoot = await tmpHome('rg-g2-emptyrepo-');

  const p = await probeAgentRuntime('codex', { home, deep: false, repoRoot: emptyRoot });
  assert.equal(p.hookScriptFreshness, null);
  assert.equal(p.artifactIntegrity, null);
  assert.ok(p.evidence.some((e) => e.startsWith('repo single source unavailable — freshness not checked')), p.evidence.join(' | '));
  assert.notEqual(p.state, 'BROKEN');
});

test('G2 checkHookScriptFreshness: 无映射 / 单源缺失 / 读不到 hash → 一律 null（未校验），绝不抛错', async () => {
  const home = await tmpHome('rg-g2-unverifiable-');

  // 无映射
  const unknown = join(home, 'some-other-hook.ps1');
  await writeFile(unknown, 'x', 'utf8');
  const a = await checkHookScriptFreshness(unknown, REPO);
  assert.equal(a.fresh, null);
  assert.equal(a.source, null);
  assert.match(a.detail, /no repo single source mapping/);

  // 单源缺失
  const known = join(home, 'dangerous-commands.ps1');
  await writeFile(known, 'x', 'utf8');
  const b = await checkHookScriptFreshness(known, home);
  assert.equal(b.fresh, null);
  assert.match(b.detail, /repo single source unavailable/);

  // hash 读不到（用同名**目录**模拟不可读文件）
  const dirAsScript = join(home, 'sub', 'dangerous-commands.ps1');
  await mkdir(dirAsScript, { recursive: true });
  const c = await checkHookScriptFreshness(dirAsScript, REPO);
  assert.equal(c.fresh, null);
  assert.match(c.detail, /hash unavailable/);

  assert.equal(aggregateHookFreshness([]), null);
  assert.equal(aggregateHookFreshness([{ script: 's', source: 's', fresh: null, detail: '' }]), null);
  assert.equal(aggregateHookFreshness([{ script: 's', source: 's', fresh: true, detail: '' }, { script: 's2', source: 's2', fresh: null, detail: '' }]), true);
  assert.equal(aggregateHookFreshness([{ script: 's', source: 's', fresh: true, detail: '' }, { script: 's2', source: 's2', fresh: false, detail: '' }]), false, '任一处不一致 → 整体陈旧');
});

test('G2 不误判：真实单源环境下正常 hook（就地引用）不产生陈旧信号', async () => {
  const { home } = await codexHomeWithPs1Hook({ mode: 'in-place' });
  await writeManifest(home, 'codex');
  const p = await probeAgentRuntime('codex', { home, deep: false });
  assert.equal(p.hookScriptFreshness, true);
  assert.ok(!p.evidence.some((e) => e.includes('possibly stale')));
});

// ============================================================================
// ③ 双实现收敛：runDoctors 的 @deprecated 契约
// ============================================================================

test('G2 收敛：runDoctors 标注 @deprecated 且写明局限（子串级/无实弹/无新鲜度）', async () => {
  const src = await readFile(join(REPO, 'packages', 'installer', 'src', 'doctor.ts'), 'utf8');
  const idx = src.indexOf('export async function runDoctors');
  assert.ok(idx > 0, 'runDoctors 仍应存在（不删除，只废弃）');
  const doc = src.slice(Math.max(0, idx - 2000), idx);
  assert.match(doc, /@deprecated/, 'runDoctors 必须有 @deprecated 标注');
  assert.match(doc, /probeAgentRuntime/, '@deprecated 说明应指向统一实现 probeAgentRuntime');
  assert.match(doc, /子串/, '应点明子串级局限');
  assert.match(doc, /实弹/, '应点明无实弹 self-test 局限');
  assert.match(doc, /新鲜度/, '应点明无新鲜度局限');
});

test('G2 收敛：checkDshPatch 保留旧签名（state ok/missing），深度信号走 checkDshPatchDeep', async () => {
  const home = await tmpHome('rg-g2-compat-');
  await writeDshHome(home, 3);
  const deep = await checkDshPatchDeep(home);
  assert.equal(deep.check.state, 'ok');
  assert.equal(deep.check.agent, 'dsh');
  assert.match(deep.check.detail, /已注入：web ✓/);
  assert.equal(deep.profiles[0].rules, 3);
});
