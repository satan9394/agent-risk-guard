/**
 * @riskguard/adapter-mcode — MiniMax Code (mcode 0.7.0) PreToolUse Adapter
 *
 * payload 形状（mcode 0.7.0，CC 兼容 hook；stdin JSON）：
 *   { hook_event_name, session_id, turn_id, transcript_path, cwd, model,
 *     permission_mode, tool_name, tool_input, tool_use_id }
 * 阻断输出（exit 0，与 Claude Code 相同）：
 *   { hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: '...' }, systemMessage: '...' }
 *
 * 与 claude adapter 的**两处本质差别**（照抄 claude 会 fail-open，见 docs/adding-an-agent.md §2.4）：
 *   ① 工具名有两个来源：映射成功后是 `Bash` / `PowerShell`（Windows），映射校验失败时**保留内部名**
 *      `bash` / `read` / `write` / `edit`。所以 shell 判定必须大小写不敏感地认这两套。
 *   ② 内部名形状无法静态验证 —— 若是 shell 工具却取不到非空 `command` 字符串，必须
 *      **fail-closed**（RG-I04）。⚠️ 不要沿用 claude adapter 的「未知工具 → filesystem.write」兜底：
 *      对 mcode 而言那等于把一条 shell 调用当写入放行。
 *
 * 本模块只做形状转换，**不含任何规则**（规则单源见 packages/core/src/rules/default-policy.ts）。
 */

import type { RiskEvent } from '../../../core/src/event.ts';
import type { Decision } from '../../../core/src/decision.ts';
import { normalizeEvent, classifyShellCommand, isReadOnlyCommand } from '../../../core/src/normalize.ts';
import type { NormalizeOutcome } from '../../../core/src/normalize.ts';

export interface McodePayload {
  hook_event_name?: string;   // 'PreToolUse'
  session_id?: string;
  turn_id?: string;
  transcript_path?: string | null;
  cwd?: string;
  model?: string;
  /** 平台权限模式（default/auto/bypass/off）；RiskGuard 不解释它，hook 在 bypass 下仍应执行（待 D3 实测） */
  permission_mode?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown> & { command?: unknown; file_path?: string; filePath?: string; path?: string };
  tool_use_id?: string;
}

/** shell 工具名（统一小写比较：覆盖映射名 Bash/PowerShell 与内部名 bash/powershell/pwsh/…） */
const SHELL_TOOLS = new Set(['bash', 'powershell', 'pwsh', 'sh', 'zsh', 'cmd']);

/**
 * 接线常量（安装器与巡检共用同一处定义，避免两处各写一份漂移）。
 *
 * matcher 是 mcode 侧**大小写敏感的正则**，而工具名有两个来源：映射成功后的 `Bash`（POSIX）/
 * `PowerShell`（Windows），以及映射校验失败时保留的内部名 `bash`。只写前两者时，
 * 内部名那条调用**根本不进 hook** —— 这是「看起来接上了」的典型死法。
 */
export const MCODE_HOOK_ID = 'riskguard-mcode-hook';
export const MCODE_HOOK_MATCHER = 'Bash|PowerShell|bash';

/**
 * 文件 / 子 Agent 工具 → domain/action（小写键，一次覆盖「映射名」与「内部名」两种写法）。
 * task ↔ Agent 是子 Agent 派发 → process.execute（策略给 ask；渲染层不译 ask，见 renderMcodeDecision）。
 */
const MCODE_TOOL_MAP: Record<string, { domain: 'filesystem' | 'process'; action: 'write' | 'edit' | 'read' | 'execute' }> = {
  read: { domain: 'filesystem', action: 'read' },
  write: { domain: 'filesystem', action: 'write' },
  edit: { domain: 'filesystem', action: 'edit' },
  multiedit: { domain: 'filesystem', action: 'edit' },
  task: { domain: 'process', action: 'execute' },
};

/**
 * mcode payload → RiskEvent。
 * 失败返回 { ok:false }，调用方必须 fail-closed（RG-I04）。
 */
