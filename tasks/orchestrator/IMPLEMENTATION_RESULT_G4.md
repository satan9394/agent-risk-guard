# IMPLEMENTATION_RESULT — G4：PowerShell hook 规则 16d 死代码修复（收尾验证版）

- 任务卡：`tasks/orchestrator/IMPLEMENTATION_BRIEF_G4.md`
- 代码改动：第 1 棒 Implementer（完成改动后崩溃，其 v1 报告已被本文件取代）
- **收尾验证与落盘：第 2 棒 Implementer（本文件，2026-09-11）**
- 状态：**代码改动 + 全量验证完成**；1 项与任务卡「错误场景」字面预期冲突需 Orchestrator/Evaluator 裁决（§7.1）

## 0. 本轮范围声明（先讲边界）

本轮**只做验证与记录，不改任何规则逻辑**。全部数字均为本轮独立实测（重跑得到），不是转述上一棒的自述。唯一的写操作是 §4 的「回滚变红」实验：临时把 16d 改回旧写法，跑完由 `finally` 逐字节写回原字节，写回后 SHA256 `D6D726D2…` **byte-identical=True**、BOM=True（见 §4 原始输出）。此外**没有**修改任何 hook 规则文件、测试文件或 `.sh`。

## 1. 改动摘要（本轮逐字节复核过，非引用）

### 1.1 canonical 主源 `agent-risk-guard-audit/scripts/dangerous-commands.ps1`（L252，规则 16d）

改后现状（本轮直接读取文件确认，全文 432 行，POSIX 括号类计数 = 0）：

```powershell
if ($cmd -match '(?i)=\s*"?rm(\s|"|;|$)' -or $cmd -match '(?i)=\s*"?Remove-Item(\s|"|;|$)' -or $cmd -match '(?:^|[;&|\r\n])[\\/]{1,2}rm(\s|-)' -or $cmd -match 'r[\\/]m(\s|-)') {
```

改前为同一行的 6 处 `[[:space:]]` 形态（POSIX 括号表达式，在 .NET 正则中不是空白类）。分支结构、`(?i)` 标志、其余语义未变。

### 1.2 universal `agent-risk-guard-audit/scripts/dangerous-commands-universal.ps1`（L216）

同根因同修法，改后为 `=\s*"?rm(\s|"|;|$)` 形态；该文件与 canonical 存在**既有漂移**（本轮实测：canonical 432 行 / universal 354 行），属 G3 单源收敛范围，本轮未做内容对齐。

### 1.3 回归用例 `agent-risk-guard-audit/tests/hook-audit-reregress.ps1`

在原有 53 例后追加 6 例（deny 4 + allow 对照组 2），用例数 53 → 59（本轮实测 59/59）：`$x=rm; $x -rf /tmp/t`、`$x = rm; $x -rf /tmp/t`、`$x="rm -rf /tmp/t"; $x`、`$x=Remove-Item; $x -Path C:\temp -Recurse -Force`，以及 `echo hello`、`git status`（allow 对照）。文件当前 BOM=True、首行为注释，mtime 2026-09-11 07:12:10。

## 2. 四套 ps1 套件 · 双引擎实测数字

引擎标识（本轮实测）：`pwsh 7.6.6 (.NET 10.0.12)` 与 `powershell 5.1.26100.9444 (CLR 4.0.30319)`。

| 套件 | pwsh 7.6.6 | exit | powershell 5.1 | exit | Orchestrator 基线 |
|---|---|---|---|---|---|
| `hook-rules-test.ps1` | **37/37** | 0 | **37/37** | 0 | 37 |
| `hook-fp-regression.ps1` | **8/8** | 0 | **8/8** | 0 | 8 |
| `hook-bypass-regression.ps1` | **20/20** | 0 | **18/18** ※ | 0 | 18 |
| `hook-audit-reregress.ps1` | **59/59** | 0 | **59/59** | 0 | 53（+6 新例） |

四套双引擎全部全绿、exit=0，且与基线/预期一致：reregress 从 53 增至 59 正是新增 6 例所致；其余三套数字未变（无回归）。※ 见 §2.1。

### 2.1 bypass 套件 ps5.1 只跑 18 条的**精确机制**（本轮新查明的证据）

任务卡要求的解释成立，但成因比「首行 em-dash 吞换行」更具体。实测：

- `tests/hook-bypass-regression.ps1` **无 UTF-8 BOM**（首 24 字节 = `68 6F 6F 6B …`），且**第 1 行不是注释**（没有 `#`）：
  `hook-bypass-regression.ps1 — Round 8 绕过回归（与 GAN 审查互补，锚定修复后行为）`
