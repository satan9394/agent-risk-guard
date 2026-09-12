# FIX_BRIEF G3-FIX5 —— 向上对齐（动 ps1）+ 修闸门自相矛盾

## 0. 这是编排者的任务卡错误，先认账

上一轮（FIX4）我要求"**消除 13 条非删除族空引号分歧、且不动 ps1**"——**这个约束本身是错的**。它逼出唯一可行解：**把 sh 向下对齐到 ps1 的洞**。后果：

- `sudo chmod 777 /x` 由 sh **deny → allow**（ps1 的洞一字未动）
- 第八个 Evaluator 独立扫出**同类 17 处**：`sudo|/usr/bin/|sudo''` × `find -delete`/`find -exec rm`/`xargs rm`、`sudo|sudo''` × `chmod 777`、`sudo''` × `shutdown`；其中 **12 条是真实可执行危险命令由 deny→allow**，且 pre-G3 即 deny → **客观回归**
- **24 条 bash 下真实可执行的危险写法**（`g''it clean -f`、`c''hmod 777 /x`、`R''MDIR /s /q x`、`git cl''ean -f`、`shut''down /s`）现两端一起 allow

**本轮解除"不动 ps1"的约束。向上对齐是唯一正确方向。**

---

## 1. 必修 A：向上对齐 sudo / 路径前缀（sh + ps1 同批）

**实测**（四列：ps1 / pre-G3 / G3 / FIX4）：

| 载荷 | ps1 | pre-G3 sh | FIX4 sh |
|---|---|---|---|
| `sudo chmod 777 /x` | allow | **deny** | **allow** ← 放松 |
| `sudo find /tmp -delete` | allow | deny | allow |
| `/usr/bin/find /tmp -delete` | allow | deny | allow |
| `sudo xargs rm` | allow | deny | allow |
| `sudo'' shutdown /s` | allow | deny | allow |

**修法**：给锚点补可选 `sudo` 前缀，**两端同批**——
- **sh**：L568（chmod）、**L449（find）**、**L455（xargs）** 补 `(sudo[[:space:]]+)?`；**并审计全部锚点**，凡"危险基座"类规则一律补 `(sudo\s+)?`（第二前缀 `/usr/bin/` 之类**按 ps1 现有口径决定**，不要单方面加严以免新造分歧——**以"两端一致且取更严者"为准，逐条列出你的取舍**）
- **ps1**：L468（chmod）、L333–340（find/xargs 等）补 `(?:sudo\s+)?`
- **ps1 改动 → 6 份副本全同步 + 逐份复核 BOM=True（D9）**

---

## 2. 必修 B：结构性收敛——让 ps1 也做空引号归一（消掉 24 条放松 + 全部分歧）

**现状矛盾**：sh 已把"去空引号"收窄到删除族（M2），ps1 只对 rm/Remove-Item 剥离 → 于是 `g''it clean -f` 等**两端一起 allow**，而这些在 bash 下**真实还原成危险命令**（Evaluator 用 `set --` 实测确认）。

**修法（Evaluator 建议，我采纳）**：
- **ps1**：把现有 `$cmdNaked`（L223）的思路**提升为"检测用归一文本"**，供**全部规则**使用（回显/脱敏仍读原文）
- **sh**：**恢复 G3 的全局归一**（即回退 M2 的收窄）
- 结果：`g''it clean -f`、`c''hmod 777`、`R''MDIR /s /q` **两端一起 deny**；分歧与放松**同时消失**
- **`rm'' --help` 仍须 allow**（由 help/version 豁免在**归一后**的文本上生效）
- **反向守卫仍须 deny**：`r''m -rf /tmp/t`、`rm'' -rf''`、`R''emove-Item`

---

## 3. 必修 C：闸门期望自相矛盾（必须修）

同一份语料里出现**对同一条 bash 命令的相反期望**：
- `C6 RMDIR /s /q x` = **deny** vs `F7 R''MDIR /s /q x` = **allow**
- 同型：`C12/C16/C17` vs `F13/F8/F9`

**修法**：把 F 段这些**期望改为 deny**（与 C 段一致），并在闸门文件里**加注释说明"空引号归一后两端同判"**，避免后来者误以为 allow 是契约。

**闸门语料补**（本轮缺口，Evaluator 点名零覆盖）：
- `sudo` / `sudo''` / `/usr/bin/` 前缀 × `chmod 777`、`find -delete`、`find -exec rm`、`xargs rm`、`shutdown`
- 既存分歧族：`sudo|x|/usr/bin/|sudo''` × `diskpart`/`rmdir`/`format`（Evaluator 实测 **≥12 条**，报告 U1 口径偏小，以实测为准）
- 目标：**本轮 A/B 任一改回旧行为 → 闸门必红**（给变异证据）

---

## 4. 不能破坏（红线）

1. G3 的五条原分歧保持 0（T2/T5/T9/T10 两端 deny、T3 两端 allow）
2. FIX4 修好的 R2（数组含对象 → deny）**不得回退**
3. G15b：parity A/B/C 绿；**M2/M4 变异仍红**
4. G5：`sh-failclosed-test` **34/34**；5 条异常路径 exit=0 + 合法 JSON + deny
5. sh 四套 67/40/34/192 × 三棵树；**ps1 五套**（本轮首次动 ps1，必须全跑）；node 全量
6. **副本**：sh ×3、**ps1 ×6** 全部 distinct=1；ps1 **BOM=True 逐份复核**、sh 无 BOM、行尾一致
7. 过拦面保持干净（含 `chmod`/`format`/`find`/`shutdown` 字样的**合法**命令仍 allow，16 条基准）

## 5. 纪律

- **D12（本轮新增，编排者裁定）**：**跨端一致性必须向上对齐（取更严的一端），不得向下对齐以致放松真实危险命令。** 若为一致而必须放松，**要么两端一起收紧，要么保留分歧并如实记录**——**不许把放松写进闸门当契约**。
- **D6** 真实 spawn + 进程 stdin（sh 必须 `wsl.exe -e bash`）；**D7** 构造邻居（本轮尤其：sudo/路径前缀 × 全部危险基座、空引号插词在删除族与非删除族两侧）；**D8** 四列基线对照（ps1 / pre-G3 / G3 / post-FIX5）；**D9** ps1 每次改动后**逐份复核 BOM=True**（编辑工具会丢 BOM，已两次踩到）；**D10** 单次全红/大面积失败先重跑一次再定罪，跨端探针**串行**。
- 每条改动**可指代码行**；顺序：改 → 测 → **同步副本** → 复核 distinct/BOM/行尾 → **最后**更新报告。
- **诚实口径**：不得声称"忠实复刻"之类未经逐条验证的话；残留与取舍必须如实列出。

## 6. 交付

- sh + **ps1** 改动（含 6 份 ps1 副本同步）+ 闸门语料与期望修正
- `tasks/orchestrator/IMPLEMENTATION_RESULT_G3-FIX5.md`：§改动逐条对照（可指代码行）→ §A/B 的四列 before/after → §逐处锚点两端对照表 → §闸门期望修正清单 → §闸门变异证据 → §回归数字（含 ps1 五套）→ §副本表（含 BOM/行尾）→ §未解决问题
- 证据 `tasks/orchestrator/_g3fix5_*`

## 7. 验收标准

§1 的 12 条真实危险命令**两端 deny**；§2 的 24 条空引号危险写法**两端 deny**，且 `rm'' --help` 仍 allow、删除族反向守卫仍 deny；§3 闸门无自相矛盾且补齐语料、**A/B 任一改回必红**；§4 红线全绿（含 ps1 五套 + BOM）；副本 distinct=1。
