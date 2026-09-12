# IMPLEMENTATION RESULT G3-FIX7 —— 修 FIX6 的括号过拦（A 面）+ 前缀互串放松（B 面）

> 实现者：**Implementer**（不宣布成功；结论交由独立 Evaluator）。
> 输入：`FIX_BRIEF_G3-FIX7.md`（逐条执行）+ `EVALUATION_RESULT_G3-FIX6.md`（第十个 Evaluator 的窄口径 REJECT：**方向是过严**）。
> 全部探针/闸门/红线均为**真实 spawn + 进程 stdin**（D6：ps1 = `powershell.exe -File`，sh = `wsl.exe -e bash /mnt/e/…`），
> **全程串行**（D10），基线一律 `git show <rev>:<path>` 取**冻结字节**（D8），未复用实现者/编排者/前轮 Evaluator 的语料。

---

## 0. 一页速览

| 项 | 结果 |
|---|---|
| **A 面（过拦）** | `\(` `\{` 由**锚位**移入**可重复前缀项**（与 `then\|do\|else` 的处置同构）。任务卡点名的 8 条**全部回 allow**；连同 D7 邻居实测共 **16 条**过拦收回（`A01–A10, A16, A19, A21, A22, G12, G18`）；`(rmdir /s /q x)` / `{ rmdir /s /q x; }` / `if true; then (rmdir /s /q x); fi` 等**真子 shell/块 15/15 仍 deny** |
| **B 面（放松，D12）** | 包装词与 `cmd\|command\|env` 并为**同一个可重复组**（任意顺序、任意嵌套）。任务卡点名的 4 条 + Evaluator §9.4 的 10 条 + D7 邻居共 **30 条 allow → deny**；`env -i` / `env -u NAME` / `env VAR=1` / `command -p` / `cmd /c` **按真实形态**逐个处理 |
| **探针** | **169 条 × 2 端 = 338 次串行 spawn**：FIX6 冻结字节 **50 条不符** → FIX7 **0 条不符**；相对 FIX6 共 **48 条变化 = 16 条放松（A 面过拦收回）+ 30 条收紧（B 面互串收回）+ 2 条假红恢复**（`S14`/`R35` 在 FIX6 那次跑里 sh 端为 `INVALID-JSON`，属 wsl 并发**假红**，按 D10 已在本轮重跑证实为 deny）；两端身份分歧仅剩 **1 条既存项**（`sudorm -rf /tmp/t`，sh 的裸 `rm -rf` 规则，FIX4 起既有） |
| **闸门** | 语料 168 → **196 条**（K60–K87 新增 28 条、L 段 16 → 20 条）；**base 绿**（2/2 test，237 s）；**MA 红（9/196）**、**MB 红（11/196）**，且失败集**恰好**是各自的面对应条目（A→K60–K68、B→K69–K78+K82） |
| **红线** | sh **12/12** rc=0；ps1 **10/10** rc=0；redact A/B/C **3/3 绿** + M4 **0/3 红** + M2 由 `sh-failclosed-test` **31/34 红**；base `sh-failclosed-test` **34/34**；node 全量 **380/380** rc=0 |
| **副本（D9）** | sh ×3 distinct=1（**BOM=False**）；ps1 ×6 distinct=1（**BOM=True 逐份**）；全 **LF**；6/6 ps1 `Parser::ParseFile` **0 error** |
| **报告口径** | `IMPLEMENTATION_RESULT_G3-FIX6.md` §8-3 的「故不是新增过拦」**已改写为实测事实**（见本卡 §A-4） |

---

## 1. 改动逐条对照（**可指代码行**）

### 1.1 定义处（两端**各一处**，仍是「单一定义、全规则引用」）

| 端 | 文件 | 行 | 改动 |
|---|---|---|---|
| ps1 | `agent-risk-guard-audit/scripts/dangerous-commands.ps1` | **L262** | `$CMD_PRE` 定义行②③ 全量重写（见 §2） |
| sh | `agent-risk-guard-audit/scripts/dangerous-commands.sh` | **L442** | `CMD_PRE` 定义行全量重写（同上） |
| sh | 同上 | **L465** | sed 抽取式的实参捕获组 `\6` → **`\7`**（前缀新增 2 个捕获组 `-p`、env 序列；路径项不带括号故不占号） |
| ps1 | 同上 | L239–261 / sh L414–441 | 定义处**注释块**同步重写（写明 A/B 两面机理与实测） |

**引用清单（未新增、未删除任何引用；6 个例外仍单独列明）**