- PS 5.1 无 BOM 时按系统 ANSI（本机 **936/GBK**）解码该文件。同一份字节两种解码的**行数**不同：
  ```
  utf8 lines = 48 ; ansi936 lines = 45
  ansi L1 : hook-bypass-regression.ps1 ??Round 8 …???$ErrorActionPreference = 'Stop'
  ansi L7 :   # ???/????????  @{ cmd = "echo hi`nrm -rf /tmp";         expect = 'deny' },
  ansi L21:   # ??????  @{ cmd = 'RM -rf /tmp';                  expect = 'deny' },
  ```
  即中文注释末字的最后一个 UTF-8 字节（如 `体`=…BD 93、`写`=…86 99）在 GBK 下成为**悬挂的前导字节**，把随后的 CR 吃掉 → CRLF 不再是换行 → 下一行被并入注释行，**静默丢失 3 行**。
- 后果有二：(a) 两条用例（含换行的 `echo hi\nrm -rf /tmp`、`RM -rf /tmp`）连注释一起被吞，`$cases.Count` = 18，故输出 `18/18`，**不等于**「20 条全过」；(b) 顶部 `$ErrorActionPreference = 'Stop'` 也被并入第 1 行那条伪命令，PS 5.1 下未生效（第 1 行报 `CommandNotFoundException`）。
- 该缺陷**改前改后完全一致**（本轮 pwsh7 仍 20/20、ps5.1 仍 18/18），属**沿袭技术债、非本次引入**。建议修法（本轮按 Orchestrator 指示未动，因其会改变既有基线）：给该文件加 `#` 开头的首行注释并补 UTF-8 BOM（其余三套测试文件同样无 BOM，但首行是注释、内容为 ASCII，故数字不受影响）。

## 3. WSL sh 三套件（不回归确认）

命令：`wsl -d Ubuntu -- bash <suite> "/mnt/e/.../agent-risk-guard-audit/scripts/dangerous-commands.sh"`

| 套件 | 结果 | exit |
|---|---|---|
| `sh-hook-test.sh` | **PASS: 67/67** | 0 |
| `sh-audit-edge.sh` | **TOTAL: 40 PASS: 40 FAIL: 0** | 0 |
| `sh-audit-bypass.sh` | **TOTAL: 192 PASS: 192 FAIL: 0，ALL PASS** | 0 |

与期望 67/40/192 完全一致。本轮未触碰任何 `.sh`，判定 sh 侧零回归。

## 4. 测试有效性证据：回滚变红 → 还原变绿（决定性）

方法：把 canonical 16d 的 `\s` 临时改回 `[[:space:]]`（只改这一行），跑 reregress；再由 `finally` 用 `WriteAllBytes` 写回原始字节。原始输出：

```
BEFORE  sha=D6D726D20288C2AFE602BE488D17A6C05F90DB1C46E4A78BC2E2A6A99FBCA9CA size=24004
ROLLEDBACK sha=40185A84963E1066FB2219911C66144B236AE13156CBBA4FD10839CD8D2971A4 size=24058 BOM=True
--- reregress under ROLLED BACK (expect RED) ---
    FAIL [expect deny] got allow  <- $x=rm; $x -rf /tmp/t
    FAIL [expect deny] got allow  <- $x = rm; $x -rf /tmp/t
    PASS: 57/59
    exit=1
RESTORED sha=D6D726D20288C2AFE602BE488D17A6C05F90DB1C46E4A78BC2E2A6A99FBCA9CA byte-identical=True BOM=True size=24004
MATCHES-ORIGINAL-EXPECTED-HASH=True
--- reregress under RESTORED (expect GREEN) ---
    PASS: 59/59
    exit=0
```

结论：**新用例真的能失败**——回滚后精确变红 2 条、exit=1；还原后 59/59、exit=0。诚实标注：6 条新例中只有 2 条由 16d 直接决定（`$x=rm; …`、`$x = rm; …`），这是本修复的有效性证据；另 4 条是对照/护栏（`$x="rm -rf …"` 与 `Remove-Item` 变体改前已由其它规则 deny，加进来是防止回退成 allow；`echo hello`/`git status` 是 allow 对照组）。回滚态哈希 `40185A84…` 与上一棒记录的「改前原始哈希」一致，说明改动是外科式的。

## 5. 六副本一致性 / BOM / 语法（本轮实测，实验之后复测）

