/**
 * installer/runtime-probe.ts — 统一 runtime probe（v0.1.1）
 *
 * status / doctor / install-verification 全部消费同一个 probeAgentRuntime()，
 * 避免「status 一套、doctor 一套、install verification 又一套」导致状态不一致。
 *
 * ACTIVE 定义（v0.1.1 收紧）：
 *   Agent detected + manifest present + config wiring present
 *   + referenced artifact exists + artifact integrity valid
 *   + runtime dependency available + self-test PASS
 *
 * 缺任何关键项 → INSTALLED（wiring 在但未过完整验证）或 BROKEN（应装但失效）。
 */

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readConfig } from './config-read.ts';
import { hasManifest } from './manifest.ts';
import { detectAgent, AGENT_REGISTRY } from './discovery.ts';
import { sha256File } from './hash.ts';
import type { RuntimeState } from './runtime-state.ts';

export interface RuntimeProbeResult {
  agent: string;
  home: string;
  detected: boolean;
  manifestPresent: boolean;
  configValid: boolean;         // 目标配置文件可解析
  wired: boolean;               // 配置含 RiskGuard wiring（hook/plugin 引用）
  hookCommand?: string;         // wiring 指向的执行命令（claude/codex）
  hookTargetExists: boolean;    // hook command 解析出的 script 文件存在
  artifactPresent: boolean;     // 引用的 artifact（opencode plugin 文件）存在
  artifactIntegrity: boolean | null; // artifact hash 与期望一致（null=无 artifact 要求）
  runtimeAvailable: boolean;    // node 运行时可用
  selfTestPassed: boolean;      // hook self-test（无害→ALLOW，危险→DENY）
  selfTestDetail?: string;
  state: RuntimeState;
  /** 人类可读证据行 */
  evidence: string[];
}

/** hook 无害 self-test payload（必须被 ALLOW / 空允许） */
const HARMLESS_PAYLOAD = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo riskguard-self-test' } });
/** hook 危险 self-test payload（必须被 DENY；仅测 parser/policy，不真正执行任何命令） */
const DANGEROUS_PAYLOAD = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git reset --hard HEAD' } });

/** 从 hook command 提取 "node <script>" 的 script 路径；无则 null */
function extractHookScript(command: string | undefined): string | null {
  if (!command) return null;
  const m = command.match(/(?:node|node\.exe)\s+"([^"]+)"/i) ?? command.match(/(?:node|node\.exe)\s+'([^']+)'/i);
  if (m) return m[1];
  // 形如 node "C:\...\pre-tool-hook.ts" --agent claude
  const alt = command.match(/(?:^|\s)node(?:\s+--[^\s]+)*\s+"?([^"\s]+pre-tool-hook\.ts)"?/i);
  return alt ? alt[1] : null;
}

/** 对 claude/codex 类 hook：spawn pre-tool-hook.ts，验证 无害→allow、危险→deny */
function runHookSelfTest(script: string, agent: 'claude' | 'codex'): { ok: boolean; detail: string } {
  if (!existsSync(script)) return { ok: false, detail: `hook script missing: ${script}` };
  try {
    // 无害 → 期望 allow（claude: '{}' / codex: '{}' exit 0）
    const safe = spawnSync(process.execPath, [script, '--agent', agent], { input: HARMLESS_PAYLOAD, encoding: 'utf8', timeout: 20000 });
    const safeOut = (safe.stdout ?? '').trim();
    const safeAllowed = safe.status === 0 && (safeOut === '{}' || !safeOut.toLowerCase().includes('deny'));
    if (!safeAllowed) return { ok: false, detail: `self-test: harmless payload not allowed (status=${safe.status} out=${safeOut.slice(0, 120)})` };

    // 危险（git 硬重置，仅 parser/policy 层）→ 期望 deny
    const danger = spawnSync(process.execPath, [script, '--agent', agent], { input: DANGEROUS_PAYLOAD, encoding: 'utf8', timeout: 20000 });
    const dangerOut = (danger.stdout ?? '').trim();
    const denied = agent === 'codex'
      ? danger.status === 2 && dangerOut.includes('deny')
      : dangerOut.includes('permissionDecision') && dangerOut.includes('deny');
    if (!denied) return { ok: false, detail: `self-test: dangerous payload not denied (status=${danger.status} out=${dangerOut.slice(0, 120)})` };
    return { ok: true, detail: 'self-test PASS (harmless=allow, dangerous=deny)' };
  } catch (e) {
    return { ok: false, detail: `self-test error: ${(e as Error).message}` };
  }
}

