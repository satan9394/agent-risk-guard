# EVALUATION RESULT G3-FIX4 —— 修 G3 三条硬伤 + 闸门补缺口（**独立验收**）

> 验收人：**全新独立 Evaluator**（不继承实现者/编排者推理上下文）。预设立场「实现可能存在错误」。
> 只读主源；全部变异在隔离副本 `E:\DeepSeek_Harness\workspace\2026_08_21\.eval-tmp\g4eval\` 进行，**未改动任何主源**。
> 语料**完全自造**（A/B/C/D/E/F/G/H 八段，共 218 条），**不复用**实现者的 110 条闸门语料，也不复用上一轮 Evaluator 的 153 条。
> 时长：约 85 分钟（远超 30 分钟时间盒；第 1–4、6 项在 T+35 分钟已定型并**落盘草稿**，超时用于第 5、7 项的实测——218 条 × 4 列 = 872 次真实 spawn、4 次官方闸门全量、12 套 sh 套件、node 全量）。

---

## 0. 验收结论

# **REJECT**

**任务卡点名的三条硬伤（R1/R2/R3）确实全部真修 —— 这一部分 PASS，四列实测逐条复核通过。**
但 **M3「锚点对齐」在执行时被做成了一次系统性的「向下对齐」（取更松的一端）**，并已在实测中产生 **12 条真实可执行破坏性命令由 deny 变 allow**，其中 **3 类（`sudo chmod` / `sudo find` / `sudo xargs`）在 pre-G3 冻结基线上本来就是 deny**；而**新增的闸门语料对该面零覆盖**，所以这类放松在闸门下完全不可见。

| # | 判定项 | 结论 |
|---|---|---|
| 1 | R2 fail-open 真修（`ps_cast.ps_elem` dict 分支） | **PASS** ✅ |
| 2 | **U2：为「两端一致」把 sh 向下对齐到 ps1 的洞** | **FAIL ❌ → REJECT 依据** |
| 3 | R1：M2 收窄是否引入新漏 | **PASS（无新分歧）** ⚠️ 但见 §4 的「向下对齐」登记 |
| 4 | M3 锚点副作用的副作用（find/xargs 补锚） | **FAIL ❌ 12 条真实危险命令由 deny→allow，另发现 U1 族远大于报告** |
| 5 | 闸门真实性与捕获力（110 条 + 3 变异体） | **PASS（本体/捕获力）** ✅ / **FAIL（覆盖力：sudo·chmod/find/xargs 面 0 条；F 段把 15 条可执行危险命令钉成 allow）** |
| 6 | pre-G3 / post-G3 基线可信度 | **PASS** ✅（git 历史独立证实） |
| 7 | 红线不回退 | **PASS（12 项全绿）** ✅，唯「既有 deny 不被放宽」一项 **FAIL**（= 第 2/4 项） |
| 8 | 残余项复核 | **FAIL（报告口径偏小）**：U1 族不是 1 条，是 ≥12 条 |

**必须肯定的部分**（避免误伤实现者）：
- **R1/R2/R3 三条硬伤全部真消除**，我用**四列并列**（ps1 / pre-G3 / post-G3 / post-FIX4）逐条自跑确认，与报告 §2 的表**逐格吻合**。
- **R2 修得干净且无过修**：A1–A5 全部回到 deny，A6–A9/A12 未过度收紧。
- **删除族仍严**：B16–B19/B24、C11–C15、F1–F7/F10–F12 共 20 条反向守卫**全部 deny**，与 ps1 一致。
- **过拦面基本清干净**：E1–E8/E10–E16 全 allow，未见新的合法命令过拦。
- **报告主动披露 U1/U2/U3/U5/U6 五项，未掩盖**；`ps_cast` 不再自称「忠实复刻」，口径已改。
- **副本 / BOM / distinct / 行尾全部与声明一致**（§3）。

---

## 1. 验收方法与基线（D6 / D8 / D10）

**被测对象**（我独立复算的 sha256 前 16 位）：

| 文件 | sha256(16) | 字节 | BOM | 行尾 |
|---|---|---|---|---|
| `agent-risk-guard-audit/scripts/dangerous-commands.sh` | `a4b95f9cd683f3bc` | 41374 | False | LF |
| `agent-risk-guard/skills/agent-risk-guard/scripts/dangerous-commands.sh` | `a4b95f9cd683f3bc` | 41374 | False | LF |
| `agent-risk-guard-audit-xhs-publish/scripts/dangerous-commands.sh` | `a4b95f9cd683f3bc` | 41374 | False | LF |
| ps1 ×6（audit / assets/hooks / skills / `~/.claude` / `~/.codex` / `~/.gemini/config`） | `fb85cc0e4476ae58` ×6 | 34523 ×6 | **True ×6** | LF |
| `packages/core/test/decision-parity.test.ts` | `194e30abcd9d6dda` | 24451 | — | LF |

**sh 3/3 distinct=1 ✅（BOM=False、LF）**；**ps1 6/6 distinct=1、BOM=True、零改动 ✅**。与编排者冻结值、与报告 §7 **逐字一致**。

**方法（D6）**：自建独立 harness `.eval-tmp\g4eval\probe.mjs`，**真实 spawn + 进程 stdin**：
- ps1：`powershell.exe -NoProfile -ExecutionPolicy Bypass -File <hook>`；
- sh：`wsl.exe -e bash /mnt/e/.../dangerous-commands.sh`；
- `EMPTY`（exit 0 + 无输出）= **allow**；非空必须是合法 JSON 且带 `permissionDecision`；
- **四列并列**：`ps1`（参照系）/ `shPre`（pre-G3 冻结副本）/ `shG3`（post-G3 重建副本）/ `shFix`（本卡主源）。

**D10 记录**：全程**逐条串行** `spawnSync`（97 + 121 = 218 条 × 4 列 = 872 次 spawn），**0 条 INVALID-JSON / EXIT-n / SPAWN-ERR**，**未出现 wsl 并发假红**，无需触发 D10 复跑。

---

## 2. 逐项 PASS / FAIL

### 2.1 项目 1 —— 三条硬伤真修：**PASS** ✅

**R2（fail-open，最严重）—— 真修，且无过修**（自跑，四列）：

| 载荷 | ps1 | shPre | shG3 | **shFix** | 判定 |
|---|---|---|---|---|---|
| `[{"cmd":"rm -rf /tmp/t"}]` | deny | deny | **allow** ← fail-open | **deny** | ✅ 修好 |
| `[{"a":1}]` | deny | allow | allow | **deny** | ✅（顺带修 D5） |
| `[{"a":1},{"b":2}]` | deny | allow | allow | **deny** | ✅（顺带修 D6） |
| `[{"cmd":"git status"}]` | deny | allow | allow | **deny** | ✅ 同族 |
| `[{"cmd":"echo hi"},{"x":2}]` | deny | allow | allow | **deny** | ✅ 同族 |
| `[{},{}]` | deny | allow | allow | **deny** | ✅（PS 真值 `" "`） |
| `[{"a":1},"x"]` / `{"a":{"b":1}}` / `[{"a":1},[1]]` / `[[1]]` | allow | allow | allow | **allow** | ✅ 未过度收紧 |

**R1（非删除族空引号插词）—— 真修**：B1–B15（`g''it clean -f` / `g''it reset --hard` / `g''it rm x` / `g''it push --force` / `g''it branch -D x` / `r''mdir` / `R''MDIR` / `s''hutdown` / `c''hmod` / `d''iskpart` / `sh''red` / `un''link` / `f''ind -delete` / `d''el` / `e''rase`）在 shFix **全部 allow = ps1**，G3 的 15 条分歧 **全部归零**（B16–B19/B24 反向守卫仍 deny）。

**R3（`-i` 点着的锚点）—— 真修**：E1–E8、E12、E13 全部 `ps1=allow / shFix=allow`；G3 的 9 条过拦全部消除。

**G3 五条原分歧不回退**（G 段）：

| 载荷 | ps1 | shPre | shG3 | shFix |
|---|---|---|---|---|
| `$X=RM; $X -RF /tmp/t` | deny | allow | deny | **deny** |
| `RM -RF /tmp/t` | deny | allow | deny | **deny** |
| `command:null` | deny | allow | deny | **deny** |
| `command:["rm","-rf","/tmp/t"]` | deny | allow | deny | **deny** |
| `rm'' --help` | allow | deny | allow | **allow** |

**全语料汇总（我自跑 218 条 × 4 列）**：`ps1 ≠ shFix` 的分歧共 **13 条**，**全部属于既存 U1 族**（§2.4），**0 条由本卡新造**；不可判读输出 **0**。

---

### 2.2 项目 2 —— **U2 决策点**：**FAIL ❌（构成 REJECT 依据）**

**实测（四列，串行自跑）**：

| 载荷 | ps1 | shPre | shG3 | **shFix** | 性质 |
|---|---|---|---|---|---|
| **`sudo chmod 777 /x`** | allow | **deny** | **deny** | **allow** | **真实危险命令被放松** |
| **`sudo find /tmp -delete`** | allow | **deny** | **deny** | **allow** | 同上 |
| **`/usr/bin/find /tmp -delete`** | allow | **deny** | **deny** | **allow** | 同上 |
| **`sudo xargs rm < list.txt`** | allow | **deny** | **deny** | **allow** | 同上 |
| **`sudo'' chmod 777 /x`** | allow | deny | deny | allow | 同上（bash 执行时 `''` 被消去） |
| `x chmod 777 /x` / `x find /tmp -delete` | allow | deny | deny | allow | 非可执行危险（`x` 不是命令） |

**这不是「本来就分歧、现在一致了」的纯收益**：`sudo chmod 777 /x` **在 pre-G3 冻结基线上是 deny**。也就是说，本卡把 **sh 端对一条真实危险命令的实际拦截能力删掉了**，换来与 ps1 的一致；而 ps1 的洞（chmod 规则不认 `sudo`）**本卡一个字没动**。

**裁定：是，构成 REJECT 依据。** 理由：

1. **违反编排者给定原则**：跨端一致性应「向上对齐（取更严的一端）」，本卡在此处**向下对齐**，且放松的是**真实危险命令**（不是误伤的合法命令）。
2. **不是「为消除 G3 新伤」的必要代价**：`sudo chmod 777 /x` 的分歧**不是 `-i` 造成的**（pre-G3 即 deny vs ps1 allow）。M3 的点名理由是「`-i` 把潜伏锚点不一致批量点着」，而 chmod 这条**在 pre-G3 就已经是独立的既有分歧**——把它一并「修」成 allow，超出了修 R3 的必要范围。
3. **闸门对此零覆盖**（我的 121 条 D 段独立测出 **17 处**同类向下对齐，闸门 110 条**一处都没有**）→ 这类放松**在闸门下完全不可见**，属于「以过闸门为由放宽 allow 语义」的实际效果（红线 §5.6）。
4. **拒绝理由与「实现者是否诚实」无关**：实现者在 §8-U2 主动登记了它，这是加分项；但登记不等于合格——**登记的是缺陷，缺陷仍是缺陷**。

**最小修法（向上对齐）**：

```sh
# sh L568（chmod）：保留 M3 的防误伤锚，补回 sudo 前缀
'(^|[;&|])[[:space:]]*(sudo[[:space:]]+)?chmod[[:space:]]+...'
# sh L449（find）/ L455（xargs）：同样补 (sudo[[:space:]]+)?
'(^|[;&|])[[:space:]]*(sudo[[:space:]]+)?find[^;&|\n]*-delete|...'
'(^|[;&|])[[:space:]]*(sudo[[:space:]]+)?(xargs[^;&|\n]*rm|...)'
```
并**同批**在 ps1 对应规则（L468 chmod / L333–L340 find·xargs）补 `(?:sudo\s+)?`，即 **ps1 6 份 + BOM 逐份复核（D9）**。只改 sh 会让 sh 严于 ps1（新分歧），所以「向上对齐」必须两端一起动——**这正是本卡为了绕开 ps1 六副本而选择向下对齐的代价**。

*（`/usr/bin/find` 这类**路径前缀**形态同样被新锚漏掉：ps1 也漏。若要两端一起收，锚应为 `(^|[;&|])[[:space:]]*(?:[^\s;&|]*/)?(?:sudo[[:space:]]+)?find\b`。）*

---

### 2.3 项目 3 —— M2 收窄是否引入新漏：**PASS（无新分歧）**

**（a）非删除族的空引号插词未被漏判为「分歧」—— 成立。** B1–B15 全部两端一致 allow。

**（b）删除族仍严 —— 成立。** 20 条反向守卫全 deny：

| 载荷 | ps1 | shFix |
|---|---|---|
| `r''m -rf /tmp/t` / `r''m'' -rf /tmp/t` / `rm'' -rf'' /tmp/t` / `rm'''' -rf /tmp/t` / `rm'' -rf /tmp/t` | deny | **deny** |
| `R''emove-Item x` / `R''''emove-Item x` / `R''emove''-Item x` | deny | **deny** |
| `''rm -rf` / `;''rm -rf` / `|''rm -rf` / `rm ''-rf` / `rm'-'-rf` / `"r"m -rf` / `rm"""" -rf` / `sudo'' rm -rf` / `''''''''rm -rf` | deny | **deny** |

