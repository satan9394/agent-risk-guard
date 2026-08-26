/**
 * normalize.test.ts — Normalize + Path Resolver 单元测试（文档 T10 路径绕过）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePath, isWithin, isEscapeAttempt, pathsEqual } from '../src/path-resolver.ts';
import { classifyShellCommand, normalizeEvent, extractTargetsFromCommand, isReadOnlyCommand } from '../src/normalize.ts';
import { defaultPolicy } from '../src/rules/default-policy.ts';
import { evaluate } from '../src/policy-engine.ts';

test('路径规范化: 相对路径 + .. 解析', () => {
  const a = resolvePath('../foo/bar.txt', 'C:\\proj\\src', 'C:\\Users\\x');
  assert.ok(a.canonical.startsWith('C:\\'));
  assert.ok(a.canonical.endsWith('foo\\bar.txt'));
  assert.ok(!a.canonical.includes('..\\'));
});

test('路径规范化: ~ 展开', () => {
  const a = resolvePath('~/data', undefined, 'C:\\Users\\x');
  assert.equal(a.canonical, 'C:\\Users\\x\\data');
});

test('路径规范化: Windows 盘符大写', () => {
  const a = resolvePath('d:\\proj\\x', undefined, undefined);
  assert.ok(a.canonical.startsWith('D:\\'));
});

test('路径规范化: 大小写不敏感比较', () => {
  const a = resolvePath('C:\\Proj\\X', undefined, undefined);
  const b = resolvePath('c:\\proj\\x', undefined, undefined);
  assert.equal(pathsEqual(a, b), process.platform === 'win32');
});

test('isWithin: 受保护根判定', () => {
  const a = resolvePath('C:\\Users\\x\\.riskguard\\policy.yml', undefined, undefined);
  assert.equal(isWithin(a, ['C:\\Users\\x\\.riskguard']), true);
  const b = resolvePath('C:\\Users\\x\\.riskguard2\\f', undefined, undefined);
  assert.equal(isWithin(b, ['C:\\Users\\x\\.riskguard']), false); // 前缀必须是完整段
});

test('isEscapeAttempt: .. 穿越识别', () => {
  assert.equal(isEscapeAttempt('../../etc/passwd'), true);
  assert.equal(isEscapeAttempt('C:\\proj\\file.txt'), false);
});

test('classifyShellCommand: rm -rf 识别为 delete', () => {
  const r = classifyShellCommand('rm -rf /tmp/test');
  assert.ok(r);
  assert.equal(r!.domain, 'filesystem');
  assert.equal(r!.action, 'delete');
});

test('classifyShellCommand: Remove-Item 识别', () => {
  const r = classifyShellCommand('Remove-Item C:\\x -Recurse -Force');
  assert.ok(r);
  assert.equal(r!.action, 'delete');
});

test('classifyShellCommand: git clean -fd 识别', () => {
  const r = classifyShellCommand('git clean -fd');
  assert.ok(r);
  assert.equal(r!.domain, 'git');
  assert.equal(r!.action, 'git_clean');
});

test('classifyShellCommand: shutil.rmtree 识别', () => {
  const r = classifyShellCommand('python -c "import shutil; shutil.rmtree(\'build\')"');
  assert.ok(r);
  assert.equal(r!.action, 'delete');
  assert.ok(r!.confidence >= 0.9);
});

test('classifyShellCommand: 白名单命令 null', () => {
  assert.equal(classifyShellCommand('git status'), null);
  assert.equal(classifyShellCommand('ls -la'), null);
  assert.equal(classifyShellCommand('echo hello'), null);
});

test('normalizeEvent: 基础归一化', () => {
  const out = normalizeEvent({
    agent: 'cursor', surface: 'preToolUse', domain: 'filesystem', action: 'delete',
    targetsRaw: ['C:\\proj\\important'], cwd: 'C:\\proj', home: 'C:\\Users\\x',
    workspaceRoot: 'C:\\proj',
  });
  assert.equal(out.ok, true);
  if (out.ok) {
    assert.equal(out.event.schemaVersion, '1.0');
    assert.equal(out.event.source.agent, 'cursor');
    assert.equal(out.event.operation.destructive, true);
    assert.equal(out.event.targets[0].scope, 'workspace');
    assert.ok(out.event.targets[0].canonical);
  }
});

test('normalizeEvent: 缺失字段失败', () => {
  const out = normalizeEvent({ agent: '', surface: 'x', domain: 'filesystem', action: 'delete' });
  assert.equal(out.ok, false);
});

test('extractTargetsFromCommand: rm -rf 路径提取', () => {
  const targets = extractTargetsFromCommand('rm -rf C:\\proj\\build', 'C:\\proj', 'C:\\Users\\x');
  assert.ok(targets.length > 0);
  assert.ok(targets[0].canonical!.includes('build'));
});

test('端到端: normalize + evaluate 链路（删除 → deny）', () => {
  const out = normalizeEvent({
    agent: 'codex', surface: 'preToolUse', domain: 'filesystem', action: 'delete',
    targetsRaw: ['C:\\proj\\data'], cwd: 'C:\\proj', workspaceRoot: 'C:\\proj',
  });
  assert.equal(out.ok, true);
  if (out.ok) {
    const d = evaluate(out.event, defaultPolicy());
    assert.equal(d.decision, 'deny');
    assert.equal(d.safeAlternative?.operation, 'trash');
  }
});

test('端到端: 普通 write 放行', () => {
  const out = normalizeEvent({
    agent: 'claude', surface: 'preToolUse', domain: 'filesystem', action: 'write',
    targetsRaw: ['C:\\proj\\a.txt'], cwd: 'C:\\proj', workspaceRoot: 'C:\\proj',
  });
  assert.equal(out.ok, true);
  if (out.ok) {
    const d = evaluate(out.event, defaultPolicy());
    assert.equal(d.decision, 'allow');
  }
});

test('GAN P0-6 回归: git force push / branch -D 不得是只读', () => {
  assert.equal(isReadOnlyCommand('git push --force origin main'), false, 'force push 不是只读');
  assert.equal(isReadOnlyCommand('git push -f origin main'), false, 'push -f 不是只读');
  assert.equal(isReadOnlyCommand('git branch -D feature'), false, 'branch -D 不是只读');
  assert.equal(isReadOnlyCommand('git branch -d feature'), false, 'branch -d 不是只读');
  // 正常形式仍只读
  assert.equal(isReadOnlyCommand('git push origin main'), true, '普通 push 只读');
  assert.equal(isReadOnlyCommand('git branch -a'), true, 'branch -a 只读');
  assert.equal(isReadOnlyCommand('git status'), true);
});

test('GAN P0-1/P0-2/P0-8 回归: 完整路径/包裹/磁盘必须分类', () => {
  for (const cmd of [
    '/bin/rm -rf /tmp',
    '/usr/bin/rm -rf /tmp/x',
    'eval "rm -rf /tmp/x"',
    'bash -c "rm -rf /tmp"',
    'sh -c "rm -rf /tmp"',
    'mkfs.ext4 /dev/sda1',
    'wipefs -a /dev/sda',
    'dd if=/dev/zero of=/dev/sda',
    'git restore .',
    'git push --force origin main',
  ]) {
    const cls = classifyShellCommand(cmd);
    assert.ok(cls !== null, `${cmd} 应被 classify 识别`);
  }
});

test('GAN P1-1 回归: rm --help / 无参 rm 无害', () => {
  assert.equal(classifyShellCommand('rm --help'), null);
  assert.equal(classifyShellCommand('rm -h'), null);
  assert.equal(classifyShellCommand('rm --version'), null);
  assert.equal(classifyShellCommand('rm'), null);
  assert.equal(classifyShellCommand('rm -rf /tmp/x')?.action, 'delete');
});