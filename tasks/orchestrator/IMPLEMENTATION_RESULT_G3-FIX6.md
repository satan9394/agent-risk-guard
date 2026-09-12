# IMPLEMENTATION RESULT G3-FIX6 —— 命令位前缀「单一定义、全规则引用」（终止打补丁循环）

> 执行人：**Implementer**（本卡不自我宣告成功；裁决权在独立 Evaluator）。
> 本轮**不改方向**（FIX5 的 §A/§B 全部保留），只做两件事：**终止前缀漂移**（单一定义 + 全规则引用）与**把 FIX5 删掉的整类覆盖补回**（两端同批）。
> 全部数字来自真实 spawn（D6）+ 冻结字节（D8），命令与日志路径见 §9。

---

## 0. 一页速览

| 项 | 结果 |
|---|---|
| **§1 的 8 条包装/子 shell 回归** | **两端全 deny**（before：FIX5 冻结 ps1 = allow / 终版 = deny，20 条同族一并收口，**0 条 deny→allow**） |
| **`x diskpart` 反向守卫** | **仍 allow**（两端；`x rmdir /s /q x` / `x format C: /q` / `x'' diskpart` 同） |
| **前缀片段单一定义** | sh **1 处定义 / 11 条规则引用**；ps1 **1 处定义 / 19 处引用**（清单见 §1.3/§1.4；例外 5 条见 §1.5） |
| **闸门** | 语料 **147 → 168**（+K39–K59）；**新增独立「跨端身份断言」测试**（L 段 16 条，只看两端是否一致）；base **2/2 绿** |
| **闸门变异（冻结基底派生）** | A 面回退 **红 18 条**（= `K39`–`K56`，F 段一条不红）；B 面回退 **红 22 条**（= `F1`–`F15`+7 条依赖归一的 K，新前缀类一条不红） |
| **红线** | sh 四套 × 三棵树 **12/12 rc=0**；ps1 五套 × 两棵同步树 **10/10 rc=0**；redact parity A/B/C **绿**、M4 **红**、M2 **红（由 `sh-failclosed-test` 持有）**；node **380/380** |
| **副本** | sh ×3 `75dce9a0c75a676b` **distinct=1**（BOM=False）；ps1 ×6 `ec8c419bd2cf65f7` **distinct=1**（**BOM=True 逐份**）；全部 LF |

**本轮唯一需要 Evaluator 重点复核的取舍**：把 `then|do|else` 放在**包装词位**而不是**锚位**（§1.2）——
它与任务卡 §1 的处方在**全部真实 shell 形态上行为等价**（8 条 + `K45`/`K46`/`K54`/`K55`/`K56` 全 deny），
但**避免**了处方原样照抄会带来的新过拦（`git commit -m "do rm docs"` / `echo "do rm"`）。**实测三列对照见 §1.2。**

---

## 1. 必修 A：统一前缀片段（定义处 + 引用处清单）

### 1.1 片段本身（两端**各一次**，语义同形）

```
命令位锚  (^|[;&|]|\(|\{)                     ← sh（grep 逐行，^ = 行首）
命令位锚  (?:^|[;&|\r\n]|\(|\{)               ← ps1（整串正则，须显式写 \r\n）
包装词序列 (?:(sudo|time|nice|nohup|setsid|doas|exec|ionice|busybox|then|do|else)\s+)*   ← 闭集，可重复
路径前缀   (?:/[^\s;&|]*/)?                    ← 只认绝对路径（`cat ./etc/mkfs.conf` 不误伤）
包装前缀   (?:cmd(?:\.exe)?\s+/c\s+|command\s+|env\s+)?
```

**⚠️ 不得放宽成「任意单词」**：`x diskpart` 必须仍 allow（K18/K22/K26 + L 段反向守卫 4 条）。

### 1.2 为什么 `then|do|else` 在**包装词位**而不在锚位（本轮唯一主动偏离处方之处）

任务卡 §1 / `EVALUATION_RESULT_G3-FIX5` §9 的处方把 `\bthen\b|\bdo\b|\belse\b` 写在**锚位**。我实测了它：

