# IMPLEMENTATION RESULT G3-FIX8（**Repair 1/1**）—— 包装词「自身选项」纳入命令位前缀（G3 最后一轮）

> 实现者：**Implementer**（不宣布成功；结论交由独立 Evaluator）。
> 输入：`FIX_BRIEF_G3-FIX8.md` + `riskgrard-mission-02/tasks/G1-g3-fix8.md` + **独立 Evaluator 的 REJECT 裁决**（R1–R5）。
> 全部探针/闸门/红线均为**真实 spawn + 进程 stdin**（D6：ps1 = `powershell.exe -File`，sh = `wsl.exe -e bash /mnt/e/…`），
> **全程串行**（D10），基线一律 `git show <rev>:<path>` 取**冻结字节**（D8）。
>
> **本卡只声明两条事实**：① 被 REJECT 的两条放松面（R1/R2）已修，且 `deny→allow = 0`；
> ② 报告里上一版被点名的 10 处口径已逐条更正（§9）。

---

## 0. 一页速览

| 项 | 结果 |
|---|---|
| **R1（两端放松）`env` 长选项** | `env --ignore-environment diskpart` / `env --unset=FOO diskpart`：FIX7 `deny/deny` → 上一版 `allow/allow`（**放松**）→ **本轮 `deny/deny`**；`env --ignore-environment ls` / `env -i ls diskpart` / `env VAR=1 ls` / `env -u X ls` 仍 **allow** |
| **R2（sh 单端放松）多行 rm 豁免** | 「豁免词独占首行 + 换行 + 真删除」**9 条全部重新 deny（两端）**；4 条豁免形态仍 allow；单行真删除仍 deny |
| **必修（源卡 §1 表 8 条）** | 仍全部 **两端 deny**（未回退） |
| **冻结基线全量对照** | **238 载荷 × 2 端 = 476 次真实 spawn**：`allow→deny` **109**、**`deny→allow` 0**（逐行归因见 §5）；终版不符应然 **0**、跨端身份分歧 **0** |
| **闸门** | 语料 **245 + 身份 24**；**base 绿（2/2，208 s）**；**MC 红 11/245**（= 包装词选项轴新语料）；**MR 红 12/245 + 身份 1/24**（= R3 新增语料） |
| **红线** | ps1 五套 × **三棵树** × **双引擎** = **30/30 rc=0**；sh 四套 × 三树 **12/12 rc=0**；redact A/B/C **3/3 绿** + **M4 0/3 红**；`sh-failclosed` **34/34** + **M2 31/34 红**；node 全仓 **380/380 rc=0** |
| **副本** | sh ×3 `a809ccfb9311f0ec`（51754 B，BOM=False）；ps1 ×**7** `0dfdcd5596f76827`（44327 B，BOM=True ×7）；全 LF；`bash -n`/`ParseFile` 逐份 0 错 |

---

## 1. 改动逐条对照（**可指代码行**）

### 1.1 改动清单（4 个跟踪文件）

| 端 | 文件 | 行 | 改动 |
|---|---|---|---|
| ps1 | `agent-risk-guard-audit/scripts/dangerous-commands.ps1` | **L278** | `$CMD_PRE` **整体重写为「逐包装词选项族」**（见 §1.2） |
| ps1 | 同上 | L261–277 | 注释块追加 G3-FIX8/A 的机理、判据、逐包装词选项表 |
| sh | `agent-risk-guard-audit/scripts/dangerous-commands.sh` | **L459** | `CMD_PRE` 同形重写（POSIX ERE） |
| sh | 同上 | L435–458 | 注释块同上 |
| sh | 同上 | **L490–493** | **R2 修复**：rm 实参抽取式改为「**组号无关 + 逐行全取**」（见 §1.3） |

`git diff --stat`（**只列本轮改动**）：

```
 assets/hooks/dangerous-commands.ps1                    | 18 +++++++++++++++++-
 packages/core/test/decision-parity.test.ts             | 82 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++---
 skills/agent-risk-guard/scripts/dangerous-commands.ps1 | 18 +++++++++++++++++-
 skills/agent-risk-guard/scripts/dangerous-commands.sh  | 46 +++++++++++++++++++++++++++++++++++-----------
 4 files changed, 148 insertions(+), 16 deletions(-)
```

