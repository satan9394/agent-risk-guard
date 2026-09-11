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
 *
 * v0.1.3（G2）新增**新鲜度**信号（已装产物 vs 仓库单源），**WARN 语义**：
 *   - claude/codex：`hookScriptFreshness` / `hookScriptChecks`（hook 脚本 SHA256 vs 单源）
 *   - dsh：`dshRuleCounts` / `dshRepoRuleCount` / `dshPatchFreshness`（规则条数 vs 单源）
 *   三者均为**新增可选字段**，且**不参与 state 判定**——陈旧只降「新鲜度」，不降
 *   ACTIVE→BROKEN，也不改变退出码（用户可能有意改过脚本 / 自行加规则）。
 *   单源缺失或 hash 不可读 → null（未校验），不得误判为用户环境损坏。
 */

import { existsSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
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
  /** v0.1.2: 验证模式——dynamic=真实执行拦截 runtime self-test；static=仅 wiring/artifact/integrity；none=无足够验证 */
  verificationMode: VerificationMode;
  state: RuntimeState;
  /** 人类可读证据行 */
  evidence: string[];
  /**
   * v0.1.3 (G2): claude/codex —— 已装 hook 脚本 vs **仓库单源** 的 SHA256 新鲜度。
   *   true=一致；false=不一致（可能是陈旧或被有意修改）；null=未校验（无映射 / 单源缺失 / 读不到）。
   *   注意：**不参与 state 判定**——按 WARN 语义消费，绝不因此降 BROKEN。
   *   对 claude/codex，`artifactIntegrity` 与本节同值（便于既有消费方读到同一信号）。
   */
  hookScriptFreshness?: boolean | null;
  /** v0.1.3 (G2): 逐个被比对的 hook 脚本明细（可能多个 PreToolUse 条目） */
  hookScriptChecks?: HookScriptCheck[];
  /** v0.1.3 (G2): dsh —— 每个 profile 的 deny-risk-commands 规则条数 */
  dshRuleCounts?: { profile: string; rules: number }[];
  /** v0.1.3 (G2): dsh —— 仓库单源规则数；null = 单源缺失（未校验） */
  dshRepoRuleCount?: number | null;
  /** v0.1.3 (G2): dsh —— 规则数 vs 单源：true=齐/更多；false=不足（陈旧）；null=未校验。不参与 state 判定 */
  dshPatchFreshness?: boolean | null;
}

/** v0.1.2: ACTIVE 的验证模式（dynamic 比 static 更强，二者不应混成相同含义） */
export type VerificationMode = 'dynamic' | 'static' | 'none';