**（c）⚠️ 但「未漏」不等于「没放松」—— 见 §4。** 任务卡问的 `git cl''ean -f`（引号插在**危险词内部**）实测：

| 载荷 | bash 执行结果（我用 wsl 实测 `set --`） | ps1 | shPre | shG3 | shFix |
|---|---|---|---|---|---|
| `git cl''ean -f` | **`git clean -f`** | allow | allow | deny | **allow** ⚠️ |
| `git res''et --hard` | **`git reset --hard`** | allow | allow | deny | **allow** ⚠️ |
| `shut''down /s` | **`shutdown /s`** | allow | allow | deny | **allow** ⚠️ |
| `ch''mod 777 /x` | **`chmod 777 /x`** | allow | allow | deny | **allow** ⚠️ |
| `unl''ink` / `shr''ed` / `rmd''ir` / `di''skpart` / `fi''nd /tmp -delete` | 同族真实命令 | allow | allow | deny | **allow** ⚠️ |
| `ss''hutdown` | `sshhutdown`（非命令） | allow | allow | allow | allow ✅ |

**结论**：`g''it clean -f`（插在命令词之间）与 `git cl''ean -f`（插在词内部）在 bash 下**是同一个命令**，两者都被 allow。M2 **没有**引入**新**分歧（C1–C9 与 ps1、pre-G3 一致），但它**确实把 G3 无意间补上的 9 条真实拦截又交还了回去**——这一点任务卡要求「验证非删除族的空引号插词不会被漏」，**答案是：不会变成分歧，但确实会被漏拦（与 ps1 同漏）**。

