---
name: agent-risk-guard
slug: agent-risk-guard
version: 1.0.0
displayName: Agent Risk Guard
description: 审计并加固 AI 编码 Agent 的危险命令拦截。检查 Claude Code、OpenCode、Codex、Cline、Qwen Code、Cursor、Windsurf、Copilot CLI、Goose、Grok CLI、Hermes、Pi、Aider、DeepSeek Harness、Antigravity CLI (agy) 等工具的全局配置文件与 hooks/permissions/sandbox/插件机制，判断"删除必须进回收站"等铁律是否被机器级拦截（而非仅靠模型自觉），缺失则给出并落地对应配置，最后用模拟 payload 或真实会话实测验证。当用户提到高危命令拦截、危险操作防护、删除进回收站、hook 拦截、permission 审计、agent 安全加固、防误删、适配、一键配置、或想给多个 AI 工具统一加安全门禁时，务必使用本 skill，即使他们只提到其中一个工具。
tags: [安全, 审计, agent, hook, 拦截, 加固]
---

# Agent 风险命令拦截审计（Agent Risk Guard Audit）

## 角色定位

你是一位 AI Agent 安全审计专家。你为开发者和团队检查其使用的各种 AI 编码 Agent（Claude Code、OpenCode、Codex、Cline、Cursor、DeepSeek Harness、Antigravity CLI (agy) 等），确认"删除只能走回收站、禁止永久删除"等安全铁律是否被**机器级强制**——而不是只靠提示词让模型自觉。你熟悉每家 Agent 的配置目录、hooks/插件/权限/沙箱机制，能发现"裸奔"配置、给出对应修复、并指导实测验证。

审计 → 加固 → 验证，三步闭环，输出带证据的审计报告。

## 为什么重要

模型会被 prompt injection、恶意仓库内容或自身失误诱导执行破坏性命令。仅靠"提示词告诉模型别删"不可靠；必须用各 Agent 自己的**执行前门禁机制**（hooks / 插件 / pre-execute / sandbox / permissions）硬拦截。本 skill 沉淀了 2026-08 实测过的完整流程（Claude Code + OpenCode + Codex + DeepSeek Harness 全部落地验证）。

## 核心原则

1. **保持最高权限、不弹确认**：不改 defaultMode/permission 为 ask（那会频繁打扰用户）。用门禁自动拒绝黑名单命令。
2. **每个 Agent 机制不同**：Claude Code 用 PreToolUse hook，OpenCode 用插件 `tool.execute.before`，DSH 用 pre-execute 插件，Codex 用 hooks+sandbox，agy (Antigravity) 用 PreToolUse run_command，Cline/Qwen 用 auto-approve 规则+hooks，pi/Aider 无内建需外部隔离。**禁止把一套 hook 方案硬套到所有 Agent**。
3. **宁可错杀**：删除类命令一律拦，命中即拒绝并提示改用回收站命令（Windows 走 `Microsoft.VisualBasic.FileIO.FileSystem::DeleteFile/DeleteDirectory` 带 `SendToRecycleBin`）。
4. **配置后必须实测**：模拟 payload 或真实会话各跑一条黑名单命令 + 一条白名单命令。

## 快速适配（安装后一键配置）

当用户首次使用本 Skill 或说"给我所有 Agent 加上安全拦截"/"适配一下"时，执行以下流程：

### Step 1：扫描本机 Agent

用 pwsh 扫描所有已知 Agent 配置目录，输出安装状态：

```powershell
$agents = @{
    "claude" = @{ Name="Claude Code"; Dir="$env:USERPROFILE\.claude" }
    "codex" = @{ Name="Codex CLI"; Dir="$env:USERPROFILE\.codex" }
    "opencode" = @{ Name="OpenCode"; Dir="$env:USERPROFILE\.config\opencode" }
    "dsh" = @{ Name="DeepSeek Harness"; Dir="$env:USERPROFILE\.dsh" }
    "cursor" = @{ Name="Cursor"; Dir="$env:USERPROFILE\.cursor" }
    "goose" = @{ Name="Goose"; Dir="$env:USERPROFILE\.config\goose" }
    "grok" = @{ Name="Grok CLI"; Dir="$env:USERPROFILE\.grok" }
    "hermes" = @{ Name="Hermes Agent"; Dir="$env:USERPROFILE\.hermes" }
    "copilot" = @{ Name="Copilot CLI"; Dir="$env:USERPROFILE\.copilot" }
    "cline" = @{ Name="Cline"; Dir="VS Code 设置" }
    "qwen" = @{ Name="Qwen Code"; Dir="$env:USERPROFILE\.config\qwen-code" }
    "windsurf" = @{ Name="Windsurf"; Dir="$env:USERPROFILE\.windsurf" }
    "pi" = @{ Name="Pi"; Dir="$env:USERPROFILE\.pi" }
    "aider" = @{ Name="Aider"; Dir="$env:USERPROFILE\.aider.conf.yml" }
}
# 检测逻辑：Test-Path 检查目录是否存在
```

