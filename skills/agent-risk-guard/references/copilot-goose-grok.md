# Copilot CLI / Goose / Grok CLI：hooks 类 Agent

机制：三类均支持 hooks + permissions（rulesync 矩阵确认），可复用统一黑名单做 PreToolUse 拦截。配置路径与 Claude/Codex 相似。

## GitHub Copilot CLI

- 规则：`.github/copilot-instructions.md`（项目）+ `~/.copilot/`（全局）
- hooks/permissions：支持。用户级 hook 放 `~/.copilot/hooks/<name>.json`，`version: 1`，事件名必须
  **PascalCase `PreToolUse`**（camelCase 给的是 `toolName`/`toolArgs`，读不到 `tool_input.command`）。
- 生产接线（2026-11-12，D3）：`~/.copilot/hooks/riskguard.json` → `copilot-riskguard-adapter.ps1` →
  共享 `dangerous-commands.ps1`；适配器 deny 输出顶层 `{"permissionDecision":"deny",...}` 并 `exit 2`，
  **exit 2 同时保证 agent 看到真实理由**（只靠 exit 2 会显示通用错误）。
- 真实会话：`copilot --prompt "..." --allow-all-tools` 下 `git reset --hard` 被拒、脏改动保留；
  `git status --short` 放行；`--yolo` 同样拦得住。移走 hook 的负向对照里命令真的执行。
- 失败语义：命令型 hook 崩溃 / 非零退出 / `exit 2` 都是 **fail-closed**；官方文档称超时 fail-open，未实测。

## Goose（Block 开源 Agent）

- 配置：`~/.config/goose/`（config.json 等）
- 机制：扩展系统 + hooks + permissions
- 加固：查 extension/hook 是否挂黑名单；`goose configure` 的权限模式

## Grok CLI（xAI Grok Build）

- 配置：`~/.grok/config.toml`；本机用 `[model.magpie]` 指向本地 magpie 网关，`env_key = "GROK_MAGPIE_KEY"`。
- Hooks：用户级 `~/.grok/hooks/*.json`，`PreToolUse` 无 matcher = 匹配全部工具；无需 `--trust`（项目级才要）。
- 生产接线（2026-11-13，D3）：`~/.grok/hooks/riskguard.json` → `grok-riskguard-adapter.ps1` → 共享
  `dangerous-commands.ps1`。适配器输出 `{"decision":"deny","reason":...}` 并 `exit 2`；payload 是 camelCase
  `toolName` / `toolInput`。
- 真实会话（`grok --always-approve -p`）：`git reset --hard HEAD` 被拒、脏改动与未跟踪文件保留；
  `git status --short` 放行。
- **踩过的坑**：适配器不要把 payload 变量命名为 `$input`——PowerShell 的自动变量会让宿主先吞掉 stdin，
  每次调用都变成「空输入 → fail-closed deny」。改名 `$toolInputData` 后恢复。
- 边界：vendor 对崩溃/超时/非法输出是 fail-open；只覆盖 shell（`run_terminal_command`），MCP/写工具未接。
- 备注：`git stash push` 不在 reset/clean 规则里，模型可能用它绕过「丢弃改动」的意图（可恢复，但语义上要补语料）。

## 通用做法（三者一致）

1. 找全局配置目录（`~/.copilot`、`~/.config/goose`、`~/.grok`）
2. 确认 hooks 配置格式（与 Claude Code 的 `{"hooks":{"PreToolUse":[{matcher,hooks:[{type,command}]}]}}` 高度相似）
3. 复用 `references/claude-code.md` 的拦截脚本与黑名单
4. 实测：真实会话跑删除命令确认被拦

## 注意

- 各 Agent hooks schema 细节可能不同（字段名/输出格式），落地前先看官方 hooks 文档或 `rulesync` 生成的样例（`rulesync generate --targets copilotcli --features hooks` 可参考）
- rulesync 是跨 Agent 配置的好帮手：`npm i -g rulesync`，`rulesync generate --targets <agent> --features hooks,permissions` 可一键生成配置骨架
