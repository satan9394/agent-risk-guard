# EVALUATION_RESULT — G15b-FIX 独立验收（D1 接线与闸门复验）

- Evaluator：全新独立验收 Agent（**未参与 G15b / G15b-FIX 实现**，不继承任何既有推理上下文）
- 日期：2026-09-11
- 预设立场：「实现可能存在错误」——下文所有判定均基于**我自己跑的原始输出**（证据目录见 §13）
- 被审对象（冻结值，我在开工与收工时各测一次，**两次一致、未被我改动**）：

| 文件 | SHA256(前16) | 大小 | BOM | CR / LF |
|---|---|---|---|---|
| `agent-risk-guard-audit/scripts/dangerous-commands.sh` | `7C379CB56AFB8763` | 22096 B | 无 | CR=0 / LF=366 |
| `agent-risk-guard-audit/scripts/dangerous-commands.ps1` | `EA253D108FBFFB8C` | 31538 B | 是 | **CR=0** / LF=526 |
| `agent-risk-guard/packages/core/src/redact.ts` | `6C7B1B1C4344B1F5` | 9385 B | 无 | LF |
| `agent-risk-guard/packages/core/test/redact-parity.test.ts` | `28615F954D10C256` | 15552 B | 无 | LF |

环境：Windows 11；pwsh 7.6.6；Windows PowerShell 5.1（`C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe`）；WSL2 Ubuntu / bash 5.2.21；node v24.14.0。

---

## 结论：**REJECT**

**一句话**：本轮把上轮 REJECT 的两个 P0（F1 生产出口接线 / F2 闸门钉住生产出口）**真修好了，我独立复现通过**；
但修复**自身新引入了一处明文泄漏回归**（`curl -u alice:123456` 这类全数字口令，G15b 是脱敏的，本轮起泄漏）
和**一类新的过度脱敏**（`--user name:name`、`mysql` 上下文里的**端口** `-p<digits>`，且在生产路径上会**跨行**命中），
外加报告 §7 一处与产物不符的事实陈述（ps1 行尾）。按「过度脱敏不可接受」与「报告必须与代码一致」两条既有原则，
本轮不通过。

> **必须先说清楚**：这不是「D1 还没修」。D1/F1/F2 **确实修好了**（§2/§3），本轮的 REJECT 依据是**新引入的缺陷**（§4/§5/§8）。
> 修复面很小（两条规则写法 + 一处报告更正 + 语料补 4 条），修完可快速复验。

| # | 必查项 | 我的判定 |
|---|---|---|
| 1 | **D1** sh 生产出口四类残留不泄漏 | **PASS**（两端 4/4 脱敏，我自跑实证） |
| 2 | **D2** parity 钉住生产出口（变异必红） | **PASS**（我的 M2：PART A 绿 / PART B 红；还原绿） |
| 3 | **过度脱敏**（重点） | **FAIL**（本轮**新引入** 3 类；另确认 1 类为既有） |
| 4 | 仍存在的泄漏 | **FAIL**（1 条为**本轮新引入的回归**；2 条为既有） |
| 5 | ps1 `<no-Command-segment>` 定性 | **探针问题**（ps1 生产路径实测 PASS；附一条环境相关的既有隐患） |
| 6 | 副本 / BOM / 行尾 | **PASS（副本）** + **FAIL（报告 §7 的「CRLF」陈述与产物不符）** |
| 7 | 报告与代码一致性（§10 逐条） | **基本 PASS**，1 处事实错误（§7）+ 1 处结论过宽（§3.1 M1）+ 1 处陈旧注释 |
| 8 | 判定零改动（CHANGED=0） | **PASS**（我自跑 56 条 `CHANGED=0`，跨 G15 终版→FIX） |
| — | 回归套件 | **PASS**（node 373/373；ps1 37/8/20/59/97；sh 67/40/192） |

---

## 1. 方法与纪律

- **只读**：未修改任何被审文件（开工/收工两次哈希一致，见上表；所有变异都在 `.tmp` 隔离副本上做）。
- **真实 spawn + 进程 stdin**：所有生产出口探测都用 `spawnSync('powershell.exe'|'wsl.exe', …, { input: <JSON> })`，
  **不是**同进程管道、**不是** `-Cmd` 捷径。原始载荷只作为 JSON 文本投喂，**从未真实执行任何危险命令**。
