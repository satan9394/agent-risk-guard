# IMPLEMENTATION_RESULT — G15b：脱敏残留与三端对齐（P0 安全）

- 任务卡：`agent-risk-guard/tasks/orchestrator/IMPLEMENTATION_BRIEF_G15b.md`
- 实现：独立 Implementer（接手；前一位侦察后停滞已中断）
- 状态：进行中（本文件**增量落盘**，每完成一步追加一节）

---

## 0. 侦察复核（含对任务卡/前一位结论的修正）

以下均为本轮**亲查代码**所得，非转述。

| 项 | 任务卡/前一位说法 | 实测 | 结论 |
|---|---|---|---|
| core `redact.ts` 模式数 | 9 条 | **10 条**（L13/15/17/18/20/22/24/25/26/28） | **任务卡与侦察均有误**，以实测 10 为准 |
| ps1 `RedactPatterns` 条数 | 10 条 | **10 条**（L58-67） | 一致 |
| sh `redact_cmd` 条数 | 2 条 | **2 条 sed**（L93 键值、L94 形状） | 一致 |
| sh 副本数 | 任务卡写"四副本"/侦察"3 份" | **3 份**（audit / skills / audit-xhs-publish，均 `0A742936472A` / 15522 B）；`assets/hooks/` 下无 `.sh` | **以 3 份为准**，侦察正确 |
| ps1 副本 | 六副本 `252D9CF70F78` / 28183 B / BOM=True | 一致 | 一致 |

**真实漂移面**（比「条数不同」更准确）：
1. sh 只有 2 条，缺 `sk-` / JWT / PEM / `≥40` / Bearer 语义（Bearer 有但要求 ≥20 位）→ **覆盖面显著弱于 core/ps1**。
2. core 与 ps1 的 10 条中，有 2 处语义差异：`gh[pousr]_` 下界 core=36 / ps1=20；键值类 core 无 `token`/`credential`，ps1 有。
3. 三端键值类**替换语义**不同：core/ps1 整段替换为 `[REDACTED]`；sh **保留键名**（`password=[REDACTED]`）。
4. sh 的 `redact_cmd` 先做 JSON 转义**再**脱敏（core/ps1 是先脱敏后转义）→ 引号值形态在 sh 侧天然匹配不到（\ 与 " 已被转义）。

**四类残留的根因复核**（与任务卡一致，已用现行实现复现）：键值模式要求 `[:=]`（漏空格形态）；值正则 `[^\s'",;}\]]+` 遇空格即断（漏引号含空格值）；无 `-p<val>` / `-u user:pass` 形态。

## 1. 设计决策

- **canonical = `packages/core/src/redact.ts`**；ps1（.NET）/ sh（POSIX ERE）按平台语法重写同一语义集合。
- **两侧都去掉 `\b`**：POSIX ERE 无 `\b`，若 core/ps1 保留而 sh 用 `(^|[^alnum])` 模拟，则在相邻命中等边界上必然产生输出差异。统一改用「独特前缀 + 贪婪量词」，并把确需左边界的模式（`-p`/`-u`）写成 `(^|[^-A-Za-z0-9_])` 三端**同形**。去掉 `\b` 只会**增加**命中，不减少既有覆盖。
- **`-p` 左边界必须排除前导 `-`**：否则 `--prefix` / `--pretty` 会被误伤（`npm run build --prefix packages/core` 是 G15 既有 no-fp 用例，会直接变红）。边界取 `(^|[^-A-Za-z0-9_])`。
- **`-p` 值须含至少一个非数字字符**：排除 `ssh -p2222` 这类端口误伤（代价：全数字密码不脱敏，属已知取舍，报告中列出）。
- **sh 调整顺序**：先 `tr '\n' ' '`（使 PEM 跨行可匹配）→ 脱敏 → 再 JSON 转义。与 core/ps1「先脱敏后转义」一致，同时修掉引号值在 sh 侧匹配不到的问题。
- **sh 可移植性**：不用 `\b`/`\s`/lookaround/`I` 标志（GNU-only）；改用 `[[:space:]]` 与**运行时生成的大小写类** `[Pp][Aa]...`（纯 bash 循环 + `tr`，兼容 macOS 自带 bash 3.2）。

