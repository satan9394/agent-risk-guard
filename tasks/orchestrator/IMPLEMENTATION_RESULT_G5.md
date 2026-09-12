# IMPLEMENTATION_RESULT_G5 — sh hook 失败语义与 JSON 合法性（fail-open → fail-closed）

- 实施：Implementer（本轮），2026-09-12
- 依据：`IMPLEMENTATION_BRIEF_G5.md`（**以文末「Round 258 更新」为准**）
- 范围：**只做 sh 的失败语义与 JSON 合法性**；判定规则段、G3 跨端分歧、`-p`/`--user`/PEM 锚点规则**零改动**；**未触碰 ps1**（D9 不适用）
- **本报告不宣布成功**，只提交证据；是否 ACCEPT 由编排者/验收方判定

## 0. 一句话结论

sh hook 在异常路径的**静默放行 / 非法 JSON / 裸 exit 1** 已改为与 ps1 同义的 **deny JSON + exit 0**；
新增 34 条回归闸门（含 5 条目标异常路径 + D7 邻居面）；三棵树四套 sh 全绿，parity A/B/C 全绿，node 全量 378/378，
4 组变异（含 G15b-FIX3 红线 M2）全部按预期变红。

---

## 1. §改动逐条对照（可指代码行）

被改文件：`agent-risk-guard-audit/scripts/dangerous-commands.sh`
（24928 B / 392 行 / SHA256 `5560674677AFB348…` → **30296 B / 476 行 / `7F7769F2175C6D88…`**）

| # | 位置（改后行号） | 改动内容 | 对应缺陷 |
|---|---|---|---|
| 1 | L20–L25 | 文件头新增 G5 变更记录 `[F1][F2][F3]` | 记录 |
| 2 | **L113–L180（整块上移）** | `redact_cmd()`(L124) / 新增 `json_escape_text()`(L143) / `deny_command()`(L172) 从「读取 stdin 之后」搬到**之前**——旧位置下空输入、畸形 JSON 两条路径在函数定义前就 `exit 0` 返回，根本够不着 deny 出口 | fail-open 结构根因 |
| 3 | L136 | `redact_cmd()` 步骤 3 由「`sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\r/\\r/g'` + awk 只补 `\n`」改为调用 `json_escape_text "$safe"` | **[F2] 命令含 TAB → deny JSON 非法** |
| 4 | L143–L170 | 新增 `json_escape_text()`：POSIX awk 逐字符转义 `\`、`"` 与**全部 C0 控制字符 U+0001–U+001F**（`\b \t \n \f \r` + 其余 `\uXXXX`）；换行仍写 `\n` 转义（守 G15b-FIX2「不折叠换行」不变量） | [F2] |
| 5 | L189–L192 | 预置 `cmd=""`、`tool_name=""` 后再 `inputJson=$(cat 2>/dev/null \|\| true)`；**删除**旧 L116 `if [ -z "$inputJson" ]; then exit 0; fi` | **[F1] 空 stdin 无输出放行** |
| 6 | L200–L245 | 新增输入状态机：单次 python3 调用输出单行两字段 `状态<TAB>tool_name`（`OK` / `NO_TI` / `NO_CMD` / `NOT_OBJ` / `PARSE_ERR`），tool_name 内的 TAB/换行折叠为空格；python3 崩溃或无输出 → 归 `PARSE_ERR`（fail-closed）。无 python3 时 `p_status=GREP`（L243）走 grep 回退 | [F1] |
| 7 | L247–L253 | `PARSE_ERR` → `deny_command`（空输入给专门文案「hook 收到空输入（未提供命令）」） | **[F1] 空 stdin / 畸形 JSON 放行** |
| 8 | L263–L266 | shell 类工具的 `NO_TI` / `NO_CMD` → `deny_command "…缺少 command 字段"` | **[F1] 旧路径裸 exit 1** |
| 9 | **L282** | cmd 的 grep 回退补 `\|\| true` | **exit-1 根因**：旧 L165 无保护，grep 无匹配返回 1，`set -euo pipefail` 直接中止脚本（实测 exit=1、无输出） |
| 10 | L284–L287 | shell 工具但 command 为空/仅空白 → `deny_command "…的 command 为空"` | [F1] 旧 `exit 0` 放行 |
| 11 | **L298–L305** | 纯注释放行改为「**整串**第一个非空白字符是 `#`」：`case "$(printf '%s' "$cmd" \| tr -d '[:space:]' \| cut -c1)" in '#') exit 0`；删除旧的 `case "$cmd" in ' '*\|'#'*)` + **逐行** `grep -qE '^[[:space:]]*#'` | **[F3] 首行危险 + 次行 `#` 提前放行** |
| 12 | 删除旧 L126–L140 `extract_field()` | 唯一调用点即 tool_name 提取，已被状态机取代；grep 回退能力保留在 L244。**无行为变化** | 重构 |
| 13 | L307 起（规则段 1)–18)） | **零改动**（逐条比对：判定正则、`deny_command` 文案、`CMD_SEG`、`cmdtest` 全未动） | 红线 2/4 |