### Step 2：展示可选项给用户

**用 `ask_user_question` 工具**（不是 `Read-Host`）列出已检测到的 Agent（多选），让用户选择要加固哪些：

- 每个已安装的 Agent 作为一个选项（label 用 Agent 名 + 优先级，description 说明机制）
- 推荐项标注（推荐）：有 hooks 机制的 P0/P1 Agent 优先
- 未安装的 Agent 不列出

### Step 3：按选择逐个配置

根据用户选择，按优先级执行：

| 优先级 | Agent 类型 | 下发资产 | 操作 |
|--------|-----------|---------|------|
| P0 | Claude Code / Codex | `scripts/dangerous-commands.ps1` | 复制到 hooks/ + 合并 settings.json |
| P0 | OpenCode | `scripts/opencode/destructive-operation-guard.ts` | 复制到 plugins/ + **opencode.json 显式注册**（R17 实测：仅放 plugins/ 不生效，见 `references/opencode-wiring.md`） |
| P0 | DSH | `assets/dsh/deny-risk-commands.patch.yml` | 合并到 cordis.patch.yml |
| P1 | Cursor / Goose / Grok / Hermes / Copilot | `scripts/dangerous-commands-universal.ps1` | 复制到 hooks/ + 注册 hooks.json |
| P2 | Cline / Qwen | 无脚本，出配置指南 | 告知用户手动配置步骤 |
| P3 | Windsurf / Aider / Pi | 无脚本，出隔离建议 | 告知用户外部包装方案 |

### Step 4：验证

对每个已配置的 Agent，用探测命令验证门禁生效：

```powershell
# 探测命令（文本含黑名单词，会被门禁拦）
Write-Output 'probe Remove-Item text'  # 应被拦
Write-Output 'probe git status'        # 应放行
```

### Step 5：输出适配报告

汇总每个 Agent 的配置状态（✅ 已配置 / ⚠️ 需手动 / ❌ 不支持），给出下一步建议。

## 审计流程（5 步）

### 第 1 步：盘点已安装 Agent

扫描常见配置目录，确定用户实际装了哪些：

```powershell
$paths = @("$env:USERPROFILE\.claude", "$env:USERPROFILE\.codex", "$env:USERPROFILE\.config\opencode",
           "$env:USERPROFILE\.aider*",
           "$env:USERPROFILE\.copilot", "$env:USERPROFILE\.hermes", "$env:USERPROFILE\.config\goose",
           "$env:USERPROFILE\.pi", "$env:USERPROFILE\.windsurf", "$env:USERPROFILE\.codeium",
           "$env:USERPROFILE\.dsh", "$env:APPDATA\Code\User", "$env:APPDATA\Claude")
foreach ($p in $paths) { if (Test-Path $p) { Write-Output ("已安装: " + $p) } }
```

macOS/Linux 同理（`~/.claude`、`~/.codex`、`~/.config/opencode`…）。

### 第 2 步：按 Agent 查拦截机制

对照 `references/agent-matrix.md` 的机制矩阵，逐个查每家的配置文件和当前配置。**重点看三件事**：
- 全局/项目配置文件是否存在、在哪里
- 是否已有 hooks/插件/permissions 级拦截（而不是只靠 rules 文档）
- 拦截规则覆盖是否完整（对照第 4 步统一黑名单）

### 第 3 步：检查默认状态是否裸奔

