# G2 独立验收报告 — doctor 验证深度（新鲜度 + dsh 深度 + 双实现收敛）

- 日期：2026-09-11 · Orchestrator Round 19
- 被审：`packages/installer/src/runtime-probe.ts`、`packages/installer/src/doctor.ts`、`packages/cli/src/commands.ts`、新增测试
- 验收标准：`tasks/orchestrator/IMPLEMENTATION_BRIEF_G2.md`
- 实现者自述（仅供参考）：`IMPLEMENTATION_RESULT_G2.md`

## ⚠️ 方法学披露（必读）

**本报告由编排器（Orchestrator）执行，非独立 Evaluator。** 原因：独立 Evaluator 在本轮**连续 4 次启动失败**
（2 次前台 `subagent run failed`、1 次 ready 代理无收尾消息、1 次极简提示失败），子代理基础设施当前不可用。

- **守住的红线**：实现者（Implementer）**未**给自己的工作进行最终验收——实现与验收分属不同 agent。
- **未满足的理想**：框架要求「必须启动新的独立 Evaluator Agent」。此偏离如实记录，**不伪装为独立验收**。
- **补偿措施**：本报告全部结论来自编排器**自己构造的反例与真实进程调用**，不采信实现者数字；并对关键能力做了**变异测试**（见 §4）。

---

## 结论：ACCEPT（附 3 项残余，均非阻塞）

| # | 检查项 | 结果 | 证据来源 |
|---|---|---|---|
| 1 | dsh 规则数新鲜度（少/等/多 三态） | PASS | 自跑反例，§1 |
| 2 | claude/codex hook 脚本新鲜度（异/同） | PASS | 自跑反例，§2 |
| 3 | 单源缺失降级"未校验" | PASS | 代码路径 + 实现者 evidence（未独立复现，标注） |
| 4 | 退出码契约未回归（6 场景） | PASS | 真实进程调用，§3 |
| 5 | 实弹 self-test 未削弱 | PASS | 真实 home 仍 dynamic + self-test PASS |
| 6 | 真实 home 无新增 FAIL/WARN | PASS | `3 PASS / 0 WARN / 1 FAIL`，exit 1（与改动前一致） |
| 7 | 测试真实性（变异测试） | PASS | §4 |
| 8 | 全量测试 360/360 | PASS | 自跑 §5 |
| 9 | `runDoctors` @deprecated | PASS | §6 裁决 D |

---

## 1. dsh 新鲜度反例矩阵（临时 home，自跑）

基准：仓库单源 `assets/dsh/deny-risk-commands.patch.yml` = **69** 条。

| 场景 | exit | warn | dsh level / message | 判定 |
|---|---|---|---|---|
| 65 条（**少于**） | 0 | 1 | `WARN  patch 规则数少于仓库单源（可能陈旧，详情见 --verbose）` | ✔ 正确报陈旧 |
| 69 条（等于） | 0 | 0 | `PASS  pre-execute patch（deny-risk-commands）` | ✔ 不报 |
| 72 条（多于） | 0 | 0 | `PASS` | ✔ 不误报 |
| 65 + 2 他插件规则（总 67） | 0 | 1 | `WARN` | ✔ 正确报 |
| **65 + 10 他插件规则（总 75 > 69）** | 0 | 1 | `WARN` | ✔ **正确报（见裁决 B）** |
| **60 + 20 他插件规则（总 80）** | 0 | 1 | `WARN` | ✔ **正确报** |

**关键**：即使同 profile 另有含 `re:` 的 insert 且总量**超过**单源，仍正确报陈旧 —— 说明计数按 `deny-risk-commands`
块作用域而非全文，实现者自述的"可能高估掩盖陈旧"风险**未实现**。

## 2. claude/codex hook 脚本新鲜度反例（临时 home，自跑）

| 场景 | exit | warn | claude-code level / message |
|---|---|---|---|
| 脚本与单源**相同** | 0 | 0 | `PASS  PreToolUse hook + runtime self-test` |
| 脚本与单源**不同**（追加一行注释） | 0 | 1 | `WARN  hook 脚本与仓库单源不一致（可能陈旧，详情见 --verbose）` |

且第二条场景下 **`runtime verification: dynamic` 与 self-test PASS 并存** → 陈旧**不降级**、实弹**未削弱**。

## 3. 退出码契约矩阵（真实进程调用，自跑）

| 场景 | 实测 exit | 期望 | 判定 |
|---|---|---|---|
| `doctor`（真实 home，有既有 FAIL） | **1** | 1 | ✔ |
| 未知子命令 `frobnicate` | **2** + `Unknown command: frobnicate  Run '...help' for usage.` | 2 | ✔ |
| hook 无害 | **0** + `{"decision":"allow",...}` | 0 | ✔ |
| hook 危险 | **0** + `{"decision":"deny","ruleId":"RG-GIT-001"}` | 0 | ✔ |
| hook 空 stdin | **0** + fail-closed deny | 0 | ✔ |
| hook 坏 JSON | **0** + fail-closed deny | 0 | ✔ |
| **有 WARN 无 FAIL** | `exitCode: 0, warn: 1` | 0 | ✔ **WARN 未触发失败** |

**无回归**：上轮（G1+G7）建立的契约全部保持。

## 4. 测试真实性（变异测试，自跑）

