import { join } from 'node:path';
import { statSync } from 'node:fs';

/**
 * installer/discovery.ts — M6 Agent 装机发现（D3 本机实测支持）
 *
 * 目标：识别本机已安装的 AI 编码 Agent 及其风险命令拦截机制接入点，
 * 供 install/doctor/audit 使用。只做「检测」，不做任何写入。
 *
 * mechanism 枚举（对应文档 §10 各 Agent 机制）：
 *   - hooks        CC-style preToolUse hooks（Claude Code/Codex/Cursor/Grok/Hermes/Copilot）
 *   - plugin       TS/JS 插件宿主（OpenCode/Cline 扩展）
 *   - policy       策略文件（Policy Compiler 类）
 *   - rules        AGENTS.md/CLAUDE.md 规则文件（Codex/OpenCode/Claude Code 通用）
 *   - sandbox      沙箱/权限配置文件（Codex sandbox、Claude Code permissions）
 */

export type GuardMechanism = 'hooks' | 'plugin' | 'policy' | 'rules' | 'sandbox';
export type GuardStatus = 'unknown' | 'absent' | 'present' | 'integrated' | 'stale';

export interface AgentDescriptor {
  id: string;
  display: string;
  mechanisms: GuardMechanism[];
  /** 默认配置目录（相对 home / 绝对） */
  configRel?: string[];
  configAbs?: string[];
  /** 判断是否安装：任一路径存在即 installed */
  probePaths: string[];
  probeAbs?: string[];
  /**
   * 2026-11-17：documented-only —— 只登记「这端存在、机制是什么」，**不承诺门禁**。
   * doctor 遇到「已检测到但没有探测分支」的 documented-only 端，必须**明确输出一行**说明未支持，
   * 不能静默不输出（那正是 2026-09-21 agy / 2026-11-17 八端「已装却一行都没有」的坑）。
   */
  documentedOnly?: boolean;
  /** 描述文件（供 doctor 展示） */
  notes?: string;
}

/** 本机发现结果 */
export interface AgentInstall {
  id: string;
  display: string;
  installed: boolean;
  probeHit: string | null;   // 命中的路径
  mechanisms: GuardMechanism[];
  status: GuardStatus;
}