高频危险默认态（发现即需修复）：
- Claude Code：`permissions.defaultMode: "bypassPermissions"` 常驻 + 无 PreToolUse hook → 裸奔
- OpenCode：`permission: "allow"` 且无插件 → 裸奔
- Codex：`approval_policy` 默认 untrusted（会弹确认）或 `never` 但无 hooks（Windows 上 hooks 触发有已知 bug）→ 不拦或不可靠
- pi / Aider：无内建权限 → 需要容器/包装
- DSH：无 pre-execute 插件 → 只有沙箱管文件、审批可被模型绕（#250）

### 第 4 步：按统一黑名单加固

先读 `references/` 里对应 Agent 的文件，按其中配置示例落地。黑名单以"删除必须进回收站"铁律为核心，覆盖 PowerShell / cmd / Git Bash / Python / Node / git / 磁盘全系：

```text
PowerShell: Remove-Item, del, erase, ri, rd, rmdir, rm(命令位), Clear-Content,
            [System.IO.File/Directory]::Delete, 实例方法 .Delete()
cmd/GitBash: del, erase, rm, rmdir, rd, unlink, shred, find -delete, find -exec rm
Python:      shutil.rmtree, os.remove/unlink/rmdir/removedirs, pathlib.Path.unlink/rmdir
Node:        fs.rm/rmSync, fs.unlink/unlinkSync, fs.rmdir/rmdirSync, fs-extra remove, rimraf
git:         git clean, git reset --hard
磁盘:         diskpart, Clear-Disk, Format-Volume/Partition/Drive, mkfs, dd(写设备)
其他高危:     远程内容管道执行(curl|bash), Invoke-Expression 下载执行,
             shutdown/reboot, reg delete, bcdedit /delete, chmod -R 777 /
```

允许的唯一删除路径：回收站命令（Windows 用 Microsoft.VisualBasic 的 DeleteFile/DeleteDirectory + SendToRecycleBin；macOS 用 `trash`/`gio trash`；或提供专用 trash 工具）。**注意**：写黑名单正则时，用 `\brm\s+` 类规则要限定命令位置 `(^|[;&|])\s*rm\s+`，避免误伤字符串与变量名；`find -delete` 要用 `\bfind\b[^|;&\n]*\s-delete\b`（`\bfind\s+.*\s-delete` 在 find 与 -delete 紧邻时会漏）。

### 第 5 步：实测验证（必须）

**方法 A（模拟 payload，离线可测）**：给 hooks/插件喂官方格式的 PreToolUse payload，检查输出。

Claude Code / Codex 格式：
```json
{"tool_name":"Bash","tool_input":{"command":"<待测命令>"}}
```
期望输出：hook 返回 `permissionDecision: "deny"`（Claude）或对应 deny 结构；放行命令无输出。

OpenCode 插件：直接单测 `analyzeCommand()` 导出函数（若插件导出），或真实会话测。

**方法 B（真实会话）**：让用户在每个 Agent 里跑一条黑名单命令（如 `Remove-Item` 测试文件）确认被拦，再跑一条白名单命令（如 `git status`）确认不误伤。

**验证矩阵**：每个 Agent 至少测 3 条黑名单（PowerShell 删除 / Python 删除 / git 破坏性）+ 2 条白名单。

## 跨 Agent 机制速查（详见 references/agent-matrix.md）

| Agent | 拦截机制 | 全局配置位置 |
| --- | --- | --- |
| Claude Code | PreToolUse hook | `~/.claude/settings.json` + `~/.claude/hooks/` |
| OpenCode | 插件 tool.execute.before | `~/.config/opencode/plugins/` + `opencode.json` |
| Codex | hooks + sandbox | `~/.codex/hooks.json` + `~/.codex/config.toml` |
| DeepSeek Harness | pre-execute 插件 | `~/.dsh/profiles/*/cordis.patch.yml` |
| Antigravity CLI (agy) | PreToolUse hook + run_command | `~/.gemini/config/hooks.json`/`hooks/` |
| Cline | auto-approve 规则 + hooks | VS Code 设置 + `.clinerules` |
| Qwen Code | hooks + permissions | `~/.config/qwen-code/` 或项目 `.qwen/` |
| Cursor | rules + hooks | `.cursor/rules/` + 项目设置 |
| Windsurf | rules + ignore | `.windsurfrules` + `.codeiumignore` |
| Copilot CLI / Goose / Grok | hooks | `~/.copilot/` / `~/.config/goose/` / `~/.grok/` |
| pi | 无内建 → 容器化 | 容器/OpenShell 包装 |
| Aider | 无内建 → 最小攻击面 | `~/.aider.conf.yml` + `.aiderignore` |

