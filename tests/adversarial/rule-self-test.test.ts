/**
 * rule-self-test.test.ts — 规则自带测试用例（R3 生态融合）
 *
 * 生态对标：CC Safety Net 的 rulebook 每条规则带 tests（command + expect），
 *           `rule test` 一键验证。本文件把同一思想落到 defaultDenyRules()：
 *           每条（重点：R3 新增）规则至少配 positive（应命中）与 negative（不误伤）样例，
 *           防止「规则写错 / 过宽误伤 / 过窄漏拦」回归。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultDenyRules } from '../../packages/installer/src/deploy.ts';
import { classifyShellCommand } from '../../packages/core/src/normalize.ts';

const RULES = defaultDenyRules();

/** 按内容片段在规则集中定位规则（防止索引漂移） */
function findRule(fragment: string): string {
  const hit = RULES.find((r) => r.includes(fragment));
  assert.ok(hit, `规则集中未找到包含片段: ${fragment}`);
  return hit!;
}

interface RuleCase {
  ruleFragment: string; // 定位 defaultDenyRules 中的规则
  positive: string[];   // 应命中（deny）
  negative: string[];   // 不应误伤（放行）
}

const CASES: RuleCase[] = [
  // ---- R3：git 破坏清单（对标 CC Safety Net 完整清单）----
  {
    ruleFragment: 'git\\s+push',
    positive: ['git push origin main --force', 'git push -f origin main', 'git push --force origin main'],
    negative: ['git push origin main', 'git push --force-with-lease origin main', 'git pull --force'],
  },
  {
    ruleFragment: 'git\\s+branch\\s+-[dD]',
    positive: ['git branch -D feature/x', 'git branch -d feature/x'],
    negative: ['git branch -a', 'git branch -m old new', 'git branch'],
  },
  {
    ruleFragment: 'git\\s+checkout\\s+--',
    positive: ['git checkout -- src/a.ts', 'git checkout -- .'],
    negative: ['git checkout feature', 'git checkout -b feature'],
  },
  {
    ruleFragment: 'git\\s+restore',
    positive: ['git restore src/a.ts', 'git restore .'],
    negative: ['git fetch origin', 'git log --oneline'],
  },
  {
    ruleFragment: 'git\\s+stash\\s+(drop|clear)',
    positive: ['git stash drop', 'git stash clear', 'git stash drop stash@{1}'],
    negative: ['git stash list', 'git stash push -m wip', 'git stash apply'],
  },
  {
    ruleFragment: 'git\\s+switch\\s+[^|;&\\n]*--discard-changes',
    positive: ['git switch --discard-changes feature'],
    negative: ['git switch feature', 'git switch -c new-branch'],
  },
  {
    ruleFragment: 'git\\s+worktree\\s+remove\\s+--force',
    positive: ['git worktree remove --force ../wt'],
    negative: ['git worktree list', 'git worktree remove ../wt'],
  },
  // ---- R3：解释器 one-liner 内嵌删除 ----
  {
    ruleFragment: 'python(?:3(?:\\.\\d+)?)?\\s+-c',
    positive: [
      "python -c \"import os; os.remove('/tmp/x')\"",
      "python3 -c 'os.system(\"rm -rf /tmp\")'",
      "python -c 'shutil.rmtree(\"/tmp/x\")'",
    ],
    negative: ["python -c 'print(1+1)'", 'python script.py', 'python -m pip list'],
  },
  {
    ruleFragment: 'node\\s+-e',
    positive: ["node -e \"fs.rmSync('/tmp/x')\"", "node -e 'require(\"fs\").unlinkSync(\"/tmp/x\")'"],
    negative: ["node -e 'console.log(1)'", 'node app.js', 'node --version'],
  },
  {
    ruleFragment: 'perl\\s+-e',
    positive: ["perl -e 'unlink \"/tmp/x\"'"],
    negative: ["perl -e 'print 1+1'", 'perl script.pl'],
  },
  // ---- R3：Windows wrapper 内嵌删除 ----
  {
    ruleFragment: 'cmd(?:\\.exe)?\\s+\\/c',
    positive: ['cmd /c del /f C:\\temp\\x.txt', 'cmd.exe /c rmdir /s C:\\temp', 'cmd /c erase C:\\temp\\x.txt'],
    negative: ['cmd /c dir C:\\temp', 'cmd /c echo hi'],
  },
  {
    ruleFragment: '(pwsh|powershell)\\s+-(?:command|c)',
    positive: ['pwsh -Command "Remove-Item C:\\temp\\x"', 'powershell -c "rm -rf C:\\temp"'],
    negative: ['pwsh -Command "Get-Process"', 'pwsh -c "ls"', 'pwsh -NoProfile -Command "Get-Date"'],
  },
];

