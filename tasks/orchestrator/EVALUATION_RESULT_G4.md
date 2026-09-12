# G4 独立验收报告 — ps1 规则 16d 死代码修复

- Evaluator：独立验收 Agent（G4），不采信他人数字，全部证据自跑
- 日期：2026-09-11
- 被审文件：`agent-risk-guard-audit\scripts\dangerous-commands.ps1`
- 验收标准：`agent-risk-guard\tasks\orchestrator\IMPLEMENTATION_BRIEF_G4.md`
- 运行环境：Windows；pwsh 7.6.6；Windows PowerShell 5.1.26100.9444；WSL bash 5.2.21（python3 /usr/bin/python3）

---

## 结论（裁决 A）：ACCEPT

四项检查全部 PASS，5 条验收标准全部满足，且**回滚实验构成因果性证据**（不是"看着像对"）。
唯一实测偏差是任务卡「错误场景」中 `$x=rm --help` 应 allow、实测 deny —— 经取证判定为
**可接受保守取舍（记录不阻塞）**（裁决 B 详见第 7 节）。

| # | 检查项 | 结果 |
|---|---|---|
| 1 | JSON stdin 探测（deny 9/9、allow 2/2） | PASS |
| 2 | 回滚验证 A绿→B红→C绿→D绿 + 字节级还原 | PASS（决定性） |
| 3 | 6 处 canonical 副本 SHA256 全同 + BOM | PASS |
| 4 | `scripts\` 全 .ps1 POSIX 类残留 = 0 | PASS |
| 5 | 4 套 ps1 + 3 套 sh 回归全绿 | PASS |
| 附 | Windows PowerShell 5.1 执行路径 | PASS（parsed-ok） |

---

## 0. 方法学警告（重要，后续审计者必读）

**不能用同进程管道喂 stdin。** 本 hook 用 `[Console]::In.ReadToEnd()` 读输入（L67），
`[Console]::In` 读的是**进程 stdin**，不是 PowerShell 管道。实测：

```
$json | & $hook          →  {"permissionDecision":"deny", reason:"hook 收到空输入（未提供命令）"}
$json | & pwsh -File $hook →  {"permissionDecision":"deny", reason:"变量赋值/反斜杠前缀的 rm 是间接永久删除…"}
```

同进程管道下**所有用例（含 echo hello）都被 fail-closed 判 deny**。若审计者用这种写法，
会把"探测全 deny"误读为规则生效——这是假阳性陷阱。本报告全部探测均通过**子进程真实 stdin**。
（生产由 Agent runtime 以子进程 + stdin 调起，不受影响；fail-closed 本身是设计意图。）

---

## 1. 探测：JSON stdin 喂 hook

方式：`{"tool_name":"Bash","tool_input":{"command":"CMD"}}` → `pwsh -NoProfile -File <hook>` 子进程 stdin。
判定：stdout 含 `"permissionDecision":"deny"` 记 deny，否则 allow。**只喂文本，未真实执行任何危险命令。**

| 组 | 期望 | 实测 | 命令 | 命中的 reason |
|---|---|---|---|---|
| deny | deny | deny | `$x=rm; $x -rf /tmp/t` | 变量赋值/反斜杠前缀的 rm 是间接永久删除 |
| deny | deny | deny | `$x = rm; $x -rf /tmp/t` | 同上（**16d 承重**） |
| deny | deny | deny | `$x="rm -rf /tmp/t"; $x` | 递归强制删除操作（rm -rf）〔rule 15 兜底〕 |
| deny | deny | deny | `$x = "rm -rf /tmp/t" ; $x` | 同上 |
| deny | deny | deny | `$x=Remove-Item; $x -Path C:\temp -Recurse -Force` | Remove-Item 是永久删除〔rule 13 兜底〕 |
| deny | deny | deny | `$x = Remove-Item ; $x -Path C:\temp -Recurse -Force` | 同上 |
| deny | deny | deny | `X=rm; $X -rf /tmp/t` | 变量赋值/反斜杠前缀的 rm（**16d 承重**） |
| deny | deny | deny | `CMD=rm; $CMD -rf /tmp/t` | 同上（**16d 承重**） |
| deny | deny | deny | `$x=rm --recursive --force /tmp/t` | 同上（**16d 承重**，其它规则均不命中） |
| allow | allow | allow | `echo hello` | —（stdout 空） |
| allow | allow | allow | `git status` | —（stdout 空） |

`MISMATCH_COUNT = 0`。

### 1b. 16d 其余分支（反斜杠 / 前导斜杠）依旧/修复后生效

| 修复后 | POSIX 死代码 | 命令 | 说明 |
|---|---|---|---|
| deny | deny | `\rm -rf /tmp/t` | rule 15 亦命中 |
| deny | deny | `/rm -rf /tmp/t` | rule 15 亦命中 |
| deny | **allow** | `r\m -rf /tmp/t` | **16d 承重** |
| deny | deny | `./rm -rf /tmp/t` | rule 15 亦命中 |
| deny | **allow** | `/rm /tmp/t` | **16d 承重** |

### 1c. deny/allow 差分（修复版 vs 保留的 POSIX 形态副本）

| 期望 | 修复版 | POSIX | 判定 | 命令 |
|---|---|---|---|---|
| deny | deny | allow | **LOAD-BEARING** | `$x=rm; $x -rf /tmp/t` |
| deny | deny | allow | **LOAD-BEARING** | `$x = rm; $x -rf /tmp/t` |
| deny | deny | deny | redundant | `$x="rm -rf /tmp/t"; $x` |
| deny | deny | deny | redundant | `$x=Remove-Item; …` |
| deny | deny | allow | **LOAD-BEARING** | `X=rm; $X -rf /tmp/t` |
| deny | deny | allow | **LOAD-BEARING** | `CMD=rm; $CMD -rf /tmp/t` |
| deny | deny | allow | **LOAD-BEARING** | `$x=rm --recursive --force /tmp/t` |
| allow | allow | allow | redundant | `echo hello` / `git status` |

**说明（对任务卡的小修正）**：任务卡列出的 4 个向量中，`$x="rm -rf …"` 由 rule 15、
`$x=Remove-Item` 由 rule 13 **独立兜底**，16d 对它们只是冗余；16d 真正承重的是
`$x=rm` / `X=rm` / `CMD=rm` 与 `r\m`、`/rm <无-rf>` 形态。这不影响结论，但表明
"4 个向量全部依赖 16d"的叙述不准确。

---

## 2. 回滚验证（决定性）

对 audit 副本 L252（1-based）做临时改造：把该行内全部 6 处 `\s` 换成 `[[:space:]]`，
跑 `tests\hook-audit-reregress.ps1`，再还原，逐字节比对。

```
BASELINE_SHA256      = D6D726D20288C2AFE602BE488D17A6C05F90DB1C46E4A78BC2E2A6A99FBCA9CA
BASELINE_HEAD3       = EF BB BF

