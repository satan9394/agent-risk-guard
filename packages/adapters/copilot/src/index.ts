/**
 * @riskguard/adapter-copilot — GitHub Copilot CLI preToolUse Adapter（v0.3.0，D1 文档确认 / D2 payload 单测）
 *
 * 官方机制（docs.github.com/copilot/reference/hooks-reference，2026-09 核查）：
 *   - hook 配置格式：{ "version": 1, "hooks": { "preToolUse": [ { "type": "command",
 *     "exec"|"bash"|"powershell"|"command", "cwd", "env", "timeoutSec" } ] } }
 *   - 加载顺序：policy → user → project → plugins，同名 event 全来源合并运行。
 *   - 位置（Copilot CLI）：
 *       Policy（machine-wide，不可被 disableAllHooks 关闭，§二十八）：
 *         Windows  C:\ProgramData\GitHub\Copilot\policy.d\*.json
 *                  + HKLM\Software\Policies\GitHub\Copilot（每 subkey 一个 Policy REG_SZ = JSON 策略文档）
 *         Linux/macOS  /etc/github-copilot/policy.d/*.json（须 root 拥有、非 group/world-writable）
 *       User：%USERPROFILE%\.copilot\hooks\ 或 $COPILOT_HOME/hooks/
 *       Repo：.github/hooks/*.json；inline：.github/copilot/settings.json / ~/.copilot/settings.json
 *   - 输入 payload 与 Claude Code 兼容（tool_name / tool_input.command / cwd）。
 *   - 阻断输出（§三十二：不能只根据文档升 D3）：JSON 顶层 permissionDecision 或
 *     hookSpecificOutput.permissionDecision 或 exit code 2；copilot-cli issue #3874（2026-06）
 *     显示 preToolUse deny 在部分版本存在「不阻断」回归 → failMode 诚实记 unknown，不标 D3。
 *
 * 定位：adapter 已实现（D1/D2）；真实 D3 待本机安装 Copilot CLI 后验证（当前 SKIP）。
 */

import type { RiskEvent } from '../../../core/src/event.ts';
import type { Decision } from '../../../core/src/decision.ts';
import { normalizeEvent, classifyShellCommand, isReadOnlyCommand } from '../../../core/src/normalize.ts';
import type { NormalizeOutcome } from '../../../core/src/normalize.ts';

export interface CopilotPayload {
  tool_name?: string;
  toolName?: string;
  tool?: string;
  tool_input?: Record<string, unknown> & { command?: string; file_path?: string; filePath?: string; path?: string };
  toolInput?: Record<string, unknown> & { command?: string; file_path?: string; filePath?: string; path?: string };
  input?: Record<string, unknown> & { command?: string; file_path?: string; filePath?: string; path?: string };
  cwd?: string;
}

/** 工具名 → domain/action（非 shell 工具静态映射，对齐 claude adapter TOOL_MAP） */
const TOOL_MAP: Record<string, { domain: 'filesystem'; action: 'write' | 'edit' | 'delete' }> = {
  Write: { domain: 'filesystem', action: 'write' },
  Edit: { domain: 'filesystem', action: 'edit' },
  MultiEdit: { domain: 'filesystem', action: 'edit' },
  Delete: { domain: 'filesystem', action: 'delete' },
  NotebookEdit: { domain: 'filesystem', action: 'edit' },
};

const SHELL_TOOLS = ['bash', 'powershell', 'pwsh', 'sh', 'zsh', 'cmd'];

