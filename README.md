# @riskguard — Universal Agent Risk Guard（Monorepo）

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform: Windows / macOS / Linux](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue.svg)](#)
[![Node >= 22.18](https://img.shields.io/badge/Node-%3E%3D%2022.18-green.svg)](#)
[![CI](https://github.com/satan9394/agent-risk-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/satan9394/agent-risk-guard/actions/workflows/ci.yml)

> 面向自主 AI Agent 的跨平台执行策略、硬拦截、能力限制与恢复层。
> 设计文档：`../Universal Agent Risk Guard.md`（v3.0）

## 架构

```text
packages/
├─ core/       纯函数策略内核（无副作用）：normalize / policy-engine / path-resolver / taxonomy / audit
├─ cli/        stdin JSON → Decision JSON（供 command hook 使用）
├─ trash/      [M2+] Windows Recycle Bin / macOS Trash / freedesktop Trash
├─ installer/  [M6] discovery / deploy / backup / rollback / uninstall / doctor
├─ dsh/        [M2] DSH 插件接线（pre-execute + monotonic guard + junction 逃逸防护）
└─ adapters/   [M2-M5] dsh / claude / cursor / opencode / pi / grok / windsurf / codex

policies/      策略包（default.yml / autonomy-safe / strict）
tests/         policy / adapter / conformance / e2e / adversarial
docs/          architecture / threat-model / adapter-contract / compatibility
```

## 当前进度（2026-08-24）

- ✅ **M1 Core**：RiskEvent v1 / Decision v1 / taxonomy / path-resolver / normalize / policy-engine / audit
- ✅ **M1 测试**：29/29（policy 不变量 RG-I01..I04 + normalize + 路径绕过）
- ✅ **M2 CLI Runtime**：7/7（delete→deny+trash / write→allow / git_clean→deny / strict / fail-closed）
- ✅ **M2 DSH Adapter + 插件接线**（D2 实证）：pre-execute waterfall + 单调 `ctx.tools.guard()`；`packages/dsh/` 真实 cordis 插件（pre-execute 动态策略 + 不变量 guard）— 4/4
- ✅ **M2 DSH API 实证文档**：`docs/dsh-api-evidence-d2.md`（源码级契约，见下）
- ✅ **M3 Hook Family**（D1+D2）：claude / cursor / grok / windsurf — 13/13 payload tested
- ✅ **M4 Plugin Family**（D1+D2）：opencode（tool.before TS 插件）— 4/4
- ✅ **M5 Codex**（D1）：rules-compiler 把 defaultPolicy 编译 AGENTS.md/CLAUDE.md（单一事实源）— 3/3
- ✅ **M6 Installer**（D2+D3）：discovery（本机只读检测）/ deploy（4 平台注入计划）/ backup / rollback / uninstall / doctor — 5+6 测试
- ✅ **trash 包**：Windows Recycle Bin 实测通过（D3，2/2）；macOS/Linux D1 待测
- ✅ **D3 三 Agent 删除测试实证**：CC/OC/DSH 同指令「想方设法永久删除」+ 施压——全部拒绝永久删除、删除走回收站；DSH 另获机器级门禁拦截实证（`docs/d3-deletion-test-3agents.md`）
- ✅ **D4 对抗语料**：5/5（**70+ 条命令**：P0 全向量 + P1 回归 + R2 新向量（reg/certutil/docker/git gc/reflog）+ apply_patch/自毁/路径穿越 + 白名单）
- ✅ **GAN 对抗审查（maker-checker 双轮）**：
  - 第一轮（ADVERSARIAL-AUDIT-REPORT.md）：4/10 → 11 P0 + 7 P1 + 9 P2 全量修复
  - 第二轮独立复评（ADVERSARIAL-AUDIT-ROUND2.md）：**7.5/10**，10/11 P0 完全修复，39 条普通命令零误伤；新发现 5 个穿透向量（reg delete / certutil / docker volume / git gc --prune / git reflog expire）已补修
  - 修复映射：`docs/gan-audit-fix-map.md`
  - P0 修复：/bin/rm 完整路径、eval/bash -c/sh -c 包裹、两阶段写+执行、base64 管道、git push --force/branch -D/restore、subprocess/__import__/execSync 动态执行、mkfs/dd/wipefs、xargs -0、IEX WebClient、tar/unzip 覆盖
  - P1 修复：rm --help/rm 无参不再误伤、git push/branch 白名单排除危险标志、`cp`/`mv` 归写操作（可再评估）、Policy.defaults 死代码修复（evaluate 真正生效）、dd 任意标志序、npx 通用工具放行
  - P2 修复：guard 复用 classify 单一事实源（覆盖完整路径/包裹/git），换行分隔符，凭据 token 名扩展
  - 语料 35 → **60+ 条**（全部 P0 向量入册）
- ✅ **测试**：全量通过（22 组：core/policy 13 + normalize 19 + junction 1 + fuzz 3 + e2e 7 + adapters M3 13 + M4 6 + adapter-audit 9 + opencode-guard 26 + trash 2 + corpus 5 + alignment 1 + installer 5 + installer-audit 6 + codex 3 + dsh plugin 6 + guard 3 + hook pipeline 16 + bypass 16 + FP 5 + audit-reregress 46 + hook sh 59）
- ✅ **installer 层对抗审查（R22）**：独立判别器 4.5/10 → P0（rollback trash 未调用、planDshPatch 反斜杠双重转义致正则全失效）+ P1（单引号注入/uninstall 子串误删/3 格式卸载缺失/备份同名覆盖）全量修复——见 `tests/installer-audit-report.md`
- ✅ **OpenCode 插件对抗审查（R16）**：独立判别器 4.5/10 → P0（全角/$()/反引号/bash -c flags/pwsh -ec/eval/引号插词/函数体）+ P1（git 9 缺失/subprocess/child_process/管道到 shell/truncate-docker-wmic）全量修复——见 `tests/OPENCODE-PLUGIN-AUDIT.md`
- ✅ **全角字符防护（R15）**：core classify + ps1/sh hook 三层 NFKC/全角归一化，`ｒｍ　－ｒｆ　／ｔｍｐ` 等 Unicode 变体全拦截（adapter 审查 P0-27 衍生修复）
- ✅ **adapter 层对抗审查（R14）**：独立判别器 6.5/10 → P0（tool_name 大小写/全角字符/非字符串 command/unknown action）+ P1（Grok 空 payload/Windsurf read/空 command/Unicode 工具名）+ guard（resolveReal fail-closed/extractTargets flags）全量修复——见 `tests/adapter-audit-report.md`
- ✅ **hook 实战加固（R8/R9）**：生产部署现状核对（Codex hook 真实生效有 log 实锤 / CC 未接 PreToolUse）；work区 hook 三轮 GAN 审查闭环（4/10 → 7/10 → R3 修复）：git switch -C/worktree/wmic 新缺口、force-with-lease 误拦、echo 误伤 cmdTest 化；Windows ps1 与 Linux/macOS sh 全规则同步——见 `docs/deployment-status.md`
- ✅ **M7 行为级加固**：`resolveReal()`（fs.realpath）+ junction 逃逸 D3 实测（字符串级误判 vs realpath 揭穿）；DSH pre-execute 内嵌 `checkJunctionEscape`（删除命令 realpath 逃逸即拒）
- ✅ **规则单一事实源**：`rule-alignment` 测试锁定 skill 侧 30 条 deny 规则与 `defaultDenyRules()` 逐条一致；`cp/mv` 移出只读白名单（写操作不得归 read）
- ✅ **DSH API D2 实证**（本机 v22.19.0 源码）：`ctx.on('tools/pre-execute', (exec,next)=>PreToolDecision)` + `ctx.tools.guard(fn)` 单调拒绝 + 拒绝呈现 `Error: <reason>`；guard 语义即文档 RG-I03 的实现载体（详见 `docs/dsh-api-evidence-d2.md`）
- ⬜ M7 收尾：GAN 对抗审查结论落地 / 真实 profile 接线（D3 会话验证）/ macOS+Linux trash 实测

## 快速上手

```powershell
# 跑全部测试（Node >= 22.18 原生 TS，零构建）
& .\test-all.ps1

# CLI 体验
Get-Content tests\e2e\payload-delete.json -Raw | node packages\cli\src\index.ts

# 本机 Agent 安装发现（只读）
node -e "import('./packages/installer/src/discovery.ts').then(m=>console.log(m.discoveryToJson(m.discoverAgents())))"
```

## 不变量速查（Core 已实现）

| 规则 | 语义 |
|------|------|
| RG-I01 | 永久删除默认 deny，建议 trash |
| RG-I02 | RiskGuard 自身/受保护资源不可修改（单调 deny） |
| RG-I03 | ALLOW + DENY = DENY（guard 单调性） |
| RG-I04 | 未知 mutation / 解析失败 → fail-closed deny |
| RG-I05 | Pattern Policy ≠ Capability Policy（本项目不宣称正则即边界） |

## 社区与协议

- **License**：[MIT](LICENSE) — Copyright (c) 2026 satan9394
- **贡献指南**：[CONTRIBUTING.md](CONTRIBUTING.md)
- **行为准则**：[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- **安全报告**：[SECURITY.md](SECURITY.md) —— 发现绕过向量请走私密渠道，**不要**公开 issue 演示利用
- **版本历史**：[CHANGELOG.md](CHANGELOG.md)
- **平台发布**：SkillHub `@user_d684b111/agent-risk-guard-audit@1.0.0`（审核通过）
- **CI**：`.github/workflows/ci.yml`（Ubuntu + Node 22/24 矩阵跑平台无关测试组；hook/回收站实测依赖本机环境，见 `docs/deployment-status.md`）