| 文件 | SHA256 | BOM | 字节 |
|---|---|---|---|
| `agent-risk-guard-audit/scripts/dangerous-commands.ps1`（主源） | `D6D726D20288C2AFE602BE488D17A6C05F90DB1C46E4A78BC2E2A6A99FBCA9CA` | True | 24004 |
| `agent-risk-guard/assets/hooks/dangerous-commands.ps1` | 同上 | True | 24004 |
| `agent-risk-guard/skills/agent-risk-guard/scripts/dangerous-commands.ps1` | 同上 | True | 24004 |
| `C:\Users\Satanchen\.claude\hooks\dangerous-commands.ps1` | 同上 | True | 24004 |
| `C:\Users\Satanchen\.codex\hooks\dangerous-commands.ps1` | 同上 | True | 24004 |
| `C:\Users\Satanchen\.gemini\config\hooks\dangerous-commands.ps1` | 同上 | True | 24004 |

`distinct hashes = 1 (ALL IDENTICAL)`；universal 两处（主源 + skills 副本）同为 `13FEB6CCA35710909783EAD23DCD73C6CAA8CDAA899616DC0205DFB93D9796BB`、BOM=True、17685 字节，`distinct = 1`。

关于「重新同步」：本轮回滚实验只写 canonical 主源，5 份副本从未被触碰；实验后复测六份 **hash 完全一致、BOM 全为 True**，即终态已满足「六副本一致」，故**没有再执行一次覆盖式 Copy-Item**——内容是逐字节相同的，重写只会刷新生产 hook 的 mtime，并给正在运行的 cc/codex/agy 会话带来无谓的「读到半个文件」窗口。主源 mtime 因回滚实验变为 07:20:00，但内容与被替换前逐字节相同（SHA 已证）。

语法检查（`Parser::ParseFile`）：canonical 与 universal 在 **pwsh 7.6.6 与 PS 5.1 下 syntaxErrors 均为 0**（BOM 在，中文字面量不再引发 5.1 解析错误）。
POSIX 括号类扫描：`agent-risk-guard-audit` 全树 9 个 `.ps1` 计数为 0。

## 6. 跨端行为矩阵（本轮重跑 `_g4_evidence.ps1` 与 `_g4_sh_probe.sh`）

| 探针 | pwsh7 | ps5.1 | sh（WSL） |
|---|---|---|---|
| `$x=rm; $x -rf /tmp/t` | deny | deny | deny |
| `$x = rm; $x -rf /tmp/t` | deny | deny | deny |
| `$x="rm -rf /tmp/t"; $x` | deny | deny | deny |
| `$x=Remove-Item; $x -Path C:\temp -Recurse -Force` | deny | deny | deny |
| `$x=rm --help` | deny | deny | deny |
| `$x = rm -h` | deny | deny | deny |
| `\rm -rf /tmp/t` | deny | deny | deny |
| `r\m -rf /tmp/t` | deny | deny | deny |
| `/rm -rf /tmp/t` | deny | deny | deny |
| `echo hello` | allow | allow | allow |
| `git status` | allow | allow | allow |

11 条探针在 ps1 两引擎与 sh 端**判定完全一致**，`$x=rm` 类变量间接删除向量在 Windows 端不再漏拦。

## 7. 未解决问题 / 风险

### 7.1 【需裁决】任务卡「错误场景」与「跨端一致」冲突（本轮已独立复核）

任务卡 §错误场景把 `$x=rm --help`、`$x = rm -h` 列为应 allow 的「无害帮助」。实测（§6）**三端一致 deny**：16d 首分支 `=\s*"?rm(\s|"|;|$)` 是非锚定匹配，命中 `=rm ` 即成立，不带 `-h/--help/--version` 豁免；sh 端同规则也一样，且改前就是 deny。本轮严格按「保持原有语义与分支结构」执行、未加豁免。处置选项（留给 Orchestrator/Evaluator）：
1. **接受现状（推荐）**：把任务卡该条改为「deny，与 sh 一致」——「把 rm 赋给变量再执行」本身就应拦，`--help` 只是尾巴，且改 sh 会违反「不得改变 sh 判定」的约束；
2. ps1 与 sh **同时**加 `-h/--help/--version` 豁免（跨端仍一致，但超本卡范围，需评估 `$x=rm --help; $x -rf /` 这类真绕过）；
3. 只在 ps1 加豁免 → 制造新的跨端不一致，不建议。

### 7.2 bypass 套件编码缺陷（沿袭，本轮已定位到行）

见 §2.1。修法明确（首行加 `#` + 补 BOM），但会改变既有基线数字，本轮未动。

### 7.3 【范围外，仅记录】仍含 POSIX 括号类的快照

`agent-risk-guard-audit-xhs-publish/scripts/dangerous-commands.ps1`（6 处，sha `0B836D6D…`）与同目录 `dangerous-commands-universal.ps1`（6 处，sha `9BB6374D…`）。二者不在本卡 6 份清单内，且前者与 canonical 本就漂移（`0B836D6D ≠ 40185A84`），判定为**另一状态的发布快照**而非活镜像，未同步。若验收口径是「工作区内所有 ps1 的 POSIX 类必须为 0」，需 Orchestrator 明确授权（会改动其它任务产物的哈希）。

