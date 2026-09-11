# EVALUATION_RESULT — G1（退出码可信）+ G7（错误语义）

- Evaluator：独立子代理（DeepSeek Harness），未参与实现
- 日期：2026-09-11
- 仓库：`E:\DeepSeek_Harness\workspace\2026_08_21\agent-risk-guard`（main，基线 `67faab8`，改动未提交）
- 验收基准：`tasks/orchestrator/IMPLEMENTATION_BRIEF_G1G7.md`
- 方法：**全部结论来自本次自己 spawn 的真实进程**；旧版对照用 `git archive HEAD | tar -x` 解出的纯净副本（`_eval_g1g7_old_v2`，**未使用 git stash，未改动工作区**），实验后已整体回收。
- 自跑脚本：`_ev2_matrix.mjs`、`_ev2_supp.mjs`、`_ev2_edges.mjs`、`_ev2_residual.mjs`；原始输出：`_ev2_matrix_new.txt`、`_ev2_matrix_old.txt`、`_ev2_supp_out.txt`、`_ev2_edges_out.txt`、`_ev2_residual_out.txt`、`_ev2_reg_*.txt`、`_ev2_fullci.txt`、`_ev2_old_fullci.txt`。

---

## 0. 结论

**ACCEPT。**

- 六条验收标准全部 PASS（逐条见 §2）。
- **无回归**：既有测试 319 → 337，0 失败；唯一被改的既有断言是**收紧**而非放宽。
- **无 hook 契约破坏**：hook 运行时（无子命令 + stdin JSON）在无害/危险/空输入/坏 JSON 四类必测输入上**全部 exit 0**，空输入与坏 JSON 的 fail-closed deny 语义逐字未变。
- 前一位 Evaluator 留下的 `null` 线索**已查证为既有行为，非本次引入的回归**（见 §1.4）。

---

## 1. 前一位 Evaluator 的线索：stdin `null` → exit 1

### 1.4 判定：既有行为，不是本次回归

`echo null | node bin/riskguard.mjs` 在**新旧两版**都返回 exit 1、stdout 为空、stderr 一段 TypeError。差别只是抛错位置：

| | 旧版（HEAD `67faab8` 纯净副本） | 新版（工作区） |
| --- | --- | --- |
| 退出码 | **1** | **1** |
| stdout | 空 | 空 |
| stderr | `TypeError: Cannot read properties of null (reading 'event')` at `packages/cli/src/cli.ts:45`（`if (input.event)`） | `TypeError: Cannot read properties of null (reading 'tool_input')` at `packages/cli/src/index.ts:177`（本次新增的归一化行） |

抛错点从 `cli.ts` 前移到 `index.ts` 只是因为在 `run(input)` 之前新增了一行解引用，**对外可观测契约（退出码 + stdout）逐字节一致**。按任务卡的 hook 契约只覆盖「空输入 / 坏 JSON」，`null` 两者都不属于。判定：**非回归**。

同类对照（同一脚本 OLD / NEW 各跑一次，全部一致）：

| 输入（合法 JSON 但非对象） | OLD | NEW | 是否变化 |
| --- | --- | --- | --- |
| `null` | 1（抛错） | 1（抛错） | 否 |
| `[]` | 0 + allow | 0 + allow | 否 |
| `123` | 0 + allow | 0 + allow | 否 |
| `"str"` | 0 + allow | 0 + allow | 否 |
| `true` | 0 + allow | 0 + allow | 否 |
| `{}` | 0 + allow | 0 + allow | 否 |

附带发现（同样是既有缺陷，非本轮引入）：畸形 `{"event":{...}}` 在 OLD / NEW 都 exit 1（`packages/core/src/policy-engine.ts:54` 抛错）。两者合计说明：**该 runtime 对「合法 JSON 但结构不合预期」的输入没有兜底**，与它对「坏 JSON」的 fail-closed 处理不一致。

