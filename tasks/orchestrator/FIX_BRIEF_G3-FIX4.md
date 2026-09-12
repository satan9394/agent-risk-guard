# FIX_BRIEF G3-FIX4 —— 修 G3 新引入的 3 条硬伤（含 1 条 fail-open）

## 0. G3 修对了什么（**不得回退**）

第七个独立 Evaluator 判 **REJECT**，但确认以下 **PASS**，必须保住：
- **5 条原分歧真消除**：T2/T5/T9/T10 两端 deny、T3 两端 allow（编排者亦 5/20→0/20 复现）
- **T3 绕过面干净**：21 条反向邻居（`r''m -rf`、`rm''''`、`rm''''' -rf`、`"r"m -rf`、`rm ''-rf`、`rm'-'-rf`、`;''rm`、`|''rm`、`'''''rm`…）该 deny 全 deny、该 allow 全 allow
- **29 条合法命令两端全 allow**（`Git status`/`LS -la`/`Echo hello`/`npm run Build`/`cat FORMAT.txt`/`grep RM file.txt`…）
- **红线全未退**：parity A/B/C 绿；M4 变异红 33；`sh-failclosed-test` 34/34 且 M2 变异 30/34 红；sh 四套 67/40/192/34；node 379/379
- **闸门本体合格**：66/66 绿；MU4（大小写整族行为回退）红 3/66、MU2 红 4/66
- 副本 distinct=1、ps1 六份 **零改动** BOM=True

**本轮只修 3 条新伤 + 1 项声明失实。**

---

## 1. R2（P0，fail-open，最严重）—— 数组元素为对象时 sh 放行

**实测**（编排者独立复现）：
| 输入 | ps1 | **post-G3 sh** | pre-G3 sh |
|---|---|---|---|
| `command:[{"cmd":"rm -rf /tmp/t"}]` | **deny** | **allow** | deny |
| `command:[{a:1},{b:2}]` | deny | allow | deny |

**根因**：`ps_elem` 的 **dict 分支**（sh **L302**）返回类型名字符串 `"System.Management.Automation.PSCustomObject"` → `cmd` 非空 → **绕过了"空 command → deny"路径**。方向是**放宽**，直接违反本卡红线。

**修法 M1（一行）**：sh **L302** → `return ""`（PowerShell 对 `PSCustomObject` 的 `[string]` 转换对**顶层**对象给出 `"@{k=v}"`，但**数组元素**为对象时给出**空串**；故此处应返回 `""`）。一次同时修好 R2 与 `ps_cast` 的 D5/D6 两条不一致，且**不破坏** `{"a":1}`→`"@{a=1}"`。

---

## 2. R1（新分歧 13 条）—— 空引号归一被应用到全规则集

**实测**：`g''it clean -f`、`g''it reset --hard`、`g''it push --force`、`g''it branch -D`、`r''mdir /s`、`s''hutdown /s`、`c''hmod 777`、`d''iskpart`、`sh''red`、`un''link`、`f''ind -delete`、`R''MDIR` —— **pre-G3 两端一致，post-G3 两端分歧**（ps1 allow / sh deny）。

**根因**：T3 的归一（sh L337-338）被**全规则集**共用，而 **ps1 只对 rm / Remove-Item 族剥离引号**（ps1 L222/L374）。

**修法 M2**：保留 `cmd` 原样走其余规则；**另存 `cmdNoq`（去空引号）仅给删除族**使用，结构对齐 ps1。

---

## 3. R3（新过拦 + 新分歧）—— `-i` 点着了潜伏的锚点不一致

**实测**：`git commit -m "remove SHUTDOWN path"`（**合法 commit message**）→ ps1 **allow**、pre-G3 sh allow、**post-G3 sh deny**。

**根因**：sh **L489** 前导锚含 `[:space:]`，而 ps1 **L463** 只认分隔符。`-i` 把这类**潜伏锚点不一致批量点着**。