## 2. 待办

- [x] 步骤 1：改 core（canonical）+ core 单测
- [x] 步骤 2：对齐 ps1 + 测试入口 + 扩 `hook-redact-test.ps1`
- [x] 步骤 3：对齐 sh + CLI 入口 + 同步 3 副本
- [x] 步骤 4：parity 测试（23 语料）+ 变异验证 3/3 CAUGHT
- [x] 步骤 5：全量回归 + 判定零改动（CHANGED=0）
- [x] 步骤 6：副本 SHA/BOM 复核

---

## 3. 步骤 1 已完成：core（canonical）补齐四类残留

**落盘时间 2026-09-11 10:15–10:20。** 改动文件：`packages/core/src/redact.ts`（55 行 → 约 200 行）、新增 `packages/core/test/redact.test.ts`。

### 3.1 结构变化

- `SECRET_PATTERNS: RegExp[]`（10 条）→ `SECRET_RULES: RedactRule[]`（**13 条**，含 `id` 与可选 `repl`）。
  引入 `id` 是为了让跨端 parity 测试能断言「**命中集合**一致」而不只是「输出一致」；引入 `repl` 是因为
  `-p` / `-u` 两条模式必须保留被左边界消费掉的字符（`$1[REDACTED]`）。
- 新增 `redactDetails(text) → { out, hits }`；`redactSecrets` 改为其薄封装（**导出签名与语义不变**，`redactJsonValue` 未动）。
- 新增导出 `REDACT_RULE_IDS`、`SECRET_RULES`、类型 `RedactRule`。

### 3.2 新增/变更的 4 类规则（原 10 条全部保留）

| 规则 id | 覆盖的残留 | 关键写法 |
|---|---|---|
| `aws-space-kv` | R1 `aws configure set aws_secret_access_key VALUE`（空格分隔） | `(?:aws_)?(?:secret_access_key\|access_key_id\|session_token)(?:\s*[:=]\s*\|\s+)VALUE` |
| `password-kv` / `generic-kv`（值部分改写） | R2 `--password="correct horse battery staple"`（引号内含空格） | 值改为 `("[^"]*"\|'[^']*'\|[^\s'",;}\]]+)`——**引号分支优先**，引号内允许空格 |
| `cli-mysql-password` | R3 `mysql -pSup3rS3cret` | `(^\|[^-A-Za-z0-9_])-p[^\s]*[^\s0-9][^\s]*` → `$1[REDACTED]` |
| `cli-basic-auth` | R4 `curl -u alice:hunter2` | `(^\|[^-A-Za-z0-9_])-u\s+[^\s]+:[^\s]+` → `$1[REDACTED]` |

同时：`generic-kv` 键名补 `token` / `secret` / `credential` / `passwd`；`github-pat` 下界 36 → **20**（与 ps1/sh 一致，只增不减）；**全部规则去掉 `\b`**（原因见 §1 设计决策）。

### 3.3 两个必须记录的「防误伤」设计（否则会打破既有用例）

1. **`-p` 左边界必须排除前导 `-`**：朴素写法 `-p[^\s]+` 会把 `npm run build --prefix packages/core` 里的
   `--prefix` 误伤（`-p` 恰好出现在第 2、3 字符），而该命令**正是 G15 既有 no-fp 用例**，会直接把 `hook-redact-test.ps1` 打红。
   故左边界取 `(^|[^-A-Za-z0-9_])`。
2. **`-p` 的值须含至少一个非数字字符**：`[^\s]*[^\s0-9][^\s]*`。否则 `ssh -p2222 host` / `docker run -p 8080:80`
   会被误伤。代价：**全数字密码（如 `-p12345678`）不脱敏**，属已知取舍，列入 §未解决问题。

### 3.4 测试

新增 `packages/core/test/redact.test.ts`（7 个 test）：G15 十类回归 / R1 / R2 / R3 / R4 / 12 条无误伤对照 / 空文本与长文本边界。