> 建议（非阻塞，另开卡片）：把「JSON 解析成功但结果不是对象」并入现有 fail-closed 分支，输出 `{"decision":"deny","degraded":true,"reason":"invalid input shape (fail-closed)"}` + exit 0，与空输入/坏 JSON 对齐。此项不影响 G1/G7 验收。

---

## 2. 逐条验收标准

### AC1 — doctor 有 FAIL → 1；无 FAIL → 0：**PASS**

真实 home（3 PASS / 0 WARN / 1 FAIL / 7 SKIP）：

```
$ node bin/riskguard.mjs doctor ; echo exit=$?
FAIL  claude-code    RiskGuard hook 注入缺失  → 重跑: node bin/riskguard.mjs install --agent claude-code
Summary: 3 PASS / 0 WARN / 1 FAIL / 7 SKIP
Exit code 1 (1 FAIL). Fix the FAIL item(s) above, then re-run doctor.
exit=1                      ← OLD 同一命令 = 0
```

- fake home（无任何 agent，全 SKIP、0 FAIL）→ **0**；fake home（真安装 claude-code 后全 PASS）→ **0**；fake home（3 个 agent 检出但未接线，3 FAIL）→ **1**。
- 人类输出只做了两处追加，未重排。`Compare-Object` 逐行 diff（旧 vs 新，真实 home）**只有 2 行差异**：FAIL 行尾追加 `→ 重跑: …`，Summary 之后追加 `Exit code 1 (1 FAIL)…`。既有行序、Summary 格式不变。
- `doctor --json` + FAIL → **1**，stdout 可 `JSON.parse`，且 `json.exitCode === 进程退出码`；旧版 `doctor --json` 根本不输出 JSON（打印文本），故新版为**纯增量**，无兼容性破坏。

### AC2 — 未知子命令 → 2 + `Unknown command`，不再输出 deny JSON：**PASS**

| 场景 | OLD | NEW | NEW stdout |
| --- | --- | --- | --- |
| `frobnicate` | 0 + `{"decision":"deny",…"empty input (fail-closed)"}` | **2** | `Unknown command: frobnicate` + `Run 'node bin/riskguard.mjs help' for usage.` |
| `doctorr` | 0 + deny JSON | **2** | `Unknown command: doctorr` |
| `''`（空参数） | 0 + deny JSON | **2** | `Unknown command: (empty argument)` |
| `frobnicate --json` | 0 + deny JSON | **2** | `Unknown command: frobnicate` |

新版 stdout 已断言**不含** `"decision"` / `fail-closed`（我自己脚本的 `outNotHas` 检查通过）。

### AC3 — hook 运行时契约（最高优先级）：**PASS，未破坏**

`echo '<JSON>' | node bin/riskguard.mjs`：

| 输入 | OLD 退出码 | NEW 退出码 | NEW 决策 |
| --- | --- | --- | --- |
| 无害命令（CC 形状 `tool_input.command`） | 0 | **0** | `allow` |
| 危险命令（CC 形状，任务卡同款 payload） | 0 | **0** | **`deny`**（`RG-GIT-001`） |
| 危险命令（`commandRaw` 形状） | 0 | **0** | `deny`（`RG-GIT-001`） |
| 危险命令 #2（`rm -rf /tmp/x`，CC 形状） | 0 | **0** | `deny`（`RG-FS-001`） |
| 空 stdin | 0 | **0** | `deny` + `empty input (fail-closed)` |
| 纯空白 stdin | 0 | **0** | `deny` + `empty input (fail-closed)` |
| 坏 JSON `{broken` | 0 | **0** | `deny` + `invalid json input (fail-closed)` |
| 坏 JSON `{"a":1,}` | 0 | **0** | `deny` + `invalid json input (fail-closed)` |

四类必测输入**全部 exit 0**；空输入与坏 JSON 的 `degraded:true` + `RG-CLI-000` fail-closed 形状逐字未变。**hook 运行时没有被改成非 0。**

