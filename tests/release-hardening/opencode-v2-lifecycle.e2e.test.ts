/**
 * opencode-v2-lifecycle.e2e.test.ts — OpenCode V2 形态的安装生命周期（2026-09-22）
 *
 * V2 的本地插件由 `~/.config/opencode/plugins/` 目录自动发现，配置里不允许写 `.ts` 文件路径。
 * 本用例在 fake HOME（V2 形态：`plugins` 数组 + `cli.json` + V1 遗留的 `plugin` 文件路径引用）上
 * 真实 spawn CLI，验证：
 *   install → 部署产物 / 不写文件路径 / 清理 V1 遗留引用 / 保留用户插件 → status ACTIVE
 *   → 二次 install 幂等 → uninstall 移除产物并保留用户插件。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const CLI = join(ROOT, 'packages', 'cli', 'src', 'index.ts');
const REF = './plugins/agent-risk-guard.ts';

function rg(args: string[], home: string): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [CLI, ...args, '--home', home], { encoding: 'utf8' });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status ?? -1 };
}

function readCfg(home: string): Record<string, any> {
  return JSON.parse(readFileSync(join(home, '.config', 'opencode', 'opencode.json'), 'utf8'));
}

function makeV2Home(): string {
  const home = mkdtempSync(join(tmpdir(), 'rg-ocv2-'));
  mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
  writeFileSync(join(home, '.config', 'opencode', 'opencode.json'), JSON.stringify({
    permission: 'allow',
    plugins: ['@user/existing-plugin'],  // V2 用户已有插件（保留）
    plugin: [REF],                       // V1 时代遗留的文件路径引用（应被清理）
  }, null, 2), 'utf8');
  // V2 首次启动会写 cli.json —— 作为形态旁证
  writeFileSync(join(home, '.config', 'opencode', 'cli.json'), '{ "$schema": "https://opencode.ai/v2/cli.json" }', 'utf8');
  return home;
}

test('opencode V2: install 部署产物 / 不写文件路径 / 清理遗留引用，status ACTIVE', () => {
  const home = makeV2Home();
  try {
    const inst = rg(['install', '--agent', 'opencode'], home);
    assert.equal(inst.status, 0, inst.stderr);

    const cfg = readCfg(home);
    assert.deepEqual(cfg.plugins, ['@user/existing-plugin']);                                  // 用户插件保留
    assert.equal(Object.prototype.hasOwnProperty.call(cfg, 'plugin'), false);                   // 遗留文件路径已清理
    assert.equal(cfg.permission, 'allow');
    // 关键：不得把 `.ts` 文件路径写进 plugins（V2 会报 must be a directory）
    assert.ok(!cfg.plugins.some((p: unknown) => String(p).includes('agent-risk-guard')));

    const artifact = join(home, '.config', 'opencode', 'plugins', 'agent-risk-guard.ts');
    assert.ok(existsSync(artifact), 'artifact 应部署到 plugins/ 供 V2 自动发现');

    const st = rg(['status'], home);
    assert.match(st.stdout, /OpenCode[\s\S]*?Runtime: ACTIVE/);

    const inst2 = rg(['install', '--agent', 'opencode'], home);
    assert.equal(inst2.status, 0, inst2.stderr);
    assert.match(inst2.stdout, /already installed \(idempotent, no change\)/);

    const un = rg(['uninstall', '--agent', 'opencode'], home);
    assert.equal(un.status, 0, un.stderr);
    assert.equal(existsSync(artifact), false);
    assert.deepEqual(readCfg(home).plugins, ['@user/existing-plugin']);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