* ps1：定义 **L262** + **18 行 / 19 处**引用 —— `L300, L308, L316, L349, L352, L355, L358, L361, L376(×2), L383, L386, L389, L393, L396, L422, L432, L521, L527`（与 FIX6 §1.4 逐行相同）。
* sh：定义 **L442** + **11 条规则**引用 —— `L451(×3), L456, L465, L476(×6), L488, L502(×2), L509, L572(×5), L584, L618, L626`（与 FIX6 §1.3 逐行相同）。
* **7 处例外一字未动**：ps1 `L100`/`L108`（脱敏 `$1..$4` 组号契约）、`L423`（`$cmdNaked` 插词补查）、`L429`/`L430`（回收站路径合取）；sh `L459–463`（`$cmdtestNoq` 补查）、`L473`（词内插词）、`L581`（`\rm`/`/rm` 变形词头）。

### 1.2 必修 A：`(` `{` **移出锚位**（逐字符对照）

| 端 | FIX6（锚位） | **FIX7（前缀项）** |
|---|---|---|
| ps1 | `(?i)(?:^\|[;&\|\r\n]\|<u>\\(\</u>\|<u>\\{\</u>)\s*(?:…)*(?:path)?(?:cmdenv)?` | `(?i)(?:^\|[;&\|\r\n])\s*(?:…\|<u>\\(\s*</u>\|<u>\\{\s*</u>\|path\|cmdenv)*` |
| sh | `(^\|[;&\|]\|<u>\\(\</u>\|<u>\\{</u>)\s*(…)*(path)?(cmdenv)?` | `(^\|[;&\|])\s*(…\|<u>\\([[:space:]]*</u>\|<u>\\{[[:space:]]*</u>\|path\|cmdenv)*` |

判据（任务卡 §1）：`(` / `{` **只有出现在 行首 / 分隔符后 / 其他前缀项后** 才算命令位。
`\(\s*` 后接 `\s*` 是必要的：`( (rmdir /s /q x) )`（嵌套子 shell）在只写 `\(` 时会漏（实测见 §3 的 S12）。

### 1.3 必修 B：包装词 ↔ `cmd|command|env` **可互串**（逐项处理表）

FIX6 是「包装词\* → 路径 → `(cmd|command|env)`」的**固定顺序**；FIX7 全部并入**同一个可重复组**。

| 前缀项 | 形态 | 处理（两端同形） | 依据 |
|---|---|---|---|
| 包装词 | `sudo time nice nohup setsid doas exec ionice busybox then do else` | `WRAP\s+` / `(WRAP)[[:space:]]+`，**整词**（`\s+` 必需） | `x diskpart` / `timeout diskpart` / `sudorm -rf` 必须仍 allow（K83–K87；`sudorm -rf /tmp/t` 见 §8-2） |
| 子 shell / 块 | `(` / `{` | `\(\s*` / `\{\s*`，`\([[:space:]]*` / `\{[[:space:]]*` | A 面（§1.2） |
| 绝对路径 | `/[^\s;&\|]*/` | **不限顺序**（`command /usr/bin/diskpart`、`/usr/bin/env diskpart` 均可） | D7 邻居；相对路径 `./etc/` 不认（`cat ./etc/mkfs.conf` allow） |
| Windows 包装 | `cmd[.exe] /c ` | `cmd(?:\.exe)?\s+/c\s+` | 既有形态，未变 |
| shell 内建 | `command [-p] ` | `command\s+(?:-p\s+)?` | `-p` **确实执行**；`command -v|-V` **故意不列**（只查路径不执行）→ `command -v diskpart` 仍 allow（G16） |
| `env` 带选项 | `-i -0 -v --xxx`（无参） | `env\s+(?:…)*` 内的无参项 | 任务卡 §2 点名的 `env -i` |
| `env` 带**参数** | `-u NAME` / `-C DIR` / `-S STR` | `-[uCS]\s+[^\s]+` | 任务卡「带参数的包装词按其真实形态处理」；`env -u FOO diskpart` → deny（B19） |
| `env` 赋值 | `VAR=v` | `[A-Za-z_][A-Za-z0-9_]*=[^\s]*` | `env VAR=1 diskpart` → deny（B20） |

**两端对照（节选，全表见 `_g3fix7_before_after.md`）**：全部为 `pre-G3 ps1=deny / sh=allow` → `FIX6 = allow/allow`（**放松**）→ `FIX7 = deny/deny`。

### 1.4 未纳入本卡的相邻面（**如实登记，不靠放松求一致**）

* **包装词自身的选项**（`sudo -u root diskpart`、`nice -n 5 diskpart`、`ionice -c 3 diskpart`、`doas -u root X`、`exec -a n X`）**未处理** → 仍 allow。
  这是与 B 面**同族**的既存缺口（相对 pre-G3 ps1 的无锚规则属放松），但**不在本卡 §2 的清单内**，且逐包装词列全「哪些选项吃参数」有**过度消费 → 新过拦**的风险（本卡不接受再制造 A 面同类问题）。已在 §8 列为**下一卡输入**，并给出可直接采用的精确形态。
