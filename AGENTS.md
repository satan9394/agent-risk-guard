# AGENTS.md — agent-risk-guard（本仓库的规则与上下文）

> 这是**本仓库的规则入口**。读 `AGENTS.md` 的运行时（OpenCode / Codex 等）会自动加载；
> Claude Code 走同目录 `CLAUDE.md`（一行 `@AGENTS.md` 导入，**不要在两处各写一份正文**）。
> 用户级通用规则（删除铁律、网络代理、工具路由、Notes 约定等）已在各自的全局配置里，**不在此重复**。

## 这是什么

**给 AI 编码 Agent 用的执行前门禁（pre-execution gate）**：在工具调用真正执行**之前**，用各 Agent 自己的
hook / 插件机制**拒绝**危险命令。核心铁律是「删除必须进回收站，禁止永久删除」。

- **单一事实源**：危险规则只有一处 —— `packages/installer/src/deploy.ts` 的 `defaultDenyRules()`；
  它与 `assets/dsh/deny-risk-commands.patch.yml` 的**逐条一致**由 `tests/adversarial/rule-alignment.test.ts` 守住。
- **各端只是适配层**（不自带规则）：
  - `assets/hooks/dangerous-commands.ps1` —— Claude Code / Codex / agy / WorkBuddy 共用（ps1 规则引擎）
  - `skills/agent-risk-guard/scripts/dangerous-commands.sh` —— Linux / macOS / WSL / Git Bash
  - `assets/opencode/agent-risk-guard.ts` —— OpenCode 插件（**V1+V2 双入口**）
  - `assets/dsh/deny-risk-commands.patch.yml` —— DeepSeek Harness 的 pre-execute 规则段
- **支持面与 D 级**：`packages/installer/compatibility.json` 是唯一事实源（D0–D4）；
  `docs/generated/agent-security-matrix.md` 由 `scripts/generate-agent-security-matrix.ts` 生成，CI 用 `--check` 防漂移。

## 硬约束（改代码前先读）

1. **规则只改一处**：新增危险模式 → 改 `defaultDenyRules()` **并**同步各 hook 副本与 DSH patch **并**补语料
   （`tests/adversarial/`、`packages/core/test/decision-parity.test.ts`）。`rule-alignment` 会因两边不一致直接红。
   **不要在某个 Agent 的适配器里另起一套规则。**
2. **fail-closed**：解析失败、路径解析失败、**动态构造无法静态验证** → 一律**拒绝**，不是放行。
3. **不做「方便的永久删除」**：删除一律走回收站（Windows 用 `Microsoft.VisualBasic.FileIO.FileSystem`
   的 `DeleteFile` / `DeleteDirectory` + `SendToRecycleBin`；本仓另有 `trash` 工具）。
4. **不承诺正则即边界**：规则是 **Pattern Policy 不是 Capability Policy**。
   **绕过向量不要开 issue —— 走 [`SECURITY.md`](SECURITY.md)。**
5. **D3 必须有真实会话**：没有「一条危险命令被拒 + 一条安全命令放行」的原始输出，就只能报 D2，
   且必须在 `compatibility.json` / CHANGELOG / `references/` 三处写明「**D3 未取**」。不许用更早的会话凑数。
6. **文档里不要硬编码能被机器算出来的数字**（规则条数、用例数…）——这类数字已经飘过一次且无人发现；
   改为指向单源，让 `scripts/riskguard-wiring-check.ps1` 打印实际值。
7. **改了引擎文件（hook / 规则 / 语料）必须证明「回退会让某个测试变红」**，否则那条测试拦不住回归。

## 开发环境与常用命令

- **Node >= 22.18**（原生 TS type-stripping，**零构建步骤**）
- 全量：`& .\test-all.ps1`
- hook 套件：`skills/agent-risk-guard/tests/`（ps1 六套；sh 四套跑在 WSL / Git Bash）
- 三个廉价文档闸门：`node scripts/generate-agent-security-matrix.ts --check` ·
  `node scripts/check-compatibility-docs.ts` · `node scripts/check-decisions-log.ts`
- **改了代码就要改 `docs/decisions.md`**：`scripts/check-decisions-row.mjs` 在 PR 上强制（改 `packages/ scripts/ bin/ assets/ skills/ tests/` 任一路径即触发）。
- 提交流程见 [`CONTRIBUTING.md`](CONTRIBUTING.md)：分支 → PR → CI 绿 → 合并。
  **合并 ≠ 发版**：本仓「发版」另有发行说明与 tag，不要顺手打 tag 或发 Release（除非被明确要求）。

## ⚠️ 三个会咬人的机制

1. **单源改动约 5 分钟内自动上生产**：计划任务 `RiskGuard_WiringCheck` 定期执行
   `scripts/riskguard-wiring-check.ps1`，`-Fix` 会**从单源覆盖**各 Agent 的安装副本（先备份到 `~/.risk-guard-backup/`）。
   ⇒ **每一次编辑都算一次发布**；改到一半的规则会立刻生效在本机所有已接线 Agent 上。
2. **巡线的判据是「与单源一致」**：只改安装副本、不改单源，会被 `-Fix` 回灌覆盖；反之改单源不改副本，会被报漂移。
3. **跨端一致性闸门必须两端同时在场**：`packages/core/test/decision-parity.test.ts` 比对 **ps1 引擎**与 **POSIX sh 引擎**。
   它只在本机（Windows+WSL / Windows+Git Bash）或 CI 的 `ps1-hook`(windows-latest) 作业里**真跑**；
   **Linux/macOS 上会显式打印 `CROSS-END GATE NOT RUN` —— 那不是通过，是没跑**。
   改引擎文件后必须复跑并把结果贴进 PR。

## 交叉引用（细节以这些为准，本文件只是入口）

| 要什么 | 去哪里 |
|---|---|
| **新会话先读** | `tasks/orchestrator/SESSION_HANDOVER_20260928.md`（会话交接：现状 / 已做 / 验证数字 / 未闭环） |
| 为什么是这样（裁决） | `docs/decisions.md`（B 表；近期 R18 / WorkBuddy / 跨端闸门几行） |
| 交付了什么 | `CHANGELOG.md`（`[Unreleased]` 段） |
| 新增一个 Agent 的契约 | `docs/adding-an-agent.md`（含 §2.4「同协议 ≠ 同接线」） |
| 各 Agent 接线细节 | `skills/agent-risk-guard/references/*.md` |
| 待办与已知边界 | `docs/TODO.md`、`tasks/orchestrator/*` |