| 命令 | 结果 |
|---|---|
| `node --test "packages/core/test/*.test.ts"`（改前基线） | **42 tests / 42 pass / 0 fail** |
| 同上（改后） | **49 tests / 49 pass / 0 fail**（+7 新增，0 回归） |

原始输出：`_g15b_core_tests.txt`。

**过程中自查出并修正的 2 个「测试自身 bug」**（非实现缺陷，如实记录）：
- `sk-ant-…` 会被更靠前的 `openai-sk` 规则先吞掉（G15 起既有行为，三端顺序一致故不影响 parity）→ 断言改为等价类；
- `'x'.repeat(5000)` 连续 40+ 同字符**本就应当**命中 `long-random`，我最初的断言写反了 → 改用带空格的长文本。

---

## 4. 步骤 2 已完成：ps1（.NET）对齐

改动文件：`agent-risk-guard-audit/scripts/dangerous-commands.ps1`（493 行 → 522 行）。

- `$script:RedactPatterns`（10 条纯字符串）→ `$script:RedactRules`（**13 条**，`@{ id; re; repl }`），逐条同序对齐 core。
- `Redact-Secrets` 改为按规则取 `repl`（缺省用哨兵），并在末尾统一映射哨兵 → `[REDACTED]`。
- 新增**测试入口** `-RedactFile <path>`：对文件内容脱敏后输出。它走的是**真实生产函数** `Redact-Secrets`，
  而不是测试内复制的模式表；生产调用不传该参数，行为不变（与既有 `-Cmd` / `RG_CMD` 测试钩子同一先例）。
- 文件头追加 G15b 改动记录。

**实测**（真实 spawn `powershell.exe -File <hook> -RedactFile <tmp>`，23 行 corpus）：13 条含密钥输入全部命中
`[REDACTED]` 且无明文；10 条普通命令**逐字未变**（含 `npm run build --prefix packages/core`、`ssh -p2222 host`、
`mkdir -p /tmp/empty_dir`、`sudo -u root whoami`、`docker run -p 8080:80 nginx`）。原始输出 `_g15b_ps1_check.txt`。

**ps1 五套既有套件回归**：`hook-rules-test` 37/37、`hook-fp-regression` 8/8、`hook-bypass-regression` 18/18（PS5.1）、
`hook-audit-reregress` 59/59、`hook-redact-test` 60/60 —— **全部 exit 0，无回归**。

---

## 5. 步骤 3 已完成：sh（POSIX ERE）对齐

改动文件：`agent-risk-guard-audit/scripts/dangerous-commands.sh`（15522 B → 约 20 KB）。

- 新增 `ci()`（运行时生成大小写不敏感 ERE `[Pp][Aa]…`，一次 `tr` + bash 循环，**兼容 macOS 自带 bash 3.2**，
  不用 bash4 的 `${var^^}`、不用 GNU-only 的 sed `I` 标志）、`REDACT_VALUE`、13 条 `redact_text()`。
- 新增测试入口 `--redact-stdin`（读 stdin 输出脱敏结果，走真实 `redact_text`）。
- `redact_cmd()` 改为 **`tr '\n' ' '` → `redact_text` → JSON 转义**（原为「先转义再脱敏」）。
  这一处顺序调整同时修掉两个问题：① 引号值形态在 sh 侧因 `"`→`\"` 被转义而永远匹配不到；
  ② 与 core/ps1 的「先脱敏后转义」回归一致。

### 5.1 本轮实测踩到并修掉的三个真问题（都值得记录）

1. **POSIX 括号表达式内反斜杠不是转义符** —— 我把 core 的值正则照抄成 `[^...}\]]+`，在 ERE 里被解析为
   「排除反斜杠」+ 字面 `]`，导致 `aws_secret_access_key` 空格形态**静默漏脱敏**（首轮 sh 实测：
   该条 SAME 未变）。修法是 POSIX 惯用法：把 `]` 放在 `^` 之后首位 → `[^]'",;}[:space:]]+`。
   **.NET/JS 用 `\]` 是对的，ERE 必须换写法**——这正是「允许平台语法差异」的典型例子。
