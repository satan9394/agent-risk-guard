# EVALUATION RESULT G3-FIX5 —— 向上对齐（首次动 ps1）+ 结构性收敛 + 闸门补缺（**独立验收**）

> 验收人：**全新独立 Evaluator**（不继承实现者/编排者/前轮 Evaluator 的推理上下文）。预设立场「实现可能存在错误」。
> 只读主源；全部变异在隔离副本 `E:\DeepSeek_Harness\workspace\2026_08_21\.eval-tmp\g5fix5eval\mutants\` 进行，**未改动任何主源**。
> 语料**完全自造**（A 矩阵 44 · B 空引号 24 · K keep 7 · G 反向守卫 11 · N 新绕过 12 · O 过拦 25 · W 包装 5 · R2/结构性 9 · 聚焦探针 17，共 **162 条**），**未复用**实现者的 160 条，也**未复用**上一轮 Evaluator 的 218 条。
> 列：`ps1`(FIX5) / `ps1F4`(FIX4，**已用 git 独立证实**) / `shFix`(FIX5) / `shPre`(pre-G3 冻结) / `shG3`(post-G3)。

---

## 0. 验收结论

# **REJECT**

任务卡 §7 列出的**每一条验收标准我都实测通过了**（§A 两端 deny、§B 两端 deny、keep 仍 allow、反向守卫仍 deny、闸门自相矛盾已清、副本/BOM 全对）。这一部分要**明确肯定**。

**但 FIX5 是本轮首次改动 ps1，而这次改动在 ps1 端做了一次未被度量的「向下对齐」**：把 ps1 三条**原本无前导锚**的规则（rule 7 `format` / rule 8 `diskpart` / rule 14 `del|erase|ri|rd|rmdir`）改成与 sh 同形的**命令位锚**。锚化本身是对的（它修掉了 `x diskpart`、`git commit -m "remove Diskpart usage"` 的误伤），但**锚化同时把「命令词前面的包装词/子 shell 起始符」这一整类形态从 ps1 的覆盖里删掉了**，而这些形态在真实 shell 下**确实执行危险命令**：

```
ps1(FIX4)=deny → ps1(FIX5)=allow   且 sh 两端一贯 allow（= 向下对齐）
  time diskpart / nice diskpart / nohup diskpart
  time rmdir /s /q x / nice rmdir /s /q x / nohup rmdir /s /q x
  (rmdir /s /q x)     { rmdir /s /q x; }     if true; then rmdir /s /q x; fi
  time format C: /q   time del /f x   time erase x   time ri -r x
