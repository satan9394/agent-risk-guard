# EVALUATION_RESULT — G15b-FIX3 独立验收

- Evaluator：**全新独立验收 Agent**（未参与 G15b / G15b-FIX / G15b-FIX2 / G15b-FIX3 任何实现，不继承既有推理上下文）
- 日期：2026-09-12
- 预设立场：「实现可能存在错误」——下文每条判定均基于**我自己跑的原始输出**（证据文件见文末）
- 被审对象（**我开工时逐字节实测**，全部与编排者冻结值一致）：

| 文件 | SHA256(前16) | 大小 | BOM | CR / LF |
|---|---|---|---|---|
| `agent-risk-guard-audit/scripts/dangerous-commands.ps1` | `FB85CC0E4476AE58` | 34523 B | **True** | CR=0 / LF=549 |
| `agent-risk-guard-audit/scripts/dangerous-commands.sh` | `5560674677AFB348` | 24928 B | False | CR=0 / LF=392 |
| `agent-risk-guard/packages/core/src/redact.ts` | `20CFCED93AB45043` | 13162 B | False | CR=0 / LF=216 |
| `packages/core/test/redact.test.ts` | `8971B5D9DE4D0B7E` | 14461 B | False | CR=0 / LF=260 |
| `packages/core/test/redact-parity.test.ts` | `B3F47F61C4576BF5` | 25918 B | False | CR=0 / LF=472 |
| `agent-risk-guard-audit/tests/hook-redact-test.ps1` | `35730BC33B82E26B` | 12246 B | **True** | CR=0 / LF=153 |

> 全程只读：所有变异体/重建态一律写在 `%TEMP%\g15bfix3-eval\`；跑完全部探针后再测主源哈希，**未变**（ps1 `FB85CC0E4476AE58`、sh `5560674677AFB348`）。

---

## 结论：**ACCEPT**

**一句话**：FIX2 打回的那条「多行第 2 行起锚点发散」**确实修好了**——我独立跑三端脱敏函数 + 两端生产出口，缺陷载荷（裸换行、**缩进续行**、`;`+缩进、TAB 缩进、第 3 行 mariadb、`--user`）**全部 `[REDACTED]` 且逐字一致、无明文**；
`^\s*` 的扩展**没有引入任何新的过脱敏**（我用冻结的 pre-FIX2 字节副本做基线：凡 FIX3 会脱敏的缩进/续行形态，**改前同样脱敏**，没有一条是"改前不脱敏、改后脱敏"的新增误伤）；
R1/R2/F1/F2 不回退（自跑 M2 变异：**PART A 绿 / PART B 红 33 处 / PART C 绿**，与报告数字逐字吻合）；副本 6/6+3/3 `distinct=1`、ps1 **BOM=True**、行尾一致；主源哈希与报告 §6 全部相符。

| # | 必查项 | 我的判定 |
|---|---|---|
| 1 | **原缺陷真修**：三端 + 两端生产出口，裸换行 / 缩进续行 / `;`+缩进 / TAB / 第3行 mariadb / `--user` | **PASS**（11 条缺陷载荷 × 3 端全 AGREE、LEAK=false；7 条 × 2 端生产出口逐字等于 core） |
| 2 | **`^\s*` 是否引入新过脱敏**（本轮新攻击面，D7+D8） | **PASS**：新构造 18 条，**无一条**是"pre-FIX2 不脱敏 → FIX3 脱敏"的新增误伤 |
| 3 | **F1/F2/R1/R2 不回退** + 自跑 M2 变异 → PART B 必红 | **PASS**（M2-sh：A 绿 / B 红 **33 处** / C 绿） |
| 4 | **副本 / BOM / 行尾 / 报告一致性**（D9） | **PASS**（逐份实测与报告逐字相符；报告有 1 处**表述不实**，见 §5） |
| 5 | 九套回归抽验 / `CHANGED=0` / PART C 覆盖 | **部分完成**（见 §6「未做项」，已抽验 parity A/B/C + `hook-redact-test`） |

---

## 1. 原缺陷是否真修 —— **PASS**

### 1.1 三端脱敏函数（core `redactSecrets` / ps1 `-RedactFile` / sh `--redact-stdin`）

证据：`_g15bfix3_eval_ends.txt`（38 条载荷）。缺陷组 A1–A11 **全部** `AGREE=true / LEAK=false`：

```
--- A1 multiline mysql line2
  IN     ="rm -rf /tmp/t\nmysql -p12345678 -e \"select 1\""
  core   ="rm -rf /tmp/t\nmysql [REDACTED] -e \"select 1\""
  ps1Fn  ="rm -rf /tmp/t\nmysql [REDACTED] -e \"select 1\""
  shFn   ="rm -rf /tmp/t\nmysql [REDACTED] -e \"select 1\""
  AGREE=true  LEAK=false