补充边界（归一化鲁棒性，均**不崩**且 exit 0）：`tool_input: null` → allow；`tool_input.command` 为 number / array / 空串 → 忽略该字段 → allow。显式 `commandRaw` 仍然权威：`{commandRaw:"echo hi", tool_input:{command:<危险>}}` → allow，`{commandRaw:<危险>, tool_input:{command:"echo hi"}}` → deny（新增归一化有 `!input.commandRaw` 守卫，符合实现者自述）。

### AC4 — install/uninstall 失败路径非零：**PASS**

| 场景 | OLD | NEW | NEW 关键输出 |
| --- | --- | --- | --- |
| install 配置损坏 → abort（零写入） | 0 | **1** | `installation aborted` |
| install OpenCode 插件同名异内容 → abort | 0 | **1** | `plugin installation aborted`；文件未被覆盖（自验 equal） |
| install VERIFY 失败 → **真回滚** | — | **exitCode 1** | `install verification FAILED and was rolled back`；manifest 不存在；同场景无注入对照组 = 0 且 manifest 存在 |
| install 未知 agent | 0 | **2** | `Unknown agent: nonsense. Skipped.` |
| uninstall 被拒（装后配置损坏） | 0 | **1** | `uninstall refused` |
| uninstall 未装过（幂等） | 0 | **0** | `not installed (no manifest)` |
| install 幂等再装 | 0 | **0** | `already installed (idempotent, no change)` |
| install --dry-run（无 agent） | 0 | **0** | `No installable agents detected on this machine.` |
| 子命令内部异常 | 未捕获 stack trace，1 | **1** | 一行 `RiskGuard: <message>` → stderr |

### AC5 — 现有测试套件全绿（前后数字）：**PASS**

| 测试集 | 改前（HEAD `67faab8` 纯净副本） | 改后（工作区） | 差 |
| --- | --- | --- | --- |
| brief 指定的 4 组（e2e + installer + release-hardening + product） | **76 / 76 pass / 0 fail** | **94 / 94 pass / 0 fail** | +18 |
| 完整 CI 集（实现者 §8 的 17 个 glob） | **319 / 319 pass / 0 fail** | **337 / 337 pass / 0 fail** | +18 |

两次对照均用同一台机器、同一 Node（v24.14.0）、同一命令；旧版副本额外补入 `node_modules` 与 `node scripts/build-release.ts` 产物以保证公平（否则 `tests/distribution` 与 `tests/acs-schema-conformance` 会因环境缺失而假红）。

实现者自述的「319 → 337」与我的独立复跑**完全一致**。

### AC6 — FAIL 行含可执行修复提示：**PASS**

真实 home：`FAIL  claude-code    RiskGuard hook 注入缺失  → 重跑: node bin/riskguard.mjs install --agent claude-code`。`--json` 下同一提示为独立字段 `checks[].fix`，已断言可解析且含 `install --agent`。

---

## 3. 测试真实性（含变异验证）

`tests/e2e/cli-exit-codes.e2e.test.ts` 共 18 用例，其中 **17 个真实 `spawnSync(process.execPath, [bin/riskguard.mjs, …])` 并断言 `.status`**；1 个（VERIFY 回滚）因 argv 无法注入故障，调用 `index.ts` 实际调用的同一函数 `cmdInstallResult` 并断言 `.exitCode` —— 该折衷在测试内有注释说明，可接受（`_test.failVerify` 是 HEAD 就存在的注入点，非本轮新增）。

**变异实验**（本 Evaluator 亲自执行，破坏 → 观察 → 逐字节还原）：

1. 基线：`node --test tests/e2e/cli-exit-codes.e2e.test.ts` → `tests 18 / pass 18 / fail 0`。
2. 变异两处关键断言：doctor FAIL 用例 `assert.equal(r.status, 1, …)` → `0`；hook 危险 payload 用例 `assert.equal(r.status, 0, …)` → `7`。
3. 复跑 → `tests 18 / pass 16 / fail 2`，**两处变异用例均变红**（`✖ exit: doctor 有 FAIL → exit 1…`、`✖ hook: 危险 payload → deny JSON + exit 0…`），证明这两个断言真实读取 spawn 出来的进程退出码，不是空断言。
4. 还原：`Copy-Item` 回备份，SHA256 复核 **`32D7E84C5DC90807E6D1F72E4D738CBBF70032A52DC39B5205321A8BC72065EE`**（与实验前一致），全文检索 `EV2 MUTANT` 残留为空。