2. **占位符二次命中（三端同病）** —— `aws configure set aws_access_key_id AKIA…` 中 AKIA 规则先产出
   `[REDACTED]`，随后的键值规则又把 `[REDACTED`（值类排除 `]`）当成一个值再匹配一次，留下多余 `]` →
   `aws configure set [REDACTED]]`。实测 **core / ps1 / sh 三端都有**（ps1 已复现）。修法：三端统一改用
   **内部哨兵** `@@RG_REDACTED@@` 做替换，全部规则跑完后再映射为 `[REDACTED]`。修后该例输出为干净的
   `aws configure set [REDACTED]`。
3. **编辑工具会剥离 UTF-8 BOM** —— 首次编辑 ps1 后实测前 3 字节变成 `35,32,100`（`# d`）。已加
   `_g15b_fixbom.ps1` 并把「改完 ps1 必复检 BOM + PS5.1 解析」固化为流程；复检后为 `239,187,191` 且 PS5.1 解析通过。

### 5.2 三端逐字一致（决定性证据）

同一份 **23 行 corpus**（13 条含密钥 + 10 条普通命令）分别喂三端真实入口（core 直接 import、ps1 `-RedactFile`、
sh `--redact-stdin`），比对 ps1 与 sh 的**每一行输出**：

```
ps1 rows=23  sh rows=23
PARITY OK: 23/23 rows byte-identical (ps1 === sh)      exit=0
```

原始输出：`_g15b_ps1_check.txt`、`_g15b_sh_check.txt`；比对脚本 `_g15b_compare.mjs`。

**sh 侧实测**：13 条含密钥输入全部命中 `[REDACTED]`，10 条普通命令逐字未变。

---

## 6. 步骤 4 已完成：跨端 parity 测试（防漂移闸门）

新增 `packages/core/test/redact-parity.test.ts`（`node --test` 内运行）。

- **语料 23 条**：13 条含密钥（覆盖四类残留 + G15 既有 6 类） + **10 条无误伤对照**（≥12/≥5 达标）。
- **三端真实执行**：
  - core —— 直接 `import ../src/redact.ts` 的 `redactSecrets`（canonical）；
  - ps1 —— 一次性驱动脚本内循环，逐条 spawn `powershell.exe -File dangerous-commands.ps1 -RedactFile <tmp>`；
  - sh  —— 一次性 WSL 调用内循环，`bash dangerous-commands.sh --redact-stdin`。
  三端走的都是**真实生产函数**，不是测试内复制的模式表。
- **断言**：逐字输出一致（`core === ps1 === sh`），比任务卡要求的「命中集合一致」**更强**
  （输出相同即蕴含命中集合相同）；另外单独断言 core 的 `hits`：含密钥语料必须非空、无误伤语料必须为空。
- **路径可覆盖**：`RG_PARITY_PS1` / `RG_PARITY_SH` 环境变量可指向被改坏的副本，用于变异验证。
- 无 powershell / wsl 的宿主上对应端 skip 并打印原因（本机两端均实跑）。

**实测**：`node --test "packages/core/test/redact-parity.test.ts"` → **1 test / 1 pass / 0 fail**，耗时约 24 s。

**过程中自查出的一个测试自身缺陷**（如实记录）：`DEFAULT_PS1/SH` 的 `../..` 层数写少了一层，指向了不存在的文件；
这在 Windows 上表现为 powershell 打印 banner（`Windows PowerShell`）、bash 静默 `exit 127`，最终伪装成
「输出不一致」这种极具误导性的失败。已修正为四层上溯，并加 `existsSync` 前置断言让此类错误**响亮失败**。

---

## 7. 步骤 5 已完成：变异验证（parity 测试不是恒绿）

方法：分别从三端**各删掉一条模式**（都选 `aws-space-kv`，覆盖任务卡点名的 `aws_secret_access_key` 空格形态），
再跑同一份 parity 测试，要求**必须变红**。原始输出 `_g15b_mutation.txt`。