* **`rmdir <无标志>` 的既存两端语义分歧**：`if true; then (rmdir); fi` 在 pre-G3 / FIX6 / FIX7 **三列都是两端 allow**（任务卡 §1 把它列为「仍 deny」的自测项，**实测前提不成立**，见 §8-1），本卡**未改变**它。

---

## 2. 前缀新定义（逐字）与引用

```
ps1 L262:
$CMD_PRE = '(?i)(?:^|[;&|\r\n])\s*(?:(?:sudo|time|nice|nohup|setsid|doas|exec|ionice|busybox|then|do|else)\s+|\(\s*|\{\s*|/[^\s;&|]*/|cmd(?:\.exe)?\s+/c\s+|command\s+(?:-p\s+)?|env\s+(?:(?:-i|-0|-v|--[a-z-]+[^\s]*|-[uCS]\s+[^\s]+|[A-Za-z_][A-Za-z0-9_]*=[^\s]*)\s+)*)*'

sh  L442:
CMD_PRE='(^|[;&|])[[:space:]]*((sudo|time|nice|nohup|setsid|doas|exec|ionice|busybox|then|do|else)[[:space:]]+|\([[:space:]]*|\{[[:space:]]*|/[^[:space:];&|]*/|cmd[[:space:]]+/c[[:space:]]+|cmd\.exe[[:space:]]+/c[[:space:]]+|command[[:space:]]+(-p[[:space:]]+)?|env[[:space:]]+((-[i0v]|-[uCS][[:space:]]+[^[:space:]]+|--[a-z-]+[^[:space:]]*|[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*)[[:space:]]+)*)*'
```

* 两端语义同形：**锚** `(^|[;&|])` / `(?:^|[;&|\r\n])` + **可重复前缀项**（包装词 \| 子 shell \| 块 \| 绝对路径 \| cmd /c \| command [-p] \| env [选项\|赋值]）。
* sh 捕获组（`_g3fix7_diag_groups.mjs` 实测）：`\1` 锚 `\2` 序列 `\3` 包装词 `\4` `-p` `\5` env 序列 `\6` env 单项；路径项 `/[^[:space:];&|]*/` **不带括号**故不占组号 → **rm 实参 = `\7`**。
  `sed` 组号写错的后果**可功能验证**：写错即 `invalid reference \N`（本次实测踩到，见 §9 证据 `_g3fix7_diag_hook.mjs`）或抽不到实参 → `rm --help` 由 allow 变 deny。

---

## 3. §A：8 条过拦（+ D7 邻居）三列 before/after

列：`pre-G3`（`a509afe` 冻结字节）/ `FIX6`（`e62d721` 冻结字节）/ **`FIX7`（本卡工作树）**，每格 `ps1/sh`。

| # | 载荷 | 应然 | pre-G3 | FIX6 | **FIX7** |
|---|---|---|---|---|---|
| A01 | `printf '{ diskpart }'`（**验收清单点名**） | allow | allow/allow | **deny/deny** | **allow/allow** ✅ |
| A02 | `echo "(diskpart)"` | allow | allow/allow | **deny/deny** | **allow/allow** ✅ |
| A03 | `echo "{ diskpart }"` | allow | allow/allow | **deny/deny** | **allow/allow** ✅ |
| A04 | `echo '(rm -rf)'` | allow | allow/allow | **deny/allow** | **allow/allow** ✅ |
| A05 | `echo "(rm -rf /)"` | allow | allow/allow | **deny/allow** | **allow/allow** ✅ |
| A06 | `git commit -m "fix (rm -rf)"` | allow | allow/allow | **deny/deny** | **allow/allow** ✅ |
| A07 | `grep -r "(rm -rf)" .` | allow | allow/allow | **deny/deny** | **allow/allow** ✅ |
| A08 | `sed -n 's/(rm -rf)/x/p' f`（`(` 前是 `/`） | allow | allow/allow | **deny/deny** | **allow/allow** ✅ |
| A09 | `ls (rm -rf)` | allow | allow/allow | **deny/deny** | **allow/allow** ✅ |
| A10 | `echo (rm -rf)`（D7 裸括号） | allow | — | **deny/deny** | **allow/allow** ✅ |
| A16 | `git log --grep="(rm -rf)"`（D7） | allow | — | **deny/deny** | **allow/allow** ✅ |
| A19 | `echo "(time diskpart)"`（D7） | allow | — | **deny/deny** | **allow/allow** ✅ |
| A21 | `echo "" (rm -rf)`（D7 前置空引号） | allow | — | **deny/deny** | **allow/allow** ✅ |
| A22 | `printf %s "(rm -rf)"`（D7） | allow | — | **deny/deny** | **allow/allow** ✅ |
| G12 | `x { rmdir /s /q x; }`（D7 非命令词 + 块） | allow | deny/allow | **deny/deny** | **allow/allow** ✅ |
| A11–A15,A17,A18,A20,A23–A25 | `printf "{ rmdir }"` / `echo "{a}"` / `awk '{print $1}'` / `echo {a,b}` / `python -c "print('(rmdir)')"` / `echo "(del /f)"` / `printf '{ rmdir /s /q x }'` / `cat "(nohup rm)"` / `find . -name "(delete)"` / `git commit -m "add { x } doc"` / `sed -i 's/(rm)/y/' f` | allow | — | allow/allow | **allow/allow** ✅ |