/** 默认「仓库 / portable runtime」根（packages/installer/src → 上溯 3） */
const DEFAULT_ROOT: string = (() => {
  try { return join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'); } catch { return process.cwd(); }
})();

/**
 * 已装 hook 脚本 basename（小写）→ 仓库单源相对路径候选。
 * 覆盖：ps1 通用门禁（claude/codex 旧接线）与 node 型 pre-tool-hook.ts（新接线）。
 */
const HOOK_SINGLE_SOURCE_MAP: Record<string, string[]> = {
  'dangerous-commands.ps1': [join('assets', 'hooks', 'dangerous-commands.ps1')],
  'agy-dangerous-commands.ps1': [join('assets', 'hooks', 'agy-dangerous-commands.ps1')],
  'pre-tool-hook.ts': [join('packages', 'cli', 'src', 'hooks', 'pre-tool-hook.ts')],
};

/** 单个 hook 脚本的新鲜度比对结果 */
export interface HookScriptCheck {
  /** 已装（被配置引用）的脚本绝对路径 */
  script: string;
  /** 命中的仓库单源路径；null = 无映射或单源缺失 */
  source: string | null;
  /** true=一致（含「脚本本身就是单源」的就地引用）；false=不一致；null=未校验 */
  fresh: boolean | null;
  /** 人类可读证据行 */
  detail: string;
}

/**
 * G2：计算「已装 hook 脚本 vs 仓库单源」的 SHA256 新鲜度。
 *
 * 语义边界（不得误判）：
 *   - 脚本 basename 无已知单源映射 → fresh=null（未校验），不是错误。
 *   - 仓库单源缺失（裁剪安装 / portable runtime 未带 assets）→ fresh=null（未校验），不是错误。
 *   - 任一侧 hash 读不到 → fresh=null（未校验），绝不抛错。
 *   - 脚本路径与单源**同一文件**（就地引用）→ fresh=true（内容必然相同，无陈旧可能）。
 */
export async function checkHookScriptFreshness(script: string, root: string): Promise<HookScriptCheck> {
  const candidates = HOOK_SINGLE_SOURCE_MAP[basename(script).toLowerCase()];
  if (!candidates) {
    return { script, source: null, fresh: null, detail: `no repo single source mapping for ${basename(script)} — freshness not checked` };
  }
  const source = candidates.map((rel) => resolve(root, rel)).find((p) => existsSync(p));
  if (!source) {
    return { script, source: null, fresh: null, detail: `repo single source unavailable — freshness not checked: ${basename(script)}` };
  }
  if (resolve(script) === source) {
    return { script, source, fresh: true, detail: 'hook script is the repo single source itself (in-place reference)' };
  }
  const [installedHash, sourceHash] = [await sha256File(script), await sha256File(source)];
  if (!installedHash || !sourceHash) {
    return { script, source, fresh: null, detail: 'hook script hash unavailable — freshness not checked' };
  }
  return installedHash === sourceHash
    ? { script, source, fresh: true, detail: 'hook script matches repo single source (sha256)' }
    : { script, source, fresh: false, detail: `script differs from repo single source (possibly stale): ${script}` };
}

/** 汇总多个 hook 脚本检查：任一处不一致 → false；至少一处一致且无不一致 → true；否则 null */
export function aggregateHookFreshness(checks: HookScriptCheck[]): boolean | null {
  if (checks.some((c) => c.fresh === false)) return false;
  if (checks.some((c) => c.fresh === true)) return true;
  return null;
}

/** hook 无害 self-test payload（必须被 ALLOW / 空允许） */
const HARMLESS_PAYLOAD = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo riskguard-self-test' } });
/** hook 危险 self-test payload（必须被 DENY；仅测 parser/policy，不真正执行任何命令） */
const DANGEROUS_PAYLOAD = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git reset --hard HEAD' } });

/** 从 hook command 提取脚本路径（node pre-tool-hook.ts 或 powershell dangerous-commands.ps1）；无则 null */
function extractHookScript(command: string | undefined): string | null {
  if (!command) return null;
  const m = command.match(/(?:node|node\.exe)\s+"([^"]+)"/i) ?? command.match(/(?:node|node\.exe)\s+'([^']+)'/i);
  if (m) return m[1];
  // 形如 node "C:\...\pre-tool-hook.ts" --agent claude
  const alt = command.match(/(?:^|\s)node(?:\s+--[^\s]+)*\s+"?([^"\s]+pre-tool-hook\.ts)"?/i);
  if (alt) return alt[1];
  // legacy 生产接线：powershell.exe -NoProfile ... -File "C:\...\dangerous-commands.ps1"
  const ps = command.match(/-File\s+"([^"]+\.ps1)"/i) ?? command.match(/-File\s+'([^']+\.ps1)'/i) ?? command.match(/-File\s+([^\s"]+\.ps1)/i);
  return ps ? ps[1] : null;
}