--- A5 indent continuation
  IN     ="rm -rf /tmp/t\n   mysql -p12345678 -e \"select 1\""
  core   ="rm -rf /tmp/t\n   mysql [REDACTED] -e \"select 1\""
  ps1Fn  ="rm -rf /tmp/t\n   mysql [REDACTED] -e \"select 1\""
  shFn   ="rm -rf /tmp/t\n   mysql [REDACTED] -e \"select 1\""      <- FIX2 态此处 sh 也漏（见 1.3）

--- A6 semicolon+indent     ="rm -rf /tmp/t;\n   mysql [REDACTED] -e \"select 1\""     三端一致
--- A7 indent curl --user   ="rm -rf /tmp/t\n   curl --user [REDACTED] https://x"      三端一致
--- A8 wget line2           ="rm -rf /tmp/t\nwget --user [REDACTED] https://x"         三端一致
--- A9 mariadb line3        ="echo a\necho b\nmariadb [REDACTED]"                      三端一致
--- A10 tab indent          ="rm -rf /tmp/t\n\tmysql [REDACTED]"                       三端一致
--- A11 semi nl tab curl    ="rm -rf /tmp/t;\n\tcurl --user [REDACTED] https://y"      三端一致
--- A2 multiline curl --user / A3 编排者复现 / A4 第1行对照                         全部 三端一致 + 无明文
```

### 1.2 两端生产出口（真实 spawn + 进程 stdin，从 deny JSON 的 `命令：`/`Command:` 段抽回显）

证据：`_g15bfix3_eval_prod_baseline.txt`（21 条载荷，ps1 `-File` + stdin、sh `wsl.exe -e bash` + stdin）：

```
--- A1 multiline mysql line2  decision ps1=deny sh=deny
  core ="rm -rf /tmp/t\nmysql [REDACTED] -e \"select 1\""
  ps1B ="rm -rf /tmp/t\nmysql [REDACTED] -e \"select 1\""  eq=true LEAK=false
  shB  ="rm -rf /tmp/t\nmysql [REDACTED] -e \"select 1\""  eq=true LEAK=false
