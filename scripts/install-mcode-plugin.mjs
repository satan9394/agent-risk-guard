// install-mcode-plugin.mjs — 把 RiskGuard 装成 MiniMax Code (mcode) 的 Claude 兼容插件
//
// 落点（mcode 0.7.0 实测）：
//   ~/.minimax/plugins/riskguard/.claude-plugin/plugin.json   ← 清单（决定 sourceFormat=CLAUDE）
//   ~/.minimax/plugins/riskguard/hooks/hooks.json             ← PreToolUse 注册（matcher 正则）
//
// 为什么是插件目录而不是 settings.json 条目：
//   mcode 只从插件清单里发现 hook（`<dir>/.claude-plugin/plugin.json` 或 `.minimax-plugin/`），
//   没有 Claude Code 那种「用户级 settings.json 直接注册 hooks」的入口。
//
// matcher 必须同时覆盖 `Bash|PowerShell|bash`：
//   mcode 只有在 tool_input 通过 Claude 形状校验时才把内部名 `bash` 映射成 `Bash`/`PowerShell`，
//   否则**保留内部名** `bash`；matcher 是大小写敏感正则，漏写 `bash` 时那条调用根本不进 hook。
//
// 不带 RG_ALLOW_DELETE：mcode 自带 mavis-trash（回收站）重写，但没有 WorkBuddy 那种
//   「RG_ALLOW_DELETE=1 委派 safe-delete」协议，带上等于把删除委派给不存在的下游。
//
// 用法：
//   node scripts/install-mcode-plugin.mjs [--dry-run] [--home <dir>]
// 卸载：把 ~/.minimax/plugins/riskguard 整个目录移入回收站（插件目录即卸载单位）。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const DRY = process.argv.includes('--dry-run');
const HOMEFLAG = process.argv.indexOf('--home');
const HOME = HOMEFLAG !== -1 && process.argv[HOMEFLAG + 1] ? process.argv[HOMEFLAG + 1] : (process.env.USERPROFILE || os.homedir());

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAMP = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);

// 常量单源在 adapter（mcode 大小写敏感 matcher 的来龙去脉见那里）
const { MCODE_HOOK_ID, MCODE_HOOK_MATCHER } = await import(
  new URL('../packages/adapters/mcode/src/index.ts', import.meta.url).href
);
/** 插件目录名 —— 卸载的单位是**目录**（~/.minimax/plugins/riskguard），不是配置条目 */
const MCODE_PLUGIN_ID = 'riskguard';

const pluginDir = path.join(HOME, '.minimax', 'plugins', MCODE_PLUGIN_ID);
const manifestPath = path.join(pluginDir, '.claude-plugin', 'plugin.json');
const hooksPath = path.join(pluginDir, 'hooks', 'hooks.json');

/** 优先用 bootstrap 后的 runtime（与 claude/codex hook 同源），但**必须确认它带 mcode 支持** */
function resolveHookScript() {
  const runtimeRoot = path.join(HOME, '.riskguard', 'runtime');
  try {
    const versions = fs.readdirSync(runtimeRoot)
      .filter((v) => /^\d+\.\d+\.\d+/.test(v))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .reverse();
    for (const v of versions) {
      const candidate = path.join(runtimeRoot, v, 'packages', 'cli', 'src', 'hooks', 'pre-tool-hook.ts');
      const adapter = path.join(runtimeRoot, v, 'packages', 'adapters', 'mcode', 'src', 'index.ts');
      if (!fs.existsSync(candidate) || !fs.existsSync(adapter)) continue;
      // 旧 runtime 快照没有 mcode 分支：指过去会静默降级到 claude adapter（内部名 bash 会被当未知工具）
      if (!fs.readFileSync(candidate, 'utf8').includes("agent === 'mcode'")) continue;
      return candidate;
    }
  } catch { /* runtime 未 bootstrap */ }
  return path.join(REPO, 'packages', 'cli', 'src', 'hooks', 'pre-tool-hook.ts');
}

function hooksJson(hookScript) {
  return {
    hooks: {
      PreToolUse: [
        {
          _riskguard: true,
          id: MCODE_HOOK_ID,
          matcher: MCODE_HOOK_MATCHER,
          hooks: [
            {
              type: 'command',
              command: `node "${hookScript}" --agent mcode`,
              statusMessage: 'RiskGuard: checking dangerous commands',
              timeout: 10,
            },
          ],
        },
      ],
    },
  };
}

function writeFile(p, content) {
  const existed = fs.existsSync(p);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (existed) {
    const old = fs.readFileSync(p, 'utf8');
    if (old === content) return 'unchanged';
    if (!DRY) {
      const backupDir = path.join(HOME, '.risk-guard-backup', `mcode-${STAMP}`);
      fs.mkdirSync(backupDir, { recursive: true });
      fs.copyFileSync(p, path.join(backupDir, path.basename(p)));
    }
  }
  if (!DRY) fs.writeFileSync(p, content, 'utf8');
  return existed ? 'updated' : 'created';
}

const manifest = fs.readFileSync(path.join(REPO, 'assets', 'mcode', 'plugin.json'), 'utf8');
const hookScript = resolveHookScript();
const hooks = JSON.stringify(hooksJson(hookScript), null, 2) + '\n';

console.log(`${DRY ? '[dry-run] ' : ''}mcode plugin -> ${pluginDir}`);
console.log(`  hook script: ${hookScript}`);
const m = writeFile(manifestPath, manifest);
const h = writeFile(hooksPath, hooks);
console.log(`  manifest: ${m}`);
console.log(`  hooks:    ${h}`);
console.log(`  done. verify with: node ${path.join(REPO, 'scripts', 'install-mcode-plugin.mjs')} --dry-run`);
