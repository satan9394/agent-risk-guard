/**
 * workbuddy-injection.test.ts — WorkBuddy 接线的形状 + 「委派模式」契约
 *
 * 为什么单独一个文件：WorkBuddy 与 claude/codex **不是同一种接线**。它自带 safe-delete shim
 * （bash safe-bin/*、Node shim、Python sitecustomize.py、覆写 Remove-Item），正确的接线是
 * 「删除委派给平台 shim、不可逆操作才拦」。所以：
 *   - 接线形状必须带 `RG_ALLOW_DELETE=1` 前缀（去掉就死锁）；
 *   - 自检必须在**这个模式下**做，用默认模式测会得到相反的结论。
 *
 * 两层证据：
 *   A. 纯函数层（跨平台）：注入条目的形状、幂等、按独立 marker 精确卸载。
 *   B. 真实 spawn ps1（仅 Windows）：委派模式判定矩阵 —— 这是本仓给 WorkBuddy 的 D2 证据。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..', '..');
const HOOK = join(REPO, 'assets', 'hooks', 'dangerous-commands.ps1');

test('workbuddy: 注入条目带 RG_ALLOW_DELETE=1 前缀与 ps1 绝对路径；幂等；卸载按独立 marker', async () => {
  const { mergeForAgent, removeInjection } = await import('../../packages/cli/src/commands.ts');
  const home = mkdtempSync(join(tmpdir(), 'rg-wb-'));
  try {
    const first = mergeForAgent('workbuddy', REPO, null, home);
    assert.equal(first.changed, true);
    const entry = (first.config['hooks'] as any)['PreToolUse'][0];
    assert.equal(entry._riskguard, true);
    assert.equal(entry.id, 'riskguard-workbuddy-hook');
    assert.equal(entry.matcher, 'Bash|PowerShell');
    const cmd: string = entry.hooks[0].command;
    // 前缀缺了就会「hook 拦下删除 → 命令不执行 → 平台 safe-delete shim 没机会改道」→ 死锁
    assert.match(cmd, /^RG_ALLOW_DELETE=1 /, 'RG_ALLOW_DELETE=1 前缀缺失');
    assert.match(cmd, /-File ".*dangerous-commands\.ps1"/, 'hook 命令未指向 ps1 单源');
    assert.ok(cmd.includes(join(home, '.workbuddy', 'hooks', 'dangerous-commands.ps1')), 'hook 路径不是该 home 下的落点');
    assert.ok((entry.hooks[0].timeout ?? 0) >= 10, 'timeout 过紧（hook 内部还要 spawn 规则引擎）');

    // 幂等：再次 merge 不应重复注入
    const again = mergeForAgent('workbuddy', REPO, first.config, home);
    assert.equal(again.changed, false);

    // 卸载：按 workbuddy **自己的** marker 移除，并清掉空的 PreToolUse
    const out = removeInjection('workbuddy', first.config);
    assert.equal(out.changed, true);
    assert.equal((out.config['hooks'] as any)?.['PreToolUse'], undefined);
  } finally {
    try { rmSync(home, { recursive: true, force: true }); } catch { /* cleanup best-effort */ }
  }
});

test('workbuddy: 卸载不误伤用户自己的 PreToolUse hook', async () => {
  const { mergeForAgent, removeInjection } = await import('../../packages/cli/src/commands.ts');
  const home = mkdtempSync(join(tmpdir(), 'rg-wb2-'));
  try {
    const merged = mergeForAgent('workbuddy', REPO, {
      hooks: { PreToolUse: [{ id: 'user-own-hook', matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }] },
    }, home).config;
    const out = removeInjection('workbuddy', merged);
    assert.equal(out.changed, true);
    const kept = (out.config['hooks'] as any)['PreToolUse'];
    assert.equal(kept.length, 1);
    assert.equal(kept[0].id, 'user-own-hook');
  } finally {
    try { rmSync(home, { recursive: true, force: true }); } catch { /* cleanup best-effort */ }
  }
});

// ---- B. 委派模式判定矩阵（真 spawn；CI 的 Linux/macOS 上跳过，Windows 上必须跑）----
const psOk = process.platform === 'win32'
  && (() => { const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', 'exit 0']); return !r.error && r.status === 0; })();

test('workbuddy: 委派模式（RG_ALLOW_DELETE=1）下的判定矩阵 —— D2 证据', {
  skip: !psOk || !existsSync(HOOK) ? 'needs Windows + powershell.exe + assets/hooks/dangerous-commands.ps1' : false,
}, () => {
  const run = (cmd: string): string => {
    const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command: cmd } });
    const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', HOOK], {
      input: payload, encoding: 'utf8', timeout: 60000, env: { ...process.env, RG_ALLOW_DELETE: '1' },
    });
    return (r.stdout ?? '').trim();
  };
  const isDenied = (out: string): boolean => out.includes('permissionDecision') && out.includes('deny');

  // ① 无害 → 不误拦
  assert.equal(isDenied(run('echo riskguard-self-test')), false, '无害命令被拦');
  // ② 删除类 → 委派给平台 safe-delete（这一条证明 RG_ALLOW_DELETE 真的生效）
  assert.equal(isDenied(run('Remove-Item -Force C:\\tmp\\riskguard-self-test.txt')), false,
    '删除类未被委派：RG_ALLOW_DELETE 没生效，平台 safe-delete shim 永远轮不到（死锁）');
  // ③ 不可逆 → 仍拦（委派 ≠ 放行一切）
  assert.equal(isDenied(run('git reset --hard HEAD')), true, '不可逆命令在委派模式下被放行');
  assert.equal(isDenied(run('rm -rf /')), true, 'rm -rf / 在委派模式下被放行');
});
