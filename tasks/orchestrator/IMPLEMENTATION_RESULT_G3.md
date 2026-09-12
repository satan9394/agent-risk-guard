# IMPLEMENTATION RESULT G3 —— 跨端判定收敛 + 跨端判定闸门

**结论（供编排者验收，本卡不自行宣布成功）**

§2 的 **5 条跨端 decision 分歧已全部消除**（20 条矩阵 5 → **0**；另加的 42 条邻居矩阵 22 → **0**）；
**新闸门 `packages/core/test/decision-parity.test.ts` 已进 node 测试套件且具备捕获力**（把任一条改回旧行为 → 闸门变红，6 个变异体全部红，含"整源回退"27/66 红）。
G15b / G5 红线**未回退**（parity A/B/C 3 pass、M4 变异仍红；sh-failclosed 34/34、M2 变异仍红）；
sh 四套 × 三棵树全绿；node 全量 **379/379**；sh 副本 distinct=1（**ps1 零改动**）。

主源：`agent-risk-guard-audit/scripts/dangerous-commands.sh`
改动后 sha256 前 16 位 = **`8ac7782d87b95415`**（476 → 523 行，30296 → 34359 字节，BOM=false，LF）。

---

## 0. 改动逐条对照（可指代码行）

**ps1 侧：零改动。** 五条分歧全部是 sh 侧偏离 ps1 语义，ps1 即参照系（六份副本 sha `fb85cc0e4476ae58` 未变，BOM=true 逐份复核见 §副本表）。

### 改动 1 —— T5/T2「大小写」根因：判定规则 `grep` 全面 `-i`

ps1 的 `-match` **默认大小写不敏感**（仅 `git switch -C` 用 `-cmatch` 精确大写，见 ps1 L481）；
sh 侧旧实现用 `grep -qE`（默认**大小写敏感**）→ 大小写维度整族漏拦。

| 行（改后） | 内容 | 说明 |
|---|---|---|
| L356,360,375,379,384,389,394,399,404,409,414,423,425,428,431,435,438,441,445,450,453,456,461,466,471,476,481,484,489,494,499,504,509 | `grep -qE` → `grep -qiE` | **33 处**（判定区域内实测计数；另有 L370 / L514 两处**原本就是** `-qiE`，未计入） |
| **L360** | `grep -qiE "(^\|[;&\|])[[:space:]]*rm([[:space:]]\|-)"` | 裸 `rm` 规则（T5 主命中点） |
| **L361-364** | `rmseg` 抽取前 `tr '[:upper:]' '[:lower:]'`；help 名单改 `-h\|--help\|-v\|--version` | sed 的 `I` 标志是 GNU-only，本文件禁用 → 用 `tr` 等价；保证 `RM --help` / `RM -H` / `RM -V` 与 ps1 同为**放行** |
| **L476** | `grep -qiE '=[[:space:]]*["'"'"']*rm(...` | 10b 变量赋值规则（T2 主命中点；`$X=RM; $X -RF ...`） |
| **L425** | `... `restore([[:space:]]\|$))' \|\| printf ... \| grep -qE 'git[[:space:]]+switch[[:space:]]+-C'` | **唯一例外**：`git switch -C` 从 `-i` 组里拆出，保持大小写敏感（对齐 ps1 L481 的 `-cmatch`；`-c` 是安全的新建分支，`sh-hook-test.sh` L50 有 allow 用例） |

### 改动 2 —— T3「空引号归一」（本卡最大风险点，邻居面已钉）

| 行（改后） | 内容 |
|---|---|
| **L328-336** | 新增注释块：说明缺陷、修法、以及「归一方向恒为**多看见**、不会把危险词藏起来」的论证 |
| **L337** | `cmdOrig="$cmd"`（保留**原始命令**） |
| **L338** | `cmd=$(printf '%s' "$cmd" | sed -E "s/''//g; s/\"\"//g")` —— **只删空引号对**（`''` / `""`），不删任何非空引号内容 |
| **L137-138** | `redact_cmd()` 改读 `$cmdOrig` → 回显/脱敏仍用原文，**生产出口与 core/ps1 的逐字一致性不受影响**（parity PART B/C 因此仍绿） |
| **L202** | 新增 `cmdOrig=""` 初始化（`set -u` 下，解析失败路径也会经 `deny_command → redact_cmd`） |

归一后**照常跑全部规则、不设任何短路**：`rm'' --help` ≡ `rm --help` → allow；
而 `rm'' -rf /tmp/t` → `rm -rf /tmp/t` → **deny**，`r''m -rf` → **deny**，`;''rm -rf` → **deny**（邻居测试 Q1–Q12）。