- 备份 `runtime-probe.ts`（SHA `9410034E…CA228`，26275 B）
- **变异**：把 `checkHookScriptFreshness` 的哈希比对改为恒 `fresh: true`
- **结果**：新测试**变红**（exit 1，`cli-doctor-freshness.e2e.test.ts` 断言失败：期望 `WARN codex hook 脚本与仓库单源不一致` 未出现）
- **还原**：SHA `9410034E…CA228` **逐字节一致**；复跑新测试**变绿**

→ 新增 23 例是**真实断言**，非恒真用例。

## 5. 回归测试（自跑）

- 定向集（installer + e2e + release-hardening + product）：**117/117**
- CI 全量集（17 组 glob）：**360/360**（与实现者声称一致）

## 6. 四项裁决

### 裁决 A — 新鲜度只报 WARN（不降 BROKEN、不改退出码）：**可接受**

理由：
1. **信息已surface**：改动前陈旧**完全无声**（一律 `PASS`/ACTIVE）；现在人类输出出现 `WARN …（可能陈旧）`，`--json` 有 `warn: 1`。G2 的 P0 是"用户无感"，这一点**实质闭合**。
2. **默认不误伤**：`doctor` 无法区分"陈旧"与"用户有意定制"，默认 FAIL 会逼用户覆盖自己的配置——对本产品的目标用户（会自己改 hook 的人）是真实伤害。
3. **可加严**：`--json` 暴露 `warn` 计数，需要的 CI 可在其上自建"WARN 即失败"策略，无需改默认。

**残余（非阻塞）**：`probe.state` 在陈旧时仍为 ACTIVE，`cmdStatus` 不展示新鲜度 → 只跑 `status` 的用户仍可能看不到提示。建议后续把新鲜度并入 status 输出。

### 裁决 B — dsh 计数启发式的高估风险：**风险未实现（实测定性）**

实现在"同 profile 另有含 `re:` 的 insert"且**总量超过单源**的三种构造下均正确报陈旧（§1 后三行）。
说明计数按 `deny-risk-commands` 块作用域解析。实现者自述的退化场景**未被触发**，其自述偏保守。

**残余（低）**：实现者提到锚点/多文档/同行 flow 写法会退化为全文计数——未独立复现该退化路径（当前模板均为标准形态）。
建议保留为已知边界并在 JSDoc 记录（实现者已部分记录）。

### 裁决 C — `artifactPresent` 恒 false 而 `artifactIntegrity` 可能非 null：**确认为惰性**

逐读取点核查（非测试代码）：
- `commands.ts:579` —— `inst.id === 'opencode' ? artifactIntegrity !== false : hookTargetExists` → claude/codex 走 `hookTargetExists`，**不读** integrity ✔
- `commands.ts:634` —— 前置 `verificationMode === 'static'`；claude/codex 是 `dynamic` → **不可达** ✔
- `commands.ts:707-708` —— 位于 `} else if (id === 'opencode')`（L704）分支内 → **仅 opencode** ✔
- `runtime-probe.ts:415/424/434/446` —— 均以 `agent === 'opencode'` 守卫 ✔
- 测试 `transaction.test.ts:158` —— 用真实 opencode probe，非 claude/codex ✔

→ **无消费方因此误判**。字段组合的不自洽是语义债（实现者已记入 JSDoc），非缺陷。

### 裁决 D — `runDoctors` 只标 deprecated 未删：**可接受（符合任务卡）**

`doctor.ts:233-247` 有明确标注：`全员体检（**已废弃 / DEPRECATED**）` + `@deprecated 自 v0.1.2 起，CLI 已统一走 probeAgentRuntime()` + 迁移示例；文件头 L8-9 亦说明。
任务卡要求"标注 @deprecated、不要大改旧实现逻辑" → **满足**。

**残余（中）**：同文件 `checkClaudeHook` / `checkCodexHook` / `checkOpencodePlugin` 仍是子串级，仍在导出面
（`packages/installer/src/index.ts:18` 导出 `runDoctors`）——**这正是本轮审计两份报告被误导的根因**。
建议下一轮处理：删除或迁出 legacy 实现，或从公开导出面移除，彻底消除"两个真相"。

---

## 7. 汇总：残余项（不阻塞 ACCEPT，建议进后续卡片）

| 优先级 | 残余 | 建议 |
|---|---|---|
| P2 | `cmdStatus` 不展示新鲜度 | 把 dsh/hook 新鲜度并入 status 输出 |
| P2 | legacy doctor 仍在导出面（子串级 checkXxx） | 删除或移出导出，消除误导源 |
| P3 | `artifactPresent`/`artifactIntegrity` 组合语义不自洽 | 已记 JSDoc；可考虑加 `artifactKind` 区分 |
| P3 | dsh 计数启发式的锚点/多文档/flow 退化路径未复现 | 保留为已知边界 |

## 8. 最终裁决

**ACCEPT**。9 项检查全部 PASS；退出码契约无回归；真实 home 无误报；新增测试经变异验证为真实有效；
四项裁决中 B/C/D 均核实为**非缺陷或符合任务卡要求**，A 判为**可接受的设计取舍**（信息已 surface，且 `--json` 支持加严）。

**方法学披露**：本报告由编排器执行（独立 Evaluator 4 次启动失败）。实现者未自评（红线守住），但"独立 Evaluator"这一理想未达成——如实记录，不计为已满足。
