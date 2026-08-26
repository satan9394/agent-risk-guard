---
name: Bug report
about: 报告缺陷（不要让绕过向量出现在公开 issue 里——利用/绕过类问题走 SECURITY.md 私密渠道）
title: '[BUG] '
labels: bug
assignees: ''
---

**描述**
简洁说明问题现象。

**复现步骤**
1. 输入命令 / 载荷：`...`
2. 期望行为：`allow` / `deny`
3. 实际行为：`allow` / `deny`

**环境**
- Agent / 表面（claude / codex / opencode / dsh…）：
- 平台：Windows / macOS / Linux
- Node 版本：`node --version` 输出

**日志 / 报错**
贴关键输出（hook 日志、CLI stdout、报错堆栈）。

**备注**
如果是**绕过（bypass）**、**规则误拦可导致数据丢失**、**权限提升**类问题，请**不要**在 issue 里贴完整载荷，改走 [SECURITY.md](SECURITY.md) 私密报告渠道。