结论：新增测试**真实且有效**。

---

## 4. 旧断言是否被削弱

`git diff --numstat tests/release-hardening/lifecycle.e2e.test.ts` = **6 insertions / 4 deletions**，逐行核对：

| 位置 | 改动 | 性质 |
| --- | --- | --- |
| ~176 坏 JSON 配置 → install 拒绝且零写入 | `assert.equal(r.status, 0)` → `1`（+1 行注释） | **收紧**：从「失败也算成功」改为「失败必须可见」 |
| ~198 未知 alias `nonsense` | `assert.equal(u.status, 0)` → `2`（+1 行注释，并把原注释改为 G7 说明） | **收紧** |
| ~225 OpenCode 插件同名异内容 → 拒绝安装 | `assert.equal(r.status, 0)` → `1`（+1 行注释） | **收紧** |

**判定：如实反映新契约，不是放宽掩盖。** 理由：(a) 只改了断言的期望值，方向是 0 → 非零，属于收紧；(b) 三个用例的其余断言（`/installation aborted/`、`/contains invalid JSON/`、`/made no changes/`、`/plugin installation aborted/`、`/No files were overwritten/`、配置内容 `assert.equal(after, before)` 零写入、manifest 不存在、opencode.json 未被引用）**一行未动**，未见任何「删断言 / 放宽为 contains 子串 / 改为 try-catch 吞掉」；(c) 唯一被改的测试文件就是这一个 —— `git diff --name-only -- tests/ packages/` 仅列出 `packages/cli/src/{commands,index}.ts` 与 `tests/release-hardening/lifecycle.e2e.test.ts`，`tests/transaction`、`tests/e2e/install-ux`、`tests/product`、`packages/installer/test`、`tests/distribution` 均零改动（与实现者自述一致）。

另外核对了「不得不改」的正当性：把新代码回退成旧退出码后，这 3 个断言会重新变绿，说明它们确实是旧行为的显式编码，与 AC4 直接冲突，改它们是必然的。

---

## 5. 三项裁决

### 裁决 A：hook 运行时新增 `tool_input.command` → `commandRaw` 归一化

**判定：必要修复，应保留（不应回退）。**

独立复核 fail-open 是否真实 —— **真实，且可对旧版稳定复现**：

```
# 旧版（HEAD 纯净副本）
$ echo '{"tool_name":"Bash","tool_input":{"command":"git reset --hard HEAD"}}' | node <old>/bin/riskguard.mjs
{"decision":"allow","ruleId":"RG-UNKNOWN-001","reason":"普通 workspace 写入放行（Profile B）",…}   exit 0   ← 危险命令被放行
$ echo '{"tool_name":"Bash","tool_input":{"command":"rm -rf /tmp/x"}}'    | node <old>/bin/riskguard.mjs
{"decision":"allow","ruleId":"RG-UNKNOWN-001",…}                                                exit 0   ← 同上

# 新版
同一输入 → {"decision":"deny","ruleId":"RG-GIT-001",…}  exit 0
同一输入 → {"decision":"deny","ruleId":"RG-FS-001",…}   exit 0
```

支持「必要修复」的四点证据：

1. **fail-open 真实存在**，不只是理论：旧版对该形状的危险命令返回 `allow`（`RG-UNKNOWN-001`），两条独立 payload（git / rm）均复现。
2. **该入口是文档化的用户可达路径**：`README.md` 明确写着「Windows PowerShell：`Get-Content … -Raw | node packages/cli/src/index.ts` 仍可用作 stdin-JSON → Decision-JSON 的底层判定入口」，并按此在 `help` 文本里给出示例。用户按文档喂 Claude 形状 payload 即命中 fail-open。
3. **AC3 明文要求**「危险 payload 亦 exit 0 + deny JSON」；而新增测试第 9 条正是断言 CC 形状危险 payload → deny。去掉这 3 行，AC3 与新增用例同时挂掉 —— 也就是说这 3 行不是「顺手多改」，而是满足验收标准所必需。
4. **不触碰任何「不能破坏」条款**：改动仅 3 行、纯追加、有 `!input.commandRaw` 守卫（显式 `commandRaw` 仍权威，双向验证过），hook 运行时仍输出 decision JSON 且恒 exit 0；方向是 fail-closed（只可能把 allow 收紧成 deny，不可能新增 allow）。

