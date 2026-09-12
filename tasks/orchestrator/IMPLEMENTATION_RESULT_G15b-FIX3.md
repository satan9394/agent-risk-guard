# IMPLEMENTATION_RESULT — G15b-FIX3（多行第 2 行起漏脱敏 + 跨端发散）

- 实现者：**Implementer（本轮）**，依据 `FIX_BRIEF_G15b-FIX3.md` + `EVALUATION_RESULT_G15b-FIX2.md`（第四次复验 REJECT，§4 为缺陷）
- 日期：2026-09-12
- **我不宣布成功**：下文全部为**自测原始输出**的可复现摘要，独立复验请以 `tasks/orchestrator/_g15bfix3_*` 证据文件为准。

## 0. 本轮范围

只修 1 个 P0：**命令词锚点里的 `^` 在三端「处理单位」不同**（core/ps1 整串跑正则 → `^` = 字符串开头；sh 逐行 sed → `^` = 行首），
导致多行命令**第 2 行起**的 `mysql -p<数字>` / `curl|wget --user u:p` 在 core/ps1（含生产出口）明文泄漏、sh 却脱敏 → 跨端发散。
**未回退** R1 / R2 / F1 / F2 / R3 / R4。判定面一行未改（`CHANGED=0`，§5）。

---

## 1. 改动逐条对照（可指代码行）

| # | 文件 | 改动前坐标 → 现坐标 | 改前 | 改后 |
|---|---|---|---|---|
| 1 | `agent-risk-guard/packages/core/src/redact.ts` | 任务卡 L129 → **现 L135**（`cli-mysql-password-numeric`） | `re: /(^\|[;&\|]\s*\|sudo\s+\|env\s+\|command\s+)(mysql\|mariadb)([^;&\|\n]*)(\s)-p[0-9]+/`**`gi`** | `re: /(`**`^\s*`**`\|[;&\|]\s*\|sudo\s+\|env\s+\|command\s+)(mysql\|mariadb)([^;&\|\n]*)(\s)-p[0-9]+/`**`gim`** |
| 2 | 同上 | 任务卡 L146 → **现 L155**（`cli-basic-auth-user`） | `re: /(^\|[;&\|]\s*\|sudo\s+\|env\s+\|command\s+)(curl\|wget)…/`**`g`** | `re: /(`**`^\s*`**`\|[;&\|]\s*\|sudo\s+\|env\s+\|command\s+)(curl\|wget)…/`**`gim`** |
| 3 | `agent-risk-guard-audit/scripts/dangerous-commands.ps1` | 任务卡 L96 → **现 L100** | `re = '`**`(?i)(^`**`\|…)(mysql\|mariadb)…'` | `re = '`**`(?im)(^\s*`**`\|…)(mysql\|mariadb)…'` |
| 4 | 同上 | 任务卡 L102 → **现 L108** | `re = '(^`**`\|…)(curl\|wget)…'` | `re = '(?m)(^\s*`**`\|…)(curl\|wget)…'` |
| 5 | `agent-risk-guard-audit/scripts/dangerous-commands.sh` | 任务卡 L71 → **现 L75** | `REDACT_ANCHOR="(`**`^`**`\|[;&\|][[:space:]]*\|…)"` | `REDACT_ANCHOR="(`**`^[[:space:]]*`**`\|[;&\|][[:space:]]*\|…)"` |

**改法说明（两条，缺一不可）**

1. **行首标志**：core 加 `m`、ps1 加内联 `(?m)`（≡ `[System.Text.RegularExpressions.RegexOptions]::Multiline`）。
   core 的 `redactDetails()` 用 `new RegExp(rule.re.source, rule.re.flags)` 重建正则（`redact.ts` L182），`m` 随 flags 一起带过去；
   ps1 用**内联** `(?m)` 而非给 `[regex]::Replace` 全局加选项，是为了与 core「逐规则同粒度」一一对应（其余规则不带 `m`，语义不变）。
   sh 的 sed **逐行**处理，`^` 本就是行首 → 无需改动，只需与 core/ps1 语义对齐（已在 L71–74 写明该不变量）。