| 载荷 | 处方（锚位） | 本轮（包装词位） | bash 语义 |
|---|---|---|---|
| `if true; then rmdir /s /q x; fi` | deny | **deny** | 真实执行 |
| `for i in 1; do del x; done` | deny | **deny** | 真实执行 |
| `if true\nthen rmdir /s /q x\nfi` | deny | **deny** | 真实执行 |
| `for i in 1\ndo del x\ndone` | deny | **deny** | 真实执行 |
| `if x; then time rmdir /s /q x; fi` | deny | **deny** | 真实执行 |
| `git commit -m "do rm docs"` | **deny（新过拦）** | **allow** | 只是散文，**不执行** |
| `echo "do rm"` | **deny（新过拦）** | **allow** | 只是文本 |
| `git log --grep="then rmdir /s /q"` | **deny（新过拦）** | **allow** | 只是散文 |

机理：锚位只需一个**词边界**（`\b`），引号内 `"do rm"` 的 `do` 前面正是 `"` → 命中 → 该 `rm` 被当成命令位。
包装词位要求 `do` 出现在**真命令位之后**（行首 / `;` / `&` / `|` / `(` / `{` / 换行），而 `if…then`、`for…do`、
`else` 在真实 shell 里**必然**紧跟这些分隔符（`; then` / `; do` / `; else`），故**等价覆盖**。
→ 这是 D12 意义上的「向上对齐且不新造过拦」；若 Evaluator 判定必须逐字照抄处方，请裁决，我可在一个提交内切换（片段只有一处定义）。

### 1.3 sh：定义处（唯一）+ 引用处（11 条规则）

**文件**：`agent-risk-guard-audit/scripts/dangerous-commands.sh`（= 三份 sh 副本的源；终版 `75dce9a0c75a676b` / 45808 B）

| 角色 | 行号 | 内容 |
|---|---|---|
| **定义（唯一）** | **L426** | `CMD_PRE='(^|[;&|]|\(|\{)[[:space:]]*((sudo\|time\|nice\|nohup\|setsid\|doas\|exec\|ionice\|busybox\|then\|do\|else)[[:space:]]+)*(/[^[:space:];&|]*/)?(cmd…)?'` |

**引用处（`${CMD_PRE}`，共 11 条规则 / 23 处）**

| 行号 | 规则 |
|---|---|
| L435 | 1) POSIX 删除类 `rmdir/unlink/shred` |
| L440 | 1) `rm` |
| **L445** | 1) **`rm` 实参抽取（sed）**——FIX6 起**改为引用同一 `${CMD_PRE}`**（原先自带第二份硬编码副本），捕获组随前缀扩到 `\6`（`\1` 锚 `\2` 包装序列 `\3` 包装词 `\4` 路径 `\5` cmd/command/env） |
| L456 | 1b) PowerShell/CMD 删除类（`Remove-Item/del/erase/ri/rd/rmdir`，6 处） |
| L468 | 16c) 引号插词 rm 变体 |
| L482 | 2) `find -delete` / `find -exec rm`（2 处） |
| L489 | 3) `xargs rm` / `for…do rm` |
| L552 | 8) 磁盘 `diskpart/mkfs/fdisk/parted/wipefs`（5 处） |
| L564 | 8) `format X: /` |
| L598 | 28) `shutdown/reboot/halt/poweroff` |
| L606 | 29) `chmod 777` |

`CMD_SEG`（L411）**保留但已无任何规则引用**（历史锚，注释已注明），不再有第二份前缀定义。

### 1.4 ps1：定义处（唯一）+ 引用处（19 处）

**文件**：`agent-risk-guard-audit/scripts/dangerous-commands.ps1`（= 六份 ps1 副本的源；终版 `ec8c419bd2cf65f7` / 39917 B / BOM=True）

| 角色 | 行号 | 内容 |
|---|---|---|
| **定义（唯一）** | **L250** | `$CMD_PRE = '(?i)(?:^|[;&\|\r\n]\|\(\|\{)\s*(?:(?:sudo\|time\|nice\|nohup\|setsid\|doas\|exec\|ionice\|busybox\|then\|do\|else)\s+)*(?:/[^\s;&\|]*/)?(?:cmd(?:\.exe)?\s+/c\s+\|command\s+\|env\s+)?'` |