/** 对 claude/codex 类 hook：spawn pre-tool-hook.ts（node）或 dangerous-commands.ps1（powershell），验证 无害→allow、危险→deny */
function runHookSelfTest(script: string, agent: 'claude' | 'codex'): { ok: boolean; detail: string } {
  if (!existsSync(script)) return { ok: false, detail: `hook script missing: ${script}` };
  try {
    // PowerShell legacy 接线（dangerous-commands.ps1）：stdin 喂 payload，stdout 输出 CC 风格 JSON deny（exit 0）
    if (script.toLowerCase().endsWith('.ps1')) {
      const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script];
      const safe = spawnSync('powershell.exe', args, { input: HARMLESS_PAYLOAD, encoding: 'utf8', timeout: 30000 });
      const safeOut = (safe.stdout ?? '').trim();
      const safeAllowed = safe.status === 0 && (safeOut === '' || safeOut === '{}' || !safeOut.toLowerCase().includes('deny'));
      if (!safeAllowed) return { ok: false, detail: `self-test: harmless payload not allowed (status=${safe.status} out=${safeOut.slice(0, 120)})` };
      const danger = spawnSync('powershell.exe', args, { input: DANGEROUS_PAYLOAD, encoding: 'utf8', timeout: 30000 });
      const dangerOut = (danger.stdout ?? '').trim();
      const denied = dangerOut.includes('permissionDecision') && dangerOut.includes('deny');
      if (!denied) return { ok: false, detail: `self-test: dangerous payload not denied (status=${danger.status} out=${dangerOut.slice(0, 120)})` };
      return { ok: true, detail: 'self-test PASS (ps1: harmless=allow, dangerous=deny)' };
    }
    // node pre-tool-hook.ts 路径
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
  opts: { home?: string; deep?: boolean; runtimeAvailableOverride?: boolean; repoRoot?: string } = {},
): Promise<RuntimeProbeResult> {
  const base = opts.home ?? process.env.USERPROFILE ?? process.env.HOME ?? '.';
  /** 仓库 / portable runtime 根（G2 新鲜度比对的「单源」基准；可用 opts.repoRoot 覆盖，供测试与裁剪安装用） */
  const root = opts.repoRoot ?? DEFAULT_ROOT;
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
  let verificationMode: VerificationMode = 'none';
  // —— G2 新鲜度（WARN 语义；不参与 state 判定）——
  let hookScriptFreshness: boolean | null = null;
  let hookScriptChecks: HookScriptCheck[] = [];
  let dshRuleCounts: { profile: string; rules: number }[] = [];
  let dshRepoRuleCount: number | null = null;
  let dshPatchFreshness: boolean | null = null;

  if (!detected) {
    ev.push('agent not detected');
    return { agent, home: base, detected: false, manifestPresent, configValid: false, wired: false, artifactPresent: false, artifactIntegrity: null, runtimeAvailable, selfTestPassed: false, verificationMode: 'none' as const, state: 'NOT_DETECTED', evidence: ev, hookScriptFreshness: null, hookScriptChecks: [], dshRuleCounts: [], dshRepoRuleCount: null, dshPatchFreshness: null };
  }
  ev.push('agent detected');

  // ---- wiring / artifact / self-test 按 agent ----
  try {
    if (agent === 'claude-code' || agent === 'codex') {
      // claude/codex：可真实 spawn hook → dynamic
      verificationMode = 'dynamic';
      const p = agent === 'claude-code' ? join(base, '.claude', 'settings.json') : join(base, '.codex', 'hooks.json');
      const read = await readConfig(p);
      /** 配置 PreToolUse 中出现的**全部** hook 命令（G2：逐条做单源新鲜度比对） */
      const allHookCommands: string[] = [];
      if (read.state === 'invalid-json' || read.state === 'permission-denied' || read.state === 'io-error') {
        configValid = false;
        ev.push(`config invalid: ${p}`);
      } else if (read.state === 'valid') {
        const data = read.data;
        // 找到我方 hook entry（_riskguard / id riskguard-*）
        const hookArr = (data['hooks'] as any)?.['PreToolUse'];
        if (Array.isArray(hookArr)) {
          for (const h of hookArr as any[]) {
            const hs = Array.isArray(h?.hooks) ? h.hooks : [];
            for (const hh of hs) if (typeof hh?.command === 'string') allHookCommands.push(hh.command);
          }
        }
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
          // legacy 接线：提取首个含 dangerous-commands 的 PreToolUse command 作为 hookCommand
          const legacyEntry = Array.isArray(hookArr)
            ? (hookArr as any[]).find((h) => JSON.stringify(h).includes('dangerous-commands'))
            : undefined;
          const legacyCmd = legacyEntry?.hooks?.[0]?.command;
          if (typeof legacyCmd === 'string') {
            hookCommand = legacyCmd;
            ev.push(`legacy hook command: ${legacyCmd.slice(0, 100)}`);
          }
        }
      }
      // hook target 存在性
      const script = extractHookScript(hookCommand);
      if (script) {
        hookTargetExists = existsSync(script);
        ev.push(`hook target ${hookTargetExists ? 'exists' : 'MISSING'}: ${script}`);
      }
      // —— G2 新鲜度：已装 hook 脚本 vs 仓库单源（SHA256） ——
      // 覆盖配置里**全部** PreToolUse 命令（含旧 dangerous-commands 接线），逐条比对；
      // 无映射 / 单源缺失 / hash 读不到 → 未校验（null），绝不 FAIL、绝不抛错。
      const candidateScripts = [...new Set(
        [...allHookCommands, hookCommand]
          .filter((c): c is string => typeof c === 'string')
          .map((c) => extractHookScript(c))
          .filter((s): s is string => !!s && existsSync(s))
          .map((s) => resolve(s)),
      )];
      if (candidateScripts.length) {
        for (const s of candidateScripts) hookScriptChecks.push(await checkHookScriptFreshness(s, root));
        for (const c of hookScriptChecks) ev.push(c.detail);
        hookScriptFreshness = aggregateHookFreshness(hookScriptChecks);
        // G2 约定：claude/codex 用 artifactIntegrity 外传同一信号。
        // 既有消费方只在 opencode / static 分支读该字段（commands.ts），此处不会改变 state。
        artifactIntegrity = hookScriptFreshness;
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
      // opencode：验证 wiring/artifact/integrity（不 spawn 真实 interception）→ static
      verificationMode = 'static';
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
            const repoAsset = join(root, 'assets', 'opencode', 'agent-risk-guard.ts');
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
      // dsh：验证 patch 存在 + **规则条数 vs 仓库单源**（不 spawn）→ static
      verificationMode = 'static';
      const { checkDshPatchDeep } = await import('./doctor.ts');
      const deep = await checkDshPatchDeep(base, { repoRoot: root });
      wired = deep.check.state === 'ok';
      configValid = true;
      artifactPresent = true;
      artifactIntegrity = null;      // dsh 无单文件 artifact；新鲜度走 dshPatchFreshness
      runtimeAvailable = true;
      selfTestPassed = wired;        // 既有语义保持不变：patch 在位视为通过（无 CLI hook 可 spawn）
      selfTestDetail = wired ? 'deny-risk-commands patch present' : 'no deny-risk-commands patch';
      ev.push(selfTestDetail);
      // —— G2 新鲜度 ——
      dshRuleCounts = deep.profiles.filter((pr) => pr.hasPatch).map((pr) => ({ profile: pr.profile, rules: pr.rules }));
      dshRepoRuleCount = deep.repoRuleCount;
      dshPatchFreshness = deep.freshness;
      for (const pr of dshRuleCounts) ev.push(`dsh profile ${pr.profile}: ${pr.rules} rule(s) in deny-risk-commands`);
      if (dshRepoRuleCount === null) {
        if (dshRuleCounts.length) ev.push('repo single source unavailable — dsh rule-count freshness not checked');
      } else if (dshPatchFreshness === false) {
        for (const n of deep.notes) ev.push(n);
      } else if (dshPatchFreshness === true) {
        ev.push(`dsh rule count in sync with repo single source (repo ${dshRepoRuleCount})`);
      }
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
    runtimeAvailable, selfTestPassed, selfTestDetail, verificationMode, state, evidence: ev,
    hookScriptFreshness, hookScriptChecks,
    dshRuleCounts, dshRepoRuleCount, dshPatchFreshness,
  };
}

/** 便于测试的浅探测 */
export async function probeShallow(agent: string, home?: string): Promise<RuntimeProbeResult> {
  return probeAgentRuntime(agent, { home, deep: false });
}
