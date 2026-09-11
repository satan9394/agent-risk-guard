# IMPLEMENTATION_BRIEF — G2 残余：doctor 验证深度（新鲜度 + dsh 深度 + 双实现收敛）

- 生成：2026-09-11 · Orchestrator Round 19（切片 #3）
- 来源：PRODUCT_GAP_MAP G2（P0 残余）；上轮已实证：CLI 实际走 `runtime-probe.ts`（已实现实弹自检），审计读的 `doctor.ts` 是旧实现
- 编排器实证（本轮亲测）：
  - `checkDshPatch`（doctor.ts:47-69）只做 `raw.includes('deny-risk-commands')` 子串匹配 → **无规则数、无新鲜度、无实弹**
  - 本机 web profile `cordis.patch.yml` 规则数 **69**，仓库单源 `assets/dsh/deny-risk-commands.patch.yml` 规则数 **69**（计数可比对，是可行的新鲜度信号）
  - `runDoctors`（旧 doctor）仅被 `packages/installer/test/installer.test.ts` 引用；CLI/status/install-verify 全走 `probeAgentRuntime`

## 目标
把「doctor 报告的是真相」补齐到三个仍缺口：(1) dsh 门禁的验证深度（新鲜度）；(2) claude/codex 已装 hook 脚本的新鲜度（hash vs 仓库单源）；(3) 双 doctor 实现并存导致的认知混乱收敛。

## 用户场景
1. **陈旧防护报 OK**：用户在 DSH 上装的是 65 条规则的旧 patch，仓库已有 69 条（含新修复），`doctor` 仍报 `PASS dsh`。同理：CC/Codex 的 `dangerous-commands.ps1` 是旧版（缺最新规则），`doctor` 只验证"能 deny 一个 payload"，不验证"是不是最新规则"。
2. **审计/维护者被误导**：项目里存在两套 doctor（`runDoctors` 旧 vs `probeAgentRuntime` 新），本轮审计中**两份独立审计报告都读了旧的**并据此得出"doctor 只查字符串在位"的结论——实际 CLI 已做实弹自检。这种"两个真相"会持续误导。

## 当前问题（证据）
- `packages/installer/src/doctor.ts:47-69` `checkDshPatch`：`raw.includes('deny-risk-commands')` 即判 ok；被 `runtime-probe.ts:254-256` 用于 dsh 分支，且 `selfTestPassed = wired`（**无实弹、无新鲜度**）。
- `runtime-probe.ts:146-210`（claude/codex 分支）：有 wiring / hookTargetExists / **实弹 self-test**，但**没有**「已装脚本 vs 仓库单源」的 hash 比对（opencode 分支 L230-241 有 artifactIntegrity，claude/codex 没有）。
- 双实现：`packages/installer/src/index.ts:18` 仍导出 `runDoctors`；`doctor.ts` 同时承载旧 `runDoctors`/`checkXxx` 与被 runtime-probe 复用的 `checkDshPatch`。

## 理想行为
1. **dsh 深度**：probe 的 dsh 分支除"patch 存在"外，还产出：
   - 每个 profile 的 **规则条数**（解析 `re: '...'` 计数）
   - 与**仓库单源** `assets/dsh/deny-risk-commands.patch.yml` 的条数比对
   - 条数不足 → 状态降级（`INSTALLED` 而非 `ACTIVE`）或 `artifactIntegrity=false` 等价信号，并在 `evidence` 里写明 `rules 65 < repo 69`
