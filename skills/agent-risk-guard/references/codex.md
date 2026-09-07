# Codex CLI：hooks + sandbox 拦截

机制：`~/.codex/hooks.json` 的 PreToolUse（与 Claude Code 同构，支持 `command_windows`）+ config.toml 的 approval_policy / sandbox_mode / Windows 沙箱。
官方文档：<https://developers.openai.com/codex/hooks> · <https://developers.openai.com/codex/windows>

## 配置文件

- `~/.codex/config.toml` — 主配置（approval_policy、sandbox_mode、[windows]）
- `~/.codex/hooks.json` — hooks（或 config.toml 内联 `[hooks]`）
- `~/.codex/rules/` — 模型级规则（非强制）

## hooks.json 示例

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "powershell -NoProfile -ExecutionPolicy Bypass -File \"C:\\Users\\<用户>\\.codex\\hooks\\dangerous-commands.ps1\"",
            "command_windows": "powershell -NoProfile -ExecutionPolicy Bypass -File \"C:\\Users\\<用户>\\.codex\\hooks\\dangerous-commands.ps1\"",
            "statusMessage": "Checking dangerous commands",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

拦截脚本可直接复用 Claude Code 的 `dangerous-commands.ps1`（同一黑名单、同 payload 格式：`tool_name`/`tool_input.command`，输出 `hookSpecificOutput.permissionDecision`）。

## config.toml（最高权限 + 兜底）

```toml
approval_policy = "never"        # 不弹确认；never = 所有审批确定性拒绝
sandbox_mode = "workspace-write" # 文件边界兜底（写仅限工作区）
[windows]
sandbox = "elevated"             # 原生 Windows 沙箱（低权限用户+ACL+防火墙；elevated 优先，unelevated 回退）
```

approval_policy 选项：`untrusted`（默认，只自动批准安全读操作，其余弹确认）、`on-request`（模型决定）、`never`（永不问）。

## ⚠️ Windows 已知 bug（必须实测）

hooks 在 Windows 已支持（PR #17268），但 **issue #24453**（2026-05）报告：Windows 上 shell 命令走 `command_execution` 路径，**不触发 PreToolUse hook**（matcher 用 `Bash`/`*`/`command_execution` 均不触发）。修复前 Windows 上 hook 拦截不可靠：
- 配置后必须在真实 Windows 会话里跑一条删除命令实测；
- 不触发则靠 `sandbox_mode="workspace-write"` 文件边界兜底，并跟踪 <https://github.com/openai/codex/issues/24453>；
- macOS/Linux 上 hooks 正常生效。
- **2026-08-24 本机实测**：`~/.codex/hooks/hook-calls.log` 有真实 deny 记录（rm -rf 被拦），表明当前 CLI 版本下 PreToolUse hook 在 Windows 实际生效；但仍建议真实会话复测以防版本差异。

## 验证

```powershell
'{"tool_name":"Bash","tool_input":{"command":"Remove-Item test.txt"}}' |
  powershell -NoProfile -ExecutionPolicy Bypass -File ~/.codex/hooks/dangerous-commands.ps1
```

真实会话：让 Codex 执行 `git reset --hard` 或删除命令，观察是否被拦。

## 陷阱

- 用户级 hooks 默认加载；托管环境可用 `requirements.toml` 的 `[features].hooks` 强制。
- `command_windows` 是 Windows 专用命令覆盖，`command` 为默认（macOS/Linux）。
- Codex 会在运行时写 config.toml（如会话状态），改完复查 approval_policy 是否还在。
