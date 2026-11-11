# Cursor / Windsurf：Cursor 已接硬门禁，Windsurf 仍靠 rules + ignore

机制：Windsurf 主要靠**规则文件**（模型级提示）+ ignore 文件；Cursor 自 2026-11-08 起用 `preToolUse` 做机器硬门禁，2026-11-11 又把原生 `Delete` 工具接进同一门禁。

## Cursor

- 规则：`.cursor/rules/*.mdc`（项目）+ `~/.cursor/rules/`（全局）
- ignore：`.cursorignore`
- 权限：`~/.cursor/cli-config.json` 的 `approvalMode`：`allowlist` / `auto-review` / `unrestricted`；`--force` / `--yolo` 是单次放行
- **hooks：支持（2026-11-08 真机实测，2026-11-11 扩到 Delete）**——硬拦截走 `preToolUse`：
  - 位置：`~/.cursor/hooks.json`（用户级）、`.cursor/hooks.json`（项目级）、企业级 `C:\ProgramData\Cursor\hooks.json`
  - 格式：`{"version":1,"hooks":{"preToolUse":[{"command":"...","matcher":"Shell|Delete","timeout":20,"failClosed":false}]}}`；事件项是**扁平对象**
  - 生产接线由 `scripts/riskguard-wiring-check.ps1 -Fix` 维护：共享引擎复制到 `~/.cursor/hooks/dangerous-commands.ps1`，适配器 `cursor-riskguard-adapter.ps1` 负责把引擎判定翻译成 Cursor 的 `{"permission":"deny"}` 协议（`matcher: "Shell|Delete"`）
- 实测 payload：
  - Shell（Cursor 3.29.9 / cursor-agent 2026.11.05-86047df）：
    `{"tool_name":"Shell","tool_input":{"command":"echo hi","cwd":"","timeout":30000},"cwd":"","workspace_roots":["C:\\..."],"hook_event_name":"preToolUse"}`
    —— `cwd` 是**空字符串**而非缺失；适配器取第一个非空字符串，回退到 `workspace_roots[0]`
  - Delete（2026-11-11 探针）：
    `{"tool_name":"Delete","tool_input":{"file_path":"E:\\...\\tracked.txt"},"hook_event_name":"preToolUse",...}`
- 阻断输出：stdout `{"permission":"deny","agent_message":"..."}` + exit 0；`--force`（Run Everything）与 `approvalMode: unrestricted` 下依然拦得住（2026-11-11 实测）
- `beforeShellExecution` 只作用于**审批层**：`--force` 下它的 deny 会被绕过；不要拿它当硬闸门
- `failClosed` 默认 `false`。**不要照抄成 `true`**：引擎放行时是空输出，`failClosed: true` 会把空输出判成失败并拦截正常命令。保持 `false` 的代价是适配器崩溃/超时 fail-open；非法 JSON 在 `preToolUse` 上由 Cursor 自身按拦截处理
- hook 进程必须尽快退出：脚本不退出时 Cursor 等约 10 秒按超时处理；适配器只读 stdin、跑一次引擎就退出
- Claude 兼容注意：Cursor 默认会读 `~/.claude/settings.json` 的 Claude hooks（`thirdPartyExtensibilityEnabled` 默认开），但那边 matcher 是 `Bash|PowerShell`，对不上 Cursor 的 `Shell`/`Delete` 工具名 → **不生效，不能当兜底**
- D3 证据（2026-11-08 shell / 2026-11-11 Delete，`--force` 与 unrestricted 下都成立）：
  `git reset --hard HEAD` → deny 且未执行；`Delete` 工具删 `tracked.txt` → deny 且文件保留；`git status --short` → 放行
- 未覆盖：`Write` 工具（覆盖写不是永久删除，暂未接）；MCP / 网络
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