- **未清理任何真实日志**（`%TEMP%\riskguard-hook-calls.log` 未触碰）。
- 未照抄上一轮 `tasks/.tmp/g15bfix/` 的任何判定；`prod-verdicts.csv` / `out-*.txt` 仅作参照（§6 我复跑并纠正了其 ps1 结论）。

---

## 2. D1（sh 生产出口四类残留）—— **PASS**

自跑：`node d1-prod.mjs`（脚本 `probe-lib.mjs` + `d1-prod.mjs`，真实 spawn，JSON 走进程 stdin，从 **deny JSON** 里搜明文）。

sh 生产出口实测（`dangerous-commands.sh`，27 条）：

```
[OK] D1-aws-space   in =aws configure set aws_secret_access_key TESTFIXTUREsecretVALUE0000000000000000; rm -rf /tmp/t
                    out=aws configure set [REDACTED]; rm -rf /tmp/t
[OK] D1-quoted-sp   in =rm -rf /tmp/t --password="correct horse battery staple"
                    out=rm -rf /tmp/t --[REDACTED]
[OK] D1-mysql-p     in =mysql -pSup3rS3cret -e "select 1"; rm -rf /tmp/t
                    out=mysql [REDACTED] -e "select 1"; rm -rf /tmp/t
[OK] D1-curl-u      in =curl -u alice:hunter2 https://example.com; rm -rf /tmp/t
                    out=curl [REDACTED] https://example.com; rm -rf /tmp/t
```

**四类残留（点名的 space-separated AWS / quoted-with-space / `mysql -p` / `curl -u`）在 sh 的真实 deny 输出里
全部搜不到明文**，且均出现 `[REDACTED]`。F3（`--user`）、F4（`mysql -p12345678`）同样 PASS。

代码核对：`redact_cmd()` L176–185 = `tr '\n' ' '` → `redact_text` → JSON 转义；`deny_command()` L190 调它（唯一出口）。
上轮 D1 的成因（旧 2 条 sed 未接线）已消除，且**旧实现里的 GNU-only `sed …/I` 已删除**。

---

## 3. D2（parity 是否钉住生产出口）—— **PASS**（决定性）

自做变异（隔离副本，主源零写入；锚点命中校验在脚本内）：

```
node make-mutants.mjs
  M2-sh-passthrough.sh      orig=7c379cb56afb8763  mutant=0fdb9a9bdba8d09a  22022 B
  M1-sh-drop-github-pat.sh                          mutant=a20f24db1f4fc953  22028 B
  M2-ps1-passthrough.ps1     orig=ea253d108fbffb8c  mutant=6ee091d58aa2d4c0  31534 B
```

跑法（`RG_PARITY_SH` / `RG_PARITY_PS1` 覆盖被测端）：
`node --test packages/core/test/redact-parity.test.ts`（cwd = `agent-risk-guard`）。

| 运行 | exit | PART A（脱敏函数） | PART B（生产出口） |
|---|---|---|---|
| **基线（原始 sh/ps1）** | **0** | ✔ 绿 | ✔ 绿 |
| **M2：只把 sh `redact_cmd()` 改直通**（`redact_text` 原封不动） | **1** | **✔ 绿** | **✖ 红（21 处）** |
| M2：把 ps1 `Redact-Secrets` 改直通 | 1 | ✖ 红（16 处） | ✖ 红（21 处） |
| M1a：删 sh `redact_text` 的 `github-pat` 规则 | **0** | ✔ 绿 | ✔ 绿 ← 见下 |

M2-sh 的关键一行（这正是上轮 REJECT 的成因，现在被捕获了）：

```
✔ redact parity A: 三端脱敏函数对同一语料逐字一致（core === ps1 === sh）
✖ redact parity B: 生产出口（真实 deny JSON）不得泄漏明文密钥
  AssertionError: 生产出口校验失败（21 处）:
  sh 生产出口**明文泄漏** "correct horse battery staple"
  sh 生产出口**明文泄漏** "TESTFIXTUREsecretVALUE/K7MDENG"
  sh 生产出口**明文泄漏** "12345678" …
```

**判定：F2 成立。** 直接证据是「**同一个变异体下 PART A 绿、PART B 红**」——
上轮原闸门（只有 PART A）在这种情形下恒绿，现在会红。还原（=我从未改动主源，基线那次就是原件）后绿（exit=0）。

