/**
 * product.test.ts — 产品化核心单元测试（Version / CLI 状态 / merge / manifest / compatibility / hook 输出）
 *
 * 覆盖 v0.1.0 产品化新增能力，确保：
 *  - merge 只「加入」不覆盖用户配置，且幂等
 *  - manifest 精确记录与恢复
 *  - compatibility.json 是单一事实源，等级诚实（claude/opencode D3、codex D2）
 *  - PreToolUse hook 输出符合当前 Claude Code schema（hookEventName='PreToolUse'）——真实 D3 实测修复的回归
 *  - classifyShellCommand 的破坏性命令正确映射到 DENY
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  mergeClaudeSettings, mergeCodexHooks, mergeOpencodePlugins,
  CLAUDE_HOOK_ID, CODEX_HOOK_ID, OPENCODE_PLUGIN_ID,
} from '../../packages/installer/src/merge.ts';
import { saveManifest, loadManifest, removeManifest, hasManifest, manifestDir, type AgentManifest } from '../../packages/installer/src/manifest.ts';
import { loadCompatibility, levelAtLeast, describeAgent } from '../../packages/installer/src/compatibility.ts';
import { classifyShellCommand, normalizeFullWidth } from '../../packages/core/src/normalize.ts';

const HOOK_PATH = join(fileURLToPath(new URL('.', import.meta.url)), '../../packages/cli/src/hooks/pre-tool-hook.ts');

function hookDecide(payload: unknown, agent = 'claude'): { stdout: string; status: number } {
  const r = spawnSync(process.execPath, [HOOK_PATH, '--agent', agent], {
    input: JSON.stringify(payload), encoding: 'utf8',
  });
  return { stdout: (r.stdout ?? '').trim(), status: r.status ?? -1 };
}

// ============================================================================
// merge —— 非破坏性、幂等、保留用户字段
// ============================================================================

test('merge-claude: 保留用户 Setup hook + permissions，追加 PreToolUse', () => {
  const existing = {
    permissions: { defaultMode: 'bypassPermissions' },
    hooks: { Setup: [{ hooks: [{ command: 'echo user-setup', type: 'command' }] }] },
  };
  const hook = { _riskguard: true, id: CLAUDE_HOOK_ID, matcher: 'Bash|PowerShell', hooks: [] };
  const { config, changed } = mergeClaudeSettings(existing, hook);
  assert.equal(changed, true);
  assert.deepEqual(config.permissions, { defaultMode: 'bypassPermissions' }); // 保留权限
  assert.ok(Array.isArray((config.hooks as any).Setup));                      // 保留 Setup
  const pt = (config.hooks as any).PreToolUse;
  assert.equal(pt.length, 1);
  assert.equal(pt[0].id, CLAUDE_HOOK_ID);
});

test('merge-claude: 幂等（再次 merge 不改动）', () => {
  const hook = { _riskguard: true, id: CLAUDE_HOOK_ID, matcher: 'Bash', hooks: [] };
  const first = mergeClaudeSettings(null, hook);
  const second = mergeClaudeSettings(first.config, hook);
  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal((second.config.hooks as any).PreToolUse.length, 1);
});

test('merge-codex: 保留用户 Bash hook，追加我方 Bash 条目', () => {
  const existing = {
    description: 'user',
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo user-hook' }] }] },
  };
  const entry = { _riskguard: true, id: CODEX_HOOK_ID, matcher: 'Bash', hooks: [] };
  const { config, changed } = mergeCodexHooks(existing, entry);
  assert.equal(changed, true);
  const pt = (config.hooks as any).PreToolUse;
  assert.equal(pt.length, 2);                       // 用户 + 我方
  assert.equal(pt[1].id, CODEX_HOOK_ID);
  assert.equal(pt[0].hooks[0].command, 'echo user-hook'); // 保留
});

test('merge-opencode: 保留已有插件，追加我方插件，幂等', () => {
  const existing = { permission: 'allow', plugin: ['@some/existing-plugin'] };
  const a = mergeOpencodePlugins(existing, `./plugins/${OPENCODE_PLUGIN_ID}.ts`);
  assert.equal(a.changed, true);
  assert.deepEqual(a.config.plugin, ['@some/existing-plugin', `./plugins/${OPENCODE_PLUGIN_ID}.ts`]);
  const b = mergeOpencodePlugins(a.config, `./plugins/${OPENCODE_PLUGIN_ID}.ts`);
  assert.equal(b.changed, false);
  assert.equal((b.config.plugin as string[]).filter((p) => p.includes(OPENCODE_PLUGIN_ID)).length, 1);
});

// ============================================================================
// manifest —— 精确记录与恢复
// ============================================================================

test('manifest: save→load 往返 + 移除 + hasManifest', async () => {
  const home = mkdtempSync(join(tmpdir(), 'rg-manifest-'));
  try {
    const m: AgentManifest = {
      product: 'riskguard', version: '0.1.0', agent: 'claude-code',
      installedAt: new Date().toISOString(), installedFiles: [join(home, 'x.ts')],
      modifiedConfig: [join(home, '.claude', 'settings.json')],
      riskguardEntryId: CLAUDE_HOOK_ID, backupDir: join(home, 'bk'),
    };
    await saveManifest(m, home);
    assert.ok(await hasManifest('claude-code', home));
    const loaded = await loadManifest('claude-code', home);
    assert.equal(loaded?.agent, 'claude-code');
    assert.equal(loaded?.riskguardEntryId, CLAUDE_HOOK_ID);
    assert.equal(loaded?.version, '0.1.0');
    await removeManifest('claude-code', home);
    assert.equal(await hasManifest('claude-code', home), false);
    assert.equal(await loadManifest('missing-agent', home), null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('manifest: manifestDir 定位到 <home>/.riskguard/manifests', () => {
  const dir = manifestDir('C:\\Users\\fake');
  assert.ok(dir.toLowerCase().endsWith('.riskguard\\manifests') || dir.toLowerCase().endsWith('.riskguard/manifests'));
});

// ============================================================================
// compatibility —— 单一事实源 + 等级诚实性
// ============================================================================

test('compatibility: schema 版本与产品版本一致', () => {
  const c = loadCompatibility();
  assert.equal(c.schemaVersion, '1.0');
  assert.equal(c.productVersion, '0.1.0');
  assert.equal(typeof c.levels.D3, 'string');
});

test('compatibility: 关键 agent 覆盖 detect 四件套', () => {
  const c = loadCompatibility();
  for (const id of ['claude-code', 'opencode', 'codex', 'dsh']) {
    assert.ok(c.agents[id], `missing ${id}`);
  }
});

test('compatibility: 诚实等级 — claude/opencode 本机 D3，codex 无 CLI 判 D2', () => {
  const c = loadCompatibility();
  const cc = c.agents['claude-code'].verification['windows'];
  const oc = c.agents['opencode'].verification['windows'];
  const cx = c.agents['codex'].verification['windows'];
  const dsh = c.agents['dsh'].verification['windows'];
  assert.equal(levelAtLeast(cc, 'D3'), true, 'claude-code 应达到 D3（本机实测硬阻断）');
  assert.equal(levelAtLeast(oc, 'D3'), true, 'opencode 应达到 D3（本机实测硬阻断）');
  assert.equal(cx, 'D2', 'codex 本机未装 CLI，只能诚实判 D2');
  assert.equal(levelAtLeast(dsh, 'D3'), true, 'dsh pre-execute 门禁本机实测为 D3');
});

test('compatibility: enforce-soft 的 agent 必须显示 soft（不误报 hard）', () => {
  const c = loadCompatibility();
  assert.equal(c.agents['grok'].enforcement, 'soft');
  assert.equal(c.agents['pi'].enforcement, 'none');
});

test('compatibility: describeAgent 平台缺省回退 D1', () => {
  const d = describeAgent('pi', 'windows');
  assert.equal(d.level, 'D0');
  const g = describeAgent('grok', 'windows');
  assert.equal(g.enforcement, 'soft');
});

// ============================================================================
// PreToolUse hook 输出 —— 真实 D3 修复的 schema 回归
// ============================================================================

test('hook-claude: DENY 输出含 hookEventName=PreToolUse（CC 当前 schema 要求）', () => {
  const { stdout } = hookDecide({ tool_name: 'Bash', tool_input: { command: 'git reset --hard HEAD' }, cwd: '/repo' });
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(parsed.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(parsed.hookSpecificOutput.permissionDecisionReason, 'git 不可逆丢失操作禁止');
});

test('hook-claude: 无害命令 ALLOW（输出 {}）', () => {
  const { stdout } = hookDecide({ tool_name: 'Bash', tool_input: { command: 'echo hi' }, cwd: '/' });
  assert.equal(stdout, '{}');
});

test('hook-codex: DENY 输出 {decision:deny} 且退出码 2', () => {
  const { stdout, status } = hookDecide({ tool_name: 'Bash', tool_input: { command: 'git reset --hard HEAD' }, cwd: '/repo' }, 'codex');
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.decision, 'deny');
  assert.equal(status, 2);
});

test('hook-claude: 空输入 fail-closed deny', () => {
  const r = spawnSync(process.execPath, [HOOK_PATH, '--agent', 'claude'], { input: '', encoding: 'utf8' });
  const parsed = JSON.parse((r.stdout ?? '').trim());
  assert.equal(parsed.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'PreToolUse');
});

// ============================================================================
// classifyShellCommand —— 破坏性命令映射
// ============================================================================

test('classify: rm 家族 → filesystem.delete', () => {
  const c = classifyShellCommand('rm -rf /tmp/x');
  assert.ok(c);
  assert.equal(c!.domain, 'filesystem');
  assert.equal(c!.action, 'delete');
});

test('classify: git reset --hard → git.git_reset', () => {
  const c = classifyShellCommand('git reset --hard HEAD');
  assert.ok(c);
  assert.equal(c!.domain, 'git');
  assert.equal(c!.action, 'git_reset');
});

test('classify: echo 只读 → null（不误拦）', () => {
  assert.equal(classifyShellCommand('echo hello'), null);
});

test('classify: 全角 rm -rf 归一化后仍命中（防 Unicode 绕过）', () => {
  const norm = normalizeFullWidth('ｒｍ　－ｒｆ　／tmp／x');
  const c = classifyShellCommand(norm);
  assert.ok(c);
  assert.equal(c!.domain, 'filesystem');
});