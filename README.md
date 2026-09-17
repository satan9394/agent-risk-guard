# Agent Risk Guard

**Deterministic safety guardrails for AI coding agents.**

**[English](README.en.md) | [中文](README.md)**

**Cross-agent runtime security enforcement with experimental OWASP ACS v0.1.0 schema alignment.**

在 AI Agent 真正执行文件删除、Shell 命令、Git 破坏性操作之前，进行确定性安全拦截——把「永久删除」变成「回收站」，把破坏性操作挡在执行之前。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node >= 22.18](https://img.shields.io/badge/Node-%3E%3D%2022.18-green.svg)](#)
[![CI](https://github.com/satan9394/agent-risk-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/satan9394/agent-risk-guard/actions/workflows/ci.yml)

> **状态：`v0.3.1 Developer Preview`**（Pre-release）。核心策略引擎、事务式 CLI 安装器与各 Agent 适配器已实现，
> 并有自动化测试覆盖；**在真实 Agent 会话中验证过拦截**的是 Claude Code、OpenCode、Antigravity CLI
> ——危险命令在执行前被拒绝、未提交的改动存活。**macOS / Linux 已实现，但尚未在真实环境实测。**
>
> 每个 Agent 究竟覆盖到什么程度（含「Codex 的拦截来自它自身的策略/沙箱层」「DSH 生效的是规则补丁而不是插件」
> 这两处容易误读的地方）见下方 [支持矩阵](#支持矩阵) 与 [Security Model](#security-model)。
> **每个版本出了什么问题、改了什么**，见 [Releases](https://github.com/satan9394/agent-risk-guard/releases)
> 与 [docs/release-notes/](docs/release-notes/)（中英双语）；完整历史见 [CHANGELOG.md](CHANGELOG.md)。

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
> **真实执行边界矩阵**（Compatibility Schema v2：surfaces / fail mode / policy scope / bypass / 边界层 / per-capability）由 [docs/generated/agent-security-matrix.md](docs/generated/agent-security-matrix.md) 自动生成（`node scripts/generate-agent-security-matrix.ts`，CI 防漂移），本节保留人工可读汇总表。

| Agent | 集成（Integration） | 执行前硬拦截 | 验证等级 | 状态 |
|---|---|---|---|---|
| **DeepSeek Harness (DSH)** | 实际生效的是 profile 注入的 **`deny-risk-commands` 规则补丁**（正则匹配）；`@riskguard/dsh` 插件（`pre-execute` 瀑布 + `guard()` 单调不变量）**已实现且有测试，但尚未接入任何 profile** | ✅ 是（在**规则补丁**这一层） | Windows D3（真实会话拦截记录 `Error: 全局铁律…`）；macOS/Linux D1 | ✅ Verified（**保护来自规则补丁，不是插件**） |
| **Claude Code** | `PreToolUse` hook（matcher `Bash` → `dangerous-commands.ps1`）+ CLAUDE.md 规则 | ✅ 是（机器层硬门禁；bypassPermissions 下仍拦截） | Windows D3（真实会话 permission-rule 阻断）；macOS/Linux D1 | ✅ Verified（本机 Windows） |
| **Codex** | rules-compiler → AGENTS.md + 生产 PreToolUse hook（应用/CLI 共用 `~/.codex/` 双注册） | ✅ 是（hook 已接线；DENY/ALLOW 实测） | Windows D3（应用 `approval_policy=never`+`sandbox=unelevated` 策略层真实拦截 + **CLI 0.153.4 hook 真实会话 2026-09-07**）；macOS/Linux D1 | ✅ Verified（本机 Windows） |
| **OpenCode** | `tool.execute.before` TS 插件 + AGENTS.md | ✅ 是（生产插件已注册；bash allow 仍拦截） | Windows D3（真实会话 `BLOCKED_BY_GLOBAL_SAFETY_GUARD`）；macOS/Linux D1 | ✅ Verified（本机 Windows） |
| **Antigravity CLI (AGY)** | `PreToolUse` hook（matcher `run_command`）@ `~/.gemini/config/hooks.json` | ✅ 是（适配器 `agy-dangerous-commands.ps1`，fail-closed，带 BOM） | Windows D3（真实会话 2026-09-06：git 硬重置被 deny、未提交改动保留）；macOS/Linux D1 | ✅ Verified（本机 Windows） |
| **Cursor** | `preToolUse` adapter | 🟡 Adapter 已实现 | D1 文档 + 单元测试，无真实 Agent 会话 | 🟡 Implemented / awaiting real-world verification |
| **Windsurf** | `pre_run_command` adapter | 🟡 Adapter 已实现 | D1 文档 + 单元测试，无真实 Agent 会话 | 🟡 Implemented / awaiting real-world verification |
| **Grok** | `PreToolUse` adapter | 🟡 弱（Grok hook 默认为 fail-open） | D1 + 单元测试；边界依赖 Rules/Sandbox | 🟡 Experimental（软约束为主） |
| **Pi** | — | ❌ 无实现 | — | ⚪ Unsupported |

验证等级单一事实源为 `packages/installer/compatibility.json`：**D0**＝Unsupported；**D1**＝Implementation exists；**D2**＝Automated test verified；**D3**＝Real agent execution verified；**D4**＝Repeated / production verified。D3/D4 是产品能力等级，不代表某台机器当前 `ACTIVE`（机器状态看 `riskguard status` 的 Runtime）。本表各 Agent 的等级来自该文件（CI 有 `check-compatibility-docs` 防漂移）。

> 关于「早期拦截」：Claude Code 与 OpenCode 在 [D3 三 Agent 删除实测](docs/d3-deletion-test-3agents.md) 里的拦截主要来自**模型层规则**与插件注入的 trash 工具；v0.1.0 起才补上**机器层硬门禁**的真实会话复核。上表每一行的证据与来源见 [docs/deployment-status.md](docs/deployment-status.md) 与 [docs/real-agent-conformance-final-report.md](docs/real-agent-conformance-final-report.md)，全部拦截经 [GAN 对抗审查](docs/GAN-AUDIT-5AGENTS.md)（17 findings 全修复）验证无已知绕过。
>
> ⚠️ 排查接线时注意：Claude Code 那一行，本机实际注册的是 `PreToolUse`（matcher `Bash` → `dangerous-commands.ps1`），而安装器写入的条目 id 是 `riskguard-pre-tool-hook`——两者指同一个 hook，但**同名不代表同源**，请以配置文件原文为准。

## 欢迎使用与贡献

本项目**已开源，欢迎任何人使用、提问、提 Issue**。覆盖面还很窄——目前只在少数几个 Agent 上做过真实会话验证，而 AI 编码 Agent 这个赛道几乎每个月都有新面孔。**如果你在用的 Agent 不在上面的矩阵里，那正是我们想知道的。**

两种入口（Issue 模板已就绪）：

- **[申请补充 Agent 类型](https://github.com/satan9394/agent-risk-guard/issues/new?template=new_agent_request.yml)** —— 最想知道三件事：它**有没有执行前拦截点**、工具调用的 **JSON 形状**、以及一条**真实的拦截证据**。
- **[报告某 Agent 的安全机制 / 环境情况](https://github.com/satan9394/agent-risk-guard/issues/new?template=agent_security_report.yml)** —— 如果你已经在这个 Agent 上跑了 RiskGuard，发现某条规则过严 / 过松，或者发现它自带的沙箱已经覆盖了一部分，用这个。

动手之前建议先读 **[新增一个 Agent 需要什么](docs/adding-an-agent.md)**：里面列了接线所需的全部信息、代码落点、自测命令，以及我们会守的硬约束。只想提一句建议、不想写代码也完全可以——**一份该 Agent 的 hook/插件文档截图，通常就够我们判断"能不能做硬门禁"**，而"这个 Agent 只能做软约束"本身也是有用结论。

**特别欢迎的三类信息**：① 某个 Agent 的 hook / 插件契约（配置路径 + 事件形状 + 拒绝返回形状）；② 该 hook 在**失败时**是 fail-open 还是 fail-closed（用空 stdin 就能测）；③ 一条真实会话里的**拦截或漏拦**记录（含版本与日期）。

> ⚠️ **安全漏洞不要开公开 Issue**：绕过规则、或任何能让危险命令真正执行的方式，请走 [SECURITY.md](SECURITY.md)。

## 操作系统支持

| 平台 | 状态 |
|---|---|
| **Windows** | ✅ 已验证（回收站 trash 实测、DSH/Codex hook、D3 会话均在本机 Windows） |
| **macOS** | 🟡 已实现，**未在真实环境实测**（trash 包 `macos.ts` 为 D1） |
| **Linux** | 🟡 已实现，**未在真实环境实测**（CI 在 Ubuntu 跑平台无关测试，trash `linux.ts` 为 D1） |

## Agent Skill（canonical）

本仓库同时是 **Agent Skill 的 canonical 源**（`skills/agent-risk-guard/`，含 SKILL.md + 拦截脚本 + 配置模板，符合开放 `SKILL.md` 标准）。任何支持 Agent Skills 的运行时（Claude Code / Codex / Gemini CLI / OpenCode / Antigravity 等）都可直接安装：

```bash
# 经 Vercel skills 生态安装
npx skills add satan9394/agent-risk-guard            # 安装全部
npx skills add satan9394/agent-risk-guard --skill agent-risk-guard
```

安装后按 `skills/agent-risk-guard/SKILL.md` 的「快速适配」流程，即可为本机各 Agent 落地机器级拦截门禁（hooks / 插件 / pre-execute）。

## 快速开始（Developer Preview）

RiskGuard 提供一个**零依赖、零构建**的用户级 CLI（`riskguard`），支持安装 / 状态 / 诊断 / 卸载。要求 Node >= 22.18。仓库内统一入口：`node bin/riskguard.mjs`（等价 `node packages/cli/src/index.ts`，用户无需面对内部源码路径）。

```bash
cd agent-risk-guard
# 查看 CLI 用法
node bin/riskguard.mjs help
```

**0.（推荐）安装 portable runtime**——把运行所需最小文件集装入 `~/.riskguard/runtime/<version>/`，此后 Agent hook 指向 runtime 而非 git clone 路径；删除 / 移动源码仓库后 RiskGuard 仍工作：

```bash
node bin/riskguard.mjs bootstrap          # 首次安装 portable runtime
node bin/riskguard.mjs bootstrap --force  # runtime 损坏时修复重装
```

> 分发/自包含模式：`node scripts/build-release.ts` 生成 `dist/agent-risk-guard-v<version>/`（含 `bin/riskguard.mjs` launcher、`runtime-manifest.json`、`SHA256SUMS.txt`）。artifact 可在 fake HOME 独立完成 detect / install / doctor / uninstall，不依赖源码仓库。

**1. 先只读检测本机装了哪些 Agent**（不会改动任何配置）：

```bash
node bin/riskguard.mjs detect          # 人类可读
node bin/riskguard.mjs detect --json   # {claude-code, codex, opencode, dsh} 布尔表
```

**2. 查看每个 Agent 的 Runtime 状态与产品能力等级**：

```bash
node bin/riskguard.mjs status
```

`status` 区分两个概念：**Capability**（产品对该 Agent 支持到 D0–D4，来自 `compatibility.json`）与 **Runtime**（这台机器的实际状态：`NOT_DETECTED` / `DETECTED` / `INSTALLED` / `ACTIVE` / `BROKEN`——`ACTIVE` 表示完整 runtime self-test 通过）。

**3. 健康检查**（PASS / WARN / FAIL / SKIP；未安装的 Agent 计 SKIP、不算 FAIL）：

```bash
node bin/riskguard.mjs doctor
```

**4. 安装 / 修复**（事务式：类型化读取 → backup → merge → manifest → runtime self-test → commit；`--dry-run` 先预览；支持 `--agent` alias）：

```bash
node bin/riskguard.mjs install --dry-run            # 只显示将改什么，不落盘
node bin/riskguard.mjs install                      # 交互式：先列出已检测 Agent 供编号勾选；非 TTY/管道自动全装不卡死
node bin/riskguard.mjs install --all --dry-run      # 跳过交互，直接全装已检测到的
node bin/riskguard.mjs install --agent claude       # 只装一个（cc/claude/claude-code 等价；oc=opencode）
```

`detect` 覆盖 Claude Code / Codex / OpenCode / DSH / Hermes / AGY / Cursor / Windsurf / Grok / Copilot CLI / Cline / Aider / Goose。`install` 无 `--agent` 时对检测到的 Agent 做交互式选择（`1,3` / `all` / 回车全装），非交互环境自动全装不卡死。安装是**非破坏性**的：merge 保留用户字段，配置损坏 / 无权限 / IO 错误立即终止且零写入，任一步失败回滚到安装前；wiring 损坏（`BROKEN`）时 install 自动识别为 **repair**。

**5. 卸载**（精确逆操作：只移除 RiskGuard 注入的条目，保留用户 install 之后新增的配置）：

```bash
node bin/riskguard.mjs uninstall --dry-run
node bin/riskguard.mjs uninstall
```

卸载依据 manifest 精确移除；被用户修改过的 RiskGuard 文件不会自动删除；manifest 缺失时提示「nothing to do」，不会误删。

**6.（v0.2.0/v0.2.1）OWASP ACS 边界协议 Gateway**——把 ACS ToolCallRequest 无损送入 RiskGuard 策略引擎，输出合法 ACS Result（fail-closed；详见 [docs/acs-alignment.md](docs/acs-alignment.md)）：

```bash
cat tests/fixtures/acs-v0.1/git-reset-hard.json | node bin/riskguard.mjs acs evaluate
cat tests/fixtures/acs-v0.1/shell-safe.json     | node bin/riskguard.mjs acs evaluate --audit
cat request.json | node bin/riskguard.mjs acs evaluate --profile strict
cat envelope.json | node bin/riskguard.mjs acs evaluate --wire   # official ACS v0.1.0 JSON-RPC wire mode
```

- `acs evaluate` = payload 兼容模式；`acs evaluate --wire` = 官方 ACS v0.1.0 schema 一致的 wire 模式（Request Envelope → Response Envelope）。
- 非法输入不抛 stack trace：payload 模式输出 `decision: deny` + `extensions.riskguard.degraded = true`；wire 模式输出 JSON-RPC error（`-32700` / `-32600` / `-32602`）。
- 官方 OWASP ACS v0.1.0 JSON Schema 已 pinned 于 `tests/vendor/owasp-acs-v0.1.0/`（只读），是 Release Gate。

**7. 退出码约定**（脚本 / CI 可依赖；`riskguard help` 亦列出）：

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功。含 doctor 有 WARN 但无 FAIL、install 幂等（`already installed`）、卸载一个「本来就没装」的 agent。**hook 运行时（无子命令：stdin JSON → decision JSON）恒为 0**——allow 与 deny 都是正常决策，空输入 / 坏 JSON 的 fail-closed deny 也不是错误（Claude Code / Codex 集成依赖此行为）。 |
| `1` | 失败。doctor 有 ≥1 个 FAIL（FAIL 行尾附带可直接执行的修复提示）；install 被中止（配置损坏 / 插件同名异内容）、回滚或 runtime self-test 未通过、显式指定的 agent 未安装；uninstall 被拒或失败；bootstrap 失败。 |
| `2` | 用法错误。未知子命令（拼写错误、空参数字符串）——此时输出 `Unknown command: …` + help 提示，**不再**静默落入 hook 运行时；install / uninstall 指定了未知或本 CLI 不支持的 agent。 |

例：`node bin/riskguard.mjs doctor || echo "RiskGuard 未生效"`；CI 健康检查可直接用退出码判定，配合 `doctor --json` 拿到机器可读的 `{pass,warn,fail,skip,exitCode,checks}`。

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

## Security Model

RiskGuard 是**纵深防御（defense-in-depth）的一环，不是绝对安全边界**。请务必理解以下边界：

- RiskGuard **不保证**阻止所有未知攻击；regex / parser 检测存在其固有边界。
- 它**不应替代** OS 级沙箱（Seatbelt / bubblewrap / 受限账号 / 容器）。
- 它**不应替代**最小权限账户。
- 它**不应替代**备份，也不应替代你的 Git / 文件系统恢复策略。
- 发现新的绕过向量，请通过 [SECURITY.md](SECURITY.md) 的私密渠道报告，**不要**公开演示利用方式。

## 文档导航

- [docs/acs-alignment.md](docs/acs-alignment.md) — OWASP ACS v0.1 对齐边界（inbound/outbound 映射、Compatibility v2、Conformance C1–C10、审计格式）
- [docs/generated/agent-security-matrix.md](docs/generated/agent-security-matrix.md) — Agent 安全执行边界矩阵（自动生成自 compatibility.json）
- [docs/adapter-contract.md](docs/adapter-contract.md) — 适配器契约（Vendor Payload → RiskEvent → Decision）与验证等级（D0–D4，单一事实源见 compatibility.json）
- [docs/deployment-status.md](docs/deployment-status.md) — 本机生产接线现状与同步清单
- [docs/d3-deletion-test-3agents.md](docs/d3-deletion-test-3agents.md) — 三 Agent 删除测试真实会话实证
- [docs/GAN-AUDIT-5AGENTS.md](docs/GAN-AUDIT-5AGENTS.md) — 5 Agent 对抗审查（17 findings 全修复）
- [docs/real-agent-conformance-final-report.md](docs/real-agent-conformance-final-report.md) — v0.3.0 最终验收报告（A/B 对照、各 Agent 等级）
- [docs/ecosystem-benchmark.md](docs/ecosystem-benchmark.md) — 生态对标（allowlister / CC Safety Net 等）与融合决策、Roadmap
- [docs/dsh-api-evidence-d2.md](docs/dsh-api-evidence-d2.md) — DSH `pre-execute` + `guard()` 源码级实证
- [docs/dsh-live-wiring-guide.md](docs/dsh-live-wiring-guide.md) — DSH 插件真实接入指南
- **开发日志**：[v0.1.0→v0.1.2](docs/devlog-2026-09-04-v0.1.2.md) · [v0.2.0](docs/devlog-2026-09-05-v0.2.0.md) · [v0.2.1](docs/devlog-2026-09-05-v0.2.1.md) · [v0.2.2](docs/devlog-2026-09-05-v0.2.2.md) · [v0.3.0](docs/devlog-2026-09-07-v0.3.0.md)
- [docs/real-agent-conformance-status.md](docs/real-agent-conformance-status.md) — v0.3.0 Real Agent Conformance 进度与诚实结论（D3 evidence 格式 / runner / 三家 adapter / 环境探测）
- [docs/TODO.md](docs/TODO.md) — 待办清单（含待确认的生产同步项）

## 开发与安全验证

- **独立判别器对抗审查（maker-checker）**：每个切片都由**未参与实现**的判别器复审，且要求「回退该修复必须让某个测试变红」，防止闸门变成自证式。v0.3.0 对 5 个 Agent 的生产拦截做全量对抗审查，产出 17 findings（P0×10 / P1×6 / P2×1）**全部修复并复验**——见 [docs/GAN-AUDIT-5AGENTS.md](docs/GAN-AUDIT-5AGENTS.md) 与 [docs/gan-audit-fix-map.md](docs/gan-audit-fix-map.md)。这是一种**开发方法论**；RiskGuard 运行时**不依赖任何模型**。
- 测试：`tests/` 覆盖 policy / adapter / acs / acs-schema-conformance / compatibility / conformance / e2e / adversarial（对抗语料 + 规则自测），全量 **380/380** 通过；CI 在 Ubuntu 跑平台无关组，本机 `test-all.ps1` 另含 D3 hook 管线与 WSL sh 套件。

## 生产接线巡检（日常治理）

安装后建议定期核对「接线是否还在位、脚本是否与单一规则源一致」——Claude Code 的 `PreToolUse` 就曾**被外部还原丢失**，而当时 hook 文件在位、哈希正确、套件全绿，防护却在静默失效。本仓库提供只读巡检脚本：

```powershell
# 只读巡检（缺失/漂移时退出码非 0，输出逐项 [OK]/[!!]）
pwsh scripts/riskguard-wiring-check.ps1

# 巡检 + 自愈（从仓库单源恢复 ps1 / opencode / dsh patch；claude-code settings.json 合并式补回 PreToolUse；恢复前自动备份到 ~/.risk-guard-backup/）
pwsh scripts/riskguard-wiring-check.ps1 -Fix
```

检查范围：三处 ps1 生产接线与仓库单源的哈希一致性、opencode 插件、dsh patch，以及 settings.json / hooks.json / config.toml 的接线在位。

## 社区与协议

- **License**：[MIT](LICENSE) — Copyright (c) 2026 satan9394
- **行为准则**：[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- **贡献指南**：[CONTRIBUTING.md](CONTRIBUTING.md)
- **安全报告**：[SECURITY.md](SECURITY.md)
- **版本历史**：[CHANGELOG.md](CHANGELOG.md)
- **发行说明（每版「出了什么问题 + 改变了什么」，中英双语）**：[docs/release-notes/](docs/release-notes/)

> 历史 Git tag `v1.0.0` 保留不删：它是早期发布标记，**不代表当前稳定版**。尚无 1.0 Stable 声明的原因见上方 [操作系统支持](#操作系统支持) 与 [支持矩阵](#支持矩阵)。
