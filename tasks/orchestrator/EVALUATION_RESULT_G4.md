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