async function configValidAt(p: string): Promise<boolean> {
  const r = await readConfig(p);
  return r.state === 'valid' || r.state === 'missing'; // missing 视为 config 层通过（无损坏）
}

/**
 * 探测单个 Agent 的 runtime。
 * @param agent canonical id（claude-code / codex / opencode / dsh …）
 * @param opts.deep 是否执行 self-test（status/doctor 默认 false 以免每次 spawn；install-verification 传 true）
 */
export async function probeAgentRuntime(
  agent: string,
  opts: { home?: string; deep?: boolean; runtimeAvailableOverride?: boolean } = {},
): Promise<RuntimeProbeResult> {
  const base = opts.home ?? process.env.USERPROFILE ?? process.env.HOME ?? '.';
  const desc = AGENT_REGISTRY.find((d) => d.id === agent);
  const detected = agent === 'dsh'
    ? (existsSync(join(base, '.dsh')) || existsSync(join(base, '.dsh', 'profiles')))
    : detectAgent(desc ?? { id: agent, display: agent, mechanisms: [], probePaths: [] }, { home: base }).installed;

  const ev: string[] = [];
  const manifestPresent = await hasManifest(agent, base);

  // 默认值
  let configValid = true;
  let wired = false;
  let hookCommand: string | undefined;
  let artifactPresent = false;
  let artifactIntegrity: boolean | null = null;
  let runtimeAvailable = opts.runtimeAvailableOverride ?? (process.execPath ? true : false);
  let hookTargetExists = false;
  let selfTestPassed = false;
  let selfTestDetail: string | undefined;

  if (!detected) {
    ev.push('agent not detected');
    return { agent, home: base, detected: false, manifestPresent, configValid: false, wired: false, artifactPresent: false, artifactIntegrity: null, runtimeAvailable, selfTestPassed: false, state: 'NOT_DETECTED', evidence: ev };
  }
  ev.push('agent detected');

  // ---- wiring / artifact / self-test 按 agent ----
  try {
    if (agent === 'claude-code' || agent === 'codex') {
      const p = agent === 'claude-code' ? join(base, '.claude', 'settings.json') : join(base, '.codex', 'hooks.json');
      const read = await readConfig(p);
      if (read.state === 'invalid-json' || read.state === 'permission-denied' || read.state === 'io-error') {
        configValid = false;
        ev.push(`config invalid: ${p}`);
      } else if (read.state === 'valid') {
        const data = read.data;
        // 找到我方 hook entry（_riskguard / id riskguard-*）
        const hookArr = (data['hooks'] as any)?.['PreToolUse'];
        const mine = Array.isArray(hookArr)
          ? (hookArr as any[]).find((h) => h?._riskguard === true || h?.id === (agent === 'claude-code' ? 'riskguard-pre-tool-hook' : 'riskguard-codex-hook'))
          : undefined;
        if (mine?.hooks?.[0]?.command) {
          hookCommand = mine.hooks[0].command as string;
          wired = true;
          ev.push(`wiring present: ${hookCommand.slice(0, 100)}`);
        } else {
          ev.push('no RiskGuard hook entry found in config');
        }
        // 兼容旧 dangerous-commands 接线也算 wired（doctor 语义），但 self-test 仍需 hook 命令
        if (!wired && JSON.stringify(data).includes('dangerous-commands')) {
          wired = true;
          ev.push('legacy dangerous-commands wiring present');
        }
      }
      // hook target 存在性
      const script = extractHookScript(hookCommand);
      if (script) {
        hookTargetExists = existsSync(script);
        ev.push(`hook target ${hookTargetExists ? 'exists' : 'MISSING'}: ${script}`);
      }
      // self-test（deep）
      if (wired && script && hookTargetExists) {
        if (opts.deep !== false) {
          if (!runtimeAvailable) {
            selfTestPassed = false;
            selfTestDetail = 'node runtime unavailable — self-test skipped';
            ev.push(selfTestDetail);
          } else {
            const st = runHookSelfTest(script, agent === 'claude-code' ? 'claude' : 'codex');
            selfTestPassed = st.ok;
            selfTestDetail = st.detail;
            ev.push(st.detail);
          }
        } else {
          // 非 deep：默认认为 self-test 未跑 → 不算 PASS
          selfTestPassed = false;
          selfTestDetail = 'deep self-test not requested';
        }
      } else if (wired && script && !hookTargetExists) {
        selfTestDetail = 'hook target missing — cannot self-test';
        ev.push(selfTestDetail);
      }
    } else if (agent === 'opencode') {
      const p = join(base, '.config', 'opencode', 'opencode.json');
      const read = await readConfig(p);
      if (read.state === 'invalid-json' || read.state === 'permission-denied' || read.state === 'io-error') {
        configValid = false;
        ev.push(`config invalid: ${p}`);
      } else if (read.state === 'valid') {
        const plugins = (read.data['plugin'] as unknown[]) ?? [];
        const refNew = plugins.find((x) => String(x).replace(/\\/g, '/').split('/').pop() === 'agent-risk-guard.ts');
        const refLegacy = plugins.find((x) => String(x).replace(/\\/g, '/').split('/').pop() === 'destructive-operation-guard.ts');
        wired = Boolean(refNew || refLegacy);
        if (wired) {
          ev.push(`plugin reference present (${refNew ? 'agent-risk-guard' : 'destructive-operation-guard'})`);
          // artifact 存在 + hash 校验
          const plugFile = join(base, '.config', 'opencode', 'plugins', refNew ? 'agent-risk-guard.ts' : 'destructive-operation-guard.ts');
          artifactPresent = existsSync(plugFile);
          ev.push(`artifact ${artifactPresent ? 'exists' : 'MISSING'}: ${plugFile}`);
          if (artifactPresent) {
            // 与仓库 artifact hash 比对（REPO asset 存在时）
            const repoAsset = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'assets', 'opencode', 'agent-risk-guard.ts');
            if (existsSync(repoAsset)) {
              const [h1, h2] = [await sha256File(plugFile), await sha256File(repoAsset)];
              artifactIntegrity = h1 === h2;
              ev.push(`artifact integrity ${artifactIntegrity ? 'OK' : 'MISMATCH (user-modified?)'}`);
            } else {
              artifactIntegrity = null;
              ev.push('repo artifact unavailable — integrity not checked');
            }
          }
        } else {
          ev.push('no RiskGuard plugin reference in opencode.json');
        }
      }
      // opencode self-test：无统一可 spawn 的 CLI hook；以 artifact + 引用 +（可选）语法解析代替。
      // 这里把 selfTestPassed 定义为 artifact 完整性通过（opencode 插件无单文件 hook 入口）。
      selfTestPassed = wired && artifactPresent && (artifactIntegrity !== false);
      selfTestDetail = selfTestPassed ? 'opencode wiring verified (reference + artifact + integrity)' : 'opencode verification incomplete';
      if (wired && artifactPresent) ev.push(selfTestDetail);
    } else if (agent === 'dsh') {
      const { checkDshPatch } = await import('./doctor.ts');
      const chk = await checkDshPatch(base);
      wired = chk.state === 'ok';
      configValid = true;
      artifactPresent = true;
      artifactIntegrity = null;
      runtimeAvailable = true;
      selfTestPassed = wired; // dsh patch 在位视为通过（无 CLI hook 可 spawn）
      selfTestDetail = wired ? 'deny-risk-commands patch present' : 'no deny-risk-commands patch';
      ev.push(selfTestDetail);
    }
  } catch (e) {
    ev.push(`probe error: ${(e as Error).message}`);
  }

  // ---- state 判定（v0.1.1：ACTIVE 必须证明运行链路）----
  let state: RuntimeState;
  if (!detected) {
    state = 'NOT_DETECTED';
  } else if (agent === 'dsh') {
    // dsh 非 manifest 管理：patch 在位且配置有效 → ACTIVE
    state = wired && configValid ? 'ACTIVE' : 'DETECTED';
  } else if (!manifestPresent) {
    state = 'DETECTED';
  } else {
    // 有 manifest。分 agent 判定完整健康：
    //  claude/codex：configValid && wired && hookTargetExists && runtimeAvailable && selfTestPassed
    //  opencode：    configValid && wired && artifactPresent && artifactIntegrity !== false && runtimeAvailable
    const criticalOk = agent === 'opencode'
      ? configValid && wired && artifactPresent && artifactIntegrity !== false
      : configValid && wired && hookTargetExists;
    const selftestOk = agent === 'opencode'
      ? selfTestPassed // = wiring + artifact + integrity
      : selfTestPassed;
    if (opts.deep === true) {
      // deep（install verification / doctor / status）：必须 self-test 真过才算 ACTIVE
      // 先判明确缺陷（显式损坏 → BROKEN，不是「未验证」）
      const explicitDefect = !runtimeAvailable || (agent === 'opencode'
        ? !configValid || (wired && !artifactPresent) || (wired && artifactIntegrity === false)
        : !configValid || (wired && hookCommand && !hookTargetExists));
      if (explicitDefect) {
        state = 'BROKEN';
        ev.push(!runtimeAvailable ? 'node runtime unavailable → BROKEN' : (agent === 'opencode' ? 'artifact missing/tampered or config invalid → BROKEN' : 'hook target missing or config invalid → BROKEN'));
      } else {
        const complete = criticalOk && runtimeAvailable && selftestOk;
        if (complete) {
          state = 'ACTIVE';
          ev.push('runtime self-test PASS → ACTIVE');
        } else if (wired && configValid && (agent === 'opencode' ? artifactPresent : hookTargetExists)) {
          state = 'INSTALLED';
          ev.push('wiring present but full runtime self-test not passed → INSTALLED');
        } else {
          state = 'BROKEN';
          ev.push('critical wiring/artifact missing → BROKEN');
        }
      }
    } else {
      // 浅探（无 self-test 证据）：
      //  - 明显损坏（config 坏 / hook target 丢 / artifact 丢 / hash 变）→ BROKEN
      //  - 否则无法证明 self-test → 最多 INSTALLED
      if (!configValid || (agent === 'opencode' ? (wired && !artifactPresent) || (wired && artifactIntegrity === false) : wired && hookCommand && !hookTargetExists)) {
        state = 'BROKEN';
        ev.push('visible wiring/artifact defect → BROKEN');
      } else if (wired) {
        state = 'INSTALLED';
        ev.push('wiring present; deep self-test needed for ACTIVE');
      } else {
        state = 'BROKEN';
        ev.push('manifest present but no wiring → BROKEN');
      }
    }
  }

  return {
    agent, home: base, detected, manifestPresent, configValid, wired,
    hookCommand, hookTargetExists, artifactPresent, artifactIntegrity,
    runtimeAvailable, selfTestPassed, selfTestDetail, state, evidence: ev,
  };
}

/** 便于测试的浅探测 */
export async function probeShallow(agent: string, home?: string): Promise<RuntimeProbeResult> {
  return probeAgentRuntime(agent, { home, deep: false });
}