## 产出物

每次审计输出一份报告（Markdown）：
- 已安装 Agent 清单与各自拦截状态（✅/⚠️/❌）
- 每个 Agent 的机制、配置路径、发现的缺口
- 已落地配置的 diff/示例
- 实测结果表（黑名单全拦 / 白名单放行）
- 遗留风险（如 Codex Windows hooks bug、DSH #250）

## 输出格式验证状态（诚实标注）

hook 脚本的输出 JSON 格式是否被各 Agent 正确识别，取决于各家 hooks 实现。以下为截至 2026-08-21 的验证状态：

| Agent | 输出格式 | 验证状态 | 说明 |
| --- | --- | --- | --- |
| Claude Code | `hookSpecificOutput.permissionDecision` | ✅ 已实测 | hook 规则集 66 条命令模式规则（脚本 401 行，共 72 处 deny 分支含 6 条 fail-closed 防守卫），89 条 ps1 验证用例全通过；⚠️ 本机 settings.json 未注册 PreToolUse（需接线） |
| Codex | `hookSpecificOutput.permissionDecision` | ✅ 已实测 | 同上；`hook-calls.log` 有真实 deny 记录（2026-08-23 rm -rf） |
| Antigravity CLI (agy) | PreToolUse run_command → agy 适配器 `{decision:allow\|deny}` | ✅ 已实测（Windows，agy 1.1.27） | `scripts/agy-dangerous-commands.ps1`（BOM+fail-closed）翻译 hook 协议并复用 codex 规则源；2026-09-06 真实会话：`git reset --hard` 被拦、未提交修改保留，agy 缺席时 fail-closed deny |
| OpenCode | 插件自有格式（`tool.execute.before`） | ✅ 已实测（完整） | 520 行插件（R16 四轮修复后），真实会话验证：模型拒绝 rm/Remove-Item、调用 trash 工具进 Windows 回收站确认收到；⚠️ 需 `opencode.json` plugin 声明才加载（见 `references/opencode-wiring.md`） |
| DeepSeek Harness | pre-execute 门禁规则 | ✅ 已实测 | patch 47 条热加载生效（R3 生态融合：解释器 one-liner / git 破坏清单 / Windows wrapper）；`@riskguard/dsh` 插件（pre-execute+单调 guard）经 dsh-tools 源码实证 |
| Cursor | `hookSpecificOutput.permissionDecision` | ⚠️ 待验证 | hooks 文档显示兼容 CC 格式，需真实会话确认 |
| Goose | `hookSpecificOutput.permissionDecision` | ⚠️ 待验证 | 需真实会话确认 |
| Grok | `hookSpecificOutput.permissionDecision` | ⚠️ 待验证 | 需真实会话确认 |
| Hermes | `hookSpecificOutput.permissionDecision` | ⚠️ 待验证 | 需真实会话确认 |
| Copilot CLI | `hookSpecificOutput.permissionDecision` | ⚠️ 待验证 | 需真实会话确认 |
| Cline v3.36+ | `hookSpecificOutput.permissionDecision` | ⚠️ 待验证 | hooks 格式兼容 CC，需真实会话确认 |
| Qwen Code | `hookSpecificOutput.permissionDecision` | ⚠️ 待验证 | hooks 格式兼容 CC，需真实会话确认 |
| Windsurf | rules-only，无 hooks | ❌ 不支持 | 只能加 rules 文档（模型级），无机器级拦截 |
| Pi | 无内建 | ❌ 不支持 | 需容器化隔离 |
| Aider | 无内建 | ❌ 不支持 | 只能 .aiderignore 覆盖路径 |

**验证方法**：对 ⚠️ 待验证的 Agent，在真实会话中执行 `Remove-Item test.txt` 确认被拦，执行 `git status` 确认不误伤。

## 陷阱提醒

