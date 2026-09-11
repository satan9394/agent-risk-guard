# IMPLEMENTATION RESULT — G2 残余：doctor 验证深度（新鲜度 + dsh 深度 + 双实现收敛）

- 实施：独立 Implementer（本卡）· 2026-09-11
- 仓库：`E:\DeepSeek_Harness\workspace\2026_08_21\agent-risk-guard`（branch `main`，基线提交 `552fca3`）
- 状态：**待独立 Evaluator 验收**（本文所有结论均附可复现命令与原始输出）

---

## 0. 一句话结论

`checkDshPatch` 的「子串命中即 ok」和 claude/codex「只验能不能拦一个 payload」这两个盲区已补齐：
现在 probe 会产出 **规则条数 vs 仓库单源**、**已装 hook 脚本 SHA256 vs 仓库单源** 两类新鲜度信号，
经 doctor 以 **WARN** 外传（**不降级、不触发 exit 1**），旧 `runDoctors` 已明确 `@deprecated`。
本机真实环境 doctor 结果与改动前完全一致（`3 PASS / 0 WARN / 1 FAIL`，exit 1，唯一 FAIL 为既有的 claude-code 接线漂移）。
全量测试 **337 → 360**（新增 23 个），**360/360 全绿**。

---

## 1. 改动摘要

| 文件 | 改动 |
|---|---|
| `packages/installer/src/doctor.ts` | 新增 `countPatchRules()`（规则条数解析，3 种 YAML 写法 + 块内限定）、`DshPatchProfile` / `DshPatchDeep` 类型、`checkDshPatchDeep()`（patch 在位 + 每 profile 条数 + 仓库单源比对 + `freshness` / `notes`）；`checkDshPatch()` 改为**委托** deep 版并保持原签名与 `ok/missing` 语义；`runDoctors` 加 `@deprecated` + 4 条局限说明；文件头点明「历史子串级实现 vs CLI 实际入口」 |
| `packages/installer/src/runtime-probe.ts` | 新增 `checkHookScriptFreshness()` / `aggregateHookFreshness()` / `HookScriptCheck` 与单源映射表（`dangerous-commands.ps1` / `agy-dangerous-commands.ps1` / `pre-tool-hook.ts`）；`RuntimeProbeResult` 新增 5 个**可选**字段（`hookScriptFreshness` / `hookScriptChecks` / `dshRuleCounts` / `dshRepoRuleCount` / `dshPatchFreshness`）；claude/codex 分支对配置内**全部** PreToolUse 命令逐条做单源比对；dsh 分支改用 `checkDshPatchDeep`；`opts` 新增可选 `repoRoot`（默认与原内联计算完全同值，另加 `assets/opencode` 复用） |
| `packages/cli/src/commands.ts` | `cmdDoctor` 在两个 agent 分支各加**一条 WARN 出口**（claude/codex hook 陈旧、dsh 条数不足）；`cmdDoctor` JSDoc 记录 G2 语义与「WARN 不得触发 exit 1」约束。**未改动** PASS/FAIL 既有行文本、顺序与 `Summary` 格式 |
| `packages/installer/src/index.ts` | `runDoctors` 导出加废弃注释；新增导出 `checkDshPatchDeep` / `countPatchRules` / `probeAgentRuntime` / `checkHookScriptFreshness` / `aggregateHookFreshness` 及类型 |
| `packages/installer/test/installer.test.ts` | 仅加注释，指明旧 `runDoctors` 用例是「不抛错守门」，真实语义由新测试覆盖（**未改断言**） |
| `packages/installer/test/runtime-probe-freshness.test.ts` | **新增 16 例** |
| `tests/e2e/cli-doctor-freshness.e2e.test.ts` | **新增 7 例**（真实 spawn `bin/riskguard.mjs`） |

明确**未做**的事：没有删除 `runDoctors`（只废弃）；没有改 `runHookSelfTest` 一个字符；没有把新鲜度接入 `state` 判定；没有动 `cmdStatus` 输出。

---

## 2. 三项能力 + 反例实证

