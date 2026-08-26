/**
 * dsh-plugin.test.ts — @riskguard/dsh 插件接线测试（D2 契约）
 *
 * 用「伪 cordis 上下文」模拟 dsh-tools：
 *   - tools.on('tools/pre-execute', fn) 记录 listener
 *   - tools.guard(fn) 记录 guards
 * 验证：
 *   1. pre-execute listener 对删除命令返回 {kind:'deny', reason}
 *   2. 对只读命令调用 next()（放行）
 *   3. guard 注册了不变量，且 guard 对 allow 结果仍可拒绝（单调语义）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { apply, checkJunctionEscape } from '../src/plugin.ts';

function fakeCtx() {
  let listener: ((exec: unknown, next: () => unknown) => unknown) | undefined;
  const guards: Array<(exec: unknown) => string | undefined> = [];
  return {
    ctx: {
      on: (_e: string, fn: (exec: unknown, next: () => unknown) => unknown) => { listener = fn; },
      tools: {
        on: (_e: string, fn: (exec: unknown, next: () => unknown) => unknown) => { listener = fn; },
        guard: (fn: (exec: unknown) => string | undefined) => { guards.push(fn); },
      },
      _listener: () => listener,
      _guards: guards,
    },
  };
}

test('riskguard-dsh: pre-execute 注册成功且对删除命令 deny', async () => {
  const f = fakeCtx();
  apply(f.ctx);
  const listener = f.ctx._listener();
  assert.ok(listener, 'pre-execute listener 应已注册');
  const outcome = await listener!({ name: 'bash', arguments: { command: 'rm -rf C:\\proj\\x' } }, () => ({ kind: 'allow' as const }));
  assert.equal((outcome as { kind: string }).kind, 'deny');
  assert.ok((outcome as { reason: string }).reason.includes('RiskGuard'));
});

test('riskguard-dsh: 只读命令 → 调用 next() 放行', async () => {
  const f = fakeCtx();
  apply(f.ctx);
  const listener = f.ctx._listener()!;
  let nextCalled = false;
  const outcome = await listener!({ name: 'bash', arguments: { command: 'git status' } }, () => { nextCalled = true; return { kind: 'allow' as const }; });
  assert.equal(nextCalled, true);
  assert.equal((outcome as { kind: string }).kind, 'allow');
});

test('riskguard-dsh: guard 不变量注册且单调拒绝（allow 也被拒）', () => {
  const f = fakeCtx();
  apply(f.ctx);
  assert.ok(f.ctx._guards.length >= 2, `应注册 ≥2 个 guard，实际 ${f.ctx._guards.length}`);
  const deleteRationale = f.ctx._guards[0]!({ name: 'pwsh', arguments: { command: 'Remove-Item C:\\x -Force' } });
  assert.ok(deleteRationale?.includes('永久删除'), deleteRationale);
  const normal = f.ctx._guards[0]!({ name: 'pwsh', arguments: { command: 'ls' } });
  assert.equal(normal, undefined);
});

test('riskguard-dsh: guard 自保护拦截删除 riskguard 配置', () => {
  const f = fakeCtx();
  apply(f.ctx);
  const selfIdx = f.ctx._guards.length - 1;
  const r = f.ctx._guards[selfIdx]!({ name: 'bash', arguments: { command: 'rm -rf ~/.riskguard/policy.yml' } });
  assert.ok(r?.includes('自保护'), r);
});

test('riskguard-dsh: guard 覆盖完整路径/包裹/git 破坏（P2-3 加固）', () => {
  const f = fakeCtx();
  apply(f.ctx);
  const delGuard = f.ctx._guards[0]!;
  // 完整路径（旧 guard 漏 P0-1）
  let r = delGuard({ name: 'bash', arguments: { command: '/bin/rm -rf /tmp' } });
  assert.ok(r?.includes('永久删除'), `完整路径 rm 应被 guard 拦: ${r}`);
  // shell -c 包裹（P0-2）
  r = delGuard({ name: 'bash', arguments: { command: 'bash -c "rm -rf /tmp"' } });
  assert.ok(r, `bash -c 包裹应被 guard 拦: ${r}`);
  // git 破坏（P0-6）：pre-execute 之外 guard 兜底
  r = delGuard({ name: 'bash', arguments: { command: 'git push --force origin main' } });
  assert.ok(r?.includes('git'), `git force push 应被 guard 拦: ${r}`);
  r = delGuard({ name: 'bash', arguments: { command: 'git branch -D feature' } });
  assert.ok(r?.includes('git'), `git branch -D 应被 guard 拦: ${r}`);
  // 无害命令放行
  assert.equal(delGuard({ name: 'bash', arguments: { command: 'rm --help' } }), undefined);
  assert.equal(delGuard({ name: 'bash', arguments: { command: 'ls -la' } }), undefined);
  assert.equal(delGuard({ name: 'bash', arguments: { command: 'git status' } }), undefined);
});

const isWin = process.platform === 'win32';
function makeJunction(link: string, target: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('cmd.exe', ['/c', 'mklink', '/J', link, target], { timeout: 15000 }, (err) => resolve(!err));
  });
}

test('M7: junction 逃逸被 checkJunctionEscape 拒绝（Windows D3）', { skip: !isWin }, async () => {
  const base = await mkdtemp(join(tmpdir(), 'rg-dsh-junc-'));
  const ws = join(base, 'workspace');
  const outside = join(base, 'outside');
  const link = join(ws, 'link');
  await mkdir(ws);
  await mkdir(outside);
  const created = await makeJunction(link, outside);
  if (!created) return; // 无 junction 权限 → 无法实测
  await writeFile(join(outside, 'f.txt'), 'x');

  const reason = await checkJunctionEscape(
    { name: 'bash', arguments: { command: `rm -rf ${link}/f.txt` } },
    ws,
  );
  assert.ok(reason?.includes('逃逸'), reason);
  // 非删除命令不受影响
  const noop = await checkJunctionEscape({ name: 'bash', arguments: { command: 'ls' } }, ws);
  assert.equal(noop, undefined);
});