=== [A] baseline suite run (expect GREEN) ===        exit=0   PASS: 59/59

RULE_16D_LINE_INDEX  = 251  (1-based file line = 252)
RULE_16D_ORIGINAL    = if ($cmd -match '(?i)=\s*"?rm(\s|"|;|$)' -or $cmd -match '(?i)=\s*"?Remove-Item(\s|"|;|$)' -or $cmd -match '(?:^|[;&|\r\n])[\\/]{1,2}rm(\s|-)' -or $cmd -match 'r[\\/]m(\s|-)') {
RULE_16D_POSIXFORM   = if ($cmd -match '(?i)=[[:space:]]*"?rm([[:space:]]|"|;|$)' -or $cmd -match '(?i)=[[:space:]]*"?Remove-Item([[:space:]]|"|;|$)' -or $cmd -match '(?:^|[;&|\r\n])[\\/]{1,2}rm([[:space:]]|-)' -or $cmd -match 'r[\\/]m([[:space:]]|-)') {
POSIX_FORM_SHA256    = 40185A84963E1066FB2219911C66144B236AE13156CBBA4FD10839CD8D2971A4

=== [B] suite run WITH POSIX form restored (expect RED) ===   exit=1
FAIL [expect deny] got allow  <- $x=rm; $x -rf /tmp/t
FAIL [expect deny] got allow  <- $x = rm; $x -rf /tmp/t
PASS: 57/59

REAPPLIED_SHA256     = D6D726D20288C2AFE602BE488D17A6C05F90DB1C46E4A78BC2E2A6A99FBCA9CA

=== [C] suite run AFTER re-applying \s (expect GREEN) ===    exit=0   PASS: 59/59

RESTORED_SHA256      = D6D726D20288C2AFE602BE488D17A6C05F90DB1C46E4A78BC2E2A6A99FBCA9CA
RESTORED_HEAD3       = EF BB BF
BYTE_EXACT_RESTORE   = True
FULL_BYTE_COMPARE    = True   (len 24004 vs 24004)

=== [D] suite run AFTER byte-exact restore (expect GREEN) === exit=0   PASS: 59/59

VERDICT_STEP2 = A_green=True B_red=True C_green=True D_green=True byteexact=True
```

**结论**：因果链闭合。POSIX 形态下恰有 2 条 16d 用例转红（其余 2 条被 rule 13/15 兜住，
与 1c 差分一致），改回 `\s` 即转绿；还原后 SHA256 与实验前**完全一致**、前 3 字节仍 `EF BB BF`、
24004 字节全量逐字节比对相同。**未对工作区留下任何改动。**

### 2b. 终态复核（实验后独立复测）

```
FINAL_SHA256 = D6D726D20288C2AFE602BE488D17A6C05F90DB1C46E4A78BC2E2A6A99FBCA9CA
FINAL_HEAD3  = EF BB BF
FINAL_BYTES  = 24004
POSIX_HITS_IN_TARGET = 0
```

### 2c. 原生语义证明（.NET 正则）

```
('a b') -match '[[:space:]]'  -> False
('a b') -match '\s'           -> True
```

---

## 3. 一致性：6 处 canonical 副本

| 副本 | SHA256 | Bytes | 前 3 字节 | 16d 形态 |
|---|---|---|---|---|
| audit/scripts | D6D726D2…BCA9CA | 24004 | EF BB BF | ok(`\s`) |
| rg/assets/hooks | D6D726D2…BCA9CA | 24004 | EF BB BF | ok(`\s`) |
| rg/skills/agent-risk-guard/scripts | D6D726D2…BCA9CA | 24004 | EF BB BF | ok(`\s`) |
| prod `~/.claude/hooks` | D6D726D2…BCA9CA | 24004 | EF BB BF | ok(`\s`) |
| prod `~/.codex/hooks` | D6D726D2…BCA9CA | 24004 | EF BB BF | ok(`\s`) |
| prod `~/.gemini/config/hooks` | D6D726D2…BCA9CA | 24004 | EF BB BF | ok(`\s`) |

```
UNIQUE_SHA256_COUNT = 1        ALL_SAME_SHA256 = True
ALL_HAVE_BOM        = True     ALL_RULE16D_FIXED = True
6/6 byteIdentical=True（与 audit canonical 全量逐字节比对）
```

**PASS**：6 处 SHA256 全同，前 3 字节均为 `EF BB BF`。

### 3b. 附带发现（非阻塞）：skills 侧测试副本未同步

| 文件 | Test-Cmd 数 | 含 `$x=rm` G4 用例 | SHA256 前 16 位 |
|---|---|---|---|
| audit/tests/hook-audit-reregress.ps1 | 60 | 有 | 00FFC25083344DFF |
| rg/skills/…/tests/hook-audit-reregress.ps1 | 54 | **无** | 177E0C146CAE41BC |

脚本副本 6 处全同（验收标准 5 满足），但**测试副本未同步**：发布侧（skills）的
reregress 仍是 53/53 旧版，不含 6 条 G4 用例。后果是——若将来 16d 再被改回死代码，
只有 audit 项目会报警，发布侧不会。建议后续同步（不阻塞 G4 验收）。

---

## 4. 残留：POSIX 字符类扫描

扫描正则：`\[\[:(space|alpha|digit|alnum|upper|lower|punct|blank|cntrl|graph|print|xdigit):\]\]`
（排除本次评估器自建目录 `_eval_g4\`）。

| 范围 | .ps1 数 | POSIX 命中 |
|---|---|---|
| audit/scripts | 4 | 0 |
| audit/tests | 4 | 0 |
| audit root | 9 | 0 |
| rg/assets/hooks | 2 | 0 |
| rg/skills/scripts | 4 | 0 |
| rg/skills/tests | 4 | 0 |
| prod ~/.claude/hooks | 2 | 0 |
| prod ~/.codex/hooks | 1 | 0 |
| prod ~/.gemini/hooks | 3 | 0 |
| **合计** | **33** | **0** |

`RESIDUE_VERDICT = CLEAN`

扫描器自检（防"扫描器本身失效导致假绿"）：把 POSIX 形态副本喂给同一扫描器
→ `CONTROL_FILE_HITS = 1`。扫描器有效。

---

## 5. 回归套件全绿（自跑，非引用）

| 套件 | 位置 | exit | 结果 |
|---|---|---|---|
| hook-rules-test.ps1 | audit | 0 | 37/37 |
| hook-bypass-regression.ps1 | audit | 0 | 20/20 |
| hook-fp-regression.ps1 | audit | 0 | 8/8 |
| hook-audit-reregress.ps1 | audit | 0 | **59/59**（53 旧 + 6 条 G4） |
| hook-rules-test.ps1 | skills | 0 | 37/37 |
| hook-bypass-regression.ps1 | skills | 0 | 20/20 |
| hook-fp-regression.ps1 | skills | 0 | 8/8 |
| hook-audit-reregress.ps1 | skills | 0 | 53/53（旧版，见 3b） |
| sh-hook-test.sh | audit | 0 | 67/67 |
| sh-audit-bypass.sh | audit | 0 | 192/192（FAIL 0） |
| sh-audit-edge.sh | audit | 0 | 40/40（FAIL 0） |

任务卡写"37+8+18+53"，实测各套件为 37 / 20 / 8 / 59 —— 数字口径与任务卡不符，
但**全部 exit=0、全过**，无失败项。

### 5b. sh 端同向量不回归（跨端一致性）

| 期望 | sh 实测 | 命令 |
|---|---|---|
| deny | deny | `$x=rm; $x -rf /tmp/t` |
| deny | deny | `$x = rm; $x -rf /tmp/t` |
| deny | deny | `$x="rm -rf /tmp/t"; $x` |
| deny | deny | `$x=Remove-Item; $x -Path C:/temp -Recurse -Force` |
| deny | deny | `$x=rm --recursive --force /tmp/t` |
| allow | allow | `echo hello` / `git status` |

### 5c. Windows PowerShell 5.1 执行路径（BOM 风险实检）

```
exe = C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe   (5.1.26100.9444)
$json | powershell.exe -File hook →  $x=rm; $x -rf /tmp/t  : deny   parsed-ok
                                      echo hello           : allow  parsed-ok
                                      git status           : allow  parsed-ok
```

无 ParseError，BOM 有效，判定与 pwsh 7 一致。**任务卡"不能破坏什么"第 4 条（BOM/5.1）实测满足。**

---

## 6. 验收标准逐条判定

| 标准 | 判定 | 依据 |
|---|---|---|
| 1. ps1 无 POSIX 字符类误用 | **PASS** | 33 个 .ps1，命中 0；扫描器自检有效（§4） |
| 2. 4 类变体全部 deny | **PASS** | §1 实测 9/9 deny（其中 2 条由 rule 13/15 兜底，见 §1c） |
| 3. 4 套 ps1 回归全绿 | **PASS** | 37/37 + 20/20 + 8/8 + 59/59，全 exit=0（§5） |
| 4. sh 端同向量仍 deny，sh 三套件全绿 | **PASS** | §5b + 67/67、192/192、40/40 |
| 5. 四处（实为六处）ps1 副本字节一致 + BOM | **PASS** | §3，SHA256 唯一，BOM 齐全，逐字节相同 |

---

## 7. 裁决 B：`$x=rm --help` 实测 deny —— 判定为**可接受保守取舍（记录不阻塞）**

**不是误伤缺陷，不应据此 REJECT。** 五条取证理由：

1. **跨端一致性硬约束。** 任务卡 L251 自述 16d 是"R25 对齐 sh 10b"；brief L38 明确要求
   "ps1 修复不得改变 sh 判定，保持跨端一致"。实测 sh `10b`（`dangerous-commands.sh:230`）
   对 `$x=rm --help` **同样 deny**。若在 ps1 16d 单方面加 help 豁免，就**直接违反验收标准 4**。
   任务卡的"应 allow"期望本身与 sh 孪生规则矛盾——是任务卡描述不准，不是实现错。

2. **误拦代价低且可逆。** deny 附带明确 reason（"变量赋值/反斜杠前缀的 rm 是间接永久删除"），
   用户/Agent 可在 Agent 外部手动执行，信息不丢失、无不可逆后果。且该写法现实中出现率极低：
   查 rm 帮助的正常写法 `rm --help` 实测 **allow**。

3. **加豁免的漏拦代价高且开了可复制的后门。** 16d 是"变量间接执行"类规则，help 豁免在这类
   正则里只能实现为**整条命令级别的抑制**。项目既有 rule 16 的豁免正是这种形态，且**实测已泄漏**：

   | 命令 | ps1 实测 | sh 实测 |
   |---|---|---|
   | `rm /etc/hosts` | deny | deny |
   | `rm --help; rm /etc/hosts` | **allow（泄漏）** | **deny** |
   | `rm --help; rm -rf /etc` | deny（rule 15 兜底） | deny |

   即 `rm --help` 一旦出现，rule 16 整条被跳过，后续无 `-rf` 的真删除静默放行。
   把同款豁免复制进 16d，等于为 `$x=rm --help; $x …` 一类向量预留同样的静默放行口。

4. **项目 help 豁免惯例实际很窄，16d 无豁免是"符合惯例"而非"违背惯例"。** 逐条实测：

   | 命令 | 实测 |
   |---|---|
   | `rm --help` | allow（rule 16 显式豁免） |
   | `rm -rf --help` | **deny**（rule 15 无豁免） |
   | `Remove-Item --help` | **deny**（rule 13 无豁免） |
   | `unlink --help` / `shred --help` | **deny**（rule 16b 无豁免） |
   | `del --help` / `rd /s /q …` | **deny**（rule 14 无豁免） |
   | `git rm --help` | **deny**（rule 30 无豁免） |

   即"help 豁免"只存在于极少数宽口径规则（rule 16 裸 rm / 16c 引号插词 rm / git restore），
   删除类主力规则（13/14/15/16b/30）通通不豁免。16d 属删除类，不豁免与惯例一致。

5. **方向与项目整体 fail-closed 设计一致。** 空输入、JSON 解析失败、缺 command 一律 deny
   （L69-77）。在"可能误拦"与"可能漏删"之间，本项目一贯选前者。

**建议（非阻塞）**：
- 把 `$x=rm --help` / `$x=rm -h` 作为**预期 deny** 写进回归套件（而非当作 bug 待修），
  防止后人好心加豁免反引漏洞。
- **独立发现（P2，超出 G4 范围）**：rule 16 的 help 豁免存在泄漏 ——
  `rm --help; rm <file>` 在 ps1 下 allow、sh 下 deny。建议后续单独修（改法可参照 sh 的
  "只检查 rm 段实参"而不是"整条命令抑制"）。

---

## 8. 附：自跑证据文件清单

全部位于 `agent-risk-guard-audit\_eval_g4\`（评估器自建，非交付物）：

| 文件 | 用途 |
|---|---|
| `probe-stdin.ps1` | 【1】子进程真实 stdin 探测 |
| `stdin-method-check.ps1` | 方法学对照（同进程管道 vs 子进程 stdin） |
| `rollback-verify.ps1` | 【2】决定性回滚实验 |
| `dangerous-commands.ps1.orig.bak` | 实验前原始字节备份（24004 B） |
| `dangerous-commands.ps1.POSIXPROBE.ps1` | POSIX 死代码形态留存副本（差分用，**非生产文件**） |
| `diff-fixed-vs-posix.ps1` | 修复版 vs POSIX 差分（承重判定） |
| `probe-branches-ps51.ps1` | 16d 其余分支 + PS 5.1 路径 |
| `consistency-residue.ps1` / `final-evidence.ps1` | 【3】【4】一致性与残留 |
| `probe-sh.sh` / `probe-sh-help.sh` | sh 端跨端对照 |
| `probe-help.ps1` / `probe-convention.ps1` | help 豁免惯例与泄漏取证 |
| `run-all-suites.ps1` / `run-sh-suites.ps1` | 全部 7 套回归 |

> 注意：`dangerous-commands.ps1.POSIXPROBE.ps1` 是**故意保留的 POSIX 死代码副本**，
> 仅供差分复现，**不是生产 hook**，任何残留扫描应排除 `_eval_g4\`。

---

## 9. 最终裁决

- **裁决 A：ACCEPT。** 4 项检查全 PASS，5 条验收标准全满足；回滚实验提供了因果级证据
  （POSIX→红、`\s`→绿、字节级还原无损），6 副本一致、BOM 完好、PS 5.1 可解析、跨端判定与 sh 对齐。
- **裁决 B：可接受保守取舍，记录不阻塞。** `$x=rm --help` 的 deny 与 sh 孪生规则一致、
  代价可逆、且给它加豁免会复制 rule 16 已实测存在的泄漏模式。任务卡的 allow 期望属描述偏差。

---
---

# 附录 E — 第二轮独立复验（Evaluator #2）

- Evaluator：另一独立 Agent（第二轮），**未参与 G4 实现**，未引用第 1 轮任何数字
- 日期：2026-09-11
- 复验时点被审文件状态：`agent-risk-guard-audit\scripts\dangerous-commands.ps1`
  **SHA256 `EA71C7CBF32251BB285ACBD5B2BB1981330BC768259C25485E8459A45AFCAA9B` / 31397 B / 526 行 / BOM=True**
  （mtime 2026-09-11 10:37:56）
- 自建证据目录：`agent-risk-guard\tasks\.tmp\g4eval\`

> **⚠ 复验前提变更（第 1 轮报告未涵盖）**：本文件正文（第 1 轮）全部哈希基于
> `D6D726D2…` / 24004 B。第 2 轮开工后实测该文件已在会话期间**被 G15b 切片改写**为
> `EA71C7CB…` / 31397 B（G15b 新增密钥脱敏规则，六副本同步为同一新哈希）。
> 因此第 1 轮的 SHA/字节数断言（§2、§3、§3b 中的 `D6D726D2…`、`40185A84…`、24004/24058 B）
> **在当前工作区已不可复现**，属"证据快照过期"，非实现缺陷。
> 第 2 轮在**新哈希状态**下独立重做了全部关键实验，16d 规则行本身语义未变（仍为 `\s` 形态，见下）。

## E1. 裁决（第 2 轮，独立结论）

| 裁决 | 第 2 轮结论 |
|---|---|
| **A. 总体** | **ACCEPT**（针对 16d 修复本身；与第 1 轮一致，但附加下方 N1 时效性条件） |
| **B. `$x=rm --help`** | **可接受保守取舍**（非误伤缺陷；理由见 E4，含第 2 轮自跑的 sh 对照） |

## E2. 逐项检查表（PASS/FAIL + 第 2 轮自跑证据）

| # | 检查项 | 结果 | 第 2 轮独立证据 |
|---|---|---|---|
| 1 | 16d `[[:space:]]` → `\s` 已修，`.NET` 语义等价 | **PASS** | 当前 L346 实测为 `(?i)=\s*"?rm(\s\|"\|\|;\|$)` 四分支形态；文件内 `\[\[:` 匹配数 = **0** |
| 2 | 原语义保持（变量赋值三种写法 / Remove-Item / `r\m` / `\rm` / `/rm`） | **PASS** | 子进程真实 stdin 喂 hook，pwsh7 与 ps5.1 **双双 deny**（10 条向量，见 E3） |
| 3 | 允许组无误伤（`echo hello` / `git status` / `ls -la` / `pwd`） | **PASS** | 4/4 `allow`（stdout 空 + exit 0 = 放行），两引擎一致（E3） |
| 4 | 空/畸形输入不崩且 fail-closed | **PASS** | 空 stdin / 纯空白 / 坏 JSON / 缺 command / null command / 空 command → 全部 `deny`，exit=0，无 stderr（E3） |
| 5 | 测试有效性：回滚变红、还原变绿 | **PASS（决定性）** | 隔离 TEMP 副本回滚 → `57/59` + exit=1（恰 2 条变红）；还原 → `59/59` + exit=0（E5） |
| 6 | 6 处 canonical 副本 SHA256 一致 + BOM | **PASS（新哈希）** | 6/6 = `EA71C7CB…`，`distinct-hashes = 1`，`all-BOM = True`，均 31397 B（E6） |
| 7 | `scripts\` 全部 .ps1 无 POSIX 类 | **PASS** | 4 个 .ps1 命中数 **0/0/0/0**；`[[:` 扫描器经自检有效（E6） |
| 8 | 语法检查（Parser::ParseFile） | **PASS** | canonical 与 universal 在 pwsh7 下 `syntaxErrors = 0` |
| 9 | 4 套 ps1 回归全绿 | **PASS** | pwsh7：37 / 8 / **20** / 59，全 exit=0；ps5.1：37 / 8 / **18** / 59，全 exit=0（E6） |
| 10 | sh 三套件不回归 | **PASS** | `sh-hook-test` 67/67、`sh-audit-edge` 40/40 FAIL 0、`sh-audit-bypass` 192/192 ALL PASS，全 exit=0 |
| 11 | 补的用例是真用例（断言 hook 实际输出） | **PASS** | reregress L74-79 经 `Test-Cmd` 实际调用 hook 并读 `permissionDecision`；回滚实验证明其可失败 |
| 12 | 未越界改动 | **PASS（有条件）** | 16d 相关行 + 测试文件；但见 **N1**：文件已被 G15b 覆盖，无法在 G4 时点复核 `git diff` 边界 |
| 13 | 跨端（sh↔ps1）判定一致 | **FAIL（部分）** | 主体向量一致，但 3 个向量不一致，见 **N2/N3/N4** |

## E3. 第 2 轮独立探测（子进程真实 stdin，pwsh7 + PS 5.1 双引擎）

方式：`{"tool_name":"Bash","tool_input":{"command":"<cmd>"}}` 写入子进程 stdin（`Start-Process` +
`RedirectStandardInput`），只读 hook 的 stdout JSON。**全程未执行任何危险命令。**
判定口径：stdout 为空且 exit 0 = **allow**（对应 hook L430-432 `Write-HookLog 'allow'; exit 0`）；
含 `"permissionDecision":"deny"` = deny。

| 组 | 命令 | pwsh7 | ps5.1 |
|---|---|---|---|
| deny | `$x=rm; $x -rf /tmp/t` | deny | deny |
| deny | `$x = rm; $x -rf /tmp/t` | deny | deny |
| deny | `$x="rm -rf /tmp/t"; $x` | deny | deny |
| deny | `$x=Remove-Item; $x -Path C:\temp -Recurse -Force` | deny | deny |
| deny | `$x = Remove-Item ; $x -Path C:\temp` | deny | deny |
| deny | `r\m -rf /tmp/t` | deny | deny |
| deny | `\rm -rf /tmp/t` | deny | deny |
| deny | `/rm -rf /tmp/t` | deny | deny |
| deny | `$X=RM; $X -RF /tmp/t` | deny | deny |
| deny | `$x='Remove-Item'; $x -Path C:\temp` | deny | deny |
| deny | `Remove-Item -Recurse -Force C:\temp` | deny | deny |
| **allow(未覆盖)** | **`$x="r\m"; $x -rf /tmp/t`** | **allow** | **allow** |
| allow | `echo hello` / `git status` / `ls -la` / `pwd` | allow | allow |

畸形输入（pwsh7）：空 stdin、纯空白、`{not json`、缺 `tool_input.command`、`command: null`、
`command: ""` → **全部 deny、exit=0、无异常输出**；`tool_name` 缺失或非 shell 类（`Read`）→ allow（设计意图）。

> 方法学注记（与第 1 轮 §0 一致，本轮独立复现）：同进程管道 `$json | & $hook` 会让
> `[Console]::In.ReadToEnd()` 读到 EOF，从而**所有**用例（含 `echo hello`）都被 fail-closed 判 deny。
> 本轮全部探测均走独立子进程 stdin，未落入该假阳性陷阱。

## E4. 裁决 B 复核：`$x=rm --help` 的 deny

第 2 轮自跑，ps1 与 sh 均用**子进程真实 stdin / 真实 bash 调用**：

| 命令 | pwsh7 | ps5.1 | **sh（WSL bash）** |
|---|---|---|---|
| `$x=rm --help` | deny | deny | **deny** |
| `$x = rm -h` | deny | deny | **deny** |
| `rm --help` | allow | allow | **allow** |
| `rm --version` | allow | allow | **allow** |
| `rm'' --help` | allow | allow | **deny** |
| `$x=rm --help; $x -rf /` | deny | deny | （deny） |
| `Remove-Item --help` | deny | deny | — |
| `del /?` | deny | deny | — |
| `git restore --help` / `git checkout --help` | allow | allow | allow |

**理由（含 sh 端同类规则行为 + 项目既有 help 豁免惯例）**：

1. **sh 端同类规则行为**：`dangerous-commands.sh:230`（10b）对 `$x=rm --help` **同样是 deny**，
   与 ps1 16d 逐字对齐。该 deny **不是 ps1 单端误伤**，而是跨端一致的设计结果；任务卡把它列为
   "应 allow"属于**任务卡描述与 sh 孪生规则矛盾**，不是实现错误。单改 ps1 加豁免会立刻制造
   新的跨端不一致，直接违反任务卡"ps1 修复不得改变 sh 判定"的约束。
2. **项目既有 help 豁免惯例确实存在，但只挂在"直接调用"类规则上，16d 属"变量间接执行"类，不在其列**：
   - 有豁免：`rm --help` → allow（rule 16 显式豁免）；`rm'' --help` → ps1 allow（16c 的
     `(?!-?h(?:elp)?\b|version\b|V\b)`）；`git restore --help` / `git checkout --help` → allow
     （回归套件 L22-23 明文钉死为 allow 预期）。
   - 无豁免：`Remove-Item --help` → deny、`del /?` → deny，均实测。
   - 即"删除动词 + help"并非项目通用豁免；16d 沿用"变量别名删除动词一律拦"的口径与惯例自洽。
3. **代价可逆、信息不丢失**：deny 附 reason 且提示在 Agent 外部手动执行；正常查帮助的写法
   `rm --help` 实测 allow，可用性损失极小。
4. **反方向风险更高**：`$x=rm --help` 与真实攻击形态 `$x=rm --help; $x -rf /` 仅差一个后缀；
   给 16d 加 help 豁免等于为"别名 + 无害尾巴"的绕过预留静默放行口（第 1 轮 §7 已实证 rule 16
   存在同型泄漏 `rm --help; rm <file>`；本轮独立复现 `rm'' --help` 在 ps1 放行、sh 拦截）。

**结论：可接受保守取舍。** 建议把 `$x=rm --help` 作为**预期 deny** 写入回归套件并修正任务卡
「错误场景」文字，而不是给它加豁免。

## E5. 测试有效性（决定性实验，第 2 轮自跑）

> **方法改进**：第 1 轮直接改写 canonical 再还原；第 2 轮改为**隔离 TEMP 副本实验**——
> 整棵 `scripts\` + `tests\` 复制到 `%TEMP%\g4eval_iso_<rand>\`，只改副本。canonical 全程零写入，
> 从机制上排除"还原不彻底"的可能。

```
CANONICAL-BEFORE sha=EA71C7CBF32251BB285ACBD5B2BB1981330BC768259C25485E8459A45AFCAA9B bytes=31397 bom=True

A. BASELINE（canonical 只读）  hook-audit-reregress.ps1 :: PASS: 59/59   exit=0
B. ISO 副本未改动              PASS: 59/59            exit=0            （GREEN）
C. 16d 行回滚为 POSIX 形态     命中 1 处（预期 1）
   ISO-HOOK after rollback: sha=B9E9DBAD… bytes=31451 bom=True（+54 B = 6 处 × 9 B，与 6 次替换吻合）
   POSIX-class count in rolled-back 16d line = 6
D. ISO 副本 16d 回滚后          FAIL [expect deny] got allow  <- $x=rm; $x -rf /tmp/t
                                FAIL [expect deny] got allow  <- $x = rm; $x -rf /tmp/t
                                PASS: 57/59            exit=1            （RED）
E. ISO 副本按 canonical 字节还原 sha=EA71C7CB…  byte-identical-to-canonical=True  bom=True
                                PASS: 59/59            exit=0            （GREEN，闭环）
F. CANONICAL-AFTER             sha=EA71C7CB… bytes=31397 bom=True   CANONICAL-UNTOUCHED = True
```

**因果链闭合**：POSIX 形态 → 恰 2 条 16d 用例转红 + exit=1；改回 `\s` → 全绿。
新用例**真的会失败**，非恒真断言。同时 canonical 前后 SHA 完全相同，实验零污染。

## E6. 副本一致性 / POSIX 残留 / 回归（第 2 轮自跑原始数字）

**6 处 canonical 副本**（全部 `EA71C7CB…` / 31397 B / BOM=True，`distinct-hashes = 1`）：
`agent-risk-guard-audit\scripts\` · `agent-risk-guard\assets\hooks\` ·
`agent-risk-guard\skills\agent-risk-guard\scripts\` · `~/.claude/hooks\` · `~/.codex/hooks\` ·
`~/.gemini/config\hooks\`。
universal 2 处同为 `13FEB6CCA35710909783EAD23DCD73C6CAA8CDAA899616DC0205DFB93D9796BB` / 17685 B / BOM=True。

**POSIX 括号类精确计数**（`[regex]::Matches` 计数，非行数）：

| 文件 | `\[\[:` 计数 |
|---|---|
| `agent-risk-guard-audit\scripts\dangerous-commands.ps1` | **0** |
| `agent-risk-guard-audit\scripts\dangerous-commands-universal.ps1` | **0** |
| `agent-risk-guard-audit\scripts\agy-dangerous-commands.ps1` | **0** |
| `agent-risk-guard-audit\scripts\dangerous-commands-agy.ps1` | **0** |
| `agent-risk-guard-audit-xhs-publish\scripts\dangerous-commands.ps1` | **6**（不在本卡 6 份清单内，见 N5） |
| `agent-risk-guard-audit-xhs-publish\scripts\dangerous-commands-universal.ps1` | **6**（同上） |

**回归套件（第 2 轮自跑，PASS 行计数）**：
`hook-rules-test` 37 / `hook-fp-regression` 8 / `hook-bypass-regression` **20(pwsh7) · 18(ps5.1)** /
`hook-audit-reregress` 59，双引擎 exit 全 0；sh：67 / 40 / 192，全 exit 0。

第 2 轮**独立复现**了 bypass 套件 18 vs 20 的成因：ps5.1 下该测试文件因**无 BOM** 且**首行非注释**，
按 GBK(936) 解码时中文注释末字节吞掉 CRLF，静默丢 3 行（含 `echo hi\nrm -rf /tmp` 与 `RM -rf /tmp` 两例），
故 `$cases.Count` = 18。属沿袭技术债，G4 前后一致，非本次引入。

## E7. 第 2 轮新增发现（第 1 轮未涵盖）

| 编号 | 发现 | 严重度 | 处置建议 |
|---|---|---|---|
| **N1** | **被审文件在 G4 验收后已被 G15b 改写**（`D6D726D2…`/24004 → `EA71C7CB…`/31397）。第 1 轮全部 SHA/字节断言已过期，无法在当前工作区复现。 | 中（证据时效） | G4 结论仍成立于 16d 语义（本轮已在新哈希下重验）；但**任何引用 G4 哈希的下游文档需标注时点**。 |
| **N2** | **`$x="r\m"; $x -rf /tmp/t` → ps1 allow 且 sh allow**（跨端一致地漏拦）。16d 分支 `r[\\/]m(\s\|-)` 要求 `m` 后紧跟空白或 `-`，此处为 `"`，故不命中；裸 `r\m` 已拦，引号包裹形态未拦。 | 中（残留绕过，**两端同源、非 G4 引入**） | 超出 G4 范围；建议后续把该分支改为容忍引号/引号剥离后复查（`$cmdNaked` 已在 16e 使用，可复用）。 |
| **N3** | **`$X=RM; $X -RF /tmp/t` → ps1 deny，sh allow**（跨端不一致，ps1 更严）。ps1 16d 带 `(?i)`，sh `:230` 为 `grep -qE`（大小写敏感），故大写变量名漏拦。 | 中（sh 侧漏拦缺口） | 属 sh 侧既有缺口，建议 sh 端补 `-i` 或在 10b 加大小写变体；**不得**通过放宽 ps1 来对齐。 |
| **N4** | **`rm'' --help` → ps1 allow，sh deny**（跨端不一致，ps1 更宽）。ps1 16c 的 help 豁免被引号插词形态复用，sh 同位置无豁免。 | 低-中 | 与第 1 轮 §7 发现的 rule 16 豁免泄漏同族；建议统一豁免实现。 |
| **N5** | `agent-risk-guard-audit-xhs-publish\scripts\*.ps1` 仍有 6+6 处 POSIX 类。 | 低（范围外） | 与第 1 轮 §7.3 判定一致：发布快照、非活镜像。**若验收口径为"工作区内所有 ps1 归零"则须 Orchestrator 明确授权**（会改动其它任务产物哈希）。 |

> 范围口径提醒（同意第 1 轮 §7.4）：`tasks\.tmp\`、`tasks\eval-g4\`、`_eval_g4\` 等**评估器自建目录**
> 中的 `[[:space:]]` 是**刻意保存的测试数据**（回滚实验必须写入该字面量），不是 hook 规则文件。
> 本附录 E6 的残留扫描口径限定为**hook 规则文件与分发包**，不含评估器临时目录。

## E8. 第 2 轮证据文件清单

全部位于 `agent-risk-guard\tasks\.tmp\g4eval\`（评估器自建，非交付物）：

| 文件 | 用途 |
|---|---|
| `probe-stdin.ps1` | 双引擎子进程真实 stdin 探测（18 向量 + 9 畸形输入） |
| `out-probe-both.txt` / `summary-both.csv` | 上述原始输出 |
| `rollback-iso.ps1` | **隔离 TEMP** 回滚实验（canonical 零写入）+ 4 套件基线 |
| `out-rollback-iso.txt` | 回滚实验原始输出（含 SHA/BOM 前后比对） |
| `copies-check.ps1` / `out-copies.txt` | 6 副本 + universal 2 副本 SHA256/BOM/字节 |
| `help-convention-probe.ps1` / `out-help-convention.txt` | help/version 豁免惯例双引擎取证 |
| `sh-probe.sh` / `out-sh-probe.txt` | sh 端 20 向量跨端对照（真实 bash） |
| `t3-regex.ps1` | 16d 分支正则语义核对 |

## E9. 第 2 轮最终裁决

- **裁决 A：ACCEPT。** 16d 修复在**当前哈希 `EA71C7CB…`/31397 B** 状态下独立重验通过：
  POSIX 类归零、双引擎 deny/allow 组全对、畸形输入 fail-closed、6 副本一致且 BOM 完好、
  4 套 ps1 与 3 套 sh 全绿；**隔离 TEMP 回滚实验给出因果级证据**（57/59 变红 → 59/59 变绿，
  canonical 零污染）。与第 1 轮结论一致。
  *附加条件*：第 1 轮报告中的 SHA/字节数已因 G15b 改写而过期（N1），引用时须标注时点。
- **裁决 B：可接受保守取舍，记录不阻塞。** 第 2 轮以真实 bash 调用 sh 钩子独立取证：
  sh 端对 `$x=rm --help` **同样 deny**，与 ps1 一致；项目 help 豁免惯例仅覆盖"直接调用"类规则
  （`rm --help`、`git restore --help` 等实测 allow），删除类规则（`Remove-Item --help`、`del /?`）
  一律不豁免，16d 属后者。加豁免反而会复制已知的静默放行模式。**属任务卡描述偏差，非实现缺陷。**
- **遗留（不阻塞 G4，建议另开卡）**：N2（两端同源漏拦 `$x="r\m"`）、N3（sh 大小写漏拦）、
  N4（ps1 `rm'' --help` 比 sh 宽）、N5（xhs-publish 快照 6 处 POSIX）、bypass 套件无 BOM 致 ps5.1 丢 3 例。