统一对照基线用的是**提交 `552fca3` 的旧实现本体**（`git show HEAD:packages/installer/src/doctor.ts` 原样取出，仅把相对 import 指回仓库），不是口头描述。
复现：`node tasks/orchestrator/_g2_evidence.mts`（原始输出存档 `_g2_evidence_out.txt`）、`node tasks/orchestrator/_g2_cli_evidence.mts`（`_g2_cli_evidence_out.txt`）、`node tasks/orchestrator/_g2_realhome_compare.mts`（`_g2_realhome_compare_out.txt`）。全部构造在 `mkdtemp` 临时 home 内，真实 `~/.claude`、`~/.codex`、`~/.dsh` **只读**。

### ① dsh 门禁：子串匹配 → 规则数 vs 仓库单源

**反例：条数不足（65 < 69，等价构造）**

```
--- BEFORE（552fca3 旧实现 runDoctors / checkDshPatch）---
runDoctors().ok = false
  checkDshPatch → {"agent":"dsh",...,"state":"ok","detail":"已注入：web ✓"}
  probe → selfTestPassed=true state=ACTIVE（无条数、无新鲜度）
--- AFTER（本轮）---
  repoRuleCount=69 freshness=false profiles=[{"profile":"web","rules":65,"hasPatch":true}]
  notes=["rules 65 < repo 69 (profile: web)"]
  check={"agent":"dsh",...,"state":"ok","detail":"已注入：web ✓ (65 rules)"}
  evidence → dsh profile web: 65 rule(s) in deny-risk-commands
  evidence → rules 65 < repo 69 (profile: web)
  state=ACTIVE selfTestPassed=true dshPatchFreshness=false（WARN ≠ 降级）
```

旧实现对此场景报 `ok / ACTIVE`，**完全看不出陈旧**；新实现产出 `rules 65 < repo 69 (profile: web)` 并让 doctor 输出：

```
WARN  dsh            patch 规则数少于仓库单源（可能陈旧，详情见 --verbose）
Summary: 0 PASS / 1 WARN / 0 FAIL / 10 SKIP
>> exit code = 0
>> --json: pass=0 warn=1 fail=0 skip=10 exitCode=0（进程退出码 0）
>> --json checks: [{"level":"WARN","agent":"dsh","message":"patch 规则数少于仓库单源（可能陈旧，详情见 --verbose）"}]
```

**正例对照（条数相等 → 不报）**：`Summary: 1 PASS / 0 WARN / 0 FAIL`，`PASS dsh pre-execute patch（deny-risk-commands）`，exit 0。
**正例对照（条数多于单源 → 不报）**：用户自行加规则是合法增强，`dshPatchFreshness=true`。

**本机真实 home（只读）**：`web` 与 `headless` 两个 profile 均 69 条，`dshRepoRuleCount=69`、`dshPatchFreshness=true`，evidence 为 `dsh rule count in sync with repo single source (repo 69)` → **不产生新 WARN**。

### ② claude/codex：已装 hook 脚本 vs 仓库单源（SHA256）

**反例：哈希不一致（在 `assets/hooks/dangerous-commands.ps1` 基础上追加一行注释后接入 codex）**

```
--- BEFORE（552fca3 旧实现）---
  checkCodexHook → {"agent":"codex",...,"state":"ok","detail":"发现 RiskGuard PreToolUse 门禁"}
  （只做 raw.includes 子串判断；无 hash、无单源、无新鲜度）
--- AFTER（本轮）---
  hookTargetExists=true hookScriptFreshness=false artifactIntegrity=false
  hookScriptChecks=[{ "script": "...\\.codex\\hooks\\dangerous-commands.ps1",
                      "source": "<repo>\\assets\\hooks\\dangerous-commands.ps1",
                      "fresh": false,
                      "detail": "script differs from repo single source (possibly stale): ..." }]
  evidence → script differs from repo single source (possibly stale): ...
```

端到端 doctor（`--verbose`）同时证明 **实弹 self-test 未被削弱、ACTIVE 未降级**：

