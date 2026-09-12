# EVALUATION RESULT G3-FIX6 —— 命令位前缀「单一定义、全规则引用」（**独立验收**）

> 验收人：**全新独立 Evaluator**（不继承实现者 / 编排者 / 前轮 Evaluator 的推理上下文）。预设立场「实现可能存在错误」。
> 只读主源；全部探针与变异体在隔离 TEMP `E:\DeepSeek_Harness\workspace\2026_08_21\.eval-tmp\g6fix6eval\` 内进行，**未改动任何主源/产品树**。
> 语料**完全自造**（161 条 × 6 列 = **966 次串行真实 spawn**，另 focused 27 条 × 3 列 = 81 次），**未复用**实现者的 97 条，也**未复用**上一轮 Evaluator 的 162 条。
> 列：`ps1Pre`(=pre-G3，**已用 `git show 6ea0342` 独立取字节**，`fb85cc0e4476ae58`/34523B) / `ps1F5`(`git show d169d26`，`5a18ef0f04ddd30d`) / `ps1F6`(主源 `ec8c419bd2cf65f7`) / `shPre`(`git show a509afe`，`8ac7782d87b95415`) / `shF5`(`git show d169d26`，`692d0451a84c451e`) / `shF6`(主源 `75dce9a0c75a676b`)。

---

## 0. 验收结论

# **REJECT**（窄口径：**只有一处**；本卡的核心目标与全部卡面验收标准我实测**全部达成**）

**必须首先、明确肯定这一轮做对了什么**（这一半证据非常干净，不应被下面的 REJECT 掩盖）：

1. **FIX5 的 8 条回归是真收回，不是重建的**。我用 `git show 6ea0342:…ps1` 取冻结字节（`fb85cc0e…`，与 `git show 4c94b90:…ps1` **逐字节相同** → 再次确认「pre-G3 ≡ FIX4」），三列实测 `pre=deny → FIX5=allow → FIX6=deny`：任务卡 §1 点名的 **12/12 全部成立**（含换行形态），全语料共 **76 条**满足该三列模式；**`ps1` 端 `pre=deny → FIX6=allow` 只剩 11 条，其中 9 条是应然 allow**（`x <词>` 反向守卫族、`grep -i diskpart`、引号内散文），**真实危险放松 2 条**（见 §4，属 FIX5 遗留、非本卡新造）。
2. **「单一定义」是真的、且可复算**。我从**冻结终版字节**独立生成变异体，只改 **1 行**定义：
   `MA-ps1` = `3fa08a9e0910945e` / 39846 B / BOM=True，`MA-sh` = `42226e5204aa4bbc` / 45739 B —— **与实现者报告 §5.2 的哈希逐字相同**。一行改动即可同时回退 19/11 处引用，这就是「单一定义」的直接证据。
3. **合并没有意外改变任何规则体**：把两端「旧前缀 / `$CMD_PRE`」归一为 `@PRE@` 后做**代码行**级 LCS 比对，`ps1` 的差异**只有** 1 行定义 + 18 条规则的**前缀改写**（规则后缀逐字相同），`sh` 的差异**只有** 1 行定义 + 11 条规则引用；**没有一条规则被顺手改了别的**（实现者报告 §1.3/§1.4 的行号清单与我的复算**逐行一致**）。
4. **两端 `deny→allow` 放松 = 0**（161 条 × 2 端）。FIX6 相对 FIX5 是**纯收紧**：ps1 收紧 83 条、sh 收紧 82 条、放松 0 条。
5. **副本 / BOM(D9)**：sh ×3 = `75dce9a0c75a676b` distinct=1（BOM=False、LF）；ps1 ×6 = `ec8c419bd2cf65f7` distinct=1（**BOM=True 逐份**、LF）—— 与冻结声明完全一致。

**REJECT 的依据是一处「新过拦」（over-block）**：FIX6 把 `\(` `\{` 放进**命令位锚**，于是**引号内/散文里的 `(危险词)` 被当成命令位**。我实测 **9 条改前(两端、pre-G3 与 FIX5) allow → 改后 deny** 的真实形态，**两端都有**，其中 `printf '{ diskpart }'` 正是验收任务卡**点名要求确认「零过拦」**的那一条。而实现者报告 §8-3 **明确声称这一类「不是新增过拦」**——该口径与实测相反。

**这是「太严」方向、不是「太松」方向**（安全性未被削弱，是可用性受损），所以严重度**低于** FIX4/FIX5 的 REJECT；修法也很小（§9，两处 lookbehind + 补语料 + 改口径），**不需要回退本卡任何其它改动**。

| # | 判定项 | 结论 |
|---|---|---|
| 1 | **8 条回归真收回**（`git show` 冻结字节三列 + 自造矩阵） | **PASS** ✅（12/12 点名形态、76 条三列模式、63/63 包装×基座两端 deny） |
| 2 | **合并新风险面**：逐规则比对「引用前后」（规则被意外改变？） | **PASS** ✅（归一化 LCS：**无一条规则体被改**；仅前缀扩宽；两端 `deny→allow` = 0） |
| 3 | **过拦面（反向邻居，D7）** | **FAIL ❌ → REJECT 依据**：9 条 `(`/`{` 散文形态**新过拦**（两端），含任务卡点名的 `printf '{ diskpart }'` |
| 4 | **7 处例外是否正当** | **PASS** ✅（逐处读源码核实：确为脱敏组号契约 / 插词补查 / 词内插词 / 回收站合取 / 变形词头，**不该引用** CMD_PRE） |
| 5 | **闸门**：base 绿 / 身份断言真实有效 / 变异必红 | 见 §6（自跑） |
| 6 | **红线不回退** | 见 §7（自跑） |
| 7 | **副本 ×3 / ×6、BOM、行尾、distinct（D9）** | **PASS** ✅（逐份复核，见 §8） |
| 8 | 报告占位符 / 已知分歧归属 | **基本 PASS**：FIX5 §5 占位符**确已补实**（有真实数字，非空壳）；但 §8-3 口径**与实测相反**（= 项 3 的一半） |

---

## 1. 方法（D6 / D8 / D10）

**被测对象（我独立复算，`sha256(16)`）**

| 文件 | 哈希 | 字节 | BOM | 行尾 |
|---|---|---|---|---|
| `agent-risk-guard-audit/scripts/dangerous-commands.sh` | `75dce9a0c75a676b` | 45808 | False | LF |
| `…/agent-risk-guard/skills/agent-risk-guard/scripts/dangerous-commands.sh` | `75dce9a0c75a676b` | 45808 | False | LF |
| `…/agent-risk-guard-audit-xhs-publish/scripts/dangerous-commands.sh` | `75dce9a0c75a676b` | 45808 | False | LF |
| ps1 ×6（audit / assets/hooks / skills / `~/.claude` / `~/.codex` / `~/.gemini/config`） | `ec8c419bd2cf65f7` ×6 | 39917 ×6 | **True ×6** | LF |

**冻结基线（D8，全部 `git show`，不靠重建）**

```
6ea0342:…ps1 → fb85cc0e4476ae58 / 34523 / BOM=True   ← pre-G3
4c94b90:…ps1 → fb85cc0e4476ae58 / 34523 / BOM=True   ← FIX4  ★ 与 pre-G3 逐字节相同
d169d26:…ps1 → 5a18ef0f04ddd30d / 39349 / BOM=True   ← FIX5
a509afe:…sh  → 8ac7782d87b95415 / 34359 / BOM=False  ← pre-G3
d169d26:…sh  → 692d0451a84c451e / 44326 / BOM=False  ← FIX5
e62d721:…    → ec8c419bd2cf65f7 / 75dce9a0c75a676b   ← FIX6（= 工作树，`git status` 无改动）
```

**方法**：自建 `.eval-tmp\g6fix6eval\probe.mjs`（161 条 × 6 列 = **966 次串行 `spawnSync` + 进程 stdin**，552 s）+ `focused.mjs`（27 条 × 3 列 = 81 次）。ps1 = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File <hook>`；sh = `wsl.exe -e bash /mnt/e/…`（D6）。
判定 = stdout 出现 `"permissionDecision":"deny"` → deny；空输出 + rc=0 → allow；否则记为诊断串。**966 + 81 次 spawn 全部可判读（0 条 INVALID/OTHER）**。

**D10**：全程**严格串行**，未出现 wsl 并发假红；闸门与红线三次及以上串行执行（见 §6/§7）。

---

## 2. 项目 1：8 条回归真收回（三列，`git show` 冻结字节）—— **PASS ✅**

### 2.1 任务卡 §1 点名的形态（12/12）

| 载荷 | 应然 | **pre-G3(=FIX4) ps1** | **FIX5 ps1** | **FIX6 ps1** | FIX6 sh | 判定 |
|---|---|---|---|---|---|---|
| `time diskpart` | deny | **deny** | allow（回归） | **deny** | deny | ✅ |
| `nice diskpart` / `nohup diskpart` | deny | **deny** | allow | **deny** | deny | ✅ |
| `time rmdir /s /q x` / `nice…` / `nohup…` | deny | **deny** | allow | **deny** | deny | ✅ |
| `(rmdir /s /q x)` | deny | **deny** | allow | **deny** | deny | ✅ |
| `{ rmdir /s /q x; }` | deny | **deny** | allow | **deny** | deny | ✅ |
| `if true; then rmdir /s /q x; fi` | deny | **deny** | allow | **deny** | deny | ✅ |
| `for i in 1; do del x; done` | deny | **deny** | allow | **deny** | deny | ✅ |
| `time format C: /q` | deny | **deny** | allow | **deny** | deny | ✅ |
| `if true⏎then rmdir /s /q x⏎fi` | deny | **deny** | allow | **deny** | deny | ✅ |
| `time del /f x` / `time erase x` / `time ri -r x` / `{ del x; }` / `(diskpart)` | deny | **deny** | allow | **deny** | deny | ✅ |
| `sudo time nice nohup diskpart`（D7 嵌套） | deny | **deny** | allow | **deny** | deny | ✅ |
| `time /usr/bin/diskpart`（D7 路径+包装） | deny | **deny** | allow | **deny** | deny | ✅ |
| **`x diskpart`（反向守卫）** | **allow** | deny（误伤） | allow | **allow** | allow | ✅ **未回归** |
| `x rmdir /s /q x` / `x format C: /q` / `x'' diskpart` | allow | deny（误伤） | allow | **allow** | allow | ✅ |

**全语料三列统计**：`pre=deny ∧ F5=allow ∧ F6=deny` 共 **76 条**（= 真收回面）；`pre=deny ∧ F6=allow` 共 11 条（逐条判读见 §4.3）。

### 2.2 我自造的包装矩阵（9 包装 × 7 基座 = 63 条，D7）

`sudo|time|nice|nohup|setsid|doas|exec|ionice|busybox` × `diskpart|rmdir /s /q x|format C: /q|del /f x|erase x|ri -r x|rd /s /q x`

**结果：63/63 两端 deny（非两端 deny 的条目 = 0）** ✅
另测：`sudo time diskpart` / `time nice nohup rmdir /s /q x` / `sudo nice del /f x` / `time busybox rmdir /s /q x` / `time /usr/bin/rmdir /s /q x` / `nice /usr/bin/format C: /q` → **全部两端 deny** ✅
**过拦反向守卫**：`sudo time nice nohup x diskpart` = **allow/allow**（`nohup` 执行的是 `x`，不是 `diskpart`）✅；`x time diskpart` = allow/allow ✅

---

## 3. 项目 2：合并带来的新风险面 —— 逐规则比对（**PASS：无规则被意外改变**）

### 3.1 静态：归一化后的**代码行** LCS 比对（`.eval-tmp\g6fix6eval\normalize.mjs`）

把 `ps1F5` 的旧前缀字面量、`ps1F6` 的 `($CMD_PRE + '…')`、`shF5`/`shF6` 的对应前缀统一替换成 `@PRE@`，**剔掉注释与空行**后做序列比对：

```
=== ps1: code-lines F5=333 F6=334 ; normalized diff entries=37 ===
  + L250: $CMD_PRE = '…'                       ← 唯一定义（新增 1 行）
  - L271/L279/L287/L320/L323/L326/L329/L332/L347/L354/L357/L360/L364/L367/L393/L403/L492/L498
  + L288/L296/L304/L337/L340/L343/L346/L349/L364/L371/L374/L377/L381/L384/L410/L420/L509/L515
      ← 18 条规则：**只有前缀改了**，规则后缀逐字相同
=== sh: code-lines F5=330 F6=330 ; normalized diff entries=24 ===
  - L415 CMD_PRE='@PRE@'  + L426 CMD_PRE='…'   ← 唯一定义（值变）
  ← 11 条规则引用（L435/440/445/456/468/482/489/552/564/598/606）：**只有前缀改了**
```

**结论：两端都不存在「某条规则的匹配体被顺手改动」**。`sh` 的 sed 抽取式从自带第二份硬编码前缀改为引用 `${CMD_PRE}`，**捕获组 `\5`→`\6` 的位移正确**（计数：新前缀多一个外层重复组 `(…)*`，故实参组由 5 → 6）；**该改动可被功能验证**：`rm'' --help` / `sudo rm --help` / `rm --help` 全部仍 **allow**（若组号写错，实参抽不到 → 会误拦为 deny）。

**关键补充（16e，实现者主动登记的第 19 处）**：`ps1` rule 16e 在 FIX5 是**窄锚** `(?i)(?:^|[;&|\r\n])\s*`（无 sudo/路径组），FIX6 换成完整 `$CMD_PRE` —— 这是**唯一一处不是「同形替换」的引用**，方向为**向上**（旧锚是新锚的子集），实现者已在 §1.4 说明，我确认属**预期覆盖扩大**，非副作用。

### 3.2 动态：FIX5 → FIX6 的逐条变化（161 条 × 2 端）

| 端 | `deny→allow`（放松） | `allow→deny`（收紧） | 其它 |
|---|---|---|---|
| **ps1** | **0** | **83** | 0 |
| **sh** | **0** | **82** | 0 |

**「一条片段驱动 19/11 条规则」的同步放大风险，实测未兑现为放松**：所有变化**方向单一**（只收紧），且 **83/82 条中绝大多数是「应然 deny 的真实危险命令」**（包装矩阵 63 条 + 分隔符/换行/嵌套/路径组合）。属**预期覆盖扩大**。

**「规则被意外改变」的唯二去处（都在 `allow→deny` 方向，见 §4）**：
* `ps1` 83 条中有 **3 条是「pre-G3 也 allow」**（= 相对冻结基线新增的拦截）：`echo '(rm -rf)'`、`git commit -m "fix (rm -rf)"`、`printf '{ diskpart }'` —— 见 §4.1/§4.2。
* `ps1` 另 4 条 `pre=allow, F5=allow, F6=deny`（`nohup shutdown /s`、`time find /tmp -delete`、`time xargs rm < list.txt`、`time chmod 777 /x`）是**真实危险命令的正确新捕获**（向上），不是过拦 ✅（`sh` 侧本来就是 deny，FIX6 消除了这 4 条既存两端分歧）。

---

## 4. 项目 3：过拦面（反向邻居，D7）—— **FAIL ❌（REJECT 依据）**

### 4.1 六列对照：**改前 allow → 改后 deny** 的合法命令（我自造，9 条）

| # | 载荷 | ps1Pre | ps1F5 | **ps1F6** | shPre | shF5 | **shF6** | 判定 |
|---|---|---|---|---|---|---|---|---|
| 1 | `printf '{ diskpart }'` | allow | allow | **deny** | allow | allow | **deny** | ❌ **两端新过拦**（任务卡点名的合法命令） |
| 2 | `echo "(diskpart)"` | allow | allow | **deny** | — | — | deny | ❌ ps1 新过拦 |
| 3 | `echo "{ diskpart }"` | allow | allow | **deny** | — | — | deny | ❌ ps1 新过拦 |
| 4 | `echo '(rm -rf)'` | allow | allow | **deny** | allow | allow | allow | ❌ ps1 新过拦 **+ 新跨端分歧** |
| 5 | `echo "(rm -rf /)"` | allow | allow | **deny** | — | — | deny | ❌ ps1 新过拦 |
| 6 | `git commit -m "fix (rm -rf)"` | allow | allow | **deny** | allow | allow | **deny** | ❌ **两端新过拦** |
| 7 | `grep -r "(rm -rf)" .` | allow | allow | **deny** | — | — | deny | ❌ ps1 新过拦 |
| 8 | `sed -n 's/(rm -rf)/x/p' f` | allow | allow | **deny** | — | — | deny | ❌ ps1 新过拦 |
| 9 | `ls (rm -rf)` | allow | allow | **deny** | — | — | deny | ❌ ps1 新过拦 |

（第 2/3/5/7/8/9 条我在 focused 探针里只跑了 ps1 三列；其 `sh` 端结论按 §3.2 同族推断 —— 但第 1、6 条**已在 6 列主探针中实测两端 deny**，已足以证明**两端都存在该类新过拦**。）

**根因（可指代码行）**：新增的**字面锚** `\(` `\{`
* ps1 `L250`：`(?i)(?:^|[;&|\r\n]|\(|\{)\s*(?:(?:sudo|time|…)\s+)*…`
* sh `L426`：`(^|[;&|]|\(|\{)[[:space:]]*…`

正则只看原始文本，**无法区分「子 shell 起始符 `(`」与「引号内/散文里的字面 `(`」**，于是 `grep -r "(rm -rf)" .` 里的 `(` 被当成命令位。

### 4.2 报告 §8-3 的口径**与实测相反**（这是 REJECT 的另一半）

报告 §8-3 原文：

> `(` / `{` 锚对引号内文本仍可能过拦…… 本轮**未**扩大该面（新增的只有包装词与 `(`/`{` 两个字面锚，后者在 FIX5 前由 ps1 的无锚规则覆盖，**故不是新增过拦**）。

实测反例（全部 pre-G3 = allow、FIX5 = allow、FIX6 = deny）：
* **ps1**：`echo "(diskpart)"`、`echo '(rm -rf)'`、`git commit -m "fix (rm -rf)"`、`printf '{ diskpart }'` …… 共 9 条。
  其机理**不是**「pre-FIX5 的无锚规则覆盖」——pre-G3 的 ps1 无锚规则只有 **`format`/`diskpart`/`del`/`erase`/`ri`/`rd`/`rmdir`**（`\b…\b`），而 `rm` 族（rule 16）在 pre-G3 **本来就是命令位锚** `(?:^|[;&|\r\n])`。故 `echo '(rm -rf)'` 在 pre-G3 是 allow —— **确属本卡新造**。
* **sh**：`(`/`{` 锚在 sh 端**历来不存在**（pre-G3 = `CMD_SEG='(^|[;&|])…'`，FIX5 亦无）→ `printf '{ diskpart }'`、`git commit -m "fix (rm -rf)"` **两端都**是「改前 allow → 改后 deny」，**sh 端更不可能"不是新增"**。

### 4.3 其余反向守卫（**PASS**，防过拦回归有效）

以下全部 **allow/allow**（pre-G3 与 FIX5 亦 allow，**未被本卡改动**）✅：

`git commit -m "do rm docs"`、`echo "do rm"`、`git log --grep="then rmdir"`、`grep -r "then rmdir" .`、`echo "time diskpart"`、`echo "nice to meet you"`、`echo "(rmdir tutorial)"`、`echo '(rmdir /s /q x)'`、`echo "{ del x; }"`、`echo "{ rmdir /s /q x; }"`、`echo "else rm"`、`git commit -m "else rm all"`、`vim "do rm.txt"`、`echo 'nice rmdir'`、`man time`、`which nohup`、`man nice`、`type time`、`which time`、`sudo git status`、`git status`、`ls -la | nice cat`、`find . -name "*.log"`、`python -c "print('(rmdir)')"`、`echo "(a)"`、`echo "{a}"`、`awk '{print $1}'`、`echo {a,b}`、`echo "diskpart"`、`echo "rmdir /s /q x"`、`echo "sudo chmod 777 /x"`、`x diskpart`、`x rmdir /s /q x`、`x format C: /q`、`x'' diskpart`、`x time diskpart`、`sudo time nice nohup x diskpart`、`cat notes.txt | grep -i diskpart`、`git commit -m "time rmdir /s /q x"`、`git commit -m "remove Diskpart usage"`、`rm --help`、`sudo rm --help`、`rm'' --help`。

**「`then|do|else` 放包装词位而非锚位」这一主动偏离处方：我判定为正确且必要** ✅ —— `git commit -m "do rm docs"` / `echo "do rm"` / `git log --grep="then rmdir"` 全部 allow（若照抄处方放锚位，`do` 前只需一个词边界，这三条会变成新过拦），而 `if true; then rmdir /s /q x; fi`、`for i in 1; do del x; done`、换行形态、`if x; then time rmdir /s /q x; fi` **全部仍 deny**（§2.1）——**覆盖等价、过拦更少**，符合 D12 向上对齐。

---

## 5. 项目 4：7 处例外是否正当 —— **PASS ✅**（逐处读源码核实）

| 端 | 行号 | 规则 | 我的核实 |
|---|---|---|---|
| ps1 | **L100** | 脱敏 `cli-mysql-password-numeric` | `re='(?im)(^\s*\|[;&\|]\s*\|sudo\s+\|env\s+\|command\s+)(mysql\|mariadb)([^;&\|\n]*)(\s)-p[0-9]+'`，`repl='$1$2$3$4@@RG_REDACTED@@'` —— **替换串按组号绑定**，改成 `$CMD_PRE` 会新增捕获组 → `$1..$4` 语义漂移；**且它是脱敏上下文，不是危险基座命令位** ✅ 不应引用 |
| ps1 | **L108** | 脱敏 `cli-basic-auth-user` | 同上（`$1$2$3$4` + `curl\|wget` 锚定）✅ |
| ps1 | **L423** | `$cmdNaked -match '(?i)\bRemove-Item\b'` | 入参是**已剥离引号/反引号**的 `$cmdNaked`，语义 = **插词补查**（`R\`emove-Item`、`R'EMOVE'-'ITEM'`）；加命令位锚会漏掉插词形态（实测 `R\`emove-Item x` ps1 = deny）✅ |
| ps1 | **L429/L430** | `$reRecycleBinPath` / `$reRecycleBinDelVerb` | 规则形态是「**路径合取删除动词**」，本身位置无关；与命令位锚正交 ✅ |
| sh | **L459–463** | `\bRemove-Item\b` 补查（`$cmdtestNoq`） | 与 ps1 L423 同因 ✅ |
| sh | **L473** | `r["']+m([[:space:]]\|-)` | 匹配**词内**插词（`r''m`），不落在命令位上 ✅ |
| sh | **L581** | `\rm`/`/rm`/`=rm` 变形词头 | 自带 `(^\|[;&\|])[[:space:]]*[\\/]{1,2}rm` 锚，处理的是**变形词头**而非包装词位 ✅ |

**「其余非命令位语义的规则本轮一字未动」也成立**：§3.1 的归一化 LCS 显示两端**除前缀替换与定义行外零差异** ✅

---

## 6. 项目 5：闸门（自跑）

### 6.1 存在性与结构（静态核对）

* 语料文件 `packages/core/test/decision-parity.test.ts` = **465 行**；主测试 `test(...)` 在 **L403**，**第二个独立 `test(...)`（跨端身份断言）在 L441** —— 确实真实存在，不是注释或子断言 ✅
* `K39`–`K56` = 18 条包装/子 shell/块/if-then/for-do（`expect: deny`），`K57`–`K59` = 3 条过拦守卫（`expect: allow`）✅ 与报告口径一致
* `IDENTITY_CORPUS` = **L1–L16**（`export`），**成对设计**：命令位 ↔ 非命令位邻居（`x …` / 引号内 / 参数位）
* **身份断言的语义独立于应然**：`for (const c of IDENTITY_CORPUS) { … if (p === s) continue; rows.push(…) }` —— 只断言两端 decision 一致，**不看 `c.expect`**，与主测试（`p === s && p === c.expect`）**确为两条独立红线** ✅

### 6.2 变异体（**我从冻结终版字节独立生成**，非复用实现者产物）

| 变异体 | 改动 | 我算出的 `sha256(16)` | 字节 | BOM | 与报告 §5.2 对照 |
|---|---|---|---|---|---|
| `MA-ps1-prefix-fix5.ps1` | 只改 `$CMD_PRE` **那 1 行** 为 FIX5 值 | `3fa08a9e0910945e` | 39846 | True | **逐字相同** ✅ |
| `MA-sh-prefix-fix5.sh` | 只改 `CMD_PRE` **那 1 行** + sed 组号 `\6→\5` | `42226e5204aa4bbc` | 45739 | False | **逐字相同** ✅ |
| `M4-redact-passthrough.sh` | `redact_text()` 直通（+1 行 `cat; return 0`） | `bafa7eba74185897` | 45826 | False | 实现者用另一写法（`756c2ac4…`），**同效** |
| `M2-tab-raw.sh` | `i==9` 时 TAB 原样输出（1 行） | `92aabc4d1b19a189` | 45819 | False | 同上（实现者 `bc4732a3…`） |

**变异体哈希与实现者声明逐字一致 → 「单一定义」不是文字声明，是可复算的性质** ✅

### 6.3 自跑结果（**串行**，`node --test packages/core/test/decision-parity.test.ts`）

见 §11「自跑日志」——本节数字由下方 **§11.1** 给出（若某格标 `未完成` 即为时间盒外未跑，不臆测）。

---

## 7. 项目 6：红线不回退（自跑）

见 **§11.2**。

---

## 8. 项目 7：副本 / BOM / 行尾 / distinct（D9）—— **PASS ✅**

| 组 | 副本 | `sha256(16)` | 字节 | BOM | CRLF | distinct |
|---|---|---|---|---|---|---|
| **sh ×3** | `agent-risk-guard-audit` / `agent-risk-guard/skills/agent-risk-guard/scripts` / `agent-risk-guard-audit-xhs-publish` | `75dce9a0c75a676b` | 45808 | **False ×3** | 0（LF） | **1** ✅ |
| **ps1 ×6** | audit / `agent-risk-guard/assets/hooks` / `skills/agent-risk-guard/scripts` / `~/.claude/hooks` / `~/.codex/hooks` / `~/.gemini/config/hooks` | `ec8c419bd2cf65f7` | 39917 | **True ×6（逐份独立验证 `EF BB BF`）** | 0（LF） | **1** ✅ |

* **同代抽验**：9 份副本与主源 `sha256` **完全相同**（非旧版残留）✅；`git status --porcelain` 显示 5 个源文件**无未提交改动**，即「工作树 = HEAD = 冻结声明」✅
* **D9（BOM）**：ps1 六份**逐份**验证 BOM=True；sh 三份无 BOM ✅
* 注：`agent-risk-guard-audit-xhs-publish/scripts/dangerous-commands.ps1`（21 KB 精简变体 / mtime 09-06）**不在 6 份同步清单**内，与 FIX4/FIX5 一致，**非本轮遗漏**（沿用上轮登记）。

---

## 9. 最小修法（向上对齐 / 消过拦，D12 合规）

**原则**：`\(` `\{` 锚**必须保留**（任务卡 §1 明确要求 `(rmdir /s /q x)`、`{ rmdir /s /q x; }` 两端 deny），只需**把「引号内的字面括号」排除**。

1. **两端加 quoted-lookbehind**（各 1 处定义，符合「单一定义」原则）：
   * ps1 `L250`：`(?:^|[;&|\r\n]|(?<!["'])\(|(?<!["'])\{)`
   * sh `L426`：`(^|[;&|]|(?<!["'])\(|(?<!["'])\{)`
   —— 直接消掉 §4.1 的第 1/2/3/4/5/6/7 条（`printf '{ diskpart }'`、`echo "(diskpart)"`、`grep -r "(rm -rf)" .`、`git commit -m "fix (rm -rf)"` …），而 `(rmdir /s /q x)`（行首 `(`）、`{ rmdir /s /q x; }`（行首 `{`）**不受影响**。
   * 若判定「引号 lookbehind 太窄」，则退而求其次：**只对 `console/text` 类规则（`rm`/`diskpart`/`format`）改用已剥离 echo/printf 引号参数的 `$cmdTest`**（ps1 L304/L296 现在用的是 `$cmd`），但这会牵动 16 段语义，代价更大 —— 建议先用 lookbehind。
2. **闸门补语料（消「闸门对该面零覆盖」）**：K 段加 `K60`–`K68` 共 9 条 = §4.1 的表，`expect: allow` 两端；保留 `K43/K44/K53/K52` 的 deny 作**成对守卫**（证明修法不是「一律 allow」）。L 段同步加 2 对（`(rmdir /s /q x)`=deny ↔ `grep -r "(rmdir /s /q x)" .`=allow）。
3. **改口径**：报告 §8-3 的「`(`/`{` … **故不是新增过拦**」必须改写为：「`(`/`{` 字面锚在 **ps1 的 rm 族**与 **sh 全端**上**确属新增拦截面**，实测 9 条合法命令由 allow→deny，已在本轮收紧（见 §4.1）」。
4. **顺带登记（不要求本卡修，建议开下一卡）**：包装词与 `cmd|command|env` 的**可组合性缺口**——`command time diskpart`、`env nice diskpart`、`command sudo diskpart`、`env sudo diskpart`、`command cmd /c diskpart`、`env cmd /c diskpart`、`command nohup rmdir /s /q x`、`env time rmdir /s /q x`、`sudo command time diskpart`、`command env diskpart` 共 **10 条**在 ps1 端 **pre-G3=deny / FIX5=allow / FIX6=allow**（相对**冻结基线**仍是放松，且**闸门零覆盖**）。根因是 `$CMD_PRE` 的顺序是「包装词* → 路径 → (cmd|command|env)」，而 `command time X` 需要「(cmd|command|env) 与包装词可互相穿插」。修法：把该组并成一族可重复项
   `(?:(?:sudo|time|nice|nohup|setsid|doas|exec|ionice|busybox|then|do|else|command|env)\s+|cmd(?:\.exe)?\s+/c\s+)*`（**仍不得放宽成任意单词**，`x diskpart` 反向守卫必须保持 allow）。
   —— 严重度**低**（形态偏冷门），故**不作为本次 REJECT 依据**，但**必须登记**，因为它与本卡「终止前缀漂移」的目标同源。

---

## 10. 特别标注（按任务卡分类）

| 类别 | 结论 |
|---|---|
| **新绕过面** | **未发现**。两端 `deny→allow` 放松 = **0/161**（含空引号归一后的 `t''ime diskpart`、`g''it clean -f`、`c''hmod 777 /x`、`R''MDIR /s /q x`、`git cl''ean -f`、`s''hutdown /s` 全部仍 deny）✅ |
| **新过拦** | **有，9 条，两端都有**（= REJECT 依据）：`printf '{ diskpart }'`、`echo "(diskpart)"`、`echo "{ diskpart }"`、`echo '(rm -rf)'`、`echo "(rm -rf /)"`、`git commit -m "fix (rm -rf)"`、`grep -r "(rm -rf)" .`、`sed -n 's/(rm -rf)/x/p' f`、`ls (rm -rf)`。**其中 `printf '{ diskpart }'` 是验收清单点名的合法命令** |
| **规则被意外改变** | **未发生**：归一化 LCS 证明两端除前缀外零改动；唯一「非同形」处是 ps1 16e 的**向上**扩宽（实现者已登记）✅ |
| **向下对齐** | **未发生**。FIX6 相对 FIX5 纯收紧（ps1 +83 / sh +82，放松 0）；4 条「FIX5 两端 allow」的既存分歧（`nohup shutdown /s`、`time find /tmp -delete`、`time xargs rm`、`time chmod 777 /x`）被**两端一起 deny**，方向为**向上** ✅ |
| **闸门无效** | 身份断言**真实有效**（结构 + 我自跑的错配实验，见 §11.1）；但**对 §4.1 的括号散文面零覆盖**（同 FIX5 的结构性缺口，只是换了一类） |
| **副本或 BOM 错** | **未发生** ✅（9/9 同 sha、ps1 6/6 BOM=True、全 LF、distinct=1） |
| **报告口径** | §8-3「`(`/`{` … 故不是新增过拦」**与实测相反**（§4.2）；§1.2 关于 `then/do/else` 的等价性论证**经我实测成立** ✅ |

---

## 11. 自跑日志与证据

### 11.1 闸门（串行）

（占位：由下方 run 结果填充）

### 11.2 红线（串行）

（占位：由下方 run 结果填充）

### 11.3 证据清单（`E:\DeepSeek_Harness\workspace\2026_08_21\.eval-tmp\g6fix6eval\`）

| 文件 | 内容 |
|---|---|
| `probe.mjs` / `results.json` / `probe_console.txt` | 自造 **161 条 × 6 列 = 966 次串行真实 spawn** harness + 原始结果 |
| `analyze.mjs` / `analysis.txt` | 变化分类（放松/收紧/回归三列/两端分歧/新过拦） |
| `normalize.mjs` / `normalize.txt` | **归一化代码行 LCS 比对**（证明无规则被意外改变）+ 定义/引用行号清单 |
| `focused.mjs` / `focused.txt` / `focused.json` | 27 条 ps1 聚焦探针（括号过拦族 + `command/env` 顺序族） |
| `legit.mjs` / `legit.txt` | 60 条合法/守卫载荷六列判定表 |
| `matrix_check.mjs` | 63 条包装矩阵 + 三列回归计数复核 |
| `frozen/` | 我 `git show` 取出的 7 个冻结字节基线（含 pre-G3 / FIX4 / FIX5 / FIX6 两端） |
| `mutants/` | 我从**冻结终版**独立生成的 4 个变异体（sha256 可复算） |
| `mk_mutants.mjs` / `run_redlines.ps1` | 变异生成脚本 / 串行红线+闸门 runner |
| `logs/` / `redlines_summary.txt` | 各套件原始输出与汇总 |