- **cc-switch 类配置管理器会回写 settings.json**：改完 Claude Code 后，让用户切一次 provider 复查 hooks 是否存活，或把 hooks 并入配置管理器的模板。
- **Codex hooks 在原生 Windows 有 bug**（issue #24453：shell 命令走 command_execution 不触发 PreToolUse）：配置后必须真实会话实测，不触发则依赖 `sandbox_mode="workspace-write"` 兜底并跟踪上游修复。
- **脚本编码**：Windows 上 PowerShell 5.1 读 UTF-8 无 BOM 的 ps1 会按 GBK 解析导致中文乱码、语法崩坏——hook 脚本必须 UTF-8 with BOM。
- **DSH 配置热加载**：`cordis.patch.yml` 改完即生效（实测），无需重启；改完可用无害探测命令（如 `Write-Output` 带黑名单词）验证规则是否被门禁拦截。
- **门禁拦的是命令文本**：写测试命令时避免把黑名单词写进命令字面量（会被自己的门禁拦），用 payload 文件或独立脚本间接测试。

## 下发资产（可直接落地的配置/插件）

加固时直接复制本目录下的资产到目标 Agent 配置位置，按各 Agent 的落地方式接入：

### 脚本类（自动配置）

- `scripts/dangerous-commands.ps1` — Claude Code / Codex 共用 PreToolUse hook 脚本（Windows 版，规则含 rm 全家桶/PowerShell 删除类/git 破坏整类（含 push -f/switch -C/worktree）/管道到 shell/子展开/docker/truncate/wmic 等 **66 条命令模式规则**（脚本 401 行，共 72 处 deny 分支含 6 条 fail-closed 防守卫），GAN 修复覆盖大小写/fail-closed/落盘链/插词/包装变体，四轮 GAN 审查加固至 8/10，ps1 89 条验证用例 + sh 侧 122 条全绿）
- `scripts/agy-dangerous-commands.ps1` — Antigravity CLI (agy) PreToolUse hook 适配器（BOM + fail-closed，2729B→含 BOM 2732B），把 agy 的 run_command 协议翻译成 codex 规则源能识别的格式；2026-09-06 真实会话验证
- `scripts/dangerous-commands-universal.ps1` — 跨 7 家 Agent 通用 hook（规则集与 dangerous-commands.ps1 完全同步，单一事实源，BOM 编码）
- `scripts/opencode/destructive-operation-guard.ts` — OpenCode 完整插件（520 行，R16 修复版：检测器 + wrapper 解包 + 受保护路径 + trash 工具 + 日志，需 opencode.json 注册）
- `scripts/dangerous-commands.sh` — bash/WSL 版（Linux/macOS，规则集与 ps1 同步，python3 解析，50/50 WSL 实测）

### 配置模板类（合并到现有配置）

- `assets/claude-code/settings.hooks.json` — Claude Code hooks 接线示例（合并进 settings.json 的 hooks 段）
- `assets/dsh/deny-risk-commands.patch.yml` — DSH pre-execute 门禁规则段（47 条，含 R2 向量 + R3 生态融合：解释器 one-liner / git 破坏清单 / Windows wrapper，直接合并进 cordis.patch.yml 即生效）
- `assets/cline/vscode-settings.json` — Cline VS Code 安全配置段（关闭 YOLO + 收紧 auto-approve + hooks 注册）

## References

按需读取：
- `references/agent-matrix.md` — 全部 20 家 Agent 的机制矩阵（含 Antigravity CLI / agy，rulesync 兼容表 + 补充）
- `references/claude-code.md` — PreToolUse hook 配置 + 完整脚本
- `references/opencode.md` — 插件 tool.execute.before + 参考实现
- `references/codex.md` — hooks.json + sandbox 兜底 + Windows bug
- `references/dsh.md` — pre-execute 门禁插件 + 规则清单
- `references/cline-kilo-qwen.md` — Cline v3.36 hooks + Qwen hooks（文件名保留历史命名）
- `references/augmentcode.md` — AugmentCode hooks 系统
- `references/amp-roo.md` — Amp sandbox + Roo auto-approve
- `references/cursor-windsurf.md` — Cursor hooks + Windsurf rules 局限
- `references/windsurf-zed-warp.md` — Windsurf/Zed/Warp 权限对比
- `references/pi-aider.md` — 无内建权限的隔离方案
- `references/copilot-goose-grok.md` — 其余 hooks 类 Agent
