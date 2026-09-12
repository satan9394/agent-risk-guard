# IMPLEMENTATION RESULT G3-FIX4 —— 修 G3 新引入的 3 条硬伤（含 1 条 fail-open）+ 补齐闸门缺口

> **本卡不自行宣布成功。** 下列结论供编排者 / 独立 Evaluator 复核；所有数字均可在 `tasks/orchestrator/_g3fix4_*` 复算。
> 主源最终 sha256(16) = **`a4b95f9cd683f3bc`**（41374 B、BOM=False、LF）；**ps1 本卡零改动**。

---

## 0. 摘要（每条都可指代码行）

| # | 缺陷 | 方向 | 修法 | 改后行号（sh） | 状态 |
|---|---|---|---|---|---|
| **R2** | `command:[{"cmd":"rm -rf /tmp/t"}]` sh 由 deny → **allow** | **fail-open** | **M1**：`ps_elem` 的 dict 分支 `return "System.Management.Automation.PSCustomObject"` → **`return ""`** | **L348** | **已修**：四列实测 two-end **deny** |
| **R1** | 13+ 条「非 rm 族空引号插词」跨端分歧 | 新分歧 | **M2**：`cmd` 保持原样；另存 `cmdNoq`/`cmdtestNoq` **只给 rm / Remove-Item 族** | **L388 / L406 / L414 / L431 / L437 / L442 / L461 / L588** | **已修**：F 段 16 条全部回到两端一致 |
| **R3** | `git commit -m "remove SHUTDOWN path"` 由 allow → deny | 新过拦 + 新分歧 | **M3**：前导锚 `(^\|[;&\|[:space:]])` → **`(^\|[;&\|])[[:space:]]*`** | **L545 / L561 / L568 / L588** | **已修**：实测两端 **allow** |
| **R4** | `ps_cast` 自称「忠实复刻」失实 | 声明失实 | 注释改口径为「逐条实测校准的**近似**」；`float` 按 .NET G 格式重写；`dict` 元素位返回 `""` | **L285–L356** | **已修**：见 §4 语义表 |
| **R5** | 闸门 66 条对三处缺口零覆盖 | 覆盖不足 | **M4**：`DECISION_CORPUS` 增补 **F/H/G 共 44 条**（66 → 110） | `packages/core/test/decision-parity.test.ts` | **已补**：3 个变异体全部把闸门打红，见 §5 |

**M3 审计的额外产出**：`find`（**L449**）/ `xargs`（**L455**）两条规则的**前导锚原本完全缺失**，`-i` 之后同样会把引号内文本点着 → 一并对齐 ps1 的 `(?:^|[;&|\r\n])\s*`。完整 36 处对照表见 `_g3fix4_anchor_audit.md`。

**过程中被闸门抓出的 1 条自伤（已修，见 §2.5）**：M2 收窄归一步围后，`rm'' -h` 因为 `rule 16`（L588）仍读**原始** `$cmd` 而命中引号插词规则 → 闸门 Q12 变红（ps1 allow / sh deny）。修法：L588 一并改用 `cmdtestNoq`。

---

## 1. 四条基线（D8）

| 基线 | 路径 | sha256(16) | 字节 | 可信度 |
|---|---|---|---|---|
| **pre-G3** | `agent-risk-guard/tasks/orchestrator/_g3_before/dangerous-commands.sh` | `7f7769f2175c6d88` | 30296 | 与 Evaluator G3 §1 认定的冻结副本同哈希 |
| **post-G3** | `.eval-tmp/g3fix4/postg3-recon.sh` | `8ac7782d87b95415` | 34359 | **本卡重建并自证**，见下 |
| **post-FIX4** | `agent-risk-guard-audit/scripts/dangerous-commands.sh` | `a4b95f9cd683f3bc` | 41374 | 本卡主源 |
| **ps1（参照系）** | `agent-risk-guard-audit/scripts/dangerous-commands.ps1` | `fb85cc0e4476ae58` | 34523 | 本卡零改动 |

> **为什么必须重建 post-G3**：G3 实现后**没有留下 post-G3 冻结副本**。只有 pre-G3 与 post-FIX4 两列，
> 就分不清「哪条硬伤是 G3 新造的、哪条是本卡修的」。重建方法（全部落在 `.eval-tmp/g3fix4/`）：
> ① 把 G3 自己的补丁脚本 `_g3_patch_sh.mjs` 重定向到 pre-G3 副本上跑；
> ② 再补上 `_g3_diff.txt` 记录的**改动 4**（L461 format 尾部 `[[:space:]]*/`）。
> 结果哈希 **与 Evaluator 独立测得的 post-G3 值逐字相同**（`8ac7782d87b95415` / 34359 B）→ 可作权威第三列。