**引用处（`($CMD_PRE + '…')`，19 处）**：L288（rule 6 shutdown）、L296（rule 7 format）、L304（rule 8 diskpart）、
L337/340/343/346/349（rule 14 `del/erase/ri/rmdir/rd`）、**L364（rule 16 rm：`-match` 与 `-notmatch` 豁免前瞻两处）**、
L371/374（16b `unlink/shred`）、L377/381（16b `find -delete`/`find -exec`）、L384（16b xargs/for）、
L410（16c 引号插词 rm）、L420（16e `$cmdNaked` rm 补查）、L509（rule 28）、L515（rule 29 chmod）。

> **机械改造口径**：FIX6 由 `_g3fix6_apply_ps1.mjs` 把 17 处**同形字面**前缀替换为 `($CMD_PRE + '<REST>')`（脚本打印逐处行号与剩余片段）；
> 第 18 处（rule 6，原为「仅整串开头 `^`」的窄锚）手工同形化；第 19 处（16e 窄锚，无 sudo/路径组）一并同形化（**方向为向上**：旧锚是 `$CMD_PRE` 的子集）。

### 1.5 无法/不宜引用统一前缀的规则（**单独列出 + 理由**）

| 端 | 行号 | 规则 | 为什么不引用 |
|---|---|---|---|
| ps1 | L100 | 脱敏 `cli-mysql-password-numeric` | `re` 的分组与 `repl='$1$2$3$4@@RG_REDACTED@@'` **按组号绑定**，等价改写会改动替换串；且它是**脱敏上下文**（`-p<数字>` 凭据），不是「危险基座命令位」 |
| ps1 | L108 | 脱敏 `cli-basic-auth-user` | 同上（`$1$2$3$4`） |
| ps1 | L423 | `$cmdNaked -match '(?i)\bRemove-Item\b'` | 语义是**插词补查**（`R\`emove-Item`、`R'EMOVE'-'ITEM'`）——刻意**不加命令位锚**，加了会漏掉插词形态 |
| ps1 | L429/L430 | `$reRecycleBinPath` / `$reRecycleBinDelVerb` | 语义是「**回收站路径 + 语境任意位置出现删除动词**」，规则本身就是**位置无关**的合取，与命令位锚正交 |
| sh | L459–L463 | `1b-2)` `\bRemove-Item\b` 补查 | 与 ps1 L423 同因（插词补查，无锚是**刻意**的） |
| sh | L473 | `r["']+m`（命令名内插词） | 匹配的是**词内**插词（`r''m`），不落在命令位上 |
| sh | L581 | 10b) 反斜杠/前导斜杠 rm（`(^\|[;&\|])[[:space:]]*[\\/]{1,2}rm`） | 语义是「`\rm` / `/rm` 这类**变形词头**」，与包装词前缀正交；本卡未动（FIX4 已按 ps1 同形对齐） |

其余「非命令位语义」的规则（`rm -rf` 任意位置、`shutil.rmtree`、`os.remove`、`git clean/reset`、`reg delete`、
`docker`、管道到 shell、子展开、Python/Node/Perl 删除类…）本轮**一字未动**，与本卡无关。

---

## 2. §1 的 8 条回归：before / after（**用 `git show` 取冻结字节**）

### 2.1 冻结基线（D8：`git show <rev>:<path>`，不靠重建；`_g3fix6_extract_frozen.mjs`）

| 版本 | 文件 | sha256(16) | 字节 | BOM |
|---|---|---|---|---|
| pre-G3 `6ea0342` | ps1 | `fb85cc0e4476ae58` | 34523 | True |
| FIX4 `4c94b90` | ps1 | `fb85cc0e4476ae58` | 34523 | True |
| **FIX5 `d169d26`** | ps1 | `5a18ef0f04ddd30d` | 39349 | True |
| pre-G3 `a509afe` | sh | `8ac7782d87b95415` | 34359 | False |
| FIX4 `4c94b90` | sh | `a4b95f9cd683f3bc` | 41374 | False |
| **FIX5 `d169d26`** | sh | `692d0451a84c451e` | 44326 | False |
| **G3-FIX6（本轮）** | ps1 / sh | `ec8c419bd2cf65f7` / `75dce9a0c75a676b` | 39917 / 45808 | True / False |

