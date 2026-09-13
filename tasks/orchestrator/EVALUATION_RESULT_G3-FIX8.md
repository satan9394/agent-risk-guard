# EVALUATION_RESULT — G3-FIX8（独立验收）

- 切片：**G3-FIX8 —— 包装词「自身选项」纳入命令位前缀（CMD_PRE）**
- 被验对象：工作树改动（HEAD `0e754ed`，**未提交**）
- 验收者：独立 Evaluator（隔离上下文、未参与实现、未派生 Subagent、**未改动任何产品文件**，变异体/探针只写 `%TEMP%`）
- 冻结基线：FIX7 提交 `5e51b06`（`git show 5e51b06:<path>` 取字节，经 `git hash-object` 逐字节核对：
  ps1 blob `4e97eb7f…`、sh blob `224c4037…`）
- 轮次：**FAIL（首轮）→ Repair 1/1 → PASS（复验）**

## 裁决：**PASS**（复验）

决定性依据：对 FIX7 冻结字节做全量老/新决策差（**406 载荷 × 4 端 = 1624 次串行真实 spawn**，
含 245 `DECISION_CORPUS` + 24 `IDENTITY_CORPUS` + Evaluator 自造 137）：

```
ps1 FIX7 → 终版 : allow→deny = 68   deny→allow = 0
sh  FIX7 → 终版 : allow→deny = 55   deny→allow = 0
终版两端 expect 不符 = 0；语料内两端分歧 = 0
```

`allow→deny` 的 68 + 55 端次**逐条可归因**，全部落在本轮应修面（源卡必修 W / 逐包装词选项族 F /
R2 多行族 N / 本轮新语料 K·L / E16），**无一条落在应修面之外**；M1–M9 属 G24 提交 `98c6f4b`（位于
FIX7 与 HEAD 之间，非本轮）。

## 首轮 FAIL 与两条反例（记录在案）

首轮 366 载荷 × 4 端对照：`ps1 deny→allow = 1`、`sh deny→allow = 1`，另有多行探针 9 条 —— **放松不为 0 即自动 FAIL**。

1. **`env --ignore-environment diskpart`（两端同时放松）**：FIX7 `deny/deny` → 首版 `allow/allow`。
   机理：env 分支由 `--[a-z-]+[^\s]*` 收窄为若干具体短选项，长选项不再被前缀消费，`diskpart` 脱离命令位。
   报告当时把它写成"与 FIX7 同判、未新增"，与事实相反（其 202 条语料含 `ignore-environment` 的为 0 条）。
2. **sh 的 rm 实参抽取式改写引入 9 条 `deny→allow`**：形态＝「豁免词独占首行 + 换行 + 真删除」
   （`--help\nrm /tmp/t` 等）。根因：旧式 `sed -nE "…p"` **只输出匹配行**，新式少了 `-n`/`p`，
   于是每行都被打印，`head -1` 取到首行 → `rmseg="--help"` → 命中豁免 `case`。
   故报告 §1.3「为何等价……与 FIX7 判据逐字兼容」为假。

**指挥侧独立抽查复现**（`tools\spot-check.mjs`）：两条反例均成立，`deny→allow = 0` 不满足。

## Repair（1/1，由原实现者执行）

- **R1**：`env` / `command` 分支**逐字回到 FIX7 形态** → 两条 `env` 长选项载荷回到 `deny/deny`，
  守卫（`env --ignore-environment ls`、`env -i ls diskpart`、`env VAR=1 ls`、`env -u X ls`、`command -v diskpart`）仍 allow
- **R2**：sh rmseg 改为「**组号无关 + 逐行全取**」——`grep` 只留含命令位 `rm` 的行，取每行**最后一个**
  命令位 `rm` 之后的实参，**任一行非 help/version 即 deny**（对齐 ps1 rule 16 的调用点前瞻语义）→ 9 条多行回到 `deny/deny`，
  4 条豁免形态仍 allow，且 `ls -la\nrm --help` 由首版的误拦回到 allow