**成对守卫：真子 shell / 块（15 条全部两端 deny，A 面修法**没有**退化成「一律 allow」）**

`(rmdir /s /q x)` · `{ rmdir /s /q x; }` · `if true; then (rmdir /s /q x); fi` · `(diskpart)` · `{ del x; }` · `(rm -rf /tmp/t)` · `(time diskpart)` · `{ nohup del x; }` · `echo a; (rmdir /s /q x)` · `(rmdir /s /q x) && echo ok` · `{ format C: /q; }` · `( (rmdir /s /q x) )`（**嵌套**） · `{ time diskpart; }` · `echo a; { rmdir /s /q x; }` · `(/usr/bin/diskpart)` → **15/15 两端 deny** ✅

> ⚠️ **第 16 条 `if true; then (rmdir); fi` 实测两端 allow**（pre-G3 / FIX6 / FIX7 三列一致）：`rmdir` **无标志**在 ps1 端本就不拦（Windows 非递归 `rmdir` 是安全操作，`hook-fp-regression.ps1` 第 5 条钉死 allow），sh 端 `rmdir([[:space:]]|-)` 也不匹配 `rmdir)`。任务卡把它列为「仍 deny」的**前提与实测不符**，本卡如实登记（§8-1），未做任何放松/收紧。

---

## 4. §B：互串矩阵三列（`pre-G3 / FIX6 / FIX7`，每格 `ps1/sh`）

| # | 载荷 | 应然 | pre-G3 | FIX6 | **FIX7** |
|---|---|---|---|---|---|
| B01 | `command time diskpart` | deny | deny/allow | **allow/allow** | **deny/deny** ✅ |
| B02 | `env nice diskpart` | deny | deny/allow | allow/allow | **deny/deny** ✅ |
| B03 | `env sudo diskpart` | deny | deny/allow | allow/allow | **deny/deny** ✅ |
| B04 | `command cmd /c diskpart` | deny | deny/allow | allow/allow | **deny/deny** ✅ |
| B05 | `command sudo diskpart` | deny | deny/allow | allow/allow | **deny/deny** ✅ |
| B06 | `env cmd /c diskpart` | deny | deny/allow | allow/allow | **deny/deny** ✅ |
| B07 | `command nohup rmdir /s /q x` | deny | deny/allow | allow/allow | **deny/deny** ✅ |
| B08 | `env time rmdir /s /q x` | deny | deny/allow | allow/allow | **deny/deny** ✅ |
| B09 | `sudo command time diskpart` | deny | deny/allow | allow/allow | **deny/deny** ✅ |
| B10 | `command env diskpart` | deny | deny/allow | allow/allow | **deny/deny** ✅ |
| B11 | `env -i diskpart` | deny | deny/allow | allow/allow | **deny/deny** ✅ |
| B19 | `env -u FOO diskpart` | deny | deny/allow | allow/allow | **deny/deny** ✅ |
| B20 | `env VAR=1 diskpart` | deny | deny/allow | allow/allow | **deny/deny** ✅ |
| B34 | `command -p diskpart` | deny | deny/allow | allow/allow | **deny/deny** ✅ |
| B12–B15,B18,B24–B28,B30–B33,B35–B37 | `env -i sudo diskpart` · `cmd /c command diskpart` · `env command time diskpart` · `command time env diskpart` · `sudo env -i diskpart` · `env /usr/bin/diskpart` · `sudo env command nohup rmdir /s /q x` · `command env -i time diskpart` · `env nice sudo time nohup diskpart` · `cmd /c env diskpart` · `exec env diskpart` · `env -i VAR=1 diskpart` · `echo a; command time diskpart` · `echo a \| env nice rmdir /s /q x` · 换行形态 · `env -i cmd /c diskpart` · `/usr/bin/command time diskpart` · `env --unset=FOO diskpart` | deny | — | allow/allow | **deny/deny** ✅ |
| B16,B17,B21–B23,B29 | `nice command diskpart` · `time env diskpart` · `time cmd /c rmdir /s /q x` · `nohup cmd /c rmdir /s /q x` · `/usr/bin/env diskpart` · `exec env diskpart` | deny | — | deny/deny（顺序恰好命中） | **deny/deny** ✅（守卫：互串修法**未**把它们改回 allow） |