---

### 2.4 项目 4 —— M3 锚点改动的副作用：**FAIL ❌**

我用 **11 前缀 × 11 危险基座 = 121 条**的交叉矩阵（D 段）独立扫描，四列全跑。结果：

**（a）新增的向下对齐 = 17 处**（ps1=allow / shPre=deny / shG3=deny / **shFix=allow**）：

| 面 | 触发的形态 | 是否真实可执行危险 |
|---|---|---|
| `find -delete` | `sudo ` / `/usr/bin/` / `x ` / `sudo'' ` | **sudo / path / sudo'' 三类是**（3 条） |
| `find -exec rm` | 同上 4 类 | **3 条是** |
| `xargs rm` | 同上 4 类 | **3 条是** |
| `chmod 777` | `sudo ` / `x ` / `sudo'' ` | **sudo / sudo'' 两条是** |
| `shutdown` | `x ` / `sudo'' ` | **sudo'' 一条是** |

**共 12 条真实危险命令由 deny 变 allow**（其余 5 条是 `x ` 前缀的无害形态）。
根因：M3 把 find/xargs 从**完全无锚**改成 `(^|[;&|])[[:space:]]*`，而 ps1 用的是同形锚 → **凡 `sudo`/路径前缀后的 find/xargs 两端一起漏**。这在 pre-G3 **是拦住的**（无锚正则恰好命中）。