```

我用 `wsl bash` 实测这些包装词/起始符**确实会执行其后的命令**（`time/nice/nohup/( )/{ }/if…then/for…do` 全部真实执行，见 §3.4）。**ps1 从 pre-G3 到 FIX4 逐字节未变**（`git show 6ea0342:…ps1` 与 `git show 4c94b90:…ps1` 同为 `fb85cc0e4476ae58` / 34523 B），**FIX5 是首次改动 → 上述 deny→allow 是相对冻结基线的客观回归**，与 FIX4 被 REJECT 的那一类错误同构：`既有 deny 被放宽` + `闸门零覆盖` + `报告口径偏小`。

**同时必须说清另一半**：本卡的核心目标**全部达成**，红线也**基本全绿**（sh 12/12、`sh-failclosed` 34/34、ps1 五套 10/10、redact A/B/C 绿 + M4 红、node 379/379，闸门 base 绿且 A/B 回退分别红 27/22 条）。**REJECT 只卡在 §3.1 这一处**，修法很小（§9，扩展统一前缀 + 补 10 条语料），**不需要回退本卡任何已完成的改动**。

| # | 判定项 | 结论 |
|---|---|---|
| 1 | **§A 向上对齐真达成**（sudo/路径前缀 × 危险基座两端 deny，含任务点名 6 条） | **PASS** ✅ |
| 2 | **ps1 首次改动的新风险面**：过拦方向 | **PASS**（25 条合法命令全 allow，含 6 条 `sudo <安全命令>`） ✅ |
| 2b | 同项：**ps1 空引号归一的新绕过** | **PASS**（12 条自造绕过形态，10 条 deny、2 条经 bash 语义判定应 allow；无新绕过） ✅ |
| 2c | 同项：**锚化引入的新「向下对齐」** | **FAIL ❌ → REJECT 依据**：≥10 条**真实可执行**危险形态 ps1 deny→allow |
| 2d | 同项：ps1 未涉及规则是否被意外改动 | **PASS**（抽样 `git/diskpart/format/SSH/PEM` 面 + ps1 五套） ✅ |
| 3 | **§B 空引号收敛真达成**（24 条两端 deny、`rm'' --help` 仍 allow、守卫仍 deny） | **PASS** ✅ |
| 4 | **闸门**：自跑 / 矛盾消除 / 补语料 / 变异必红 | **PASS** ✅（base 绿 0/147；A 回退红 27 条、B 回退红 22 条，红点分属 K 段/F 段）——但**变更前交付物里该证据缺失**（§7-F1） |
| 5 | 红线不回退 | **基本 PASS**（sh 12/12、failclosed 34/34、ps1 10/10、redact A/B/C 绿、M4 红、M2 红在 G5 套件上、node 379/379）；**唯「既有 deny 不被放宽」FAIL**（= 2c） |
| 6 | 副本 ×3 / ×6、BOM、行尾、同代抽验（D9） | **PASS** ✅ |
| 7 | 报告 §8 逐条复核 + 是否又造新的向下对齐 | **FAIL（口径偏小）** + **是，已有新的向下对齐**（= 2c） |

**必须肯定的部分**（避免误伤实现者）：
- **§A 修得干净、方向正确**：任务点名的 6 条 + 我自造的 44 条前缀矩阵**两端全部 deny**；ps1 的 U2 洞（chmod 不认 sudo）**确实堵上了**。
- **§B 结构性收敛真实有效且方向向上**：24 条空引号危险写法**两端全部 deny**（FIX4 两端 allow）；`rm'' --help`/`-h`/`--version`、`sudo rm --help` 仍 allow；11 条删除族反向守卫仍 deny；`R''''emove-Item`、`''''''''rm -rf` 等仍 deny。
- **闸门自相矛盾确已清除**（F1–F15 由 allow 改钉 deny，与 C 段同判），并新增 K 段覆盖 sudo/路径/既存分歧族/包装面。
- **ps1 的既存分歧族被真正消除**：`sudo|sudo''|/usr/bin/` × `diskpart|rmdir|format` 6 组两端 deny；`git commit -m "remove Diskpart usage"` 由 ps1 的误伤 deny 变两端 allow。
- **副本/BOM/distinct/行尾/同代**全部与声明一致（§6）。
- 报告**主动登记**了 `x <词>` 放松面与 2 条既存残留，未掩盖（但口径偏小，见 §3.5）。

---

## 1. 验收方法、基线与语料（D6 / D8 / D10）

**被测对象（我独立复算）**

| 文件 | sha256(16) | 字节 | BOM | 行尾 |
|---|---|---|---|---|
| `agent-risk-guard-audit/scripts/dangerous-commands.sh` | `692d0451a84c451e` | 44326 | False | LF |
| `agent-risk-guard/skills/agent-risk-guard/scripts/dangerous-commands.sh` | `692d0451a84c451e` | 44326 | False | LF |
| `agent-risk-guard-audit-xhs-publish/scripts/dangerous-commands.sh` | `692d0451a84c451e` | 44326 | False | LF |
| ps1 ×6（audit / assets/hooks / skills / `~/.claude/hooks` / `~/.codex/hooks` / `~/.gemini/config/hooks`） | `5a18ef0f04ddd30d` ×6 | 39349 ×6 | **True ×6** | LF |
| `packages/core/test/decision-parity.test.ts` | `0cabb3394ae9572e` | 34551 | — | LF |
| `agent-risk-guard-audit/tests/hook-redact-test.ps1` | 见 §5（本卡改动为**测试夹具值替换**，我逐条核对未削弱断言） | — | — | — |

> 注：`agent-risk-guard-audit-xhs-publish/scripts/dangerous-commands.ps1` = `0b836d6de9278a11` / 21466 B，**不属于**「ps1 ×6」清单（该树历来只有 sh 在同步集内），与 FIX4 一致，**不构成副本缺失**。

**基线（D8）—— 我用 git 独立证实四列基线可信**：

```
$ git show 4c94b90:skills/agent-risk-guard/scripts/dangerous-commands.ps1  → fb85cc0e4476ae58 / 34523 B
$ git show 4c94b90:skills/agent-risk-guard/scripts/dangerous-commands.sh   → a4b95f9cd683f3bc / 41374 B
$ git show a509afe:skills/agent-risk-guard/scripts/dangerous-commands.sh   → 8ac7782d87b95415 / 34359 B
$ git show 6ea0342:skills/agent-risk-guard/scripts/dangerous-commands.ps1  → fb85cc0e4476ae58 / 34523 B   ★
```
★ **关键新证据**：**pre-G3 的 ps1 与 FIX4 的 ps1 逐字节相同**（`fb85cc0e…`）——即 **ps1 从 pre-G3 到 FIX4 完全没被动过**，FIX5 是首次改动。因此「ps1 的 pre-G3 基线」就是「FIX4 ps1 基线」，本轮 ps1 上的 deny→allow **直接就是相对冻结基线的回归**，无需另设一列。

**方法（D6）**：自建 harness `.eval-tmp\g5fix5eval\probe.mjs`（145 条 × 5 列 = 725 次 spawn）+ `focused.mjs`（17 条 × 4 列 = 68 次 spawn），**逐条串行 `spawnSync` + 进程 stdin**：
- ps1：`powershell.exe -NoProfile -ExecutionPolicy Bypass -File <hook>`；
- sh：`wsl.exe -e bash /mnt/e/.../dangerous-commands.sh`；
- `EMPTY`（空 stdin）= **deny**（fail-closed），实测 5 列**全部 deny**；
- 不可判读输出 **2/725**（均为 `shG3`，是 G3 基线自身的 `INVALID-JSON` 缺陷，与本卡无关）。

**D10 记录**：全程串行，**未出现跨端假红**；闸门三次运行（base / A 变异 / B 变异）亦**串行**执行，单次全红/全绿均无并发干扰。

---

## 2. 逐项：§A 向上对齐（项目 1）—— **PASS ✅**

### 2.1 任务点名的 6 条（自跑，真实 spawn + 进程 stdin）

| 载荷 | ps1 | ps1F4 | **shFix** | shPre | shG3 | 应然 | 判定 |
|---|---|---|---|---|---|---|---|
| `sudo chmod 777 /x` | **deny** | allow | **deny** | deny | deny | deny | ✅ |
| `sudo find /tmp -delete` | **deny** | allow | **deny** | deny | deny | deny | ✅ |
| `/usr/bin/find /tmp -delete` | **deny** | allow | **deny** | deny | deny | deny | ✅ |
| `echo x \| sudo xargs rm` | **deny** | allow | **deny** | deny | deny | deny | ✅ |
| `sudo shutdown /s` | **deny** | deny | **deny** | deny | deny | deny | ✅ |
| `chmod 777 /x` | **deny** | deny | **deny** | deny | deny | deny | ✅ |

### 2.2 同类矩阵（4 前缀 × 11 危险基座 = 44 条，我自造）

前缀 `''` / `sudo ` / `sudo'' ` / `/usr/bin/` × 基座 `chmod 777 /x`、`find /tmp -delete`、`find /tmp -exec rm {} ;`、`xargs rm < list.txt`、`shutdown /s`、`rmdir /s /q x`、`diskpart`、`format C: /q`、`rm -rf /tmp/t`、`unlink /tmp/t`、`shred -u /tmp/t`。

**结果：40/44 两端 deny；4 条 `x`/`x''` 前缀形态（非命令）两端 allow。**
`ps1` 相对 FIX4 **由 allow → deny 的条目共 20 条**（含 `/usr/bin/unlink`、`/usr/bin/shred`、`sudo unlink`、`sudo shred`、`command chmod 777 /x`、`env find /tmp -delete`、`sudo'' shutdown /s` 等），**无一条由 deny → allow**（`x <词>` 5 条例外，见 §3.1，均为不可执行形态）。
`shFix` 相对 pre-G3 亦**无真实危险放松**（§2.3c 分类见下）。

### 2.3 全量分歧扫描（我自跑 145 条 × 5 列）

**（a）`ps1 ≠ shFix` 的分歧只剩 3 条，且全部是报告 §8 已登记的既存残留：**

| 载荷 | ps1 | shFix | 性质 |
|---|---|---|---|
| `echo "Format-Volume guide"` | allow | **deny** | 既存（sh rule 17 读未剥 echo 的原文）；FIX4 亦然 |
| `rmdir /tmp/empty_dir` | allow | **deny** | 既存（POSIX vs Windows 语义冲突，各自套件钉死） |
| `sudo rmdir /tmp/empty_dir` | allow | **deny** | 同上（本轮新出现的同族镜像） |

→ 与原 5 条 G3 分歧、13 条 R1 分歧、12 条 U1 分歧相比，**分歧面收敛到 3 条**，收敛方向正确。

**（b）过拦面（项目 2 上半）—— 25 条合法命令全部两端 allow，`ps1` 无一条过拦**：
`sudo git status` / `sudo ls -la` / `sudo apt-get install vim` / `sudo systemctl restart nginx` / `sudo cat FORMAT.txt` / `sudo grep RM f` / `sudo chmod +x build.sh` / `sudo find . -name '*.log'` / `sudo xargs --version` / `sudo rm --help` / `git commit -m "chmod 777 fix"` / `git log --grep="chmod 777"` / `git diff --stat /usr/bin/README` / `cat ./etc/mkfs.conf` / `./tools/format.py` / `echo "find / -delete"` / `echo "it''s"` / `find . -name ''` / `cat notes.txt | grep shutdown` … **全部 allow ✅**
（其中 `echo "find / -delete"` / `echo "please shutdown the server"` / `cat notes.txt | grep shutdown` / `git commit -m "run chmod 777 in ci"` 在 **pre-G3 sh 上原本是 deny 的过拦**，本卡修对。）

**（c）`shFix` 相对 pre-G3 的放松只有 8 条，逐条判读后**：`rm'' --help`/`-h`/`--version`（**应然 allow**，help 豁免回归）、`echo "find / -delete"`、`echo "please shutdown the server"`、`cat notes.txt | grep shutdown`、`git commit -m "run chmod 777 in ci"`（**应然 allow**，修过拦）、`x chmod 777 /x`（`x` 非命令）。→ **无一条真实危险命令被放松 ✅**（FIX4 的 12 条已全部收回）。

---

## 3. ps1 首次改动的新风险面（项目 2）—— **过拦 PASS / 新绕过 PASS / 新向下对齐 FAIL ❌**

### 3.1 放松面（ps1 FIX4=deny → FIX5=allow），我用 162 条语料穷举出 **21 条**

| # | 载荷 | ps1F4 | ps1(FIX5) | shFix | shPre | 真实可执行危险？ |
|---|---|---|---|---|---|---|
| 1 | `x diskpart` | deny | allow | allow | allow | ❌ 不可执行（`x` 非命令） |
| 2 | `x rmdir /s /q x` | deny | allow | allow | allow | ❌ 同上 |
| 3 | `x format C: /q` | deny | allow | allow | allow | ❌ 同上 |
| 4 | `x'' diskpart` | deny | allow | allow | allow | ❌ 同上 |
| 5 | `git commit -m "remove Diskpart usage"` | deny | allow | allow | allow | ❌ 合法命令（**修误伤，正确**） |
| 6 | `time diskpart` | **deny** | **allow** | allow | allow | **✅ 是**（`time` 真实执行其后命令） |
| 7 | `nice diskpart` | **deny** | **allow** | allow | allow | **✅ 是** |
| 8 | `nohup diskpart` | **deny** | **allow** | allow | allow | **✅ 是** |
| 9 | `time rmdir /s /q x` | **deny** | **allow** | allow | allow | **✅ 是** |
| 10 | `nice rmdir /s /q x` | **deny** | **allow** | allow | allow | **✅ 是** |
| 11 | `nohup rmdir /s /q x` | **deny** | **allow** | allow | allow | **✅ 是** |
| 12 | `(rmdir /s /q x)` | **deny** | **allow** | allow | allow | **✅ 是**（子 shell） |
| 13 | `{ rmdir /s /q x; }` | **deny** | **allow** | allow | allow | **✅ 是**（花括号组） |
| 14 | `if true; then rmdir /s /q x; fi` | **deny** | **allow** | allow | allow | **✅ 是**（`then` 后是命令位） |
| 15 | `time format C: /q` | **deny** | **allow** | allow | allow | **✅ 是** |
| 16 | `time del /f x` | **deny** | **allow** | allow | allow | ⚠️ 边界（`time` 可执行，`del` 在 Git Bash 不存在） |
| 17 | `time erase x` | **deny** | **allow** | allow | allow | ⚠️ 边界（同上） |
| 18 | `time ri -r x` | **deny** | **allow** | allow | allow | ⚠️ 边界（同上） |
| 19 | `then rmdir /s /q x` | **deny** | **allow** | allow | allow | ❌ 单独不可执行 |
| 20 | `time rmdir /tmp/empty_dir` | allow | allow | allow | allow | ❌（无标志，两端本就 allow） |
| 21 | `bash -c "rmdir /s /q x"` | deny | **deny** | deny | deny | ✅ 未放松（另有 `bash -c` 规则兜住） |

→ **≥10 条真实可执行危险命令在 ps1 端由 deny 变 allow**（第 6–15 条），另 3 条边界（16–18）。
**ps1 的 pre-G3 基线 = FIX4 基线**（§1 ★），故这 10 条**是相对冻结基线的客观回归**，不是「本来就分歧、现在一致了」。
`sh` 端这 10 条**在 pre-G3 就是 allow**（`CMD_SEG` 锚同理），本卡 sh 侧**没有回退**；但 **ps1 侧是被「向下」拉到 sh 的宽松端**，直接违反任务卡 §5 的 **D12**（"不得向下对齐以致放松真实危险命令……要么两端一起收紧，要么保留分歧并如实记录"）。

**根因（可指代码行）**：ps1 三条规则由**无锚**改为**命令位锚**——
- rule 8 `diskpart`：`$cmdTest -match '(?i)\bdiskpart\b'` → `'(?i)(?:^|[;&|\r\n])\s*(?:sudo\s+)?(?:/[^\s;&|]*/)?(?:cmd(?:\.exe)?\s+/c\s+|command\s+|env\s+)?diskpart\b'`
- rule 7 `format`、rule 14 `del/erase/ri/rd/rmdir` 同批锚化。

锚化**必须做**（它修掉了 `x diskpart` 与 commit message 误伤），但**统一前缀 `CMD_PRE` 里没有覆盖「命令位之前的包装词/子 shell 起始符」**（`time|nice|nohup|doas|setsid|exec`、`(`、`{`、`then|do|else`），于是这些形态一起掉出了覆盖。**这不是方向错的修法，是修法不完整。**

### 3.2 ps1 空引号归一的新绕过（项目 2 中段）—— **PASS ✅（无新绕过）**

我自造 12 条专门针对「归一后可能新造绕过」的形态，逐条两端对照：

| 载荷 | ps1 | shFix | bash 语义 | 判定 |
|---|---|---|---|---|
| `sudo''chmod 777 /x` | allow | allow | → `sudochmod 777 /x`（**不是命令**） | ✅ allow 正确 |
| `rm''''` | allow | allow | → `rm`（无参，无害） | ✅ allow 正确 |
| `sudo'' chmod 777 /x` | deny | deny | → `sudo chmod 777 /x` | ✅ |
| `sudo'' find /tmp -delete` / `sudo'' xargs rm` | deny | deny | → 真实危险 | ✅ |
| `""chmod 777 /x` | deny | deny | → `chmod 777 /x` | ✅ |
| `ch''mod'''' 777 /x` | deny | deny | → `chmod 777 /x` | ✅ |
| `/usr/bin/ch''mod 777 /x` | deny | deny | → 真实危险 | ✅ |
| `f''ind /tmp -exec rm {} ;` | deny | deny | → 真实危险 | ✅ |
| `x''args rm < list.txt` | deny | deny | → `xargs rm` | ✅ |
| `shut''''down /s` | deny | deny | → `shutdown /s` | ✅ |
| `r''mdir'' /s /q x` | deny | deny | → `rmdir /s /q x` | ✅ |