**反向守卫（B 面修法的边界，必须仍 allow）**

| 载荷 | 结果 |
|---|---|
| `x diskpart` / `x command diskpart` / `x env diskpart` / `x time diskpart` / `x rmdir /s /q x` / `x format C: /q` / `x { rmdir /s /q x; }` | allow/allow ✅ |
| `sudo time nice nohup x diskpart`（多层包装后接**非命令词**） | allow/allow ✅ |
| `timeout diskpart`（`time` ⊄ `timeout`） · `nicely diskpart` · `sudorm --help` | allow/allow ✅ |
| `cmd /c npm test` · `env ls` · `command -v diskpart` · `man command` | allow/allow ✅ |
| `env -i ls diskpart` · `env -u FOO ls diskpart`（`ls` 才是命令，`diskpart` 是它的实参） | allow/allow ✅ |
| `git commit -m "command del docs"` · `git commit -m "env nice diskpart"` · `echo "command time diskpart"` · `echo "env -i diskpart"` | allow/allow ✅ |

---

## 5. 闸门（必修 C）

### 5.1 语料与结构

* 主测试语料 **168 → 196 条**；身份断言语料 `IDENTITY_CORPUS` **16 → 20 条**。
* 新增 **K60–K68（9 条，`expect: allow`）** = §A 的 8 条 + Evaluator 表里的第 9 条 `echo "(rm -rf /)"`。
* 新增 **K69–K82（14 条，`expect: deny`）** = §B 互串（含 `env -i` / `env VAR=1` / `env --unset=` 的真实形态）。
* 新增 **K83–K87（5 条，`expect: allow`）** = 反向守卫（`x diskpart`、`x command diskpart`、`commit -m "env nice diskpart"`、`timeout diskpart`、`sudorm --help`）。
* **L 段补两对**：`L17 { rmdir /s /q x; }`(deny) ↔ `L18 printf '{ rmdir /s /q x }'`(allow)；`L19 if true; then (rmdir /s /q x); fi`(deny) ↔ `L20 grep -r "(rmdir /s /q x)" .`(allow)。
* **无占位符**：语料全部为真实载荷 + 实测应然；每条 `note` 写明机理与基线（含「ps1 冻结基线 pre-G3=deny → FIX6=allow（放松）」这类**可复核**口径）。

### 5.2 变异体（**从终版冻结副本派生**，`_g3fix7_mutants.mjs`，逐字节可复算）

| 变异体 | 单面回退内容 | sha256(16) | 字节 | BOM | 闸门 |
|---|---|---|---|---|---|
| `MA-ps1-paren-in-anchor.ps1` | **仅 A 面**：`\(` `\{` 放回**锚位**（B 面保留可重复组） | `5f6619dcea0a726a` | 41323 | **True** | — |
| `MA-sh-paren-in-anchor.sh` | 同上（sh 端）；捕获组数仍 6 → `\7` 不变 | `23c57598e19ea53f` | 47913 | False | — |
| `MB-ps1-fixed-order.ps1` | **仅 B 面**：恢复「包装词\* → 路径 → cmdenv?」**固定顺序**（A 面保留：`(`/`{` 仍在前缀项里） | `d5fcec8a9c6d0f24` | 41337 | **True** | — |
| `MB-sh-fixed-order.sh` | 同上；捕获组数 6→7，脚本**机械同步** sed 组号 `\7`→`\8` | `7b399383b1d3bb48` | 47945 | False | — |
| `M4-redact-passthrough.sh` | `redact_text()` 直通（+1 行） | `853d61e4bc915e40` | 47968 | False | — |
| `M2-tab-raw.sh` | TAB 转义退回「原样输出」（1 行） | `c1a98b752dbbd811` | 47933 | False | — |

> 派生基底 = **FIX7 终版冻结字节**（sh `f80dabf048c3e98a` / ps1 `4dfe66cb2e310933`，见 `_g3fix7_mutants/manifest.json`）。
> 脚本对 sh 变异体**自动重算** `CMD_PRE` 捕获组数并同步改写 sed 的实参组号（并断言 ≤9，因 GNU sed 的 `\10` 有歧义）——保证变异是「**忠实单面回退**」，而不是顺带把 `rm --help` 豁免也弄坏。

