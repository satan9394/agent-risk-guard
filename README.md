# Agent Risk Guard

**Deterministic runtime guardrails for AI coding agents.**

在 AI Agent 真正执行 Shell、文件系统与 Git 高风险操作**之前**做确定性检查。它不依赖模型"记得安全规则"，
而是在 Agent 与操作系统之间插入一道独立的执行门禁。

```text
AI Coding Agent
      ↓
 Agent Adapter        （各家的 hook / plugin / pre-execute / tool.before）
      ↓
 Agent Risk Guard     （统一 RiskEvent → Policy Engine，纯函数、fail-closed）
      ↓
 ALLOW / DENY / SAFE ALTERNATIVE
      ↓
 Operating System
```

一次真实的拦截输出（未改动）：

```text
Agent attempts:  remove-item C:\proj\important -Recurse -Force

{
  "decision": "deny",
  "ruleId": "RG-FS-001",
  "reason": "永久删除禁止，请使用回收站",
  "safeAlternative": { "operation": "trash" }
}
```

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node >= 22.18](https://img.shields.io/badge/Node-%3E%3D%2022.18-green.svg)](#)
[![CI](https://github.com/satan9394/agent-risk-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/satan9394/agent-risk-guard/actions/workflows/ci.yml)

> **状态：`v0.3.1 Developer Preview`**（Pre-release）。
> **已在 Claude Code / OpenCode / Antigravity CLI 的真实 Agent 会话中验证执行前拦截**；macOS / Linux 已实现，
> 但尚未在真实环境实测。
>
> ⚠️ Agent Risk Guard **不是** OS sandbox，也不是完整的终端安全产品。它是纵深防御里的一层，边界见
> [Limitations](#limitations)。

## Why Agent Risk Guard?

AGENTS.md、CLAUDE.md、系统 Prompt 和 Agent 自带的 Permission 都可以告诉模型"不要执行危险操作"——
但只要**由模型决定是否遵守**，那就是**软约束**：可以被绕过、被遗忘，也可以在长上下文或强施压下失效。

Agent Risk Guard 加的是另一层：模型可以提出操作请求，**但模型不能决定自己的权限边界**。

```text
Prompt / Rules  →  模型决定是否遵守  →  Agent Risk Guard  →  机器再次确定性检查  →  真实执行
```

## 能拦住什么

| 风险 | 示例 | 默认行为 |
|---|---|---|
| **永久删除** | `rm -rf`、`Remove-Item -Recurse -Force`、`del /f`、`shutil.rmtree`、`fs.rmSync` | DENY，建议改用回收站 |
| **破坏性 Git 操作** | `git reset --hard`、`git clean -f`、`git restore`、`push --force`、`branch -D`、`stash drop/clear`、`gc --prune` | DENY |
| **系统破坏命令** | `mkfs` / `wipefs` / `Format-Volume`、写块设备、`reg delete` | DENY |
| **敏感资源** | `.ssh` / `.env` / `.aws` / `.kube` / `.npmrc` / 私钥 / `.pem` | 只读门控；审计与拦截消息出口自动脱敏 token / API Key / 口令 |
| **部分混淆执行** | 全角变体、引号插词、`$()`/反引号、base64 管道、解释器 one-liner、shell wrapper 解包、junction/symlink 逃逸 | 解包后重新检查（**只能识别部分**，见 [Limitations](#limitations)） |

完整规则清单：`packages/core/src/rules/default-policy.ts`。

## Quick Start

要求 **Node >= 22.18**，零依赖、零构建。

```bash
git clone https://github.com/satan9394/agent-risk-guard.git
cd agent-risk-guard

node bin/riskguard.mjs bootstrap   # 装入 ~/.riskguard/runtime/，之后 hook 不再依赖 git clone
node bin/riskguard.mjs install     # 交互式选择要加固的 Agent（非交互环境自动全装，不卡死）
node bin/riskguard.mjs doctor      # 健康检查
```

看当前状态、以及**先预览再落盘**：

```bash
node bin/riskguard.mjs status
node bin/riskguard.mjs install --dry-run
```

`bootstrap` 之后，Agent 的 hook/插件指向 `~/.riskguard/runtime/<version>/` 而不是 git clone——
删除或移动源码仓库，RiskGuard 仍工作。

完整命令、选项、**退出码契约**与事务式安装器语义见 **[docs/cli.md](docs/cli.md)**。

> 也可以作为 **Agent Skill** 安装（本仓库是其 canonical 源）：
> `npx skills add satan9394/agent-risk-guard` —— 支持 Agent Skills 的运行时可直接安装。

## Agent 支持

| Agent | 集成方式 | 拦截层 | 状态 |
|---|---|---|---|
| **Claude Code** | `PreToolUse` hook | 机器硬门禁 | ✅ 真实会话已验证 |
| **OpenCode** | `tool.execute.before` 插件 | 机器硬门禁 | ✅ 真实会话已验证 |
| **Antigravity CLI** | `PreToolUse` hook | 机器硬门禁 | ✅ 真实会话已验证 |
| **Codex** | hook + 应用策略/沙箱层 | **混合**——应用形态下拦住命令的是 Codex 自身的策略层，CLI 侧 hook 另有实测 | 🟡 部分验证 |
| **DeepSeek Harness** | profile 注入的规则补丁 | **规则（正则）层**——`@riskguard/dsh` 插件已实现且有测试，但**未接入任何 profile** | 🟡 已验证（非插件） |
| **Cursor / Windsurf / Grok** | adapter | 无真实会话验证 | ⚪ 仅实现 |
| **Pi 及其他** | — | — | ⚪ 未覆盖 |

> **"Supported" 不代表同等安全等级。** 上表刻意区分"由谁拦的"：Codex 那一行真正拦住命令的是它自己的策略层，
> DSH 那一行生效的是规则补丁而不是插件——这两处最容易误读。
> 各 Agent 的等级（D0–D4）、逐项证据与真实执行边界见单一事实源
> `packages/installer/compatibility.json` 与自动生成的 [Agent Security Matrix](docs/generated/agent-security-matrix.md)。
> 想补充某个 Agent？见 [新增一个 Agent 需要什么](docs/adding-an-agent.md)。

## Security Model

不同 Agent 用不同的拦截点，但都先归一化成同一个 `RiskEvent`，再交给**同一个策略内核**判定——
跨 Agent 行为一致、单一事实源，且策略引擎是纯函数，可独立于任何 Agent 运行与测试。

核心不变式（在 `packages/core/src`，均有测试锁定）：

- **RG-I01** 永久删除默认 deny，建议走回收站
- **RG-I02** RiskGuard 自身与受保护资源不可被修改（单调 deny）
- **RG-I03** 只要有一层 deny，结果就是 deny（guard 单调性）
- **RG-I04** 解析失败 / 未知 mutation → **fail-closed deny**，禁止放行
- **RG-I05** 正则不是能力边界（Pattern Policy ≠ Capability Policy）

架构契约见 [docs/adapter-contract.md](docs/adapter-contract.md)。

## Standards & Interoperability

提供**实验性**的 **OWASP ACS v0.1.0** 对齐层：把 ACS `ToolCallRequest` 无损转换为内部 `RiskEvent`，
并返回符合官方 JSON Schema 的 Result（`riskguard acs evaluate`，wire 模式 `--wire`）。

这是**互操作性层，不是本项目的核心安全边界**——它不改变上面的策略引擎与不变式。
详见 [docs/acs-alignment.md](docs/acs-alignment.md)。

## Limitations

Agent Risk Guard 是**纵深防御中的一层**，不是完整的主机安全方案。它目前：

- **不是** OS sandbox，也**不是** EDR / 杀毒
- **不能**识别所有命令混淆方式（只覆盖已建模的那部分向量）
- **不能**阻止绕过 Agent adapter、直接调用操作系统的行为
- **不应**作为唯一的安全边界
- macOS / Linux 已实现，但**缺少真实环境验证**
- 仍处 **Developer Preview**，不宣称 1.0 Stable

把这个边界写清楚，是因为安全工具如果宣称的保护其实没生效，**比没有保护更危险**。

## 贡献

欢迎使用、提问、提 Issue。**你在用的 Agent 不在上表里，正是我们想知道的**——只需要一份该 Agent 的
hook/插件文档（配置路径 + 事件形状 + 拒绝返回形状），通常就够判断"能不能做硬门禁"。

- [申请补充 Agent 类型](https://github.com/satan9394/agent-risk-guard/issues/new?template=new_agent_request.yml)
- [报告某 Agent 的安全机制 / 环境情况](https://github.com/satan9394/agent-risk-guard/issues/new?template=agent_security_report.yml)
- 想直接改代码：见 [docs/adding-an-agent.md](docs/adding-an-agent.md)
- ⚠️ **安全漏洞不要开公开 Issue**：走 [SECURITY.md](SECURITY.md)

## Documentation

| 文档 | 内容 |
|---|---|
| [docs/cli.md](docs/cli.md) | **CLI 手册**：全部子命令、选项、退出码契约、事务式安装器语义、接线巡检 |
| [docs/adapter-contract.md](docs/adapter-contract.md) | 适配器契约：Vendor Payload → RiskEvent → Decision |
| [docs/acs-alignment.md](docs/acs-alignment.md) | OWASP ACS v0.1 对齐边界与 wire 模式 |
| [docs/adding-an-agent.md](docs/adding-an-agent.md) | 新增一个 Agent 需要提供什么 |
| [docs/generated/agent-security-matrix.md](docs/generated/agent-security-matrix.md) | 自动生成的逐 Agent 真实执行边界矩阵 |
| [docs/GAN-AUDIT-5AGENTS.md](docs/GAN-AUDIT-5AGENTS.md) | 独立判别器对抗审查（17 findings 全修复） |
| [docs/release-notes/](docs/release-notes/) | **每个版本"出了什么问题 + 改了什么"**（中英双语） |
| [CHANGELOG.md](CHANGELOG.md) · [CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) | 变更历史、贡献指南、安全报告 |

> 开发日志： [v0.1.0→v0.1.2](docs/devlog-2026-09-04-v0.1.2.md) · [v0.2.0](docs/devlog-2026-09-05-v0.2.0.md) ·
> [v0.2.1](docs/devlog-2026-09-05-v0.2.1.md) · [v0.2.2](docs/devlog-2026-09-05-v0.2.2.md) · [v0.3.0](docs/devlog-2026-09-07-v0.3.0.md)

> 历史 Git tag `v1.0.0` 保留不删：它是早期发布标记，**不代表当前稳定版**。

## License

[MIT](LICENSE) — Copyright (c) 2026 satan9394
