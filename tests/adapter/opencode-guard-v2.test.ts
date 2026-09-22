/**
 * opencode-guard-v2.test.ts — OpenCode >= 2.0 插件入口（default { id, setup }）
 *
 * 直接以 Node 原生 type-stripping 加载插件真身，注入伪 ctx
 * （shell.hook / tool.hook / tool.transform / permission.hook），验证 V2 外壳把
 * 同一套纯检测核心正确接线：
 *   - ctx.shell.hook("create.before")   拦截危险 shell 命令（硬闸门）
 *   - ctx.tool.hook("execute.before")   shell 工具第二层 + 保护 guard 插件自身
 *   - ctx.permission.hook("evaluate")   对匹配的 shell 权限置 deny
 *   - ctx.tool.transform                注册 trash 工具（JSON Schema）
 *
 * 检测向量本身（B-01..B-16 / F18 / 误伤）由 opencode-guard-reregress.test.ts 覆盖；
 * 这里只测「接线」与 V2 契约，避免与那份用例重复。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO_PLUGIN = join(import.meta.dirname, '..', '..', 'assets', 'opencode', 'agent-risk-guard.ts');
const mod = (await import(pathToFileURL(REPO_PLUGIN).href)) as { default: any };
const plugin = mod.default;

interface Registration {
  name: string;
  cb: (event: any) => unknown;
}

function fakeCtx(baseDir: string) {
  const regs: { shell: Registration[]; tool: Registration[]; permission: Registration[] } = {
    shell: [],
    tool: [],
    permission: [],
  };
  const tools: any[] = [];
  const ctx = {
    location: { directory: baseDir },
    shell: { hook: async (name: string, cb: any) => void regs.shell.push({ name, cb }) },
    tool: {
      hook: async (name: string, cb: any) => void regs.tool.push({ name, cb }),
      transform: async (cb: any) => cb({ add: (t: any) => tools.push(t) }),
    },
    permission: { hook: async (name: string, cb: any) => void regs.permission.push({ name, cb }) },
  };
  return { ctx, regs, tools };
}

const GUARD_FILE = join(
  process.env.USERPROFILE || process.env.HOME || '',
  '.config',
  'opencode',
  'plugins',
  'agent-risk-guard.ts',
);

test('v2: 默认导出是 { id, setup }，且 id 稳定（V2 存储/状态按 id 归属）', () => {
  assert.equal(plugin.id, 'agent-risk-guard');
  assert.equal(typeof plugin.setup, 'function');
});

test('v2: setup 注册 shell/tool/permission hook，并注册 trash 工具', async () => {
  const { ctx, regs, tools } = fakeCtx('C:/work');
  await plugin.setup(ctx);
  assert.deepEqual(regs.shell.map((r) => r.name), ['create.before']);
  assert.ok(regs.tool.some((r) => r.name === 'execute.before'));
  assert.deepEqual(regs.permission.map((r) => r.name), ['evaluate']);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'trash');
  assert.equal(tools[0].input.properties.path.type, 'string');
  assert.deepEqual(tools[0].input.required, ['path']);
});

test('v2 shell.create.before: 危险删除抛 BLOCKED，无害命令放行', async () => {
  const { ctx, regs } = fakeCtx('C:/work');
  await plugin.setup(ctx);
  const hook = regs.shell[0].cb;
  assert.throws(() => hook({ command: 'rm -rf /tmp/x', cwd: 'C:/work' }), /BLOCKED_BY_GLOBAL_SAFETY_GUARD/);
  assert.throws(() => hook({ command: 'Remove-Item -Recurse -Force C:\\data' }), /PERMANENT_DELETE_POWERSHELL/);
  assert.throws(() => hook({ command: 'git clean -fd' }), /GIT_CLEAN_DESTRUCTIVE/);
  assert.throws(() => hook({ command: 'Clear-RecycleBin -Force' }), /RECYCLE_BIN_EMPTY/);
  assert.doesNotThrow(() => hook({ command: 'git status' }));
  assert.doesNotThrow(() => hook({ command: 'npm test' }));
  assert.doesNotThrow(() => hook({ command: '' }));
});

test('v2 tool.execute.before: shell 工具是第二层闸门', async () => {
  const { ctx, regs } = fakeCtx('C:/work');
  await plugin.setup(ctx);
  const hook = regs.tool.find((r) => r.name === 'execute.before')!.cb;
  assert.throws(() => hook({ tool: 'shell', input: { command: 'del /f /q C:\\x' } }), /PERMANENT_DELETE_CMD/);
  assert.doesNotThrow(() => hook({ tool: 'shell', input: { command: 'dir' } }));
});

test('v2 tool.execute.before: 保护 guard 插件文件（edit / write / patch，含相对路径）', async () => {
  const { ctx, regs } = fakeCtx('C:/work');
  await plugin.setup(ctx);
  const hook = regs.tool.find((r) => r.name === 'execute.before')!.cb;
  assert.throws(() => hook({ tool: 'write', input: { path: GUARD_FILE, content: 'x' } }), /PROTECTED_GUARD_MUTATION/);
  assert.throws(() => hook({ tool: 'edit', input: { path: GUARD_FILE } }), /PROTECTED_GUARD_MUTATION/);
  assert.throws(
    () => hook({ tool: 'patch', input: { patchText: `*** Delete File: ${GUARD_FILE}` } }),
    /PROTECTED_GUARD_MUTATION/,
  );
  // V1 字段名 filePath 也应被识别
  assert.throws(() => hook({ tool: 'write', input: { filePath: GUARD_FILE } }), /PROTECTED_GUARD_MUTATION/);
  // 普通文件不受影响
  assert.doesNotThrow(() => hook({ tool: 'write', input: { path: 'C:/work/src/a.ts', content: 'x' } }));
  assert.doesNotThrow(() => hook({ tool: 'edit', input: { path: 'C:/work/src/a.ts' } }));
});

test('v2 permission.evaluate: 危险 shell 权限置 deny，并给出可读 message', async () => {
  const { ctx, regs } = fakeCtx('C:/work');
  await plugin.setup(ctx);
  const hook = regs.permission[0].cb;
  const denied: any = { action: 'shell', resources: ['rm -rf /tmp/x'] };
  hook(denied);
  assert.equal(denied.effect, 'deny');
  assert.match(denied.message, /BLOCKED_BY_GLOBAL_SAFETY_GUARD/);
  const safe: any = { action: 'shell', resources: ['git status'] };
  hook(safe);
  assert.equal(safe.effect, undefined);
  // 与 shell 无关的权限动作不介入
  const other: any = { action: 'read', resources: ['rm -rf /tmp'] };
  hook(other);
  assert.equal(other.effect, undefined);
});
