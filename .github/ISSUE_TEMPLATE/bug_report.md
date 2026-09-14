---
name: Bug report
about: Report a defect. Do NOT post bypass/exploit payloads publicly — those go to SECURITY.md. 报告缺陷；绕过类问题请走 SECURITY.md 私密渠道。
title: '[BUG] '
labels: bug
assignees: ''
---

**What happened / 现象**
A concise description of the problem. 简洁说明问题现象。

**Steps to reproduce / 复现步骤**
1. Command or payload: `...` （输入命令 / 载荷）
2. Expected: `allow` / `deny` （期望行为）
3. Actual: `allow` / `deny` （实际行为）

**Environment / 环境**
- Agent & surface (claude / codex / opencode / dsh / agy …)：
- Platform：Windows / macOS / Linux
- Node version (`node --version`)：
- RiskGuard version, or the commit you installed from：

**Logs / 日志**
Paste the relevant output — hook log, CLI stdout, stack trace. 贴关键输出。

**⚠️ Before you post / 提交前必读**
If this is a **bypass**, a **rule miss that could cause data loss**, or a **privilege escalation**, do **NOT**
paste the full payload here — report it privately via [SECURITY.md](../SECURITY.md).
如果是**绕过**、**可能导致数据丢失的漏拦**、**权限提升**类问题，**不要**在这里贴完整载荷，改走
[SECURITY.md](../SECURITY.md) 的私密渠道。