2. **起点分支写 `^\s*` / `^[[:space:]]*` 而非 `^`**：覆盖**缩进续行**（`if …; then\n  mysql -p…`）。
   > ⚠️ 这是我在任务卡处方（仅「加 m」）之上的**一步扩展**，因为只加 `m` 会留下一处**未被修掉的 FIX2 回归**：
   > `rm -rf /tmp/t\n   mysql -p12345678`（缩进续行）在 core/ps1/sh **三端全漏**（sh 的 `^` 后面跟着空格也匹配不到），
   > 而 pre-FIX2 冻结副本是**脱敏**的 → 仍是「明文泄漏型新回归」；`;\n   mysql -p…` 更会**继续跨端发散**。
   > 证据见 §2.3（三列对照，FIX2 态该载荷 4/4 端点明文，FIX3 态 0/4）。

**未动**（任务卡明确要求）：
- `cli-basic-auth-u`（core L143 / ps1 L103 / sh L101）用的 `(^|[^-A-Za-z0-9_])`：换行符本身就属于 `[^-A-Za-z0-9_]`，
  整串引擎在行首也能命中（消费 `\n` 再原样回填），与 sh 的逐行 `^` **等价** → 按处方不动。
- 通用 `cli-mysql-password`（core L116 / ps1 L93 / sh L99）：同上，三端等价。
- `--user` 的「密码段须含非数字」守卫、`docker exec … mysql` 等已知取舍：按任务卡不动。

---

## 2. 基线对照（D8）

### 2.1 五端总账（20 条载荷 × 5 端；core / ps1 函数 / sh 函数 / ps1 生产出口 / sh 生产出口）

证据：`_g15bfix3_ends.txt`（逐条 in/core/ps1Fn/shFn/ps1Prod/shProd 六行）、`_g15bfix3_ends_summary.txt`

| 集合 | DIVERGE | 明文端点（含真密钥的载荷） |
|---|---|---|
| **AFTER（G15b-FIX3 现行主源）** | **0 / 20** | **0** |
| BEFORE（G15b-FIX2 **冻结改前字节副本** `_g15bfix2_baseline/*.before`） | 18 / 20 | 5 |

### 2.2 缺陷载荷三列对照（pre-FIX2 冻结 / FIX2 重建 / FIX3 现行）

证据：`_g15bfix3_fix2_vs_fix3.txt`
> 说明：FIX2 的字节副本在本轮同步副本时被覆盖，故 **FIX2 态由「现行主源回退本轮 3 处改动」重建**（重建替换式写在 `tasks/.tmp/g15bfix3/fix2-reconstruct.mjs`，可复核）；
> **pre-FIX2 列用的是冻结字节副本**（`_g15bfix2_baseline/dangerous-commands.ps1.before` = `EA253D10…`、`.sh.before` = `7C379CB5…`）。

| 载荷 | pre-FIX2（冻结） | **FIX2（重建）** | FIX3（现行） |
|---|---|---|---|
| `rm -rf /tmp/t` ⏎ `mysql -p12345678 -e "select 1"` | ps1/sh 全 `[REDACTED]` | **core 明文、ps1Fn 明文、ps1Prod 明文**；sh 脱敏 → **明文端点 2/4 + 残留 core** | 五端全 `[REDACTED]`，**逐字一致** |
| `rm -rf /tmp/t` ⏎ `curl --user alice:hunter2 https://x` | 全 `[REDACTED]` | **core/ps1Fn/ps1Prod 明文**（`hunter2` 泄漏）；sh 脱敏 | 五端全 `[REDACTED]`，逐字一致 |
| `echo start` ⏎ `mysql -p12345678 -e "select 1"` ⏎ `rm -rf /tmp/t`（**编排者复现载荷**） | 全 `[REDACTED]` | **core/ps1Fn/ps1Prod 明文** | 五端全 `[REDACTED]`，逐字一致 |
| 第 1 行对照 `mysql -p12345678 -e "select 1"` ⏎ `rm -rf /tmp/t` | 全脱敏 | 全脱敏（对照：第 1 行无缺陷） | 全脱敏 |
| `rm -rf /tmp/t` ⏎ `   mysql -p12345678 -e "select 1"`（缩进续行） | 全脱敏 | **4/4 端点明文**（含 sh） | 五端全 `[REDACTED]`，逐字一致 |

**结论（D8）**：缺陷确为 **FIX2 新引入**（pre-FIX2 冻结副本对同载荷是脱敏的），FIX3 修回且三端逐字一致。

### 2.3 为什么必须加 `^\s*`（扩展处方的唯一理由）