**「归一后应 deny 却 allow」的写法：我未找到（0 条）。** 任务卡点名的 `s''hutdown /s`、`u''nlink`、`f''ind -delete`、`r''mdir /s` 全部 deny（§2 B 段）。
**新过拦（归一造成）亦未找到**：`echo "it''s"`、`find . -name ''`、`cat FORMAT.txt`、`git status`、`grep RM file.txt` 全部 allow ✅。
`ps1` 归一后新增 deny 的条目共 **61 条**（F 段 24 + 前缀矩阵 20 + 其它），**无一条是合法命令**。

### 3.3 ps1 未涉及规则是否被意外改动（项目 2）—— **PASS ✅**

静态：`git diff 4c94b90 d169d26 -- ...ps1` 只触及 L210-224（归一）、rule 6/7/8/14/16/16b/16c/28/29 的锚，以及 L592 日志读 `$cmdOrig`；**rule 1/2/3/5/9-13/15/16f/17-27/30-36 逐字未动**。
动态：`git`（`git clean -f`/`git reset --hard`/`git rm`/`git push --force`/`git branch -D` 归一路径两端 deny 且 `git status` allow）、`diskpart`、`format`、`cmd /c del /f C:\x\x`（deny）、`W1/W2` 包装面（deny）、R2 数组面（`[{"cmd":...}]` deny、邻居 allow）**decision 与 FIX4 一致或按预期收紧**，未见意外翻转。SSH/PEM/redact 面由 §5 的 ps1 五套与 redact parity 覆盖。

