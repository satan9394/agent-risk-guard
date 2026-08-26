/**
 * @riskguard/dsh — DSH 插件接线包（D2 实证 API）
 *
 * 依据 docs/dsh-api-evidence-d2.md 的真实契约实现：
 *   - tools/pre-execute waterfall：解析 exec → RiskEvent → decision → PreToolDecision
 *   - ctx.tools.guard()：注册单调不变量（永久删除 / 自保护）
 *
 * 导出 cordis 插件入口 { name, apply(ctx, config) }，
 * 安装方式：dsh plugin --profile <name> add <本包路径>，再在 cordis.patch.yml insert。
 *
 * 纯决策：本包不产生 child_process / 文件写入 / 网络副作用（约束：文档 §10.1）。
 */

import { evaluateDsh, guardAdvisory } from '../../adapters/dsh/src/index.ts';
import { defaultPolicy } from '../../core/src/rules/default-policy.ts';
import { evaluate } from '../../core/src/policy-engine.ts';
import type { Policy } from '../../core/src/policy-engine.ts';
import { resolveReal, isWithin } from '../../core/src/path-resolver.ts';
import { extractTargetsFromCommand, classifyShellCommand } from '../../core/src/normalize.ts';

/** guard 不变量语：classify 判为 delete/destructive 的命令 → 单调拒绝（P2-3：guard 与 classify 单一事实源） */
export function permanentDeleteGuardReason(cmd: string): string | undefined {
  const cls = classifyShellCommand(cmd);
  if (!cls) return undefined;
  if (cls.domain === 'filesystem' && (cls.action === 'delete' || cls.action === 'recursive_delete' || cls.action === 'overwrite' || cls.action === 'truncate')) {
    return 'RiskGuard 不变量：永久删除/覆盖禁止（回收站铁律）';
  }
  if (cls.domain === 'process' && cls.destructive) {
    return 'RiskGuard 不变量：破坏性执行禁止（内容不可见/远程管道）';
  }
  if (cls.domain === 'git') {
    return 'RiskGuard 不变量：git 不可逆操作禁止（clean/reset/force push/删分支/restore）';
  }
  if (cls.domain === 'credentials' && cls.action === 'credential_export') {
    return 'RiskGuard 不变量：凭据导出禁止';
  }
  return undefined;
}

/**
 * M7 junction/symlink 逃逸检查（异步）：删除命令的目标真实物理路径若在
 * workspace 外 → 返回拒绝原因。字符串级 canonical 判不出 junction，
 * fs.realpath 揭穿（见 core/test/path-junction.test.ts D3 实测）。
 */
export async function checkJunctionEscape(exec: DshExec, wsRoot?: string): Promise<string | undefined> {
  const t = exec.name ?? '';
  if (t !== 'pwsh' && t !== 'bash') return undefined;
  const cmd = String(exec.arguments?.command ?? '');
  // 只对删除类命令做 realpath 检查（低误伤）；fs.rmSync 是 Node API 非 shell 命令，排除（audit P2）
  if (!/(?:^|[;&|\r\n])\s*(?:rm|Remove-Item|del|rmdir|rd|shutil\.rmtree|unlink)\b/i.test(cmd)) return undefined;
  const targets = extractTargetsFromCommand(cmd);
  if (targets.length === 0) return undefined;
  const root = wsRoot ?? process.cwd();
  for (const tg of targets) {
    const real = await resolveReal(tg.raw, undefined, process.env.USERPROFILE ?? process.env.HOME);
    // audit P0 修复：realpath 解析失败 → fail-closed 拒绝（防不存在的 symlink 目标绕过）
    if (real === null) {
      return `RiskGuard 逃逸防护：无法解析目标真实路径（${tg.raw}），fail-closed 拒绝`;
    }
    if (!isWithin(real, [root])) {
      return `RiskGuard 逃逸防护：目标经符号链接指向工作区外（${real.canonical}），拒绝`;
    }
  }
  return undefined;
}

export const name = 'riskguard-dsh';

export interface RiskGuardDshConfig {
  policy?: Policy;
  /** 注册单调 guard 的不变量（默认全开） */
  invariants?: { permanentDelete?: boolean; guardSelfProtect?: boolean };
  /** 拒绝时附加的提示头 */
  denyPrefix?: string;
}

export interface DshExec {
  name?: string;
  arguments?: { command?: string; cwd?: string } & Record<string, unknown>;
  agent?: string;
  parent?: string;
  signal?: unknown;
}

/** cordis 通用事件注册（避免类型依赖 cordis 运行时） */
type CtxLike = {
  on?: (event: string, fn: (exec: DshExec, next: () => unknown) => unknown) => unknown;
  tools?: {
    on?: (event: string, fn: (exec: DshExec, next: () => unknown) => unknown) => unknown;
    guard?: (fn: (exec: DshExec) => string | undefined) => unknown;
  };
};

/**
 * 插件入口（cordis 标准形状）。
 * @param ctx    cordis 上下文
 * @param config 用户配置（可经 cordis.patch.yml 覆盖）
 */
export function apply(ctx: CtxLike, config: RiskGuardDshConfig = {}) {
  const policy = config.policy ?? defaultPolicy();
  const on = ctx.tools?.on ?? ctx.on;
  const guard = ctx.tools?.guard;

  // 1) pre-execute 动态策略（allow → ask → deny，非单调：可被 guard 最终拒绝）
  on?.('tools/pre-execute', async (exec, next) => {
    const out = evaluateDsh(exec, (e) => evaluate(e, policy));
    if (out.decision === 'deny') {
      return { kind: 'deny', reason: `${config.denyPrefix ?? 'RiskGuard'}: ${out.reason ?? 'denied'}` + (out.safeAlternative ? ` — 请改用 ${out.safeAlternative.operation}` : '') };
    }
    if (out.decision === 'ask') {
      return { kind: 'ask', reason: `${config.denyPrefix ?? 'RiskGuard'}: ${out.reason ?? '需要确认'}` };
    }
    // M7 junction/symlink 逃逸防护（异步允许在此段做 realpath）
    const escape = await checkJunctionEscape(exec);
    if (escape) return { kind: 'deny', reason: escape };
    return next();
  });

  // 2) 单调 guard：不变量（RG-I01/I02/I03），任何 pre-execute 与后续 guard 无法推翻
  if (guard) {
    const it = config.invariants ?? { permanentDelete: true, guardSelfProtect: true };
    if (it.permanentDelete) {
      guard((exec) => {
        const t = exec.name ?? '';
        if (t !== 'pwsh' && t !== 'bash') return undefined;
        const cmd = String(exec.arguments?.command ?? '');
        return permanentDeleteGuardReason(cmd);
      });
    }
    if (it.guardSelfProtect) {
      guard((exec) => {
        const cmd = String(exec.arguments?.command ?? '');
        return /riskguard|\.risk[-_]?guard/.test(cmd) && /(^|[;&|])\s*(rm|Remove-Item|del|remove|delete|unlink|clear|format)/i.test(cmd)
          ? 'RiskGuard 自保护：禁止删除 RiskGuard 自身配置' : undefined;
      });
    }
  }

  // 3) junction/symlink 逃逸防护（M7，T10 行为级）：删除命令的目标若 realpath
  //    逃出 workspace 根则拒绝。realpath 是异步的 → 放在 pre-execute 瀑布段
  //    （guard 必须同步，故不在此注册）。字符串级 canonical 判不出 junction，
  //    此处补充运行时物理路径感知。
  return { guardAdvisory: guardAdvisory() };
}