FIX2（重建）对「缩进续行」是 **4/4 端点明文**、`;\n   mysql -p…` 还跨端发散；只加 `m` 不改起点分支时，这两个形态**仍然**如此
（第一次探针实测：`E1 多行·缩进续行` core=LEAK/shFn=LEAK/shProd=LEAK，`E2` 三端不一致）。
加 `^\s*` / `^[[:space:]]*` 后两者均 **AGREE**（`_g15bfix3_ends.txt` 第 152/160 行）。

---

## 3. 九套回归（全部实跑）

| 套件 | 命令/入口 | 结果 |
|---|---|---|
| node 全量 | `node --test packages/*/test/*.test.ts tests/*/*.test.ts`（cwd=agent-risk-guard） | **exit=0，`ℹ tests 378 / pass 378 / fail 0`**（FIX2 时 376，+2 = 本轮新增的 2 个 test） |
| core redact 单测 | `node --test packages/core/test/redact.test.ts` | **exit=0，15/15**（含新增 G15b-FIX3 test） |
| core 跨端 parity | `node --test packages/core/test/redact-parity.test.ts` | **exit=0，A/B/C 全绿** |
| ps1 `hook-rules-test.ps1` | `powershell.exe -File` | **exit=0，37/37** |
| ps1 `hook-fp-regression.ps1` | 同上 | **exit=0，8/8** |
| ps1 `hook-bypass-regression.ps1` | `pwsh`（7.6.6） | **exit=0，20/20**（与 FIX2 口径一致；`powershell.exe` 下为 18/18，该套件本就有 2 条 pwsh 专属用例） |
| ps1 `hook-audit-reregress.ps1` | `powershell.exe -File` | **exit=0，`PASS: 59/59`** |
| ps1 `hook-redact-test.ps1` | 同上 | **exit=0，`PASS: 119/119`**（FIX2 时 108；+11 = d8×5 + d9×5 + c15×1） |
| sh `sh-hook-test.sh` | `wsl.exe -e bash` | **exit=0，`PASS: 67/67`** |
| sh `sh-audit-edge.sh` | 同上 | **exit=0，`TOTAL: 40 PASS: 40 FAIL: 0`** |
| sh `sh-audit-bypass.sh` | 同上 | **exit=0，`TOTAL: 192 PASS: 192 FAIL: 0 / ALL PASS`** |

证据：`_g15bfix3_suites.txt`、`_g15bfix3_sh_suites.txt`（原始输出含各套尾部）。

---

## 4. 变异测试（D6：打**生产路径**）

证据：`_g15bfix3_mutation.txt`（变异体写在 `%TEMP%\g15bfix3-mut-*`；主源跑前跑后 sha 一致 = 未改动）

| 变异体 | 变的是什么（生产路径） | exit | PART A | PART B | PART C | 失败处数 |
|---|---|---|---|---|---|---|
| BASELINE（真实主源） | — | 0 | PASS | PASS | PASS | 0 |
| **M2-sh** | `redact_cmd()` 去掉 `redact_text` 调用（生产出口直通） | 1 | PASS | **FAIL** | PASS | **33 处**（含 `sh 生产出口**明文泄漏** "correct horse battery staple"`） |
| **M4-sh** | `redact_cmd()` 恢复旧 `tr '\n' ' '` 折叠 | 1 | PASS | **FAIL** | PASS | **3 处**（正是 3 条多行 deny 语料） |
| M2-ps1 | `Redact-Secrets` 直通 | 1 | **FAIL** | **FAIL** | **FAIL** | A 17 处 / B 33 处 / C… |

**「同一变异体下 PART A 绿、PART B 红」= 生产出口确实被闸门钉住（F2 未回退）。**
M4 红的 3 处恰为多行语料（1 条旧 + 2 条本轮新增），说明**新增语料是有效闸门**。
M2-sh 由 FIX2 的 27 处升到 33 处 = 本轮新增的 2 条多行 deny 语料各贡献 3 处。

---

## 5. 判定零改动（CHANGED=0）

证据：`_g15bfix3_decision_diff.txt`
- BEFORE = 冻结改前字节副本（ps1 `EA253D10…` / sh `7C379CB5…`）、AFTER = 现行主源；真实 spawn + 进程 stdin。
- 语料 **97 条 × 2 端 = 194 次判定对比**（含所有多行性载荷、缩进续行、`;\n   mysql -p…`、R1/R2 全部正反例）
- **`DECISION-DIFF: total=194 CHANGED=0`**。

---

## 6. 副本同步与 D9（BOM）/行尾/distinct

证据：`_g15bfix3_copies.txt`（同步后逐份实测）