```
WARN  codex          hook 脚本与仓库单源不一致（可能陈旧，详情见 --verbose）
        → script differs from repo single source (possibly stale): ...\dangerous-commands.ps1
        → self-test PASS (ps1: harmless=allow, dangerous=deny)
        → runtime self-test PASS → ACTIVE
Summary: 0 PASS / 1 WARN / 0 FAIL / 10 SKIP   >> exit code = 0
```

**正例对照**：
- 与单源**逐字节相同**的拷贝 → `hookScriptFreshness=true`，evidence = `hook script matches repo single source (sha256)`，无 `differs` 行。
- hook **就地引用**仓库单源（`-File "<repo>/assets/hooks/dangerous-commands.ps1"`）→ `fresh=true`，evidence = `hook script is the repo single source itself (in-place reference)`。
- **node 型** `pre-tool-hook.ts` 拷贝（映射到 `packages/cli/src/hooks/pre-tool-hook.ts`）同样被比对出 `false`。
- **本机真实 home**：codex 的两条 PreToolUse（旧的 `~/.codex/hooks/dangerous-commands.ps1` 拷贝 + 新的 node 就地引用）**逐条**比对，均 `fresh=true` → 无 WARN。

### ③ 单源缺失（裁剪安装）→ 未校验，绝不 FAIL

```
repoRoot(空目录) = <tmp>
  dsh   → repoRuleCount=null freshness=null check.state=ok（patch 仍在位）
          notes=["repo single source unavailable — dsh rule-count freshness not checked: ..."]
          probe → dshRepoRuleCount=null dshPatchFreshness=null state=ACTIVE wired=true
  codex → hookScriptFreshness=null artifactIntegrity=null state=INSTALLED
          evidence → repo single source unavailable — freshness not checked: dangerous-commands.ps1
  checkHookScriptFreshness(目录冒充脚本) → fresh=null, detail="hook script hash unavailable — freshness not checked"
```

即：**单源缺失 / 无映射 / hash 读不到 → 一律 `null`（未校验）**，不 FAIL、不抛错、不改 `state`。

### ④ 双实现收敛

```
packages/installer/src/doctor.ts:
 * @deprecated 自 v0.1.2 起，CLI（doctor / status / install verification）已**统一**走
 *   probeAgentRuntime()（packages/installer/src/runtime-probe.ts）……两套 doctor 并存会得出「两个真相」
 * 已知局限：1. 子串级 2. 无实弹 self-test 3. 无新鲜度 4. 无 state / verificationMode
```

真实 home 上两套实现的对照（`_g2_realhome_compare_out.txt`）：

```
BEFORE runDoctors()（552fca3 旧实现，真实 home）:  ok = false
  missing      claude-code   settings.json 无 RiskGuard hook
  ok           dsh           已注入：headless ✓, web ✓
  ok           codex         发现 RiskGuard PreToolUse 门禁
  ok           opencode      发现 agent-risk-guard 插件注册
AFTER probeAgentRuntime(deep=true)（本轮，真实 home）:
  BROKEN  claude-code   fresh(hook)=null
  ACTIVE  codex         fresh(hook)=true
  ACTIVE  opencode      fresh(hook)=null
  ACTIVE  dsh           fresh(dsh)=true  dshRules=[{headless,69},{web,69}]
```

`checkDshPatch` 保留原签名并从 `checkDshPatchDeep` 委托（回归在案），旧测试文件只加注释不改断言。

---

## 3. 语义选择与理由

**（1）新鲜度不一致 = WARN，不降 BROKEN —— 采用任务卡建议，并给出理由。**
「已装脚本 ≠ 仓库单源」有两种成因：真的陈旧，或用户**有意**改过脚本 / 自行加规则。doctor 无法区分，而把「怀疑」报成「损坏」会让用户为了消除 FAIL 去覆盖自己刻意保留的定制（并且违反任务卡约束 1 的退出码契约）。因此：
- `state` 判定逻辑**完全未改**——新鲜度字段一个都没进入 `probeAgentRuntime` 的 state 分支；
- doctor 只 `counts.warn++`，`exitCode = counts.fail > 0 ? 1 : 0` 原样保留；
- 陈旧时该 agent 的主行由 `PASS` 变为 `WARN`（不是「PASS + 附注 WARN」，避免 Summary 与行数自相矛盾），`Summary` 计数一致。
代价：一条 `WARN` 会替换掉 `PASS`，verbose 里才看得到 `self-test PASS`。已用 e2e 固定该行为。