### 1.2 前缀新定义：**逐包装词的选项族**（R1/R2 之后进一步收紧了精度）

| 包装词 | 吃参短选项 | 不吃参短选项 | 额外 |
|---|---|---|---|
| `sudo` | `-u -g -p -C -U -r -t -h -D -R -T` | `-b -E -H -i -k -K -l -n -P -s -v -A -e` | — |
| `time` | `-f -o` | `-a -p -v` | `--[a-z-]+[^\s]*`（`--verbose/--append/--format=…`） |
| `nice` | `-n` | — | — |
| `ionice` | `-c -n -p -P` | `-t -u` | — |
| `doas` | `-u -C` | `-n -s` | — |
| `exec` | `-a` | `-c -l` | — |
| `nohup`/`setsid`/`busybox`/`then`/`do`/`else` | —（词 + 空白） | — | — |
| 每个包装词共用 | — | `--`（终止符）、`-`（占位）、`VAR=v` | — |

**为什么必须逐包装词**（实测，见 §4）：单一泛化族 `-<任意字母> <操作数>` 会把 `sudo -v ls diskpart` 的 `ls`
当成 `-v` 的操作数（FIX7 = allow，且 `sudo -v` 并不执行命令）→ **新过拦**；而 `-[p]` 的「可选操作数」
写法会把 `time -p ls diskpart` 误拦。逐词列确凿吃参的选项后，`-n` 对 `sudo` 不吃参（`sudo -n diskpart` 仍 deny）、
对 `nice` 吃参（`nice -n 5 diskpart` 仍 deny），两个过拦同时消除。

**前缀语义断言（可机械复核）**：新前缀的**语言 ⊇ FIX7 前缀**（每个 FIX7 分支都在，选项族可匹配零次），
故 `deny→allow` 在构造上不可能出现；实测亦为 **0**（§5）。

### 1.3 sh 端 rm 实参抽取式（R2 修复，L490–493）

```sh
rmsegs=$(printf '%s' "$cmdtestNoq" | tr '[:upper:]' '[:lower:]' \
    | grep -E "${CMD_PRE}rm([[:space:]]|-)" | sed -E "s#.*${CMD_PRE}rm[[:space:]]*##" | sed 's/[[:space:]]*$//')
if printf '%s\n' "$rmsegs" | grep -qvE '^(-h|--help|-v|--version)$'; then
    deny_command "rm is permanent deletion. Use trash command."
fi
```

* **组号无关**：不再用 `\N`（前缀捕获组终版 **49**，见 §9-1；GNU sed 的 `\10`+ 表达不了）。
* **逐行全取**：先 `grep` 只留**匹配行**（首行豁免词不再被 `head -1` 选中），再取每行**最后一个命令位 `rm`** 之后的实参；
  **任一行不是 help/version 形态即 deny** —— 这正是 ps1 rule 16 的**调用点前瞻**语义（豁免只作用于「它自己那次调用」）。

---

## 2. 必修：R1 / R2 两端 before/after（Evaluator 点名的两条反例 + 守卫）

### 2.1 R1（`env` 长选项；**两端**曾被收窄）

| # | 载荷 | 应然 | FIX7 冻结 | 上一版（被判 FAIL） | **本轮** |
|---|---|---|---|---|---|
| X16 | `env --ignore-environment diskpart` | deny | **deny/deny** | allow/allow ❌ | **deny/deny** ✅ |
| X23 | `env --unset=FOO diskpart` | deny | **deny/deny** | allow/allow ❌ | **deny/deny** ✅ |
| X17 | `env --ignore-environment ls`（守卫） | allow | allow/allow | allow/allow | **allow/allow** ✅ |
| X18 | `env --ignore-environment ls diskpart`（守卫） | allow | allow/allow | allow/allow | **allow/allow** ✅ |
| X19 | `env -i ls diskpart`（守卫） | allow | allow/allow | allow/allow | **allow/allow** ✅ |
| X20 | `env VAR=1 ls`（守卫） | allow | allow/allow | allow/allow | **allow/allow** ✅ |
| X21 | `env -u X ls`（守卫） | allow | allow/allow | allow/allow | **allow/allow** ✅ |
| X24 | `command -p diskpart`（顺带自查 `command` 分支） | deny | deny/deny | deny/deny | **deny/deny** ✅ |
| X25 | `command -v diskpart` | allow | allow/allow | allow/allow | **allow/allow** ✅ |
| X26 | `command diskpart` | deny | deny/deny | deny/deny | **deny/deny** ✅ |