| 端 | 份数 | 路径 | SHA256(前16) | 大小 | BOM | CR / LF | distinct |
|---|---|---|---|---|---|---|---|
| ps1 | **6/6** | `agent-risk-guard-audit/scripts/`、`agent-risk-guard/assets/hooks/`、`agent-risk-guard/skills/agent-risk-guard/scripts/`、`~/.claude/hooks/`、`~/.codex/hooks/`、`~/.gemini/config/hooks/` | `FB85CC0E4476AE58` | 34523 B | **True** | CR=0 / LF=549 | **1** |
| sh | **3/3** | `agent-risk-guard-audit/scripts/`、`agent-risk-guard/skills/agent-risk-guard/scripts/`、`agent-risk-guard-audit-xhs-publish/scripts/` | `5560674677AFB348` | 24928 B | False | CR=0 / LF=392 | **1** |

**D9 实录（必须记一笔）**：用编辑工具写回 ps1 **确实丢了 BOM**——第一次跑探针时 ps1 直接语法崩溃
（`Unexpected token 'shell'…`、GBK 乱码，见 §8 的失败记录）。本轮在**所有 ps1 编辑完成之后**用
`tasks/.tmp/g15bfix3/ensure-bom.mjs` 补回 BOM 并逐份复核（**主源 + 5 份副本 6/6 BOM=True**），
`hook-redact-test.ps1` 同样补回（BOM=True，12246 B）。**同步后未再改主源**（见 §9 哈希）。

主源/测试文件收工哈希（§9 复核用）：`redact.ts` `20CFCED93AB45043`、`redact.test.ts` `8971B5D9DE4D0B7E`、
`redact-parity.test.ts` `B3F47F61C4576BF5`、`hook-redact-test.ps1` `35730BC33B82E26B`（BOM=True）。

---

## 7. 语料扩容（缺陷正是从这里溜过）

| 文件 | 新增 | 说明 |
|---|---|---|
| `packages/core/test/redact.test.ts` | +1 test（`redact/G15b-FIX3`） | 6 条多行正例（第 2 行 `-p<数字>` / `--user` / `wget` / `mariadb` / **缩进续行**）+ 2 条第 1 行对照的**逐字断言** + 2 条「跨行不得命中他命令」反例 |
| `packages/core/test/redact-parity.test.ts` | **PART B** +2 条多行 deny 语料；**新增 PART C**（19 条多行整串语料） | PART B：`'rm -rf /tmp/t\nmysql -p12345678 -e "select 1"'`（明文串 `12345678`）、`'rm -rf /tmp/t\ncurl --user alice:hunter2 https://x'`（明文串 `hunter2`），断言两端生产出口与 core **逐字相等**。**PART C 的存在理由**：PART A 的驱动器是**逐行**切分（`foreach line` / `while read line`），多行语料进不了 PART A；PART C 用 ps1 `-RedactFile` 读整文件、sh `--redact-stdin` 读整 stdin，直接钉「多行下三端脱敏函数逐字一致」 |
| `tests/hook-redact-test.ps1` | +3 用例（d8 / d9 / c15） | d8/d9 = **多行第 2 行含真密钥**的 deny 生产出口；c15 = 多行**反向** no-fp（跨行不得命中他命令）。检查数 108 → **119** |

> 既有唯一一条多行语料的第 2 行是 `mysql -e "select 1"`，**不含** `-p<数字>`、也不含 `--user` —— 锚定规则一次都没被行使，这正是闸门失明的结构性原因。

---

## 8. 自查：还有没有别的规则依赖 `^` / `$` / `\n` 且三端「处理单位」不同