### 改动 3 —— T9/T10「command 类型」

D8 先量基线（`_g3_type_probe.mjs`，17 条）：ps1 的真实行为不是"非字符串一律 deny"，而是
`[string]$data.tool_input.command`（ps1 L205）的**转换语义** + L204 的 null 判定。
实测：`null`/`[]`/`{}`/`["rm","-rf","/tmp/t"]` → **deny**；`123`/`0`/`1.5`/`true`/`false`/`{"a":1}`/`[["rm"]]`/`["rm","--help"]` → **allow**。
故 sh 侧按**同一语义**对齐（而不是拍脑袋"非字符串全 deny"——那会新造 7 条反向分歧）：

| 行（改后） | 内容 |
|---|---|
| **L243-244** | `if "command" not in ti or ti.get("command") is None:` → `NO_CMD`（对齐 ps1 L204：**JSON null ≡ 缺字段** → deny） |
| **L287-299** | 新增 `ps_cast(v)`：复刻 PowerShell `[string]` —— `None→""`、`True/False→"True"/"False"`、`int/float→str`、`list→" ".join(ps_elem)`、`dict→"" (空) 或 "@{k=v;...}"` |
| **L300-303** | 新增 `ps_elem(v)`：嵌套 `list→"System.Object[]"`、`dict→"System.Management.Automation.PSCustomObject"`（与 PS 实测一致） |
| **L306** | 命令抽取改 `print(ps_cast(...), end="")` —— `["rm","-rf","/tmp/t"]` 因此变成 `rm -rf /tmp/t` → 命中删除规则 → **deny** |

### 改动 4 —— 被改动 1「暴露」出的一处结构偏差（顺带对齐，1 行）

`-i` 之后，大写 `FORMAT C:` 在 sh 变 deny、而 ps1 仍 allow（邻居探针 C15 实测）。
根因是 sh 的 format 规则**漏了 ps1 L262 的 `[[:space:]]*/` 尾巴**（旧实现在小写 `format c:` 上早已与 ps1 发散，只是没有闸门发现）。

| 行（改后） | 内容 |
|---|---|
| **L461** | `${CMD_SEG}format[[:space:]]+[A-Za-z]:` → `${CMD_SEG}format[[:space:]]+[A-Za-z]:[[:space:]]*/`（对齐 ps1 L262；`format C: /fs:ntfs` 仍 deny，见 `sh-audit-bypass.sh` L181） |

> 范围纪律：**未**重构规则引擎、**未**动脱敏规则、**未**动 sh 的 `xhs-publish` 树 ps1 变体。
> 完整 diff：`_g3_diff.txt`（+85 / −38 行，含注释）。

---

## 1. §2 五条分歧 before / after（真实 spawn + 进程 stdin，两端并列）

`EMPTY` = 无输出 = **allow**（CC hook 协议：exit 0 + 无 JSON 即放行）。
before 证据：`_g3_neighbors_before.txt` + 编排者 Round 260 表；after 证据：`_g3_div_after.txt` / `_g3_neighbors_after.txt`。

| # | 载荷 | ps1 | sh **before** | sh **after** | 应然 | 结论 |
|---|---|---|---|---|---|---|
| T2 | `$X=RM; $X -RF /tmp/t` | deny | **allow** | **deny** | deny | ✅ 收敛 |
| T5 | `RM -RF /tmp/t` | deny | **allow** | **deny** | deny | ✅ 收敛 |
| T9 | `command:null` | deny | **allow** | **deny** | deny | ✅ 收敛 |
| T10 | `command:["rm","-rf","/tmp/t"]` | deny | **allow** | **deny** | deny | ✅ 收敛 |
| T3 | `rm'' --help` | allow | **deny** | **allow** | allow | ✅ 收敛（误拦已消除） |

**两侧矩阵**：

| 矩阵 | before 分歧 | after 分歧 | 证据 |
|---|---|---|---|
| 编排者 20 条（T1–T20） | **5 / 20** | **0 / 20** | `_g3_div_after.txt`（after）；编排者表（before） |
| 邻居面 42 条（Q1–Q12 引号 / C1–C20 大小写 / Y1–Y10 类型） | **22 / 42** | **0 / 42** | `_g3_neighbors_before.txt` / `_g3_neighbors_after.txt` |
| 闸门语料 66 条 × pre-G3 主源 | **27 / 66** | **0 / 66** | `_g3_mutation_gate.txt`（M0 行）/ `_g3_gate_run.txt` |