**修法 M3（一行 + 审计）**：sh L489 `(^|[;&|[:space:]])` → **`(^|[;&|])[[:space:]]*`**（对齐 ps1 L463）。
**并要求**：**审计全部 33 处 `-i` 规则的前导锚**，找出同型潜伏不一致（裁决点名 **L494 chmod vs ps1 L468**），一并列出并修；报告须给"逐处锚点两端对照表"。

---

## 4. R4/R5（声明失实与覆盖）—— 必须处理

1. **`ps_cast` 自称"忠实复刻 `[string]`"，实测 43 条里 7 条不一致**，其中 **2 条影响判定**：
   - `[{"a":1}]` → ps1 `""` / sh `"System…"` → **判定分歧（ps1 deny / sh allow）**
   - `[{"a":1},{"b":2}]` → ps1 `" "` / sh `"System… System…"` → **判定分歧**
   - 其余：`1e2`→`100`/`100.0`；`1e21`→`1E+21`/`1e+21`；`1.0e-7`→`1E-07`/`1e-07`；`{"a":{"b":1}}`→`@{a=}`/`@{a=System…}`；`[{"a":1},"x"]`→`" x"`/`"System… x"`
   → **修 M1 后复测**，并把 `ps_cast` 的**真实语义**用注释写清（**不要再声称"忠实复刻"**，除非逐条验证过）
2. **闸门覆盖缺口（必须补，M4）**：闸门 66 条在缺陷源上**全绿**，而 153 条外部语料测出 **14 条新分歧 + 1 处 fail-open**。缺口精确对应三段：
   - **F 段**：**非 rm 族**的空引号插词（0 条）
   - **H 段**：**数组元素为对象**（0 条，语料只有嵌套数组）
   - **G 段**：`-i` 后**引号内文本命中**（0 条）
   → 各补足语料（合计约 40 条），**确保：把本轮 3 条硬伤任一改回旧行为，闸门必须变红**（给变异证据）

---

## 5. 不能破坏（红线，逐项自测存证）

1. §0 列出的 G3 已 PASS 项全部保持（尤其 **5 条原分歧仍 0**、T3 的 21 条绕过邻居仍全对、29 条合法命令仍 allow）
2. G15b：parity A/B/C 绿；**M2/M4 变异仍红**
3. G5：`sh-failclosed-test` **34/34**；5 条异常路径仍 exit=0 + 合法 JSON + deny
4. sh 四套 67/40/34/192 × 三棵树；node 全量
5. 副本 **distinct=1**、BOM=False、LF；**ps1 若改动 → BOM=True 逐份复核（D9）**
6. **不得为过闸门放宽 allow 语义**

## 6. 纪律

**D6** 真实 spawn + 进程 stdin（sh **必须 `wsl.exe -e bash`**）；**D7** 构造邻居（本轮尤其：非 rm 族的空引号、数组含对象、引号内含 `-i` 命中词）；**D8** 基线对照；**D9** ps1 改后复核 BOM；**D10** 单次全红/大面积失败**先重跑一次再定罪**（本轮实现者与 Evaluator **都**踩过 wsl 并发假红——**闸门语料跑法必须串行或受控批量**）。
每条改动**可指代码行**；顺序：改 → 测 → **同步副本** → 复核 distinct/BOM/行尾 → **最后**更新报告。

## 7. 交付

- sh 改动（M1/M2/M3 + 锚点审计）+ 闸门语料扩充（M4）
- `tasks/orchestrator/IMPLEMENTATION_RESULT_G3-FIX4.md`：§改动逐条对照（可指代码行）→ §R1/R2/R3 的 before/after 并列（含 pre-G3 / post-G3 / ps1 三列）→ §33 处锚点两端对照表 → §ps_cast 语义表（复测后）→ §闸门变异证据 → §回归数字 → §副本表 → §未解决问题
- 证据 `tasks/orchestrator/_g3fix4_*`

## 8. 验收标准

R2/R1/R3 全部消除且**两端一致**；`ps_cast` 语义经逐条比对与 ps1 相符（或如实标注剩余差异）；闸门补齐 F/H/G 三段且能捕获本轮 3 条硬伤（变异证据）；§0 的 PASS 项不回退；红线全绿；副本 distinct=1。