### 5.3 闸门三态实测（三**串行**；`node --test packages/core/test/decision-parity.test.ts`）

| 态 | rc | 结果 | **失败集（逐条）** |
|---|---|---|---|
| **base（FIX7 主源）** | **0** | ✔ 2/2 test pass（判定 parity + 跨端身份），237 s | 无 ✅ |
| **MA（A 面回退）** | **1** | 跨端判定不一致 **9 / 196** | 恰好 `K60,K61,K62,K63,K64,K65,K66,K67,K68` —— **A 面 9 条** |
| **MB（B 面回退）** | **1** | 跨端判定不一致 **11 / 196** | 恰好 `K69,K70,K71,K72,K73,K74,K75,K76,K77,K78,K82` —— **B 面 11 条** |

**A/B 任一改回 → 闸门必红**，且失败集与各自的面**一一对应**（可归因，不混淆）。日志：`_g3fix7_gate_base.log` / `_g3fix7_gate_A.log` / `_g3fix7_gate_B.log`。

---

## 6. 回归数字（真实 spawn；`_g3fix7_redlines.txt` + `_g3fix7_suite_*.log`）

### 6.1 sh 四套 × 三棵树（**12/12 rc=0**）

| 套件 | audit | skills | xhs |
|---|---|---|---|
| `sh-hook-test.sh` | 67/67 | 67/67 | 67/67 |
| `sh-audit-bypass.sh` | 192/192 | 192/192 | 192/192 |
| `sh-audit-edge.sh` | 40/40 | 40/40 | 40/40 |
| `sh-failclosed-test.sh` | **34/34** | **34/34** | **34/34** |

### 6.2 ps1 五套 × 两棵**同步树**（**10/10 rc=0**）

| 套件 | audit | skills |
|---|---|---|
| `hook-audit-reregress.ps1` | 59/59 | 59/59 |
| `hook-bypass-regression.ps1` | 18/18 | 18/18 |
| `hook-fp-regression.ps1` | 8/8 | 8/8 |
| `hook-redact-test.ps1` | 119/119 | 119/119 |
| `hook-rules-test.ps1` | 37/37 | 37/37 |

### 6.3 redact parity 与红线变异

| 项 | rc | 数字 |
|---|---|---|
| redact parity **base（A/B/C 三测）** | 0 | ✔ tests 3 / pass 3 / fail 0 |
| redact parity **M4**（redact 直通） | 1 | tests 3 / **pass 0 / fail 3** ✅ 红 |
| redact parity **M2**（TAB 原样） | 0 | 3/3（该面由 G5 套件持有，符合既有口径） |
| `sh-failclosed-test` **base** | 0 | **34/34** |
| `sh-failclosed-test` **M2** | 1 | **31/34**（3 条红）✅ 红 |

### 6.4 node 全量

`node --test` → rc=0，**tests 380 / pass 380 / fail 0**。

---

## 7. 副本表（D9：BOM 逐份 / 行尾 / distinct）

| 组 | 副本（6 份 ps1 / 3 份 sh） | sha256(16) | 字节 | BOM | CRLF | distinct |
|---|---|---|---|---|---|---|
| **sh ×3** | audit / `agent-risk-guard/skills/agent-risk-guard/scripts` / `agent-risk-guard-audit-xhs-publish` | `f80dabf048c3e98a` | 47937 | **False ×3** | 0（LF） | **1** ✅ |
| **ps1 ×6** | audit / `agent-risk-guard/assets/hooks` / `skills/agent-risk-guard/scripts` / `~/.claude/hooks` / `~/.codex/hooks` / `~/.gemini/config/hooks` | `4dfe66cb2e310933` | 41329 | **True ×6（逐份独立验证 `EF BB BF`）** | 0（LF） | **1** ✅ |

* **D9 补充证据**：6 份 ps1 逐份 `[Parser]::ParseFile` → **errors=0**（`_g3fix7_bom.mjs` 的 BOM 复核 + ParseFile 输出见 §9）。
  （实测踩点：`edit` 工具写回 ps1 会**丢掉 BOM**，脚本 `_g3fix7_bom.mjs --fix` 补回后才同步；**这是本卡第一次跑 ps1 探针时 `EXIT-1` 的真因**，与产品逻辑无关。）
* `agent-risk-guard-audit-xhs-publish/scripts/dangerous-commands.ps1`（21 KB 精简变体，`0b836d6de9278a11` / BOM=True）**不在 6 份同步清单内**，与 FIX4/FIX5/FIX6 一致，**非本轮遗漏**（沿用登记）。

---

