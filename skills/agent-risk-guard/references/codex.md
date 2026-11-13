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

**2026-11-02（codex-cli 0.166.0 复验）**：hook 协议未变，hooks.json 的两条注册（legacy ps1 + `_riskguard` 的 node hook）
仍被宿主合并执行——宿主输出里会看到 `hook: PreToolUse` 出现两次，随后 `PreToolUse Blocked` 与 `PreToolUse Failed`。
两个都有效：node hook 返回 `{"decision":"deny"}` + exit 2，ps1 hook exit 2 被宿主记为「Failed」但仍属阻断。
⚠️ **取证前提**：`codex exec` 默认 `sandbox: read-only`，写类命令会**先被沙箱拒绝**，那只能证明沙箱生效、不能证明 hook 生效；
取 D3 证据必须显式 `-s danger-full-access`（或等价可写沙箱），判据仍是「hook 日志 decision=deny + 脏改动存活」。

**2026-11-02 双注册复核（决定保留）**：两条注册用两套独立引擎，6 条样本判定完全一致
（`git reset --hard` / `git branch -D` / `rm -rf` / `Remove-Item` / `curl|bash` 全 deny，`git status` allow）。
成本实测：ps1 ≈563ms、node ≈131ms 每次 Bash。**关键**：人为插入一条指向不存在脚本的注册后，安全命令仍然放行
——说明**注册项 spawn 失败时 Codex 会静默忽略（fail-open）**，单条 hook 即单点故障。
故保留两条做「跨引擎 + 跨路径」冗余，不为省 0.13s 引入单点；若将来要收敛，先把 node hook 的脚本复制到
`~/.codex/hooks/` 去掉仓库路径依赖，再单留 node 并实测 spawn 失败的 fail-closed 行为。

## 陷阱

- 用户级 hooks 默认加载；托管环境可用 `requirements.toml` 的 `[features].hooks` 强制。
- `command_windows` 是 Windows 专用命令覆盖，`command` 为默认（macOS/Linux）。
- Codex 会在运行时写 config.toml（如会话状态），改完复查 approval_policy 是否还在。

## apply_patch 的 hook 需要授信（2026-11-12 更新，0.167.1）

- 0.167.1 起 `apply_patch` **是** PreToolUse 的合法 subject：`tool_name: "apply_patch"`，
  `tool_input.command` 是整段 patch 文本（`*** Begin Patch ... *** Delete File: ...`）。
- 但 hook 必须先在 Codex TUI 里点 “Trust all and continue” 授信；未授信的条目会被**静默跳过**
  （fail-open），表现为“hook 一行都不打印、文件照样被删”。之前 0.166.0 的“永不触发”就是这个原因，
  不是事件缺失。
- 当前 magpie 模型没有原生 `apply_patch` 工具，会走 shell 的 `apply_patch` CLI；这条路径由已授信的
  Bash hook 管——引擎新增 `*** Delete File:` / `*** Move to:` 规则后，实测 `codex exec` 的删除被拒、
  文件保留（2026-11-12）。
- 原生工具路径要启用，需要在 `hooks.json` 加 `matcher: "apply_patch"` 的条目，再由用户 TUI 授信一次；
  每次改该条目都要重新授信并复测 deny，不能只看配置存在。**2026-11-12 已授信并复验**：
  `config.toml` 出现 `pre_tool_use:1:0`，原生 `*** Delete File` 被拒、文件保留；`Update File` 放行。
- `approval_policy` 仍保持默认 `on-request`；不要用 `never` 换“少弹窗”。
- 别用「sandbox=workspace-write 能挡删除」当证据：它允许删工作区内文件，挡不住这次的问题。

## 权限决策：A 改良（2026-11-13，最终）

- 配置：`approval_policy="never"` + `sandbox_mode="workspace-write"`，并 `enabled=false` 关闭
  `node_repl` 与 `unified-computer-use`（注入 `cua_repl`）。
- 为什么不能只开 `never`：审批不管 MCP；原配置下 `js` 工具能在工作区内建/删文件，hook 看不到也不弹窗。
  开 `danger-full-access` 会把这条路径放大到工作区外，所以不采用。
- 关掉两个自由 JS 入口后，MCP 工具集会变成 `NONE`；Bash 与 apply_patch 的 hook 仍硬拦。
- 真跑验证：`git reset --hard` 被拒、原生 apply_patch `*** Delete File` 被拒；`git status` 与工作区内建文件
  放行，全程无审批。
- 代价：Codex 的电脑操作/浏览器自动化随之关闭；回滚把两处 `enabled` 改回 `true` 即可。
- 每次改 `hooks.json` 的 hook 条目仍会让对应授信失效，需要 TUI 重新授信并复测 deny。