**（b）实现者自述「`find`/`xargs` 原本完全没有前导锚」—— 属实**，我独立核对：pre-G3 L341/L346 与 post-G3 L384/L389 **均无锚**（已逐字比对）。

**（c）新的过拦：未发现。** 含 `chmod` / `format` / `find` / `shutdown` 字样的合法命令（`git commit -m "run chmod 777 in ci"`、`git log --grep="chmod 777"`、`grep -rn "shutdown /s" docs/`、`echo "find / -delete"`、`cat notes.txt | grep shutdown`、`git commit -m "chmod 777 fix"`）**全部两端 allow**；其中 E3–E8/E12/E13 在 pre-G3 是 **deny**（真实过拦），本卡修对了。

**（d）⚠️ 报告 U1 口径偏小。** 报告称「112 条语料里**唯一**的残余分歧是 `git commit -m "remove Diskpart usage"`」。我的 121 条 D 段独立测出 **12 条** `ps1=deny / shFix=allow` 的既存分歧（pre-G3 与 post-G3 同判，**非本卡引入**）：

```
sudo diskpart        x diskpart        /usr/bin/diskpart     sudo'' diskpart
sudo rmdir /s /q x   x rmdir /s /q x   /usr/bin/rmdir ...    sudo'' rmdir ...
sudo format C: /q    x format C: /q    /usr/bin/format ...    sudo'' format ...
```
根因与 U1 同源：ps1 侧 diskpart/rmdir/format 规则**无前导锚**（`$cmdTest -match '\bdiskpart\b'` 等），sh 侧有 `${CMD_SEG}` 锚。
**这 12 条既存分歧，新增的 110 条闸门语料同样零覆盖** → 说明 M4 只补了「本轮三条硬伤」的面，**没有补「既存分歧面」**。

---

### 2.5 项目 5 —— 闸门真实性与捕获力

**（a）存在性 / 可运行性 / 语料规模 —— PASS ✅**
`packages/core/test/decision-parity.test.ts`：独立复算 **110** 条语料项（T20 + Q12 + C22 + Y10 + E2 + **F18 + H12 + G14**），`timeout: 1800000`（15 min 起的 30 min），逐条 `spawnSync` 串行，**自带「必须串行」注释**（D10 已内建）。
我独立跑了一遍（无并发干扰）：

```
✔ decision parity: ps1 与 sh 对同一语料的 permissionDecision 必须逐条一致且等于应然 (130740.8733ms)
ℹ tests 1  ℹ pass 1  ℹ fail 0  ℹ skipped 0   GATE-EXIT=0
```

