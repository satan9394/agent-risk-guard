# EVALUATION RESULT G3-FIX6 —— 命令位前缀「单一定义、全规则引用」（**独立验收**）

> 验收人：**全新独立 Evaluator**（不继承实现者 / 编排者 / 前轮 Evaluator 的推理上下文）。预设立场「实现可能存在错误」。
> 只读主源；全部探针与变异体在隔离 TEMP `E:\DeepSeek_Harness\workspace\2026_08_21\.eval-tmp\g6fix6eval\` 内进行，**未改动任何主源/产品树**。
> 语料**完全自造**（161 条 × 6 列 = **966 次串行真实 spawn**，另 focused 27 条 × 3 列 = 81 次），**未复用**实现者的 97 条，也**未复用**上一轮 Evaluator 的 162 条。
> 列：`ps1Pre`(=pre-G3，**已用 `git show 6ea0342` 独立取字节**，`fb85cc0e4476ae58`/34523B) / `ps1F5`(`git show d169d26`，`5a18ef0f04ddd30d`) / `ps1F6`(主源 `ec8c419bd2cf65f7`) / `shPre`(`git show a509afe`，`8ac7782d87b95415`) / `shF5`(`git show d169d26`，`692d0451a84c451e`) / `shF6`(主源 `75dce9a0c75a676b`)。

---

## 0. 验收结论

# **REJECT**（窄口径：**只有一处**；本卡的核心目标与全部卡面验收标准我实测**全部达成**）

**必须首先、明确肯定这一轮做对了什么**（这一半证据非常干净，不应被下面的 REJECT 掩盖）：

1. **FIX5 的 8 条回归是真收回，不是重建的**。我用 `git show 6ea0342:…ps1` 取冻结字节（`fb85cc0e…`，与 `git show 4c94b90:…ps1` **逐字节相同** → 再次确认「pre-G3 ≡ FIX4」），三列实测 `pre=deny → FIX5=allow → FIX6=deny`：任务卡 §1 点名的 **12/12 全部成立**（含换行形态），全语料共 **76 条**满足该三列模式；`ps1` 端 `pre=deny → FIX6=allow` 只剩 11 条，其中 9 条是应然 allow（`x <词>` 反向守卫族、`grep -i diskpart`、引号内散文），**真实危险放松 2 条**（`command time diskpart` / `env nice diskpart`；聚焦探针再找到同族 8 条，共 10 条 —— 属 FIX5 遗留、**非本卡新造**，见 §9-4）。
1b. ⚠️ **重要前提（请先读）**：验收期间**产品树被并行开工的 G3-FIX7 改写**（11:34 起，11:37 重写测试文件、11:41/11:43 重写两端 hook）。我把受影响的闸门证据**全部作废并用 `git show e62d721:` 冻结字节重跑**；§11.0 有完整时间线与处置。**本报告不对 FIX7 作任何评价。**
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
| 5 | **闸门**：base 绿 / 身份断言真实有效 / 变异必红 | **PASS** ✅（**冻结语料+冻结 hook**：base 第 1 次有 1 条 wsl 伪影 → **D10 全量重跑 `2/2/0` 绿**；A 面回退红 **18/168**；身份断言正常绿、**错配 8/16 红**） |
| 6 | **红线不回退** | **PASS** ✅（sh 12/12、ps1 10/10、redact A/B/C 绿、M4 红 3/3、M2 红 31/34 于 `sh-failclosed-test`）；**node 全量未做**（产品树被并行改写，见 §11.0） |
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

### 6.3 自跑结果（**串行**，且**只对冻结 FIX6 字节**）

> ⚠️ 见 §11.0：我第一次跑闸门时**产品树正在被并行改动**（G3-FIX7 开工，11:37–11:43 重写了 `decision-parity.test.ts` 与两端 hook），该次运行**全部作废**。下表是我**改用 `git show e62d721:` 取出的冻结语料 + 冻结 hook/自造变异体**重跑的结果。

| # | 被测体 | 环境变量 | rc | tests/pass/fail | 红点 | 判定 |
|---|---|---|---|---|---|---|
| ① | **冻结 FIX6 主源**（ps1 `ec8c419b…` / sh `75dce9a0…`） | `RG_PARITY_*` → `frozen/` | **1 → 0** | 第 1 次 2/1/1；**D10 重跑 2 / 2 / 0** | 第 1 次 **1 / 168**：`T18 分句串联` = `echo a; rm -rf /tmp/t`，ps1=deny / **sh=INVALID-JSON** | **D10 复核后判绿 ✅**：单条重跑 **6/6** 均为合法 JSON `deny`；**全量重跑 = `tests 2 / pass 2 / fail 0`**（`logs\fix6_gate_base_rerun.log`）→ 该条是 wsl 间歇伪影 |
| ② | **A 面回退**（**我自造**：`MA-ps1-prefix-fix5.ps1` / `MA-sh-prefix-fix5.sh`，各只改 1 行定义） | 同上 → `mutants/` | **1** | 2 / 1 / 1 | **18 / 168** | **红 ✅** —— 与实现者 §5.3 的「18 条 = `K39`–`K56`」**逐数吻合** |
| ③ | **身份断言 · 正常**（两端=冻结 FIX6） | 同上 | **0** | 1 / **1** / 0 | — | **绿 ✅** |
| ④ | **身份断言 · 错配**（`RG_PARITY_PS1`=**FIX5 ps1**，`RG_PARITY_SH`=冻结 FIX6 sh；**只有一端漂移**） | 同上 | **1** | 1 / 0 / **1** | **8 / 16** | **红 ✅ 身份断言真实有效**（只有一端漂移即被抓住） |

**① 的 D10 复核（我实跑，`rerun_t18.mjs`）**：对 `echo a; rm -rf /tmp/t` 连跑 6 次，**6/6 都是 `rc=0` + 合法 JSON + `deny`**：

```
#0..#5 "echo a; rm -rf /tmp/t" rc=0 decision=deny
  stdout={"hookSpecificOutput":{"permissionDecision":"deny",…},"systemMessage":"HOOK BLOCKED: rm is permanent deletion…"}