---

## 2. R1 / R2 / R3 的 before / after（**四列并列**，真实 spawn + 进程 stdin，逐条串行）

完整表：`_g3fix4_probe_main.txt` / `_g3fix4_probe_main.json`（**112 条 × 4 列**）。
列义：`ps1` = 参照系；`shPre` = pre-G3；`shG3` = post-G3；`shFix` = 本卡改后。

### 2.1 R2（fail-open，最严重）

| 载荷 | ps1 | sh **pre** | sh **post-G3** | sh **post-FIX4** | 判定 |
|---|---|---|---|---|---|
| `command:[{"cmd":"rm -rf /tmp/t"}]` | deny | deny | **allow** ← fail-open | **deny** | ✅ |
| `command:[{"cmd":"git status"}]` | deny | allow | **allow** | **deny** | ✅ 同族 |
| `command:[{"a":1}]` | deny | allow | **allow** | **deny** | ✅ 顺带修好 D5 |
| `command:[{"a":1},{"b":2}]` | deny | allow | **allow** | **deny** | ✅ 顺带修好 D6 |
| `command:[{"a":1},"x"]` | allow | allow | allow | allow | ✅ 未过度收紧（PS 真值 `" x"`） |
| `command:{"a":{"b":1}}` | allow | allow | allow | allow | ✅ 未过度收紧（PS 真值 `"@{a=}"`） |
| `command:[{"a":1},[1]]` | allow | allow | allow | allow | ✅ 未过度收紧 |

代码位置：sh **L348**（`ps_elem` 的 dict 分支）。

### 2.2 R1（非 rm 族空引号插词）

| 载荷 | ps1 | sh **pre** | sh **post-G3** | sh **post-FIX4** |
|---|---|---|---|---|
| `g''it clean -f` | allow | allow | **deny** | **allow** |
| `g''it reset --hard` | allow | allow | **deny** | **allow** |
| `g''it rm x` | allow | allow | **deny** | **allow** |
| `g''it push --force` | allow | allow | **deny** | **allow** |
| `g''it branch -D x` | allow | allow | **deny** | **allow** |
| `r''mdir /s /q x` / `R''MDIR /s /q x` | allow | allow | **deny** | **allow** |
| `s''hutdown /s` | allow | allow | **deny** | **allow** |
| `c''hmod 777 /x` | allow | allow | **deny** | **allow** |
| `d''iskpart` | allow | allow | **deny** | **allow** |
| `sh''red -u /tmp/t` | allow | allow | **deny** | **allow** |
| `un''link /tmp/t` | allow | allow | **deny** | **allow** |
| `f''ind /tmp -delete` | allow | allow | **deny** | **allow** |
| `d''el /f x` / `e''rase x` | allow | allow | **deny** | **allow** |
| **反向守卫**：`r''m -rf /tmp/t` | deny | deny | deny | **deny** |
| **反向守卫**：`R''emove-Item x` / `R''''emove-Item x` | deny | **allow** | deny | **deny** |