### 3.4 可执行性证据（我实跑，安全载荷）

```
$ wsl.exe -e bash -c 'time echo A; nice echo B; nohup echo C; (echo D); { echo E; }; if true; then echo F; fi; for i in 1; do echo G; done'
A B C D E F G        ← 全部真实执行（time/nice/nohup/子shell/花括号组/if…then/for…do 都是「命令位」）
```
→ §3.1 第 6–15 条的被包装命令**确实会被执行**，不是纯文本。

**空引号语义（我独立复跑，`set --` 只做词分割、不执行命令）：**

```
$ wsl.exe -e bash -c 'set -- g''''it clean -f; echo "$*"'     → git clean -f
$ wsl.exe -e bash -c 'set -- R''''MDIR /s /q x; echo "$*"'    → RMDIR /s /q x
$ wsl.exe -e bash -c 'set -- s''''hutdown /s; echo "$*"'      → shutdown /s
$ wsl.exe -e bash -c 'set -- f''''ind /tmp -delete; echo "$*"'→ find /tmp -delete
$ wsl.exe -e bash -c 'set -- sudo''''chmod 777 /x; echo "$*"' → sudochmod 777 /x   ← 非命令（allow 正确）
```
→ §B 的「两端 deny」是**向上**且必要；`sudo''chmod` 这类归一后**不构成命令**的形态 allow 也是正确的（§3.2）。

### 3.5 报告口径复核（项目 7 一半）

报告 §8-2 写：「`x <危险基座>` / 引号内文本：ps1 由 deny → allow（本轮**唯一**的 ps1 放松面）……这些形态**不可执行**（`x` 不是命令）」。
**该口径不成立**：松弛面的成因是「锚化」，`x` 只是它的**最无害子集**；同一处改动同时放松了 §3.1 的 10 条**可执行**形态，报告**未测、未列、未登记**。
报告 §3 表把该改动记为「ps1 的 rmdir 由无锚改锚（**修误伤**）」——只写了收益侧，**损失侧（包装词/子 shell）未列**，与任务卡 §1「以'两端一致且取更严者'为准，**逐条列出你的取舍**」不符（取舍只列了 `x`）。