- **R3**：两类载荷补进 `decision-parity` 语料；**R4**：报告 10 处口径更正；**R5**：把
  `agent-risk-guard-audit-xhs-publish\scripts\dangerous-commands.ps1`（实测 `9889f367f2944756`/41948 B
  = **G24 时的 canonical 陈旧副本**，不是"21 KB 精简变体"）并入同步清单 → **ps1 变 7 份**

## 复验要点（Evaluator 自建变异体，不采信实现者数字）

```
闸门三态：
  base : rc=0  2/2 pass
  MC   : rc=1  失败集 = K88…K96, K119, K120            (11/245)，身份 pass
  MR   : rc=1  失败集 = K100…K110, K116                (12/245)
                + 身份 test L23                        (1/24)
```

- 新旧段**零牵连**，闸门对「回退选项族」与「回退本轮 Repair」两类回退均敏感 ⇒ **非自证**
- Evaluator 的 MR 变异体与实现者的**逐字节相同**（ps1 `f459bde1c0a060cb`／44334／BOM；sh `851e9e581013125f`／51752）
- 逐包装词设计复现：`time -p ls diskpart`、`sudo -v ls diskpart` = **allow（= FIX7）**，
  首版那条"主动收窄"确已消除；`sudo -b/-k diskpart`、`doas -n diskpart` = allow→deny（真可执行形态）
- 新增语料 38 条（K88–K121、L21–L24）**逐条**：两端 decision 相等且等于 `expect`，0 条不符

## 红线与分发面

| 项 | 结果 |
|---|---|
| ps1 套件 | 5 套 × **3 棵树** × **双引擎** = 28/28 rc=0（xhs 树无 redact 套件，故 28 非 30） |
| sh 套件 | 4 套 × 3 棵树 = 12/12 rc=0 |
| `redact-parity` | base 3/3 rc=0、**M4 0/3 rc=1**、M2 3/3 |
| `sh-failclosed-test` | base 34/34 rc=0、**M2 31/34 rc=1** |
| node 全仓 | **380/380 rc=0**（41 个 `*.test.ts`，含 `tests/**`） |
| 副本 | sh×3 `a809ccfb9311f0ec`/51754 B/无 BOM；ps1×**7** `0dfdcd5596f76827`/44327 B/**BOM=True ×7**；全 LF、distinct=1 |
| **xhs 树** | 用首轮发现该洞的探针复测：`sudo -u root diskpart` = **deny**、`env --ignore-environment diskpart` = deny、`--help\nrm /tmp/t` = deny ✅ |

## 残留（Evaluator 登记，均**非安全向**）

1. **sh「裸 `rm` 行」类 8 条 `deny→allow`**：形态＝某行的 `rm` 处于**行尾**（`rm\nrm --help` 等）。
   根因：新式选行 `grep -E "${CMD_PRE}rm([[:space:]]|-)"` 不含**无操作数**的裸 `rm` 行。
   **已证不可利用**：裸 `rm` 无操作数删不了东西；任何真删除必含 `rm `，该行必被保留 → 仍 deny；
   其余破坏基座各有独立规则。且 FIX7 自身对该形态本就不自洽，本轮是把"选行集合"与"抽取集合"对齐。
   建议补进 identity 语料做显式登记。
2. **3 处文档级失实**（不动 hook）：见 `IMPLEMENTATION_RESULT_G3-FIX8.md` §9 与实际不符之处，
   尤其 §9-4 声称"已在 FIX7 报告就地更正"而该文件与上一轮**逐字节相同**、仍留两条已被证伪的说法。

## 结论

两轮点名的放松在**两端**均已收回且等于 FIX7；全量 `deny→allow = 0`；无无法归因的新过拦；
闸门对两类回退均红且失败集恰好；10 份副本一致（xhs 首次并入且洞已闭）；红线全绿。
**PASS** —— 上述残留均非安全向，登记后不阻塞本切片。