export function parseMcodePayload(payload: McodePayload, home?: string): NormalizeOutcome {
  const tool = payload.tool_name ?? '';
  const input = payload.tool_input ?? {};
  const cwd = payload.cwd;
  const lower = tool.toLowerCase();

  // ① shell 类（含内部名）：命令必须是非空字符串，否则 fail-closed
  if (SHELL_TOOLS.has(lower)) {
    const cmd = input.command;
    if (typeof cmd !== 'string' || cmd.trim().length === 0) {
      // 内部形状（未通过 mcode 的 Claude 形状校验）走到这里 —— 无法静态验证 → 拒绝，不是放行
      return { ok: false, reason: `invalid/empty command for shell tool ${tool || '(empty)'} (mcode internal shape?)`, raw: payload };
    }
    const classified = classifyShellCommand(cmd);
    if (classified) {
      return normalizeEvent({
        agent: 'mcode', surface: 'PreToolUse', tool,
        domain: classified.domain, action: classified.action, destructive: classified.destructive,
        commandRaw: cmd, cwd, home, workspaceRoot: cwd,
      });
    }
    if (isReadOnlyCommand(cmd)) {
      return normalizeEvent({
        agent: 'mcode', surface: 'PreToolUse', tool,
        domain: 'filesystem', action: 'read', commandRaw: cmd, cwd, home, workspaceRoot: cwd,
      });
    }
    return normalizeEvent({
      agent: 'mcode', surface: 'PreToolUse', tool,
      domain: 'process', action: 'execute', commandRaw: cmd, cwd, home, workspaceRoot: cwd,
    });
  }

  // ② 结构化文件工具 / 子 Agent
  const mapped = MCODE_TOOL_MAP[lower];
  if (mapped) {
    const target = input.file_path ?? input.filePath ?? input.path;
    return normalizeEvent({
      agent: 'mcode', surface: 'PreToolUse', tool,
      domain: mapped.domain, action: mapped.action,
      targetsRaw: typeof target === 'string' ? [target] : [],
      cwd, home, workspaceRoot: cwd,
    });
  }

  // ③ MCP / 未知工具：无法可靠分类 → 保守 unknown write（fail-closed 方向，RG-UNKNOWN-002 会 deny）
  const target = input.file_path ?? input.filePath ?? input.path;
  return normalizeEvent({
    agent: 'mcode', surface: 'PreToolUse', tool: tool || 'MCP',
    domain: 'filesystem', action: 'write',
    targetsRaw: typeof target === 'string' ? [target] : [],
    cwd, home, workspaceRoot: cwd,
  });
}

/**
 * Decision → mcode 阻断输出 JSON（exit 0）。
 *
 * 只渲染 deny：mcode 虽支持 `permissionDecision: 'ask'`，但把内部 `ask` 直译成平台审批会让
 * **同一条策略在不同 Agent 上表现相反**（claude/codex adapter 都是「非 deny 一律 {}」）。
 * 本切片保持一致；如需 ask 直通，另开决策（会改变跨端行为，属独立评审）。
 */
export function renderMcodeDecision(decision: Decision): string {
  if (decision.decision === 'deny') {
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: decision.reason ?? 'denied by RiskGuard',
      },
      // 与 claude adapter 同文案风格；保持单行，避免被平台会话级 permission.json 记成多段规则
      systemMessage: `RiskGuard: ${decision.reason ?? 'denied'}` +
        (decision.safeAlternative ? ` — 请改用 ${decision.safeAlternative.operation}` : ''),
    });
  }
  return '{}';
}

/** 完整入口：payload → 决策 JSON 字符串（供 hook 直接 print） */
export function evaluateMcode(
  payload: McodePayload,
  decide: (e: RiskEvent) => Decision,
  home?: string,
): string {
  const out = parseMcodePayload(payload, home);
  if (!out.ok) {
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `RiskGuard parse failure (fail-closed): ${out.reason}`,
      },
      systemMessage: 'RiskGuard: payload 解析失败，fail-closed 拒绝',
    });
  }
  return renderMcodeDecision(decide(out.event));
}
