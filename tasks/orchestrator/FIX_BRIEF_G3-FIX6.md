# FIX_BRIEF G3-FIX6 —— 命令位前缀「单一定义、全规则引用」（终止打补丁循环）

## 0. 为什么不再打补丁

G3 已走 FIX4 → FIX5 两轮，**每轮都在"加锚"与"加前缀"之间摆动**：
- 加锚 → 修掉 `x diskpart` 误伤，但**删掉包装词/子 shell 前缀覆盖**（FIX5 的错）
- 加前缀 → 有重新把 `x diskpart` 打成误伤的风险

**根因是"命令位前缀"grammar 被各规则各写一份**。本轮**不再逐处打补丁**，改为：
> **在两端各定义一次「命令位前缀」片段，全部规则统一引用它。**

---

## 1. 必修 A：统一前缀片段（终止漂移）

### 缺陷实测（编排者 Round 262，ps1 不达应然 8/13）
| 载荷 | 应然 | ps1 | sh | 说明 |
|---|---|---|---|---|
| `time diskpart` | deny | **allow** | allow | 包装词前缀丢失 |
| `nice rmdir /s /q x` | deny | **allow** | allow | 同上 |
| `nohup rmdir /s /q x` | deny | **allow** | allow | 同上 |
| `time format C: /q` | deny | **allow** | allow | 同上 |
| `(rmdir /s /q x)` | deny | **allow** | allow | 子 shell |
| `{ rmdir /s /q x; }` | deny | **allow** | allow | 块 |
| `if true; then rmdir /s /q x; fi` | deny | **allow** | allow | `then` |
| `for i in 1; do del x; done` | deny | **allow** | allow | `do` |
| `rmdir /s /q x` / `diskpart`（对照） | deny | deny | deny | 裸命令正确 |
| `x diskpart`（**反向守卫**） | **allow** | allow | allow | **不得回归为 deny** |
| `sudo git status` / `git status` | allow | allow | allow | 合法命令 |

**决定性证据**（Evaluator 从 git 独立取）：`git show 6ea0342:…ps1` 与 `git show 4c94b90:…ps1` **同为 `fb85cc0e4476ae58`** → ps1 从 pre-G3 到 FIX4 逐字节未变，**FIX5 是首次改动**，故这 8 条是**相对冻结基线的客观回归**（ps1 原本 deny）。

### 修法（Evaluator §9 处方，我采纳并升级为"单一定义"）
两端各定义**一个**前缀片段，形如：

```
(^|[;&|]|\bthen\b|\bdo\b|\belse\b|\(|\{)
(\s*(sudo|time|nice|nohup|setsid|doas|exec|ionice|busybox)\b)*
\s*
(?:/[^\s;&|]*/)?
```

- **sh**：定义为一个变量（如 `CMD_PRE`）并**被全部相关规则引用**；`x diskpart` 不在命令位 → 不匹配
- **ps1**：定义为一个可在各规则复用的片段常量（**18 处同形照改**）
- **不得放宽成"任意单词"**：否则 `x diskpart` 会重新被 deny（新过拦）

**升级要求（本卡核心）**：
1. 片段在**每端只出现一次**（命名常量），其余规则**引用**它——请给出"定义处 + 引用处清单"
2. 若某规则因技术原因无法引用（如不同分隔语义），**必须单独列出并说明理由**
3. **闸门加一条跨端身份断言**：对同一批"命令位/非命令位"语料，两端 decision 必须一致（防止未来一端偷偷漂移）

---

## 2. 必修 B：闸门语料与报告

1. **闸门 K 段补 ≥10 条**：`time|nice|nohup` × `diskpart|rmdir /s /q|format C:`、`( )`、`{ ; }`、`if…then`、`for…do` —— **expect deny**
2. **保留 `x diskpart` = allow 作反向守卫**（防"任意单词"式放宽）
3. **修报告占位符**：`IMPLEMENTATION_RESULT_G3-FIX5.md` §5 仍是未填的 `<!--MUTATION-RESULTS-->` → 本轮把变异证据补实（**不得留占位符**）
4. **改口径**：FIX5 报告 §8-2 的"唯一放松面/不可执行"表述**必须改写**（那 8 条是**可执行**的，且是回归）
5. **变异体须是冻结基底**：FIX5 的 `_g3fix5_mutants/{M4r,M2r}` 是中间态、且 `M2r` 在 `redact-parity` 上**不可复现**（不红）。本轮变异必须**从终版冻结副本**派生，并**在其能真实触发的套件上**跑（如 TAB 红线归 `sh-failclosed-test`）

---

## 3. 不能破坏（红线）

1. §A 向上对齐成果（`sudo chmod 777 /x`、`sudo find -delete`、`/usr/bin/find -delete`、`sudo xargs rm`、`sudo shutdown` → **两端 deny**）
2. §B 空引号收敛成果（`g''it clean -f`、`c''hmod 777 /x`、`R''MDIR /s /q x`、`git cl''ean -f` → **两端 deny**）；`rm'' --help` 仍 allow；删除族反向守卫仍 deny
3. **`x diskpart` 必须仍 allow**（反向守卫，防过拦回归）
4. G15b：redact parity A/B/C 绿；**M2/M4 变异仍红**（注意 M2 的 TAB 红线由 `sh-failclosed-test` 持有）
5. G5：`sh-failclosed-test` **34/34**
6. sh 四套 × 三棵树 12/12；**ps1 五套 × 同步树 10/10**；node 全量
7. 副本 sh×3、ps1×6 **distinct=1**；**ps1 BOM=True 逐份（D9）**；sh 无 BOM；行尾一致
8. 25 条合法命令（含 6 条 `sudo <安全命令>`、`find . -name ''`、`echo "it''s"`）**零过拦**

## 4. 纪律

**D6** 真实 spawn + 进程 stdin（sh 必须 `wsl.exe -e bash`）；**D7** 构造邻居（本轮尤其：包装词嵌套 `sudo time nice nohup x`、路径+包装组合、`x diskpart` 反向守卫）；**D8** 基线对照（**用 `git show <commit>:<path>` 取冻结版本**，不要靠重建）；**D9** ps1 改动逐份复核 BOM；**D10** 串行 + 单次全红先重跑；**D12** 向上对齐（一致性不得靠放松达成）。
每条改动**可指代码行**；顺序：改 → 测 → **同步副本** → 复核 distinct/BOM/行尾 → **最后**更新报告。**不得留占位符、不得声称未经逐条验证的话。**

## 5. 交付

- sh + ps1 改动（含六份 ps1 同步）+ 闸门语料与身份断言
- `tasks/orchestrator/IMPLEMENTATION_RESULT_G3-FIX6.md`：§**统一前缀片段定义处与引用处清单**（可指代码行）→ §8 条回归的 before/after（**用 git show 取冻结 ps1**）→ §包装/子shell 矩阵实测 → §`x diskpart` 反向守卫 → §闸门变异证据（冻结基底）→ §回归数字（含 ps1 五套）→ §副本表（BOM/行尾）→ §未解决问题
- 证据 `tasks/orchestrator/_g3fix6_*`

## 6. 验收标准

§1 的 8 条包装/子 shell 形态**两端 deny**；**`x diskpart` 仍 allow**；统一前缀片段**每端单一定义**且有引用清单；闸门含跨端身份断言 + K 段新语料，且**A/B 面任一改回旧行为必红**（冻结基底变异证据）；§3 红线全绿；副本 distinct=1 且 ps1 BOM=True。