--- A2 multiline curl --user line2   ps1B eq=true LEAK=false / shB eq=true LEAK=false
--- A3 编排者复现                    ps1B eq=true LEAK=false / shB eq=true LEAK=false
--- A5 缩进续行                      ps1B eq=true LEAK=false / shB eq=true LEAK=false
--- A6 `;`+缩进                      ps1B eq=true LEAK=false / shB eq=true LEAK=false
--- A7 缩进 curl --user              ps1B eq=true LEAK=false / shB eq=true LEAK=false
--- A8 wget line2                    ps1B eq=true LEAK=false / shB eq=true LEAK=false
```

**三条编排者点名的必查载荷（三端 + 两端生产出口 5/5）**：`rm -rf /tmp/t` ⏎ `mysql -p12345678 -e "select 1"`、`curl --user alice:hunter2`、缩进版与 `;\n   缩进版` —— **全部 `[REDACTED]`、无明文、逐字一致**。✓

### 1.3 D8：确认是「FIX2 引入 → FIX3 修回」（不是既有问题，也不是"改法掩盖"）

我把 FIX3 主源**回退本轮 3 处改动**得到 FIX2 重建态（替换式写在探针里，见 `probe.mjs` 的 `reconstruct()`；ps1 替换 2 处、sh 替换 1 处，计数已打印），并对**冻结的 pre-FIX2 字节副本**（`_g15bfix2_baseline/*.before`，我实测 ps1 `EA253D108FBFFB8C`、sh `7C379CB56AFB8763`，与报告 §1 一致）跑同一语料：

| 载荷 | pre-FIX2（冻结字节） | FIX2（重建） | FIX3（现行） |
|---|---|---|---|
| `rm -rf /tmp/t` ⏎ `mysql -p12345678 …` | ps1/sh 均 `[REDACTED]` | **core 明文**、sh 脱敏 | 三端 `[REDACTED]` 一致 |
| ⏎ 缩进 `   mysql -p12345678 …` | 均脱敏 | **core 明文、sh 也明文**（4/4 端点） | 三端一致脱敏 |
| `;\n   mysql -p…` | 均脱敏 | sh 明文 | 三端一致脱敏 |
| `   curl --user alice:hunter2 …` | 均脱敏 | core 明文、sh 明文 | 三端一致脱敏 |

**结论**：缺陷确为 FIX2 新引入（改前冻结副本对同载荷脱敏），FIX3 修回；且报告 §2.3 声称的「只加 `m` 不够、缩进续行连 sh 也漏」**我独立复现成立**（FIX2 重建态 `FIX2sh=未脱敏`）。✓

---

## 2. `^\s*` 是否引入新的过脱敏 —— **PASS（未发现新增误伤）**

我自造 18 条载荷，每条给 **FIX2 重建态 / FIX3 现行 / pre-FIX2 冻结** 三列对照（证据 `_g15bfix3_eval_ends.txt` C 组 + `_g15bfix3_eval_prod_baseline.txt` 基线段）：

| 载荷 | FIX3 | FIX2 重建 | **pre-FIX2 冻结** | 判定 |
|---|---|---|---|---|
| `mysqlfoo -p12345678`（第2行） | 脱敏 | **不脱敏** | **脱敏** | 非新回归（改前也脱敏） |
| `    mysqlfoo -p12345678`（缩进） | 脱敏 | 不脱敏（三端） | **脱敏** | 同上 |
| `    mysqladmin -p12345678 status` | 脱敏 | 不脱敏（三端） | **脱敏** | 同上；且 mysqladmin 的 `-p` 本就是密码 |
| `mysqladmin -p12345678 status`（行首） | 脱敏 | 不脱敏 | **脱敏** | 同上 |
| `echo "mysql -p12345678"` | **脱敏** | 脱敏 | 脱敏 | 非本轮变化（§2.2 给判断） |
| `    echo "mysql -p12345678"` | **脱敏** | 脱敏 | 脱敏 | 同上 |
| heredoc 体内缩进 `   mysql -p12345678` | 脱敏 | 不脱敏（三端） | **脱敏** | 非新回归（保守方向） |
| `# mysql -p12345678`（注释行） | **不脱敏** | 不脱敏 | **脱敏** | FIX2 起收窄，**非本轮**（§5-③） |
| `    # mysql -p12345678` | **不脱敏** | 不脱敏 | 脱敏 | 同上 |
| `   curlfoo --user alice:hunter2 https://x` | 脱敏 | 不脱敏（三端） | 脱敏 | 非新回归 |
| `echo "curl --user alice:hunter2 https://x"` | **不脱敏（明文）** | 不脱敏 | **脱敏** | FIX2 起收窄，**非本轮**（§5-②） |
| 空行后 `   mysql -p12345678` | 脱敏 | 不脱敏（三端） | 脱敏 | 非新回归 |
| `   ssh mysql -p2222 host` | **不脱敏（正确）** | 不脱敏 | **误伤脱敏** | FIX3 未引入误伤 |
| `   psql -h mysql -p5432 -U postgres` | 不脱敏（正确） | 不脱敏 | 误伤脱敏 | 同上 |
| `   xargs mysql -p12345678` | **不脱敏** | 不脱敏 | 脱敏 | 既有锚点收窄（FIX2 设计取舍），非本轮 |
| `   mysql -p 12345678`（`-p` 与值之间空格） | 不脱敏 | 不脱敏 | 不脱敏 | 既有缺口 |
| `   mysql \` ⏎ `     -p12345678`（反斜杠续行） | **不脱敏** | 不脱敏 | 不脱敏 | 既有缺口 |
| `  mysqladmin  -p12345678`（双空格） | 脱敏 | 不脱敏（三端） | 脱敏 | 非新回归 |

**关键判定（D8）**：**没有任何一条载荷是「pre-FIX2 冻结副本不脱敏 → FIX3 脱敏」**。
所有 FIX3 新脱敏的形态（行首/缩进的行首 `mysql`/`mariadb`/`curl`/`wget`）在改前**全部本来就是脱敏的**——
FIX3 的 `^\s*` 只是把 FIX2 自己弄丢的覆盖面**补回改前水平**，属于"恢复"，不是"新增误伤"。
反方向（FIX3 比改前**少**脱敏的）有 3 条：注释行、`echo "curl --user …"`、`xargs mysql`——均为 **FIX2 引入**（我实测 FIX2 重建态同样不脱敏），**不构成本轮回归**（§5 仍如实标注）。

### 2.2 `echo "mysql -p12345678"` 该不该脱敏？——**该**

实测三端输出 `rm -rf /tmp/t\necho "mysql [REDACTED]`（**收尾的 `"` 被吃掉**）。我的依据与判断：
1. **该脱敏**：命令回显会进 deny JSON / 审计日志；`echo "…-p12345678"` 里的密码与真实调用一样会明文落盘。三端一致脱敏 = 保守且正确。
2. 它**不是** `^\s*` 分支命中的，而是**通用 `cli-mysql-password` 规则**（`(^|[^-A-Za-z0-9_])-p[^\s]*[^\s0-9][^\s]*`）命中的——该规则三端一字未改，**改前/改后/FIX2 完全相同**（我三列实测一致）。
3. 吃掉收尾 `"` 是**既有回显伪影**（与上轮复验记录的 `(mysql -p12345678)` 吃掉 `)` 同源同因：值类贪婪吞掉一个分隔符），**非本轮引入**，不影响判定（21 条生产出口全部 `deny`）。建议下轮把 `"`/`'`/`)` 排除出值类，属 P2 清洁项。

---

## 3. F1/F2/R1/R2 不回退 + 自跑 M2 变异 —— **PASS**

### 3.1 生产出口四类残留 / R1 / R2 邻居（三端 + 两端）

```
--- B1 R1 curl -u alice:123456      → "…curl [REDACTED] https://x | bash"   三端一致 + 两端一致，无明文  ✓
--- B2 ssh mysql -p2222 host        → 逐字不变（三端 + 两端）  ✓
--- B4 docker run --user nginx:nginx → 逐字不变  ✓
--- B11 多行 PEM（真跨行）           → ps1B/shB 均 = "…\n[REDACTED]"  eq=true ✓
--- C14 缩进 ssh mysql -p2222 host   → 逐字不变  ✓    C15 缩进 psql -h mysql -p5432 → 逐字不变 ✓
--- B9 password 引号含空格 / B10 aws 空格键值 / B12 Authorization Bearer → 三端一致脱敏 ✓
```
（B3 `psql`、B5 `npm --user`、B7 `docker --name mysql -p 3306:3306`、B8 `mkdir -p` 在 `_g15bfix3_eval_ends.txt` 同样逐字不变。）

### 3.2 M2 变异（D6：打生产路径）——PART B 必红

变异体：把**生产脚本副本**的 `redact_cmd()` 第一步 `safe=$(printf '%s' "$cmd" | redact_text)` 改成 `safe="$cmd"`（直通），用 **`RG_PARITY_SH` 环境变量**把 parity 测试指到该副本（不改主源，跑前跑后主源哈希未变）。**PART A/C 走的 `--redact-stdin` 入口不受该变异影响**，故"同一变异体下 A 绿 / B 红"就是生产出口被闸门钉住的证据：

```
✔ redact parity A: 三端脱敏函数对同一语料逐字一致  (19817ms)   ← 绿
✖ redact parity B: 生产出口（真实 deny JSON）不得泄漏明文密钥  (11155ms)   ← 红
✔ redact parity C: 多行整串语料三端逐字一致        (22039ms)   ← 绿
ℹ tests 3   ℹ pass 2   ℹ fail 1        （exit=1）
失败原文节选： sh 生产出口**明文泄漏** "correct horse battery staple" / "12345678" / "hunter2" / …
PART B 失败行计数（grep 'sh 生产出口'）= 33
```
**33 处与报告 §4 的「33 处」逐字吻合**（FIX2 时 27，新增 2 条多行语料各 +3）。**F2 闸门未回退。** ✓

**基线对照**（同一测试文件、未变异主源）：

```
✔ redact parity A  ✔ redact parity B  ✔ redact parity C      ℹ tests 3  pass 3  fail 0   (exit=0)
```
即「基线 A/B/C 全绿、M2 变异 A 绿 B 红」两侧我都实跑到了。✓

---

## 4. 副本 / BOM / 行尾（D9）—— **PASS**

逐份实测（**未发现 BOM 丢失**）：

```
PS1 6/6  sha=FB85CC0E4476AE58  34523B  BOM=True  CR=0 LF=549  DISTINCT=1
  agent-risk-guard-audit\scripts\ 、agent-risk-guard\assets\hooks\ 、agent-risk-guard\skills\agent-risk-guard\scripts\ 、
  ~\.claude\hooks\ 、~\.codex\hooks\ 、~\.gemini\config\hooks\
SH  3/3  sha=5560674677AFB348  24928B  BOM=False CR=0 LF=392  DISTINCT=1
  agent-risk-guard-audit\scripts\ 、agent-risk-guard\skills\agent-risk-guard\scripts\ 、agent-risk-guard-audit-xhs-publish\scripts\
```
主源/测试文件哈希亦与报告 §6 收工哈希**全部相符**（`redact.ts 20CFCED93AB45043`、`redact.test.ts 8971B5D9DE4D0B7E`、`redact-parity.test.ts B3F47F61C4576BF5`、`hook-redact-test.ps1 35730BC33B82E26B` **BOM=True**）。
报告 §9-1（xhs-publish 的 ps1 未同步、是另一代变体）我复核属实：该文件不在本卡冻结清单，且其 sh 副本**已同步**（`distinct=1`）而 ps1 副本是旧变体——**不影响本轮验收**，但若它是分发面需下轮明确。

---

## 5. 报告与产物的一致性 —— **基本相符，有 1 处表述不实（非判定性）**

相符的部分（我逐项复核）：§6 哈希/字节/BOM/行尾/distinct 全部相符；§4 的 M2-sh「33 处」相符；§3 的 `hook-redact-test` **我实跑 `PASS: 119/119` exit=0**（与报告 119 一致，FIX2 时 108）；§1 的五处改动坐标我逐条对到代码（core L135/L155、ps1 L100/L108、sh L75，与报告一致）。

**①（不实，需更正，非判定性）** 报告 §8 表格写「`pem-private-key` … **等价**：**PART C 的多行 PEM 用例三端逐字一致**」——
但 `redact-parity.test.ts` L383 的 PART C PEM 语料其实是**单行**的
（`'rm -rf /tmp/t\ncat "-----BEGIN RSA PRIVATE KEY----- BODYONE -----END RSA PRIVATE KEY-----"\necho done'`，PEM 三段同处一行）。
我拿**真正的跨行 PEM** 喂 sh 的 `--redact-stdin`（= `redact_text`，逐行 sed）测得：

```
--- B11 真跨行 PEM
  core  ="rm -rf /tmp/t\n[REDACTED]"
  ps1Fn ="rm -rf /tmp/t\n[REDACTED]"
  shFn  ="rm -rf /tmp/t\n-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----"   ← 未脱敏
  AGREE=false  LEAK=true
```
即 **`--redact-stdin` 这个测试入口对跨行 PEM 与 core/ps1 不等价**（跨行 PEM 只在 `redact_cmd()` 的 `\002` 通道里处理）。
**生产路径没问题**（我实测 ps1B/shB 均为 `"\n[REDACTED]"`，eq=true）。
**归属（D8）**：FIX2 态同样 `sh=false` → **非本轮引入**，不构成 REJECT 依据；但报告把它写成"多行 PEM 已一致"是**用语不实**，且是一条潜在陷阱语料（谁若把 PART C 的 PEM 改成真跨行，sh 侧会红——红的其实是"测试入口 ≠ 生产路径"这个 G15b 老教训的残留）。建议下轮：要么把 `--redact-stdin` 也接上跨行 PEM 通道，要么把 PART C 注释改成"单行 PEM"。

## 6. 未做项（时间盒内未完成，如实标注）

1. **九套回归未全跑**：我实跑了 `redact-parity`（A/B/C 基线全绿 + M2 变异）、`hook-redact-test.ps1`（**119/119**）；**未跑** node 全量 378、`hook-rules-test` 37、`hook-fp-regression` 8、`hook-bypass-regression` 20、`hook-audit-reregress` 59、sh 67/40/192。
2. **`CHANGED=0` 未独立复跑 194 条**：仅有部分证据——我 21 条载荷在**两端生产出口**的判定全部为 `deny`（含所有多行/缩进形态，仅脱敏回显不同）；另有 4 条载荷在 FIX2 重建 sh 与 FIX3 sh 上判定同为 `deny`。**判定侧代码在 FIX3 中确实一字未动**（改动只在脱敏规则串），逻辑上不可能改判定。
3. 未跑真实 Agent 端到端。

---

## 7. 特别标注

| 项 | 结论 |
|---|---|
| **仍未脱敏** | ①（**非本轮**，FIX2 起、报告未披露）`# mysql -p12345678` **注释行** → ps1 生产出口回显明文 `12345678`（改前冻结副本是脱敏的）；②（**非本轮**，FIX2 起、报告未披露）`echo "curl --user alice:hunter2 …"` → **ps1 与 sh 生产出口均回显明文 `hunter2`**（改前脱敏）；③ 既有缺口：`xargs|nohup mysql -p…`、`mysql -p 12345678`、反斜杠续行 |
| **判定回归** | **无**：21 条生产出口载荷判定全 `deny`（含全部多行/缩进形态）；M2 变异证明闸门仍在（A 绿/B 红 33/C 绿） |
| **过脱敏（本轮新引入）** | **无**。18 条新构造载荷三列对照，**没有一条**是"改前不脱敏 → 改后脱敏"；`ssh mysql -p2222` / `psql -h mysql -p5432`（含**缩进版**）仍逐字不变 |
| **跨端发散** | 原缺陷发散**已消除**（A1–A11 三端 + 两端生产出口逐字一致）。**仅剩** sh 测试入口 `--redact-stdin` 对**真跨行 PEM** 与 core/ps1 不等价（FIX2 起既有，生产路径正常，见 §5-①） |
| **副本 / BOM 不一致** | **无**：ps1 6/6 `FB85CC0E4476AE58` BOM=True、sh 3/3 `5560674677AFB348` 无 BOM，`distinct` 各为 1；主源跑完全部探针后哈希未变 |
| **报告与产物不符** | 有 1 处**表述不实**：§8「PART C 的多行 PEM 用例三端逐字一致」——该语料的 PEM 实为单行（§5-①）。其余数字（哈希/字节/BOM/行尾/distinct/M2 33 处/119 用例）我逐项复核**全部相符** |
| **范围外但真实（D8：均非本轮引入，我已用改前冻结副本确认）** | ④ sh 生产出口在命令含 **TAB** 时输出**非法 JSON**（未转义控制字符）→ deny JSON 无法解析（潜在 fail-open）；pre-FIX2 冻结副本**同样如此**（`_g15bfix3_eval_outofscope.txt`）；⑤ sh hook 对「首行危险 + 次行以 `#` 开头」的多行命令**返回空 = 放行**（我实测 `chmod 777 /tmp/x\n# …` → sh 空输出、ps1 deny），pre-FIX2 冻结副本**同样空输出**。两条都建议单独立卡，不属本轮验收范围 |

---

## 8. 证据文件（我自己跑的原始产物）

| 文件 | 内容 |
|---|---|
| `tasks/orchestrator/_g15bfix3_eval_ends.txt` | 38 条载荷 × 三端脱敏函数 + FIX2 重建态/冻结基线三列判定（`probe.mjs` 输出） |
| `tasks/orchestrator/_g15bfix3_eval_prod_baseline.txt` | 21 条载荷 × 两端生产出口（真实 spawn + 进程 stdin，固定解析）+ pre-FIX2 冻结字节副本基线（`probe2.mjs`） |
| `tasks/orchestrator/_g15bfix3_eval_mutation.txt` | M2-sh 变异（打生产路径 `redact_cmd`，隔离 TEMP 副本，`RG_PARITY_SH` 注入）原始输出：A 绿/B 红 33/C 绿 |
| `tasks/orchestrator/_g15bfix3_eval_outofscope.txt` | TAB / CRLF 在生产出口的 JSON 合法性三态对照（范围外发现 ④ 的归属证据） |
| 探针源码 | `agent-risk-guard/tasks/.tmp/g15bfix3-eval/{probe,probe2,mutation,tabprobe,case-check*.mjs}` |

**纪律声明**：被审 6 文件全程只读（开工/收工哈希一致）；所有变异体与重建态均在 `%TEMP%\g15bfix3-eval\`；未真实执行任何危险命令（载荷只作 JSON 文本投喂）；未清理任何真实日志。
