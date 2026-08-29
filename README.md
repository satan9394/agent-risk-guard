# @riskguard — Universal Agent Risk Guard

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform: Windows / macOS / Linux](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue.svg)](#)
[![Node >= 22.18](https://img.shields.io/badge/Node-%3E%3D%2022.18-green.svg)](#)
[![CI](https://github.com/satan9394/agent-risk-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/satan9394/agent-risk-guard/actions/workflows/ci.yml)

> 面向自主 AI 编码 Agent 的跨平台安全门禁：**永久删除一律拦截并强制走回收站**，
> 高危命令（磁盘格式化、git 破坏、远程管道执行、凭据导出等）在派发前拒绝。
> 纯函数策略内核 + 多 Agent 适配层，fail-closed 决策，GAN 式独立判别器对抗审查闭环。

## 特性

- **删除必须进回收站**：`rm -rf` / `Remove-Item` / `del /f` / `shutil.rmtree` / `fs.rmSync` 等永久删除一律 deny，建议 `trash`（Windows Recycle Bin / macOS Trash / freedesktop Trash）
- **跨 Agent 统一策略**：DSH（DeepSeek Harness）/ Claude Code / Cursor / OpenCode / Codex / Grok / Windsurf / Pi，一份规则多端生效（单一事实源）
- **fail-closed 内核**（RG-I04）：解析失败 / 未知 mutation → deny，禁止 fail-open
- **对抗加固**：全角字符（`ｒｍ　－ｒｆ`）、引号插词（`r'm'`）、`$()`/反引号子展开、base64 管道、解释器 one-liner（`python -c 'os.system(...)'`、`node -e`、`perl -e`）、shell wrapper 递归解包（`bash -c` / `cmd /c` / `pwsh -Command`）、junction 逃逸（fs.realpath）
- **Secret Redaction**：审计与拦截消息出口自动脱敏 token / API key / 私钥 / 口令
- **敏感路径保护**：`.ssh` / `.env` / 云凭据 / `id_rsa` / `.pem` 等只读门控
- **GAN 式对抗审查**：独立判别器（maker-checker）多轮评审——core / installer / opencode 插件 / adapter / hook 五轮闭环，历史评分与修复轨迹见 `docs/gan-audit-fix-map.md`

## 支持的 Agent

| 层 | 机制 | Agent |
|---|---|---|
| DSH | cordis `pre-execute` 门禁 + 单调 `ctx.tools.guard()` | DeepSeek Harness |
| Hooks | `PreToolUse` / `beforeShellExecution` command hook | Claude Code / Cursor / Codex / Grok / Windsurf |
| Plugins | `tool.before` TS 插件 | OpenCode |
| Rules | rules-compiler → AGENTS.md / CLAUDE.md | Codex / OpenCode / Claude Code |

## 架构

```text
packages/
├─ core/       纯函数策略内核（无副作用）：normalize / policy-engine / path-resolver / taxonomy / audit / redact
├─ cli/        stdin JSON → Decision JSON（供 command hook 使用）
├─ trash/      Windows Recycle Bin / macOS Trash / freedesktop Trash
├─ installer/  discovery / deploy / backup / rollback / uninstall / doctor
├─ dsh/        DSH 插件接线（pre-execute + monotonic guard + junction 逃逸防护）
└─ adapters/   dsh / claude / cursor / opencode / pi / grok / windsurf / codex

docs/          设计、对标、部署状态、API 实证
tests/         policy / adapter / conformance / e2e / adversarial（对抗语料 + 规则自测）
```

## 快速开始

```powershell
# 全量测试（Node >= 22.18 原生 TS，零构建）
& .\test-all.ps1

# CLI 体验：stdin JSON → Decision JSON
Get-Content tests\e2e\payload-delete.json -Raw | node packages\cli\src\index.ts

# 本机 Agent 安装发现（只读）
node -e "import('./packages/installer/src/discovery.ts').then(m=>console.log(m.discoveryToJson(m.discoverAgents())))"
```

## 文档

- [docs/TODO.md](docs/TODO.md) —— 待办清单（含待用户确认的生产同步项）
- [docs/ecosystem-benchmark.md](docs/ecosystem-benchmark.md) —— 生态对标与融合（allowlister / CC Safety Net / claude-guardrails / agent-safety-pack / Relay / SecureVector）
- [docs/adapter-contract.md](docs/adapter-contract.md) —— 适配器契约（Vendor Payload → RiskEvent → Decision）
- [docs/deployment-status.md](docs/deployment-status.md) —— 本机部署状态（DSH 门禁 / codex / CC hook / opencode 插件）
- [docs/dsh-api-evidence-d2.md](docs/dsh-api-evidence-d2.md) —— DSH `pre-execute` + `guard()` 源码级实证
- [docs/gan-audit-fix-map.md](docs/gan-audit-fix-map.md) —— GAN 对抗审查修复映射

## 不变量（Core）

| 规则 | 语义 |
|------|------|
| RG-I01 | 永久删除默认 deny，建议 trash |
| RG-I02 | RiskGuard 自身 / 受保护资源不可修改（单调 deny） |
| RG-I03 | ALLOW + DENY = DENY（guard 单调性） |
| RG-I04 | 未知 mutation / 解析失败 → fail-closed deny |
| RG-I05 | Pattern Policy ≠ Capability Policy（正则不是能力边界） |

## 社区与协议

- **License**：[MIT](LICENSE) — Copyright (c) 2026 satan9394
- **贡献指南**：[CONTRIBUTING.md](CONTRIBUTING.md)
- **行为准则**：[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- **安全报告**：[SECURITY.md](SECURITY.md) —— 发现绕过向量请走私密渠道，**不要**公开 issue 演示利用
- **版本历史**：[CHANGELOG.md](CHANGELOG.md)
- **平台发布**：SkillHub `@user_d684b111/agent-risk-guard-audit@1.0.0`（审核通过）
- **CI**：`.github/workflows/ci.yml`（Ubuntu + Node 22/24 矩阵跑平台无关测试组；hook/回收站实测依赖本机环境，见 `docs/deployment-status.md`）