**（b）F/H/G 三段是否真覆盖三类盲区 —— PASS（不是凑数）**：F 段 18 条确实钉住非 rm 族空引号插词（含 2 条反向守卫）；H 段 12 条确实含 `[{"cmd":"rm -rf /tmp/t"}]` 这条 **R2 直接回归**；G 段 14 条确实含 `git commit -m "remove SHUTDOWN path"` 这条 **R3 直接回归** + 3 条 `&& shutdown` / `; chmod 777` 反向守卫。

**（c）⚠️ 但 F 段把「ps1 的洞」钉成了「应然语义」—— 这是一个设计问题**：
`F1–F15` 的 `expect` 被钉为 **`allow`**，而这 15 条在 bash 下**实际执行的是危险命令**（我用 `wsl bash` 的 `set --` 逐条实测：`g''it clean -f` → `git clean -f`、`c''hmod 777 /x` → `chmod 777 /x`、`R''MDIR /s /q x` → `RMDIR /s /q x` …）。
**直接后果：同一份 110 条语料内部自相矛盾** ——
```
C6  RMDIR /s /q x      → expect deny
F7  R''MDIR /s /q x    → expect allow   ← bash 下与 C6 是同一条命令
C12 find /tmp -DELETE  → expect deny   vs  F13 f''ind /tmp -delete → allow
C16 SHUTDOWN /s        → expect deny   vs  F8  s''hutdown /s       → allow
C17 CHMOD 777 /x       → expect deny   vs  F9  c''hmod 777 /x      → allow
```
闸门不仅**看不见**这些放松，还**主动禁止**后续把 sh 收紧（一收紧就 `expect` 不符 → 变红），除非同批改 ps1。这正是「为过闸门放宽 allow 语义」的机制化形态。

**（d）捕获力（我自造变异体，独立复现）**：见 §6 —— 三个变异体全部把闸门打红，且红点集合互不相同。

---

### 2.6 项目 6 —— 基线可信度（实现者主动存疑项）：**PASS ✅（我用 git 历史独立证实）**

实现者承认 **post-G3 基线是它自己重建的**（`.eval-tmp/g3fix4/postg3-recon.sh`，`8ac7782d87b95415` / 34359 B），担心不可信。
**我不采信其重建脚本，改用 git 历史独立取证**：

```
$ git log --oneline
4c94b90 fix(sh): G3-FIX4 - repair 3 new defects ...
a509afe feat(sh): G3 cross-end decision convergence + decision-parity gate   ← 真 post-G3 提交
$ git show a509afe:skills/agent-risk-guard/scripts/dangerous-commands.sh > X
$ sha256(X)[0:16] = 8ac7782d87b95415   size = 34359
```
**与实现者重建副本、与上一轮 Evaluator 实测值三方逐字相同** → **post-G3 基线可信，结论不受影响** ✅。
（同理 pre-G3 `_g3_before/dangerous-commands.sh` = `7f7769f2175c6d88` / 30296 B，与上一轮 Evaluator 认定值一致。）

---

### 2.7 项目 7 —— 红线不回退

| 红线 | 要求 | 我的独立实测 | 结论 |
|---|---|---|---|
| G15b parity A/B/C | 绿 | **pass 3 / fail 0，PARITY-EXIT=0** | ✅ |
| G15b M4 变异 | 必红 | **pass 2 / fail 1，exit=1** | ✅ |
| G5 `sh-failclosed-test` | **34/34** | **TOTAL 34 / PASS 34 / FAIL 0，RC=0** | ✅ |
| G5 fail-closed 变异（我自造） | 必红 | **32/34，RC=1** | ✅ |
| sh 四套 × 三棵树 | 67/40/34/192 | **三棵树全绿，rc=0 ×12** | ✅ |
| node 全量 | 全绿 | 见 §6.3 | 见 §6.3 |
| 既有 allow 不放宽 | — | **未回退**（E1–E16、B20/B21、F8/F9、G5 全 allow；A6–A9 未过度收紧） | ✅ |
| **既有 deny 不被放宽** | — | **❌ 回退 12 条**（§2.4a 的真实危险命令；`sudo chmod`/`sudo find`/`sudo xargs` 三类在 pre-G3 即 deny） | **FAIL** |
| 副本 distinct / BOM / LF（D9） | — | sh 3/3 `a4b95f9cd683f3bc` distinct=1、BOM=False、LF；ps1 6/6 `fb85cc0e4476ae58`、BOM=True | ✅ |

---

## 3. 副本 / BOM / 行尾复核（D9）

| 组 | 副本 | sha256(16) | 字节 | BOM | 行尾 |
|---|---|---|---|---|---|
| sh ×3 | audit / skills / xhs-publish | `a4b95f9cd683f3bc` ×3（**distinct=1**） | 41374 ×3 | **False ×3** | CRLF=0（LF） |
| ps1 ×6 | audit / assets/hooks / skills / `~/.claude/hooks` / `~/.codex/hooks` / `~/.gemini/config/hooks` | `fb85cc0e4476ae58` ×6（**distinct=1**） | 34523 ×6 | **True ×6** | LF |

