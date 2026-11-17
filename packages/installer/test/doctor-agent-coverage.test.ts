/**
 * doctor-agent-coverage.test.ts — 「已安装的 Agent 必须在 doctor 里有一行」（2026-11-17）
 *
 * 由来：2026-09-21 agy 暴露过一次「已安装却一行都不输出」的缺陷；2026-11-17 本机盘点发现
 * 同一个坑又在 **8 端**复发 —— cursor / copilot / grok / devin / pi / omp / kimi-code /
 * minimax-code 全部真实接线、巡检全绿，但 `doctor` 的 order 只有 6 端、runtime-probe 也没有分支。
 *
 * 这个测试钉的是**结构**而不是某台机器的状态：
 *   ① compatibility.json 的每个 Agent 都必须出现在 doctor 输出里（PASS/WARN/FAIL/SKIP 任一）；
 *   ② 每个 hook 文件型 Agent 都必须能被 probeAgentRuntime 覆盖（返回结构完整、不抛错）；
 *   ③ 反向对照：完全空的假 home 里，所有 Agent 必须是 SKIP/NOT_DETECTED —— 不允许「凭空 PASS」。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { cmdDoctor } from '../../cli/src/commands.ts';
import { probeAgentRuntime, HOOK_FILE_AGENT_IDS } from '../src/runtime-probe.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const COMPAT = JSON.parse(readFileSync(join(REPO_ROOT, 'packages', 'installer', 'compatibility.json'), 'utf8')) as {
  agents: Record<string, unknown>;
};

function makeHome(): string {
  return mkdtempSync(join(tmpdir(), 'rg-cover-'));
}

test('doctor 覆盖 compatibility.json 的全部 Agent（不允许静默缺行）', async () => {
  const home = makeHome();
  try {
    const res = await cmdDoctor({ home });
    const text = res.text;
    const missing = Object.keys(COMPAT.agents).filter((id) => !new RegExp(`^\\s*(PASS|WARN|FAIL|SKIP)\\s+${id.replace(/[-]/g, '\\-')}\\b`, 'm').test(text));
    assert.deepEqual(missing, [], `doctor 输出缺少这些 Agent 的行：${missing.join(', ')}`);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('hook 文件型 Agent 全部有 runtime-probe 分支（空 home 下返回 NOT_DETECTED 而非抛错）', async () => {
  const home = makeHome();
  try {
    assert.ok(HOOK_FILE_AGENT_IDS.length >= 8, `expected the 8 hook-file agents, got ${HOOK_FILE_AGENT_IDS.join(',')}`);
    for (const id of HOOK_FILE_AGENT_IDS) {
      const probe = await probeAgentRuntime(id, { home, deep: true, repoRoot: REPO_ROOT });
      assert.equal(probe.agent, id);
      assert.equal(probe.detected, false, `${id}: empty home must not be detected`);
      assert.equal(probe.state, 'NOT_DETECTED', `${id}: empty home must be NOT_DETECTED`);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('空 home 的 doctor 不许出现 PASS（反向对照，防「凭空通过」）', async () => {
  const home = makeHome();
  try {
    const res = await cmdDoctor({ home });
    assert.equal(res.counts.pass, 0, `empty home produced ${res.counts.pass} PASS:\n${res.text}`);
    assert.equal(res.counts.fail, 0, `empty home produced FAIL:\n${res.text}`);
    assert.equal(res.exitCode, 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('反向对照：假 home 里接线了 cursor，doctor 就必须真去探它（不能是 SKIP）', async () => {
  if (process.platform !== 'win32') return;
  const home = makeHome();
  try {
    const dst = join(home, '.cursor', 'hooks');
    mkdirSync(dst, { recursive: true });
    copyFileSync(join(REPO_ROOT, 'assets', 'hooks', 'cursor-riskguard-adapter.ps1'), join(dst, 'cursor-riskguard-adapter.ps1'));
    copyFileSync(join(REPO_ROOT, 'assets', 'hooks', 'dangerous-commands.ps1'), join(dst, 'dangerous-commands.ps1'));
    writeFileSync(join(home, '.cursor', 'hooks.json'), JSON.stringify({
      version: 1,
      hooks: {
        preToolUse: [{
          command: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${join(dst, 'cursor-riskguard-adapter.ps1').replace(/\\/g, '/')}`,
          matcher: 'Shell|Delete',
        }],
      },
    }), 'utf8');

    const res = await cmdDoctor({ home });
    // 这一行的存在性就是「order 覆盖」的证据：旧代码这里只会有一行「SKIP cursor agent 未安装」或干脆没有行
    const line = res.text.split('\n').find((l) => /\s(cursor)\s/.test(l));
    assert.ok(line, `doctor 没有输出 cursor 行：\n${res.text}`);
    assert.doesNotMatch(line!, /SKIP/, `cursor 已接线却仍被判 SKIP：${line}`);
    assert.match(line!, /^(PASS|FAIL|WARN)/, `unexpected cursor line: ${line}`);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('已检测到但无探测分支的端也必须出一行（documented-only，不许静默）', async () => {
  const home = makeHome();
  try {
    // hermes 在 registry 里是 documented-only；本机就有一个残留的 ~/.hermes
    mkdirSync(join(home, '.hermes'), { recursive: true });
    const res = await cmdDoctor({ home });
    const line = res.text.split('\n').find((l) => /\shermes\s/.test(l));
    assert.ok(line, `doctor 对已检测到的 hermes 没有任何输出：\n${res.text}`);
    assert.match(line!, /SKIP/, `documented-only 的端不应被判 PASS/FAIL：${line}`);
    assert.match(line!, /documented-only|没有该端的探测分支/, `要说明「未支持」而不是只写 SKIP：${line}`);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('配置指向不存在的适配器 → BROKEN（不是静默 PASS）', async () => {
  if (process.platform !== 'win32') return; // ps1 适配器只在 Windows 有
  const home = makeHome();
  try {
    // cursor：hooks.json 指向一个不存在的适配器
    mkdirSync(join(home, '.cursor'), { recursive: true });
    writeFileSync(join(home, '.cursor', 'hooks.json'), JSON.stringify({
      version: 1,
      hooks: {
        preToolUse: [{
          command: 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:/nope/cursor-riskguard-adapter.ps1',
          matcher: 'Shell',
        }],
      },
    }), 'utf8');
    const probe = await probeAgentRuntime('cursor', { home, deep: true, repoRoot: REPO_ROOT });
    assert.equal(probe.detected, true);
    assert.equal(probe.wired, true, 'wiring should be recognised from the config');
    assert.equal(probe.hookTargetExists, false, 'missing adapter must be reported');
    assert.equal(probe.state, 'BROKEN', `expected BROKEN, got ${probe.state} — ${probe.evidence.join(' | ')}`);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('minimax：缺 enabled:true 要在证据里点名（hook 会被宿主整段忽略）', async () => {
  if (process.platform !== 'win32') return;
  const home = makeHome();
  try {
    mkdirSync(join(home, '.minimax'), { recursive: true });
    writeFileSync(join(home, '.minimax', 'hooks.json'), JSON.stringify({
      hooks: {
        PreToolUse: [{
          matcher: 'bash|shell|terminal',
          hooks: [{ type: 'command', command: '"node.exe" "C:/nope/riskguard-bridge.mjs"' }],
        }],
      },
    }), 'utf8');
    const probe = await probeAgentRuntime('minimax-code', { home, deep: false, repoRoot: REPO_ROOT });
    assert.equal(probe.detected, true);
    assert.equal(probe.wired, true);
    assert.ok(
      probe.evidence.some((e) => /enabled/.test(e)),
      `expected an evidence line about "enabled": true, got ${probe.evidence.join(' | ')}`,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
