# FIX_BRIEF G3-FIX7 —— 修 FIX6 的过拦（引号/散文括号）+ 前缀互串（放松）

## 0. FIX6 做对的（**不得回退**）

第十个 Evaluator 判 **窄口径 REJECT（方向是"过严"）**，但确认这些 PASS：
- **8 条回归真收回**：`git show 6ea0342:…ps1` = `fb85cc0e`（=FIX4 同字节），三列 `pre=deny → FIX5=allow → FIX6=deny`；全语料 76 条满足该模式；**9 包装 × 7 基座 = 63/63 两端 deny**
- **`x diskpart` 反向守卫仍 allow**
- **「单一定义」可复算**：Evaluator 从冻结终版只改 1 行生成的变异体与实现者声明**逐字相同**
- **无规则被意外改变**：两端前缀归一为 `@PRE@` 后做 LCS → ps1 差异 = 1 行定义 + 18 条规则前缀改写，**后缀逐字同**；放松 0 条，收紧 ps1 83 / sh 82
- `then|do|else` 放**包装词位**——Evaluator 判定**正确且必要**（引号内 `do rm`/`then rmdir` 仍 allow，if/for 形态仍 deny）
- 7 处例外逐处读源码核实**确实不该引用**；副本/BOM 全对

**本轮只修两处。**

---

## 1. 必修 A：`(` `{` 被误当命令位（过拦，8 条）—— 与 `then|do|else` 同构修法

**实测**（编排者 Round 263，两端）：
| 载荷 | 应然 | ps1 | sh |
|---|---|---|---|
| `printf '{ diskpart }'`（**验收清单点名的合法命令**） | allow | **deny** | **deny** |
| `echo "(diskpart)"` | allow | **deny** | **deny** |
| `echo "{ diskpart }"` | allow | **deny** | **deny** |
| `echo '(rm -rf)'` | allow | **deny** | allow |
| `git commit -m "fix (rm -rf)"` | allow | **deny** | **deny** |
| `grep -r "(rm -rf)" .` | allow | **deny** | **deny** |
| `sed -n 's/(rm -rf)/x/p' f` | allow | **deny** | **deny** |
| `ls (rm -rf)` | allow | **deny** | **deny** |

**根因**：FIX6 把 `(`/`{` 放在**锚位**（`(^|[;&|]|then|do|else|\(|\{)`），于是**引号内/散文里的括号**只要前面不是行首或分隔符就仍被算作命令位——包括 `s/(rm -rf)/` 这种 `(` 前面是 `/` 的情形（**lookbehind 补 `["']` 也修不掉它**）。

**修法（与实现者自己的 `then|do|else` 决策同构）**：
> **把 `(` 与 `{` 从锚位移进「包装词位」**，即它们像 `then|do|else` 一样出现在"命令词之前"的可重复前缀里，而**不再**作为起始锚的备选。

- 效果：`(rmdir /s /q x)`、`{ rmdir /s /q x; }`、`if true; then (rmdir); fi` **仍 deny**；而 `echo (rm -rf)`、`printf '{ diskpart }'`、`s/(rm -rf)/` **回到 allow**
- **判据（务必自测）**：`{` / `(` 只有出现在 **行首 / 分隔符后 / 其他包装词后** 才算命令位
- 两端同改（定义处各一行）

**并修正报告口径**：`IMPLEMENTATION_RESULT_G3-FIX6.md` §8-3 声称这类"**故不是新增过拦**"，**实测相反**——ps1 的 rm 族在 pre-G3 本就是命令位锚（非无锚），sh 端 `(`/`{` 历来不存在。**必须改写为事实。**

---

## 2. 必修 B：包装词与 `command|env|cmd /c` 不可互串（放松，≥10 条）

**实测**（应然 deny，因 ps1 pre-G3 为 deny）：
| 载荷 | ps1 | sh |
|---|---|---|
| `command time diskpart` | **allow** | **allow** |
| `env nice diskpart` | **allow** | **allow** |
| `env sudo diskpart` | **allow** | **allow** |
| `command cmd /c diskpart` | **allow** | **allow** |
| `sudo time nohup diskpart`（对照，正确） | deny | deny |