**ps1 本卡零改动属实**（D9 无触发）。实现者 §7-U4 关于「第 6 份 ps1 路径是 `~/.gemini/config/hooks/`」的口径更正**我独立复核成立**（该路径存在且哈希一致）。

---

## 4. 「向下对齐」副作用全清单（任务卡点名要「逐一列出」）

**判定标准**：`ps1 = allow` 且 `sh 在 pre-G3 或 post-G3 至少一端 = deny`，而 `shFix = allow`。按「是否真实可执行危险」分类。

**A 类：真实危险命令被放松（**应修**）—— 12 条**

| 载荷 | ps1 | shPre | shG3 | shFix |
|---|---|---|---|---|
| `sudo chmod 777 /x` | allow | **deny** | deny | allow |
| `sudo'' chmod 777 /x` | allow | deny | deny | allow |
| `sudo find /tmp -delete` / `sudo'' find /tmp -delete` | allow | deny | deny | allow |
| `/usr/bin/find /tmp -delete` | allow | deny | deny | allow |
| `sudo find /tmp -exec rm {} \;` / `sudo''` / `/usr/bin/` 三形态 | allow | deny | deny | allow |
| `sudo xargs rm < list.txt` / `sudo''` / `/usr/bin/` 三形态 | allow | deny | deny | allow |
| `sudo'' shutdown /s` | allow | deny | deny | allow |

**B 类：空引号插词使 sh 失去对**可执行**危险命令的拦截 —— 24 条**（ps1 同样 allow；pre-G3 亦 allow → **相对冻结基线不回退，但相对 post-G3 是回退**）

`g''it clean -f`、`g''it reset --hard`、`g''it rm x`、`g''it push --force`、`g''it branch -D x`、`r''mdir /s /q x`、`R''MDIR /s /q x`、`s''hutdown /s`、`c''hmod 777 /x`、`d''iskpart`、`sh''red -u`、`un''link`、`f''ind /tmp -delete`、`d''el /f x`、`e''rase x`（B1–B15），
以及**引号插在危险词内部**的 `git cl''ean -f`、`git res''et --hard`、`shut''down /s`、`ch''mod 777 /x`、`unl''ink`、`shr''ed`、`rmd''ir`、`di''skpart`、`fi''nd /tmp -delete`（C1–C9）。
→ **bash 逐条实测确认这些写法在真实 shell 下都会还原成危险命令**（§2.3c 表）。

**C 类：正确的放松（不该修，本卡做对了）—— 12 条**
`rm'' --help`、`rm'' -h`、`git commit -m "remove SHUTDOWN path"`、`git commit -m "always FIND -delete carefully"`、`git commit -m "note: xargs rm here"`、`git commit -m "run chmod 777 in ci"`、`echo "please shutdown the server"`、`echo "run chmod 777 /x"`、`git commit -m "fix halt handling"`、`echo "please reboot the box"`、`echo "find / -delete"`、`cat notes.txt | grep shutdown` —— 均为**误伤的合法命令**，ps1 与我均判 allow，**方向正确**。

**D 类：无害的其余 5 条**（`x chmod 777 /x`、`x find ...`、`x xargs ...`、`x shutdown /s`、`x rmdir ...`）：`x` 不是命令，放松无安全影响。

> **裁定**：A 类 12 条 **必须修（向上对齐）**；B 类 24 条应提请编排者**重新决策**（见 §5）。

---

## 5. R1 家族的根因再判定（给编排者的决策输入）

任务卡与上一轮裁决在这一点上**互相冲突**，必须显式解决：

- 上一轮裁决：13 条「非删除族空引号插词」是**新分歧**，**必须消除**，且建议**不动 ps1**（ps1 有 6 副本 + BOM）。
- 本卡按要求把 sh **向下**对齐到 ps1 → 分歧确实归零，但**代价是 sh 端对 24 条可执行危险命令的拦截被移除**，并在闸门 F 段被**钉成 `expect: allow`**。

**这不是实现者的执行错误，是修法的方向错误**：两轮下来，`两端一致` 被当成了比 `不得放松真实危险命令` 更高的约束。
**唯一正确的收敛路径是向上对齐**：让 **ps1 也做空引号归一**（把 ps1 L223 的 `$cmdNaked` 思路提升为「检测用的归一文本」并用于全部规则），sh 侧则恢复 G3 的全局归一 —— 这样 `g''it clean -f` **两端一起 deny**，分歧与放松**同时**消失（`rm'' --help` 仍由 help/version 豁免放行）。
该修法需要动 **ps1 6 份 + BOM 逐份复核（D9）**，因此属于**下一卡的正当范围**，而不是「本卡不做就算了」。