```

→ 那 1 条 `INVALID-JSON` **不可复现**，属 D10 记载的 `wsl.exe` 间歇伪影（G3 实测 21/66 假红同源），**不是 FIX6 的缺陷**。按 D10「单次红先重跑」，我**做了全量重跑**：
`node --test <冻结 dp6.ts>` + `RG_PARITY_*` → frozen → **`ℹ tests 2 / ℹ pass 2 / ℹ fail 0`**（`logs\fix6_gate_base_rerun.log`）→ **闸门 base 判定为绿 ✅**（与实现者 §5.3 的「2/2 绿」一致）。

**② 的意义**：这一格同时钉死两件事——(a) 闸门对**本卡唯一改动**（前缀定义）**有独立捕获力**；(b) 变异体**只改 1 行定义**即红，反证「单一定义」成立（若前缀仍是散落的 18/11 份副本，改 1 行不会红）。

**③/④ 的意义**：身份断言在正常态绿、在**只有一端漂移**时红（8/16）—— 任务卡 §1「跨端身份断言」的验收点**成立**，且与实现者 §5.3 的「A 面变异时身份断言仍绿（两端一起错）」互为补证：**两条测试各司其职，必须并存**。

**闸门覆盖缺口（与本轮 REJECT 直接相关）**：168 条语料**对 §4.1 的「括号散文」面零覆盖** —— 若覆盖，① 会因 `echo '(rm -rf)'` 多红 1 条（该形态我实测 ps1=deny / sh=allow）。

**关于报告的「A 面回退红 18 条」**：我另有一次**被污染但方向可用**的旁证——在我发现污染前运行的 `gate_A.log`（11:39:46–11:44:57，语料已是 FIX7 版 196 条、hook 用**我的**变异体），结果是 `tests 2 / pass 1 / fail 1`：主测试**红 33/196**、**身份断言绿**——与实现者 §5.3 的定性结论（A 面回退必红；且「两端一起错」时身份断言不红，故两条测试必须并存）**一致**，但该次数值**不属于 FIX6 语料**，我不采信其条数。

---

## 7. 项目 6：红线不回退（自跑，**全部有效**：运行时刻 11:24–11:35，早于 11:37 的并行改写**）

### 7.1 sh 四套 × 三棵树 —— **12/12 rc=0 ✅**

| 树 | sh-hook-test | sh-audit-bypass | sh-audit-edge | sh-failclosed-test |
|---|---|---|---|---|
| audit | 67/67 rc=0 | **TOTAL 192 / PASS 192 / FAIL 0** rc=0 | **TOTAL 40 / PASS 40 / FAIL 0** rc=0 | **TOTAL 34 / PASS 34 / FAIL 0** rc=0 |
| skills | 67/67 rc=0 | 192/192 FAIL 0 rc=0 | 40/40 FAIL 0 rc=0 | 34/34 rc=0 |
| xhs-publish | 67/67 rc=0 | 192/192 FAIL 0 rc=0 | 40/40 FAIL 0 rc=0 | 34/34 rc=0 |

**12/12 次 rc=0、FAIL=0**（每棵树用**自己的** hook + 自己的 tests 目录）✅ —— 与实现者 §6.1 逐格一致。

### 7.2 ps1 五套 × 两棵同步树 —— **10/10 rc=0 ✅**

| 树（隔离临时树，挂该树的 ps1） | hook-audit-reregress | hook-bypass-regression | hook-fp-regression | hook-redact-test | hook-rules-test |
|---|---|---|---|---|---|
| audit | **59/59** rc=0 | **18/18** rc=0 | **8/8** rc=0 | **119/119** rc=0 | **37/37** rc=0 |
| skills | **59/59** rc=0 | **18/18** rc=0 | **8/8** rc=0 | **119/119** rc=0 | **37/37** rc=0 |

`hook-fp-regression` 第 5 条 `rmdir /tmp/empty_dir` 仍 allow ✅；`hook-bypass-regression` 的 `cmd /c del /f C:\x\y` 仍 deny ✅ —— 与实现者 §6.2 逐格一致。

### 7.3 redact parity 与红线变异（G15b）

| 被测体 | 要求 | 我的实测 | 结论 |
|---|---|---|---|
| **冻结 FIX6 主源** A/B/C | 绿 | `tests 3 / pass 3 / fail 0` rc=0 | **✅** |
| **M4**（**我自造**：`redact_text()` 直通，冻结基底 +1 行，`bafa7eba74185897`） | 必红 | `tests 3 / pass 0 / fail 3` rc=1 | **✅ 红** |
| **M2**（**我自造**：TAB 不再转义，1 行，`92aabc4d1b19a189`）→ `redact-parity` | — | （实现者口径：不红；我未重复该格） | 见下 |
| **M2** 同一变异体 → **`sh-failclosed-test`** | 必红 | **`TOTAL 34 / PASS 31 / FAIL 3`** rc=1 | **✅ 红** |

**归属核实（任务卡要求核实「M2 由 `sh-failclosed-test` 持有」是否成立）：成立 ✅** —— 我用**自己从冻结终版派生**的 TAB 变异体，在 `sh-failclosed-test` 上得到 **31/34**（3 条 TAB 用例红），与实现者 §6.3 的数字**独立复现一致**；而 `redact-parity` 语料对其不敏感（FIX5 轮已查明该文件对 TAB **零覆盖**，本轮未见补语料）。故「M2 红线由 G5 套件持有、而非 G15b parity」这一归属**正确**。

### 7.4 node 全量 —— **未完成（污染）**

实现者称 `380/380`。我在污染发现前**未执行**该项；发现后产品树已非 FIX6，**再跑无意义**（会测到 FIX7 中间态）。→ **我未独立验证此项**，不采信也不否认。

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
| **闸门无效** | 身份断言**真实有效**（结构 + 我自跑的错配实验 8/16 红 ✅）；A 面回退**红 18/168** ✅；但**对 §4.1 的括号散文面零覆盖**（168 条语料一条未含，同 FIX5 的结构性缺口，只是换了一类） |
| **闸门 base 的 1 条红** | `echo a; rm -rf /tmp/t` 的 sh 端出现 **1/168 `INVALID-JSON`**，**6/6 重跑均不可复现** → wsl 间歇伪影（D10 已登记现象），**非 FIX6 缺陷**；实现者「base 2/2 绿」的口径与我实测量级一致 |
| **副本或 BOM 错** | **未发生** ✅（9/9 同 sha、ps1 6/6 BOM=True、全 LF、distinct=1） |
| **报告口径** | §8-3「`(`/`{` … 故不是新增过拦」**与实测相反**（§4.2）；§1.2 关于 `then/do/else` 的等价性论证**经我实测成立** ✅ |

---

## 11. 自跑日志与证据

### 11.0 ⚠️ 重大方法论事件：**验收期间产品树被并行改写（G3-FIX7）**

这是本轮必须先声明的事实，它影响了 2 项证据的可信度，并已按 D10 精神处置：

```
（我）10:5x  复核主源 sha256 = ps1 ec8c419bd2cf65f7 / sh 75dce9a0c75a676b（= git HEAD e62d721）
（我）11:14–11:23:43  966 次串行探针（ps1F6/shF6 列读实时文件）      ← 全程在改写之前 ✅
（我）11:24:18–11:33:41  sh 12 套 + ps1 10 套红线                    ← 全程在改写之前 ✅
（我）11:34:30 / 11:35:06 / 11:35:14  redact base / M4 / failclosed-M2 ← 在改写之前 ✅
（他）11:34:29  tasks/orchestrator/_g3fix7_extract_frozen.mjs 出现    ← FIX7 开工
（我）11:35:2x–11:39:46  gate_base（读实时 hook）                     ← ❌ 期间 hook 被改写
（他）11:37:44  decision-parity.test.ts 被改写（465 行 → 490 行，语料 168 → 196）
（他）11:41:xx / 11:43:53  sh / ps1 hook 被改写
（我）11:39:46–11:44:57  gate_A（用我自己的变异体，但语料已是 FIX7 版）← ❌ 语料错代
（我）11:45  发现并 kill 后台作业，改用冻结字节重跑
```

**佐证**：该次 `gate_base.log` 里 **168 条里 119 条 `ps1 = EXIT-1`** —— 即 ps1 hook **整份解析失败**（`edit` 写入丢 BOM → PowerShell 按 ANSI 读中文源；这正是实现者 §7 自己记录的 D9 现象）。它是**并行改写造成的中间态**，**不是 FIX6 的缺陷**：同一支 hook 在 11:32–11:33 的 ps1 五套 ×2 里 **10/10 全绿**。

**处置（D10：单次全红先重跑，且必须重跑在正确的被测体上）**：
* 作废 `logs\gate_base.log`、`logs\gate_A.log`（语料/被测体错代）；
* 用 **`git show e62d721:packages/core/test/decision-parity.test.ts`**（465 行、语料 168 条、含 L 段身份断言，**imports 仅 node 内建**）取出**冻结语料**，落到 `.eval-tmp\g6fix6eval\gate6\dp6.ts`；
* 用 **`frozen/ps1_FIX6.ps1` / `frozen/sh_FIX6.sh`**（`git show e62d721` 取字节）作为被测 hook，**完全绕开被改写的产品树**；变异体用我自己从冻结终版生成的那两份；
* 重跑见 §11.1（`run_gate6.ps1`）。

**结论**：本报告的**全部结论**（§2–§5、§8）与**红线数字**（§7）都建立在**改写之前**取得的证据或 **`git show` 冻结字节**之上；唯一受影响的是**闸门一项**，已重跑取证。**我不对 FIX7 的任何内容作评价**（不在本卡范围）。

### 11.1 闸门（冻结语料 + 冻结/自造变异体，串行）

| 运行 | 命令 | 结果 |
|---|---|---|
| base（第 1 次） | `node --test <frozen dp6.ts>`，`RG_PARITY_*`→`frozen/` | 2 / 1 / 1（1 条 wsl `INVALID-JSON` 伪影） |
| **base（D10 重跑）** | 同上 | **2 / 2 / 0 ✅** |
| A 面回退 | `RG_PARITY_*`→`mutants/MA-*` | **2 / 1 / 1，红 18/168 ✅** |
| 身份断言 · 正常 | `--test-name-pattern="cross-end identity"`，两端 frozen | **1 / 1 / 0 ✅** |
| **身份断言 · 错配** | `RG_PARITY_PS1`=**FIX5 ps1** + `RG_PARITY_SH`=frozen FIX6 sh | **1 / 0 / 1，红 8/16 ✅ 断言有效** |

日志：`logs\fix6_gate_base.log`、`logs\fix6_gate_base_rerun.log`、`logs\fix6_gate_A.log`、`logs\fix6_id_base.log`、`logs\fix6_id_mismatch.log`、汇总 `gate6_summary.txt`。

### 11.2 红线（串行，运行于 11:24–11:35）

见 §7.1–§7.3（`logs\sh_*.log` / `logs\ps1_*.log` / `logs\redact_*.log` / `logs\failclosed_M2.log`）。

### 11.3 证据清单（`E:\DeepSeek_Harness\workspace\2026_08_21\.eval-tmp\g6fix6eval\`）

| 文件 | 内容 |
|---|---|
| `probe.mjs` / `results.json` / `probe_console.txt` | 自造 **161 条 × 6 列 = 966 次串行真实 spawn** harness + 原始结果（**11:14–11:23:43，改写之前**） |
| `analyze.mjs` / `analysis.txt` | 变化分类（放松/收紧/回归三列/两端分歧/新过拦） |
| `normalize.mjs` / `normalize.txt` | **归一化代码行 LCS 比对**（证明无规则被意外改变）+ 定义/引用行号清单 |
| `focused.mjs` / `focused.txt` / `focused.json` | 27 条 ps1 聚焦探针（括号过拦族 + `command/env` 顺序族） |
| `legit.mjs` / `legit.txt` | 60 条合法/守卫载荷六列判定表 |
| `matrix_check.mjs` | 63 条包装矩阵 + 三列回归计数复核 |
| `frozen/` | 我 `git show` 取出的 7 个冻结字节基线（pre-G3 / FIX4 / FIX5 / FIX6 两端） |
| `mutants/` | 我从**冻结终版**独立生成的 4 个变异体（sha256 可复算；MA-ps1/MA-sh 与实现者声明**逐字一致**） |
| `gate6/dp6.ts` | **冻结 FIX6 语料**（`git show e62d721:` 取出，465 行，绕开被改写的产品树） |
| `mk_mutants.mjs` / `run_redlines.ps1` / `run_gate6.ps1` | 变异生成 / 串行红线 runner / **冻结闸门 runner** |
| `logs/` / `redlines_summary.txt` / `gate6_summary.txt` | 各套件原始输出与汇总 |