**附带发现（对报告 §3.1 的保留意见）**：我的 M1a（删 sh 的 `github-pat` 规则）**没有变红**。
原因经我实测确认——该语料里的 token 恰好 40 字符，被更靠后的 `long-random`（`[A-Za-z0-9_-]{40,}`）同样替换，
三端输出仍然逐字一致：

```
in      =git clone https://ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@github.com/o/r.git
core    =git clone https://[REDACTED]@github.com/o/r.git
M1a(删gh)=git clone https://[REDACTED]@github.com/o/r.git   ==core: true  ← 变异不可检测（被 long-random 掩盖）
M1b(删aws-space)=aws configure set aws_secret_access_key TESTFIXTUREsecretVALUE/… ← 可检测
```

即：报告 §3.1 的「M1：`redact_text` 删一条模式 → PART A FAIL」**只对部分规则成立**（他们删的应是 `aws-space`）。
这不是本轮 REJECT 依据（闸门目的已达成），但报告该行应补上这个边界，不应写成通则。

---

## 4. 过度脱敏（重点）—— **FAIL：本轮新引入 3 类**

方法：`node over-redact.mjs`（直接跑 canonical `redactDetails`，因为三端规则已同序同名，core 即代表三端）
+ `node d1-prod.mjs`（生产出口真实 spawn 复核）。基线用「按 G15b 报告 §3.2 逐字记录的旧规则重建」的 G15b-sim
（**G15b 原始二进制已不存在**——六份 ps1/三份 sh 已被本轮全量重新同步覆盖，故只能文档级+重建级比对，此点在 §5 一并标注）。

### 4.1 本轮**新引入**的过度脱敏（G15b-sim 不脱敏，FIX 脱敏）

| # | 输入 | FIX 输出 | 命中规则 | 性质 |
|---|---|---|---|---|
| X8 | `ssh mysql -p2222 host` | `ssh mysql [REDACTED] host` | `cli-mysql-password-numeric` | **把端口号当密码脱敏** |
| X9 | `ssh mysql-prod -p2222` | `ssh mysql-prod [REDACTED]` | 同上 | 同上 |
| X10 | `psql -h mysql -p5432 -U postgres` | `psql -h mysql [REDACTED] -U postgres` | 同上 | 同上（DB 主机就叫 mysql，很常见） |
| X12 | `docker run --user nginx:nginx nginx` | `docker run [REDACTED] nginx` | `cli-basic-auth` | **把 docker 的 `user:group` 当口令脱敏** |
| X6 | `npm install --user alice:hunter2` | `npm install [REDACTED]` | `cli-basic-auth` | 脱敏 `--user` 非认证上下文，且**吞掉结尾 `;`** |
| X7 | `chown --user alice:hunter2 f` | `chown [REDACTED] f` | 同上 | 同上 |

生产出口真实 spawn 复核（sh 与 ps1 **两端同病**，故 parity 的「三端一致」断言**看不见**这类问题）：

```
[OVER] X-ssh-mysqlhost  in =ssh mysql-prod -p2222
                        out=ssh mysql-prod [REDACTED]
[OVER] X-psql-h-mysql   in =psql -h mysql -p5432 -U postgres
                        out=psql -h mysql [REDACTED] -U postgres
[OVER] X-npm-user-colon in =npm install --user alice:hunter2
                        out=npm install [REDACTED]      ← 结尾 `;` 被值类 [^\s]* 一起吃掉了
```

**根因**：F4 的上下文限定 `(mysql|mariadb)([^;&|\n]*)(\s)-p[0-9]+` 只要求**同一命令段里出现过 mysql 这个词**，
没有任何「这个 `-p` 属于 mysql 这次调用」的约束，于是 `ssh <名叫 mysql 的主机> -p2222`、`psql -h mysql -p5432` 全部命中。
F3 同理：把「密码段须含非数字」的守卫加在了 `-u|--user` 的**共用分支**上，只管住了数字型 `--user 1000:1000`，
却让 `--user name:group` 全面命中。

### 4.2 **生产路径（先折叠换行）独有的跨行过脱敏**

`redact_cmd()` 先 `tr '\n' ' '`，于是 F4 正则里 `[^;&|\n]*` 的 `\n` 排除在生产中**形同虚设**，
同一个 `-p` 会被**别的行**的 `mysql` 拖下水；而 ps1 不折叠，所以**两端在同一份多行命令上结果发散**：