| 规则 | 三端写法 | 处理单位 | 判定 |
|---|---|---|---|
| `cli-mysql-password`（core L116 / ps1 L93 / sh L99） | `(^\|[^-A-Za-z0-9_])-p…` | 整串 vs 逐行 | **等价，无需改**：换行符本身落在 `[^-A-Za-z0-9_]` 里，整串引擎在行首位置由该分支命中、把 `\n` 记进 `$1` 再原样回填 → 与 sh 逐行 `^` 输出一致（多行载荷 B11 五端 AGREE） |
| `cli-basic-auth-u`（core L143 / ps1 L103 / sh L101） | `(^\|[^-A-Za-z0-9_])-u…` | 同上 | **等价，无需改**（B12 五端 AGREE） |
| `cli-mysql-password-numeric` / `cli-basic-auth-user` | **本轮已修** | 同上 | ✅ 已对齐（§1） |
| `pem-private-key`（core L85 / ps1 L88 / sh L90 + `redact_cmd` 的 `\002` 通道） | core/ps1 `[\s\S]*?`；sh `[^-]*` 走跨行补脱敏 | 整串 vs 逐行（+显式跨行通道） | **等价**：PART C 的多行 PEM 用例三端逐字一致 |
| **判定侧**（不属脱敏，本轮未动） | ps1 统一写 `(?:^\|[;&\|\r\n])\s*`（**显式含 `\r\n`**）；sh 用逐行 `grep -E '${CMD_SEG}…'`，`CMD_SEG='(^\|[;&\|])[[:space:]]*'` | 整串 vs 逐行 | **等价**：sh 的 `^` = 行首，正是 ps1 `^\|[;&\|\r\n]` 的逐行形式。**脱敏锚点此前漏 `\n` 正是与这个既有正确范式不一致** → 本轮按同一范式补齐（`m` 使 `^` = 行首） |
| `$` 右锚定 | 三端密钥规则表**均未使用** `$`（仅判定侧有 `git checkout --(\|$)` 等） | — | 不涉及 |

**本轮新增的防复发不变量（写进代码注释）**：`dangerous-commands.sh` L71–74、`redact.ts` L120–128 / L141–155、
`dangerous-commands.ps1` L94–108 —— 「凡含 `^`/`$`/`\n` 的规则，改动前必须用**多行载荷**跑三端 parity（PART B/C）」。

---

## 9. 未解决问题 / 范围外（如实标注）

1. **`agent-risk-guard-audit-xhs-publish/scripts/dangerous-commands.ps1` 未同步**（`0B836D6D…`，21466 B / 400 行）：
   它不在任务卡冻结的「ps1 六份」清单内，且是**另一代（更小/更旧）的变体**，不是本 hook 的副本 → 未动。若它是分发面，请下轮明确纳入。
2. **`agent-risk-guard/skills/agent-risk-guard/tests/hook-redact-test.ps1` 仍是旧版**（上一轮复验已记录）：
   测试文件不在任务卡冻结的副本清单（清单只列 `dangerous-commands.{ps1,sh}`）→ 本轮未同步。
3. **已知取舍（任务卡明示本轮不动）**：`docker exec db mysql -p…`、`/usr/bin/mysql -p…`、`curl --user alice:123456`（全数字长参守卫）、
   `mysql -p 12345678`（`-p` 与值之间有空格）、`(mysql -p12345678)` 吃右括号 —— 均维持现状。
4. **我未做的事**：没有跑真实 Agent 端到端；副本同步后未再改主源（§6 哈希可复核）；未清理任何真实日志
   （跑真实生产出口会向 `%TEMP%\riskguard-hook-calls.log` 追加行，与官方 parity 测试同款行为）。

---

## 10. 证据文件（`tasks/orchestrator/`）

| 文件 | 内容 |
|---|---|
| `_g15bfix3_ends.txt` | 五端 × 20 条载荷逐条台账（AFTER + BEFORE 两段，含每条 in/core/ps1Fn/shFn/ps1Prod/shProd） |
| `_g15bfix3_ends_summary.txt` | 同上汇总（`AFTER: DIVERGE=0 LEAK=0` / `BEFORE: DIVERGE=18 LEAK=5`） |
| `_g15bfix3_fix2_vs_fix3.txt` | **pre-FIX2（冻结）/ FIX2（重建）/ FIX3（现行）三列对照**（D8 决定性证据） |
| `_g15bfix3_suites.txt` | 九套回归之 node + ps1 五套（原始输出尾部） |
| `_g15bfix3_sh_suites.txt` | sh 三套（67/67、40/40、192/192 ALL PASS） |
| `_g15bfix3_mutation.txt` | M2-sh / M4-sh / M2-ps1 变异（生产路径）+ 基线 + 主源哈希未变 |
| `_g15bfix3_decision_diff.txt` | `CHANGED=0`（194 次判定对比） |
| `_g15bfix3_copies.txt` | 副本表（哈希/BOM/CR-LF/distinct） |

复现脚本（`agent-risk-guard/tasks/.tmp/g15bfix3/`）：`ends-probe.mjs`、`fix2-reconstruct.mjs`、`mutation.mjs`、
`decision-diff.mjs`、`ensure-bom.mjs`、`run-all-suites.ps1`、`run-sh-suites.ps1`。
