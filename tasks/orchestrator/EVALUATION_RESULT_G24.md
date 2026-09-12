# EVALUATION_RESULT — G24（独立验收）

- 切片：**G24 — ps1 rule 16 的 help/version 豁免粒度**
- 被验对象：**未提交**的工作树（repo HEAD = `7835a58`；4 个已跟踪文件为 ` M`，+51/−4）
- 验收轮：2026-09-12 · **独立 Evaluator（隔离上下文，未参与实现，未派生任何 Subagent）**
- 约束：Evaluator **只读**产品树；变异体与探针脚本一律写在 `%TEMP%\g24_eval\`；**未修改任何产品文件**

## 裁决

**PASS** —— 「主动尝试攻破而未成功」。全部 45 条行为差异**都是 allow→deny 的收紧**，**没有一条放松**。

---

## 1. 从 diff 自行推导的改动集

```
git -C agent-risk-guard rev-parse HEAD   → 7835a5874846ad58846d1cb6ba5613d57c56f2b4
git -C agent-risk-guard status --porcelain → 恰好 4 个已跟踪 " M" 文件
git -C agent-risk-guard diff --stat        → 4 files, 51 insertions(+), 4 deletions(-)
git -C agent-risk-guard diff --check       → exit 0（无空白错误）
git -C agent-risk-guard diff --stat --ignore-all-space → 统计完全相同（无纯空白改动）
```

diff 内容**只有** rule 16 与新增测试段：

- canonical ×2：`-if (($cmd -match (…)) -and ($cmd -notmatch (…)))` → `+if ($cmd -match ($CMD_PRE + 'rm(?!\s+(?:-h|--help|--version|-V)\b)(?:\s+|["'']?\s*-\s*)')) {`，另加 6 行说明注释（+7/−1，单 hunk）
- universal：同一变换（无 `CMD_PRE`，+3/−1，单 hunk）
- 测试文件：头部注释 1 hunk + 新增 M 段（+34/−1，2 hunk）

无杂散改动、无行尾/空白翻动。

## 2. 两端语义（Evaluator 自建载荷，进程级喂 stdin）

harness：`powershell.exe -NoProfile -ExecutionPolicy Bypass -File <ps1>` 与 `wsl.exe -e bash /mnt/e/...`；
stdin 为 `{"tool_name":"Bash","tool_input":{"command":"…"}}`；空 stdout = allow，否则解析
`hookSpecificOutput.permissionDecision`。先做冒烟确认管线可用。

| 载荷族 | 新 ps1 | 旧 ps1（自建变异体） | sh |
|---|---|---|---|
| `rm --help; rm /tmp/t`（点名） | **deny** | allow | **deny** |
| `-h/--version/-V/-v/-H/--HELP` 各标志 | deny | allow | deny |
| `&&` / `\|\|` / `\|` / 换行 分隔 | deny | allow | deny（换行分隔除外，见 §5） |
| `sudo` / `/usr/bin/rm` / 空引号 / 大写 / `time` 前缀 | deny | allow | deny |
| `;echo x;` / `cmd /c` / `env FOO=bar` / `command` 前缀 | deny | allow | deny |
| **纯 help 调用（20 条变体）** | **allow 20/20** | allow | allow |
| **邻居/散文（15 条：`git commit -m "rm --help"`、`echo "use rm --help"`、`grep -rn "rm --help"`、`printf '%s' 'rm --help'`、`sudorm --help`、`charm --help`、`firmware`、`rm` 单字等）** | **allow 15/15** | allow | allow |
| `rm --helpful /tmp/t`、`rm --helpx; rm /tmp/t`、`rm -- --help` | deny | deny | deny |

旧规则变异体（在 `%TEMP%` 中仅改那一行，616 行 vs 616 行逐行比对**只有 1 行不同**，BOM 保留）
**精确复现了报告的洞**：它放行点名载荷，而 sh 拒绝。

## 3. 决定性检查：不得放松（D12）

对 **312 条载荷**做 old-rule vs new-rule 决策差 —— 211 条 `DECISION_CORPUS` + 20 条 `IDENTITY_CORPUS`
（从测试文件解析，stub 掉 `node:test`）+ 81 条 Evaluator 自建：

```
payloads exercised            : 312
old-rule vs new-rule diff rows: 45
  ALLOW->DENY (tightening)    : 45
  DENY->ALLOW (RELAXATION)    : 0      ← 关键
```

45 条差异（全部 allow→deny；含语料内 M1–M9 与自建 X01–X28、Z03–Z10）：包括不同标志（`-h/-v/-H/--HELP`）、
不同分隔符（`;` `&&` `||` `|` 换行）、不同前缀（`sudo` 绝对路径 空引号 大写 `time` `env FOO=bar`
`command` `cmd /c`）、包装（子 shell `( )`、块 `{ }`、`if…then…fi`）、多 help 连用，以及**反向顺序**
`rm /tmp/t; rm --help`（sh 侧仍 allow —— 既存 sh 缺口，非本切片引入）。

**同法验证 universal**：自建 universal 旧规则变异体 → 81 条载荷、**23 条差异、23 条收紧、0 条放松**。

结构性佐证（§2 已述）：`C ⇒ A` 且前瞻与豁免子句用同一标志集与 `\b`，故 `A ∧ ¬B ∧ ¬C` 不可满足。

## 4. 未过拦

- **0 条放松** ⇒ 没有任何命令由 deny 变 allow。
- 语料 **211/211** 条 `new ps1 == expect`，无一条原本合规的放行被改为 deny。
- 45 条收紧行**无一**是纯 help 或散文形态，每一条都含**第二处未被保护的 `rm <path>`**。
- 20 条纯 help 与 15 条邻居载荷在新旧两侧决策**完全相同**（allow→allow）。

## 5. 项目自带套件（Evaluator 亲跑）

| 套件 | powershell.exe 5.1 | pwsh 7.6.6 |
|---|---|---|
| hook-rules-test.ps1 | exit 0，37/37 | exit 0，37/37 |
| hook-bypass-regression.ps1 | exit 0，18/18 | exit 0，20/20 |
| hook-fp-regression.ps1 | exit 0，8/8 | exit 0，8/8 |
| hook-audit-reregress.ps1 | exit 0，PASS: 59/59 | exit 0，PASS: 59/59 |
| hook-redact-test.ps1 | exit 0，PASS: 119/119 | exit 0，PASS: 119/119 |

sh 四套（WSL2 6.6.87.2）：`sh-hook-test.sh` **67/67**、`sh-audit-edge.sh` **40/40**、
`sh-audit-bypass.sh` **192/192**、`sh-failclosed-test.sh` **34/34**，均 exit 0。

Node 闸门（repo 根）：`decision-parity.test.ts` → **exit 0，tests 2 / pass 2 / fail 0**（251 s）；
`redact-parity.test.ts` → **exit 0，tests 3 / pass 3 / fail 0**（35 s）。
（计数一律读套件自报汇总，不使用 `/FAIL/` 文本匹配 —— `writefail` 用例名会造成假阳性。）

以上数字与 `IMPLEMENTATION_RESULT_G24.md` §5 及恢复报告附录**逐项吻合**，含 bypass 套件
在 5.1 为 18/18、在 7.x 为 20/20 的引擎差异。

## 6. 新闸门的变异测试（闸门是否自证式）

```
RG_PARITY_PS1=<旧规则变异体> node --test …/decision-parity.test.ts
  → exit 1，189 s，报「跨端判定不一致（共 9 / 211 条）」
  → 失败的 9 行**恰好是 M1…M9**（ps1=allow / sh=deny / expect=deny）
  → M10…M15 未出现在失败列表 = 保持绿
  → 第二个 test（跨端身份断言）pass 1 / fail 1，身份段仍绿
```

**闸门是真的，不是自证式**：对旧规则变红、对新规则全绿。

反向守卫也是真的：Evaluator 另造第二个变异体 —— 保留旧 `A` 子句但**整体删除豁免**（即「粗暴过拦」式修法）
→ `RG_PARITY_PS1=<无豁免变异体>` 跑闸门 **exit 1、16 行红，M10…M15 全部在红名单内**
（另有 T3、Q1、Q2、Q6、Q11、Q12、C3、C4、C5、Y4），而 M1–M9 在该变异体下保持绿。
直接探针复现：`rm --help/-h/--version/-V`、`sudo rm --help`、`/usr/bin/rm --help` 在无豁免变异体下为
**deny**，在交付版下为 **allow**。

`expect` 值由**未被修改的 sh 端**独立佐证：全 211 条语料 `sh == expect` **211/211**（0 处不符），
其中 M1–M9 由 sh 独立 deny、M10–M15 由 sh 独立 allow。

## 7. 分发面一致性（Evaluator 逐份自算哈希）

```
canonical ×6 : audit/scripts、repo/assets、repo/skills、~/.claude/hooks、~/.codex/hooks、~/.gemini/config/hooks
   41948 B，BOM=true，0 CRLF / 615 LF，6/6 同哈希
   sha256 = 9889f367f29447563970ef3bac55d19e0370f6a63b16af00c94c8bae04c17478
universal ×2 : audit/scripts、repo/skills
   17887 B，BOM=true，356 CRLF / 0 裸 LF，2/2 同哈希
   sha256 = ac566be720a9006c10f28819cb888517ef40d990d5095a947af8ce923d8054b7
```

canonical 各副本与主源逐字节相同；universal 两份相同；8 份 BOM 全保留；
canonical 为纯 LF；universal **保持了原有的 CRLF（356 处、0 处裸 LF）—— 没有整文件行尾重写**。
仓库外仅 3 个真实部署面（`~/.claude`、`~/.codex`、`~/.gemini`），3 个全部已更新。

## 8. 报告准确性（附录「附：G24 执行记录」）

逐项复现成功：canonical 前 `4dfe66cb2e310933`/41329 B → 后 `9889f367f2944756`/41948 B；universal 前
`13feb6cca3571090`/17685 B → 后 `ac566be720a9006c`/17887 B（Evaluator 从 LF blob 重建 354 处 CRLF
得到同一前值哈希）；「每文件 1 hunk、canonical +7/−1、universal +3/−1」「M 段 15 条 +34/−1」；
变异体与 HEAD blob **逐字节相同**（`4dfe66cb2e310933…`）且闸门恰报 M1–M9 红 / M10–M15 绿；
ps1 五套双引擎计数、sh 四套计数、parity 2/2 与 redact 3/3；32 条探针的 11/32→2/32、发散 10→4；
§E.3 的 xhs drift 行号（L200 / L175）**完全一致**。

**未能完全复现的声明（1 条，经判定为非实质性）**：附录 §B/§D 写「8 份 ps1，distinct=1」。
字面上存在 **2 个**不同哈希（canonical 6 份 + universal 2 份）。紧邻的表格把两个哈希都写对了，
故其**本意**（同一角色内无发散）成立且已被独立确认。已按此更正措辞。

## 反例

**安全方向上没有反例**：未发现任何「因 G24 而 ps1 放行、sh 拒绝」的载荷，也未发现任何 DENY→ALLOW 差异。

以下是「ps1 比 sh 宽」但**经旧规则变异体确认非本切片引入**的形态（均无害：GNU `rm --help` 打印帮助即退出）：

| 载荷 | 新 ps1 | 旧 ps1 | sh | 判定 |
|---|---|---|---|---|
| `rm --help;` | allow | allow | deny | 既存，非 G24 回归 |
| `rm --help ; ` | allow | allow | deny | 既存 |
| `rm --help extra` | allow | allow | deny | 既存（已登记） |
| `rm --help 2>&1` | allow | allow | deny | 既存 |
| `sudo rm --help;` | allow | allow | deny | 既存 |
| `rm -help` | deny | deny | deny | Evaluator 初始预期有误；两端一致 |

根因（实测非猜测）：sh 的 `rmseg` 抽取是 `sed -nE "s#.*${CMD_PRE}rm[[:space:]]*([^;&|]*)#\7#p"`，
sed 只替换**命中的前缀**，实参组之后的残留会被拼接回来（`rm --help ; ` → rmseg `--help ;`），
而 `case` 要求实参**逐字**等于 `-h|--help|-v|--version`。

## 残留问题（超出 G24 范围，未修，仅登记）

1. **sh 侧掩蔽缺口**（ps1 更严，方向安全）：多行 `rm --help`⏎`rm <path>` 与反向顺序 `rm <path>; rm --help`
   —— sh allow / ps1 deny。已登记于闸门头部与恢复报告 §E.1。
2. **既存 ps1 更宽类**：help 调用**带残留 token** 的形态（`rm --help;`、`rm --help extra`、`rm --help 2>&1`）；
   目前只登记了 `extra` 一例。
3. `dangerous-commands-universal.ps1` **无 `sudo` / 绝对路径前缀支持**（canonical 与 sh 在 G3-FIX5/A 已补）：
   `sudo rm --help; sudo rm /tmp/t`、`/usr/bin/rm --help; /usr/bin/rm /tmp/t`、`rm --help`⏎`sudo rm /tmp/t`
   在该文件下 allow，在 canonical + sh 下 deny。既存（旧 universal 同样 allow），且无套件覆盖该文件。
4. 工作区内 **16 份 ps1 副本**仍含旧 rule 16 文本 —— 历史证据树（`_g15_tree_*`、`.eval-tmp/*`、`_eval_g4`、
   `_eval_g15`）加 2 份已登记的 xhs-publish 快照。
5. sh 的 `rmseg` 残余后缀行为是可修的真实脆弱点，值得单独立卡。