| 变异 | 手法 | 结果 |
|---|---|---|
| ps1 删 `aws-space-kv` | 正则删掉该规则行（526 → 525 行） | **CAUGHT（红）✓** |
| sh 删 aws-space sed 行 | 正则删掉该 `-e` 行（349 → 347 行） | **CAUGHT（红）✓** |
| core 删 `aws-space-kv` | 迷你树（`src/` + `test/`），规则数 13 → 12 | **CAUGHT（红）✓** |

**变异红的具体内容**（ps1 变异，`_g15b_mutation_ps1_raw.txt`）：

```
AssertionError [ERR_ASSERTION]: 三端输出不一致（共 3 处）:
  in  =aws configure set aws_secret_access_key TESTFIXTUREsecretVALUE0000000000000000
  core=aws configure set [REDACTED]
  ps1 =aws configure set aws_secret_access_key TESTFIXTUREsecretVALUE0000000000000000     ← 明文泄漏
  in  =aws configure set aws_access_key_id AKIAZZTESTFIXTURE999
  core=aws configure set [REDACTED]
  ps1 =aws configure set aws_access_key_id [REDACTED]                                       ← 与 core 形式不同
```

即：该测试确实能捕获「任一端漏掉某形态」，`MUTATION-VERIFY: ALL CAUGHT`。

---

## 8. 步骤 6 已完成：全量回归（前后数字）

本体改动**不触碰任何判定代码**（只改输出侧脱敏），全部既有套件零失败。

| 套件 | 基线 | 改后 | 结论 |
|---|---|---|---|
| `node --test "packages/*/test/*.test.ts" "tests/*/*.test.ts"` | 360 | **368 / 368 pass / 0 fail**（+8 = 新增 `redact.test.ts` 7 + `redact-parity.test.ts` 1） | 无回归 |
| ps1 `hook-rules-test.ps1` | 37 | 37 / 0 FAIL | 无回归 |
| ps1 `hook-fp-regression.ps1` | 8 | 8 / 0 FAIL | 无回归 |
| ps1 `hook-bypass-regression.ps1`（PS5.1） | 18 | 18 / 0 FAIL | 无回归 |
| ps1 `hook-audit-reregress.ps1` | 59 | 59 / 0 FAIL | 无回归 |
| ps1 `hook-redact-test.ps1` | 60 | **89 / 89 / 0 FAIL**（+29 = G15b 四类残留 5 条 + deny 侧 2 条 + 误伤对照 4 条，每条 2~3 断言） | 增强 |
| sh `sh-hook-test.sh` | 67 | 67 / 67 | 无回归 |
| sh `sh-audit-edge.sh` | 40 | 40 / 40 / 0 FAIL | 无回归 |
| sh `sh-audit-bypass.sh` | 192 | 192 / 192 / 0 FAIL / ALL PASS | 无回归 |
| `redact-parity.test.ts`（新增） | — | 1 / 1 pass | 新增 |

> 环境备注：根 `package.json` 的 `"test": "node --test packages/core/test tests/e2e"` 用**目录形式**在 node v24 下会
> 报 `MODULE_NOT_FOUND`，必须写成 glob（如 `node --test "packages/core/test/*.test.ts"`）。这是既有脚本问题，
> 不在本卡范围，**未改**，仅在此记录以免下一位踩坑。

---

## 9. 判定逻辑零改动（实证）

方法：把 **G15 收尾快照**（`_g15_final_hook.ps1`，sha `252D9CF7…`，即 G15b 改前版本）与**改后主源**（sha `EA71C7CB…`）
各跑一遍 **65 条命令**，逐条比对 `permissionDecision`。走的是**生产同形 stdin 路径**
（真实 spawn 子进程 + stdin 喂 JSON，而非 `-Cmd` 同进程捷径）。

```
before sha = 252D9CF70F7839D98382FCD02FF6D9B4EC189E596BBE59A8178FBB28F177AECA
after  sha = EA71C7CBF32251BB285ACBD5B2BB1981330BC768259C25485E8459A45AFCAA9B
DECISION-DIFF: total=65  CHANGED=0
```

