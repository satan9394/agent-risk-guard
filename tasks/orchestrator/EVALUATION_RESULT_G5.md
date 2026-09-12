# EVALUATION_RESULT_G5 — sh hook 失败语义与 JSON 合法性

- **验收者**：全新独立 Evaluator（不继承实现者/编排者推理上下文），预设立场「实现可能存在错误」
- **日期**：2026-09-12 · 时间盒 30 分钟
- **验收对象**：`agent-risk-guard-audit/scripts/dangerous-commands.sh` + `tests/{sh-hook-test,sh-audit-edge,sh-audit-bypass,sh-failclosed-test}.sh`（三棵树副本）
- **判定**：**ACCEPT**（附 4 项「非 REJECT 依据」的残留/分歧，详见 §4）

---

## 0. 方法与证据

全部为**自建 harness 的自跑输出**，未复用实现者的 `_g5_*` 脚本。

- 攻击面（D6）：**真实 spawn + 进程 stdin**。sh 走 `wsl.exe -e bash /mnt/e/.../dangerous-commands.sh`，ps1 走 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File`。未使用 Git Bash 路径。
- 对照面（D8）：`_g5_before/dangerous-commands.sh` = **git HEAD blob 逐字节同一**（两者 sha256 均为 `5560674677AFB348`，24928 B）→ 冻结基线可信，可用作 pre-G5。
- 邻居面（D7）：反向邻居（**本应放行却被拦**）47 条；变异一律打在**生产路径**（parity PART B 生产出口 / 真实 hook spawn），不改主源。
- 工件（隔离 TEMP，未写入交付树）：`E:\DeepSeek_Harness\workspace\2026_08_21\.eval-tmp\g5eval\`
  `g5_eval.mjs/.txt`（post 50 例）、`g5_eval_before.txt`（pre 50 例）、`g5_residual.txt`、`g5_nonstring.txt`、`g5_comment_neighbors.txt`、`suites.txt`、`matrix.txt`、`matrix2.txt`、`scope_check.txt`、`mut_tab.txt`。

---

## 1. 逐项判定

| # | 项 | 判定 | 关键自跑证据 |
|---|---|---|---|
| 1 | 原缺陷真修（5 条异常路径，真实 spawn） | **PASS** | 5/5 全部 `exit=0` + `JSON.parse` 成功 + `permissionDecision=deny`，且与 ps1 decision 一致 |
| 2 | 含 TAB 必须输出合法 JSON | **PASS** | 自造 14 条（TAB 在命令中/引号内/末尾、多 TAB、`\x01`、反斜杠、双引号、CR、`\u0000`、原始 TAB/换行字节）JSON 全合法；原始输出抽检含 `\t` 转义、无裸 TAB |
| 3 | 反向邻居（不得误拦合法调用） | **PASS** | 47 条反向邻居 **0 误拦**；与 ps1 仅 2 条分歧，且都在「非法 JSON」输入上（详见 §4-1） |
| 4 | 16b/16c 期望反转是否为掩盖回归 | **PASS** | 原期望**字面写着 fail-open 现状**；仅这 2 处改动，且为**加强**（新增 exit-code 断言） |
| 5 | G15b 不回退（M2/M4 变异） | **PASS** | parity 基线 3/3 绿；两个变异 PART B **均红** |
| 6 | 副本 / BOM / 行尾 / 规则段 | **PASS** | sh 3/3 distinct=1、BOM=False、CR=0；测试副本 3/3 一致；规则段 171 行 sha 前后同为 `3350ad9370e13de6` |
| 7 | 披露的残留逐条验证 | **PASS（含 1 条披露不成立）** | 见 §4 |

---

## 2. 关键自跑输出（摘录）

### 2.1 50 例矩阵 · post-G5 vs ps1（`g5_eval.txt`）

```
cases=50 decisionMatch=48 diverge=2 falseDeny(expect allow)=0
invalidJSON=0 nonzeroExit=0 emptyOutput=24
DIVERGENCES: C21 原始换行+安全命令 sh=deny ps1=(none) ; C22 原始 TAB+安全命令 sh=deny ps1=(none)
```

**post-G5 全 50 例：`invalidJSON=0`、`nonzeroExit=0`** —— exit-0 契约与 JSON 合法性达成。

A 组（5 条目标异常路径 + 5 条同族）与 B 组（14 条控制字符/引号载荷）**逐条**为：

```
[A1 空 stdin]        sh exit=0 JSON-OK deny | ps1 exit=0 JSON-OK deny
[A2 畸形 JSON]       sh exit=0 JSON-OK deny | ps1 exit=0 JSON-OK deny
[A3 缺 command 字段]  sh exit=0 JSON-OK deny | ps1 exit=0 JSON-OK deny
[A4 命令含 TAB]      sh exit=0 JSON-OK deny | ps1 exit=0 JSON-OK deny
[A5 首行危险+次行#]   sh exit=0 JSON-OK deny | ps1 exit=0 JSON-OK deny
[A6 对照:正常危险命令] sh exit=0 JSON-OK deny | ps1 exit=0 JSON-OK deny
[B1–B14 控制字符族]   全 sh exit=0 JSON-OK deny | ps1 exit=0 JSON-OK deny
```

原始 deny JSON 抽检（载荷 `rm -rf /tmp/t<TAB>extra"\`）：

```
JSON.parse = OK | 含 "\t" 转义 = true | 含裸 TAB = false
```

### 2.2 同一矩阵 · pre-G5（D8 并列，`g5_eval_before.txt`）

```
cases=50 decisionMatch=32 diverge=18 falseDeny=0
invalidJSON=7 nonzeroExit=2 emptyOutput=35
DIVERGENCES: A1,A2,A3,A4,A5,A7,A8,A9,A10,B1,B2,B3,B4,B5,B8,B11,B12,B14
```

→ 原缺陷**真实存在且已消除**：非法 JSON 7→0、裸 exit 1 2→0、与 ps1 分歧 18→2。

### 2.3 反向邻居（本应放行是否被误拦）

- 合法 JSON 正常路径 25 条（`git status` / `ls -la` / `echo hello` / `npm run build --prefix packages/core` / `git switch -c` / 多行安全命令 / 末尾换行 / CRLF / 前后空白）+ 注释邻居 9 条 → **post-G5 与 pre-G5 判定逐条一致，CHANGED=0，无误拦**。
- 真实调用形态「命令末尾带换行」：`git status\n`、`npm run build --prefix packages/core\n`、`ls -la\r\n` → **sh 与 ps1 全 allow**（本卡最大回归风险，未发生）。
- `tool_name=Read` + 危险命令、缺 `tool_name`、合法 JSON 非对象（`"hello"` / `[1,2,3]` / `{}`）→ **sh 与 ps1 逐条同判（allow）**。
- 空 `command` 字符串 / 全空白 → **sh 与 ps1 同为 deny**（pre-G5 sh 为 allow）。

### 2.4 期望反转的合法性（item 4，`matrix.txt` / `matrix2.txt`）

从 **git HEAD 直接取回 pre-G5 测试文件**（`bypass_HEAD.sh`，17874 B / `D73D58DC44258FB8`，LF），跑 2×2：

| 测试期望 × 被测源 | 结果 |
|---|---|
| **旧期望 × pre-G5** | **192/192 ALL PASS** ← 原期望确为 fail-open 现状记录 |
| 旧期望 × post-G5 | 190/192，2 FAIL，输出 `DENY on malformed JSON (should be allow for fail-open)` / `DENY on empty stdin (...)` |
| 新期望 × pre-G5 | 190/192，2 FAIL（正是 16b/16c） |
| 新期望 × post-G5 | **192/192 ALL PASS** |

`git diff HEAD -- sh-audit-bypass.sh` 显示**唯一改动就是 16b/16c 两块**，且改动方向是**加强**（新增 `[ "$rc" -eq 0 ]` exit-code 断言），其余 190 条断言语义逐字未动 → **不存在为掩盖回归而放宽测试**。

### 2.5 G15b 红线（item 5）

- 基线：`node --test packages/core/test/redact-parity.test.ts` → **pass 3 / fail 0**（A/B/C 全绿）。
- **变异 M2（`redact_cmd` 直通，去掉 `redact_text`）** → PARITY **PART B 红**：`33 !== 0`，dump 里可见 sh 生产出口**明文泄漏** `hunter2`、`12345678`，且无 `[REDACTED]`。
- **变异 M4（恢复 `tr '\n' ' '`）** → PARITY **PART B 红**：`7 !== 0`，多行语料 `rm -rf /tmp/t\nmysql -p12345678 …` 被折叠成单行并明文泄漏 `12345678`。
- 附加变异 C（`json_escape_text` 中 TAB 恢复原样输出）：新闸门 `sh-failclosed-test.sh` **31/34（3 FAIL，正是 TAB 三例，`Invalid control character`）**；主源同闸门 **34/34 绿** → 新闸门确实能抓住 JSON 转义回退。

### 2.6 副本 / 规则段（item 6，`scope_check.txt`）

```
审计树 / skills 树 / xhs 树  dangerous-commands.sh  7F7769F2175C6D88  30296  BOM=False CR=0   (mtime 三份同为 2026-09-12 00:18:48)
dangerous-commands.ps1                              FB85CC0E4476AE58  34523  BOM=True  CR=0   (mtime 2026-09-11 21:54:54，本轮未触碰)
sh-audit-bypass.sh   ×3 = 8971C292A30F2CE3 18292 BOM=False CR=0
sh-failclosed-test.sh×3 = ED1A8253DC5DC45E  6939 BOM=False CR=0
规则段（# ---- 命令边界匹配 → EOF）171 行 10399 B：pre = post = 3350ad9370e13de6
```

报告 §1/§4 的数字与产物抽查**全部相符**。

### 2.7 三棵树四套回归（自跑）

```
audit 树: sh-hook 67/67 · edge 40/40 · failclosed 34/34 · bypass 192/192 ALL PASS
skills 树: 同上四项全绿
xhs 树:   同上四项全绿
```

变基线对照：`sh-failclosed-test.sh × pre-G5 = 20 PASS / 14 FAIL`（与报告一致）。

---

## 3. 未做项（时间盒到期，明确标注）

1. **`node` 全量 378/378 未跑**（报告自述值）。本轮只独立跑了其中的 parity 子集（3/3 绿）。
2. 变异下的 **PART A / PART C 是否仍绿**未单独采集（两个变异的失败断言栈均落在 `redact-parity.test.ts:344` = **PART B 的断言**，故 PART B 红已确证；A/C 不绿与否未取正面读数。原理上两个变异点都在 `redact_cmd`（生产出口），而 A/C 走 `--redact-stdin`→`redact_text`，路径不相交）。
3. 未提交 `_g5_before` 之外的更多 pre-G5 基线（已用 git HEAD 交叉证实其同一性）。

---

## 4. 特别标注（逐类）

### 4-1 跨端 decision 分歧（2 条，**均不构成 REJECT 依据**）

| 载荷 | sh(post) | ps1 | pre-G5 sh | 判定 |
|---|---|---|---|---|
| `{"command":"git status\n"}`（**原始 LF 字节**，非 `\n` 转义） | deny | allow | allow | 输入本身**违反 RFC 8259**（字符串内裸控制字符）。sh 严格解析→fail-closed deny；ps1 `ConvertFrom-Json` 宽松接受→放行。**sh 取其严，方向安全**；真实 hook 调用方由 JSON 序列化器产出，不会出现该形态。**不构成 REJECT**，建议记入「ps1 宽松解析」待办。 |
| `{"command":"git status<TAB>x"}`（原始 TAB 字节） | deny | allow | allow | 同上。 |

> 报告 §2 的「sh-vs-ps1 DIFF=0（54 条）」在其语料范围内成立，但**语料未覆盖裸控制字符**，故该结论不能外推为「全形态零分歧」。

### 4-2 残留 fail-open 形态（已披露，**非本轮引入**）

| 载荷 | post-G5（无 python3） | pre-G5 | 有 python3 |
|---|---|---|---|
| 空 stdin | **allow（exit 0 无输出）** | allow | deny |
| 畸形 JSON | **allow** | allow | deny |
| 缺 command 字段 | deny（pre 为 **exit=1**） | exit=1 | deny |
| 正常危险命令 | deny | deny | deny |
| 正常 allow / 非 shell 工具 | allow | allow | allow |

自跑证据：`nopy_probe.sh`（`PATH=/tmp/g5ev_nopy`，`python3 visible: NO`）。

判定：**未放宽**（与 pre-G5 同形），且任务卡把该路径列在「不能破坏 #4」而非验收标准；但「空 stdin → deny」这条验收目标**只在 python3 可用时成立**。**不构成 REJECT**。最小硬化（可选，1 行）：在 L255 的 `case "$tool_name"` 之前补 `[ -n "$(printf '%s' "$inputJson" | tr -d '[:space:]')" ] || deny_command "hook 收到空输入（未提供命令）"`。

### 4-3 跨端分歧（pre-G5 已存在，**非 G5 引入**）

自跑 `g5_nonstring.mjs`：

| 载荷 | sh(post) | sh(pre) | ps1 | 说明 |
|---|---|---|---|---|
| `{"command":null}` | allow | allow | **deny**（缺少 command 字段） | 两端对 `null` 语义不同；pre=post，非回归 |
| `{"command":["rm","-rf","/tmp/t"]}` | allow | allow | **deny**（识别为 rm -rf） | sh 把数组 repr 当命令串、锚定正则打在 `['rm'` 上不命中；pre=post，非回归 |

两者均**不是 G5 引入**，且 hook 输入由 harness 序列化（`command` 恒为字符串），现实不可达。列为 P2 backlog，**不构成 REJECT**。

### 4-4 误拦合法调用

**未发现**。47 条反向邻居（含正常 allow 命令、末尾换行、CRLF、前后空白、多行安全命令、`#` 在中间/末尾、TAB 在引号内、非 Bash 工具、非对象 JSON、纯注释/前导换行注释）**全部未被误 deny**，且与 ps1 同判。

### 4-5 测试被削弱

**无**。git diff 证明 `sh-audit-bypass.sh` 仅 16b/16c 两块变化，方向为加强；67/40 两套未改动（其内容与 pre-G5 逐字节一致——三棵树 4 套全绿 + pre-G5 上 20/14 红、post 上 34/34 绿）。新增 `sh-failclosed-test.sh` 的 34 例经我自跑确认在 pre-G5 上红 14、post-G5 上全绿、TAB 变异上红 3。

### 4-6 副本 / BOM / 行尾不一致

**无**。见 §2.6：sh 三副本 distinct=1、`BOM=False`、`CR=0`；ps1 `BOM=True` 保持且 mtime 早于本轮（2026-09-11 21:54，本轮改动窗口 2026-09-12 00:18）；测试副本三树一致。

### 4-7 报告准确性

- 报告 §5-4 称「形如 `\u00a0# x` 时 sh 会 deny 而 ps1 allow」——**未能复现**：自跑 R1 两端**同为 allow**（sh 先做 NFKC，`U+00A0`→`U+0020`，注释分支生效）。该披露属**过度保守的错报**，方向无害，建议修正措辞。
- 报告 §5-1/§5-2/§5-3 三条残留**逐条复现成立**（无 python3 放行 / `# note\nrm -rf /tmp/t` sh 与 ps1 **同形放行** / 非对象 JSON 两端同 allow）。
- 环境提示：本轮独立复跑中 WSL 出现 **2 次瞬时故障**（1 次 `exit=-1` 无输出、1 次 failclosed 套件 34/34 全红后立即重跑恢复 34/34 全绿；pre-G5 与 post-G5 受同一影响）。**该现象与被测代码无关**，与报告 §5-7 的披露一致；建议后续验收对单次全红结果**自动重跑一次**再定罪。

---

## 5. 结论

**ACCEPT。**

理由：G5 卡的三项核心目标（异常输入 fail-closed、含 TAB/控制字符输出合法 JSON、多行命令整条评估）在**真实 spawn 生产形态**下逐条达成；正常运行路径判定**零变化**（25 条正常路径 CHANGED=0，47 条反向邻居零误拦）；判定规则段**逐字节未动**（`3350ad9370e13de6`）；测试**未削弱**而是加强，且 16b/16c 的原期望被 git 证据确证为 fail-open 现状记录；G15b 红线经两个生产路径变异**确认仍然把守**；副本/BOM/行尾一致，ps1 未被触碰。

遗留 4 项（§4-1/4-2/4-3/4-7）均为**已披露或 pre-G5 既有**、**非本轮引入**、**不改变正常路径安全性**，建议作为下一张卡（P2：ps1 宽松解析对齐 / 无 python3 回退的空输入硬化 / 非字符串 `command` 语义对齐）的输入，**不构成 REJECT 依据**。