★ **pre-G3 ps1 ≡ FIX4 ps1 逐字节相同** → ps1 自 pre-G3 到 FIX4 从未改动，**FIX5 是首次改动**，
故 FIX5 上的 deny→allow 就是**相对冻结基线的客观回归**（本轮实测见 2.3 第三列）。

### 2.2 三列实测（`_g3fix6_threepcol.mjs`，真实 spawn；完整表 `_g3fix6_three_col.md` / 控制台 `_g3fix6_threepcol.txt`）

| 载荷 | 应然 | pre-G3(=FIX4) ps1 | FIX5 ps1 | **FIX6 ps1** |
|---|---|---|---|---|
| `time diskpart` | deny | **deny** | allow（回归） | **deny** |
| `nice diskpart` / `nohup diskpart` | deny | **deny** | allow（回归） | **deny** |
| `time rmdir /s /q x` / `nice …` / `nohup …` | deny | **deny** | allow（回归） | **deny** |
| `(rmdir /s /q x)` | deny | **deny** | allow（回归） | **deny** |
| `{ rmdir /s /q x; }` | deny | **deny** | allow（回归） | **deny** |
| `if true; then rmdir /s /q x; fi` | deny | **deny** | allow（回归） | **deny** |
| `for i in 1; do del x; done` | deny | **deny** | allow（回归） | **deny** |
| `time format C: /q` | deny | **deny** | allow（回归） | **deny** |
| `time del /f x` / `time erase x` / `time ri -r x` | deny | **deny** | allow（回归） | **deny** |
| `{ del x; }` / `(diskpart)` | deny | **deny** | allow（回归） | **deny** |
| `if true\nthen rmdir /s /q x\nfi` | deny | **deny** | allow（回归） | **deny** |
| `for i in 1\ndo del x\ndone` | deny | **deny** | allow（回归） | **deny** |
| `sudo time nice nohup diskpart` | deny | **deny** | allow（回归） | **deny** |
| `time /usr/bin/diskpart` | deny | **deny** | allow（回归） | **deny** |
| `nohup shutdown /s` | deny | allow | allow | **deny**（本轮向上收口） |
| `time find /tmp -delete` | deny | allow | allow | **deny**（上行） |
| `time xargs rm < list.txt` | deny | allow | allow | **deny**（上行） |
| `time chmod 777 /x` | deny | allow | allow | **deny**（上行） |

**共 20 条 `pre-G3 deny → FIX5 allow → FIX6 deny`（= 本轮收回的回归面）**，另 4 条为「本轮新增向上的收口」。

### 2.3 sh 端 97 条探针 before/after（`_g3fix6_probe.mjs`，真实 spawn + 进程 stdin；表 `_g3fix6_before_after.md`）

| 指标 | FIX5 冻结（before） | **终版（after）** |
|---|---|---|
| 不符应然条数 | **34 / 97** | **0 / 97** |
| 两端分歧条数 | 0 | **1**（`time rmdir /tmp/empty_dir`，**已登记既存语义分歧**，见 §8-1） |
| 变化行数 | — | **34 行，全部 allow→deny** |
| **deny→allow 行数** | — | **0（无任何放松）** ← D12 关键 |
| 不可判读输出 | 0 | 0 |

---

## 3. 包装 / 子 shell 矩阵实测（D7 邻居）