## 8. 未解决问题 / 主动收窄（诚实口径）

1. **任务卡 §1 自测项之一的前提不成立（实测）**：`if true; then (rmdir); fi` **三列都是两端 allow**（pre-G3 / FIX6 / FIX7）。
   真因是 **`rmdir` 无标志**：ps1 端按 Windows 语义刻意放行（`hook-fp-regression.ps1` 第 5 条钉住 `rmdir /tmp/empty_dir` = allow），sh 端 `rmdir([[:space:]]|-)` 不匹配 `rmdir)`。
   **本卡未改变它**；真子 shell 守卫由 `(rmdir /s /q x)` / `{ rmdir /s /q x; }` / `if true; then (rmdir /s /q x); fi` 三条持有（§3）。
2. **既存两端分歧（非本轮引入，不入闸门）**：
   * `rmdir <无标志路径>`（sh deny / ps1 allow）与其包装词同构扩展（FIX6 起）——沿用 FIX6 §8-1 登记。
   * `sudorm -rf /tmp/t`（ps1 allow / **sh deny**）：sh 的 `L512` 裸 `rm -rf` 规则**自带无命令位锚**（FIX4/R1 起），把 `su|dorm` 里的 `rm` 也点着。FIX7 未触及该规则（改动它属另一面），故它是 FIX7 探针里**唯一**的跨端身份分歧（169 条中 1 条，且**相对 FIX6 未变化**）。已从闸门 K87 移出、如实登记。
   * `echo "Format-Volume guide"`（sh deny / ps1 allow）——沿用既有登记。
3. **本卡主动收窄（未做，明确登记为下一卡输入）**：**包装词自身的选项**未纳入前缀。**实测表**（`_g3fix7_residual.mjs`，真实 spawn，每格 `ps1/sh`）：

| 载荷 | 应然（按 pre-G3 ps1 基线） | pre-G3 | FIX6 | **FIX7** |
|---|---|---|---|---|
| `sudo -u root diskpart` | deny | **deny**/allow | allow/allow | **allow/allow** ⚠️ |
| `sudo -g users diskpart` | deny | **deny**/allow | allow/allow | **allow/allow** ⚠️ |
| `sudo -n diskpart` | deny | **deny**/allow | allow/allow | **allow/allow** ⚠️ |
| `sudo --user=root diskpart` | deny | **deny**/allow | allow/allow | **allow/allow** ⚠️ |
| `nice -n 5 diskpart` | deny | **deny**/allow | allow/allow | **allow/allow** ⚠️ |
| `ionice -c 3 diskpart` | deny | **deny**/allow | allow/allow | **allow/allow** ⚠️ |
| `doas -u root diskpart` | deny | **deny**/allow | allow/allow | **allow/allow** ⚠️ |
| `exec -a name diskpart` | deny | **deny**/allow | allow/allow | **allow/allow** ⚠️ |
| `time -p diskpart` | deny | **deny**/allow | allow/allow | **allow/allow** ⚠️ |
| `env -S 'a b' diskpart` | deny | **deny**/allow | allow/allow | **allow/allow** ⚠️ |

   这是与 §B **同族**的既存放松（pre-G3 ps1 的无锚规则曾覆盖），**但不在本卡 §2 清单内**（§2 标题是「包装词与 `command|env|cmd /c` **不可互串**」，轴是**交错顺序**；这里是**包装词自身的选项**，另一个轴）。
   逐包装词列全「哪些选项吃参数」有**过度消费 → 新造过拦**的风险（例：把 `sudo -n` 误列为吃参 → `sudo -n ls diskpart` 会误拦），**本卡不接受再制造 A 面同类问题**，故按 D12 第二选项「保留并如实登记」处理，并给出下一卡可直接采用的精确形态：
   * ps1：包装词分支后追加 `(?:-[bEHikKlnsPsv]+\s+|-[ugpCUrthD]\s+\S+\s+)*`（sudo，**只把确实吃参的短选项列进第二组**）、`(?:-n\s+\S+\s+)*`（nice）、`(?:-[cnpP]\s+\S+\s+)*`（ionice）、`(?:-u\s+\S+\s+)*`（doas）、`(?:-a\s+\S+\s+)*`（exec）…
   * sh：同形，注意**每新增一个 `(...)` 都要重算 sed 的实参组号**（本卡已把这步机械化：`_g3fix7_mutants.mjs` 的 `groupCount`/`reseatSed`）。
   * 必须同批补语料：`sudo -u root diskpart`（deny）+ `sudo -u root ls diskpart`（allow）+ `sudo -n ls diskpart`（allow，防误列吃参选项）。