export function parseCopilotPayload(payload: CopilotPayload, home?: string): NormalizeOutcome {
  // null/非对象 → fail-closed（RG-I04：非法输入绝不静默放行）
  if (payload === null || typeof payload !== 'object') {
    return { ok: false, reason: 'invalid copilot payload (not an object)', raw: payload };
  }
  const tool = (payload.tool_name ?? payload.toolName ?? payload.tool ?? '').trim();
  const input = (payload.tool_input ?? payload.toolInput ?? payload.input ?? {}) as Record<string, unknown>;
  const cwd = payload.cwd;

  // 空 tool → 无法可靠分类 → fail-closed（P1-33 同向：空 payload 不放行）
  if (tool.length === 0) {
    return { ok: false, reason: 'empty tool name in copilot preToolUse', raw: payload };
  }

  // shell 工具（大小写不敏感，P0-31 同向）：空 command → fail-closed
  const t = tool.toLowerCase();
  if (SHELL_TOOLS.includes(t) || typeof input.command === 'string') {
    if (typeof input.command !== 'string' || input.command.trim().length === 0) {
      return { ok: false, reason: `invalid/empty command for shell tool ${tool}`, raw: payload };
    }
    const classified = classifyShellCommand(input.command);
    if (classified) {
      return normalizeEvent({
        agent: 'copilot', surface: 'preToolUse', tool,
        domain: classified.domain, action: classified.action, destructive: classified.destructive,
        commandRaw: input.command, cwd, home, workspaceRoot: cwd,
      });
    }
    if (isReadOnlyCommand(input.command)) {
      return normalizeEvent({
        agent: 'copilot', surface: 'preToolUse', tool,
        domain: 'filesystem', action: 'read', commandRaw: input.command, cwd, home, workspaceRoot: cwd,
      });
    }
    return normalizeEvent({
      agent: 'copilot', surface: 'preToolUse', tool,
      domain: 'process', action: 'execute', commandRaw: input.command, cwd, home, workspaceRoot: cwd,
    });
  }

  // 已知结构化工具
  const mapped = TOOL_MAP[tool];
  if (mapped) {
    const path = input.file_path ?? input.filePath ?? input.path;
    return normalizeEvent({
      agent: 'copilot', surface: 'preToolUse', tool,
      domain: mapped.domain, action: mapped.action,
      targetsRaw: path ? [path as string] : [],
      cwd, home, workspaceRoot: cwd,
    });
  }

  // 未知工具（含 MCP）：无法可靠分类 → 保守 filesystem.write（fail-closed 方向）
  const path = input.file_path ?? input.filePath ?? input.path;
  return normalizeEvent({
    agent: 'copilot', surface: 'preToolUse', tool,
    domain: 'filesystem', action: 'write',
    targetsRaw: path ? [path as string] : [],
    cwd, home, workspaceRoot: cwd,
  });
}

/**
 * Decision → Copilot 阻断输出。
 * 双保险：stdout 写 hookSpecificOutput（Claude 兼容） + exit code 2（Copilot 约定 deny）。
 * issue #3874 显示两者在部分版本仍可能不阻断 → 见 adapter 头注释的 failMode 说明。
 */
export function renderCopilotDecision(decision: Decision): { output: string; exitCode: number } {
  if (decision.decision === 'deny') {
    const reason = decision.reason ?? 'denied';
    const output = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `RiskGuard: ${reason}` +
          (decision.safeAlternative ? ` 安全替代：${decision.safeAlternative.operation}` : ''),
      },
    });
    return { output, exitCode: 2 };
  }
  return { output: '{}', exitCode: 0 };
}

export function evaluateCopilot(payload: CopilotPayload, decide: (e: RiskEvent) => Decision, home?: string): { output: string; exitCode: number } {
  const out = parseCopilotPayload(payload, home);
  if (!out.ok) {
    return { output: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'RiskGuard: payload 解析失败 (fail-closed)' } }), exitCode: 2 };
  }
  return renderCopilotDecision(decide(out.event));
}

// ============================================================================
// Layer B — Machine Policy（§二十七/§二十八：policy.d / HKLM，需管理员权限）
// ============================================================================

/** Windows policy.d 目录（官方，§二十八） */
export const COPILOT_POLICY_DIR_WINDOWS = 'C:\\ProgramData\\GitHub\\Copilot\\policy.d';
/** Windows Registry policy 根键（官方，§二十八） */
export const COPILOT_POLICY_REGISTRY_KEY = 'HKLM\\Software\\Policies\\GitHub\\Copilot';
/** Linux/macOS policy.d 目录（官方，§二十八） */
export const COPILOT_POLICY_DIR_POSIX = '/etc/github-copilot/policy.d';
/** 用户级 hooks 目录（Windows，官方） */
export const COPILOT_USER_HOOKS_DIR_WINDOWS = '%USERPROFILE%\\.copilot\\hooks';

/**
 * 生成 machine-level policy hook 配置文档（§二十八）。
 * 注意：policy hook 是给企业 IT 管理员用的（需提权安装），普通用户不可改；
 * 本函数只产配置 JSON 模板，不写入系统目录。返回值可直接落盘为 policy.d/*.json。
 */
export function copilotPolicyHookConfig(runtimeCommand: string): string {
  return JSON.stringify(
    {
      version: 1,
      hooks: {
        preToolUse: [
          {
            type: 'command',
            exec: runtimeCommand,
            args: [],
            timeoutSec: 30,
          },
        ],
      },
    },
    null,
    2,
  );
}

/** 用户级 preToolUse hook 配置模板（Layer A，§二十七：普通 hook） */
export function copilotUserHookConfig(runtimeCommand: string): string {
  return JSON.stringify(
    {
      version: 1,
      hooks: {
        preToolUse: [{ type: 'command', exec: runtimeCommand, args: [], timeoutSec: 30 }],
      },
    },
    null,
    2,
  );
}