**（2）`artifactIntegrity` 在 claude/codex 上复用为新鲜度（按任务卡 理想行为 #2 字面要求）。**
安全性核查（逐处消费方）：`runtime-probe` 的 `state` 分支只在 `agent === 'opencode'` 读它；`commands.ts` 只在 `opencode` 分支与 `verificationMode === 'static'` 时读它；`installOne` 只在 `inst.id === 'opencode'` 时读它。claude/codex 恒为 `dynamic`，故该写入**对其他任何判定都是惰性的**，不构成「既有字段语义被改坏」的实际风险；同时新增 `hookScriptFreshness` / `hookScriptChecks` 承载明确语义，两处取值恒等（已在接口 JSDoc 写明这是有意的冗余）。

**（3）dsh 计数与「同步」的定义**：只比 `rules < repo`。多于单源视为同步（用户加规则是增强，不是陈旧）。计数限定在 `id: deny-risk-commands` 块内，避免同 profile 其他 insert 的 `re:` 混入；同时兼容 flow 逐行、flow 内联数组、block 三种写法（防止把「格式不同」误判成「条数不足」）。

**（4）比对范围取「配置内全部 PreToolUse 命令」，而非只取我方那一条。**
真实机器上 codex 同时存在旧 ps1 条目与新 node 条目——只查一条会漏掉典型的「旧 hook 忘删」陈旧形态（即任务卡用户场景 1）。逐条比对后聚合：**任一处不一致即 false**。本机两条都一致，故零新增 WARN；若旧拷贝真的陈旧，doctor 会提示而不会静默。

**（5）`opts.repoRoot` 为可选新增**，默认值与改动前的内联计算完全一致（`packages/installer/src` 上溯 3 层），既让「单源缺失」可被确定性测试，也让裁剪安装/便携 runtime 场景可控。

---

## 4. 测试数字（前后对照）

| 项 | 改动前 | 改动后 |
|---|---|---|
| 全量套件（CI 同一条 glob） | **337 tests / 337 pass / 0 fail** | **360 tests / 360 pass / 0 fail** |
| 新增用例 | — | `packages/installer/test/runtime-probe-freshness.test.ts` **16**；`tests/e2e/cli-doctor-freshness.e2e.test.ts` **7** |
| 真实 home `doctor` | `3 PASS / 0 WARN / 1 FAIL`，exit 1（claude-code 接线漂移，既有） | **完全一致**：`3 PASS / 0 WARN / 1 FAIL`，exit 1 |
| CI 辅助脚本 | — | `check-compatibility-docs` OK；`verify-acs-schema-snapshot` OK（7/7）；`generate-agent-security-matrix --check` OK |

复现命令：

```
node --test packages/core/test/*.test.ts packages/trash/test/*.test.ts packages/installer/test/*.test.ts \
  packages/codex/test/*.test.ts packages/dsh/test/*.test.ts packages/acs/test/*.test.ts tests/e2e/*.test.ts \
  tests/adapter/*.test.ts tests/adversarial/*.test.ts tests/product/*.test.ts tests/release-hardening/*.test.ts \
  tests/transaction/*.test.ts tests/distribution/*.test.ts tests/acs/*.test.ts tests/compatibility/*.test.ts \
  tests/conformance/*.test.ts tests/acs-schema-conformance/*.test.ts
# → ℹ tests 360  ℹ pass 360  ℹ fail 0
```

**约束逐条自证**