| 组 | 载荷（节选） | ps1 | sh | 应然 |
|---|---|---|---|---|
| 包装词 × 危险基座 | `time diskpart`、`nice diskpart`、`nohup diskpart`、`setsid/doas/exec/ionice/busybox diskpart` | deny | deny | deny |
| 包装词 × 删除族 | `nice rmdir /s /q x`、`nohup rmdir /s /q x`、`time format C: /q`、`time del /f x` | deny | deny | deny |
| **嵌套包装（D7）** | `sudo time nice nohup diskpart` | deny | deny | deny |
| **路径 + 包装（D7）** | `time /usr/bin/diskpart` | deny | deny | deny |
| **包装 + 非命令词（D7）** | `sudo time nice nohup x diskpart` | **allow** | **allow** | allow（`nohup` 执行的是 `x`，不是 `diskpart`） |
| 子 shell / 块 | `(rmdir /s /q x)`、`{ rmdir /s /q x; }`、`{ del x; }`、`(diskpart)`、`(time diskpart)` | deny | deny | deny |
| `if…then` / `for…do` | `if true; then rmdir /s /q x; fi`、`for i in 1; do del x; done`、`if x; then time rmdir /s /q x; fi` | deny | deny | deny |
| 换行分隔 | `if true⏎then rmdir /s /q x⏎fi`、`for i in 1⏎do del x⏎done` | deny | deny | deny |
| 分隔符 + 包装 | `echo a; time diskpart`、`echo a \| nohup rmdir /s /q x` | deny | deny | deny |
| 空引号 × 包装 | `t''ime diskpart`（归一 → `time diskpart`） | deny | deny | deny |
| 裸命令（对照） | `rmdir /s /q x`、`diskpart`、`del x` | deny | deny | deny |
| **过拦守卫** | `git commit -m "do rm docs"`、`echo "do rm"`、`grep -r "then rmdir" .`、`git commit -m "remove Diskpart usage"`、`echo "time diskpart"` | allow | allow | allow |

**可执行性（D6，编排者与 Evaluator 已各自实测，本轮复跑）**：
`wsl bash -c 'time echo A; nice echo B; nohup echo C; (echo D); { echo E; }; if true; then echo F; fi; for i in 1; do echo G; done'` → `A B C D E F G`（全部真实执行）。

---

## 4. `x diskpart` 反向守卫（防「任意单词」式放宽）

| 载荷 | pre-G3 | FIX5 | **FIX6** | 应然 |
|---|---|---|---|---|
| `x diskpart` | deny（误伤） | allow | **allow** | allow |
| `x rmdir /s /q x` / `x format C: /q` / `x'' diskpart` | deny（误伤） | allow | **allow** | allow |
| `git commit -m "remove Diskpart usage"` | deny（误伤） | allow | **allow** | allow |
| `git commit -m "do rm docs"` / `echo "do rm"` | allow | allow | **allow** | allow |

闸门内以 `K18 / K22 / K26` + **L 段 4 条**（L2/L4/L6/L12/L14/L16 中对应项）双重钉死；若前缀被放宽成任意单词 → 这些条目立刻变红。

---

## 5. 闸门（必修 B）

### 5.1 语料与身份断言

| 项 | 变更 |
|---|---|
| 主测试语料 | **147 → 168 条**：新增 `K39`–`K56`（包装词/子 shell/块/if-then/for-do，**18 条 expect deny**）、`K57`–`K59`（**过拦守卫** 3 条 expect allow） |
| **跨端身份断言** | **新增独立第二个 `test()`** + `IDENTITY_CORPUS`（**L1–L16**，16 条）：**不看应然**，只断言「同一批命令位/非命令位语料两端 decision 逐条一致」。命令位（`time diskpart` / `nohup rmdir /s /q x` / `{ del x; }` / `if…then` / `for…do` / `time format C: /q` / `sudo time nice nohup diskpart` / `(rmdir /s /q x)`）各配一条**只差一个词**的非命令位邻居（`x …` / 引号内 / 参数位），两条应然**相反** |
| 已知残留登记 | 文件头 + L 段注释登记 3 类**不入语料**的两端残留（`rmdir <无标志路径>`、其包装词同构扩展 `time rmdir <无标志路径>`、`echo "Format-Volume guide"`），并按 D12「保留分歧 + 如实登记」处理 |

**身份断言不能替代应然断言**（本轮实测证据）：A 面变异把**两端前缀一起**退回 FIX5 → 身份断言**仍绿**
（两端"一致地错"），只有主测试的 `expect` 才抓得住。两条测试**必须并存**。

### 5.2 变异证据（**冻结基底派生**，`_g3fix6_mutants.mjs`）