4. **`env` 的解析边界**：`env -S 'a b' diskpart`（`-S` 的值里含空格，实测 allow，见 §8-3）与 `env -iS…` 这类粘连形态不覆盖。`command -v|-V` **刻意不覆盖**（只查路径、不执行），故 `command -v diskpart` 保持 allow（闸门外的探针 G16）。
5. **未做**：xhs 树的 ps1（21 KB 精简变体，不在同步清单）本轮未动、未跑其自有套件（与 FIX4/FIX5/FIX6 一致）；`hook-redact-test` 夹具未改（本轮不涉及脱敏面）。

---

## 9. 证据清单（`agent-risk-guard/tasks/orchestrator/`）

| 文件 | 内容 |
|---|---|
| `_g3fix7_probe.mjs` / `_g3fix7_before.json` / `_g3fix7_after.json` / `_g3fix7_preg3.json` | **169 条 × 2 端**串行真实 spawn harness + 三份结果（FIX6 冻结 / FIX7 终版 / pre-G3 冻结，焦点子集 30 条） |
| `_g3fix7_before.log` / `_g3fix7_after.log` / `_g3fix7_preg3.log` | 三次探针原始控制台 |
| `_g3fix7_analyze.mjs` / `_g3fix7_analyze.txt` / `_g3fix7_before_after.md` / `.txt` | 三列合并分析（169 条中 **48 条变化**：**16 条放松** = A 面过拦收回 `A01–A10/A16/A19/A21/A22/G12/G18`；**30 条收紧** = B 面互串收回 `B01–B15/B18–B20/B24–B28/B30–B36`；另 2 条 `S14`/`R35` 是 FIX6 跑次的 wsl 假红恢复；FIX7 不符应然 **0 条**） |
| `_g3fix7_extract_frozen.mjs` / `_g3fix7_baseline/` + `manifest.json` | `git show` 取出的 **7 份冻结字节**（pre-G3/FIX4/FIX5/FIX6 × 两端）+ 哈希（**与 Evaluator G3-FIX6 §1 独立复算逐字相同**） |
| `_g3fix7_bom.mjs` | ps1 BOM 复核/修复（**逐份** `EF BB BF`）+ CRLF/distinct |
| `_g3fix7_diag_groups.mjs` / `_g3fix7_diag_hook.mjs` | sh `CMD_PRE` 捕获组计数 + `sed \\N` 逐号实测（定位并证实 `\7`；也复现了 `invalid reference \8` 的**写错即报错**特性） |
| `_g3fix7_residual.mjs` / `_g3fix7_residual.txt` | §8-3/§8-4 残留面的**实测表**（包装词选项 9 条 + `env -S` 边界，三列 `pre-G3/FIX6/FIX7`） |
| `_g3fix7_sync.mjs` / `_g3fix7_sync.txt` | 同步 sh×3 / ps1×6 + **distinct/BOM/CRLF 逐份复核**（SYNC-CHECK=PASS） |
| `_g3fix7_mutants.mjs` / `_g3fix7_mutants.txt` / `_g3fix7_mutants/` | **从终版冻结副本派生**的 6 个变异体（MA/MB 单面回退 + M4/M2）+ sha/字节/BOM + 组数自动重算 |
| `_g3fix7_gate_base.log` / `_g3fix7_gate_A.log` / `_g3fix7_gate_B.log` | 闸门三态（绿 / A 红 9 / B 红 11） |
| `_g3fix7_redlines.ps1` / `_g3fix7_redlines.txt` / `_g3fix7_redlines_console.log` | **串行**跑全部红线（sh×12 / ps1×10 / redact A·B·C + M4 + M2 / failclosed M2 / 闸门变异 / node 全量） |
| `_g3fix7_suite_*.log`（22 份）/ `_g3fix7_redact_*.log` / `_g3fix7_failclosed_M2.log` / `_g3fix7_node_full.log` | 各套件与变异的原始输出 |
| `_g3fix7_smoke.json` | 关键子集冒烟（52/52，含 A/B/守卫/回归） |

**报告口径更正（必修 C-6 的另一半）**：`IMPLEMENTATION_RESULT_G3-FIX6.md` **§8-3** 已改写——原文「`(`/`{` … **故不是新增过拦**」改为实测事实：
ps1 的 `rm` 族在 pre-G3 **本来就是命令位锚**（无锚的只有 `format/diskpart/del/erase/ri/rd/rmdir` 的 `\b…\b`），sh 端 `\(` `\{` **历来不存在**，
故 A 面 9 条（含验收清单点名的 `printf '{ diskpart }'`）**确属 FIX6 新造过拦**；连同 D7 邻居共 **16 条**已由 G3-FIX7/A 修复（`_g3fix7_before_after.md` 逐条三列）。
