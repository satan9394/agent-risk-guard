/**
 * discovery-home-isolation.test.ts — `--home` / `opts.home` 必须真正密闭（2026-09-22）
 *
 * 背景：`AGENT_REGISTRY` 里的绝对探针（`%LOCALAPPDATA%/agy/bin/agy.exe`、`%APPDATA%/Cursor/...`）
 * 以前始终按**进程真实环境**展开，于是 `doctor --home <假 home>` / `detect --home <假 home>`
 * 会把本机真实安装的 Agent 报成「已装」。实测后果：`tests/e2e/cli-exit-codes.e2e.test.ts`
 * 的两个用例在本机（真实装了 agy）红，假 home 的 doctor 凭空出现 `FAIL agy`；CI 因无 `~/.gemini`
 * 而绿，问题只在有该 Agent 的机器上暴露。
 *
 * 修法（`discovery.ts`）：显式传入且**不同于真实 home** 时进入密闭模式，
 * `%APPDATA%` / `%LOCALAPPDATA%` 按该 home 推导（Windows 默认布局 `<home>/AppData/Roaming|Local`）；
 * 真实 home 或不传 home 时行为与以前完全一致。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectAgent, discoverAgents, expandProbePath, AGENT_REGISTRY } from '../src/discovery.ts';

const AGY = AGENT_REGISTRY.find((d) => d.id === 'agy')!;

/** 统一分隔符后比较（`expandProbePath` 是拼接，保留后缀原样的 `/`） */
const norm = (p: string): string => p.replace(/\\/g, '/');

test('密闭模式：绝对探针展开到假 home 之下，而非真实 %LOCALAPPDATA%', () => {
  const fake = mkdtempSync(join(tmpdir(), 'rg-iso-'));
  try {
    assert.equal(
      norm(expandProbePath('%LOCALAPPDATA%/agy/bin/agy.exe', fake, process.env as never, true)),
      norm(join(fake, 'AppData', 'Local', 'agy', 'bin', 'agy.exe')),
    );
    assert.equal(
      norm(expandProbePath('%APPDATA%/Cursor/User', fake, process.env as never, true)),
      norm(join(fake, 'AppData', 'Roaming', 'Cursor', 'User')),
    );
    // 非密闭（真实机器）行为不变
    const realLocal = process.env.LOCALAPPDATA;
    if (realLocal) {
      assert.equal(
        norm(expandProbePath('%LOCALAPPDATA%/agy/bin/agy.exe', fake, process.env as never, false)),
        norm(join(realLocal, 'agy', 'bin', 'agy.exe')),
      );
    }
  } finally { rmSync(fake, { recursive: true, force: true }); }
});

test('密闭模式：假 home 里不继承真实机器已装的 agy', () => {
  const fake = mkdtempSync(join(tmpdir(), 'rg-iso-'));
  try {
    assert.equal(detectAgent(AGY, { home: fake }).installed, false);
  } finally { rmSync(fake, { recursive: true, force: true }); }
});

test('密闭模式：home 相对探针仍生效（.gemini/config/hooks.json 在位 → detected）', () => {
  const fake = mkdtempSync(join(tmpdir(), 'rg-iso-'));
  try {
    mkdirSync(join(fake, '.gemini', 'config'), { recursive: true });
    writeFileSync(join(fake, '.gemini', 'config', 'hooks.json'), '{}', 'utf8');
    const hit = detectAgent(AGY, { home: fake });
    assert.equal(hit.installed, true);
    assert.match(String(hit.probeHit), /hooks\.json$/);
  } finally { rmSync(fake, { recursive: true, force: true }); }
});

test('真实 home（或不传 home）不做密闭，绝对探针照旧', () => {
  const real = process.env.USERPROFILE ?? process.env.HOME ?? '';
  const withoutHome = discoverAgents().map((a) => a.installed);
  const withRealHome = discoverAgents({ home: real }).map((a) => a.installed);
  assert.deepEqual(withRealHome, withoutHome);
});
