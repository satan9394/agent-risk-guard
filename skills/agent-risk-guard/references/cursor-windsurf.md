# Cursor / Windsurf：rules + ignore（模型级，非强制）

机制：两家主要靠**规则文件**（模型级提示）+ ignore 文件（保护敏感路径）。Cursor 有 hooks/permissions 能力（rulesync 矩阵确认），Windsurf 无 hooks。

## Cursor

- 规则：`.cursor/rules/*.mdc`（项目）+ `~/.cursor/rules/`（全局）
- ignore：`.cursorignore`
- 权限：项目设置里可配权限规则（ask/allow/deny 的工具级）
- **hooks：支持**（rulesync ✅）——可挂 PreToolUse 类钩子做硬拦截
- 加固：`.cursor/rules/` 写"删除必须进回收站"（模型级）+ 配 deny 规则 + 有 hooks 则挂黑名单
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
