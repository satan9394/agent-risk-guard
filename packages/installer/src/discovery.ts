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
    notes: 'TS 插件（tool.before/after）+ AGENTS.md rules',
  },
  {
    id: 'cursor', display: 'Cursor', mechanisms: ['hooks', 'rules'],
    configRel: [], configAbs: ['%APPDATA%/Cursor/User', '%APPDATA%/Cursor'],
    probePaths: [], probeAbs: ['%APPDATA%/Cursor/User'],
    notes: 'preToolUse hooks（.cursor/hooks/）+ .cursor/rules',
  },
  {
    id: 'windsurf', display: 'Windsurf', mechanisms: ['hooks'],
    configRel: [], configAbs: ['%APPDATA%/Windsurf', '%LOCALAPPDATA%/Windsurf'],
    probePaths: [], probeAbs: ['%APPDATA%/Windsurf'],
    notes: 'Cascade hooks（pre_run_command exit 2 阻断）',
  },
  {
    id: 'grok', display: 'Grok CLI', mechanisms: ['hooks'],
    configRel: [], configAbs: ['%APPDATA%/Grok', '%LOCALAPPDATA%/Grok'],
    probePaths: [], probeAbs: ['%APPDATA%/Grok'],
    notes: 'PreToolUse hook（agent-deny）；stdout JSON + exit 2',
  },
  {
    id: 'claude-code-copilot', display: 'Copilot CLI（CC 内核）', mechanisms: ['hooks', 'sandbox'],
    configRel: [], configAbs: ['%APPDATA%/github-copilot-cli'],
    probePaths: [], probeAbs: ['%APPDATA%/github-copilot-cli'],
    notes: '复用 Claude Code hooks/permissions（文档 §10.2）',
  },
  {
    id: 'hermes', display: 'Hermes', mechanisms: ['hooks'],
    configRel: [], configAbs: ['%LOCALAPPDATA%/Hermes'],
    probePaths: [], probeAbs: ['%LOCALAPPDATA%/Hermes'],
    notes: 'Claude Code 兼容 hooks（工具拦截）',
  },
  {
    id: 'cline', display: 'Cline（VSCode 扩展）', mechanisms: ['rules'],
    configRel: [], configAbs: ['%APPDATA%/Code/User/globalStorage/saoudrizwan.claude-dev'],
    probePaths: [], probeAbs: ['%APPDATA%/Code/User/globalStorage/saoudrizwan.claude-dev'],
    notes: 'rules 文件（cline rules）+ settings',
  },
  {
    id: 'aider', display: 'Aider', mechanisms: ['rules'],
    configRel: ['.aider.conf.yml', '.config/aider'], probePaths: ['.aider.conf.yml'],
    notes: 'aider.conf.yml 读规则；补丁格式写入（无删除原语）',
  },
  {
    id: 'goose', display: 'Goose', mechanisms: ['plugin'],
    configRel: ['.config/goose'], probePaths: ['.config/goose'],
    notes: 'goose.conf extensions（MCP/插件）',
  },
];

/** 解析带 %ENV% 前缀的探测路径 */
export function expandProbePath(p: string, home: string, env: Record<string, string | undefined> = process.env as never): string {
  const map: Record<string, string> = { '%APPDATA%': env.APPDATA ?? '', '%LOCALAPPDATA%': env.LOCALAPPDATA ?? '', '%USERPROFILE%': home, '~': home };
  for (const [k, v] of Object.entries(map)) {
    if (p.startsWith(k)) return v + p.slice(k.length);
  }
  return p;
}

/** 探测单一 agent 是否安装（只读 stat） */
export function detectAgent(desc: AgentDescriptor, opts: { home?: string; env?: Record<string, string | undefined> } = {}): AgentInstall {
  const home = opts.home ?? (process.env.USERPROFILE ?? process.env.HOME ?? '');
  const env = opts.env ?? (process.env as never);
  const probes = [...(desc.configRel ?? []).map((r) => join(home, r)), ...(desc.configAbs ?? [])].map((p) => expandProbePath(p, home, env));
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