| 变异体 | 改动 | 基底 | sha256(16) | 字节 | BOM |
|---|---|---|---|---|---|
| `MA-sh-prefix-fix5.sh` | sh `CMD_PRE` 唯一定义退回 FIX5 值（+ sed 捕获组回 `\5`） | `75dce9a0c75a676b` | `42226e5204aa4bbc` | 45739 | False |
| `MA-ps1-prefix-fix5.ps1` | ps1 `$CMD_PRE` 唯一定义退回 FIX5 值 | `ec8c419bd2cf65f7` | `3fa08a9e0910945e` | 39846 | True |
| `MB-sh-nonorm.sh` | 删 `cmd="$cmdNoq"` | 同上 | `ccfe9440980bb17b` | 45794 | False |
| `MB-ps1-nonorm.ps1` | 删空引号归一那一行 | 同上 | `20b07630050c39bd` | 39869 | True |
| `M4-redact-passthrough.sh` | `redact_text()` 直通（+1 行） | 同上 | `756c2ac4fecd7de8` | 45839 | False |
| `M2-tab-raw.sh` | TAB 转义改回原样（1 行） | 同上 | `bc4732a388ffb366` | 45804 | False |

> 「**只改一处定义**」是**单一定义**的直接验证：A 面变异体的 ps1 侧只改 `$CMD_PRE` 那**一行**，19 处引用同时继承回退。

### 5.3 闸门三态实测（三**串行**；`node --test packages/core/test/decision-parity.test.ts`）

| # | 被测体 | 环境变量 | rc | tests/pass/fail | 红点 | 判定 |
|---|---|---|---|---|---|---|
| ① | **主源终版** | — | **0** | 2 / **2** / 0 | 0 | **绿 ✅** |
| ② | **A 面回退** | `RG_PARITY_{PS1,SH}` → `MA-*` | **1** | 2 / 1 / **1** | **18**：`K39`–`K56`（**F 段一条不红**） | **红 ✅** |
| ③ | **B 面回退** | `RG_PARITY_{PS1,SH}` → `MB-*` | **1** | 2 / 1 / **1** | **22**：`F1`–`F15` + `K2/K5/K10/K12/K16/K20/K24`（**`K39`–`K56` 一条不红**） | **红 ✅** |

**→ 两变异互相独立、各打各的面；base 绿 / 两变异红三态齐全，不存在「一改就全绿」。**

### 5.4 FIX5 报告占位符与口径（必修 B-3/B-4，已落盘）

* `IMPLEMENTATION_RESULT_G3-FIX5.md` §5 的 `<!--MUTATION-RESULTS-->` **已替换为实测 §5.1/§5.2**（含红点归属 + 对 `M4r/M2r` 中间态与 `M2r` 不可复现的更正）；**全文已无占位符**。
* 同报告 §8-2 的「唯一放松面 / 不可执行」口径**已改写**为：「`x <词>` 只是最无害子集；包装词与子 shell 形态**可执行**且在 ps1 端 deny→allow，是相对冻结基线的**客观回归**，已由 G3-FIX6/A 修复」。

---

## 6. 回归数字（真实 spawn；日志 `_g3fix6_redlines.txt` + `_g3fix6_suite_*.log`）

### 6.1 sh 四套 × 三棵树（**12/12 rc=0**）

| 树 | sh-hook-test | sh-audit-bypass | sh-audit-edge | sh-failclosed-test |
|---|---|---|---|---|
| audit | **67/67** | **192/192** FAIL=0 | **40/40** | **TOTAL 34 / PASS 34 / FAIL 0** |
| skills | **67/67** | **192/192** FAIL=0 | **40/40** | **34/34** |
| xhs-publish | **67/67** | **192/192** FAIL=0 | **40/40** | **34/34** |

### 6.2 ps1 五套 × 两棵**同步树**（**10/10 rc=0**）

| 树 | hook-audit-reregress | hook-bypass-regression | hook-fp-regression | hook-redact-test | hook-rules-test |
|---|---|---|---|---|---|
| audit | **59/59** | **18/18** | **8/8** | **119/119** | **37/37** |
| skills | **59/59** | **18/18** | **8/8** | **119/119** | **37/37** |

> 两棵树的 ps1 与主源**逐字节相同**（`ec8c419bd2cf65f7`），第二个临时树用**隔离副本**跑（不污染产品树）。
> `hook-fp-regression` 第 5 条 `rmdir /tmp/empty_dir` **仍 allow** ✓（ps1 的 `rmdir` 规则未被前缀改造放宽或收紧）。
> `hook-bypass-regression` 第 26 条 `cmd /c del /f C:\x\y` **仍 deny** ✓。