代码位置：sh **L388**（`cmd` 不再就地替换，另存 `cmdNoq`）、**L406**（`cmdtestNoq`）、
L414 / L431 / L437 / L442 / L461 / L588（rm / Remove-Item 族改吃 `cmdtestNoq`）、
L426（PS 删除族的 del/erase/ri/rd/**rmdir** 一律**保持** `cmdtest` —— 若吃归一文本，`r''mdir /s` 会被重新误拦）。

### 2.3 R3（`-i` 点着的锚点不一致）

| 载荷 | ps1 | sh **pre** | sh **post-G3** | sh **post-FIX4** |
|---|---|---|---|---|
| `git commit -m "remove SHUTDOWN path"` | allow | allow | **deny** | **allow** |
| `echo "please shutdown the server"` | allow | **deny** | deny | **allow** |
| `echo "run chmod 777 /x"` | allow | deny | deny | **allow** |
| `git commit -m "fix halt handling"` | allow | deny | deny | **allow** |
| `echo "please reboot the box"` | allow | deny | deny | **allow** |
| `git commit -m "x \rm y"` / `echo "x \rm y"` | allow | deny | deny | **allow** |
| `git commit -m "always FIND -delete carefully"` | allow | allow | **deny** | **allow** |
| `git commit -m "note: xargs rm here"` | allow | deny | deny | **allow** |
| **反向守卫**：`npm run build && shutdown /s` | deny | deny | deny | **deny** |
| **反向守卫**：`echo hi; chmod 777 /x` | deny | deny | deny | **deny** |
| **反向守卫**：`chmod 777 /x` / `sudo shutdown -h now` | deny | deny | deny | **deny** |
| **反向守卫**：`echo "x" && reboot now` | deny | deny | deny | **deny** |

代码位置：sh **L545**（10b）、**L561**（shutdown，M3 主修）、**L568**（chmod）、**L588**（rule 16）；另 **L449 / L455**。

### 2.4 四列汇总（`_g3fix4_probe_main.txt`，112 条）

| 指标 | 值 |
|---|---|
| ① 两端分歧（ps1 vs post-FIX4） | **1** |
| ② 与应然不符（任一端 ≠ expect） | **1**（同一条） |
| ③ **post-G3 新造分歧**（pre 两端一致、post-G3 不一致） | **18 → 改后 0** |
| ④ 由本卡修掉的分歧（pre ≠ ps1、post-G3 ≠ ps1、post-FIX4 = ps1） | **11** |
| ⑤ 不可判读输出（INVALID-JSON / EXIT-n / SPAWN-ERR） | **0** |
| 两端一致且等于应然 | **111 / 112** |

**① / ② 唯一的那一条**是 `git commit -m "remove Diskpart usage"`：ps1 **deny** / sh **allow**，
且 **pre-G3 与 post-G3 同为此结果** → 属**既存残留**，非本卡引入，见 §8 U1（附「为什么不能顺手改」的分析）。

> 最终汇总可从 JSON 重算：`_g3fix4_probe_main_summary.txt`。
> （`_g3fix4_regress3.txt` 中该行显示 ②=2，是本探针**修订语料标签之前**的输出，差的那条是我语料 `expect` 写错
> —— `sudo chmod 777 /x` 的 ps1 真值实为 allow，即 §8 U2 的副作用条目；已更正并重跑。）

### 2.5 【诚实披露】过程中被闸门抓出的自伤 + 一次自造的假红

1. **真实自伤（已被闸门抓到并修复）**：M2 收窄归一范围后，`rm'' -h` 由 allow 变 deny
   （`rule 16` L588 仍读原始 `$cmd`，归一前带着引号 → 命中引号插词规则）。
   **闸门 Q12 立刻变红**（ps1 allow / sh deny），三轮复跑一致 → 判定为真实回归，不是并发噪声。
   修法：L588 改用 `cmdtestNoq`（rm 族归一文本；`rm''-rf` 仍由 L414 裸 rm 规则兜住）。
2. **一次自造的假红（脚本 bug，非产品问题）**：我第一版回归脚本里 `redact parity` 一段忘了
   `Push-Location $REPO`，node 找不到测试文件 → `PARITY-EXIT=1`。已修正并复跑为 **3 pass / exit=0**。
   全流程所有跨端判定均为**逐条串行** `spawnSync`，未出现 wsl 并发假红（D10）。

---

## 3. 全部 `-i` 规则「前导锚两端对照表」

逐处对照表（36 行，含 sh 行号 / ps1 行号 / 两端锚表达式 / 判定 / 处置）见 **`_g3fix4_anchor_audit.md`**。归类：

| 类别 | 处数 | sh 行号 | 处置 |
|---|---|---|---|
| **`[:space:]` 前导锚（M3 点名的同型潜伏不一致）** | 4 | L545 / **L561** / **L568** / L588 | **全部对齐 ps1** |
| **sh 无前导锚、ps1 有锚**（同一失败模式） | 2 | **L449**（find）/ **L455**（xargs/for） | **一并补齐** |
| sh 有锚、ps1 无锚（sh 更严的既存差异） | 3 | L426 / L517 / L528 | 不改（改动方向是放宽，风险 > 收益；L517 已实测登记 U1） |
| 两端同为无锚 / 本侧独有 | 27 | 其余 | 无锚点不一致 |

---

## 4. `ps_cast` 语义表（R4：如实标注，不再声称「忠实复刻」）

方法同 Evaluator：从主源**逐字提取**真实的 `ps_num/ps_cast/ps_elem`，与 ps1 的
`[string]$data.tool_input.command`（ps1 L205 原语）在**同一份 JSON** 上逐条对照，两端都加 `<<<>>>` 定界。
证据：`_g3fix4_pscast.txt` / `.json`（47 条）+ `_g3fix4_float_probe.txt` / `_g3fix4_float_probe2.txt`（18 条原始字面量）。

**合计 65 条 → 一致 62、不一致 3（4.6%），且 3 条全部是 0 判定影响的格式残差。**

| 载荷（JSON 字面量） | ps1 `[string]` | post-G3 sh | **post-FIX4 sh** | 判定影响 |
|---|---|---|---|---|
| `1e2` | `100` | `100.0` | **`100`** | 否 |
| `1e15` | `1E+15` | `1000000000000000.0`→`1e+15` | **`1E+15`** | 否 |
| `1e21` | `1E+21` | `1e+21` | **`1E+21`** | 否 |
| `1.5e16` | `1.5E+16` | `1.5e+16` | **`1.5E+16`** | 否 |
| `1.0e-7` | `1E-07` | `1e-07` | **`1E-07`** | 否 |
| `1e-15` / `-1e-5` | `1E-15` / `-1E-05` | 同左差 | **`1E-15` / `-1E-05`** | 否 |
| `123456789012345.6` | `123456789012345.6` | 同 | **同** | 否 |
| `{"a":{"b":1}}` | `@{a=}` | `@{a=System…PSCustomObject}` | **`@{a=}`** | 否 |
| **`[{"a":1}]`** | `""` | `System…PSCustomObject` | **`""`** | **是**（ps1 deny / 旧 sh allow） |
| **`[{"a":1},{"b":2}]`** | `" "` | `System… System…` | **`" "`** | **是** |
| `[{"a":1},"x"]` | `" x"` | `System… x` | **`" x"`** | 否 |
| 其余 52 条（null/true/false/str/int/`[]`/顶层 dict/嵌套数组/嵌套对象/布尔与 null 值位 …） | — | — | **逐条一致** | — |

### 已实现的语义（写进代码注释 L288–L305）

- **定点 ↔ 科学 的分界 = 十进制指数 e10 ∈ [-4, 14]**（实测钉出，非猜测）：
  `0.0001`→定点、`1e-5`→`1E-05`、`1e15`→`1E+15`、`1e16`→`1E+16`；
- 科学记数一律 **大写 `E` + 符号 + 至少两位指数**；尾数去掉多余 `.0`。

### 剩余残差（3/65，**如实登记，不掩盖**）

根因是 **PowerShell 5.1 `ConvertFrom-Json` 的数字类型映射**，不是格式化规则：

| 字面量形态 | PS 解析类型 | ps1 `[string]` | sh `ps_cast` |
|---|---|---|---|
| `0.00001`（无指数十进制） | **Decimal** | `0.00001` | `1E-05` |
| `0.0` / `-0.0`（无指数十进制） | **Decimal** | `0.0` | `0` |

`0.00001` 与 `1e-5` 是**同一个 double 值**，但 PS 的 `[string]` 结果不同（`0.00001` vs `1E-05`）——
Python 侧拿到的是解析后的 float，**无法区分原始字面量写法**，故该差异在 `ps_cast` 这一层不可消除。
**该残差对本产品的 `permissionDecision` 无任何影响**（两种渲染都不命中任何规则；实测四列判定一致）。
主源注释已按此口径写明，**全文不再出现「忠实复刻」措辞**。

---

## 5. 闸门（M4）—— 语料扩充 + 变异证据

### 5.1 语料：66 → **110 条**（新增 F/H/G 共 44 条）

| 段 | 条数 | 内容 | 覆盖硬伤 |
|---|---|---|---|
| **F** | 18（F1–F18） | **非 rm 族**空引号插词：git clean/reset/rm/push/branch、rmdir、shutdown、chmod、diskpart、shred、unlink、find -delete、del、erase + `r''m -rf`/`R''emove-Item` 两条反向守卫 + 1 对照 | R1 |
| **H** | 12（H1–H12） | **command 数组元素为对象**：`[{"a":1}]` / `[{"a":1},{"b":2}]` / `[{"a":1},"x"]` / `{"a":{"b":1}}` / **`[{"cmd":"rm -rf /tmp/t"}]`（R2 直接回归）** / `1e2` / `1e21` / `1.0e-7` / … | R2 + R4 |
| **G** | 14（G1–G14） | `-i` 后**引号内文本命中不敏感词**：`git commit -m "remove SHUTDOWN path"`（R3 直接回归）、REBOOT/CHMOD/halt/reboot 变体、`&& shutdown` / `; chmod 777` 反向守卫、2 条两端同形残留 | R3 |

### 5.2 变异证据（`_g3fix4_gate_mutants.txt`；变异体在 `_g3fix4_mutants/`，**未改主源**）

| 变异体 | 回退了什么 | 闸门 | 不一致条数 |
|---|---|---|---|
| **无（主源 `a4b95f9cd683f3bc`）** | — | **exit=0 绿 ✅** | **0 / 110** |
| `MR2-ps-elem-dict-typename.sh` | `ps_elem(dict)` 退回返回类型名（**R2 复活**） | **exit=1 红 ✅** | 4 / 110 |
| `MR1-global-normalise.sh` | 空引号归一重新泄漏给全规则（**R1 复活**） | **exit=1 红 ✅** | 15 / 110 |
| `MR3-shutdown-space-anchor.sh` | shutdown 前导锚退回含 `[:space:]`（**R3 复活**） | **exit=1 红 ✅** | 3 / 110 |

> **「把本轮 3 条硬伤任一改回旧行为 → 闸门必红」已达成**，且三个变异体的红点集合互不相同（4 / 15 / 3），
> 说明不是靠某一条冗余规则一起变红。修 L588 之前基线本身也会红（Q12），修后基线归零。

---

## 6. 回归数字（红线，逐项存证；`_g3fix4_regress3.txt`）

| 项 | 要求 | 实测（主源 sha `a4b95f9cd683f3bc`） |
|---|---|---|
| sh 四套 × **audit** | 67 / 40 / 34 / 192 | **67/67 · 40/40 · 34/34 · 192/192，rc=0 ×4** |
| sh 四套 × **skills** | 同 | **67/67 · 40/40 · 34/34 · 192/192，rc=0 ×4** |
| sh 四套 × **xhs-publish** | 同 | **67/67 · 40/40 · 34/34 · 192/192，rc=0 ×4** |
| decision-parity 闸门 | 绿 | **0 / 110，exit=0** |
| G15b redact parity A/B/C | 绿 | **3 pass / 0 fail，exit=0** |
| G15b **M4 变异** | 必红 | **exit=1 ✅（生产出口 33 处明文泄漏）** |
| G5 `sh-failclosed-test` | 34/34 | **34/34，rc=0** |
| G5 **M2 变异** | 必红 | **30/34，FAIL 4，rc=1 ✅** |
| node 全量 | 全绿 | **379 / 379，exit=0** |
| 四列判定探针 | — | **111/112 两端一致且等于应然；① = 1（既存 U1）** |

---

## 7. 副本表（D9）

| 组 | 副本 | sha256(16) | 字节 | BOM | 行尾 |
|---|---|---|---|---|---|
| **sh ×3** | audit / skills / xhs-publish | **`a4b95f9cd683f3bc` ×3（distinct=1）** | 41374 ×3 | **False ×3** | LF ×3 |
| **ps1 ×6** | audit / assets/hooks / skills / `~/.claude/hooks` / `~/.codex/hooks` / **`~/.gemini/config/hooks`** | **`fb85cc0e4476ae58` ×6（distinct=1）** | 34523 ×6 | **True ×6** | LF ×6 |

- **ps1 本卡零改动**（改动前快照 `_g3fix4_copies_before.txt` 的 5 份 + 本轮补测的第 6 份，全部同为 `fb85cc0e4476ae58` / BOM=True）。
- ⚠️ 第 6 份 ps1 的正确路径是 **`~/.gemini/config/hooks/dangerous-commands.ps1`**（不是 `~/.gemini/hooks/`）；
  上一轮 G3 复核报的 MISSING 是**路径口径问题**，不是文件缺失。本卡已实测补上 → **ps1 6/6 全部 BOM=True、零改动**。
- 改后全量快照：`_g3fix4_copies_after.txt`；改前快照：`_g3fix4_copies_before.txt`。
- `decision-parity.test.ts` 由 `a5bcf2ef8f3b6797` 改为 **`194e30abcd9d6dda`**（15707 → 24451 B，LF，无 BOM）。

---

## 8. 未解决问题（如实登记，不掩盖）

- **U1｜`diskpart` 锚点既存分歧（本轮**刻意**不改）**
  ps1 L267 用 `$cmdTest -match '\bdiskpart\b'`（**无前导锚**），sh L517 用 `${CMD_SEG}diskpart\b`（分隔符锚）。
  实测 `git commit -m "remove Diskpart usage"` → ps1 **deny** / sh **allow**，**pre-G3 与 post-G3 完全相同**
  → 非本卡引入，是本轮 112 条语料里**唯一**的残余分歧。
  **为什么不顺手改**：把 sh 改成 ps1 的「无锚」形态会**新造**一条分歧——sh 的 `cmdtest` 只剥离
  **带引号**的 echo/printf 参数，ps1 的 `$cmdTest` 会剥离整段，于是 `echo diskpart` 会由 allow 变 deny。
  即「用一条新分歧换一条旧分歧」。**正确修法是两端一起改成「`$cmdTest` + `\b`」，属下一卡范围。**
- **U2｜`sudo chmod 777 /x` 的放宽副作用（**必须复核**）**
  M3 要求 L568 对齐 ps1 L468，而 **ps1 的 chmod 规则本身不认 `sudo` 前缀**。故对齐后
  `sudo chmod 777 /x` 由 sh **deny** 变 sh **allow**（ps1 始终 allow）。四列：ps1=allow / pre=deny / G3=deny / FIX4=**allow**。
  这是**为两端一致而做的对齐**，不是「为过闸门放宽」；但它确实放松了 sh 对一条真实危险命令的拦截。
  **建议下一卡两端一起加 `(sudo\s+)?`**（同时改 ps1 6 份 + BOM 复核）——本卡按裁决只动 sh。
- **U3｜`r..m` 命令名内插词规则无锚（未改）**：ps1 16e 有 `(?:^|[;&|\r\n])\s*`，sh L442 无锚。
  例如 `sudo r''m -rf` 两端可能仍不一致；属既存差异，改动方向是**收紧 sh**，与 `sh-audit-bypass.sh`
  既有语义有交互，本卡未动。
- **U4｜（已闭环）`~/.gemini` 第 6 份 ps1 的路径口径**：上一轮报 MISSING 是因为路径写成 `~/.gemini/hooks/`；
  正确路径为 **`~/.gemini/config/hooks/dangerous-commands.ps1`**，实测 sha256(16)=`fb85cc0e4476ae58`、BOM=True、零改动。
  → **ps1 6/6 due 逐份复核通过，D9 无触发。**
- **U5｜`rm' '-h` 家族**：ps1 allow / sh deny（pre-G3 即如此）。根因是 sh L414 的 help 豁免只覆盖
  「归一后」的 `rm -h` 形态，对「非空引号 + 单字母帮助标志」不生效；POSIX ERE 无负向前瞻，
  无法照抄 ps1 16c 的 `(?!-?h(?:elp)?\b|version\b|V\b)`。属既存残留，未列闸门。
- **U6｜`ps_cast` 的 Decimal 字面量残差**（§4）：3/65，0 判定影响，原理上不可在 sh 侧消除
  （Python 拿不到原始字面量文本）。已写进主源注释。

---

## 9. 证据清单（`tasks/orchestrator/`）

| 文件 | 内容 |
|---|---|
| `_g3fix4_cases.mjs` | 自造语料 112 条（F/H/G/S/R 五段，独立于闸门 110 条） |
| `_g3fix4_probe.mjs` / `_g3fix4_probe_main.{json,txt}` / `_g3fix4_probe_main_summary.txt` | **四列对照**探针（ps1 / post-FIX4 / post-G3 / pre-G3，逐条串行）+ 最终汇总 |
| `_g3fix4_copies_before.txt` | 改动前的 11 份副本 sha/BOM/行尾快照 |
| `_g3fix4_anchor_audit.md` | 36 处 `-i` 规则前导锚两端对照表 |
| `_g3fix4_pscast.mjs` / `_g3fix4_pscast.{txt,json}` / `_g3fix4_pscast_probe.ps1` | `ps_cast` 忠实性 47 条逐条对照 |
| `_g3fix4_float_probe.mjs` / `_g3fix4_float_probe2.mjs` / `_g3fix4_float_probe*.txt` | .NET float 定点/科学分界 36 条实测 |
| `_g3fix4_gate_mutants.mjs` / `_g3fix4_gate_mutants.txt` / `_g3fix4_mutants/` | 闸门绿 + 3 个变异体（R1/R2/R3 复活）实测 |
| `_g3fix4_run.ps1` / `_g3fix4_regress3.txt` | 全量回归驱动脚本与最终日志 |
| `_g3fix4_node_full.txt` | node 全量 379/379 |
| `.eval-tmp/g3fix4/postg3-recon.sh` | **重建并自证的 post-G3 基线**（`8ac7782d87b95415`）；同目录含重建脚本 `_regen.mjs` / `apply_g3change4.mjs` |