```
in ="mysql -e \"select 1\"\nssh host -p2222\nrm -rf /tmp/t"
  sh  out="mysql -e \"select 1\" ssh host [REDACTED] rm -rf /tmp/t"     ← 脱敏了别的命令的端口
  ps1 out="mysql -e \"select 1\"\nssh host -p2222\nrm -rf /tmp/t"        ← 未脱敏

in ="echo mysql\npsql -p5432 -U postgres\nrm -rf /tmp/t"
  sh  out="echo mysql psql [REDACTED] -U postgres rm -rf /tmp/t"
  ps1 out="echo mysql\npsql -p5432 -U postgres\nrm -rf /tmp/t"
```

现有 parity 语料**全是单行**（PART A 28 条 / PART B 7 条），因此这条跨端发散**不被任何闸门覆盖**。

### 4.3 前一轮点名的可疑项：我的复核结论（与指令里的预期略有出入）

| 指令点名项 | 我的实测 | 定性 |
|---|---|---|
| `docker run --name mysql -p 3306:3306 mysql` | **逐字不变**（`-p` 后有空格 → 两条规则都不命中） | 无问题 |
| `docker run -d --name mysql -e MYSQL_ROOT_PASSWORD=x mysql:8` | `… -e MYSQL_ROOT_[REDACTED] mysql:8` | **可接受**：`PASSWORD=x` 本就是口令赋值（上一轮探针里写成无空格 `-p3306:3306` 才是过度脱敏） |
| `npm install --user foo` / `chown user:group f` | **逐字不变** | 无问题（F3 要求值内含 `:`，故不命中） |
| `docker run --name mysql -p3306:3306 mysql`（无空格） | `docker run --name mysql [REDACTED] mysql` | **过度脱敏，但属既有**（G15b-sim 同样命中 `cli-mysql-password`），非本轮引入 |

### 4.4 对照项（指令要求**逐字不变**）—— 全部 PASS

`ssh -p2222 host`、`docker run -p 8080:80 nginx`、`npm run build --prefix packages/core`、`mkdir -p /tmp/x`、
`sudo -u root whoami`、`docker run --user 1000:1000 nginx`、`ssh -i /home/u/.ssh/id_rsa host`
—— 生产出口实测**逐字不变**（sh 与 ps1 均 OK）。

### 4.5 **过度脱敏是否构成 REJECT 依据？—— 是（本轮新引入的那部分）**

理由：① 项目原则明确「过度脱敏不可接受」；② 被误伤的是**端口号**和**容器 user:group**，
不是密钥值，脱敏后命令语义被破坏（把一个端口显示成 `[REDACTED]`，会让人误判存在口令）；
③ 其中一类（跨行）还造成 **sh 与 ps1 生产行为发散**，且无闸门覆盖。
（4.3 里的**既有**项不单独构成本轮 REJECT 依据，但它与本轮新增项同源，建议一并收窄。）

---

## 5. 仍存在的明文泄漏 —— **FAIL：1 条是本轮新引入的回归**

生产出口实测（`node d1-prod.mjs`，两端结果一致）：

| 载荷 | sh / ps1 实测 | G15b-sim | 定性 |
|---|---|---|---|
| `curl -u alice:123456 https://x` | `curl -u alice:123456 https://x` ← **明文** | `curl [REDACTED] https://x` | **本轮新引入的泄漏回归（必须修）** |
| `git clone https://user:s3cr3tP@ss@github.com/o/r.git` | 明文 | 明文 | 既有缺口（任务卡未要求；建议修） |
| `docker login -u a -p hunter2` | 明文 | 明文 | 既有缺口（`-p<空格>值` 形态未被任何规则覆盖；建议修） |
| `mysql -p 12345678`（`-p` 与值之间有空格） | 明文 | 明文 | 既有缺口 |
| `mysql -PS3cret` / `ssh -i <路径>` | 明文 / 不脱敏 | 明文 / 不脱敏 | 前者按 A2 裁定不做，后者按 A1 裁定**故意不脱敏**（合理，保留） |

**回归证据链**（G15b 原始文件已不存在，故为文档级 + 重建级）：
1. G15b 报告 `IMPLEMENTATION_RESULT_G15b.md` §3.2 **L68** 逐字记录旧规则为
   `(^|[^-A-Za-z0-9_])-u\s+[^\s]+:[^\s]+` → `$1[REDACTED]`（**无「密码须含非数字」限制**）；