2. **claude/codex 新鲜度**：hook 脚本存在时，计算其 SHA256 并与**仓库单源**对应文件比对（映射至少覆盖：`dangerous-commands.ps1` → `assets/hooks/dangerous-commands.ps1`；node 型 `pre-tool-hook.ts` → 仓库对应源）。不一致 → `artifactIntegrity=false` + evidence 写明 `script differs from repo single source (possibly stale)`；**不得**因此把 ACTIVE 降为 BROKEN（用户可能有意改过）——建议按 WARN 语义（`INSTALLED` 或保留 ACTIVE 但在输出标注 WARN，由你判断并说明理由）。
3. **双实现收敛**：`runDoctors` 标注 `@deprecated`（说明 CLI 已统一走 `probeAgentRuntime`），并在 JSDoc 里点明其局限（子串级、无实弹）；若成本极低可把引用它的旧测试改为断言 deprecated 行为或改用 probe。**不要**大改旧实现逻辑。
4. `doctor` 输出：上述新鲜度信号须在 `--verbose` 的 evidence 中可见；人类输出（非 verbose）保持现有格式，最多在 WARN 时多一行。

## 涉及模块
- `packages/installer/src/runtime-probe.ts`（dsh 分支、claude/codex 分支加新鲜度）
- `packages/installer/src/doctor.ts`（`checkDshPatch` 增强或替换；`runDoctors` 标 deprecated）
- `packages/installer/src/hash.ts`（`sha256File` 已存在，复用）
- `packages/cli/src/commands.ts`（`cmdDoctor` 可能需要展示 WARN/新鲜度行——注意不要回退上轮的退出码契约）
- 测试：`packages/installer/test/*.test.ts`、`tests/e2e/cli-exit-codes.e2e.test.ts`

## 不能破坏什么
1. **上轮刚落地的退出码契约**（提交 `552fca3`）：hook 运行时恒 exit 0；doctor 有 FAIL → 1；未知子命令 → 2。**新增 WARN 不得触发 exit 1**（WARN ≠ FAIL）。
2. `probeAgentRuntime` 的**现有实弹 self-test 行为**（无害→allow、危险→deny，子进程 stdin）——只可增强，不可削弱或跳过。
3. `RuntimeProbeResult` 的既有字段语义（`artifactIntegrity`、`state`、`verificationMode`、`evidence`）；新增字段须可选，避免破坏 status / install-verification 的消费方。
4. 现有测试全绿（上轮基线 **337/337**）。
5. DSH 的判定不得因"无法实弹"而误判为用户环境坏了——缺单源文件时应降级为"未校验"而非 FAIL。

## 验收标准
1. **dsh 新鲜度可证**：构造/使用"条数少于单源"的 patch → probe 能报出 `rules N < repo M`（用真实 home 或临时 home 目录验证）；条数相等 → 不报。
2. **claude/codex 新鲜度可证**：用临时 home + 一个与仓库单源**不同**的 hook 脚本 → probe 报 `script differs...`；与单源**相同** → 不报。
3. **不误判**：正常本机环境下 `doctor` 不产生新的 FAIL（不得把"新鲜度不一致"报成 FAIL 导致退出码 1）——给出你的语义选择与理由。
4. 上轮契约保持：`doctor` 退出码仍为「有 FAIL→1，无 FAIL→0」；`echo '<JSON>' | node bin/riskguard.mjs` 仍 exit 0。
5. `runDoctors` 有明确的 `@deprecated` 标注与局限说明。
6. 全量测试全绿（给前后数字）。

## 错误场景
- 单源文件缺失（如裁剪安装）→ 新鲜度"未校验"，不得 FAIL。
- profile 目录不存在 / patch 解析失败 → 维持现有缺失语义。
- hook 脚本存在但哈希计算失败 → 记为未校验，不得崩溃。

## 测试要求
- 新增针对 probe 的测试：dsh 条数比对（少/等）、claude/codex 哈希比对（同/异）、单源缺失降级。
- 测试须用**临时 home**（不要读写真实 `~/.claude` 等生产配置）。
- 回归：跑 installer / e2e / release-hardening / product 测试并记录前后数字。

## 交付物
`IMPLEMENTATION_RESULT_G2.md`：改动摘要 + 三项能力的实证（含你构造的反例输出）+ 语义选择理由（新鲜度不一致算 WARN 还是降级）+ 测试数字 + 未解决问题。