export const AGENT_REGISTRY: AgentDescriptor[] = [
  {
    id: 'claude-code', display: 'Claude Code', mechanisms: ['hooks', 'sandbox', 'rules'],
    configRel: ['.claude', '.config/claude-code'], probePaths: ['.claude', '.config/claude-code'],
    notes: '~/.claude/settings.json + hooks；PreToolUse 阻断；permissions allow/deny',
  },
  {
    id: 'codex', display: 'Codex CLI', mechanisms: ['sandbox', 'rules'],
    configRel: ['.codex'], probePaths: ['.codex'],
    notes: '~/.codex/config.toml sandbox_mode + AGENTS.md rules（Codex 1.1）',
  },
  {
    id: 'opencode', display: 'OpenCode', mechanisms: ['plugin', 'rules'],
    configRel: ['.config/opencode', '.opencode'], probePaths: ['.config/opencode', '.opencode'],
    notes: 'TS 插件（V2: ctx.tool.hook execute.before；V1: tool.before/after）+ AGENTS.md rules',
  },
  {
    // 2026-11-17：Cursor 的 hook 落点是 **home 相对的 `~/.cursor`**（hooks.json 在里面），
    // 旧探针只认 `%APPDATA%/Cursor/User`（桌面安装目录），于是「已接线的 cursor」在 doctor 里
    // 判不出来。两处都探：`.cursor` 命中即说明 hooks 目录存在。
    id: 'cursor', display: 'Cursor', mechanisms: ['hooks', 'rules'],
    configRel: ['.cursor'], configAbs: ['%APPDATA%/Cursor/User', '%APPDATA%/Cursor'],
    probePaths: ['.cursor'], probeAbs: ['%APPDATA%/Cursor/User'],
    notes: 'preToolUse hooks（~/.cursor/hooks.json → cursor-riskguard-adapter.ps1）+ .cursor/rules',
  },
  {
    // compatibility.json 的键仍是 windsurf（历史 id）；产品已更名 Devin（Cascade 2026-07-01 停用），
    // 新契约是 PreToolUse + matcher exec，配置在 `%APPDATA%\devin\config.json` 或 `.devin/hooks.v1.json`。
    id: 'windsurf', display: 'Devin (ex-Windsurf)', mechanisms: ['hooks'],
    configRel: ['.devin'], configAbs: ['%APPDATA%/devin', '%APPDATA%/Windsurf', '%LOCALAPPDATA%/Windsurf'],
    probePaths: ['.devin'], probeAbs: ['%APPDATA%/devin'],
    notes: 'Devin CLI/Desktop PreToolUse(matcher exec) → devin-riskguard-adapter.ps1；Cascade 已停用',
  },
  {
    id: 'grok', display: 'Grok CLI', mechanisms: ['hooks'],
    configRel: ['.grok'], configAbs: ['%APPDATA%/Grok', '%LOCALAPPDATA%/Grok'],
    probePaths: ['.grok'], probeAbs: ['%APPDATA%/Grok'],
    notes: 'PreToolUse hook（~/.grok/hooks/riskguard.json）；stdout JSON + exit 2，vendor 侧 fail-open',
  },
  {
    // 旧 id `claude-code-copilot`（按「CC 内核」猜的 %APPDATA%/github-copilot-cli）已废弃：
    // 真实落点是 `~/.copilot`（hooks/riskguard.json）。id 改成 compatibility.json 的 `copilot`。
    id: 'copilot', display: 'GitHub Copilot CLI', mechanisms: ['hooks', 'sandbox'],
    configRel: ['.copilot'], configAbs: ['%APPDATA%/github-copilot-cli'],
    probePaths: ['.copilot'], probeAbs: ['%APPDATA%/github-copilot-cli'],
    notes: 'PreToolUse hook（~/.copilot/hooks/riskguard.json，PascalCase）+ policy.d 机器策略',
  },
  {
    id: 'dsh', display: 'DeepSeek Harness', mechanisms: ['plugin', 'policy'],
    configRel: ['.dsh'], probePaths: ['.dsh'],
    notes: 'pre-execute 门禁（~/.dsh/profiles/*/cordis.patch.yml 的 deny-risk-commands）',
  },
  {
    id: 'pi', display: 'Pi', mechanisms: ['plugin'],
    configRel: ['.pi'], probePaths: ['.pi'],
    notes: 'tool_call 扩展（~/.pi/agent/extensions/riskguard.ts → shared bridge → ps1 引擎）',
  },
  {
    id: 'omp', display: 'Oh My Pi (omp)', mechanisms: ['plugin'],
    configRel: ['.omp'], probePaths: ['.omp'],
    notes: 'tool_call 扩展（~/.omp/agent/hooks/pre/riskguard.ts → shared bridge → ps1 引擎）',
  },
  {
    id: 'kimi-code', display: 'Kimi Code', mechanisms: ['hooks'],
    configRel: ['.kimi-code'], probePaths: ['.kimi-code'],
    notes: 'PreToolUse hook（~/.kimi-code/config.toml 的 [[hooks]] → shared bridge）；vendor 侧 fail-open',
  },
  {
    id: 'minimax-code', display: 'MiniMax Code', mechanisms: ['hooks'],
    configRel: ['.minimax', '.minimax-code'], probePaths: ['.minimax', '.minimax-code'],
    notes: 'PreToolUse hook（~/.minimax/hooks.json，需 enabled:true → shared bridge）；vendor 侧 fail-open',
  },
  {
    id: 'hermes', display: 'Hermes', mechanisms: ['hooks'],
    // 2026-11-17：探针改成 home 相对（本机真实落点是 `~/.hermes`，旧的 `%LOCALAPPDATA%/Hermes`
    // 只是残留；home 相对还顺带让 `--home <fake>` 的密闭测试对 Hermes 生效）。
    configRel: ['.hermes'], configAbs: ['%LOCALAPPDATA%/Hermes'],
    probePaths: ['.hermes'], probeAbs: ['%LOCALAPPDATA%/Hermes'],
    documentedOnly: true,
    notes: 'documented-only：Claude Code 兼容 hooks 的传闻尚未实测；本机只有 2026-06 的残留配置目录',
  },
  {
    id: 'cline', display: 'Cline（VSCode 扩展）', mechanisms: ['rules'],
    configRel: [], configAbs: ['%APPDATA%/Code/User/globalStorage/saoudrizwan.claude-dev'],
    probePaths: [], probeAbs: ['%APPDATA%/Code/User/globalStorage/saoudrizwan.claude-dev'],
    documentedOnly: true,
    notes: 'rules 文件（cline rules）+ settings',
  },
  {
    id: 'aider', display: 'Aider', mechanisms: ['rules'],
    configRel: ['.aider.conf.yml', '.config/aider'], probePaths: ['.aider.conf.yml'],
    documentedOnly: true,
    notes: 'aider.conf.yml 读规则；补丁格式写入（无删除原语）',
  },
  {
    id: 'goose', display: 'Goose', mechanisms: ['plugin'],
    configRel: ['.config/goose'], probePaths: ['.config/goose'],
    documentedOnly: true,
    notes: 'goose.conf extensions（MCP/插件）',
  },
  {
    id: 'agy', display: 'Antigravity CLI (agy)', mechanisms: ['hooks'],
    // 2026-09-21：补 `~/.gemini/config/hooks.json` 作**home 相对**探针。
    // 此前只探 `%LOCALAPPDATA%/agy/bin/agy.exe`（绝对路径、且 Windows 专属）——
    // 于是 doctor/probe 的 `--home` 覆盖在 agy 上完全失效（测试无法做密闭的假 home），
    // 且在 macOS/Linux 上永远判「未安装」。hooks.json 在位即说明该 Agent 在本机接线过。
    configRel: ['.gemini/config/hooks.json'], configAbs: ['%LOCALAPPDATA%/agy/bin/agy.exe'],
    probePaths: ['.gemini/config/hooks.json'], probeAbs: ['%LOCALAPPDATA%/agy/bin/agy.exe'],
    notes: '~/.gemini/config/hooks.json PreToolUse(run_command) → agy-dangerous-commands.ps1；D3(2026-09-06)',
  },
  {
    id: 'workbuddy', display: 'WorkBuddy (CodeBuddy Code desktop)', mechanisms: ['hooks'],
    // 2026-09-27：探针一律用 **home 相对**路径（同 agy 2026-09-21 的教训：绝对探针会让
    // `--home <fake>` 密闭失效，并在 macOS/Linux 上永远判「未安装」）。
    // settings.json 只要装了 WorkBuddy 就在，hooks 目录作为第二证据（我方 hook 落点）。
    configRel: ['.workbuddy/settings.json'], probePaths: ['.workbuddy/settings.json', '.workbuddy/hooks'],
    notes: 'CC 兼容 PreToolUse（~/.workbuddy/settings.json）→ dangerous-commands.ps1（ps1 规则引擎）；平台自带 safe-delete，必须以 RG_ALLOW_DELETE=1 委派删除；D2(2026-09-27 自动判定实测)',
  },
];