2. 本轮报告 `IMPLEMENTATION_RESULT_G15b-FIX.md` §4 **L151** 自述：「规则 `cli-basic-auth` 由 `-u` 扩为
   `(?:--user|-u)`，**并要求值内含 `:` 且密码部分含至少一个非数字字符**」——即该收窄是本轮新增；
3. 我用上述旧规则重建的 G15b-sim 实测：`curl -u alice:123456` → `curl [REDACTED] https://x`（脱敏），
   现版 → 明文。
4. 一致性：G15b 的 parity 强制三端同源，ps1/sh 与 core 同规则，故该结论对两端同样成立。

**最小修法（不影响 `docker run --user 1000:1000`）**：把守卫**只**加在 `--user` 分支上，`-u` 恢复 G15b 写法：

```
(^|[^-A-Za-z0-9_])(?:-u\s+[^\s:]+:[^\s]+|--user\s+[^\s:]+:[^\s]*[^\s0-9:][^\s]*)
```

---

## 6. ps1 侧 `<no-Command-segment>` —— **探针问题，不是 ps1 缺陷**

**我的实测**：同样的真实 spawn + 进程 stdin，ps1 生产出口的 D1 四类残留**全部 PASS**（§2 已列，另见下），
`命令：` 锚点可正常抽出：

```
[OK] D1-aws-space   out=aws configure set [REDACTED]; rm -rf /tmp/t
[OK] D1-quoted-sp   out=rm -rf /tmp/t --[REDACTED]
[OK] D1-mysql-p     out=mysql [REDACTED] -e "select 1"; rm -rf /tmp/t
[OK] D1-curl-u      out=curl [REDACTED] https://example.com; rm -rf /tmp/t
[OK] F3-user-long / [OK] F4-mysql-num …   （27 条里 ps1 非 OK 数 = 9，且 9 条全部是 §4/§5 的过脱敏/泄漏项，无一为“抽不出命令”）
```

**成因（我复现了）**：上一轮 `prod-probe.ps1` 第 3 行设了 `[Console]::OutputEncoding = UTF8`，
随后用 .NET `Process`（`CreateNoWindow=$true`，未设 `StandardOutputEncoding`）启动子进程 —— 父进程按 UTF-8 解码，
而该方式下 ps1 子进程实际按 **OEM-936** 输出 → 中文锚点变乱码 → 抽取失败。我用同款方式复现：

```
# ps1-enc.ps1
A) parent Console=U8 (prod-probe.ps1 line 3), StandardOutputEncoding=null → contains(命令：)=False  ← 复现
C) parent Console=GBK,                    StandardOutputEncoding=null → contains(命令：)=True
```

而用 node `spawnSync`（parity PART B 与我的探针采用的方式）时子进程输出为 **UTF-8**，锚点正常。

**结论**：`prod-verdicts.csv` 里 ps1 全列 `<no-Command-segment>` 是**探针的读取编码选错**，
**不是 ps1 的真实缺陷**——这也与上一轮评测者自己随后的 `out-ps1-decode.txt`（改用 OEM-936 后 ps1 全 PASS）一致。

**附带（既有隐患，非本卡范围，供后续卡参考）**：ps1 hook 的 **stdout 编码未固定**（取决于宿主是否给它 console），
宿主按 UTF-8 读取时，中文提示会乱码（`permissionDecision` 与 ASCII 密钥脱敏不受影响，JSON 仍可解析）。
这是 G15 起就有的行为，本轮未改、也不构成本轮判定依据。

---

## 7. 副本 / BOM / 行尾 —— **副本 PASS；报告 §7 的「CRLF」与产物不符**

逐份实测（`Get-FileHash` + 逐字节统计 CR/LF + BOM 前三字节）：

```
<ws>\agent-risk-guard-audit\scripts\dangerous-commands.ps1          EA253D108FBFFB8C 31538B BOM=True  CR=0
<ws>\agent-risk-guard\assets\hooks\dangerous-commands.ps1           EA253D108FBFFB8C 31538B BOM=True  CR=0
<ws>\agent-risk-guard\skills\agent-risk-guard\scripts\...ps1        EA253D108FBFFB8C 31538B BOM=True  CR=0
<home>\.claude\hooks\dangerous-commands.ps1                         EA253D108FBFFB8C 31538B BOM=True  CR=0
<home>\.codex\hooks\dangerous-commands.ps1                          EA253D108FBFFB8C 31538B BOM=True  CR=0
<home>\.gemini\config\hooks\dangerous-commands.ps1                  EA253D108FBFFB8C 31538B BOM=True  CR=0
<ws>\agent-risk-guard-audit\scripts\dangerous-commands.sh           7C379CB56AFB8763 22096B BOM=False CR=0
<ws>\agent-risk-guard\skills\agent-risk-guard\scripts\...sh         7C379CB56AFB8763 22096B BOM=False CR=0
<ws>\agent-risk-guard-audit-xhs-publish\scripts\dangerous-commands.sh 7C379CB56AFB8763 22096B BOM=False CR=0
```

