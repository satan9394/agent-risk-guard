# MiniMax Code（mcode）接线参考

> 实测基线：mcode **0.7.0**（`@minimax-ai/code`）· Windows / PowerShell · 2026-10-27
> 本文只写「怎么接、接在哪、测了什么、没测什么」；规则单源永远在
> `packages/core/src/rules/default-policy.ts`，适配层不含任何规则。

## 1. 机制：Claude 兼容插件目录（不是 settings.json）

mcode **没有** Claude Code 那种「用户级 settings.json 直接注册 hooks」的入口。它只从**插件清单**发现 hook：

| 清单文件 | 识别类型 | sourceFormat | hook 文档默认路径 |
|---|---|---|---|
| `plugin.json` | Agent Plugins v1（仅 skills + mcp，**无 hooks**） | — | — |
| `.minimax-plugin/plugin.json` | LOCAL_MINIMAX | `MINIMAX` | 清单声明 |
| `.claude-plugin/plugin.json` | Claude 兼容 | `CLAUDE` | `hooks/hooks.json` |
| `.codex-plugin/plugin.json` | Codex 兼容 | `CODEX` | `hooks/hooks.json` |

我们走 **Claude 兼容**这一行，落点：

```
~/.minimax/plugins/riskguard/
  .claude-plugin/plugin.json     ← 清单（name/description/author），决定 sourceFormat=CLAUDE
  hooks/hooks.json               ← PreToolUse 注册（matcher 正则 + command）
```

**卸载的单位是目录**：`~/.minimax/plugins/riskguard` 整个移入回收站。只删 hooks.json 会留下一个
「还注册着但没 hook」的空插件（这正是插件目录型接线的典型残留）。

安装（本机）：

```powershell
node scripts/install-mcode-plugin.mjs            # 幂等；变更前备份到 ~/.risk-guard-backup/mcode-<stamp>/
node scripts/install-mcode-plugin.mjs --dry-run  # 只看差异
```

## 2. PreToolUse 载荷与输出

stdin（mcode 在 Agent 的 JSON 上补平台字段）：

```json
{
  "hook_event_name": "PreToolUse",
  "session_id": "mvs_…", "turn_id": "turn_…", "prompt_id": "…",
  "transcript_path": null, "cwd": "E:\\proj",
  "model": "…", "permission_mode": "default", "effort": "…",
  "tool_name": "bash",
  "tool_input": { "command": "Remove-Item x -Force" },
  "tool_use_id": "call_…"
}
```

stdout（与 Claude Code 同形状，**exit 0**）：

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "…"
  },
  "systemMessage": "RiskGuard: …"
}
```

`systemMessage` 在 TUI 里显示为 `Hook` 提示（**不进模型上下文**）。

hook 进程环境变量：`PLUGIN_ROOT` / `CLAUDE_PLUGIN_ROOT` / `PLUGIN_DATA` / `CLAUDE_PLUGIN_DATA` /
`MINIMAX_PROJECT_DIR` / `CLAUDE_PROJECT_DIR` / `CODEX_PROJECT_DIR`（后三者都等于 cwd）。

## 3. 工具名双形态（本接线最隐蔽的死法）

mcode 只有在 `tool_input` **通过 Claude 形状校验**时才把内部名映射成 Claude 名：

| 内部名 | 映射名（校验通过） | 校验失败时 |
|---|---|---|
| `bash` | `Bash`（POSIX）/ `PowerShell`（win32） | 保留 `bash` |
| `read` | `Read` | 保留 `read` |
| `write` | `Write` | 保留 `write` |
| `edit` | `Edit` | 保留 `edit` |
| `task` | `Agent` | 保留 `task` |

两条由此而生的硬约束：

1. **matcher 必须是 `Bash|PowerShell|bash`**。mcode 的 matcher 是**大小写敏感正则**；只写映射名时，
   「校验没通过、保留内部名」的那条调用**根本不进 hook** —— 而且 hook 自测仍然全绿，看不出漏。
2. **shell 工具取不到非空 `command` 时 fail-closed**。内部形状无法静态验证，按「未知工具 → 写入」兜底
   等于把一条 shell 调用当文件写入放行。

## 4. 与平台自带 permission 层的关系（已知缺陷）

mcode 自带 `permission.json`（会话级，`~/.minimax/sessions/<id>/permission.json`，v2：

```json
{ "version": 2, "allow": [ { "tool_name": "bash", "matcher": { "kind": "command", "pattern": "…" } } ], "deny": [], "ask": [] }
```

本机实测到一个**平台侧缺陷**：一次复合命令被用户 deny 后，mcode 会把**每个子命令**分别写成一条
deny 规则（实测出现 `Format-List`、`Select-Object Name,CommandType,Source`、`Write-Output '=== … ==='`），
此后任何包含这些 token 的**只读**命令在 `permLayer=user-deny` 层被整条 deny，且**跨会话持久**。

RiskGuard 的处理原则：**不读、不写、不把 permission.json 当证据**。hook 是唯一判据；平台的
permission 层仍会照常工作（两套账本并行，RiskGuard 只会在它之上再加一道 deny，不会放宽平台判定）。
要清掉被污染的规则，目前只能由用户删会话目录或改 `permission.json`（属平台行为，RiskGuard 不代做）。

## 5. 测了什么 / 没测什么

**已测（D2，进程级真实 spawn）**：

- `tests/adapter/mcode-adapter.test.ts` 9/9：双形态同判、空 command fail-closed、只读不误伤、
  `path` 与 `file_path` 双形状、`edit`/`task` 归类、未知工具保守 write、deny 输出形状、matcher 覆盖 `bash`
- `pre-tool-hook.ts --agent mcode` 真 spawn（Windows）：
  `Remove-Item … -Recurse -Force`（内部名）→ **deny**、`rm -r -f`（映射名）→ **deny**、
  `Get-ChildItem` / `git status` → **allow**、空 command → fail-closed **deny**
- 跨端抽查：同一「受保护配置写入」载荷下 claude 与 mcode adapter 判定一致（均放行），说明适配层没有引入分歧

**未测（D3 未取）**：

- **没有真实 mcode 会话内的拦截原始输出**。D3 需要「一条危险命令被拒 + 一条安全命令放行」的会话级证据，
  本机只有进程级 spawn，因此 `compatibility.json` 与 CHANGELOG 均记 **D2**。
- `permission_mode: bypassPermissions` 下 hook 是否仍执行（mcode 文档说会，本机未验证）。
- macOS / Linux 的 shell family（Bash）与插件目录权限。

## 6. 已知边界

- 规则仍是 **Pattern Policy 不是 Capability Policy**（见 `SECURITY.md`）；绕过向量走 SECURITY.md，不开 issue。
- `ask` 不直译：适配层只输出 deny，其余一律 `{}`（与 claude/codex 一致，避免同一条策略在不同 Agent 上表现相反）。
- installer 侧尚未接入 `install --agent mcode` / doctor / `compatibility.json` 条目 —— 见 `docs/TODO.md`；
  当前用 `scripts/install-mcode-plugin.mjs` 完成安装。
