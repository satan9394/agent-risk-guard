/**
 * installer/doctor.ts — M6 健康检查（只读诊断）
 *
 * 对已安装的 agent 检查 RiskGuard 注入是否在位（hook id / policy name / patch id），
 * 输出每项 state: 'ok' | 'missing' | 'stale' | 'absent-agent'。
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { detectAgent, AGENT_REGISTRY } from './discovery.ts';

export interface DoctorCheck {
  agent: string;
  check: string;
  state: 'ok' | 'missing' | 'stale' | 'absent-agent';
  detail: string;
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
}

/** Claude Code：检查 settings.json 是否含 RiskGuard PreToolUse hook */
export async function checkClaudeHook(home?: string): Promise<DoctorCheck> {
  const base = home ?? process.env.USERPROFILE ?? process.env.HOME ?? '.';
  const p = join(base, '.claude', 'settings.json');
  try {
    const raw = await readFile(p, 'utf8');
    // R25 修复：识别标准 RiskGuard 接线（PreToolUse + dangerous-commands hook 命令），兼容旧 filter/permissionDecision 输出约定
    const hitCurrent = raw.includes('PreToolUse') && raw.includes('dangerous-commands');
    const hitLegacy = raw.includes('PreToolUse') && (raw.includes('permissionDecision') || raw.includes('hookSpecificOutput'));
    return { agent: 'claude-code', check: 'PreToolUse hook 注入', state: hitCurrent || hitLegacy ? 'ok' : 'missing', detail: hitCurrent || hitLegacy ? '发现 RiskGuard dangerous-commands hook' : 'settings.json 无 RiskGuard hook' };
  } catch {
    return { agent: 'claude-code', check: 'PreToolUse hook 注入', state: 'missing', detail: `未找到 ${p}` };
  }
}

/** DSH：检查任意 profile 的 cordis.patch.yml 是否含 deny-risk-commands */
export async function checkDshPatch(home?: string): Promise<DoctorCheck> {
  const base = home ?? process.env.USERPROFILE ?? process.env.HOME ?? '.';
  const profilesDir = join(base, '.dsh', 'profiles');
  try {
    const { readdir } = await import('node:fs/promises');
    const profiles = await readdir(profilesDir);
    const found = [];
    for (const prof of profiles) {
      const p = join(profilesDir, prof, 'cordis.patch.yml');
      try {
        const raw = await readFile(p, 'utf8');
        if (raw.includes('deny-risk-commands')) found.push(`${prof} ✓`);
      } catch { /* no patch */ }
    }
    return {
      agent: 'dsh', check: 'pre-execute patch（deny-risk-commands）',
      state: found.length ? 'ok' : 'missing',
      detail: found.length ? `已注入：${found.join(', ')}` : '无 profile 含 deny-risk-commands',
    };
  } catch {
    return { agent: 'dsh', check: 'pre-execute patch', state: 'missing', detail: `未找到 ${profilesDir}` };
  }
}

/** Codex（R16 改进）：检查 hooks.json 是否注册 PreToolUse 门禁 */
export async function checkCodexHook(home?: string): Promise<DoctorCheck> {
  const base = home ?? process.env.USERPROFILE ?? process.env.HOME ?? '.';
  const p = join(base, '.codex', 'hooks.json');
  try {
    const raw = await readFile(p, 'utf8');
    const hit = raw.includes('PreToolUse') && raw.includes('dangerous-commands');
    return {
      agent: 'codex', check: 'PreToolUse hook 注入（hooks.json）',
      state: hit ? 'ok' : 'missing',
      detail: hit ? '发现 PreToolUse + dangerous-commands 接线' : 'hooks.json 无 RiskGuard 门禁',
    };
  } catch {
    return { agent: 'codex', check: 'PreToolUse hook 注入（hooks.json）', state: 'missing', detail: `未找到 ${p}` };
  }
}

/** OpenCode：检查 opencode.json 的 plugin 数组是否注册 RiskGuard 插件（R25：R17 实测仅放 plugins/ 不生效） */
export async function checkOpencodePlugin(home?: string): Promise<DoctorCheck> {
  const base = home ?? process.env.USERPROFILE ?? process.env.HOME ?? '.';
  const p = join(base, '.config', 'opencode', 'opencode.json');
  try {
    const raw = await readFile(p, 'utf8');
    const hit = raw.includes('destructive-operation-guard');
    return {
      agent: 'opencode', check: 'plugin 注册（opencode.json）',
      state: hit ? 'ok' : 'missing',
      detail: hit ? '发现 destructive-operation-guard 插件注册' : 'opencode.json plugin 未注册 RiskGuard',
    };
  } catch {
    return { agent: 'opencode', check: 'plugin 注册（opencode.json）', state: 'missing', detail: `未找到 ${p}` };
  }
}

/** 全员体检 */
export async function runDoctors(opts: { home?: string } = {}): Promise<DoctorReport> {
  const home = opts.home ?? process.env.USERPROFILE ?? process.env.HOME ?? '.';
  const checks: DoctorCheck[] = [];
  checks.push(await checkClaudeHook(home));
  checks.push(await checkDshPatch(home));
  checks.push(await checkCodexHook(home)); // R16：codex hooks.json 真实接线检查
  checks.push(await checkOpencodePlugin(home)); // R25：opencode.json plugin 注册检查
  // 其他 agent：按 discovery 判断「已装但无注入」为 missing（供报告），未装为 absent-agent
  for (const desc of AGENT_REGISTRY) {
    if (desc.id === 'codex' || desc.id === 'opencode') continue; // 已由专属检查覆盖
    const inst = detectAgent(desc, { home });
    if (inst.installed && desc.mechanisms.includes('hooks') === false && desc.id !== 'claude-code') {
      checks.push({ agent: desc.id, check: '注入检查（rules/policy）', state: 'missing', detail: `${desc.display} 已安装，注入点待接入` });
    }
    if (!inst.installed && !['dsh', 'claude-code', 'codex'].includes(desc.id)) {
      checks.push({ agent: desc.id, check: 'agent 未安装', state: 'absent-agent', detail: `${desc.display} 未检测到` });
    }
  }
  return { ok: checks.every((c) => c.state === 'ok' || c.state === 'absent-agent'), checks };
}