- **ps1 六副本**：SHA 唯一（`distinct=1`）✓、31538 B ✓、BOM=`EF BB BF` ✓ —— **PASS**
- **sh 三副本**：SHA 唯一 ✓、22096 B ✓、无 BOM ✓、LF ✓ —— **PASS**
- **行尾实测（逐字节）**：`CR=0`、`LF=526`、`ReadAllText().Contains([char]13) = False` → **ps1 是纯 LF**。
  报告 §7 表格写的「**CRLF**」**与产物不符**（G15b 报告写的 `CR=0` 才是对的）。
  影响：纯功能上 PowerShell 处理 LF 无碍（故不单独构成 REJECT），但这是「报告与产物不符」，
  正是上一轮 REJECT 的直接教训，必须更正。

---

## 8. 报告与代码一致性（§10 逐条对照）—— 基本 PASS，3 处需修

自跑：`node rule-parity.mjs`（三端规则 id/顺序比对 + 可移植性扫描）。

```
core 规则(14): aws-access-key-id, github-pat, openai-sk, anthropic-sk-ant, jwt, pem-private-key,
               password-kv, aws-space-kv, generic-kv, authorization,
               cli-mysql-password, cli-mysql-password-numeric, cli-basic-auth, long-random
ps1  规则(14): 同上，同序同名 → true
sh   sed -e 条数 = 15（14 条规则 + 末条哨兵→[REDACTED] 映射），序位逐条 OK
POSIX 扫描：脱敏段+redact_text 干净；redact_cmd() 干净；全文件仅剩判定段 1 处 `\b`（diskpart，G15 之前既有）
```

| 报告 §10 声称 | 我的核对（代码位置） | 结论 |
|---|---|---|
| sh ① 新增 `REDACT_CI_MYSQL/MARIADB` | L57–58 | ✓ |
| sh ② PEM `.*`→`[^-]*` | L77 | ✓ |
| sh ③ 新增 `cli-mysql-password-numeric` sed | L83 | ✓ |
| sh ④ `-u` 扩为 `(--user\|-u)` + 密码含非数字 | L84 | ✓ 但**该收窄即 §5 回归的成因**（报告未提其副作用） |
| sh ⑤ `redact_cmd()` 重写为 `tr → redact_text → JSON 转义` | L176–185；旧 2 条 sed 与 `I` 已删 | ✓（与本轮 P0 一致） |
| sh ⑥「仅注释改写、零行为变化」 | 无法逐字比对（G15b 原件已被同步覆盖）；现状注释确无字面 `\b`/`\s` 记号 | 弱证据，方向成立 |
| core 新增 numeric + `--user` + 非数字 | `redact.ts` L109–120 | ✓ |
| ps1 **仅**加 numeric + 扩 `--user` | ps1 L84–85；三端规则表 14/14/14 同序同名 | ✓ |
| parity 重写：PART A 28 条 + PART B 7 条 | `CORPUS` = 16 含密钥 + 12 对照 = 28；`DENY_CORPUS` = 7 | ✓ |
| `redact.test.ts` 新增 4 个 test | 11 个 test（7 旧 + 4 新：F3/F4/F5/A1） | ✓ |
| `hook-redact-test.ps1` +2 正例 +2 反例 → 97 | 我跑：`PASS: 97/97`、exit 0 | ✓ |
| 六副本/三副本重新同步 | 见 §7 | ✓ |

**需修 3 处**：
1. **§7「行尾 CRLF」→ 应为 LF（CR=0 / LF=526）**（事实错误）。
2. **§3.1「M1：删一条模式 → PART A FAIL」** 应补边界：宽规则（`long-random`）会掩盖窄规则的删除，
   我删 `github-pat` 时闸门**仍绿**（§3 已实测）。
3. **陈旧注释**：`dangerous-commands.ps1` L62 仍写「sh 侧…故用**贪婪 `.*`**」，而 sh 本轮已改为 `[^-]*`（§10 ② 自己说的）。
   属文档漂移，建议一并更新，避免下一个读者按错语义推断。