### 7.4 【口径提醒】诊断脚本内含 POSIX 字面量，会污染「全工作区 grep 归零」

`tasks/orchestrator/_g4_debug1.ps1`、`_g4_debug2.ps1`、`_g4_rollback_probe.ps1` 以及本轮新增的 `tasks/.tmp/g4v/probe.ps1` 里**把 `[[:space:]]` 当测试数据**保存（回滚实验必须写入该字面量）。它们不是 hook 规则文件。建议验收口径写成「**hook 规则与分发包内的 ps1**」而非全工作区 grep，否则会误报。agy 变体（生产 + 工作区共 3 份）实测 POSIX 计数为 0。

### 7.5 其它

- universal 与 canonical 的内容漂移（432 行 vs 354 行）仍在，属 G3 单源收敛范围。
- 生产 hook 目录里的 `html-anything-server.ps1`、`hook-calls.log` 等与本卡无关，未触碰。
- 本轮未修改任何 `.sh`、未修改任何 `.json`。

## 8. 复现命令与证据文件

本轮验证脚本与原始输出（保留供 Evaluator 复核，未删除）：

| 文件 | 用途 |
|---|---|
| `tasks/.tmp/g4v/run-suites.ps1` | 在当前引擎跑 4 套 ps1 并汇总（`-Label`） |
| `tasks/.tmp/g4v/out-suite-pwsh7.txt` / `out-suite-ps51.txt` | 双引擎 4 套件原始输出 |
| `tasks/.tmp/g4v/probe.ps1` | 回滚 → 变红 → 逐字节还原 → 变绿（含 SHA/BOM 复核） |
| `tasks/.tmp/g4v/out-probe-pwsh7.txt` | 回滚实验原始输出 |
| `tasks/.tmp/g4v/decode-diff.ps1` | UTF-8 vs ANSI-936 解码行数差异（§2.1 机制证据） |
| `tasks/.tmp/g4v/final-check.ps1` / `out-final-*.txt` | 六副本 hash/BOM + 双引擎语法检查 |
| `tasks/.tmp/g4v/posix-scan.ps1` / `out-posix-scan.txt` | 全树 POSIX 括号类扫描 |
| `tasks/.tmp/g4v/misc-check.ps1` | 测试文件 BOM/首行注释/行数 |
| `tasks/.tmp/g4v/out-sh-probe.txt`、`out-evidence-*.txt` | 跨端 11 探针输出 |

```powershell
# 4 套 ps1（双引擎）
& 'tasks\.tmp\g4v\run-suites.ps1' -Label pwsh7
& 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -NoProfile -ExecutionPolicy Bypass -File 'tasks\.tmp\g4v\run-suites.ps1' -Label ps5.1
# 测试有效性（回滚变红 / 还原变绿；finally 保证逐字节还原）
& 'tasks\.tmp\g4v\probe.ps1'
# 终态核验
& 'tasks\.tmp\g4v\final-check.ps1'
```

```bash
wsl -d Ubuntu -- bash "/mnt/e/DeepSeek_Harness/workspace/2026_08_21/agent-risk-guard-audit/tests/sh-hook-test.sh"    "/mnt/e/DeepSeek_Harness/workspace/2026_08_21/agent-risk-guard-audit/scripts/dangerous-commands.sh"
wsl -d Ubuntu -- bash "/mnt/e/DeepSeek_Harness/workspace/2026_08_21/agent-risk-guard-audit/tests/sh-audit-edge.sh"   "/mnt/e/DeepSeek_Harness/workspace/2026_08_21/agent-risk-guard-audit/scripts/dangerous-commands.sh"
wsl -d Ubuntu -- bash "/mnt/e/DeepSeek_Harness/workspace/2026_08_21/agent-risk-guard-audit/tests/sh-audit-bypass.sh" "/mnt/e/DeepSeek_Harness/workspace/2026_08_21/agent-risk-guard-audit/scripts/dangerous-commands.sh"
```

## 9. 一句话结论

规则 16d 的 `[[:space:]]` 死代码已改为 `\s`，canonical + universal 共 8 份文件哈希一致、BOM 完好、双引擎语法零错；4 套 ps1 在 pwsh7/ps5.1 下 37-8-20(18)-59 全绿、sh 三套 67/40/192 全绿；回滚实验证明新用例**真的会变红**（57/59、exit=1），还原后 59/59 且原文件逐字节复原。唯一需裁决项是 `$x=rm --help` 应 deny（现状，与 sh 一致）还是应 allow（任务卡字面预期）。
