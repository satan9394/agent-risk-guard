/**
 * scripts/run-real-conformance.ts — Real Agent Conformance Runner（v0.3.0 §三十六~§四十五）
 *
 * 用法：
 *   node scripts/run-real-conformance.ts <cursor|copilot|windsurf> [--out <dir>]
 *
 * 职责边界（§三十七/§四十五）：
 *   - 检测 agent CLI / app 是否存在 + 版本（不自动登录，不读凭据）。
 *   - 准备 D3 fixture（temp 目录 + sentinel，§三十九/§四十）。
 *   - 收集 / 落盘 evidence（机器可读 JSON，脱敏，§二十/§三十八）。
 *   - 真实「驱动 Agent 会话」是 local/manual 步骤（CI 不跑，§四十五）；本 runner 输出
 *     可重复的检测 + fixture + 脚手架，诚实记录 SKIP / UNKNOWN，绝不伪造 D3（§二十七/§三十三）。
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { buildD3Evidence, d3EvidenceToJson, validateD3Evidence, type D3Evidence, type D3TestId } from '../packages/acs/src/real-conformance.ts';

const AGENTS = ['cursor', 'copilot', 'windsurf'] as const;
type AgentId = (typeof AGENTS)[number];

interface Detection {
  installed: boolean;
  version?: string;
  cli?: string;
  reason?: string;
}

function tryVersion(cmd: string, args: string[]): { version?: string; err?: string } {
  try {
    // execSync + shell 让 Windows 的 .cmd/.bat（如 cursor.cmd）能被解析；命令与参数均为硬编码字面量（无用户输入），无注入面。
    const out = execSync(`${cmd} ${args.join(' ')}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000, shell: true }).trim();
    return { version: out.split('\n')[0]?.trim() || out };
  } catch (e) {
    return { err: (e as Error).message };
  }
}

/** 检测 agent CLI（不登录；能拿到版本即视为 installed） */
function detectAgent(agent: AgentId): Detection {
  switch (agent) {
    case 'cursor': {
      const v = tryVersion('cursor', ['--version']);
      return v.version ? { installed: true, version: v.version, cli: 'cursor' } : { installed: false, reason: 'cursor CLI not found' };
    }
    case 'copilot': {
      // Copilot CLI 是 gh 扩展（`gh copilot`）；gh 存在但扩展未装 → not installed
      const v = tryVersion('gh', ['copilot', '--version']);
      return v.version ? { installed: true, version: v.version, cli: 'gh copilot' } : { installed: false, reason: 'GitHub Copilot CLI (gh copilot) not installed' };
    }
    case 'windsurf': {
      const v = tryVersion('windsurf', ['--version']);
      return v.version ? { installed: true, version: v.version, cli: 'windsurf' } : { installed: false, reason: 'windsurf CLI not found' };
    }
  }
}

/** 准备 sentinel fixture（§三十九/§四十：temp 目录，绝不碰真实项目/home） */
function prepareSentinel(): { dir: string; sentinel: string } {
  const dir = join(tmpdir(), `riskguard-d3-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const sentinel = join(dir, 'delete-sentinel.txt');
  writeFileSync(sentinel, `riskguard-d3-sentinel-${Date.now()}\n`, 'utf8');
  return { dir, sentinel };
}

/** 为某 agent 产出 SKIP evidence（环境不存在 → SKIP，§四十四） */
function skipEvidence(agent: AgentId, detection: Detection, test: D3TestId, outDir: string): void {
  const ev = buildD3Evidence({
    agent,
    agentVersion: detection.version ?? 'unknown',
    platform: process.platform,
    test,
    riskguardDecision: 'n-a',
    toolExecuted: false,
    sideEffectPreserved: false,
    hookFailureSemantics: 'unknown',
    result: 'SKIP',
    notes: `agent environment not available: ${detection.reason ?? 'unknown'}`,
  });
  const v = validateD3Evidence(ev);
  if (!v.ok) throw new Error(`internal: invalid skip evidence: ${v.problems.join('; ')}`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${agent}-${test}.evidence.json`), d3EvidenceToJson(ev), 'utf8');
}

function main(): void {
  const args = process.argv.slice(2);
  const agent = args[0] as AgentId | undefined;
  if (!agent || !AGENTS.includes(agent)) {
    console.error(`usage: node scripts/run-real-conformance.ts <${AGENTS.join('|')}> [--out <dir>]`);
    process.exit(2);
  }
  const outIdx = args.indexOf('--out');
  const outDir = outIdx >= 0 ? args[outIdx + 1] : join(process.cwd(), 'tests', 'evidence', agent, new Date().toISOString().slice(0, 10));
  mkdirSync(outDir, { recursive: true });

  const detection = detectAgent(agent);
  console.log(`[detect] ${agent}: ${detection.installed ? `installed (${detection.version})` : `NOT installed (${detection.reason})`}`);

  if (!detection.installed) {
    for (const t of ['safe-command', 'git-reset-hard', 'permanent-delete', 'safe-replacement', 'hook-failure'] as D3TestId[]) {
      skipEvidence(agent, detection, t, outDir);
    }
    console.log(`[evidence] wrote SKIP evidence for 5 scenarios to ${outDir}（环境不存在 → SKIP，不伪造 D3）`);
    return;
  }

  // installed：准备 fixture 并输出手动会话指引（真实驱动是 local/manual，§四十五）
  const sentinel = prepareSentinel();
  console.log(`[fixture] sentinel prepared at ${sentinel.dir}`);
  console.log(`[next]   run a REAL ${agent} agent session against the fixture, then record evidence to ${outDir}`);
  console.log('         (T1 safe-command / T2 git-reset-hard / T3 permanent-delete / T4 safe-replacement / T5 hook-failure)');
}

main();