修法：`command` / `env` 两个分支**逐字回到 FIX7 形态**（`command\s+(?:-p\s+)?`、`env\s+(?:(?:-i|-0|-v|-[uCS]\s+[^\s]+|--[a-z-]+[^\s]*|VAR=v)\s+)*`）。

### 2.2 R2（sh 单端；多行 rm 豁免被首行掩蔽）

| # | 载荷（Evaluator 原始 9 条 + 同族邻居） | 应然 | FIX7 冻结 | 上一版（被判 FAIL） | **本轮** |
|---|---|---|---|---|---|
| X28 | `--help\nrm /tmp/t` | deny | deny/deny | deny/**allow** ❌ | **deny/deny** ✅ |
| X29 | `-h\nrm /tmp/t` | deny | deny/deny | deny/**allow** ❌ | **deny/deny** ✅ |
| X30 | `-v\nrm /tmp/t` | deny | deny/deny | deny/**allow** ❌ | **deny/deny** ✅ |
| X31 | `--version\nrm /tmp/t` | deny | deny/deny | deny/**allow** ❌ | **deny/deny** ✅ |
| X05 | `echo rm --help\nrm /tmp/t` | deny | deny/deny | deny/**allow** ❌ | **deny/deny** ✅ |
| X06 | `rm --help\nsudo rm /tmp/t` | deny | allow/allow† | deny/**allow** ❌ | **deny/deny** ✅ |
| X07 | `rm --version\nrm /tmp/t; ls` | deny | allow/allow† | deny/**allow** ❌ | **deny/deny** ✅ |
| X08 | `rm --help\nrm -i /tmp/t` | deny | deny/allow† | deny/**allow** ❌ | **deny/deny** ✅ |
| X09 | `rm --help\n/usr/bin/rm /tmp/t` | deny | allow/allow† | deny/**allow** ❌ | **deny/deny** ✅ |
| X14 | `rm --help\nls -la`（守卫） | allow | allow/allow | allow/allow | **allow/allow** ✅ |
| X15 | `ls -la\nrm --help`（守卫） | allow | allow/allow | **allow/deny** ❌ | **allow/allow** ✅ |
| X32 | `--help\nls -la`（守卫） | allow | allow/allow | allow/allow | **allow/allow** ✅ |
| X10–X13 | `rm --help` / `sudo rm --help` / `rm'' --help` / `/usr/bin/rm --help`（4 条豁免形态） | allow | allow/allow | allow/allow | **allow/allow** ✅ |

† X06–X09 的 FIX7 基线在**两端**并不一致（ps1 已 deny 而 sh allow，或两端 allow）：这些是同族**既存洞**，
本轮的「逐行全取」修法顺带把 sh 拉齐到 ps1 语义（X09 的 FIX7 两端都 allow，本轮两端 deny —— 方向为**收紧**且属**真实删除命令**）。

---

## 3. 反向守卫（源卡 §1 的 6 条 + D7 邻居）

`sudo -u root ls diskpart` / `sudo -n ls dat` / `nice -n 5 cat file` / `env -i ls diskpart` / `cmd /c npm test` / `x diskpart` / `git status`
—— **两端 allow**（三列一致：pre-G3 / FIX7 / 本轮）。另有 **39 条**邻居守卫（`sudo -u root rm --help`、`sudo -u root x diskpart`、
`time -p ls diskpart`、`sudo -v ls diskpart`、`nice --adjustment=5 cat file`、`sudo --user=root ls diskpart`、`env --ignore-environment ls`、
`git commit -m "sudo -u root diskpart"`、`command -v diskpart`、`timeout diskpart` …）全部 allow。

---

## 4. 「过度消费」自查矩阵（**逐包装词**设计的边界，真实 spawn 两端）

| 形态 | 载荷 | FIX7 | 本轮 | 说明 |
|---|---|---|---|---|
| 选项后接**安全命令** | `sudo -u root ls diskpart` | allow | **allow** | 选项消费后 `ls` 才是命令词 |
| `-v` 对 sudo 不吃参 | `sudo -v ls diskpart` | allow | **allow** | 泛化族会误拦 → 本轮修掉 |
| `-p` 对 time 不吃参 | `time -p ls diskpart` | allow | **allow** | 上一版「可选操作数」写法会误拦 → 本轮修掉 |
| `-b` 对 sudo 不吃参 | `sudo -b diskpart` | allow | **deny** | `-b` 后 `diskpart` 仍是命令词（真可执行） |
| `-n` 对 doas 不吃参 | `doas -n diskpart` | allow | **deny** | 同上 |
| `-n` 对 sudo 不吃参 / 对 nice 吃参 | `sudo -n diskpart` / `nice -n 5 diskpart` | allow/allow | **deny/deny** | 逐词选项族让两者各自成立 |
| 非本包装词的选项 | `nice -c 3 diskpart` / `ionice -u root diskpart` / `exec -u root diskpart` | allow | **allow** | **不消费**（防「吃掉任意 token」） |
| 选项终止符 | `sudo -- diskpart` / `sudo -u root -- diskpart` | allow | **deny** | `--` 后 `diskpart` 仍是命令词 |
| 多选项组合 | `exec -a name -c diskpart` / `ionice -c 3 -p 123 diskpart` / `sudo -E -H diskpart` | allow | **deny** | 逐项消费 |
| 长选项 + `=` | `sudo --user=root diskpart` / `nice --adjustment=5 diskpart` | allow | **deny** | 经 `--` + `VAR=v` 项消费 |
| 引号内散文 | `git commit -m "sudo -u root diskpart"` / `echo "nice -n 5 diskpart"` | allow | **allow** | 引号内不是命令位 |
| 包装词粘词 | `sudorm -u root diskpart` / `nicely -n 5 diskpart` / `timeout diskpart` | allow | **allow** | 包装词**整词**匹配 |

---

## 5. 冻结基线**全量**决策对照（238 载荷 × 2 端 = 476 次真实 spawn）

| 项 | 数 |
|---|---|
| 载荷总数 / 可比载荷 | **238 / 238** |
| 决策总数（×2 端） | **476** |
| **allow→deny** | **109** |
| **deny→allow** | **0** ✅ |
| allow→allow | 264 |
| deny→deny | 103 |
| 终版不符应然 | **0** |
| 终版跨端身份分歧 | **0** |

**allow→deny 逐行归因（109 = 84 + 10 + 15，无一条落在「非本轮新增面」）**

| 段 | 端次 | 条目 | 归因 |
|---|---|---|---|
| W | 84 | `sudo -u root diskpart`、`nice -n 5 diskpart`、`ionice -c 3 diskpart`、`doas -u root diskpart`、`exec -a name diskpart`、`time -p diskpart` 等 **42 条 × 2 端** | 源卡 §1 必修（包装词自身选项）—— pre-G3 ps1 本就 deny 的**放松收回** |
| N | 10 | `doas -n diskpart`、`sudo -- diskpart`、`sudo -u root -- diskpart`、`sudo -b diskpart`、`sudo -E -H diskpart` × 2 端 | 同族邻居：全部是**真可执行**的危险命令 |
| X | 15 | `--help\nrm /tmp/t`、`-h\n…`、`-v\n…`、`--version\n…`、`rm --help\nsudo rm…`、`rm --version\nrm…; ls`、`rm --help\n/usr/bin/rm…`（14 端次）+ `rm --help\nrm -i /tmp/t`（sh 端 1 次，FIX7 sh 已 allow） | **R2 修复**：多行「豁免词独占首行 + 真删除」 |
| G/C/H/R | **0** | — | 红线语料**零变化**（含上一版被登记的 `time -p ls diskpart` 收窄 —— 本轮已消除，回归 allow） |

`deny→allow` **逐行**：**（无）**。证据：`_g3fix8r_analyze.txt`（逐行清单）、`_g3fix8r_before_after.md`（238 行三列全表）。

---

## 6. 闸门（R3）

### 6.1 语料结构（**逐修订版**，可 `git show` 复核）

| 修订 | DECISION_CORPUS | IDENTITY_CORPUS |
|---|---|---|
| `5e51b06`（FIX7） | 196 | 20 |
| `98c6f4b`（G24）/ `0e754ed`（HEAD） | **211** | 20 |
| **本轮工作树** | **245** | **24** |

本轮净增 **+29 / +4**：`K88–K99`（12，包装词选项轴）+ `K100–K121`（22：R3 多行族 9 + `env` 长选项 2 + 守卫 11）+ `L21–L24`。
（G24 提交带来的 **+15** 属 M 段，**不是本轮** —— 见 §9-6。）

### 6.2 变异体（**从终版冻结字节派生**，逐字节可复算）

| 变异体 | 单面回退内容 | sha256(16) | 字节 | BOM |
|---|---|---|---|---|
| `MC-sh-no-wrapper-options.sh` | **只回退包装词选项轴**（同结构、选项族置空 → 回到 FIX7 的「包装词 + 空白」） | `dc52ed2d457a4741` | 50810 | False |
| `MC-ps1-no-wrapper-options.ps1` | 同上 | `0c669bfab6c57c90` | 43786 | True |
| `MR-sh-revert-repair.sh` | **回退本轮 Repair**：① `env`/`command` 分支回到收窄版；② `rmsegs` 回到「无 `-n` 的 sed + `case`」 | `851e9e581013125f` | 51752 | False |
| `MR-ps1-revert-repair.ps1` | ① 同形收窄 | `f459bde1c0a060cb` | 44334 | True |
| `M4-redact-passthrough.sh` | `redact_text()` 直通 | `e686c96b614a56cf` | 51785 | False |
| `M2-tab-raw.sh` | TAB 转义退回原样 | `1156f0926217e331` | 51750 | False |

### 6.3 闸门三态（各自**串行**；`node --test packages/core/test/decision-parity.test.ts`）

| 态 | rc | 结果 | **失败集（逐条）** |
|---|---|---|---|
| **base（本轮终版）** | **0** | ✔ 2/2 test pass（判定 parity **245** 条 + 身份 **24** 条），208 s | 无 ✅ |
| **MC（回退包装词选项轴）** | **1** | 跨端判定不一致 **11 / 245** | **恰好 `K88–K96` + `K119,K120`**（= 该轴的**全部**新语料）✅ |
| **MR（回退本轮 Repair）** | **1** | 跨端判定不一致 **12 / 245**；**身份 test 红 1 / 24** | **恰好 `K100–K110` + `K116`**（= R3 新语料中受修复影响者）+ 身份 `L23`（多行守卫对）✅ |

日志：`_g3fix8r_gate_{base,MC,MR}.log`、失败集 `_g3fix8r_gate_{MC,MR}_failset.txt`。

---

## 7. 回归数字（真实 spawn，串行）

### 7.1 sh 四套 × 三棵树（**12/12 rc=0**）

| 套件 | audit | skills | xhs |
|---|---|---|---|
| `sh-hook-test.sh` | 67/67 | 67/67 | 67/67 |
| `sh-audit-bypass.sh` | 192/192 | 192/192 | 192/192 |
| `sh-audit-edge.sh` | 40/40 | 40/40 | 40/40 |
| `sh-failclosed-test.sh` | **34/34** | **34/34** | **34/34** |

### 7.2 ps1 五套 × **三棵树** × **双引擎**（**30/30 rc=0**；R5 后 xhs 树首次纳入）

| 套件 | audit ps5 | audit pwsh7 | skills ps5 | skills pwsh7 | xhs ps5 | xhs pwsh7 |
|---|---|---|---|---|---|---|
| `hook-rules-test.ps1` | 37/37 | 37/37 | 37/37 | 37/37 | 21/21 | 21/21 |
| `hook-bypass-regression.ps1` | **18/18** | **20/20** | **18/18** | **20/20** | 16/16 | 16/16 |
| `hook-fp-regression.ps1` | 8/8 | 8/8 | 8/8 | 8/8 | 5/5 | 5/5 |
| `hook-audit-reregress.ps1` | 59/59 | 59/59 | 59/59 | 59/59 | 53/53 | 53/53 |
| `hook-redact-test.ps1` | 119/119 | 119/119 | 119/119 | 119/119 | —（该树无此套件） | — |

> `hook-bypass-regression` 的 18/20 差异是**该文件自身缺 BOM** 的既存 artefact（D9 已钉），**不是本轮回归**。

### 7.3 redact parity / failclosed 变异

| 项 | rc | 数字 |
|---|---|---|
| redact parity **base** | 0 | tests 3 / pass 3 / fail 0 |
| redact parity **M4** | 1 | **pass 0 / fail 3** ✅ 红 |
| redact parity **M2** | 0 | 3/3（该面由 G5 套件持有） |
| `sh-failclosed` **base** | 0 | **34/34** |
| `sh-failclosed` **M2** | 1 | **31/34** ✅ 红 |

### 7.4 node 全量（**全仓口径**：`packages/**` + `tests/**`，41 个 test 文件，显式路径）

rc=0，**tests 380 / pass 380 / fail 0**（含 decision-parity 245+24 与 redact-parity）。

---

## 8. 副本表（**sh×3 + ps1×7**）

| 组 | 副本 | sha256(16) | 字节 | BOM | CRLF | distinct | 语法 |
|---|---|---|---|---|---|---|---|
| **sh ×3** | audit / `agent-risk-guard/skills/agent-risk-guard/scripts` / `agent-risk-guard-audit-xhs-publish` | `a809ccfb9311f0ec` | 51754 | False ×3 | 0（LF） | **1** ✅ | `bash -n` rc=0 ×3 |
| **ps1 ×7** | audit / `agent-risk-guard/assets/hooks` / `skills/agent-risk-guard/scripts` / **`agent-risk-guard-audit-xhs-publish`（R5 新增）** / `~/.claude/hooks` / `~/.codex/hooks` / `~/.gemini/config/hooks` | `0dfdcd5596f76827` | 44327 | **True ×7** | 0（LF） | **1** ✅ | `Parser::ParseFile` errors=0 ×7 |

`FINAL-CHECK=PASS`（工作树 == audit 源 == 全部 10 份副本；`_g3fix8r_final_check.txt`）。
**R5 事实**：xhs 的 ps1 原为 `9889f367f2944756` / 41948 B / BOM=True —— 实测**与 `0e754ed` 的 HEAD ps1 逐字节相同**，
即「G24 时的 canonical 陈旧副本」，**不是 21 KB 精简变体**（上一版 §8-2 的说法已更正，见 §9-9）；现并入 7 份同步清单。

---

## 9. 上一版报告的 10 处口径更正（Evaluator 逐条实测，**已全部改掉**）

| # | 上一版原文 | 实测事实 | 处置 |
|---|---|---|---|
| 1 | §1.3「捕获组 6 → **17**」 | 该数字取自**中间迭代**。终版（逐包装词）实测 **49**（`grep -oF '('`=50，转义 `\(`=1；`\{` 不是组。`_g3fix8_count_groups.mjs` 逐字符扫描同为 49）；被判 FAIL 的那一版实测 **21**（Evaluator 数） | 本文 §1.2/§1.3 只写**终版 49**，并给出两种独立数法 |
| 2 | §1.3「`grep -o '('` 复算一致」 | **不成立**（该行含 1 个转义 `\(`，直接 `grep -o '('` 会多算 1） | 已改为「50 − 1 转义 = 49」并同时列两种方法 |
| 3 | §1.3「为何等价……与 FIX7 判据逐字兼容」 | **假**（多行场景被首行掩蔽；正是 REJECT 的 R2） | 原论证已删除，改为 §1.3 的「组号无关 + 逐行全取」并给出 13 条 before/after（§2.2） |
| 4 | FIX7 更正块 (b)「`\S+` 会吃掉 `sudo -u root ls diskpart` 的 `ls`」 | **假**：`_g3fix8r_proposed_probe.ps1` 实测 FIX7 提案对 `sudo -u root ls diskpart` = allow（正确）。该提案**真正的**缺陷是漏掉 `nice -n 5 diskpart` / `exec -a name diskpart` / `exec -c diskpart`（三者实测 allow，应 deny） | 已在 FIX7 报告的就地审计块与本文 §1.2 更正 |
| 5 | §1.1「未新增/未删除任何引用」 | sh 侧 `${CMD_PRE}` 引用数：FIX7 **24** → 被判 FAIL 那版 **23**（rmseg 行不再引用）→ 终版 **25**（抽取式引用两次：选行 + 剥离）。ps1 侧提及 `CMD_PRE` 的行数终版 **26**（= FIX7 的 26，引用集逐行相同） | 已按实测改写 |
| 6 | §5.1「语料 196→223，本轮新增 14」 | `5e51b06`=196/20、`98c6f4b`(G24)=211/20、`0e754ed`(HEAD)=211/20、工作树=**245/24**。差额里的 **15 条属 G24 的 M 段**，非本轮 | §6.1 已按修订逐版列数 |
| 7 | §0「node 全量 134/134」 | 134 是 `packages/**` 子集口径；**全仓（+`tests/**`）为 380/380** | §7.4 已写全仓 **380/380** 并注明口径 |
| 8 | §8-2「残余放松面与 FIX7 同判、**未新增**」 | 至少 `env --ignore-environment diskpart` 是**新增放松**（R1） | 已修（§2.1），并在 §10 重新逐条实测残余面 |
| 9 | §8-2「xhs ps1（21 KB 精简变体，不在同步清单）」 | 实测 **41948 B / `9889f367f2944756` = G24 时的 canonical**，且该树原本有 4 套 ps1 套件 | §8 已更正并纳入 **7 份**同步清单，其 4 套 ps1 套件两引擎全绿（§7.2） |
| 10 | §8-2 里 `sudo --user root diskpart` / `env -S 'a b'` 等「与 FIX7 同判」 | **逐条实测后**：`env -S 'a b' diskpart`、`env -S a b diskpart`、`env -Sabc diskpart`、`sudo -Z diskpart`、`sudo --user root diskpart`、`sudo -k diskpart` = FIX7 与本轮**同判 allow**（真残余）；`sudo -u root -- diskpart`、`exec -a name -c diskpart`、`nice --adjustment=5 diskpart`、`sudo -v ls diskpart`、`env --ignore-environment diskpart` 则**相对 FIX7 收紧为 deny** | 见 §10 的逐条三列实测表（`_g3fix8r_residual_{cur,fix7}.txt`） |

---

## 10. 未解决问题 / 残余面（**逐条实测**，非推断）

**A. 真·残余放松面（FIX7 与本轮同判 allow；均属「无锚 \b…\b」时代遗留，本轮不扩大也不收紧）**

| 载荷 | pre-G3 ps1 | FIX7 | 本轮 | 说明 |
|---|---|---|---|---|
| `env -S 'a b' diskpart` / `env -S a b diskpart` / `env -Sabc diskpart` | allow | allow/allow | **allow/allow** | `-S` 的值含空格或粘连形态不覆盖（FIX7 §8-3 曾把它误列为「应然 deny」） |
| `sudo -Z diskpart` | deny | allow/allow | **allow/allow** | 未知选项字母：刻意不纳入（纳入即等于「任意字母都吃参」→ 会制造 `sudo -v ls …` 那类过拦） |
| `sudo --user root diskpart`（长选项 + 空格实参） | deny | allow/allow | **allow/allow** | 只覆盖 `--long=value`，不覆盖 `--long value` |

（守卫类 allow/allow，**非**放松面：`sudo -v ls diskpart`、`time -p ls -la`、`time -p ls diskpart`、`env -i ls diskpart`、`env --ignore-environment ls`、`command -v diskpart`、`x diskpart`。）

**B. 本轮相对 FIX7 的收紧（allow→deny，全部是**真可执行**的危险命令，方向为安全侧）**

`sudo -u root -- diskpart`、`sudo -- diskpart`、`sudo -b diskpart`、`sudo -k diskpart`、`sudo -E -H diskpart`、`doas -n diskpart`、
`exec -a name -c diskpart`、`nice --adjustment=5 diskpart`、`env --ignore-environment diskpart`、`env --unset=FOO diskpart`、
源卡 §1 的 42 条必修形态，以及多行 rm 族（X 段 15 端次）。

**C. 上一版的唯一「主动收窄」已消除**：`time -p ls diskpart` 现为 **allow/allow**（逐包装词选项族后 `-p` 对 time 不吃参）。
**D. 未做**：xhs 树无 `hook-redact-test.ps1`；`skills/agent-risk-guard/tests/hook-redact-test.ps1` 由**并行 worker** 持有（本卡只运行未编辑）；`.github/workflows/ci.yml`、`test-all.ps1` 同样非本卡文件。
**E. 只读 git**：本卡全程未执行 `add/commit/push/checkout/restore/stash/clean`；未触碰既有 385 条未跟踪件（只新增 `_g3fix8*` 证据件）。

---

## 11. 证据清单（`agent-risk-guard/tasks/orchestrator/`）

| 文件 | 内容 |
|---|---|
| `_g3fix8_probe.mjs` / `_g3fix8_corpus.json` | **238 条 × 2 端**串行真实 spawn harness + 语料（W/G/N/X/H/C/R 七段） |
| `_g3fix8r_after.json` / `_g3fix8r_fix7.json` / `_g3fix8_preg3.json` | 终版 / FIX7 冻结 / pre-G3 冻结 全量结果 |
| `_g3fix8r_analyze.mjs` / `_g3fix8r_analyze.txt` / `_g3fix8r_before_after.md` | **allow→deny / deny→allow 逐行清单** + 238 行三列全表 |
| `_g3fix8r_genprefix.mjs` / `_g3fix8r_genprefix.txt` | 逐包装词前缀**生成器**（含括号平衡/组数自检）+ MC 变异体派生 |
| `_g3fix8r_count.sh` / `_g3fix8_count_groups.mjs` / `_g3fix8r_paren.mjs` | 组数（49）与括号平衡的**两种独立数法** |
| `_g3fix8r_proposed_probe.ps1` / `.txt` | §9-4：FIX7 提案形态的 15 条实测表 |
| `_g3fix8r_residual_{cur,fix7}.txt` | §10 残余面/收紧面的**双列实测**（16 条） |
| `_g3fix8r_gate.mjs` / `_g3fix8r_gate_{base,MC,MR}.log` / `_g3fix8r_gate_{MC,MR}_failset.txt` | 闸门三态与失败集 |
| `_g3fix8r_corpus_count.mjs` / `.txt` | 逐修订版语料条数（196/211/245、20/24） |
| `_g3fix8r_redlines.ps1` / `.txt` / `_g3fix8r_suite_*.log`（42 份） | ps1 30 / sh 12 套件原始输出 |
| `_g3fix8r_redact_{base,M4,M2}.log` / `_g3fix8r_failclosed_{base,M2}.log` | redact / failclosed 变异 |
| `_g3fix8r_node_full.log` | node 全仓 380/380 |
| `_g3fix8_mutants/` + `manifest.json` | MC / MR / M4 / M2 四类变异体 |
| `_g3fix8_bom.mjs` / `_g3fix8_sync.mjs` / `_g3fix8_final_check.mjs` | BOM / 同步 / 终版一致性（**sh×3 + ps1×7**） |

---

## 12. 冻结声明（供 Evaluator 复算）

* 工作树终版：**sh `a809ccfb9311f0ec`（51754 B，BOM=False）/ ps1 `0dfdcd5596f76827`（44327 B，BOM=True）**，
  与 audit 源 + 全部副本（sh×3 / ps1×7）**逐字节相同**（`SYNC-CHECK=PASS`、`FINAL-CHECK=PASS`）。
* 冻结基线：`git show <rev>:skills/agent-risk-guard/scripts/dangerous-commands.{ps1,sh}` ——
  pre-G3 `a509afe`、FIX6 `e62d721`、**FIX7 `5e51b06`（ps1 `4dfe66cb2e310933` / sh `f80dabf048c3e98a`）**、HEAD `0e754ed`。
* 可复算：`node tasks/orchestrator/_g3fix8_extract_frozen.mjs`、`_g3fix8r_genprefix.mjs`、`_g3fix8_mutants.mjs`、`_g3fix8_sync.mjs`、`_g3fix8r_gate.mjs`。