命令集覆盖：删除类（rm/rm -rf/unlink/shred/find -delete/Remove-Item/del/ri/rimraf/Clear-Content/.Delete）、
回收站清空类、Python/Node/Perl 删除、git 破坏整类（含 `--force-with-lease` 放行对照）、wmic/docker/curl 管道、
chmod/关机/注册表/icacls、包装与插词绕过（`bash -c`、`$x=rm`、`r\m`、全角 `ｒｍ`）、纯注释放行、
以及**四类残留命令本身**（它们都是 allow，判定必须不变）。原始输出 `_g15b_decision_diff.txt`。

sh 侧判定不变由 `sh-hook-test` / `sh-audit-edge` / `sh-audit-bypass` 三套（67/40/192）覆盖——`redact_cmd` 只在
`deny_command` 出口被调用，改它**结构上不可能**影响判定。

> 过程记录（如实）：该脚本第一次运行在第 82 行 spawn `powershell.exe` 时抛「拒绝访问」，属**瞬时失败**
> （编排器从另一上下文实测同目录可正常 spawn）。改为 stdin 路径后一次通过；未采用 `-Cmd` 是因为它把命令
> 文本经外层命令行传参，遇 `$`/引号会被 PowerShell 参数解析破坏（会伪装成 hook 故障）。

---

## 10. 副本同步 · SHA256 / BOM

同步方式：主源按**字节**写回全部副本（`WriteAllBytes`），天然保持编码一致。原始输出 `_g15b_sync.txt`。

**ps1 六副本**（主源 31397 B）：

| # | 路径 | SHA256 | BOM |
|---|---|---|---|
| 1 | `agent-risk-guard-audit/scripts/dangerous-commands.ps1`（主源） | `EA71C7CBF32251BB…` | True |
| 2 | `agent-risk-guard/assets/hooks/dangerous-commands.ps1` | 同上 | True |
| 3 | `agent-risk-guard/skills/agent-risk-guard/scripts/dangerous-commands.ps1` | 同上 | True |
| 4 | `~/.claude/hooks/dangerous-commands.ps1` | 同上 | True |
| 5 | `~/.codex/hooks/dangerous-commands.ps1` | 同上 | True |
| 6 | `~/.gemini/config/hooks/dangerous-commands.ps1` | 同上 | True |

→ `distinct SHA = 1`，BOM 逐份实测 `EF BB BF`，PS5.1 解析通过。

**sh 三副本**（主源 20443 B，**正确无 BOM**）：

| # | 路径 | SHA256 |
|---|---|---|
| 1 | `agent-risk-guard-audit/scripts/dangerous-commands.sh`（主源） | `1D2E93F337B8DDBF…` |
| 2 | `agent-risk-guard/skills/agent-risk-guard/scripts/dangerous-commands.sh` | 同上 |
| 3 | `agent-risk-guard-audit-xhs-publish/scripts/dangerous-commands.sh` | 同上 |

→ `distinct SHA = 1`，无 BOM，LF 行尾（CR 字节数 = 0）。

`.sh` 仅 3 份：`agent-risk-guard/assets/hooks/` 下**不存在** `.sh`，任务卡写的「sh 四副本」有误，以实测 3 份为准。

---

## 11. 未解决问题（需 Orchestrator / Evaluator 裁量）

1. **全数字密码不脱敏（有意取舍，有泄漏面）**：`-p` 的值要求含至少一个非数字字符，否则 `ssh -p2222` /
   `docker run -p 8080:80` 会被误伤。**代价**：`mysql -p12345678` 不会被脱敏仍会明文入日志。
   若判为不可接受，可选方案：`-p` 前缀限定在 `mysql|mariadb` 之后（需命令上下文，红actSecrets 目前是纯文本函数）。
2. **短参覆盖面仍有限**：已覆盖 `-p<v>` / `-u user:pass` / `--password[= ]v` / `--token[= ]v` / `--api-key[= ]v` /
   `--client_secret[= ]v` / `--secret[= ]v`；**未覆盖** `--user user:pass`、`-P<v>`、`--auth`、SSH `-i` 等。
