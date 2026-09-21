/**
 * @riskguard/adapter-agy — Antigravity CLI (agy) PreToolUse Hook Adapter（v0.1，D3 Windows shell.execute 实测）
 *
 * 官方机制（antigravity.google/docs/hooks + CLI 实测：1.1.27 于 2026-09-06 首次核查、
 * **1.2.7 于 2026-09-21 复验——协议无变化**：payload 仍是 `{toolCall:{name,args:{CommandLine}}}`、
 * 仍是 stdout 顶层 JSON、退出码仍恒 0）：
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
export function agyHooksConfig(adapterScript: string, timeoutSec = 15): string {
  // 2026-09-21：timeout 默认值 10 → **15**，对齐**实测在用**的那份 hooks.json
  //   （`~/.gemini/config/hooks.json` 的 agy 条目是 `pwsh -NoProfile -File ... ; timeout: 15`）。
  //   理由：适配器不是终点 —— 它还要再 spawn 一次规则引擎（ps1，内部可能再调 python3/grep），
  //   10s 在冷启动/杀软扫描时偏紧，而 15 是实际跑通并被 D3 会话验证过的值。生成器不得比实测值更紧。
  //   仍在的两处「生成值 ≠ 本机值」（有意保留，非缺陷）：
  //     · 引擎：生成器写 `powershell.exe`（Windows 必有），本机手工用了 `pwsh`（避免 5.1 的编码类问题）；
  //     · guard 名：生成器写 `riskguard-dangerous-commands`（带命名空间），本机是历史的 `dangerous-commands-guard`。
  //   两者都**不影响功能**：doctor 的 agy 探测按「PreToolUse → hooks[].command 指向适配器」识别，不认名字。
  // 2026-09-13 修复（实测，同 scripts/riskguard-wiring-check.ps1）：路径无空白/引号时**不加引号**。
  // 带引号写法在本机两种 spawn 机制下会让 hook 静默失效（powershell 报 Illegal characters in path、
  // 退出 4294770688、不产出 deny）；去引号后同一批危险载荷能正常 deny。含空白时才退回加引号。
  const hookArg = /[\s"]/.test(adapterScript) ? `"${adapterScript}"` : adapterScript;
  return JSON.stringify(
    {
      'riskguard-dangerous-commands': {
        PreToolUse: [
          {
            matcher: 'run_command',
            hooks: [
              {
                type: 'command',
                command: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${hookArg}`,
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
