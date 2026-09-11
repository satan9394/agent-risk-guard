# Agent Risk Guard

**Deterministic safety guardrails for AI coding agents.**

**[English](README.en.md) | [中文](README.md)**

**Cross-agent runtime security enforcement with experimental OWASP ACS v0.1.0 schema alignment.**

在 AI Agent 真正执行文件删除、Shell 命令、Git 破坏性操作之前，进行确定性安全拦截——把「永久删除」变成「回收站」，把破坏性操作挡在执行之前。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node >= 22.18](https://img.shields.io/badge/Node-%3E%3D%2022.18-green.svg)](#)
[![CI](https://github.com/satan9394/agent-risk-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/satan9394/agent-risk-guard/actions/workflows/ci.yml)

> **状态：`v0.3.0 Developer Preview`**。核心策略引擎、事务式 CLI 安装器、DSH 插件与各 Agent 适配器已实现并通过自动化测试；
> 生产接线已在本机单点验证（Claude Code / OpenCode / Codex / DSH / AGY），macOS / Linux 尚未在真实环境实测（详见 [支持矩阵](#支持矩阵) 与 [Security Model](#security-model)）。
> v0.2.0 新增 **OWASP ACS v0.1 experimental gateway**（`riskguard acs evaluate`）、**Compatibility Schema v2**（真实执行边界）、**Capability taxonomy** 与 **Agent Security Conformance Framework**（C1–C10）。v0.2.1 补齐 **Wire Schema Conformance**：官方 OWASP ACS v0.1.0 JSON Schema（pinned 快照）成为最终兼容性判据，新增 `acs evaluate --wire`（official JSON-RPC Request/Response Envelope）。v0.2.2 冻结 ACS 协议层：新增 **ACS version gate**（官方 wire gateway 精确拒绝不支持版本，返回 `-32001`，绝不误当作 0.1.0 处理）与 **release workflow**（GitHub Release 真正上传可校验的 `tar.gz` + `SHA256SUMS.txt`）。**v0.3.0 Real Agent Conformance**：定位从「构建基础设施」转向「真实 Agent 会话验证」——**5 个 Agent 全部拿到真实会话硬拦截证据（D3）**：OpenCode / Claude Code / DSH / AGY 由 RiskGuard hook / plugin 真实会话验证，Codex 为「应用策略/沙箱层（`approval_policy=never` + `sandbox=unelevated`）+ **Codex CLI 0.153.4 hook 真实会话补测（2026-09-07）**」双证据；另完成 **GAN 对抗审查**（17 findings：P0×10/P1×6/P2×1 全部修复）与 **installer UX**（`detect` 全量检测含 agy、`install` 交互式选择）。

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
| **DeepSeek Harness (DSH)** | `pre-execute` 瀑布 + `guard()` 单调不变量 | ✅ 是 | Windows D3（真实会话拦截记录 `Error: 全局铁律…`）；macOS/Linux D1 | ✅ Verified |
| **Claude Code** | `PreToolUse` hook（`riskguard-pre-tool-hook`）+ CLAUDE.md 规则 | ✅ 是（机器层硬门禁；bypassPermissions 下仍拦截） | Windows D3（真实会话 permission-rule 阻断）；macOS/Linux D1 | ✅ Verified（本机 Windows） |
| **Codex** | rules-compiler → AGENTS.md + 生产 PreToolUse hook（应用/CLI 共用 `~/.codex/` 双注册） | ✅ 是（hook 已接线；DENY/ALLOW 实测） | Windows D3（应用 `approval_policy=never`+`sandbox=unelevated` 策略层真实拦截 + **CLI 0.153.4 hook 真实会话 2026-09-07**）；macOS/Linux D1 | ✅ Verified（本机 Windows） |
| **OpenCode** | `tool.execute.before` TS 插件 + AGENTS.md | ✅ 是（生产插件已注册；bash allow 仍拦截） | Windows D3（真实会话 `BLOCKED_BY_GLOBAL_SAFETY_GUARD`）；macOS/Linux D1 | ✅ Verified（本机 Windows） |
| **Cursor** | `preToolUse` adapter | 🟡 Adapter 已实现 | D1 文档 + 单元测试，无真实 Agent 会话 | 🟡 Implemented / awaiting real-world verification |
| **Windsurf** | `pre_run_command` adapter | 🟡 Adapter 已实现 | D1 文档 + 单元测试，无真实 Agent 会话 | 🟡 Implemented / awaiting real-world verification |
| **Grok** | `PreToolUse` adapter | 🟡 弱（Grok hook 默认为 fail-open） | D1 + 单元测试；边界依赖 Rules/Sandbox | 🟡 Experimental（软约束为主） |
| **Pi** | — | ❌ 无实现 | — | ⚪ Unsupported |

验证等级单一事实源为 `packages/installer/compatibility.json`：**D0**＝Unsupported；**D1**＝Implementation exists；**D2**＝Automated test verified；**D3**＝Real agent execution verified；**D4**＝Repeated / production verified。D3/D4 是产品能力等级，不代表某台机器当前 `ACTIVE`（机器状态看 `riskguard status` 的 Runtime）。本表各 Agent 的等级来自该文件（CI 有 `check-compatibility-docs` 防漂移）。

> 诚实声明：Claude Code 与 OpenCode 在 [D3 三 Agent 删除实测](docs/d3-deletion-test-3agents.md) 中的早期拦截主要来自**模型层规则**（CLAUDE.md / AGENTS.md）与插件注入的 trash 工具；v0.1.0 起已在本机补上**机器层硬门禁**的真实 D3 复核（见 [docs/deployment-status.md](docs/deployment-status.md)）：真实 `claude -p --permission-mode bypassPermissions` 与 `opencode run` 会话中，`git reset --hard` 均被 RiskGuard hook / plugin 在工具执行前拒绝（Claude Code 侧 `permission-rule`、OpenCode 侧 `BLOCKED_BY_GLOBAL_SAFETY_GUARD`），未提交改动存活。DSH 保持机器级 `pre-execute` 门禁拦截实锤。AGY（Antigravity CLI 1.1.27）经 `~/.gemini/config/hooks.json` PreToolUse 真实会话验证（git reset --hard 被 deny、未提交修改保留）。Codex 应用形态（VS Code 扩展 + codex.exe）拦截来自应用策略/沙箱层（`approval_policy=never` + `sandbox=unelevated`，用户 2026-09-06 应用内手动验证 blocked by policy），并经 **Codex CLI 0.153.4 真实会话补测（2026-09-07）**确认 RiskGuard PreToolUse hook 亦在工具层拦截（hook 日志 deny 吻合、未提交改动保留）。Cursor / Windsurf / Grok 的机器层硬拦截仍待真实会话复核。所有拦截经 [GAN 对抗审查](docs/GAN-AUDIT-5AGENTS.md)（17 findings 全修复）验证无已知绕过。

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

status 区分两个概念：**Capability**（RiskGuard 对该 Agent 理论/实测支持到 D0–D4，来自单一事实源 `compatibility.json`）与 **Runtime**（这台机器当前实际状态）。Runtime 取值 `NOT_DETECTED`（Agent 不存在）/ `DETECTED`（Agent 在，RiskGuard 未装）/ `INSTALLED`（已装待确认）/ `ACTIVE`（完整 runtime self-test 通过，真的在拦截）/ `BROKEN`（manifest 在但接线缺失损坏）。另显示 **Verification** 模式：`dynamic`（Claude Code / Codex——真实执行 interception runtime self-test）/ `static`（OpenCode / DSH——wiring + artifact + integrity），两种不混同。

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

`riskguard detect`（v0.3.0 起）全量检测已知 Agent（含 Claude Code / Codex / OpenCode / DSH / Hermes / AGY / Cursor / Windsurf / Grok / Copilot CLI / Cline / Aider / Goose），`install` 无 `--agent` 时对已检测到的 Agent 做交互式选择（输入编号/逗号，如 `1,3` / `all` / 回车默认全装；非交互环境自动全装不卡死），`--all`/`--yes` 跳过交互。已安装但 wiring 损坏（BROKEN）时，install 会识别为 **repair**（输出 `repaired successfully`），成功恢复后 ACTIVE；仅「无改动 + 健康 ACTIVE」才报 `already installed`。安装**非破坏性**：merge 保留用户字段；损坏 JSON / 无权限 / IO 错误立即终止零写入；OpenCode 插件目标同名异内容（SHA256 不符）拒绝安装；任一步失败回滚到安装前（含旧 manifest 恢复），不留下半成品。

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

- `acs evaluate` = **payload compatibility mode**（RiskGuard convenience interface）；`acs evaluate --wire` = **official ACS v0.1.0 schema-conformant wire mode**（Request Envelope → Response Envelope；§四十七/§四十八/§四十九）。
- 非法输入不抛 stack trace：payload mode 输出 `{ "decision": "deny", "reasoning": "Invalid ACS ToolCallRequest: …" }` 且 `extensions.riskguard.degraded = true`（fail-closed，§十八）；wire mode 输出 JSON-RPC error（-32700/-32600/-32602，§四十/§四十一）。
- 官方 OWASP ACS v0.1.0 JSON Schema 已 pinned 于 `tests/vendor/owasp-acs-v0.1.0/`（upstream commit 记录在 README；只读，§五十五），是 v0.2.1 起的 Release Gate（§五十三）。

> Windows PowerShell：`Get-Content … -Raw | node packages/cli/src/index.ts` 仍可用作 stdin-JSON → Decision-JSON 的底层判定入口；高级 agent 接入见 `packages/adapters/<agent>/src` 与 `docs/deployment-status.md`。

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

- [docs/acs-alignment.md](docs/acs-alignment.md) — OWASP ACS v0.1 对齐边界（inbound/outbound 映射、Compatibility v2、Conformance C1–C10、审计格式）
- [docs/generated/agent-security-matrix.md](docs/generated/agent-security-matrix.md) — Agent 安全执行边界矩阵（自动生成自 compatibility.json）
- [docs/adapter-contract.md](docs/adapter-contract.md) — 适配器契约（Vendor Payload → RiskEvent → Decision）与验证等级（D0–D4，单一事实源见 compatibility.json）
- [docs/deployment-status.md](docs/deployment-status.md) — 本机生产接线现状与同步清单
- [docs/d3-deletion-test-3agents.md](docs/d3-deletion-test-3agents.md) — 三 Agent 删除测试真实会话实证
- [docs/ecosystem-benchmark.md](docs/ecosystem-benchmark.md) — 生态对标（allowlister / CC Safety Net 等）与融合决策、Roadmap
- [docs/dsh-api-evidence-d2.md](docs/dsh-api-evidence-d2.md) — DSH `pre-execute` + `guard()` 源码级实证
- [docs/dsh-live-wiring-guide.md](docs/dsh-live-wiring-guide.md) — DSH 插件真实接入指南
- [docs/devlog-2026-09-04-v0.1.2.md](docs/devlog-2026-09-04-v0.1.2.md) — 开发日志：v0.1.0 → v0.1.2（安装器收尾 + portable runtime 分发）
- [docs/devlog-2026-09-05-v0.2.0.md](docs/devlog-2026-09-05-v0.2.0.md) — 开发日志：v0.2.0（ACS Alignment Foundation）
- [docs/devlog-2026-09-05-v0.2.1.md](docs/devlog-2026-09-05-v0.2.1.md) — 开发日志：v0.2.1（ACS Schema Conformance Patch，官方 JSON Schema 判据 + wire mode）
- [docs/devlog-2026-09-05-v0.2.2.md](docs/devlog-2026-09-05-v0.2.2.md) — 开发日志：v0.2.2（ACS Protocol Finalization，version gate + release assets）
- [docs/devlog-2026-09-07-v0.3.0.md](docs/devlog-2026-09-07-v0.3.0.md) — 开发日志：v0.3.0（Real Agent Conformance，5-Agent D3 / GAN 审查闭环 / installer UX / Codex 应用形态真相 / ps1 资产入仓库）
- [docs/real-agent-conformance-status.md](docs/real-agent-conformance-status.md) — v0.3.0 Real Agent Conformance 进度与诚实结论（D3 evidence 格式 / runner / 三家 adapter / 环境探测）
- [docs/TODO.md](docs/TODO.md) — 待办清单（含待确认的生产同步项）

## 开发与安全验证

- **GAN 式对抗审查（maker-checker）**：本项目在开发过程中用「生成者 / 判别者」对抗思想做多轮**独立判别器复审**（core / installer / opencode / adapter / hook），并留存修复映射。v0.3.0 对 5 Agent 生产拦截做全量对抗审查（workflow fan-out 独立判别器），产出 17 findings（P0×10 / P1×6 / P2×1）——大小写变体、fail-open、落盘执行链、引号/反引号插词、`bash -xec` 解包、`arm` 误排除、`os.system` 正则错位、`-EncodedCommand` base64、xargs/-execdir、git 单文件 restore 等——**全部修复并复验**（见 [docs/GAN-AUDIT-5AGENTS.md](docs/GAN-AUDIT-5AGENTS.md)）。注意：这是一种**开发／审查方法论**，RiskGuard **运行时并不依赖任何 GAN / 神经网络模型**。详见 [docs/gan-audit-fix-map.md](docs/gan-audit-fix-map.md)。
- 测试：`tests/` 含 policy / adapter / acs / acs-schema-conformance / compatibility / conformance / e2e / adversarial（对抗语料 + 规则自测），全量 312/312 通过（本机，平台无关组；含 Windows trash / junction 真实执行；CI 在 Ubuntu 跑平台无关组，本机 test-all.ps1 另含 D3 hook 管线与 WSL sh 套件）。

## 生产接线巡检（日常治理）

历史教训：claude-code `settings.json` 的 PreToolUse 曾多次被**外部还原丢失**（hooks 只剩 Setup、bypassPermissions），防护静默失效（fail-open）；dsh 升级（0.1.1 → 0.1.5-rc.1）后规则修订也出现过「生产已改、仓库未同步」的漂移。提供只读巡检脚本，把「接线在位 + 单一规则源 hash 一致」立为日常动作：

```powershell
# 只读巡检（缺失/漂移时退出码非 0，输出逐项 [OK]/[!!]）
pwsh scripts/riskguard-wiring-check.ps1

# 巡检 + 自愈（从仓库单源恢复 ps1 / opencode / dsh patch；claude-code settings.json 合并式补回 PreToolUse；恢复前自动备份到 ~/.risk-guard-backup/）
pwsh scripts/riskguard-wiring-check.ps1 -Fix
```

检查范围：ps1 三处生产（claude-code / codex / agy）← 仓库 `assets/hooks/dangerous-commands.ps1`；opencode 生产插件 ← `assets/opencode/agent-risk-guard.ts`；dsh web patch ← `assets/dsh/deny-risk-commands.patch.yml`（headless 为组合文件，仅校验规则数）；以及 cc settings.json / codex hooks.json+config.toml / agy hooks.json 的接线在位。建议每周运行一次，或接入计划任务。

## 社区与协议

- **License**：[MIT](LICENSE) — Copyright (c) 2026 satan9394
- **行为准则**：[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- **贡献指南**：[CONTRIBUTING.md](CONTRIBUTING.md)
- **安全报告**：[SECURITY.md](SECURITY.md)
- **版本历史**：[CHANGELOG.md](CHANGELOG.md)

> **版本说明**：当前统一产品版本为 **`v0.3.0 Developer Preview`**（`package.json` = `0.3.0`，单一版本源见 `packages/core/src/version.ts`）。
> 历史 Git tag `v1.0.0` 保留不作删除（它代表此前发布标记，非当前产品稳定版声明）；`v0.1.0` / `v0.1.2` / `v0.2.0` / `v0.2.1` / `v0.2.2` 为已发布的 Developer Preview（Pre-release）。当前仍存在未完成真实环境验证的平台与 Agent（macOS / Linux、Copilot CLI / Windsurf / Cursor 真实 D3 待补），因此不宣称 1.0 Stable。详见 `docs/TODO.md` 与 `CHANGELOG.md`。