### 6.3 redact parity 与红线变异（G15b）

| 被测体 | 要求 | 实测 | 结论 |
|---|---|---|---|
| **主源 A/B/C** | 绿 | `tests 3 / pass 3 / fail 0`，rc=0 | **✅** |
| **M4**（`redact_text` 直通，冻结基底 +1 行） | 必红 | `tests 3 / pass 0 / fail 3`，rc=1 | **✅ 红** |
| **M2**（TAB 转义改回原样） | 必红 | `redact-parity`：`3 / 3 / 0` rc=0 → **不红**；**`sh-failclosed-test`：`TOTAL 34 / PASS 31 / FAIL 3` rc=1 → ✅ 红** | **✅ 红（由 G5 套件持有）** |

> **口径更正（B-5）**：TAB/C0 红线由 **`sh-failclosed-test`** 持有（其内 4 条 TAB 用例），**不是** `redact-parity`；
> 本轮变异体从**冻结终版**派生、在**能真实触发的套件**上跑，故可复现（与 FIX5 的 `M2r` 不可复现形成对照）。

### 6.4 node 全量

`cd agent-risk-guard && node --test` → **tests 380 / pass 380 / fail 0**（rc=0，253.7 s）。
（379 → 380 = 新增的「跨端身份断言」测试。）

---

## 7. 副本表（D9：BOM 逐份 / 行尾 / distinct）

| 组 | 副本 | sha256(16) | 字节 | BOM | CRLF | distinct |
|---|---|---|---|---|---|---|
| **sh ×3** | audit / `agent-risk-guard/skills/agent-risk-guard/scripts` / xhs-publish | `75dce9a0c75a676b` | 45808 | **False ×3** | 0（LF） | **1 ✅** |
| **ps1 ×6** | audit / `assets/hooks` / `skills/agent-risk-guard/scripts` / `~/.claude/hooks` / `~/.codex/hooks` / `~/.gemini/config/hooks` | `ec8c419bd2cf65f7` | 39917 | **True ×6（逐份）** | 0（LF） | **1 ✅** |

**同步顺序遵循 D9**：改 → 测（探针 + 闸门 base 绿）→ **同步副本** → 复核 distinct/BOM/行尾 → 最后更新报告。
**D9 实录**：`edit` 工具写入 ps1 会**丢 BOM**（已实测：丢 BOM 后 `powershell.exe` 按 ANSI 读中文源 → **整份解析失败**、每条载荷 `EXIT-1`）；
故本轮在**全部编辑完成后**用 `_g3fix6_bom.mjs` 逐份补 BOM，并在 §7 与 §6.1/6.2 实跑中复核（补 BOM 是**运行前提**，不是形式检查）。

---

## 8. 未解决问题 / 主动收窄（诚实口径）

1. **既存两端分歧（非本轮引入，未入闸门；闸门 `_g3fix6_probe.json` 中唯一的 cross-end 分歧即此条）**：
   - `rmdir <无标志路径>`（sh deny / ps1 allow）——POSIX 的 `rmdir` 是永久删除，Windows 非递归 `rmdir` 是安全操作；
     两端各有套件钉死（ps1 `hook-fp-regression.ps1` 第 5 条 expect allow；sh 删除族铁律）。
   - **本轮把该分歧沿包装词前缀同构扩展了**：`time|nice|nohup rmdir /tmp/empty_dir`、`(rmdir /tmp/empty_dir)` 等
     现在也是 **sh deny / ps1 allow**（FIX5 时两端都 allow）。**这是本轮的已知副作用，明确登记**：
     修法必须**两端同批**（sh 侧不补包装词则 8 条回归收不回；ps1 侧补 `rmdir` 无标志拦截则会打破 ps1 自有套件）——
     按 D12 第二选项「保留分歧并如实登记」处理，并已写进闸门文件头与 L 段注释。
   - `echo "Format-Volume guide"`（sh deny / ps1 allow）——sh 的 `format-volume` 规则读未剥离 echo 的原文，pre-G3 即存在。