---

## 6. 红线复跑与闸门变异（我自跑）

### 6.1 我自造的三个变异体（副本，未改主源）

| 变异体 | 回退了什么 | sha256(16) |
|---|---|---|
| `MR2-pelem-dict-typename.sh` | sh L348 `return ""` → 类型名（**R2 复活**） | `8bd68485dc2af90d` |
| `MR1-global-normalise.sh` | 在 L388 后加 `cmd="$cmdNoq"`（**R1 复活**，归一泄漏回全规则） | `e05507db8fe06893` |
| `MR3-shutdown-space-anchor.sh` | sh L561 锚退回 `(^|[;&|[:space:]])`（**R3 复活**） | `1484236c6f931683` |

### 6.2 闸门（`node --test test/decision-parity.test.ts`，`RG_PARITY_SH` 指向变异体）

| 被测 sh | 闸门 | 红点集合 |
|---|---|---|
| **主源** `a4b95f9cd683f3bc` | **exit=0 绿 ✅**（0/110，130.7s） | — |
| MR2（R2 复活） | **exit=1 红 ✅**（4/110） | `H1` `H2` `H5` `H6` |
| MR1（R1 复活） | **exit=1 红 ✅**（15/110） | `F1`–`F15` |
| MR3（R3 复活） | **exit=1 红 ✅**（3/110） | `G1` `G4` `G7` |

**三个红点集合两两不相交**（R2 家族 / R1 家族 / R3 家族各打各的）→ **不是靠某一条冗余规则一起变红**，
说明闸门对**本轮三处修复**确实逐面具备独立捕获力。**捕获力 PASS ✅**（但覆盖力不足，见 §2.5c/§2.4d）。

### 6.3 其余红线（全部由我独立复跑）

| 项 | 要求 | 我的实测 | 结论 |
|---|---|---|---|
| sh 四套 × **audit** | 67/40/34/192 | **67/67 · 40/40 · 34/34 · 192/192，rc=0** | ✅ |
| sh 四套 × **skills** | 同 | **67/67 · 40/40 · 34/34 · 192/192，rc=0** | ✅ |
| sh 四套 × **xhs-publish** | 同 | **67/67 · 40/40 · 34/34 · 192/192，rc=0** | ✅ |
| G5 `sh-failclosed-test`（主源） | 34/34、rc=0 | **TOTAL 34 / PASS 34 / FAIL 0，RC=0** | ✅ |
| G5 **fail-closed 变异**（我自造 `M2-failclosed-empty-command.sh`：删掉「command 为空 → deny」护栏） | 必红 | **TOTAL 34 / PASS 32 / FAIL 2，RC=1** | ✅ |
| G15b redact parity **A/B/C**（主源） | 绿 | **pass 3 / fail 0，PARITY-EXIT=0** | ✅ |
| G15b **M4 变异**（`_g3_mutants/M4-redact-passthrough.sh`，经我核为 post-FIX4 基底 +1 行改动） | 必红 | **pass 2 / fail 1，M4-MUTANT-EXIT=1** | ✅ |
| node 全量（`node --test`，repo 根） | 全绿 | **tests 379 / pass 379 / fail 0，NODE-EXIT=0** | ✅ |
| 既有 allow 不放宽 | — | 未回退（E1–E16 / B20·B21 / F8·F9 / G5 全 allow；A6–A9 未过度收紧） | ✅ |
| **既有 deny 不被放宽** | — | **❌ 12 条真实危险命令由 deny 变 allow**（§4 A 类） | **FAIL** |
| 副本 distinct / BOM / LF（D9） | — | sh 3/3 `a4b95f9cd683f3bc` distinct=1、BOM=False、LF；ps1 6/6 `fb85cc0e4476ae58`、BOM=True | ✅ |

**注（我自己的 harness bug，如实披露）**：① 第一次跑 sh 四套时我用 `… | tail -3` 取结果，导致 `$LASTEXITCODE` 取到的是 `tail` 的退出码而非被测脚本的；已重跑 `sh-failclosed-test.sh`（不带管道）取得真实退出码：主源 **RC=0**、变异体 **RC=1**，四套的 PASS 计数（67/40/192/34）本身即为判据，不受影响。② 第一次跑 node 全量时我误用了 `node --test packages/core/test tests/e2e`（Node 24 在该形态下把目录当模块 `require` → `MODULE_NOT_FOUND`，报 `tests 2 / fail 2`）；**这是我的调用错误，不是产品失败**，改用 `node --test`（repo 根）后得 **379/379、exit=0**，与实现者声明一致。

---

## 7. 特别标注（按任务卡分类）