---

## 9. 判定零改动（CHANGED=0）—— **PASS（我自跑的更强版本）**

报告的 before（G15b ps1 `EA71C7CB`）已不存在，我改为**跨两代**比对：
before = G15 终版 `agent-risk-guard-audit/_eval_g15/tree_after/scripts/dangerous-commands.ps1`（`252D9CF7` / 28183 B），
after = 现行 `EA253D10`；同一 56 条语料，真实 spawn + 进程 stdin，逐条比 `permissionDecision`：

```
BEFORE = …/\_eval_g15/tree_after/scripts/dangerous-commands.ps1 true
AFTER  = …/agent-risk-guard-audit/scripts/dangerous-commands.ps1 true
DECISION-DIFF: total=56  CHANGED=0
```

语料覆盖：删除类（`rm -rf` / `rmdir` / `find -delete` / Python / Remove-Item / del / rd / Clear-Content / rimraf）、
git 破坏类（force / reset / clean / checkout / branch -D / stash drop / rm）、管道与包装（`| bash` / eval / `bash -c`）、
系统类（dd / mkfs / shutdown / chmod 777 / docker prune / wmic / format）、以及本轮的 FIX 相关命令与常规放行。
结合上一轮已证的「G15→G15b `CHANGED=0`」，可传递推出 **G15b→G15b-FIX 判定零改动**。
（另：§4.2 的多行对照也显示两端 `decision` 均为 `deny`，脱敏差异不影响判定。）

---

## 10. 回归套件 —— **PASS（与报告数字逐条吻合）**

自跑（`node --test` 用 glob；ps1 用 pwsh；sh 走 WSL）：

| 套件 | 我自跑 | 报告 | 一致 |
|---|---|---|---|
| `node --test "packages/*/test/*.test.ts" "tests/*/*.test.ts"` | `tests 373 / pass 373 / fail 0`，exit 0 | 373/373 | ✓ |
| ps1 `hook-rules-test.ps1` | 37 PASS / 0 FAIL，exit 0 | 37 | ✓ |
| ps1 `hook-fp-regression.ps1` | 8 PASS / 0 FAIL，exit 0 | 8 | ✓ |
| ps1 `hook-bypass-regression.ps1`（pwsh7） | 20 PASS / 0 FAIL，exit 0 | 20 | ✓ |
| ps1 `hook-audit-reregress.ps1` | `PASS: 59/59`，exit 0 | 59 | ✓ |
| ps1 `hook-redact-test.ps1` | `PASS: 97/97`，exit 0 | 97 | ✓ |
| sh `sh-hook-test.sh` | `PASS: 67/67`，exit 0 | 67 | ✓ |
| sh `sh-audit-edge.sh` | `TOTAL: 40 PASS: 40 FAIL: 0`，exit 0 | 40 | ✓ |
| sh `sh-audit-bypass.sh` | `TOTAL: 192 PASS: 192 FAIL: 0 / ALL PASS`，exit 0 | 192 | ✓ |

---

## 11. 特别标注（点名项汇总）

| 项 | 结论 |
|---|---|
| **仍未脱敏的形态** | ① **`curl -u <user>:<全数字口令>`（本轮新引入的回归，必须修）**；② `git clone https://user:pass@host/...`（URL 凭据）；③ `docker login -u a -p hunter2`（`-p` 与值之间有空格）；④ `mysql -p 12345678`（同上）；⑤ `-P<v>`（A2 裁定不做）、`ssh -i <路径>`（A1 裁定**故意不脱敏**，我认同） |
| **判定回归** | **无**。56 条跨两代 `CHANGED=0`；九套回归全绿 |
| **过度脱敏** | **有，且本轮新引入 3 类**：`--user name:name`（docker `user:group`）、`mysql` 上下文里的**端口** `-p<digits>`（含**跨行**命中）、以及 `;` 被值类吞掉。既有 1 类：`-p3306:3306`（无空格）。**构成 REJECT 依据**（按项目原则） |
| **副本不一致** | **无**。ps1 6/6 = `EA253D10…`；sh 3/3 = `7C379CB5…`；BOM 状态正确 |
| **报告与产物不符** | **有**：§7 行尾「CRLF」应为 LF；§3.1 M1 结论过宽；ps1 L62 注释仍描述 sh 的旧贪婪 `.*` |
| **闸门覆盖盲区（新发现）** | parity 语料全单行，**多行命令的生产行为（换行折叠）无人守**；sh 与 ps1 在多行上会发散 |

