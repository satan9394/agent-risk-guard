/**
 * @riskguard/adapter-agy — Antigravity CLI (agy) PreToolUse Hook Adapter（v0.1，D3 Windows shell.execute 实测）
 *
 * 官方机制（antigravity.google/docs/hooks + CLI 1.1.27 实测，2026-09-06 核查）：
 *   - 全局 hooks 配置：~/.gemini/config/hooks.json（workspace: <root>/.agents/hooks.json）
 *   - 事件：PreToolUse（matcher = 工具名正则，如 run_command）/ PostToolUse / PreInvocation / PostInvocation / Stop
 *   - 输入（stdin，protojson camelCase）：{ "toolCall": { "name": "run_command", "args": { "CommandLine": "...", "Cwd": "..." } } }
 *   - 输出（stdout 顶层 JSON）：{ "decision": "allow"|"deny"|"ask"|"force_ask", "reason": "..." }
 *   - 退出码恒 0（决策在 stdout；非零退出视为 hook 失败）
 *   - hook command 必须用绝对路径（相对路径在子目录启动会 127 绕过守卫）
 *
 * 本机接线（2026-09-06，真实 D3 验证）：
 *   ~/.gemini/config/hooks.json → PreToolUse matcher run_command →
 *   agy-dangerous-commands.ps1（适配器，BOM）→ dangerous-commands.ps1（规则源，单一规则集）→ agy deny JSON
 *   实测：真实 agy 会话尝试 `git reset --hard HEAD` → hook deny（未提交修改保留）
 *
 * 本模块是「纯函数」：不依赖 agy 运行时；供单测 + hooks.json 生成 + doctor 语义使用。
 */

export interface AgyHookPayload {
  toolCall?: {
    name?: string;
    args?: { CommandLine?: string; command?: string; Cwd?: string };
  };
  stepIdx?: number;
  conversationId?: string;
  workspacePaths?: string[];
}

/** 从 agy PreToolUse stdin 提取待执行命令文本（兼容 CommandLine / command） */
export function extractAgyCommand(payload: AgyHookPayload): string | undefined {
  const args = payload?.toolCall?.args;
  if (!args) return undefined;
  const cmd = args.CommandLine ?? args.command;
  return typeof cmd === 'string' && cmd.trim().length > 0 ? cmd : undefined;
}

/** Decision → agy 输出 JSON（顶层 decision；deny 必须带 reason） */
export function renderAgyDecision(decision: { decision: string; reason?: string }): string {
  if (decision.decision === 'deny') {
    return JSON.stringify({ decision: 'deny', reason: `RiskGuard: ${decision.reason ?? 'denied'}` });
  }
  return JSON.stringify({ decision: 'allow' });
}

/** 生成 agy 全局 hooks.json 内容（PreToolUse → run_command → adapter 脚本，绝对路径） */
export function agyHooksConfig(adapterScript: string, timeoutSec = 10): string {
  return JSON.stringify(
    {
      'riskguard-dangerous-commands': {
        PreToolUse: [
          {
            matcher: 'run_command',
            hooks: [
              {
                type: 'command',
                command: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${adapterScript}"`,
                timeout: timeoutSec,
              },
            ],
          },
        ],
      },
    },
    null,
    2,
  );
}

/** 官方路径常量 */
export const AGY_HOOKS_GLOBAL = '~/.gemini/config/hooks.json';
export const AGY_HOOKS_DIR_GLOBAL = '~/.gemini/config/hooks';
export const AGY_HOOKS_WORKSPACE = '.agents/hooks.json';