---

## 4. 闸门（项目 4）

### 4.1 存在性 / 规模 / 期望修正（②③）

- 语料 `decision-parity.test.ts` 为 **九段**：A20 + B12 + C22 + Y10 + E2 + F18 + H12 + G14 + **K(K1–K28,K30–K38 = 37)** = **147 条**（实现者口径「142」略低，不影响结论）。
- **② 自相矛盾已消除（PASS）**：`F1–F15` 的 `expect` 由 `allow` 逐条改钉 **`deny`**，与 C 段同型用例同判，并在注释里写明「FIX4 曾把 F7/F8/F9/F13 钉成 allow 与 C 段自相矛盾，等于把 ps1 的洞当契约」。我逐条核对：
  `F7 R''MDIR /s /q x`=deny ↔ `C6 RMDIR /s /q x`=deny；`F13 f''ind /tmp -delete` ↔ `C12 find /tmp -DELETE`；`F8 s''hutdown /s` ↔ `C16 SHUTDOWN /s`；`F9 c''hmod 777 /x` ↔ `C17 CHMOD 777 /x`。**四对全部同判 ✅**
- **③ 新增语料（PASS，但仍有缺口）**：K 段确实新增了 ① `sudo/sudo''/usr/bin/` × `chmod/find -delete/find -exec/xargs/shutdown/rm`（K1–K14），② 既存分歧族 `diskpart/rmdir/format`（K15–K27），③ 过拦面（K28/K30–K32），④ 包装面（K33–K38）。**文件头新增 D12 声明**（"不得为过闸门放宽 deny 语义"，并列出 2 条已知残留不入语料）——这一条是我在 FIX4 裁决里点名要求的结构性改进，**已落实 ✅**。
  **缺口**：§3.1 的 10 条「包装词/子 shell」形态在 K 段**零覆盖**（这也正是它没被实现者发现的原因）。

### 4.2 自跑与变异（①④）

> 见 **§4.3 实测结果**（三次运行串行；base 必须绿，A/B 变异必须红）。

**我自造的 6 个隔离变异体**（副本，未改主源；`sha256(16)`）：

| 变异体 | 回退了什么 | 字节 | BOM | sha256(16) |
|---|---|---|---|---|
| `MA1-sh-noprefix.sh` | §A：sh `CMD_PRE` 退回 `CMD_SEG` 值 | 44183 | False | `a220c0c892fc1f63` |
| `MA2-ps1-noprefix.ps1` | §A：ps1 18 处 `(?:sudo\s+)?(?:/[^\s;&|]*/)?` 全删 | 38845 | True | `29e8b7ae37a640f3` |
| `MB1-sh-nonorm.sh` | §B：sh 删掉 `cmd="$cmdNoq"` | 44312 | False | `379da2b820f4f396` |
| `MB2-ps1-nonorm.ps1` | §B：ps1 删掉空引号归一那一行 | 39301 | True | `9c06419330f125c7` |
| `MAB-sh-both.sh` | §A+§B 合并回退 | 44169 | False | `91fb173c389140ef` |
| `MAB2-ps1-both.ps1` | §A+§B 合并回退 | 38797 | True | `eaa750c273e9e1d6` |


### 4.3 闸门实测结果（我自跑，三次**串行**；`node --test packages/core/test/decision-parity.test.ts`）

| # | 被测体 | 环境变量 | rc | tests/pass/fail | 不匹配条目数 | 判定 |
|---|---|---|---|---|---|---|
| ① | **主源**（ps1 `5a18ef0f…` + sh `692d0451…`） | — | **0** | 1 / **1** / 0（297.2 s） | **0** | **绿 ✅** |
| ② | **A 面回退**（我自造：ps1 `MA2-ps1-noprefix.ps1` 剥掉 18 处 `(?:sudo\s+)?(?:/[^\s;&|]*/)?`；sh `MA1-sh-noprefix.sh` 把 `CMD_PRE` 退回 `CMD_SEG`） | `RG_PARITY_PS1` / `RG_PARITY_SH` | **1** | 1 / 0 / **1**（181.8 s） | **27** | **红 ✅** |
| ③ | **B 面回退**（我自造：ps1 `MB2-ps1-nonorm.ps1` 删掉空引号归一；sh `MB1-sh-nonorm.sh` 删掉 `cmd="$cmdNoq"`） | 同上 | **1** | 1 / 0 / **1**（216.7 s） | **22** | **红 ✅** |

**红点归属（证明不是「一起变红」，两组打的是各自的面）：**

- **A 回退（27 条）**：全部集中在 **K 段**——`K1 sudo chmod 777 /x`、`K2 sudo'' chmod`、`K3 /usr/bin/chmod`、`K4 sudo find -delete`、`K5`、`K6 /usr/bin/find`、`K7/K8 find -exec`、`K9/K10/K11 xargs`、`K12 /usr/bin/shutdown`、`K13`、`K14 sudo rm x`，以及既存分歧族 `K15/K16/K17/K19/K20/K21/K23/K24/K25`、包装面 `K33–K36`。**F 段一条不红。**
- **B 回退（22 条）**：全部集中在 **F 段**（`F1–F15`，含 4 条 ★FIX4 自相矛盾点 F7/F8/F9/F13）与**依赖归一的 K 条目**（`K2/K5/K10`）。**前缀类 K 条目一条不红。**

→ **闸门对本轮 §A 与 §B 两处修复各自具备独立捕获力（PASS ✅）**；且 **base 绿 / 两变异红** 三态齐全，不存在「一改就全绿」的假绿。
（D10：三次运行全程**严格串行**，`node --test` 内部亦逐条 `spawnSync`；未出现并发假红，无需触发复跑。）

---

## 5. 红线不回退（项目 5）