关于「是否超出『只改退出码与提示』的范围」：确实扩张了改动面，但 (a) 实现者在 `IMPLEMENTATION_RESULT_G1G7.md §7.1` **主动披露**并给出 3 行回退方案，未隐瞒；(b) 真实 CC/Codex 硬拦截走 `packages/cli/src/hooks/pre-tool-hook.ts`（**经 git diff 确认未改动**）这一前提**核实为真**。建议编排器接受，但把它作为**独立条目**记账（安全修复），不要混进「退出码」变更摘要。

补充残差核查（无新增分歧）：我把 5 类 payload 同时喂给 `index.ts`（归一化后）与真实入口 `hooks/pre-tool-hook.ts --agent claude`，判定结果**全部一致**（危险 Bash → 双方 DENY；无害 Bash / Write 受保护路径 / delete_file / PowerShell Remove-Item → 双方一致）。即归一化让两个入口**趋于一致**，未引入新的判定分歧。需注意 Write/delete_file 在两个入口都是 allow —— 那是既有的产品判定，与本轮无关。

### 裁决 B：`install --agent <本机未检出>` → exit 1

**判定：合理，保留。**

- 语义上是「用户点名要装 X，结果没装成」→ 操作未达成 → 非零，脚本/CI 才能察觉；实测 `install --agent codex`（本机不可检出）→ `Codex CLI not detected. Skipped.` exit **1**（旧版 0）。
- 关键是没有误伤：**未显式指定目标**的扫描式安装在无候选时仍为 **0**（`install --dry-run` → `No installable agents detected on this machine.` exit 0），即「环境不具备」在不点名时不被当作失败。
- 该语义已写入 `help` 与 `README` 的退出码表（`1 = …显式指定的 agent 未安装`），对外承诺与实现一致。
- 唯一可讨论点：若某 CI 在「本机本来就没有 codex」的平台上无条件跑 `install --agent codex`，现在会红。但这正是期望语义（要么去掉 `--agent`，要么在脚本里按平台分支）；不需要改。

### 裁决 C：`install --agent dsh` 文案仍为 `Unknown agent: dsh`（码已 2）

**判定：不阻塞。**

- 退出码语义正确且可被脚本察觉（**2 = 用法错误**，旧版为 0），AC 未对 dsh 的文案提出要求。
- 文案确实**不精确**：dsh 是 registry 中已知且本机可检出的 agent，只是 `installerKey('dsh') === null`（不在本 CLI 安装范围），说成 `Unknown agent` 有误导。但这属于措辞问题，不改变任何退出码或安全语义，且实现者已在 §7.3 列为遗留项。
- 建议后续单独卡片：`dsh` 单独分支，输出「dsh 不在本 CLI 安装范围，请用 `skills/agent-risk-guard/sync-prod.ps1` / wiring-check 部署」，退出码保持 2。**不要**在本轮为此扩大改动面。

---

## 6. 非阻塞发现（供后续卡片，均不影响本次验收）

