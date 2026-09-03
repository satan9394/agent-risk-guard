# Agent Risk Guard

**Deterministic safety guardrails for AI coding agents.**

在 AI Agent 真正执行文件删除、Shell 命令、Git 破坏性操作之前，进行确定性安全拦截——把「永久删除」变成「回收站」，把破坏性操作挡在执行之前。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node >= 22.18](https://img.shields.io/badge/Node-%3E%3D%2022.18-green.svg)](#)
[![CI](https://github.com/satan9394/agent-risk-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/satan9394/agent-risk-guard/actions/workflows/ci.yml)

> **状态：`v0.1.0 Developer Preview`**。核心策略引擎、CLI 安装器、DSH 插件与大部分适配器已实现并通过自动化测试；
> 生产接线已在本机单点验证（Claude Code / OpenCode / Codex / DSH），macOS / Linux 尚未在真实环境实测（详见 [支持矩阵](#支持矩阵) 与 [Security Model](#security-model)）。

---

## Why RiskGuard?

AGENTS.md、CLAUDE.md、系统 Prompt 和 Agent 自带的 Permission 都是安全体系的一部分，但**它们靠的是「模型遵守规则」**。模型可能被绕过、被遗忘、或面对强施压时做出错误判断——你不应该把「模型会守规矩」当作最终安全边界。

RiskGuard 的目标是在 Agent 调用真正危险的工具之前，增加**一层确定性的执行门禁**（由策略引擎判定，不依赖模型是否「记得」规则）：

```text
Agent 尝试执行  rm -rf important-project/
        ↓
     RiskGuard
        ↓
      DENY
        ↓
    命令没有真正执行
```

这是本项目最重要的概念：**软规则约束**（写进规则文件，靠模型遵守）与**执行前硬拦截**（hook / plugin / pre-execute 门禁，机器判定并阻断）是两种完全不同的安全等级。

## What it protects

归纳为五类（完整规则清单见 `packages/core/src/rules/default-policy.ts`，详细向量见 `docs/`）：

### Permanent deletion — 永久删除

阻止绕过回收站的永久删除行为：`rm -rf`、`Remove-Item -Recurse -Force`、`del /f`、`shutil.rmtree`、`fs.rmSync` 等。一律 deny 并建议改用回收站（trash）。

### Destructive Git operations — 破坏性 Git 操作

`git reset --hard`、`git clean -f`、`git checkout -- / restore`、`git push --force`、`git branch -D`、`git stash drop/clear`、`git worktree remove --force`、`git gc --prune` 等不可逆操作。

### System destructive commands — 破坏性系统命令

磁盘格式化（`Format-Volume` / `mkfs` / `wipefs`）、写块设备（`dd if=… of=/dev/…`）、注册表删除（`reg delete`）、wmic 破坏等高风险操作。

### Credential & sensitive path protection — 凭据与敏感路径保护

`.ssh` / `.env` / `.aws` / `.kube` / `.npmrc` / `.git-credentials` / 私钥 / `.pem` 等敏感资源只读门控；审计与拦截消息出口自动脱敏 token / API key / 口令。

### Obfuscated execution — 混淆执行（部分识别）

识别**部分**常见绕过方式：全角字符变体、引号插词、`$()`/反引号子展开、base64 管道、解释器 one-liner（`python -c`、`node -e`、`perl -e`）、shell wrapper 递归解包（`bash -c` / `cmd /c` / `pwsh -Command`）、junction/symlink 逃逸。此处强调「部分」——它不能识别一切混淆攻击（见 [Security Model](#security-model)）。

## How it works

```text
AI Coding Agent
      ↓
 Agent Adapter   (各 Agent 的 Hook / Plugin / pre-execute / tool.before / 命令拦截)
      ↓
 RiskGuard Core  (统一 RiskEvent → Policy Engine，纯函数、fail-closed)
      ↓
   ALLOW / DENY / TRASH
      ↓
  Operating System
```

不同 Agent 使用不同的拦截点（hook / plugin / pre-execute / tool.before / 命令拦截），但都先转换成统一的 `RiskEvent`，再交给**同一个策略内核**判定，保证跨 Agent 行为一致、单一事实源。策略判定是纯函数，可独立于任何 Agent 运行与测试。

核心不变量（在 `packages/core/src`，均有测试锁定）：

| 不变量 | 语义 |
|---|---|
| RG-I01 | 永久删除默认 deny，建议走回收站 |
| RG-I02 | RiskGuard 自身 / 受保护资源不可被修改（单调 deny） |
| RG-I03 | 只要有一层 deny，结果就是 deny（guard 单调性） |
| RG-I04 | 解析失败 / 未知 mutation → fail-closed deny，禁止放行 |
| RG-I05 | 正则不是能力边界（Pattern Policy ≠ Capability Policy） |

架构契约细节见 [docs/adapter-contract.md](docs/adapter-contract.md)。

## 支持矩阵

> 状态含义：**✅ Verified**＝真实 Agent 环境验证；**🟢 Implemented**＝已实现并有测试，缺少完整的真实生产复核；**🟡 Experimental**＝实验性；**⚪ Unsupported**＝尚未实现。
> 区分「**软规则约束**」（写入 AGENTS.md / CLAUDE.md，靠模型遵守）与「**执行前硬拦截**」（hook / plugin / pre-execute 机器门禁）。

| Agent | 集成（Integration） | 执行前硬拦截 | 验证等级 | 状态 |
|---|---|---|---|---|
| **DeepSeek Harness (DSH)** | `pre-execute` 瀑布 + `guard()` 单调不变量 | ✅ 是 | D2 源码实证 + D3 真实会话拦截记录（`Error: 全局铁律…`） | ✅ Verified |
| **Claude Code** | `PreToolUse` adapter + CLAUDE.md 规则 | 🟢 已实现（生产 hook 已接线） | D1 文档 + 单元测试；D3 会话以模型层约束为主 | 🟢 Implemented |
| **Codex** | rules-compiler → AGENTS.md + 生产 PreToolUse hook | 🟢 是（生产 hook 曾实测 DENY `rm -rf`） | D1/D2 + 生产 hook 日志；D3 删除会话待补 | 🟢 Implemented |
| **OpenCode** | `tool.before` TS 插件 + AGENTS.md | 🟢 是（生产插件已注册） | D1 + 单元测试 + D3 会话（以模型层 + 插件 trash 为主） | 🟢 Implemented |
| **Cursor** | `preToolUse` adapter | 🟡 Adapter 已实现 | D1 文档 + 单元测试，无真实 Agent 会话 | 🟡 Implemented / awaiting real-world verification |
| **Windsurf** | `pre_run_command` adapter | 🟡 Adapter 已实现 | D1 文档 + 单元测试，无真实 Agent 会话 | 🟡 Implemented / awaiting real-world verification |
| **Grok** | `PreToolUse` adapter | 🟡 弱（Grok hook 默认为 fail-open） | D1 + 单元测试；边界依赖 Rules/Sandbox | 🟡 Experimental（软约束为主） |
| **Pi** | — | ❌ 无实现 | — | ⚪ Unsupported |

验证等级说明（`docs/adapter-contract.md`）：**D1**＝官方文档确认 API 存在；**D2**＝源码/工程实证；**D3**＝真实 Agent 会话验证；**D4**＝对抗语料加固。

> 诚实声明：Claude Code 与 OpenCode 在 [D3 三 Agent 删除实测](docs/d3-deletion-test-3agents.md) 中的拦截主要来自**模型层规则**（CLAUDE.md / AGENTS.md）与插件注入的 trash 工具，而非机器层门禁；DSH 则有机器级 `pre-execute` 门禁的拦截实锤。机器层硬拦截的完整复核（尤其 Cursor / Windsurf / Grok）仍是持续工作。

## 操作系统支持

| 平台 | 状态 |
|---|---|
| **Windows** | ✅ 已验证（回收站 trash 实测、DSH/Codex hook、D3 会话均在本机 Windows） |
| **macOS** | 🟡 已实现，**未在真实环境实测**（trash 包 `macos.ts` 为 D1） |
| **Linux** | 🟡 已实现，**未在真实环境实测**（CI 在 Ubuntu 跑平台无关测试，trash `linux.ts` 为 D1） |

## 快速开始（Developer Preview）

当前没有一键 `riskguard install` 命令，一键安装器正在完善。以下是最短的真实可用路径：

**a. 跑通测试，确认策略内核可运行**（需要 Node >= 22.18，零构建）：

```bash
cd agent-risk-guard
node --version                  # 要求 >= 22.18
node --test packages/core/test  # 平台无关测试，本仓库 CI 同款
```

**b. 用 CLI 体验策略判定**（stdin JSON → Decision JSON）：

```bash
# 删除 → deny + 回收站建议
cat tests/e2e/payload-delete.json | node packages/cli/src/index.ts
# 写文件 → allow
cat tests/e2e/payload-write.json  | node packages/cli/src/index.ts
# git clean → deny
cat tests/e2e/payload-git-clean.json | node packages/cli/src/index.ts
```

> Windows PowerShell 下用 `Get-Content … -Raw | node packages/cli/src/index.ts` 等价。

**c. 检测本机已安装的 Agent**（只读发现，不会改动任何配置）：

```bash
node -e "import('./packages/installer/src/discovery.ts').then(m=>console.log(m.discoveryToJson(m.discoverAgents())))"
```

**d. 接入某个 Agent**：把对应 adapter / hook 接入你的 Agent（DSH 插件接线见 `docs/dsh-live-wiring-guide.md`，各 Agent 的 payload 形状见 `packages/adapters/<agent>/src`，生产接线现状见 `docs/deployment-status.md`）。

### 效果演示

下面是 CLI 对一次「删除重要目录」请求的**真实输出**（未改动）：

```text
Agent attempts:  remove-item C:\proj\important -Recurse -Force

RiskGuard CLI 输出:
{
  "decision": "deny",
  "ruleId": "RG-FS-001",
  "reason": "永久删除禁止，请使用回收站",
  "safeAlternative": { "operation": "trash", "description": "使用统一 trash 能力（Windows Recycle Bin / macOS Trash / freedesktop Trash）" }
}
```

也就是：

```text
Agent 尝试永久删除  →  RiskGuard →  DENY  →  命令没有真正执行（建议走回收站）
```

## Features（用户价值）

- **Hard blocking before execution** — 在执行前由确定性策略引擎判定并阻断，不依赖模型是否「记得」规则。
- **Trash-first deletion policy** — 永久删除一律 DENY，建议走回收站（trash），可恢复优先。
- **Cross-agent policy core** — 同一策略内核驱动多个 Agent，单一事实源，行为一致。
- **Fail-closed decisions** — 解析失败、未知操作一律拒绝（宁可误拦可人工放行，不可漏拦）。
- **Sensitive resource protection** — .ssh / .env / 私钥等敏感路径只读门控。
- **Obfuscation resistance** — 识别常见混淆与 shell 包裹绕过（部分）。
- **Secret-safe audit logging** — 审计与拦截消息自动脱敏 token / API Key / 口令。
- **Self-protection** — RiskGuard 自身配置不可被删除或篡改。

## Security Model

RiskGuard 是**纵深防御（defense-in-depth）的一环，不是绝对安全边界**。请务必理解以下边界：

- RiskGuard **不保证**阻止所有未知攻击；regex / parser 检测存在其固有边界。
- 它**不应替代** OS 级沙箱（Seatbelt / bubblewrap / 受限账号 / 容器）。
- 它**不应替代**最小权限账户。
- 它**不应替代**备份，也不应替代你的 Git / 文件系统恢复策略。
- 发现新的绕过向量，请通过 [SECURITY.md](SECURITY.md) 的私密渠道报告，**不要**公开演示利用方式。

## 文档导航

- [docs/adapter-contract.md](docs/adapter-contract.md) — 适配器契约（Vendor Payload → RiskEvent → Decision）与验证等级（D1–D4）
- [docs/deployment-status.md](docs/deployment-status.md) — 本机生产接线现状与同步清单
- [docs/d3-deletion-test-3agents.md](docs/d3-deletion-test-3agents.md) — 三 Agent 删除测试真实会话实证
- [docs/ecosystem-benchmark.md](docs/ecosystem-benchmark.md) — 生态对标（allowlister / CC Safety Net 等）与融合决策、Roadmap
- [docs/dsh-api-evidence-d2.md](docs/dsh-api-evidence-d2.md) — DSH `pre-execute` + `guard()` 源码级实证
- [docs/dsh-live-wiring-guide.md](docs/dsh-live-wiring-guide.md) — DSH 插件真实接入指南
- [docs/TODO.md](docs/TODO.md) — 待办清单（含待确认的生产同步项）

## 开发与安全验证

- **GAN 式对抗审查（maker-checker）**：本项目在开发过程中用「生成者 / 判别者」对抗思想做多轮**独立判别器复审**（core / installer / opencode / adapter / hook），并留存修复映射。注意：这是一种**开发／审查方法论**，RiskGuard **运行时并不依赖任何 GAN / 神经网络模型**。详见 [docs/gan-audit-fix-map.md](docs/gan-audit-fix-map.md)。
- 测试：`tests/` 含 policy / adapter / conformance / e2e / adversarial（对抗语料 + 规则自测），全量 134/134 通过（本机，含 Windows trash / junction 真实执行；CI 在 Ubuntu 跑平台无关组）。

## 社区与协议

- **License**：[MIT](LICENSE) — Copyright (c) 2026 satan9394
- **行为准则**：[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- **贡献指南**：[CONTRIBUTING.md](CONTRIBUTING.md)
- **安全报告**：[SECURITY.md](SECURITY.md)
- **版本历史**：[CHANGELOG.md](CHANGELOG.md)

> **版本说明**：当前统一产品版本为 **`v0.1.0 Developer Preview`**（`package.json` = `0.1.0`）。
> 历史 Git tag `v1.0.0` 保留不作删除（它代表此前发布标记，非当前产品稳定版声明）；当前仍存在未完成真实环境验证的平台与 Agent，因此不宣称 1.0 Stable。详见 `docs/TODO.md` 与 `CHANGELOG.md`。