**根因**：`$CMD_PRE` 顺序是「包装词* → 路径 → (cmd\|command\|env)」，**包装词与 command/env 不能交错**。

**修法**：把 `sudo|time|nice|nohup|setsid|doas|exec|ionice|busybox|cmd|command|env` 放进**同一个可重复组**，允许**任意顺序与嵌套**；注意 `cmd /c`、`env -i` 这类**带参数**的包装词要按其真实形态处理（逐个列出你怎么处理，并给两端对照）。

**这是相对冻结基线的放松（D12 违规），必须修**；若某形态确属 ps1 独有语义（如 `cmd /c` 是 Windows 形态），**如实登记分歧并说明**。

---

## 3. 必修 C：闸门语料与口径

1. **K 段补 K60–K68**：§1 的 8 条过拦载荷 → **expect allow**
2. **L 段（跨端身份断言）补两对守卫**
3. **补互串语料**：§2 的 ≥10 条 → **expect deny**
4. **补反向守卫**：`x diskpart`、`echo "(diskpart)"`、`printf '{ diskpart }'` 必须留 allow
5. **目标**：A/B 面任一改回旧行为 → 闸门**必红**（变异体**从终版冻结副本派生**）
6. **不得留占位符**；口径必须与实测一致

---

## 4. 不能破坏（红线）

§0 全部 PASS 项（8 条回归仍 deny、`x diskpart` 仍 allow、单一定义、7 处例外、无规则被意外改变）；§A 向上对齐（`sudo chmod 777 /x`、`sudo find -delete`、`/usr/bin/find -delete`、`sudo xargs rm`、`sudo shutdown` → 两端 deny）；§B 空引号收敛（`g''it clean -f`、`c''hmod 777 /x`、`R''MDIR /s /q x`、`git cl''ean -f` → 两端 deny）；`rm'' --help` allow；删除族守卫 deny；redact parity A/B/C 绿 + **M4 红** + **M2 红（`sh-failclosed-test` 31/34 持有）**；`sh-failclosed-test` 34/34；sh 四套×三棵树；**ps1 五套×同步树**；node 全量；副本 sh×3 + ps1×6 distinct=1 且 **ps1 BOM=True 逐份**；25 条合法命令零过拦。

## 5. 纪律

**D6** 真实 spawn + 进程 stdin（sh 必须 `wsl.exe -e bash`）；**D7** 构造邻居（本轮尤其：引号内括号的**各种引法**、包装词交错嵌套、路径+包装+command 组合）；**D8** 基线对照**用 `git show <commit>:<path>` 取冻结字节**；**D9** ps1 改动逐份复核 BOM；**D10** 串行 + 单次全红先重跑；**D12** 向上对齐（**不得靠放松达成一致**）。
每条改动**可指代码行**；顺序：改 → 测 → **同步副本** → 复核 distinct/BOM/行尾 → **最后**更新报告。

## 6. 交付

- sh + ps1 改动（含六份 ps1 同步）+ 闸门语料 + FIX6 报告 §8-3 口径更正
- `tasks/orchestrator/IMPLEMENTATION_RESULT_G3-FIX7.md`：§改动逐条对照（可指代码行）→ §A 八条过拦的三列 before/after → §B 互串矩阵三列 → §前缀新定义处与引用清单 → §闸门变异证据（冻结基底）→ §回归数字 → §副本表（BOM/行尾）→ §未解决问题
- 证据 `tasks/orchestrator/_g3fix7_*`

## 7. 验收标准

§1 的 8 条**两端 allow** 且 `(rmdir /s /q x)`/`{ rmdir …; }` **仍 deny**；§2 的 ≥10 条**两端 deny**；`x diskpart` 等反向守卫仍 allow；闸门补齐且 A/B 任一改回必红；§0 与 §4 红线全绿；副本 distinct=1 且 ps1 BOM=True；报告无占位符、口径与实测一致。