3. **PEM 多块时的跨端差异**：core/ps1 用惰性 `[\s\S]*?`（每块单独替换），sh 因先 `tr '\n' ' '` 折叠单行只能用
   贪婪 `.*`（会从第一个 BEGIN 吞到**最后一个** END）。单块语料下三端一致（parity 语料即单块）；
   多块语料下 sh 会把中间内容一并吃掉——**保守方向（多脱敏而非少脱敏）**，但仍属未能完全对齐的形态，显式列出。
4. **引号内含转义引号**：`--password="a\"b"` 会在第一个转义引号处提前闭合，值可能只脱敏一半。
   三端行为一致（都按 `"` 截断），故 parity 不受影响，但脱敏不完整。
5. **哨兵纪律需靠人守**：本轮用内部哨兵 `@@RG_REDACTED@@` 消除了「占位符被后续规则二次命中」的伪影
   （原症状 `[REDACTED]]`）。**若日后新增规则时直接写死 `[REDACTED]` 而不用哨兵，该伪影会复发**——
   三端都已加注释说明；未加自动断言，建议 Evaluator 关注。
6. **sh 侧每次 hook 调用多约 15 次 `tr` 子进程**（运行时生成大小写类）。实测对既有三套件无影响，但属启动开销；
   若日后在意，可改为进程级缓存或预生成字面量。
7. **发布产物未重建**：`agent-risk-guard/dist/agent-risk-guard-v0.*/packages/core/src/redact.ts` 是历史打包快照，
   本轮未同步（不在任务卡范围）。若 dist 会被直接使用，需重新执行构建。
8. **G15 遗留：生产日志仍有历史明文**（`%TEMP%\riskguard-hook-calls.log`，G15 报告 §9.5：864,815 B / 6 处明文命中）。
   本轮未动（删除须进回收站且需用户确认），仍在原处。
9. **七个 ps1 变体未对齐**：`dangerous-commands-universal.ps1`（×2）、`agy-dangerous-commands.ps1`（×3）、
   `dangerous-commands-agy.ps1`、`xhs-publish/dangerous-commands.ps1` 仍用旧脱敏（其中两个仍无脱敏）。
   G15 已实测**它们未在任何 agent 配置中注册**，非活跃泄漏面。

---

## 12. 交付物清单

**改动源文件**
- `packages/core/src/redact.ts`（canonical，10 → 13 条规则 + `redactDetails` + 哨兵）
- `agent-risk-guard-audit/scripts/dangerous-commands.ps1`（`RedactPatterns` → `RedactRules`、`-RedactFile`）
- `agent-risk-guard-audit/scripts/dangerous-commands.sh`（`redact_text` + `--redact-stdin` + 顺序调整）
- 副本：ps1 六份、sh 三份（全部 SHA 一致 / BOM 正确）

**新增/扩展测试**
- 新增 `packages/core/test/redact.test.ts`（7 test）、`packages/core/test/redact-parity.test.ts`（跨端 parity）
- 扩展 `agent-risk-guard-audit/tests/hook-redact-test.ps1`（60 → 89 断言）

**证据工件**（均在 `agent-risk-guard/tasks/orchestrator/`）
`_g15b_corpus.txt`、`_g15b_ps1_check.txt`、`_g15b_sh_check.txt`、`_g15b_compare.mjs`、`_g15b_parity_test.txt`、
`_g15b_mutation.ps1` / `_g15b_mutation.txt` / `_g15b_mutation_ps1_raw.txt`、`_g15b_decision_diff.ps1` / `.txt`、
`_g15b_sync.ps1` / `_g15b_sync.txt`、`_g15b_all_node_tests.txt`、`_g15b_redact_suite.txt`、`_g15b_fixbom.ps1`。

**自检提示（给 Evaluator）**：改 ps1 后务必复检 BOM——编辑工具会静默剥离它，可用 `_g15b_fixbom.ps1` 修复并
用 `powershell.exe -Command "[System.Management.Automation.Language.Parser]::ParseFile(...)"` 复核 PS5.1 可解析。

