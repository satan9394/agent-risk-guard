# EVALUATION RESULT G3 —— 跨端判定收敛 + 跨端判定闸门（**独立验收**）

> 验收人：全新独立 Evaluator（不继承实现者推理上下文）。预设立场「实现可能存在错误」。
> 只读主源；全部变异在隔离副本 `E:\DeepSeek_Harness\workspace\2026_08_21\.eval-tmp\g3eval\mutants\` 进行，**未改动任何主源**。
> 时长：约 55 分钟（超出 30 分钟时间盒，但 1–6 项全部完成；超时原因见 §6 D10 记录）。

---

## 0. 验收结论

# **REJECT**

**5 条目标分歧确实已消除（这一项 PASS，独立复核通过）**，但 G3 的三处改动各自开出的新风险面中，**有两处已被实测证实为真实缺陷**，且**闸门语料对它们零覆盖**：

| # | 缺陷 | 方向 | 证据 |
|---|---|---|---|
| **R1** | **T3 空引号归一在「非 rm 命令族」上制造了 13 条从前不存在的跨端分歧** | 新分歧（ps1 fail-open / sh 更严） | §2.2 F 段 |
| **R2** | **T9/T10 的 `ps_cast` 不忠实，并直接造成一处 fail-open 回归** —— `command:[{"cmd":"rm -rf /tmp/t"}]` 在 sh 由 **deny 变 allow**（ps1 与 pre-G3 sh 均为 deny） | **放宽 / fail-open** | §2.4 H6 |
| **R3** | `-i` 把「一条合法命令」翻成 deny：`git commit -m "remove SHUTDOWN path"`（ps1 allow、pre-G3 sh allow） | 新过拦 + 新分歧 | §2.3 G14 |
| **R4** | 报告 §0 改动 3 自称 `ps_cast`「忠实复刻 PowerShell `[string]`」—— **实测 7/43 不一致** | 声明与事实不符 | §2.4 |
| **R5** | 闸门 66 条语料**全绿**，而我的独立 153 条语料在**同一冻结源**上测出 14 条新分歧 + 1 处 fail-open | 闸门覆盖不足 | §2.5 |

R1/R2/R3 任一单独成立即构成 REJECT；其中 **R2 是 fail-open 方向的真实回归**，性质最严重。

**必须肯定的部分**（避免误伤实现者的正确工作）：
- §2 的 5 条分歧**确已 100% 消除**，真实 spawn 逐条复核通过（§2.1）。
- T3 的**绕过面本身是干净**的：21 条自造反向邻居中，该 deny 的全 deny、该 allow 的全 allow，**未发现新的绕过**（§2.2）。R1 是「两端不一致」，不是「被绕过」。
- 合法命令的**过拦面基本干净**：C1–C18/C23/C28–C30 全 allow（§2.3）。
- **闸门本体是真实、可跑、有捕获力的**，没变红的那次变异经查是**合理的实现冗余**，不是闸门失效（§2.5）。
- **所有红线均未回退**（§2.6）。
- 副本/BOM/distinct 全部与报告声明一致（§3）。

---

## 1. 验收方法与基线（D6 / D8 / D10）

**被测对象**（独立复核 sha256 前 16 位）：

| 文件 | sha256(16) | 字节 | BOM |
|---|---|---|---|
| `agent-risk-guard-audit/scripts/dangerous-commands.sh` | `8ac7782d87b95415` | 34359 | false |
| `agent-risk-guard/skills/agent-risk-guard/scripts/dangerous-commands.sh` | `8ac7782d87b95415` | 34359 | false |
| `agent-risk-guard-audit-xhs-publish/scripts/dangerous-commands.sh` | `8ac7782d87b95415` | 34359 | false |
| `agent-risk-guard/packages/core/test/decision-parity.test.ts` | `a5bcf2ef8f3b6797` | 15707 | — |

**D8 基线真实性已核**：`tasks/orchestrator/_g3_before/dangerous-commands.sh` 与 `_g3_mutants/M0-preg3-full.sh` 均为 `7f7769f2175c6d88` / 30296 B，**与 `_g3_copies_before.txt` 第 17–22 行完全吻合** → 确认是真 pre-G3 冻结副本，可作基线。

**方法（D6）**：自建独立 harness `probe.mjs`，**真实 spawn + 进程 stdin**：
- ps1：`powershell.exe -NoProfile -ExecutionPolicy Bypass -File <hook>`；
- sh：`wsl.exe -e bash /mnt/e/.../dangerous-commands.sh`（未用 Git Bash）；
- `EMPTY`（exit 0 + 无输出）= **allow**；非空必须为合法 JSON 且带 `permissionDecision`。
- **语料完全自造（153 条）**，不复用实现者的 66 条语料，避免「按实现者的语料验收实现者」。

**D10 记录（诚实披露：我自己造过一次假红）**：首轮把官方闸门与我的 3 路并发探针**同时**跑，闸门红了 2/66（T8 `git\tstatus`、Y5 `command:123`，sh 端 `INVALID-JSON`）。**这是我自己造成的并发假红**（`wsl.exe` 并发时吐非 JSON 噪声），不是实现问题。单独串行复跑 → **66/66 绿，exit=0**。此后所有含跨端对比的结论**全部改为串行或经串行复核**，26 条关键用例的串行复核结果与并发结果一致（仅 F6 由 `INVALID-JSON` 更正为 `deny`）。

---

## 2. 逐项 PASS / FAIL

### 2.1 项目 1 —— 5 条分歧真消除：**PASS** ✅

串行复核（`out/reverify.json`，两端真实 spawn）：`EMPTY`=allow。

| # | 载荷 | ps1 | sh **pre**(基线) | sh **post** | 应然 | 判定 |
|---|---|---|---|---|---|---|
| **T2** | `$X=RM; $X -RF /tmp/t` | deny | allow | **deny** | deny | ✅ |
| **T5** | `RM -RF /tmp/t` | deny | allow | **deny** | deny | ✅ |
| **T9** | `command:null` | deny | allow | **deny** | deny | ✅ |
| **T10** | `command:["rm","-rf","/tmp/t"]` | deny | allow | **deny** | deny | ✅ |
| **T3** | `rm'' --help` | allow | deny | **allow** | allow | ✅ |

**矩阵收敛**：我的 103 条语料上，跨端分歧 **before 22 → after 4**；其中 4 条残余分歧经溯源**均非 G3 引入**（`rmdir --help` / `RMDIR --help` 的 `shpre` 亦为 deny，属既有分歧；`[{"a":1}]` 见 §2.4 —— 虽是既有分歧，但本卡自称已修类型维，未修，见 R4/R5）。

> 编排者自跑的 20 条矩阵 `before 5/20 → after 0/20` **独立复现成立**。

### 2.2 项目 2 —— T3 绕过面：**PASS（无绕过）**，但 **FAIL（新分歧）** ⚠️

**(a) 绕过面本身干净 —— PASS。** 我自造 21 条反向邻居，`pre`/`post`/`ps1` 三列对照（串行复核关键项）：

| 邻居 | 应然 | ps1 | sh post | 结论 |
|---|---|---|---|---|
| `r''m -rf /tmp/t` | deny | deny | deny | ✅ |
| `rm''''` | — | allow | allow | 两端同判（非可执行危险，可接受） |
| `rm''''' -rf` | deny | deny | deny | ✅ |
| `"r"m -rf` | deny | deny | deny | ✅ |
| `rm ''-rf /tmp/t` | deny | deny | deny | ✅ |
| `rm'-'-rf /tmp/t` | deny | deny | deny | ✅ |
| `rm'' -rf'' /tmp/t` | deny | deny | deny | ✅ |
| `;''rm -rf` / `|''rm -rf` | deny | deny | deny | ✅（pre-G3 为 allow，属**修复**） |
| `''rm'' -rf /tmp/t` | deny | deny | deny | ✅（pre-G3 allow，修复） |
| `;;;``rm'''' -rf` 系（N22 `'''''rm -rf /tmp/t`） | deny | deny | deny | ✅ |
| `x''=rm; $x'' -rf /tmp/t` | deny | deny | deny | ✅ |
| `sudo'' rm -rf /tmp/t` | deny | deny | deny | ✅ |
| `rm $'' -rf /tmp/t` / `r""m -rf` / `rm"""" -rf` | deny | deny | deny | ✅ |
| **合法**：`echo "it''s"`、`find . -name ''`、`rm'' --help''` | allow | allow | allow | ✅ |

**结论：未发现 T3 归一被利用成新绕过。** 归一的「只删空引号对」在 shell 语义下确实只会让命令词相邻（多看见），实现者的论证成立。

**(b) 但归一引入了 13 条此前不存在的跨端分歧 —— FAIL（新分歧族 R1）。**

根因：**sh 对全规则集做空引号归一，ps1 不做**（ps1 只在 rm/Remove-Item 删除族做引号剥离，见 ps1 L222/L374）。凡「删除族之外」的命令被 `''` 插词，sh 归一后命中、ps1 不命中 → 新分歧。实测（串行复核确认，非并发噪声）：

| 载荷 | ps1 | sh **pre** | sh **post** | 性质 |
|---|---|---|---|---|
| `g''it clean -f` | allow | allow | **deny** | **G3 新造分歧** |
| `g''it reset --hard` | allow | allow | **deny** | **G3 新造分歧** |
| `g''it rm x` | allow | allow | **deny** | **G3 新造分歧** |
| `g''it push --force` | allow | allow | **deny** | **G3 新造分歧** |
| `g''it branch -D x` | allow | allow | **deny** | **G3 新造分歧** |
| `r''mdir /s /q x` / `R''MDIR /s /q x` | allow | allow | **deny** | **G3 新造分歧** |
| `s''hutdown /s` | allow | allow | **deny** | **G3 新造分歧** |
| `c''hmod 777 /x` | allow | allow | **deny** | **G3 新造分歧** |
| `d''iskpart` | allow | allow | **deny** | **G3 新造分歧** |
| `sh''red -u /tmp/t` | allow | allow | **deny** | **G3 新造分歧** |
| `un''link /tmp/t` | allow | allow | **deny** | **G3 新造分歧** |
| `f''ind /tmp -delete` | allow | allow | **deny** | **G3 新造分歧** |
| `r''m -rf /tmp/t` / `g''it status` / `n''pm test`（对照） | — | 两端本就一致 | 仍一致 | ✅ 未误伤 |

**共 13 条，`pre` 两端一致、`post` 两端分歧。** 这是**本卡目标（消除跨端判定分歧）的反向**：G3 净增分歧。
方向上是 sh 更严（ps1 fail-open），所以**不是安全漏洞**，但**违反 §9 验收标准「两端一致」**，且**闸门语料零覆盖**（R5）。

### 2.3 项目 3 —— `-i` 过拦面：**FAIL**（新过拦 + 新分歧）❌

**(a) 合法命令基本未被误伤 —— 大部分 PASS。** 以下全部 **两端 allow**（实测）：

`Git status`、`LS -la`、`Echo hello`、`npm run Build`、`npm run Format`、`rm --help`、`RM --help`、`rm -H`、`RM -H`、`cat FORMAT.txt`、`grep RM file.txt`、`mkdir RM_DIR`、`echo "please rm the files"`、`Git Log --oneline`、`Cargo Build --release`、`tar xf RM.tar.gz`、`find . -name RM`、`git status`、`npm run clean`、`make clean`、`git push --force-with-lease`、`Docker ps`、`Git Diff`、`mkdir Format`、`ls HALT.txt`、`cat RM.txt`、`ls -la /tmp/RM`、`npm run Lint`、`echo "the RM -rf rule"`（echo 参数被剥离）、`grep -i "format c:" docs.txt`。

**(b) 但有一条真实合法命令被新过拦，且同时是新分歧 —— FAIL（R3）。**

| 载荷 | ps1 | sh **pre** | sh **post** | 判定 |
|---|---|---|---|---|
| **`git commit -m "remove SHUTDOWN path"`** | **allow** | **allow** | **deny** | ❌ **改前 allow、改后 deny，且两端分歧** |
| `git commit -m "REBOOT fix"` | allow | allow | allow | ✅（引号紧邻，恰好未命中） |

根因（可指代码行）：sh **L489** 的前导锚 `(^|[;&|[:space:]])(sudo[[:space:]]+)?(shutdown|reboot|halt|poweroff)([[:space:]]|$)`，其 `[:space:]` 允许「空格后」命中；ps1 **L463** 用的是 `(?:^|[;&|\r\n])\s*(?:sudo\s+)?(?:shutdown|…)\b`，**只认分隔符**。这是一处**既有的锚点不一致**，pre-G3 因 sh 大小写敏感而未暴露；**`-i` 把它从「潜伏」变成「可观测」**。
同类潜伏面（同一模式，未逐一实测但代码结构相同，建议一并审计）：**L494 chmod** vs ps1 L468、**L509** rm 引号变体 vs ps1 同族。

**(c) 另一类「改前 allow → 改后 deny」（判定：可接受，但须登记）**：

| 载荷 | ps1 | sh pre | sh post | 判定 |
|---|---|---|---|---|
| `git commit -m "drop RM -rf usages"` | deny | allow | deny | 两端同判 deny；**把 sh 从漏拦收敛到 ps1 既有行为**，非分歧。但**同时是对合法 commit message 的过拦**（ps1 早已如此）→ 记为**两端同形残留 / 加固候选**，与报告 §6.1 的 C15/T11 同类 |
| `git log --grep="RM -rf"` | deny | allow | deny | 同上 |
| `ECHO hello | BASH` | deny | allow | deny | 收敛（管道到 shell 本就是拦截目标） |
| C7 `rm -H` | allow | deny | allow | **修复**（放宽方向正确） |

**未见任何「本该 allow 的常规开发命令」被 `-i` 误伤**（除 R3 那一条）。这一维度实现者的工作**方向正确、执行基本到位**，唯一漏洞是锚点类的潜伏不一致被 `-i` 点着了。

### 2.4 项目 4 —— `ps_cast` 忠实性：**FAIL（7 / 43 不一致）** ❌

方法：从主源 **L287–L303 逐字提取**真实的 `ps_cast`/`ps_elem`（脚本会断言 `^def ps_cast` 匹配，否则报错退出），与 **ps1 自己的 `[string]$data.tool_input.command`**（ps1 L205 的原语，同一 JSON 喂入 `ConvertFrom-Json`）**逐条对照**。

**结果：43 条中 36 条一致、7 条不一致。**

| # | `command` | ps1 `[string]` | sh `ps_cast` | 是否影响判定 |
|---|---|---|---|---|
| D1 | `1e2` | `"100"` | `"100.0"` | 否（两端 allow） |
| D2 | `1e21` | `"1E+21"` | `"1e+21"` | 否 |
| D3 | `1.0e-7` | `"1E-07"` | `"1e-07"` | 否 |
| D4 | `{"a":{"b":1}}` | `"@{a=}"` | `"@{a=System.Management.Automation.PSCustomObject}"` | 否 |
| **D5** | **`[{"a":1}]`** | **`""`** | `"System.Management.Automation.PSCustomObject"` | **是** → ps1 **deny**「command 为空」/ sh **allow** |
| **D6** | **`[{"a":1},{"b":2}]`** | **`" "`** | `"System… System…"` | **是** → ps1 deny / sh allow |
| D7 | `[{"a":1},"x"]` | `" x"` | `"System… x"` | 否 |

**根因（一行代码）**：`ps_elem` 的 dict 分支返回 `"System.Management.Automation.PSCustomObject"`（**sh L302**）。实测 PowerShell 对**对象在数组元素位 / 哈希值位**的渲染都是 **空串**（`[{"a":1}]` → `""`；`{"a":{"b":1}}` → `@{a=}`），**不是类型名**。注意 `ps_elem` 的 **list** 分支（`"System.Object[]"`）是**正确**的——实测 `[["rm"]]` → `"System.Object[]"` 完全吻合，所以不是「全盘拍脑袋」，而是**只错在 dict 这一支**。

**D5/D6 已在端到端判定上被独立证实**（串行复核）：`[{"a":1}]` → ps1 **deny** / sh **allow**，且 **pre-G3 sh 亦为 allow** → 属**既有分歧**，G3 自称修了「类型维」却**没修到这一支**，且闸门语料（Y9 只放了嵌套**数组** `[["rm"]]`）**零覆盖对象元素**。

**⚠️ R2 —— 由 `ps_cast` 不忠实直接导致的 fail-open 回归（最严重）：**

| 载荷 | ps1 | sh **pre** | sh **post** | 判定 |
|---|---|---|---|---|
| `[{"cmd":"rm -rf /tmp/t"}]` | **deny** | **deny** | **allow** | ❌ **sh 由 deny → allow = 放宽 / fail-open** |

机理：pre-G3 sh 走 `[ -z "$cmd" ]` 兜底 grep 失败 → 空 → **deny**（与 ps1 一致）；post-G3 `ps_cast` 把该数组渲染成非空的 `"System.Management.Automation.PSCustomObject"` → 落到「非空 → 走规则」→ 无规则命中 → **allow**。若 `ps_elem(dict)` 按 PS 真实语义返回 `""`，则 `ps_cast` 仍为 `""` → **deny**，与 ps1 一致。
**这是一条新增的、方向为「放宽」的缺口**，直接违反本卡红线「不得为过闸门而放宽」。

### 2.5 项目 5 —— 闸门真实性与捕获力：**PASS（本体）** / **FAIL（覆盖）** ⚠️

**（a）存在性与可运行性 —— PASS。**
`packages/core/test/decision-parity.test.ts` 存在（15707 B，221 行），已进 node 测试套件（`node --test test/`）。
**我独立跑了一遍**（单独运行、无并发干扰）：

```
✔ decision parity: ps1 与 sh 对同一语料的 permissionDecision 必须逐条一致且等于应然 (65869.6886ms)
ℹ tests 1  ℹ pass 1  ℹ fail 0  ℹ skipped 0
GATE-EXIT=0
```

**（b）捕获力 —— PASS。** 用 `RG_PARITY_SH` 指向我在隔离副本里造的变异体（**打的是生产路径，不是测试桩**，D6）：

| 变异体 | 回退了什么 | 闸门 | 结果 |
|---|---|---|---|
| **MU4-case-family** | 大小写整族行为回退（裸 rm 规则 + rmseg 小写化 + `rm -rf` 任意位置三条同时回退） | **exit=1 红 ✅** | 3/66：T5 · C1 · C2（与报告 M1 完全吻合） |
| **MU2-naive-var-case** | 仅 10b 变量赋值规则回退大小写 | **exit=1 红 ✅** | 4/66：T2 · C9 · C10 · C11（与报告 M4 完全吻合） |
| **MU1-naive-bare-rm-case** | **仅**「裸 rm」一条规则回退大小写 | **exit=0 绿** | — |

**（c）对报告自述「单条规则回退未变红」的裁定：这是**合理的实现冗余**，不是覆盖不足。** ✅

我复现了该现象并独立查明原因：把 sh L360 的裸 rm 规则改回 `grep -qE`（大小写敏感）后，`RM -RF /tmp/t`（T5）虽不再命中裸 rm 规则，但被**仍未回退**的 L394 `rm[[:space:]]+-r{0,1}f{0,1}[[:space:]]+` 兜住 → 判定**实际未变** → 闸门按「判定一致性」判据**理应保持绿**。闸门测的是**可观测行为**（decision parity），这是正确的抽象层级：行为没变就不该报红。**报告的诚实记录准确，不构成缺陷。**
（唯一代价：红的定位精度依赖「按行为回退」，不能逐规则归因——可接受。）

**（d）但闸门**覆盖严重不足** —— FAIL（R5）。** 在**同一份冻结源**（`8ac7782d87b95415`）上：闸门 66 条**全绿**，而我的 153 条独立语料测出 **14 条新跨端分歧 + 1 处 fail-open 回归**。缺口正好是：
- **F 段（0 条）**：空引号插词在**非 rm 命令族**（git/shutdown/chmod/diskpart/unlink/shred/find/rmdir）——**13 条新分歧全部落在这个缺口里**；
- **H 段（0 条）**：`command` 数组的**元素为对象**（`[{...}]`）——D5/D6/R2 三条落在这里（语料 Y9 只有嵌套**数组**）；
- **G 段（0 条）**：`-i` 之后「引号内文本恰好命中大小写不敏感词」的锚点面（G14 落在这里）；
- 另：`git commit -m "…"` 这类**引号内文本**从未出现在语料里，而它正是 L394/L489 的非锚定规则的天然误伤面。

### 2.6 项目 6 —— 红线不回退：**全部 PASS** ✅

| 红线 | 要求 | 我的独立实测 | 证据 |
|---|---|---|---|
| G15b parity A/B/C | 全绿 | **3 pass / 0 fail，exit=0**（A 17.5s · B 11.2s · C 11.6s） | job 253 §2 |
| G15b **M4 变异** | 仍必红 | **exit=1 ✅**（assertion actual=**33**，即生产出口 33 处泄漏明文） | job 253 §3 |
| G5 **sh-failclosed** | 34/34 | **34/34，rc=0** | job 257 |
| G5 **M2 变异** | 仍必红 | **30/34，FAIL 4，rc=1 ✅** | job 257 |
| sh `sh-hook-test` | 67/67 | **67/67，rc=0** | job 257 |
| sh `sh-audit-edge` | 40/40 | **40/40，rc=0** | job 257 |
| sh `sh-audit-bypass` | 192/192 | **192/192，rc=0** | job 257 |
| 既有 allow 不放宽 | `git status` 等 | 29 条合法命令两端全 allow（§2.3a） | `out/main.json` |
| 副本 distinct / BOM（D9） | — | ps1 **6/6 `fb85cc0e4476ae58` BOM=True ×6 零改动**；sh **3/3 `8ac7782d87b95415` distinct=1** | §3 |

**G5 五条异常路径仍 deny**、**T11/T12/E1/E2 判定侧对照**（`# note\nrm -rf` 两端 allow = 已知同形残留；`rm -rf\n# note` 两端 deny；缺 command 键 / 缺 tool_input 两端 deny）—— 我的语料独立复现，与报告一致。

> **结论：红线条条未回退。G3 在「不破坏既有保障」这一点上做得扎实。**

---

## 3. 副本 / BOM / distinct 复核（项目 7）

| 组 | 副本 | sha256(16) | BOM | 字节 |
|---|---|---|---|---|
| ps1 ×6 | audit / assets/hooks / skills / `~/.claude` / `~/.codex` / `~/.gemini` | `fb85cc0e4476ae58` ×6 | **True ×6** | 34523 ×6 |
| sh ×3 | audit / skills / xhs-publish | `8ac7782d87b95415` ×3 | **false** | 34359 ×3 |

- **ps1 distinct = 1，BOM=True 逐份复核通过，零改动属实**（D9 无触发）。
- **sh distinct = 1 属实**；报告称 523 行、我读得 524 行（末行 `\n` 计数差 1），字节数 34359 完全一致，**属计数口径差异，非缺陷**。
- 报告 §0 关于 `grep -qiE` 的自述与源码一致：改后 `-qiE` 共 **35** 处（= 33 处改动 + L370/L514 两处原有），`-qE` 残留 **1** 处（L425 的 `git switch -C` 例外）——**逐字核对成立**。
- 报告 §0 改动 4（L461 补 `[[:space:]]*/` 尾巴）与 ps1 L262 逐字对齐，**成立**。

---

## 4. 特别标注（按任务卡要求的分类）

| 类别 | 结论 |
|---|---|
| **新绕过面** | **无**。T3 归一的 21 条反向邻居全部「该 deny 的 deny、该 allow 的 allow」，未发现可被利用的新绕过 |
| **新 fail-open / 放宽** | **有，1 条（R2）**：`command:[{"cmd":"rm -rf /tmp/t"}]`，sh 由 pre-G3 的 **deny → post-G3 的 allow**（ps1 仍 deny）。根因：`ps_elem(dict)` 返回值不忠实 |
| **新过拦** | **有，1 条（R3）**：`git commit -m "remove SHUTDOWN path"`，pre-G3 sh allow → post-G3 sh deny（ps1 始终 allow）。另 `git commit -m "drop RM -rf usages"` / `git log --grep="RM -rf"` 亦由 allow 变 deny，但**两端同判**，属两端同形残留 |
| **ps_cast 偏差** | **有，7/43**，其中 2 条（D5/D6）**影响判定**；根因单一（`ps_elem` dict 分支），一行可修 |
| **闸门覆盖不足** | **确认**。66 条语料 F/H/G 三段**全缺**，致 14 条新分歧 + 1 处 fail-open 在闸门下**全绿通过** |
| **闸门捕获力** | **合格**。MU4 红 3/66、MU2 红 4/66；MU1 未红已查明为**合理冗余**而非失效 |
| **红线回退** | **无**。parity A/B/C 绿、M4 变异红 33、failclosed 34/34、M2 变异红 4、sh 四套 67/40/34/192 全绿、副本/BOM 一致 |
| **新跨端分歧** | **有，14 条**（13 条 F 族空引号插词 + R3 的 SHUTDOWN），另有 3 条既有分歧（`rmdir --help`、`RMDIR --help`、`[{"a":1}]`）未被本卡修掉 |

---

## 5. 最小修法（REJECT 判据 → 可指代码行的收敛路径）

**M1（必修，修 R2 + R4 —— 一行）**：`dangerous-commands.sh` **L302**
```python
    if isinstance(v,dict): return "System.Management.Automation.PSCustomObject"
→   if isinstance(v,dict): return ""
```
依据：`ps_cast` 的 dict 顶层分支（L296-298）在此之前已独立成串，故不会破坏 `{"a":1}` → `"@{a=1}"`；而 `{"a":{"b":1}}` → `"@{a=}"`、`[{"a":1}]` → `""`、`[{...},{...}]` → `" "`、`[{...},"x"]` → `" x"` 五条全部一次性对齐实测 PS 语义。修后 `[{"cmd":"rm -rf /tmp/t"}]` 恢复 **deny**（消除 R2），`[{"a":1}]` 与 ps1 同步 **deny**（消除 D5/D6 分歧）。
*（M1 之外的浮点格式差异 D1–D3 无判定影响，建议同卡顺手修：`float` 分支改 .NET 风格 `G` 格式 —— 整数值去 `.0`、指数大写并补足两位，如 `1e2→"100"`、`1e21→"1E+21"`、`1.0e-7→"1E-07"`。）*

**M2（必修，修 R1 —— 归一范围收窄，不动 ps1）**：`dangerous-commands.sh` **L337-338**
保留 `cmdOrig="$cmd"`，另存一份归一文本（如 `cmdNoq`），**只在 rm/Remove-Item 删除族**（L356/L360/L370/L375/L379/L509 一组）使用 `cmdNoq`，其余规则（git L423-447、shutdown L489、chmod L494、diskpart L450、unlink/shred L356 之外的族、find L384、xargs L389 …）继续用**未归一的 `cmd`/`cmdtest`**。
依据：这正是 ps1 的既有结构（ps1 L222 单独维护 `$cmdNoQuote`，且 **L374 起仅删除族使用它**）。如此 T3（`rm'' --help` → allow）与全部 `rm''-rf` 邻居**保持现状**，而 13 条 F 族新分歧**全部消失**。
*（备选方案是把同样的归一搬进 ps1，但 ps1 有 6 份副本 + BOM 约束，且本卡声明「ps1 零改动」，不推荐。）*

**M3（必修，修 R3 —— 锚点对齐，1 行）**：`dangerous-commands.sh` **L489**
```sh
(^|[;&|[:space:]])(sudo[[:space:]]+)?(shutdown|reboot|halt|poweroff)([[:space:]]|$)
→ (^|[;&|])[[:space:]]*(sudo[[:space:]]+)?(shutdown|reboot|halt|poweroff)([[:space:]]|$)
```
依据：ps1 L463 用 `(?:^|[;&|\r\n])\s*`，**不含 `[:space:]`**。改后 `git commit -m "remove SHUTDOWN path"` 恢复 allow（消除 R3）。
**并须同批审计所有「锚点类含 `[:space:]`、而 ps1 对应规则只认分隔符」的规则**（至少 **L494 chmod** vs ps1 L468），因为 `-i` 会把这一整类潜伏不一致**批量点着** —— 这是本次 `-i` 改动最需要记住的副作用。

**M4（必修，修 R5 —— 闸门补语料）**：`decision-parity.test.ts` 的 `DECISION_CORPUS` 增补约 40 条：
- **F 段**：`X''Y` 空引号插词 × `git clean -f` / `git reset --hard` / `git push --force` / `git branch -D` / `rmdir /s` / `shutdown /s` / `chmod 777` / `diskpart` / `unlink` / `shred` / `find -delete`（各钉 `expect` 并与 ps1 对齐）；
- **H 段**：`command:[{"a":1}]`、`[{"a":1},{"b":2}]`、`[{"a":1},"x"]`、`{"a":{"b":1}}`、`[{"cmd":"rm -rf /tmp/t"}]`、`1e2`、`1e21`（**这是 R2 的直接回归测试**）；
- **G 段**：`git commit -m "remove SHUTDOWN path"`、`git commit -m "drop RM -rf usages"`、`git log --grep="RM -rf"`（钉「两端同判」，注释标注为加固候选，与 C15/T11 同一处理方式）。

**验收复跑口径**：修完后，用本文件的语料（`\.eval-tmp\g3eval\cases.mjs` + `cases2.mjs`，共 153 条）与官方闸门**同时**满足「0 分歧」才算通过。

---

## 6. 未做项 / 局限（诚实标注）

1. **未做**：`ps1` 五套 PowerShell 测试（`hook-rules-test.ps1` 等）未复跑 —— 本卡声明 ps1 零改动，且我已独立验证 6 份副本 sha/BOM 逐字节一致，风险极低。**未做 8 端其余树（`xhs-publish`）的 sh 四套**：已核其 hook 与 audit 树**同 sha `8ac7782d87b95415`**，行为等价。
2. **未做**：`-i` 之后**逐族**覆盖 33 处规则的两端对照（时间盒）。我已用 F/G 两族证明「`-i` 会把潜伏的锚点不一致点着」，但**余下锚点类含 `[:space:]` 的规则未逐条枚举**，§5-M3 给出的是一类修法而非穷举清单。
3. **超时披露**：原定 30 分钟时间盒，实际约 55 分钟。超时来自 (a) 三次真实 spawn 探针共 152s + 207s + 53s，(b) 五次官方测试串行复跑（闸门单次 66–198s × 4 + parity 40s × 2 + sh 四套），(c) **首轮并发假红触发的 D10 复跑**。前 4 项结论在 T+32 分钟即已定型并落盘草稿，剩余时间用于项目 5/6 的实测而非猜测。
4. **基线口径**：该目录非 git 仓库，D8 基线取自实现者留存的 `_g3_before/` 冻结副本；我已用 `_g3_copies_before.txt` 的独立哈希记录交叉验证其为真 pre-G3（`7f7769f2175c6d88` / 30296 B），**未依赖实现者的口头声明**。

---

## 7. 证据清单（`E:\DeepSeek_Harness\workspace\2026_08_21\.eval-tmp\g3eval\`）

| 文件 | 内容 |
|---|---|
| `cases.mjs` / `cases2.mjs` / `cases_re.mjs` | 自造语料 103 + 50 + 26 条（**独立于实现者语料**） |
| `probe.mjs` | 三路/串行真实 spawn harness（含 wsl 噪声容错解析） |
| `out/main.json` | 103 条 × ps1/sh-post/sh-pre 全量结果 |
| `out/round2.json` | 50 条 F/G/H 段三列结果 |
| `out/reverify.json` | **26 条串行复核**（剔除并发噪声后的权威结果） |
| `pscast.mjs` / `out/cast.json` | `ps_cast` 忠实性 **43 条逐条对照**（从主源 L287-303 逐字提取真实函数） |
| `mkmutants.mjs` / `mutants/` | 6 个隔离变异体（MU1 naive / MU2 naive / MU3 T3 / MU4 case-family / MU5 git / MU6 format） |
| `redlines.sh` / `redline_node.ps1` | 红线与闸门变异驱动脚本 |
| `analyze.mjs` | 三列对照 / 过拦候选 / 放宽候选 自动归类 |