全部由我独立复跑（真实 spawn；`bash '<tests>/<suite>.sh' '<tree>/scripts/dangerous-commands.sh'`；ps1 用 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File`）。**串行执行**。

### 5.1 sh 四套 × 三棵树

| 树 | sh-hook-test | sh-audit-bypass | sh-audit-edge | sh-failclosed-test |
|---|---|---|---|---|
| **audit** | 67/67 rc=0 | 192/192 rc=0 | 40/40 rc=0 | **TOTAL 34 / PASS 34 / FAIL 0** rc=0 |
| **skills** | 67/67 rc=0 | 192/192 rc=0 | 40/40 rc=0 | **TOTAL 34 / PASS 34 / FAIL 0** rc=0 |
| **xhs** | 67/67 rc=0 | 192/192 rc=0 | 40/40 rc=0 | **TOTAL 34 / PASS 34 / FAIL 0** rc=0 |

**12/12 次 rc=0、FAIL=0 ✅**（每棵树都用自己的 hook + 自己的 tests 目录，比「同一份 tests 跑三条路径」更严）。
`sh-failclosed-test.sh` 内含 **4 条 TAB/C0 用例**（`tab-separator` / `tab-in-args` / `danger-tab-comment` / `tab-inside-quotes`），即 **M2（TAB 转义）红线由本套件持有**。

### 5.2 ps1 五套（本轮首次动 ps1，我全跑，且跑了三棵树）

| 树 | audit-reregress | bypass-regression | fp-regression | redact-test | rules-test |
|---|---|---|---|---|---|
| **audit**（挂 audit hook） | **59/59** rc=0 | **18/18** rc=0 | **8/8** rc=0 | **119/119** rc=0 | **37/37** rc=0 |
| **skills**（挂 skills hook） | **59/59** rc=0 | **18/18** rc=0 | **8/8** rc=0 | **60/60** rc=0 | **37/37** rc=0 |
| xhs（挂 **xhs 自己的 21 KB ps1**） | 50/53 **rc=1** | 16/16 rc=0 | 5/5 rc=0 | 不存在 | 21/21 rc=0 |

- **两棵挂同步 ps1 的树：五套 ×2 = 10/10 全绿 ✅**（`hook-bypass-regression` 第 26 条 `cmd /c del /f C:\x\y` 确实保住，与报告 §6.2 一致）。
- **xhs 树的 3 条 FAIL 与 FIX5 无关**：该树的 ps1（`0b836d6de9278a11` / 21466 B / **mtime 2026-09-06**）**不在 6 份同步清单里**（FIX4 基线亦如此），是本轮**未被触碰**的精简变体（同树 sh 的 mtime 是 09-12）；它缺少 `perl -e 'unlink'`、`git checkout -- f`、`git restore f` 三条规则，故对**全量 ps1 的**测试集必然失败。→ **既有树间不一致，非遗漏**（但建议编排者单独登记）。

### 5.3 redact parity 与变异（G15b）

| 被测体 | 要求 | 我的实测 | 结论 |
|---|---|---|---|
| **主源** A/B/C | 绿 | `tests 3 / pass 3 / fail 0`，rc=0 | **✅** |
| **M4**（我自造：把 `redact_text` **直通**，冻结 FIX5 基底 +1 行改动，`94c1a7f797e4bd6a`） | 必红 | `pass 2 / fail 1`，rc=1 | **✅ 红** |
| **M2**（我自造：只把 TAB 的转义改回原样，`4fba0add6252bd00`） | 必红 | `redact-parity`：**`pass 3 / fail 0`，rc=0 ← 没红** | **❌ 该变异不被 redact-parity 覆盖** |
| **M2 同一变异体 → 换 `sh-failclosed-test.sh`** | 必红 | **`TOTAL 34 / PASS 31 / FAIL 3`，rc=1** | **✅ 红（M2 红线由 G5 套件持有）** |
| **M2r**（实现者自造 `_g3fix5_mutants/M2r-fix5-tab-unescaped.sh`） | 必红 | `redact-parity`：`pass 3 / fail 0`，rc=0 ← **同样没红** | ❌（与上同因） |
| **M4r**（实现者自造） | 必红 | `redact-parity`：`pass 2 / fail 1`，rc=1 | ✅ 红 |
| **M5**（我自造：`json_escape_text` 整体禁用转义） | —（新增探针） | `pass 2 / fail 1`，rc=1 | ✅ 证明 parity 对**逃逸路径本身**敏感，TAB 只是**语料未覆盖** |

**判定**：`redact parity A/B/C 绿 ✅` + `M4 变异红 ✅` + `M2（TAB/C0）变异红 ✅（由 `sh-failclosed-test` 而非 redact-parity 持有）`。
**但需登记**：① **`redact-parity` 语料中 TAB 零覆盖**（我 grep 全文件无 `\t`/TAB），任务卡把 M2 挂在 G15b 下表述**不精确**（实际由 G5 套件持有）；② **实现者自造的 `M2r` 变异体在 redact-parity 上也是绿的**，即实现者报告 §5 表里列的那一格**不可复现**（且该节本身仍是占位符，见 §7）。

### 5.4 node 全量

```
$ cd agent-risk-guard && node --test
ℹ tests 379 / pass 379 / fail 0 / cancelled 0 / skipped 0 / todo 0   (209.6 s)
NODE-EXIT=0                                    → 全绿 ✅
```

---

### 5.5 红线小结

| 红线 | 结论 |
|---|---|
| sh 四套 × 三棵树（67/192/40/34） | **✅ 12/12 rc=0 FAIL=0** |
| `sh-failclosed-test` 34/34（含 5 条异常路径 exit=0 + 合法 JSON + deny） | **✅ TOTAL 34 / PASS 34 / FAIL 0** |
| ps1 五套（同步树 ×2） | **✅ 10/10 rc=0** |
| redact parity A/B/C | **✅ 绿** |
| M4 变异必红 | **✅ 红** |
| M2 变异必红 | **✅ 红（在 `sh-failclosed-test` 上；在 `redact-parity` 上不红 → 语料缺口，非回退）** |
| R2（数组含对象 → deny）不回退 | **✅**（R2a/b/c 两端 deny，邻居 allow） |
| G3 五条原分歧 | **✅**（`r''m -rf` / `sudo'' rm -rf` 等守卫全 deny，`rm'' --help` allow） |
| 既有 allow 不放宽 | **✅**（25 条合法命令全 allow） |
| **既有 deny 不被放宽（相对 pre-G3）** | **❌ ps1 端回退 ≥10 条**（= §3.1） |

---

## 6. 副本 / BOM / 行尾 / 同代抽验（D9，项目 6）—— **PASS ✅**

| 组 | 副本 | sha256(16) | 字节 | BOM | CRLF | distinct |
|---|---|---|---|---|---|---|
| sh ×3 | audit / skills / xhs-publish | `692d0451a84c451e` | 44326 | **False** | 0（LF） | **1** ✅ |
| ps1 ×6 | audit / assets/hooks / skills / `~/.claude/hooks` / `~/.codex/hooks` / `~/.gemini/config/hooks` | `5a18ef0f04ddd30d` | 39349 | **True ×6** | 0（LF） | **1** ✅ |

- **同代抽验（不是「主源改了、副本没同步」）**：6 份 ps1 与主源 **sha256 完全相同**（`5a18ef0f04ddd30d`），3 份 sh 同理 → 副本与主源**同代**，非旧版残留 ✅。
- **D9（BOM）**：ps1 六份**逐份**验证 `EF BB BF` 前缀存在；sh 三份**无 BOM** ✅。报告承认「edit 工具写入 ps1 后 BOM 丢失、已补」，我实测**补回后正确**。
- 行尾：sh/ps1 全部 CRLF=0（LF），与 FIX4/实现者声明一致 ✅。

---

## 7. 其它发现（不构成 REJECT 依据，但需登记）

| # | 发现 | 证据 | 影响 |
|---|---|---|---|
| **F1** | **实现者报告 §5 仍是未填的占位符** `<!--MUTATION-RESULTS-->` | `IMPLEMENTATION_RESULT_G3-FIX5.md` L186 | 与「故障中断于收尾阶段」吻合；**闸门变异证据在交付物里根本不存在**。本轮由**我独立补上**（§4.3：A 红 27 / B 红 22），故该缺口不影响结论，但交付物按任务卡 §6 是**不完整**的。 |
| **F2** | **实现者自造的 6 个变异体不是冻结 FIX5 基底** | `_g3fix5_mutants/M4r-fix5-redact-passthrough.sh` 的 `CMD_PRE` **缺包装组**、`rmseg` 用 `\4`（终版是 `\5` + 包装组） | 它们是**中间态**（`_g3fix5_addwrap.ps1` 之前）的副本。红线的**结论**仍成立（脱敏代码路径同代），但「变异体 = 冻结产物 −1 行」的口径**不成立**。我改用**自己从冻结主源生成**的变异体。 |
| **F3** | **`M2r` 红线在 `redact-parity` 上不可复现** | 见 §5.3 | 任务卡把 M2 挂在 G15b（parity）下，实测 M2 由 `sh-failclosed-test`（34/34，含 4 条 TAB 用例）持有；`redact-parity` 语料 **TAB 零覆盖**。 |
| **F4** | **xhs 树的 ps1 是 21 KB 精简变体，不在 6 份同步清单内，其自有测试 50/53** | §5.2；mtime 09-06（同树 sh 09-12）；哈希 `0b836d6de9278a11` | **既有树间不一致**，非 FIX5 遗漏（FIX4 亦未同步它）。但「ps1 ×6」的口径应在报告里显式排除该文件，避免后来者误判。 |
| **F5** | **FIX5 提交顺带改了 3 个红线测试的夹具值**（AWS 文档示例密钥 → 合成值） | `redact.test.ts` / `redact-parity.test.ts` / `hook-redact-test.ps1` 的 diff | **定性：非作弊**——断言**未被削弱**（仍断言 `[REDACTED]` 且不得残留明文），值与断言同步更新；我实测这三套仍绿。**唯一口径变化**：新值不含 `/`，`aws_secret_access_key <value>` 的「值边界」覆盖**略有收窄**（`redact.test.ts` 第 3 条仍含 `/`，故未完全丢失）。 |
| **F6** | 报告称闸门语料 **142** 条，实测 **147** 条 | 我数 9 段明细：T20+Q12+C22+Y10+E2+F18+H12+G14+**K37** | 报告**低报** 5 条（不影响结论，方向与 FIX4 的「高报」相反）。 |
| **F7** | ps1 `$cmdOrig = $cmd` 取的是 **NFKC 之后**的文本，非原始输入 | ps1 L223（在 L210-211 全角归一之后） | 注释写「回读原文」，与实现有细微出入；**不影响判定**，未深究。 |

## 8. 特别标注（按任务卡分类）

| 类别 | 结论 |
|---|---|
| **新绕过面** | **未发现**（12 条自造绕过形态 + 24 条空引号形态 + 11 条反向守卫全部按应然判定） ✅ |
| **新过拦** | **未发现**（25 条合法命令全 allow，含 6 条 `sudo <安全命令>`、`find . -name ''`、`echo "it''s"`） ✅ |
| **向下对齐** | **有，且是本卡首次动 ps1 引入的（= REJECT 依据）**：`time/nice/nohup/( )/{ }/if…then` × `diskpart/rmdir/format/del/erase/ri` 共 **≥10 条真实可执行危险命令**在 ps1 端 `deny → allow`，相对 **pre-G3 冻结基线**（ps1 自 pre-G3 至 FIX4 从未改动，sha 逐字节相同）**构成客观回归**；方向为「向下」（取 sh 的宽松端），违反 D12。 |
| **闸门自相矛盾未清** | **已清** ✅（F1–F15 改钉 deny，与 C 段四对同判） |
| **闸门覆盖不足（残留）** | **有**：§3.1 的包装词/子 shell 面 **0 条**语料 → 该类放松在闸门下**完全不可见**（与 FIX4 的 REJECT 理由 #3 同构） |
| **ps1 未同步 / BOM 错** | **未发生** ✅（6/6 同 sha、BOM=True 逐份） |
| **红线回退** | 见 §5 |
| **既有 deny 被放宽（相对 pre-G3 冻结基线）** | **❌ 回退 ≥10 条**（ps1 端，= §3.1 第 6–15 条） |
| **报告口径偏差** | §8-2 把 ps1 放松面描述为「唯一」且「不可执行（`x` 不是命令）」——实测该面含 **10 条可执行**形态；§3 表只列收益侧（修误伤），未列损失侧。 |

---

## 9. 最小修法（向上对齐，D12 合规）

**原则**：锚化必须保留（它修掉了真实过拦），但**统一前缀要把「命令位之前的包装词 / 子 shell 起始符」补回来**，且**两端同批**（只改 ps1 会新造分歧，只改 sh 会放任 ps1）。

1. **两端 `CMD_PRE` 扩展**（可重复、可嵌套一次即可覆盖实测形态）：
   - sh `L415`：`CMD_PRE='(^|[;&|]|\bthen\b|\bdo\b|\belse\b|\(|\{)[[:space:]]*((sudo|time|nice|nohup|setsid|doas|exec|ionice|busybox)[[:space:]]+)*(/[^[:space:];&|]*/)?(cmd[[:space:]]+/c[[:space:]]+|cmd\.exe[[:space:]]+/c[[:space:]]+|command[[:space:]]+|env[[:space:]]+)?'`
   - ps1 18 处同形改为 `(?i)(?:^|[;&|\r\n]|\bthen\b|\bdo\b|\belse\b|\(|\{)\s*(?:(?:sudo|time|nice|nohup|setsid|doas|exec|ionice|busybox)\s+)*(?:/[^\s;&|]*/)?(?:cmd(?:\.exe)?\s+/c\s+|command\s+|env\s+)?`
   - ps1 的 `$cmd` 归一在掩码前会剥掉 `''`，故 `time'' diskpart` 一类自动被覆盖。
   - **注意**：**不得**把前缀放宽成「任意单词」，否则会把 `x diskpart`（K18/K22/K26）重新打成 deny，制造新过拦。
2. **闸门补语料**：K 段新增 `time/nice/nohup` × `diskpart`/`rmdir /s /q`/`format C: /q` 与 `(rmdir /s /q x)`、`{ rmdir /s /q x; }`、`if true; then rmdir /s /q x; fi` 共 ≥10 条，`expect: deny` 两端同判；并保留 `x diskpart`=allow 作为**反向守卫**（证明修法不是「一律 deny」）。
3. **报告口径**：把 §8-2 的「唯一放松面 / 不可执行」改为「`x <词>` 为不可执行子集；包装词与子 shell 形态为**可执行**子集，已一并收紧」。
4. **本卡其余部分无需改动**：§A/§B 的修法、闸门期望修正、副本同步、BOM 处理**均已正确**，最小修法**不必回退它们**。

> 若编排者判定「包装词/子 shell 属下一卡范围」，则按 D12 第二选项处理：**保留分歧并如实登记**——但**不能**像本轮这样把它当成「不存在」（报告口径与闸门覆盖都必须改写）。

---

## 10. 未做项 / 局限（诚实标注）

1. **未做**：`fdisk/parted/wipefs` 两端分歧的独立复现（报告 §8-4 自述 ps1 缺这三条规则）；`icacls` 两端不同形（§8-5）未测。
2. **未做**：`sudo'''` 等**三重以上**引号组合、`do`/`else`/`elif` 等其它命令位起始词的穷举（已覆盖 `then`）；`busybox find`、`doas`、`xargs -I{} sh -c` 等报告 §8-3 自认未覆盖的包装面**我亦未展开**（它们与本轮 REJECT 依据同族，属同一处修法）。
3. **未做**：`f''ind`/`d''el` 之外的**非删除族**空引号穷举（已覆盖 24 条 + 12 条自造，未见漏网）。
4. **收窄**：redact 面只跑 A/B/C 与 4 个变异（M4/M2/M2r/M5），未做 `SECRET_RULES` 逐条穷举。
5. **时间**：本轮实际耗时明显超 30 分钟时间盒（探针 725 + 68 次串行 spawn + 闸门三次全量 297/182/217 s + 12 套 sh + 13 次 ps1 套件 + 4 次 parity + node 全量 210 s）。**第 1–6 项已全部实测完成并落盘**，仅上述 1–4 为主动收窄。
6. **诚实披露**：① 第一次写变异脚本时 `function H` 与 PowerShell 别名 `h`(=Get-History) 冲突、第一次红线脚本把 `\$s` 写成字面反斜杠导致 12 套 sh 全 `RC=127`（**我的 harness 问题，不是产品缺陷**，已修并重跑，重跑结果见 §5.1）；② 我初期自造的 `M2`（只回退 TAB）在 `redact-parity` 上**不红**——我按 D10 精神换用 `sh-failclosed-test` 复验，确认**红**（§5.3），并把它登记为**语料覆盖缺口**而非回退。

---

## 11. 证据清单（`E:\DeepSeek_Harness\workspace\2026_08_21\.eval-tmp\g5fix5eval\`）

| 文件 | 内容 |
|---|---|
| `probe.mjs` / `results.json` / `analysis.txt` | 自造 **145 条 × 5 列**串行真实 spawn harness + 全量结果 + 分歧/放松/新增拦截分类 |
| `focused.mjs` / `focused.json` | **17 条**包装词/子 shell 聚焦探针（§3.1 的直接证据） |
| `mutants/` | 我自造的 **8 个**隔离变异体：`MA1/MA2`（A 面回退）、`MB1/MB2`（B 面回退）、`MAB*`（合并）、`M4-redact-passthrough.sh`、`M2-tab-unescaped.sh`、`M5-noesc.sh` |
| `gate.ps1` / `gate_base.log` / `gate_A.log` / `gate_B.log` | 官方闸门三次串行运行（base 绿 0 / A 回退红 27 / B 回退红 22） |
| `redlines.ps1` / `redlines.txt` / `suite_*.log` | sh 四套 × 三棵树 + ps1 五套 × 三棵树 + redact parity + 变异（含 M2 在 failclosed 上 31/34） |
| `mk_mutants.ps1` | 变异体生成脚本（可复算 sha256） |
| `ps1_preG3.ps1` | 我从 `git show 6ea0342` 独立取出的 pre-G3 ps1（证明 `fb85cc0e…` == FIX4 ps1） |