**T3 的绕过面（D7，本卡最大风险）**——归一后**必须仍完整判定**，实测全部仍 deny：

| 邻居 | ps1 | sh after |
|---|---|---|
| `rm'' -rf /tmp/t`（Q3） | deny | **deny** |
| `rm"" -rf /tmp/t`（Q4） | deny | **deny** |
| `r''m -rf /tmp/t`（Q5） | deny | **deny** |
| `''rm -rf /tmp/t`（Q7） | deny | **deny** |
| `;''rm -rf /tmp/t`（Q8） | deny | **deny** |
| `rm''-rf /tmp/t`（Q9） | deny | **deny** |
| `rm' '-rf /tmp/t`（Q10，非空引号） | deny | **deny** |
| `r''m --help`（Q6）/ `rm'' -h`（Q12）/ `rm'' --version`（Q11） | allow | **allow** |

**「勿改坏」对照仍 allow**：`git status`、`ls -la`、`echo hello`、`npm test`、`rm --help`、`git switch -c feature`、`git push --force-with-lease`、`echo "use rm to delete files"` 等（闸门 T16/E 段 + 三棵树 sh 套件 L92/L94/L98/L103/L201/L203/L204/L94 等用例全绿）。

---

## 2. 新闸门（本卡最重要产出）

**文件**：`agent-risk-guard/packages/core/test/decision-parity.test.ts`（221 行）
写法沿用 `redact-parity.test.ts`（同目录）：ps1 用 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File <hook>` + **进程 stdin**；
sh 用 **`wsl.exe -e bash <wsl 路径>`** + 进程 stdin；缺 `powershell.exe` / `wsl.exe` 时 `t.diagnostic` + `t.skip`。

**三重合取判据**（缺一不可）：
① 输出可判读——空/纯空白 = allow；非空必须是**合法 JSON** 且带 `permissionDecision`（非法 JSON = 事故，直接红）；
② **两端 decision 完全一致**；
③ 两端还必须等于语料里钉住的 `expect`（只有 ② 会被"两端一起改错"骗过，③ 把应然语义也钉住）。
失败打印 `载荷 / ps1 / sh / 期望 / 判定` 五列。

**语料 66 条**（`DECISION_CORPUS`，导出以便复用）：
A 段 T1–T20（编排者分歧矩阵）· B 段 Q1–Q12（**T3 归一绕过面**）· C 段 C1–C22（**T5/T2 大小写绕过面**，含 `git switch -C` deny / `-c` allow 一对）·
D 段 Y1–Y10（**T9/T10 类型邻居**）· E 段 缺键/缺 tool_input（G5 fail-closed 的判定侧对照）。

**运行输出**（`_g3_gate_run.txt`）：

```
✔ decision parity: ps1 与 sh 对同一语料的 permissionDecision 必须逐条一致且等于应然 (86687.5639ms)
ℹ tests 1  ℹ pass 1  ℹ fail 0  ℹ skipped 0
exit=0
```

> 性能与稳定性（D10 记录）：66 条 × 2 端 = 132 次真实 spawn，**逐条串行**，约 **87–103s**。
> 首版曾用 `spawn` + 并发池（8）把两端并发——实测 `wsl.exe` 在并发下**间歇性**向 stdout 吐非 JSON 实例告警，
> 出现 **21/66 假红**，且总耗时并未下降（Windows 进程创建互相拖慢）。按 D10「单次全红先复跑再定罪」复跑确认是并发假红后，
> 改为串行 `spawnSync`，稳定 66/66；该教训已写进测试文件注释（L164-170），防止后来者"优化"回去。

---

## 3. 闸门捕获力变异证据（把某条改回旧行为 → 闸门必须变红）

变异体目录 `_g3_mutants/`；总表 `_g3_mutation_gate.txt`（第二轮）+ `_g3_mutation_gate_r1_naive.txt`（第一轮）。

| 变异体 | 回退了什么 | 闸门结果 | 失败用例 |
|---|---|---|---|
| **M0-preg3-full** | **整份回退到 pre-G3 主源**（`_g3_before/dangerous-commands.sh`） | **exit=1 红 ✅ 27/66** | T2 T3 T5 T9 T10 · Q1 Q2 Q6 Q11 Q12 · C1 C2 C7–C14 C16–C18 · Y1 Y2 Y3 Y7 |
| **M1-T5-case-behavior** | 回退"大小写整族"的可观测行为（裸 rm 规则 + `rm -rf` 规则 + rmseg 小写化） | **exit=1 红 ✅ 3/66** | T5 · C1 · C2 |
| **M2-T3-noquote** | 去掉空引号归一（`cmd="$cmd"`） | **exit=1 红 ✅ 6/66** | T3 · Q1 · Q2 · Q6 · Q11 · Q12 |
| **M3-T9-type-behavior** | 回退整段类型处理（null 判定 + `[string]` 转换） | **exit=1 红 ✅ 6/66** | T9 · T10 · Y1 · Y2 · Y3 · Y7 |
| **M4-T2-var-case** | 只回退 10b 变量赋值规则的 `-i` | **exit=1 红 ✅ 4/66** | T2 · C9 · C10 · C11 |
| **M5-T10-array-join** | 只回退数组拼接语义（`" ".join` → `str(v)`） | **exit=1 红 ✅ 3/66** | T10 · Y2 · Y3 |

**第一轮的诚实记录（教训，建议保留）**：首轮用「只回退**单条**规则」的写法做了 M1（裸 rm 规则回退大小写）与 M3（去掉 `null` 判定），
两者**都未变红**。查明原因**不是闸门失效**，而是 G3 的修复**彼此有冗余**：
T5 的大小写被「裸 rm」与「rm -rf」两条规则共同兜住；T9 的 null 被「缺字段」与「空串」两个分支共同兜住——
单条回退**不改变可观测判定**。故第二轮改为**按行为回退**（M1'/M3'）并补 M0「整源回退」，
红得干净且能直接定位。证据：`_g3_mutation_gate_r1_naive.txt`。

---

## 4. 红线回归（G15b / G5 / 三套 sh / parity）

| 红线 | 要求 | 实测 | 证据 |
|---|---|---|---|
| **G15b parity A/B/C** | 全绿 | **3 pass / 0 fail，exit=0** | `_g3_parity_redact.txt` |
| **G15b M4 变异**（`redact_cmd` 去掉 `redact_text` → 生产出口直通） | **仍必红** | **exit=1 红 ✅「生产出口校验失败（33 处）」** | `_g3_redline_mutants.txt` |
| **G5 sh-failclosed** | 34/34 | **34/34，rc=0** | `_g3_suites_audit.txt` / `_g3_suites_skills.txt` / `_g3_suites_xhs.txt` |
| **G5 M2 变异**（`json_escape_text` 去掉 C0 转义分支） | **仍必红** | **exit=1 红 ✅ 30/34**（TAB/CR 原样输出 → 非法 JSON） | `_g3_redline_mutants.txt` |
| **sh 四套 × 三棵树** | 67/40/192(+34) 全绿 | `67/67`、`40/40`、`34/34`、`192/192`，**rc=0 × 12** | `_g3_suites_audit.txt`、`_g3_suites_skills.txt`、`_g3_suites_xhs.txt` |
| **node 全量** | 无回归 | **tests 379 / pass 379 / fail 0，exit=0**（G5 为 378，**+1 = 本闸门**） | `_g3_node_full.txt` |
| **不得放宽既有 allow** | `git status` 等仍 allow | 三套 sh 套件全部 allow 用例绿 + 闸门 T16/C3–C5/C22/Q1/Q2/Q6/Q11/Q12/Y4–Y6/Y8–Y10 全绿 | 同上 |

**G5 五条异常路径仍 deny**：空 stdin / 非法 JSON / 缺 command / 含 TAB / 首行危险+次行 `#`（`sh-failclosed-test.sh` L70-L95，34/34 绿）。

