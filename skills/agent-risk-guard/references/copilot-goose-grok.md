# Copilot CLI / Goose / Grok CLI：hooks 类 Agent

机制：三类均支持 hooks + permissions（rulesync 矩阵确认），可复用统一黑名单做 PreToolUse 拦截。配置路径与 Claude/Codex 相似。

## GitHub Copilot CLI

- 规则：`.github/copilot-instructions.md`（项目）+ `~/.copilot/`（全局）
- hooks/permissions：支持（`~/.copilot/` 下配置）
- 加固：查 hooks 是否挂载黑名单；`copilot` 的 `--dangerously-bypass-approvals` 类 flag 是否被用（等效 bypass）

## Goose（Block 开源 Agent）

- 配置：`~/.config/goose/`（config.json 等）
- 机制：扩展系统 + hooks + permissions
- 加固：查 extension/hook 是否挂黑名单；`goose configure` 的权限模式

## Grok CLI

- 配置：`~/.grok/`（settings）
- 机制：hooks + permissions（rulesync ✅）
- 加固：同上，挂统一黑名单

## 通用做法（三者一致）

1. 找全局配置目录（`~/.copilot`、`~/.config/goose`、`~/.grok`）
2. 确认 hooks 配置格式（与 Claude Code 的 `{"hooks":{"PreToolUse":[{matcher,hooks:[{type,command}]}]}}` 高度相似）
3. 复用 `references/claude-code.md` 的拦截脚本与黑名单
4. 实测：真实会话跑删除命令确认被拦

## 注意

- 各 Agent hooks schema 细节可能不同（字段名/输出格式），落地前先看官方 hooks 文档或 `rulesync` 生成的样例（`rulesync generate --targets copilotcli --features hooks` 可参考）
- rulesync 是跨 Agent 配置的好帮手：`npm i -g rulesync`，`rulesync generate --targets <agent> --features hooks,permissions` 可一键生成配置骨架
