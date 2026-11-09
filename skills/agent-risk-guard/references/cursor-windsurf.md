# Cursor / Windsurf：rules + ignore（模型级，非强制）

机制：两家主要靠**规则文件**（模型级提示）+ ignore 文件（保护敏感路径）。Cursor 有 hooks/permissions 能力（rulesync 矩阵确认），Windsurf 无 hooks。

## Cursor

- 规则：`.cursor/rules/*.mdc`（项目）+ `~/.cursor/rules/`（全局）
- ignore：`.cursorignore`
- 权限：项目设置里可配权限规则（ask/allow/deny 的工具级）
- **hooks：支持（2026-11-08 真机实测）**——硬拦截走 `preToolUse`：
  - 位置：`~/.cursor/hooks.json`（用户级，hook 从 `~/.cursor/` 起跑）、`.cursor/hooks.json`（项目级，从项目根起跑）、企业级 `C:\ProgramData\Cursor\hooks.json`
  - 格式：`{"version":1,"hooks":{"preToolUse":[{"command":"...","matcher":"Shell","timeout":20,"failClosed":false}]}}`；事件项是**扁平对象**，不是 Claude 的 `{matcher, hooks:[...]}` 嵌套结构
  - 生产接线由 `scripts/riskguard-wiring-check.ps1 -Fix` 维护：ps1 引擎复制到 `~/.cursor/hooks/dangerous-commands.ps1`，`~/.cursor/hooks.json` 幂等合并一条 `preToolUse`（`matcher: "Shell"`、`failClosed: false`）
- 实测 payload（Cursor 3.29.9 / cursor-agent 2026.11.05-86047df）：
  `{"tool_name":"Shell","tool_input":{"command":"echo hi","cwd":"","timeout":30000},"cwd":"","workspace_roots":["C:\\..."],"cursor_version":"2026.11.05-86047df","hook_event_name":"preToolUse"}`
  —— `cwd` 是**空字符串**而非缺失；适配器已改为「取第一个非空字符串」，回退到 `workspace_roots[0]`
- 阻断输出：stdout `{"permission":"deny","user_message":"...","agent_message":"..."}` + exit 0；`--force`（Run Everything）下依然拦得住
- `beforeShellExecution` 只作用于**审批层**：`--force` 下它的 deny 会被绕过（实测 2 次均执行）；不要拿它当硬闸门
- `failClosed` 默认 `false`。**不要照抄成 `true`**：ps1 引擎放行时是空输出，而 `failClosed: true` 会把空输出判成失败并拦截正常命令。保持 `false` 的代价是 hook 崩溃/超时 fail-open；非法 JSON 在 `preToolUse` 上由 Cursor 自身按拦截处理
- hook 进程必须尽快退出：脚本不退出时 Cursor 等约 10 秒按超时处理（未开 failClosed 就放行）——实测出现过「deny 已返回、命令仍执行」的个例，排查后确认是进程未及时退出
- Claude 兼容注意：Cursor 默认会读 `~/.claude/settings.json` 的 Claude hooks（`thirdPartyExtensibilityEnabled` 默认开），但那边 matcher 是 `Bash|PowerShell`，对不上 Cursor 的 `Shell` 工具名 → **不生效，不能当兜底**
- D3 证据（2026-11-08，`--force` 下同样成立）：`git reset --hard HEAD` → deny 且未执行；`echo safe-ok > file` → 放行且文件生成
- 未覆盖：非 shell 工具（`Delete` / `Write`）目前只有适配器 D2 单元测试，生产 hook 只挂 `Shell`
- 已知：llm-safe-haven 记录过 Cursor 的 7 个 CVE（历史版本漏洞），注意版本更新

## Windsurf

- 规则：`.windsurfrules`（项目）+ 全局 rules
- ignore：`.codeiumignore`
- **无 hooks、无权限系统**（rulesync 表无 hooks/permissions）→ 只能 rules 提示 + ignore 保护
- 加固局限（llm-safe-haven 的评价是 honest limitation）：规则是提示非强制；`~/.codeium/windsurf/memories/global_rules.md` 可加全局规则
- 补充防线：外部包装（容器）、关键路径 ignore

## 审计要点

1. 规则文件是否存在、是否写明删除铁律
2. ignore 是否覆盖敏感路径（`~/.ssh`、`.env`、密钥文件）
3. Cursor 是否有 hooks/deny 配置（有则必须用）
4. Windsurf 需向用户说明"无法机器级拦截"的局限

## 验证

rules 类只能靠"让模型执行删除命令，看它是否遵守规则"——**不遵守不算 bug**（prompt injection 可绕过），这正是要升级到 hooks/deny 的原因。