---

## 5. 副本表（改动 → 同步 → 复核）

**ps1：零改动**，未同步（D9 无触发），仍逐份复核 BOM。

| 组 | 副本 | sha256(16) | BOM | 行尾 | 字节 |
|---|---|---|---|---|---|
| ps1 ×6 | `agent-risk-guard-audit/scripts/` · `agent-risk-guard/assets/hooks/` · `agent-risk-guard/skills/agent-risk-guard/scripts/` · `~/.claude/hooks/` · `~/.codex/hooks/` · `~/.gemini/config/hooks/` | `fb85cc0e4476ae58` ×6 | **true ×6** | LF（CRLF=0/549） | 34523 ×6 |
| sh ×3 | `agent-risk-guard-audit/scripts/` · `agent-risk-guard/skills/agent-risk-guard/scripts/` · `agent-risk-guard-audit-xhs-publish/scripts/` | `8ac7782d87b95415` ×3 | **false ×3** | LF（CRLF=0/523） | 34359 ×3 |

- **distinct sha256 = 1（ps1 六份）/ 1（sh 三份）** —— 证据 `_g3_copies_before.txt`（改动前 `7f7769f2175c6d88`）与 `_g3_copies_after.txt`（改动后）。
- 顺序遵循任务卡：**改 → 测 → 同步副本 → 复核 distinct/BOM/行尾**；三棵树各自用自己的副本跑套件（见 §4 证据文件头的 `TREE=` 与 `sha256=`）。
- `bash -n` 语法检查：`exit=0`。