2. **`then|do|else` 的位置偏离**：见 §1.2。若 Evaluator 判定必须逐字照抄处方，切换成本 = 改 2 处定义（每端 1 行），语料无需改（`K39`–`K56` 期望不变），但会新增 3 条引号内散文过拦（`git commit -m "do rm docs"` 等）。
3. **`(` / `{` 锚对引号内文本仍可能过拦**（与既有 `;`/`|` 锚同性质，pre-G3 即如此）：例如 `git commit -m "fix (rm -rf)"`。本轮**未**扩大该面（新增的只有包装词与 `(`/`{` 两个字面锚，后者在 FIX5 前由 ps1 的**无锚**规则覆盖，故不是新增过拦）。登记为加固候选。
4. **未覆盖（沿用 FIX5 口径）**：`fdisk/parted/wipefs` 在 ps1 端仍无规则（sh 有）→ 分歧保留；`icacls` 两端不同形；`~`/`$PATH` 变量前缀、`$( )` 内嵌包装（部分由 10/31 段兜住）。
5. **未做**：xhs 树的 ps1（21 KB 精简变体，**不在 6 份同步清单**）本轮未动、未跑其自有套件（与 FIX4/FIX5 一致，非遗漏）；`hook-redact-test` 的夹具值未改（本轮不涉及脱敏面）。
6. **诚实披露**：本轮第一次跑红线脚本时，我在 UTF-8 **无 BOM** 的 `.ps1` 里写了中文注释并用 `powershell.exe -File` 执行 → **PowerShell 5.1 解析失败（我的 harness 问题，不是产品缺陷）**；补 BOM + `Parser::ParseFile` 复核（0 error）后重跑，结果见 §6。所有红线**单次运行即通过**，未出现需要按 D10 复跑的假红。

---

## 9. 证据清单（`agent-risk-guard/tasks/orchestrator/`）

| 文件 | 内容 |
|---|---|
| `_g3fix6_probe.mjs` / `_g3fix6_probe.json` / `_g3fix6_probe_FIX5.json` | 97 条 × 2 端**串行真实 spawn**（终版 / FIX5 冻结）harness + 结果 |
| `_g3fix6_before_after.md` / `_g3fix6_beforeafter.mjs` | 97 条 before/after 对照表（34 行变化，全部 allow→deny，0 放松） |
| `_g3fix6_threepcol.mjs` / `_g3fix6_threepcol.txt` / `_g3fix6_three_col.md` | **pre-G3 / FIX5 / FIX6 三列 ps1** 对照（回归的直接证据） |
| `_g3fix6_extract_frozen.mjs` / `_g3fix6_baseline/` | `git show` 取出的 5 个**冻结字节**基线 + 哈希复核 |
| `_g3fix6_apply_ps1.mjs` | ps1 单一定义的机械改造脚本（打印 17 处逐处行号；幂等） |
| `_g3fix6_mutants.mjs` / `_g3fix6_mutants.txt` / `_g3fix6_mutants/` | 6 个**从冻结终版派生**的变异体 + sha/字节/BOM |
| `_g3fix6_redlines.ps1` / `_g3fix6_redlines.txt` / `_g3fix6_redlines_console.log` | **串行**跑全部红线（sh×12 / ps1×10 / redact / M2 / 闸门变异 / node 全量） |
| `_g3fix6_gate_base.log` / `_g3fix6_gate_A.log` / `_g3fix6_gate_B.log` | 闸门三态（绿 / A 红 18 / B 红 22） |
| `_g3fix6_suite_*.log` / `_g3fix6_redact_*.log` / `_g3fix6_failclosed_M2.log` / `_g3fix6_node_full.log` | 各套件原始输出 |
| `_g3fix6_sync.mjs` / `_g3fix6_sync.txt` | 9 份副本同步 + sha/BOM/CRLF/distinct 复核（`SYNC-CHECK=PASS`） |
| `_g3fix6_bom.mjs` | BOM 补齐工具（D9） |

**改动文件**：`agent-risk-guard-audit/scripts/dangerous-commands.sh`（源）、`agent-risk-guard-audit/scripts/dangerous-commands.ps1`（源）、
其余 2 份 sh + 5 份 ps1 副本（同步）、`agent-risk-guard/packages/core/test/decision-parity.test.ts`（语料 + 身份断言）、
`IMPLEMENTATION_RESULT_G3-FIX5.md`（§5 补实 + §8-2 口径改写）。