/** 去掉结尾的分隔符（线性扫描；不要用 `/[\\/]+$/` —— CodeQL 会判 polynomial-redos） */
function stripTrailingSeparators(s: string): string {
  let end = s.length;
  while (end > 0 && (s[end - 1] === '\\' || s[end - 1] === '/')) end--;
  return s.slice(0, end);
}

/** 路径比较用归一（大小写、分隔符、尾斜杠不敏感） */
function samePath(a: string, b: string): boolean {
  const n = (s: string): string => stripTrailingSeparators(s).replaceAll('\\', '/').toLowerCase();
  const na = n(a);
  return na !== '' && na === n(b);
}

/**
 * 解析带 %ENV% 前缀的探测路径。
 *
 * `hermetic`（密闭模式）：调用方给了**非真实 home** 的 `--home` 时，`%APPDATA%` / `%LOCALAPPDATA%`
 * 按该 home 推导（Windows 默认布局 `<home>/AppData/Roaming|Local`），而不是取进程真实环境变量。
 *
 * 为什么必须如此：`configAbs` / `probeAbs` 里的绝对探针（`%LOCALAPPDATA%/agy/bin/agy.exe`、
 * `%APPDATA%/Cursor/...`）若始终按真实环境展开，`--home <假 home>` 就挡不住本机已装的 Agent ——
 * `doctor` 会在密闭的测试 home 里凭空报 `FAIL agy`（2026-09-22 实测：`cli-exit-codes` 两个用例
 * 在本机因此红、CI 因无 `~/.gemini` 而绿）。真实 home（或不显式传 home）时行为与以前完全一致。
 */
export function expandProbePath(
  p: string,
  home: string,
  env: Record<string, string | undefined> = process.env as never,
  hermetic = false,
): string {
  const map: Record<string, string> = {
    '%APPDATA%': hermetic && home ? join(home, 'AppData', 'Roaming') : (env.APPDATA ?? ''),
    '%LOCALAPPDATA%': hermetic && home ? join(home, 'AppData', 'Local') : (env.LOCALAPPDATA ?? ''),
    '%USERPROFILE%': home,
    '~': home,
  };
  for (const [k, v] of Object.entries(map)) {
    if (p.startsWith(k)) return v + p.slice(k.length);
  }
  return p;
}

/** 探测单一 agent 是否安装（只读 stat） */
export function detectAgent(desc: AgentDescriptor, opts: { home?: string; env?: Record<string, string | undefined> } = {}): AgentInstall {
  const realHome = process.env.USERPROFILE ?? process.env.HOME ?? '';
  const home = opts.home ?? realHome;
  const env = opts.env ?? (process.env as never);
  // 显式传入且不同于真实 home → 密闭模式：绝对探针按该 home 推导，不再读真实环境变量。
  const hermetic = opts.home !== undefined && !samePath(opts.home, realHome);
  const probes = [...(desc.configRel ?? []).map((r) => join(home, r)), ...(desc.configAbs ?? [])]
    .map((p) => expandProbePath(p, home, env, hermetic));
  let hit: string | null = null;
  for (const p of probes) {
    try { statSync(p); hit = p; break; } catch { /* absent */ }
  }
  return {
    id: desc.id, display: desc.display,
    installed: hit !== null, probeHit: hit,
    mechanisms: desc.mechanisms, status: hit ? 'present' : 'absent',
  };
}

/** 全员发现（只读） */
export function discoverAgents(opts: { home?: string; env?: Record<string, string | undefined> } = {}): AgentInstall[] {
  return AGENT_REGISTRY.map((d) => detectAgent(d, opts));
}

/** JSON 摘要（供 audit/doctor 统一输出） */
export function discoveryToJson(agents: AgentInstall[]): string {
  return JSON.stringify(
    agents.map((a) => ({ id: a.id, installed: a.installed, path: a.probeHit, mechanisms: a.mechanisms, status: a.status })),
    null, 2,
  );
}