**范围核验（机械）**：`_g5_scope_check.txt` —— 从 `# ---- 命令边界匹配` 到 EOF 的**规则段 170 行逐字节一致**（before/after 同为 `sha256 3350ad9370e13de6`）；文件头差异仅为 G5 变更记录 6 行插入。全部改动落在 L20–L25、L113–L180、L189–L305 三处。

被改测试：`agent-risk-guard-audit/tests/sh-audit-bypass.sh`
| 位置 | 改动 |
|---|---|
| L298–L321 | §16b/16c **期望反转**：原「fail-open（放行）」现状记录 → 按 ps1 语义断言 **deny 且 exit=0**（同时校验 exit code，覆盖 exit-0 契约） |

新增测试：`agent-risk-guard-audit/tests/sh-failclosed-test.sh`（119 行，34 例；见 §3）

---

## 2. §5 条目标异常路径 before/after 实证（D8 并列）

真实 spawn + 进程 stdin：sh 走 `wsl.exe -e bash`（D6），ps1 走 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File`。
证据：`_g5_before_probe.txt` / `_g5_after_probe.txt` / `_g5_decision_parity.txt`。

| # | 场景 | before（sh） | after（sh） | ps1（目标） | 一致 |
|---|---|---|---|---|---|
| ① | 空 stdin | exit=0 **无输出（放行）** | **exit=0 deny（合法 JSON）** | exit=0 deny | ✅ |
| ② | 非法 JSON `{not json` | exit=0 **无输出（放行）** | **exit=0 deny** | exit=0 deny | ✅ |
| ③ | 缺 `command` 字段 | **exit=1 无输出**（grep 回退 → `set -e` 中止） | **exit=0 deny** | exit=0 deny | ✅ |
| ④ | 命令含 TAB | exit=0 **非法 JSON**（`JSON.parse` 失败） | **exit=0 deny（合法 JSON）** | exit=0 deny | ✅ |
| ⑤ | 首行危险 + 次行 `#` | exit=0 **无输出（放行）** | **exit=0 deny** | exit=0 deny | ✅ |
| — | 对照组：正常危险命令 | exit=0 deny | exit=0 deny（不变） | exit=0 deny | ✅ |

**判定零变化 / 跨端一致**（`_g5_decision_parity.txt`）：
- 既有语料（parity `CORPUS` 35 + `DENY_CORPUS` 12 = 43 条）sh(pre-G5) vs sh(post-G5)：**CHANGED=0**
- sh(post-G5) vs ps1（43 条既有语料 + 11 条畸形输入 = 54 条）：**DIFF=0**，exit 全部为 0

**JSON 合法性专项**：含 TAB / CR / `"` / `\` / `\u0001` / 换行的命令，deny 输出全部 `JSON.parse` 成功（新闸门 G5-B 组 6 例全绿；pre-G5 同 6 例中 4 例 `Invalid control character`）。

---

## 3. §sh 三套 + parity A/B/C 回归数字

四套 × 三棵树（各自用**自己的脚本副本 + 自己的测试副本**，`_g5_suites_all.txt`）：

| 套件 | agent-risk-guard-audit | skills/agent-risk-guard | audit-xhs-publish |
|---|---|---|---|
| `sh-hook-test.sh` | 67/67 exit=0 | 67/67 exit=0 | 67/67 exit=0 |
| `sh-audit-edge.sh` | 40/40 exit=0 | 40/40 exit=0 | 40/40 exit=0 |
| `sh-failclosed-test.sh`（**新增**） | 34/34 exit=0 | 34/34 exit=0 | 34/34 exit=0 |
| `sh-audit-bypass.sh` | **192/192 ALL PASS** | 192/192 ALL PASS | 192/192 ALL PASS |

三棵树 hook sha256 前 16 位均 `7f7769f2175c6d88`。

- **parity A/B/C**：`node --test packages/core/test/redact-parity.test.ts` → **exit=0，pass 3 / fail 0**（`_g5_parity_after.txt`）
- **node 全量**：`node --test "packages/*/test/*.test.ts" "tests/*/*.test.ts"`（cwd=agent-risk-guard）→ **exit=0，tests 378 / pass 378 / fail 0**（与 G15b-FIX3 的 378 持平，无回归）
- **新闸门覆盖**（34 例）：G5-A 异常输入 8 例（空/空白/畸形×2/缺 tool_input/缺 command/空串/全空白）；G5-B 控制字符 6 例（TAB×2、CR、引号+反斜杠、`\u0001`、多行）；G5-C 多行整条评估 4 例；G5-D D7 邻居面 16 例（`#` 在中间/末尾、TAB 在引号内、command 空串、命令末尾带换行、非 shell 工具、缺 tool_name、合法 JSON 非对象、正常 allow×5、正常 deny×2）

### 变异验证（D8：回退修复 → 闸门必红）— `_g5_mutation_result.txt` / `_g5_mutants/`

| 变异体 | 回退了什么 | 新闸门结果 | 67 / 40 套 | 结论 |
|---|---|---|---|---|
| M1-failopen-empty-json | 空 stdin / 畸形 JSON 恢复 `exit 0` 放行 | **exit=1，30 PASS / 4 FAIL** | 67/67、40/40 | 红 ✅ |
| M2-json-escape-tab | 删掉 C0 控制字符转义分支（TAB 原样输出） | **exit=1，29 PASS / 5 FAIL** | 67/67、40/40 | 红 ✅ |
| M3-comment-per-line | 纯注释放行恢复逐行锚点 | **exit=1，32 PASS / 2 FAIL** | 67/67、40/40 | 红 ✅ |
| **M4-redact-passthrough（红线 G15b-FIX3）** | `redact_cmd()` 去掉 `redact_text`（生产出口直通） | parity PART B **exit=1，明文泄漏 11 处** | 新闸门仍 34/34 绿 | **红 ✅ 红线守住** |

补充 before/after（同一套闸门）：
- 新闸门 vs **pre-G5 主源**（`_g5_failclosed_before.txt`）：**20 PASS / 14 FAIL**；vs post-G5：**34/34**
- 改后期望的 192 套 vs pre-G5 主源（`_g5_before_bypass_newtest.txt`）：**190 PASS / 2 FAIL**（正是 16b/16c）；vs post-G5：192/192
- 192 套 vs pre-G5 主源 + 改前期望（`_g5_before_bypass.txt`）：192/192（如实记录「改前基线」）

### 无 python3 回退路径（不能破坏 #4）— `_g5_nopython.txt`

用 `PATH=/tmp/g5_nopy`（仅 bash/cat/tr/sed/grep/head/cut/awk，`python3` 不可见）实测：

| 载荷 | before(sh) | after(sh) |
|---|---|---|
| 缺 command 字段 | **exit=1 → 放行** | **exit=0 → deny（command 为空）** |
| 正常危险命令 | exit=0 deny | exit=0 deny（不变） |
| 正常 allow / 非 shell 工具 | allow | allow（不变） |
| 畸形 JSON（无 tool_name 可抓） | allow | allow（**未放宽**，见 §5-1） |

---

## 4. §副本表（含 BOM / 行尾）— `_g5_copies.txt`

| 角色 | 路径 | sha256(16) | 大小 | BOM | CR / LF |
|---|---|---|---|---|---|
| sh 主源 | `agent-risk-guard-audit/scripts/dangerous-commands.sh` | `7F7769F2175C6D88` | 30296 | **False** | 0 / 476 |
| sh 副本① | `agent-risk-guard/skills/agent-risk-guard/scripts/dangerous-commands.sh` | `7F7769F2175C6D88` | 30296 | **False** | 0 / 476 |
| sh 副本② | `agent-risk-guard-audit-xhs-publish/scripts/dangerous-commands.sh` | `7F7769F2175C6D88` | 30296 | **False** | 0 / 476 |
| ps1（**未改**） | `agent-risk-guard-audit/scripts/dangerous-commands.ps1` | `FB85CC0E4476AE58` | 34523 | **True** | 0 / 549 |
| 测试副本 `sh-audit-bypass.sh` ×3 | audit / skills / xhs | `8971C292A30F2CE3` | 18292 | False | 0 / 411 |
| 新增 `sh-failclosed-test.sh` ×3 | audit / skills / xhs | `ED1A8253DC5DC45E` | 6939 | False | 0 / 119 |

- **sh hook 副本 distinct = 1** ✅（A→B 两份均由主源整文件复制，逐字节一致）
- 交付顺序遵守：**改 → 测 → 同步副本 → 复核 distinct/BOM/行尾 → 最后写本报告**；同步后未再改主源（主源 mtime `2026-09-12 00:18:48` = 副本 mtime）
- D9：**本轮未改 ps1**，故未重新写 BOM；复核仍为 `BOM=True`（未被任何编辑工具破坏）
- 测试副本同步说明：为避免另两棵树的 192 套因新代码变红，`sh-audit-bypass.sh`（改后期望）与新增 `sh-failclosed-test.sh` 一并同步到 skills / xhs 两棵树的 `tests/`（同步前 3 份 `sh-audit-bypass.sh` 本已 distinct=1）。若不希望同步测试，可单独回退这 4 个文件（.sh 逻辑不受影响）。

---

## 5. §未解决问题（残余风险，均**未被本轮放宽**）

1. **无 python3 + 抓不到 tool_name 的畸形输入仍放行**（`p_status=GREP` 分支）。grep 无法判定「JSON 是否是对象」，为与 ps1 L200 的「无 tool_name → 放行」保持一致而保留；**与 pre-G5 行为相同，未放宽**。有 python3（WSL/Git Bash 生产形态）时该路径不可达。
2. **首行是注释时整条命令放行**：`# note\nrm -rf /tmp/t` → sh allow。**ps1 同形**（ps1 L215 `^\s*#` 只看整串开头），属**既有判定语义**；按范围纪律（不改判定规则、不与 ps1 产生新分歧）本轮不动，已作为 D7 邻居钉进测试防回归。
3. **合法 JSON 但非对象 / 缺 tool_name** → allow。与 ps1（`$data.tool_name` 为空 → `exit 0`）逐条对齐，非本卡范围。
4. **空白类字符集差异**：sh 用 POSIX `[[:space:]]`（ASCII），ps1 用 .NET `\s`（含 `U+00A0` 等 Unicode 空白）。形如 `\u00a0# x` 时 sh 会 deny 而 ps1 allow。**旧实现同样是 ASCII 类，未引入新分歧**；判定规则改动不在本卡范围。
5. **NUL 字节**：JSON `\u0000` 无法经 bash 变量/命令替换传递（NUL 被丢弃），两端都取不到该字符；未做特殊处理（不崩溃、不误判为危险/安全变化的路径）。
6. **TAB 之外的控制字符**已统一转义（含 `\u0001` 已验证）；`U+007F`（DEL）按 JSON 规范无需转义，保持原样（与 ps1 `ConvertTo-Json` 的宽松处理一致，未做逐字比对）。
7. **环境事件（与代码无关）**：实施中途 WSL 服务出现一次 `Wsl/Service/0x8007274c` 超时并把 distro 卡死，导致 1 次套件运行中断；`wsl --shutdown` 无 admin 不可用，通过结束僵死 `wsl`/`wslhost` 客户端恢复后**全部重跑**，最终数字均来自恢复后的运行。若编排者复跑时遇到同类超时，请先结束僵死 wsl 客户端再重试。
8. **agy（Antigravity）hooks 未核实**——按任务卡明示不在本卡范围。
9. 本轮**未**扩展 `redact-parity.test.ts` 的畸形输入语料（任务卡「验收标准 3」提出过三端畸形输入 parity）。理由：畸形输入属**决策**语义而非脱敏语义，已由新闸门 `sh-failclosed-test.sh` + `_g5_decision_parity.mjs`（54 条 sh-vs-ps1 判定对照，DIFF=0）覆盖；是否要把畸形输入并入 parity 文件属编排者裁量，如需可另开小卡（改动仅测试文件）。

---

## 6. 证据工件清单（`tasks/orchestrator/`）

| 工件 | 内容 |
|---|---|
| `_g5_before_probe.txt` / `_g5_after_probe.txt` | 6 场景 × (sh, ps1) 的 before/after 对照（真实 spawn） |
| `_g5_before/dangerous-commands.sh` | **pre-G5 主源冻结副本**（sha `5560674677AFB348` = G15b-FIX3 评审判定值，取自未同步的另两棵树副本） |
| `_g5_failclosed_before.txt` / `_g5_failclosed_after.txt` | 新闸门 34 例 before(20/14红) / after(34/34) |
| `_g5_before_bypass.txt` | 192 套 × pre-G5 主源（改前期望）= 192/192（改前基线） |
| `_g5_before_bypass_newtest.txt` | 192 套（改后期望）× pre-G5 主源 = 190/192（2 红 = 16b/16c） |
| `_g5_after_bypass.txt` | 192 套 × post-G5 主源 = 192/192 ALL PASS |
| `_g5_suites_all.txt` / `_g5_suites_all.sh` | 四套 × 三棵树一次性复跑 |
| `_g5_mutation_result.txt` / `_g5_mutations.mjs` / `_g5_mutants/*.sh` | 4 组变异（M1–M3 + 红线 M4）与变异体全文 |
| `_g5_decision_parity.txt` / `_g5_decision_parity.mjs` | 既有语料 CHANGED=0（43）、sh-vs-ps1 DIFF=0（54）、5 条目标路径三端对照 |
| `_g5_nopython.txt` / `_g5_nopy_probe.sh` | 无 python3 回退路径 before/after |
| `_g5_parity_after.txt` | redact parity A/B/C（pass 3 / fail 0） |
| `_g5_node_full.txt` | node 全量 378/378 |
| `_g5_copies.txt` | 副本 sha/BOM/行尾/distinct 表 |
| `_g5_awk_probe.sh` | `json_escape_text` 的 awk 转义器可行性验证（gawk 5.2.1） |
| `_g5_diff.txt` / `_g5_scope_check.txt` / `_g5_scope_check.sh` | 主源完整 diff（7 hunk）+ 规则段逐字节一致核验 |