1. 退出码契约（`552fca3`）：新增 e2e 断言 `doctor` 新鲜度 WARN 时 **exit 0**；并回归 `hook allow/deny/空输入 → 0`、`未知子命令 → 2`、`doctor 有 FAIL → 1`（真实 home 仍 1）。✅
2. 实弹 self-test 未削弱：`runHookSelfTest` 未改；新测试断言「陈旧 hook 的 self-test 仍执行且 PASS → 保持 ACTIVE」；既有 `hook-claude` / `hook-codex` / `Case10` 全绿。✅
3. 新增字段全部可选；`artifactIntegrity` / `state` / `verificationMode` / `evidence` 语义有上文逐处核查。✅
4. 测试只用 `mkdtemp` 临时 home；勘察与真实 home 对照均为只读。✅
5. 337 → 360 全绿。✅
6. 新鲜度按 WARN（理由见 §3.1）。✅

---

## 5. 未解决问题 / 已知局限

1. **`runDoctors` 并未删除**，`index.ts` 仍导出（任务卡只要求 `@deprecated`）。同文件里的 `checkClaudeHook` / `checkCodexHook` / `checkOpencodePlugin` 仍是子串级实现，仍可能被审计者误读为「doctor 的全部」。建议后续轮次：把旧 `checkXxx` 一并标注 legacy，或在大版本中删除并同步删除 `index.ts` 导出与旧测试。
2. **dsh 计数是缩进启发式，不是真 YAML 解析**（运行时零依赖，未引入 yaml 包）。已覆盖 flow 逐行 / flow 内联数组 / block 三种常见写法，并跳过注释行；但若有人把 `rules` 写成 YAML 锚点 / 多文档 / 把 `id:` 与其它键写成同一行 flow mapping（`- { id: deny-risk-commands, ... }`），会退化到全文计数。全文计数在「同 profile 存在其它含 `re:` 的 insert」时可能**高估**，从而掩盖陈旧。当前下发模板与两个真实 profile 均为标准形态，未触发。
3. **`artifactPresent` 在 claude/codex 分支恒为 `false`，而 `artifactIntegrity` 现在可能非 null**，字段组合看起来不自洽。因为它对上层的所有读取点都是惰性的（§3.2），本轮按任务卡字面要求保留，但这是一处**遗留的语义债**：更干净的做法是给 claude/codex 增加 `hookScriptPresent` 之类的独立字段、让 `artifactIntegrity` 只服务 opencode。
4. **只能检出「内容差异」，检不出「语义陈旧」**：若有人只改了注释/换行，会报不一致（假阳性方向，属保守）；反之，若旧版规则集与新版恰好字节相同则不可检出（不可能）。真正的「规则强度」验证仍需 dsh 侧实弹（当前 dsh 分支无 CLI hook 可 spawn，沿用 `selfTestPassed = wired` 的既有语义，未做增强）。
5. **未接入 `status` / `install-verification` 输出**：`cmdStatus` 不展示新鲜度（任务卡只要求 doctor 的 `--verbose` evidence）。若下游希望 status 也提示陈旧，需要另行评估 `cmdStatus` 输出契约。
6. 便携 runtime（`~/.riskguard/runtime/<ver>`）**不含 `assets/hooks` 与 `assets/dsh`**，因此在 runtime 内运行时 hook 新鲜度恒为「未校验（null）」。这是当前设计下的既有限制（`collectRuntimeFiles` 决定），本轮按「缺失=未校验、不 FAIL」处理，未扩大 runtime 文件集。

---

## 6. 产物索引（均在 `tasks/orchestrator/`）

- `_g2_inspect.mjs` / `_g2_inspect2.mjs` — 实施前只读勘察（真实 home 的 wiring 形态、profiles 条数、已装脚本 hash）
- `_g2_doctor_before.ts` — 从 `552fca3` 取出的旧 `doctor.ts`（"before" 对照组本体）
- `_g2_smoke.mts` — 真实 home 上 probe 新字段冒烟
- `_g2_evidence.mts` / `_g2_evidence_out.txt` — 反例 A/B/C/D 的 before/after 原始输出
- `_g2_cli_evidence.mts` / `_g2_cli_evidence_out.txt` — 真实 spawn CLI 的 doctor 输出与退出码
- `_g2_realhome_compare.mts` / `_g2_realhome_compare_out.txt` — 真实 home 上旧/新实现对照