---

## 12. 最小修复建议（若编排者维持 REJECT）

1. **F3 拆分（P0，修回归）**：`-u` 恢复 G15b 的无限制写法，只在 `--user` 分支加「密码须含非数字」守卫：
   `(^|[^-A-Za-z0-9_])(?:-u\s+[^\s:]+:[^\s]+|--user\s+[^\s:]+:[^\s]*[^\s0-9:][^\s]*)`
   （若要连 `docker run --user name:group` 的过脱敏一起消掉，就把 `--user` 再限定到 `curl|wget` 上下文，
   或按 A2 的方式**不做 `--user`** 并在报告显式记录理由。）
2. **F4 收窄到命令词（P0，修过脱敏 + 跨行）**：把「同段出现过 mysql」改成「本段**以** mysql/mariadb 起头（允许
   `sudo/env/command` 前缀）」：
   `(^|[;&|][[:space:]]*|sudo[[:space:]]+|env[[:space:]]+|command[[:space:]]+)(mysql|mariadb)([^;&|\n]*)([[:space:]])-p[0-9]+`
   该写法下 `ssh mysql -p2222 host`、`psql -h mysql -p5432`、`echo mysql\npsql -p5432` 均不再命中，而
   `mysql -p12345678 -e "select 1"` 仍命中。
3. **语料补 4 条（P0，防复发）**：PART A 与 core 单测必须同时钉住
   —— 必须脱敏：`curl -u alice:123456 https://x`；必须逐字不变：`ssh mysql -p2222 host`、
   `psql -h mysql -p5432 -U postgres`、`docker run --user nginx:nginx nginx`。
4. **报告更正（P1）**：§7 行尾改 LF；§3.1 补 M1 的掩盖边界；ps1 L62 注释同步为 `[^-]*`。
5. **建议（P2）**：PART B 增加 1 条**多行**语料（生产路径先折叠换行），否则 sh↔ps1 的发散仍无人守；
   并考虑让 `-p` / `-u` 的值类不再吞掉 `;`（改为 `[^\s;]*`）。

---

## 13. 证据文件（我自己建的，均在 `agent-risk-guard/tasks/.tmp/g15bfix-eval/`）

| 文件 | 用途 |
|---|---|
| `probe-lib.mjs` / `d1-prod.mjs` / `out-d1-prod.txt` | **D1 决定性证据**：两端生产出口 27 条（真实 spawn + 进程 stdin），四类残留 O/LEAK/OVER 判定 |
| `make-mutants.mjs` / `run-parity-mutations.ps1` / `parity-baseline.txt` / `parity-M2sh.txt` / `parity-M2ps1.txt` / `parity-M1sh.txt` | **D2 决定性证据**：基线绿 / M2-sh「A 绿 B 红」/ M2-ps1 红 / M1a 掩码 |
| `m1-analysis.mjs` / `out-m1-analysis.txt` | M1 变异可检测性分析（`long-random` 掩盖 `github-pat`） |
| `over-redact.mjs` / `out-over-redact.txt` | 过度脱敏与泄漏 vs G15b-sim 重建基线（新增/回归/既有三分） |
| `multiline-probe.mjs` / `out-multiline.txt` | 生产路径跨行过脱敏 + sh/ps1 发散 |
| `ps1-enc.mjs` / `ps1-enc2.mjs` / `ps1-enc3.mjs` / `ps1-enc.ps1` / `out-ps1-enc-*.txt` | `<no-Command-segment>` 定性（编码复现） |
| `rule-parity.mjs` / `out-rule-parity.txt` | 三端规则表 14/14/14 同序同名 + POSIX/可移植性扫描 |
| `decision-diff.mjs` / `out-decision-diff.txt` | 判定零改动（G15 终版 → FIX，56 条 `CHANGED=0`） |
| `run-regression.ps1` / `reg-*.txt` | 九套回归原始输出 |

**纪律声明**：全程只读；所有变异/实验均在 `.tmp` 隔离副本；被审 4 个文件开工与收工 SHA 完全一致
（`7C379CB56AFB8763` / `EA253D108FBFFB8C` / `6C7B1B1C4344B1F5` / `28615F954D10C256`）；
未真实执行任何危险命令（只投喂 JSON 文本）；未清理任何真实日志。