test('R3: 每条规则 positive 样例必须命中（防过窄漏拦）', () => {
  for (const c of CASES) {
    const re = new RegExp(findRule(c.ruleFragment), 'i');
    for (const cmd of c.positive) {
      assert.ok(re.test(cmd), `[${c.ruleFragment}] 应命中但未命中: ${cmd}`);
    }
  }
});

test('R3: 每条规则 negative 样例不得误伤（防过宽拦截）', () => {
  for (const c of CASES) {
    const re = new RegExp(findRule(c.ruleFragment), 'i');
    for (const cmd of c.negative) {
      assert.ok(!re.test(cmd), `[${c.ruleFragment}] 不应命中但命中: ${cmd}`);
    }
  }
});

// ---- 核心引擎联动：classifyShellCommand 必须与规则同向 ----
// 注意：部分命令会被更早的既有分支命中（如 node -e 'fs.rmSync' → filesystem.delete 而非
// process.execute），这是更优的快速路径。断言统一为「命中破坏性删除/危险执行」即可。
function isBlocked(r: ReturnType<typeof classifyShellCommand>): boolean {
  if (r === null) return false;
  if (r.destructive === true) return true;
  return (r.domain === 'filesystem' && r.action === 'delete') ||
         (r.domain === 'git' && ['git_reset', 'git_checkout_discard', 'git_clean'].includes(r.action));
}

test('R3: classifyShellCommand 识别解释器 one-liner / wrapper 递归 / cmd 包裹', () => {
  assert.ok(isBlocked(classifyShellCommand("python3 -c 'os.system(\"rm -rf /tmp\")'")), 'python3 os.system');
  assert.ok(isBlocked(classifyShellCommand("node -e 'fs.rmSync(\"/tmp/x\")'")), 'node fs.rmSync');
  assert.ok(isBlocked(classifyShellCommand("node -e 'require(\"fs\").unlinkSync(\"/tmp/x\")'")), 'node require unlinkSync');
  assert.ok(isBlocked(classifyShellCommand("perl -e 'unlink \"/tmp/x\"'")), 'perl unlink');
  assert.ok(isBlocked(classifyShellCommand("bash -c 'git reset --hard'")), 'wrapper 递归解包应命中');
  assert.ok(isBlocked(classifyShellCommand("cmd /c del C:\\temp\\x.txt")), 'cmd /c del');
  assert.ok(isBlocked(classifyShellCommand("pwsh -Command \"Remove-Item C:\\temp\\x\"")), 'pwsh Remove-Item');
  // 安全包裹 / 安全 one-liner 不得误伤
  assert.equal(classifyShellCommand("bash -c 'echo hi'"), null, '安全 wrapper 放行');
  assert.equal(classifyShellCommand("python -c 'print(1+1)'"), null, '安全 python one-liner');
  assert.equal(classifyShellCommand("cmd /c dir C:\\temp"), null, '安全 cmd 命令');
  assert.equal(classifyShellCommand("node -e 'console.log(1)'"), null, '安全 node one-liner');
});
