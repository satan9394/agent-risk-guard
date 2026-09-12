# IMPLEMENTATION_BRIEF G3 —— 跨端判定收敛 + 跨端判定闸门

## 1. 目标（两件事，缺一不可）

1. **消除已实测的 5 条跨端 decision 分歧**
2. **建立"跨端判定一致性闸门"**（自动进 node 测试套件）——**这是防复发的关键**：没有它，同一类分歧会反复重现（G4 复验与 G5 复验各挖出一批，都是它缺席的后果）

## 2. 实测证据（编排者 Round 260，`_probe_g3_div.mjs`，20 条 × 两端真实 spawn + 进程 stdin）

> 说明：**`EMPTY` = 无输出 = allow**（CC hook 协议：exit 0 + 无 JSON 即放行）。

| # | 载荷 | ps1 | sh | 应然 | 性质 |
|---|---|---|---|---|---|
| **T2** | `$X=RM; $X -RF /tmp/t` | deny | **allow** | **deny** | sh 漏拦（变量+大小写） |
| **T5** | `RM -RF /tmp/t` | deny | **allow** | **deny** | sh 漏拦（大小写） |
| **T9** | `command:null` | deny | **allow** | **deny** | sh 漏拦（类型） |
| **T10** | `command:["rm","-rf","/tmp/t"]` | deny | **allow** | **deny** | sh 漏拦（类型） |
| **T3** | `rm'' --help` | allow | **deny** | **allow** | sh 误拦（引号未归一） |

**已一致、勿改坏**（同批实测 same）：T1 `$x="r\m"; $x -rf /tmp/t`（两端同 allow）、T4 `r\m -rf /tmp/t`（两端 deny）、T6/T7/T8 裸控制字符、T11 `# note\nrm -rf /tmp/t`（两端同 allow）、T12、T13 空 command（两端 deny）、T14 非 Bash 工具、T15–T20 对照（危险/安全/前导空白/`;`/`|`/换行串联）。

## 3. 应然语义（编排者裁定，按此实现）

1. **T5 大小写**：`RM -RF /tmp/t` 必须 **deny**（sh 端缺 `-i` 忽略大小写或等价处理）
2. **T2 变量+大小写**：`$X=RM; $X -RF /tmp/t` 必须 **deny**（大小写修好后自然覆盖；若 sh 有变量展开则一并确认）
3. **T9/T10 类型**：`command` 非字符串（`null` / 数组）→ **deny**（sh 必须与 ps1 一致；ps1 已 deny）。注意与 G5 不冲突：G5 已让"缺 command 键 / 空串"deny，这里是**类型**问题
4. **T3 引号归一**：`rm'' --help` 必须 **allow**（等价于 `rm --help`，无害）。**但**：归一引号后**仍须完整判定** —— `rm'' -rf /tmp/t` 这类必须 **deny**（务必加邻居测试，别把归一做成新的绕过面）

## 4. 跨端判定闸门（本卡最重要产出）

新建 **`packages/core/test/decision-parity.test.ts`**：
- 语料：**至少**覆盖 §2 全部 20 条 + §3 的邻居（`rm'' -rf /tmp/t`、`r''m -rf`、`command:123`、`command:{}` 等）
- 对每条：**两端真实 spawn**（ps1 用 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File`；sh 用 **`wsl.exe -e bash`**）+ 进程 stdin 喂 JSON
- 断言：**两端 `permissionDecision` 完全一致**（allow 与"无输出"视为同一态；deny 必须两端都 deny）
- 失败时打印 `载荷 / ps1 / sh` 三列，便于定位
- 缺 `powershell.exe` 或 `wsl.exe` 时 **skip 并 diagnostic**（沿用 `redact-parity.test.ts` 的既有写法）

## 5. 不能破坏（红线）

1. **G15b 不回退**：三端脱敏 + 生产出口无明文；**M2 / M4 变异仍必红**（parity PART B）
2. **G5 不回退**：空 stdin / 非法 JSON / 缺 command / 含 TAB / 首行危险+次行 `#` → **exit 0 + 合法 JSON + deny**；sh `sh-failclosed-test` **34/34**
3. **sh 三套 67/40/192 + ps1 五套**全绿
4. **parity A/B/C 全绿**
5. **副本 distinct=1**；ps1 若改动 → **BOM=True 逐份复核（D9）**
6. **不得为过闸门而放宽 `/tmp` 等既有 allow 语义**（`git status` 等仍 allow）

## 6. 范围纪律

- **只做 §2/§3 的分歧与 §4 的闸门**。**不要**顺手重构规则引擎、不要动脱敏规则（`-p`/`--user`/PEM 锚点刚 ACCEPT）
- 真正的"从单一 spec 生成三端"大重构**不在本卡**（记录为 G3b）
- sh 端 `xhs-publish` 树的 ps1 变体（另一代 400 行）**不在冻结清单**，先不动，在报告里标注

## 7. 纪律

- **D6** 真实 spawn + 进程 stdin（sh 走 `wsl.exe`，Git Bash 会因反斜杠失败）；**D7** 构造邻居（尤其 T3 归一后的绕过面）；**D8** 基线对照；**D9** ps1 改后复核 BOM；**D10** 单次全红先重跑一次再定罪
- 每条改动**可指代码行**；顺序：改 → 测 → **同步副本** → 复核 distinct/BOM/行尾 → **最后**更新报告
- **报告每个数字必须真跑**；SH 侧注意行尾/BOM

## 8. 交付

- 三端改动（sh 为主，ps1 视需要）+ 新闸门 `decision-parity.test.ts` + 语料
- `tasks/orchestrator/IMPLEMENTATION_RESULT_G3.md`：§改动逐条对照（可指代码行）→ §5 条分歧 before/after 实证 → §闸门运行输出 → §回归数字 → §副本表 → §未解决问题
- 证据 `tasks/orchestrator/_g3_*`

## 9. 验收标准

§2 表格 **5 条分歧全部消除且两端一致**；§4 闸门**存在且能捕获人为分歧**（把某条改回旧行为 → 闸门必须变红，给出变异证据）；G15b/G5 红线不回退；sh 三套 + ps1 五套 + parity A/B/C 全绿；副本 distinct=1。