| 类别 | 结论 |
|---|---|
| **新绕过面** | **有，且是本卡引入的**：24 条「空引号插词」形态（B1–B15 / C1–C9）在 bash 下**真实执行危险命令**，`shFix` 一律 allow（ps1 同）。相对 post-G3 是**回退**；相对 pre-G3 是**保持**。 |
| **新 fail-open / 放宽** | **有，12 条**（§4 A 类）：`sudo chmod 777 /x`、`sudo`/`sudo''`/`/usr/bin/` × `find -delete`、`find -exec rm`、`xargs rm`、`sudo'' shutdown`。其中 **3 类在 pre-G3 冻结基线上即 deny** → **真实回归**。 |
| **新过拦** | **无**。含 `chmod`/`format`/`find`/`shutdown` 字样的合法命令 16 条全部 allow。 |
| **向下对齐的放松** | **确认，共 29 条**（§4 A+B 类），已逐一列出。 |
| **闸门覆盖不足** | **确认（部分）**：① 新增 F/H/G 三段**确实覆盖**了 R1/R2/R3 三个面（PASS）；② 但 `sudo + chmod/find/xargs` 面 **0 条**（17 处向下对齐不可见）；③ **U1 族既存分歧 12 条**（`sudo/path/前缀 + diskpart/rmdir/format`）**0 条**；④ F 段把 15 条可执行危险命令**钉成 `expect: allow`**，使闸门从「检测器」变成「放松的守门人」。 |
| **基线不可信** | **未成立** —— git 历史（`a509afe`）独立证实 `8ac7782d87b95415` 为真 post-G3。 |
| **报告口径偏差** | U1 报告为「112 条里唯一 1 条」，实测 **≥12 条**同类（§2.4d）。U2 报告为「建议下一卡修」，但**实测放宽面比报告列举的 1 条大**（12 条真实危险）。 |
| **红线回退** | **是（1 条）**：「既有 deny 不得被放宽」在 12 条真实危险命令上被破坏。其余红线见 §6。 |

---

## 8. 未做项 / 局限（诚实标注）

1. **未做**：ps1 五套 PowerShell 测试未复跑（本卡声明 ps1 零改动，且我已独立核 6/6 同 sha 同 BOM，风险极低）。
2. **未做**：引号内含危险词的**穷举**过拦面（已抽测 16 条，全 allow）；`ps_cast` 的 65 条语义表未逐条重跑（A 段 15 条含 D5/D6/R2 直接回归，抽验全部一致）。
3. **未做**：`sudo + chmod/find/xargs` 之外的**其余 33 处 `-i` 规则的逐条两端对照**（我做了 11 前缀 × 11 基座的交叉矩阵，覆盖主要危险族，但未覆盖全部规则）。
4. **时间**：实际约 85 分钟（超时间盒）。第 1–4、6 项在 T+35 分钟即定型并落盘，第 5、7 项在余下时间补齐；**无未完成项**，仅上述 3 条为主动收窄范围。
5. **诚实披露我自己的一次 harness 误报**：`node --test packages/core/test tests/e2e` 报 `tests 2 / fail 2` 是**我的 Node 调用形态错误**（目录被当模块 require），不是我发现的缺陷；改 `node --test` 后 379/379 全绿。已按 D10 精神先复跑再下结论。

---

## 9. 证据清单（`E:\DeepSeek_Harness\workspace\2026_08_21\.eval-tmp\g4eval\`）

| 文件 | 内容 |
|---|---|
| `cases.mjs` | **自造语料 218 条**（A 类型/R2 15 · B 空引号 24 · C 词内插词 15 · D 前缀×基座 121 · E 过拦面 16 · F T3 邻居 12 · G 原 5 分歧 5 · H 向下对齐候选 10） |
| `probe.mjs` | 四列**串行**真实 spawn + 进程 stdin harness |
| `main1.json` / `main2.json` | 218 条 × 4 列全量结果（0 条不可判读） |
| `qcheck.sh` | **bash 空引号语义实测**（证明 `g''it clean -f` → `git clean -f`） |
| `mkmutants.mjs` / `mutants/` | 3 个隔离变异体（MR1/MR2/MR3，未改主源） |
| `gate_main.log` / `gate_MR1.log` / `gate_MR2.log` / `gate_MR3.log` | 官方闸门：主源绿（0/110）+ 三变异体红（4 / 15 / 3，红点集合互不相交） |
| `mkmut2.mjs` / `mutants/M2-failclosed-empty-command.sh` | 我自造的 G5 fail-closed 变异体（RC=1，32/34） |
| `redlines.log` | sh 四套 × 三棵树（rc=0 ×12）/ failclosed 主源 RC=0 · 变异 RC=1 / redact parity A·B·C 绿 / M4 变异红 |
| `node_full2.log` | node 全量 379/379、exit=0 |