1. `node bin/riskguard.mjs --help` / `-h` / `--json`（单独一个 flag、无子命令）现在返回 **exit 2 `Unknown command: --help`**（旧版 0 + deny JSON）。退出码语义没错（用法错误），但 `--help` 却被叫「未知命令」不够友好。建议把 `--help`/`-h` 映射到 `help`、`--version` 映射到 `version`。
2. `node bin/riskguard.mjs acs`（两词命令只给一半）→ `Unknown command: acs`，未提示 `acs evaluate`。可在未知命令分支对 `acs` 做特判提示。
3. 合法 JSON 但非对象（`null` → exit 1，见 §1）；畸形 `{event:…}` 亦 exit 1。建议统一并入 fail-closed deny + exit 0。
4. 未知命令提示走 **stdout**（stderr 为空）。与仓库「所有命令输出走 stdout」的现状一致，但若 CI 契约希望用法错误走 stderr，需一次性调整（实现者 §7.4 已列为待决）。
5. `dist/` 为 gitignore 产物：本机 `dist/agent-risk-guard-v0.3.0/packages/cli/src/{index,commands}.ts` 与工作区源码 **SHA256 逐字节一致**（说明已按新代码重建，`tests/distribution` 跑的是新代码）。但该产物**不入库**，若发布流程在别处重建，需确保用的是本次源码 —— 属发布流程问题，非本次实现缺陷。

---

## 7. 复现步骤

```bash
cd E:/DeepSeek_Harness/workspace/2026_08_21/agent-risk-guard

# 0) 旧版纯净对照（不动工作区）
mkdir -p /tmp/rg-old && git archive HEAD | tar -x -C /tmp/rg-old
cd /tmp/rg-old && npm i --no-audit --no-fund && node scripts/build-release.ts

# 1) 退出码矩阵（新版 / 旧版各一次）
node tasks/orchestrator/_ev2_matrix.mjs --label NEW
node tasks/orchestrator/_ev2_matrix.mjs --launcher /tmp/rg-old/bin/riskguard.mjs --label OLD
node tasks/orchestrator/_ev2_supp.mjs      # 全量 fake-home 场景（abort / clash / refused / rollback）
node tasks/orchestrator/_ev2_edges.mjs     # 输入形状与 argv 边界
node tasks/orchestrator/_ev2_residual.mjs  # index.ts vs pre-tool-hook.ts 判定对照

# 2) 关键单点
node bin/riskguard.mjs doctor ; echo "exit=$?"                                  # 1（3 PASS/1 FAIL）
node bin/riskguard.mjs frobnicate ; echo "exit=$?"                              # 2 + Unknown command
echo '{"tool_name":"Bash","tool_input":{"command":"echo hi"}}' | node bin/riskguard.mjs ; echo "exit=$?"  # 0 allow
echo '{"tool_name":"Bash","tool_input":{"command":"git reset --hard HEAD"}}' | node bin/riskguard.mjs ; echo "exit=$?"  # 0 deny
echo '' | node bin/riskguard.mjs ; echo "exit=$?"                               # 0 fail-closed deny
echo 'null' | node bin/riskguard.mjs ; echo "exit=$?"                           # 1（既有行为，非回归）

# 3) 测试
node --test "tests/e2e/*.test.ts" "packages/installer/test/*.test.ts" \
            "tests/release-hardening/*.test.ts" "tests/product/*.test.ts"        # 94/94
# 全量 CI 集见 IMPLEMENTATION_RESULT_G1G7.md §8                                # 337/337
```

---

## 8. 实验纪律声明

- 未修改任何实现逻辑；工作区受控改动仍只有实现者的 5 个文件（`README.md`、`README.en.md`、`packages/cli/src/{commands,index}.ts`、`tests/release-hardening/lifecycle.e2e.test.ts`）+ 新增 `tests/e2e/cli-exit-codes.e2e.test.ts`。
- 唯一临时破坏（测试断言变异）已**逐字节还原**，SHA256 复核一致，残留检索为空。
- 涉及真实 home 的操作全部为只读（`doctor` / `detect` / `status`）；一切 install/uninstall 实验均在 `mkdtemp` 出来的 fake home 上完成，未触碰本机真实配置（实验前已确认本机 `~/.claude/settings.json` 无 RiskGuard PreToolUse 接线，`doctor` 的 FAIL 是真实状态）。
- 临时实验目录（纯净旧版副本、fake home）已按回收站规则清理；本 Evaluator 未删除任何用户文件。