---

## 6. 未解决问题 / 交下一卡

1. **两端一致但都不理想的同形残留（超出 G3 范围，须两端同改才算修复）**
   - T11 `# note\nrm -rf /tmp/t` → 两端同为 **allow**（都在"整串首字符 `#`"处短路；G5 测试 L103 亦钉住该现状）。
   - C15 `FORMAT C:`（无 `/`）→ 两端同为 **allow**（ps1 L262 要求 `format X: /`）。闸门已把它钉成"两端同判"，并在用例注释里标注为**加固候选**，避免后来者误当成"安全"。
2. **闸门耗时 ~87–103s**（66 条 × 2 端真实 spawn；PowerShell 单次启动约 1.5s）。并发优化实测会假红（见 §2 D10 记录），故保留串行。若 G3b 引入批量驱动（一条外层进程内多次调用子进程 hook + 进程 stdin），可在不违反 D6 的前提下把耗时压到 ~15s。
3. **sh 端 33 处 `-i` 的语料覆盖**：本卡为 rm/git/删除/系统工具族（即编排者实测的两条大小写分歧所在族）；其余规则族虽一并 `-i`，但闸门语料未逐族铺设。G3b 应从**单一 spec 生成三端**，从根上消除"某一端漏了某个标志位"这类漂移。
4. **G3b（本卡不做）**：三端"从单一 spec 生成"的大重构；sh 的 `xhs-publish` 树 ps1 变体（另一代 400 行，不在冻结清单）本卡未动。
5. **本卡未触碰**：脱敏规则（`-p` / `--user` / PEM 锚点）、core/ps1 判定顺序、cs 规则集。

---

## 7. 证据清单（`tasks/orchestrator/`）

| 文件 | 内容 |
|---|---|
| `_g3_div_after.txt` | 20 条分歧矩阵 after（0/20） |
| `_g3_neighbors_before.txt` / `_g3_neighbors_after.txt` | 42 条邻居面 before（22）→ after（0），三维度（引号/大小写/类型） |
| `_g3_type_probe.mjs` | command 类型基线探针（D8：17 条，用于确定"对齐 ps1 转换语义"而非"非字符串全 deny"） |
| `_g3_before/dangerous-commands.sh` | pre-G3 主源备份（D8 基线 / M0 变异源） |
| `_g3_diff.txt` | pre-G3 → G3 主源逐行 diff（+85 / −38） |
| `_g3_gate_run.txt` | 新闸门运行输出（66/66 绿） |
| `_g3_mutation_gate.txt` / `_g3_mutation_gate_r1_naive.txt` | 闸门捕获力变异（二轮行为级回退 / 一轮"不彻底回退"教训） |
| `_g3_mutants/` | 全部变异体（含 `.round1` / `.naive` 归档） |
| `_g3_redline_mutants.txt` | G15b M4（parity B 红 33 处）+ G5 M2（failclosed 30/34 红） |
| `_g3_parity_redact.txt` | parity A/B/C 3 pass / 0 fail |
| `_g3_suites_audit.txt` / `_g3_suites_skills.txt` / `_g3_suites_xhs.txt` | sh 四套 × 三棵树（67/40/34/192，rc=0） |
| `_g3_node_full.txt` | node 全量 379/379 |
| `_g3_copies_before.txt` / `_g3_copies_after.txt` | 副本 distinct / BOM / 行尾复核 |
| `_g3_patch_sh.mjs` / `_g3_mutants.mjs` / `_g3_mutation_gate.mjs` / `_g3_redline_mutants.mjs` / `_g3_diff.mjs` / `_g3_copies.mjs` / `_g3_suites.sh` | 全部可复跑的脚本 |

**新交付代码**：
- `agent-risk-guard/packages/core/test/decision-parity.test.ts`（新闸门，66 条语料）
- `agent-risk-guard-audit/scripts/dangerous-commands.sh`（sha `8ac7782d87b95415`）
- `agent-risk-guard/skills/agent-risk-guard/scripts/dangerous-commands.sh`（同步）
- `agent-risk-guard-audit-xhs-publish/scripts/dangerous-commands.sh`（同步）
