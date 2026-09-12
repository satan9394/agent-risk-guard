# EVALUATION_RESULT — G15b 独立验收（脱敏残留与三端对齐）

- Evaluator：独立验收 Agent（**未参与 G15b 实现**，不继承 Implementer 上下文）
- 日期：2026-09-11
- 预设立场：「实现可能存在错误」——全部结论基于**我自己跑的原始输出**
- 验收对象：
  - `agent-risk-guard/packages/core/src/redact.ts`（canonical，sha `A6B52316BC74C7AE…`，8870 B）
  - `agent-risk-guard-audit/scripts/dangerous-commands.ps1`（sha `EA71C7CBF32251BB…`，31397 B，BOM=True）
  - `agent-risk-guard-audit/scripts/dangerous-commands.sh`（sha `1D2E93F337B8DDBF…`，20443 B，无 BOM）
  - `agent-risk-guard/packages/core/test/redact-parity.test.ts`
- 环境：Windows；pwsh 7.6.6；Windows PowerShell 5.1.26100.9444；WSL Ubuntu bash；node v24

---

## 结论：**REJECT**

**一句话**：ps1 端四类残留已真修好，但 **sh 端生产路径根本没接上新脱敏**——新增的 13 条 `redact_text()`
只有测试入口 `--redact-stdin` 会调用，真正在生产中回显命令的 `redact_cmd()` **一行未改**，
四类残留密钥在 sh 钩子的 deny 输出里**全部明文泄漏**。而 parity 测试恰好也只测 `redact_text`，
所以**它对"生产路径坏掉"完全无感（恒绿）**，给出了虚假的安全保证。

| # | 必查项 | 结果 |
|---|---|---|
| 1 | 四类残留在 ps1 与 sh 两端均脱敏 | **FAIL**（ps1 PASS / **sh FAIL**） |
| 2 | parity 测试真实性 + 我的变异验证 | **PASS（有重大保留）**（真 spawn；M1 变红；但 M2 证明它不覆盖生产路径） |
| 3 | 三端语义集合逐条比对 | **FAIL**（sh 生产语义集合 = 旧 2 条，非 13 条） |
| 4 | 无倒退 / CHANGED=0 | **PASS**（68 条对照 CHANGED=0） |
| 5 | 副本 SHA/BOM + POSIX ERE | **FAIL**（副本 PASS；**sh 生产路径含 GNU-only sed `I` 标志**） |
| 6 | §11 九项未解决问题逐条判定 | 见第 6 节（**2 项必须打回**） |
| 7 | 368 测试真实性 | **PASS**（368/368 含新增 8；但见 D2 测试覆盖盲区） |

---

## 1. 关键缺陷（D1，P0，REJECT 依据）

### `redact_cmd()` 未被接入 `redact_text()`——sh 端生产路径零脱敏

`dangerous-commands.sh` 里 `redact_text()`（L63-79，13 条 POSIX ERE）**只有**测试入口会调用：

```
L63:  redact_text() {        ← 定义
L83:  if [ "${1:-}" = "--redact-stdin" ]; then
L84:      redact_text         ← 唯一调用点（测试入口）
L161: redact_cmd() {          ← 真正的生产函数
```

而生产出口 `deny_command()`（L172）调的是 `redact_cmd()`，其函数体（L161-167）**仍是 G15b 之前的旧实现**：

```sh
redact_cmd() {
    local safe
    safe=$(printf '%s' "$cmd" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\r/\\r/g' | tr '\n' ' ')
    safe=$(printf '%s' "$safe" | sed -E 's/(api[_-]?key|token|secret|password|credential|authorization)[=:][[:space:]]*[A-Za-z0-9._~+\/-]{4,}/\1=[REDACTED]/Ig')
    safe=$(printf '%s' "$safe" | sed -E 's/(AKIA[0-9A-Z]{16}|...|Bearer[[:space:]]+[A-Za-z0-9._~+\/-]{20,})/[REDACTED]/g')
    printf '%s' "$safe"
}
```

即：**先转义后脱敏**（报告 §5 声称已改成"先脱敏后转义"）、**仅 2 条规则**、**不含哨兵**、**不含 `-p`/`-u`/空格键值/引号含空格值**。

> **报告 §5 的表述与代码不符**：§5 写「`redact_cmd()` 改为 `tr '\n' ' '` → `redact_text` → JSON 转义」。
> 实测该行 `tr` 本就存在，`redact_text` **从未被接入**。这是本次 REJECT 的直接原因，也是证据质量问题。

### 实测：真实 deny 路径四类残留全部明文泄漏（sh），ps1 全部脱敏

方式：真实 spawn 子进程 + JSON 喂**进程 stdin**（非 `-Cmd` 捷径），命令同时含密钥与触发 deny 的 `rm -rf`。
判定：在 hook 输出的 `systemMessage` 里搜明文子串。

| 载荷 | 明文片段 | **ps1 实测** | **sh 实测** |
|---|---|---|---|
| `aws configure set aws_secret_access_key TESTFIXTUREsecretVALUE/...; rm -rf /tmp/t` | `TESTFIXTUREsecretVALUE0000000000000000` | ok（`aws configure set [REDACTED]`） | **LEAK（无 `[REDACTED]`）** |
| `rm -rf /tmp/t --password="correct horse battery staple"` | `correct horse battery staple` | ok（`--[REDACTED]`） | **LEAK** |
| `mysql -pSup3rS3cret -e "select 1"; rm -rf /tmp/t` | `Sup3rS3cret` | ok（`mysql [REDACTED]`） | **LEAK** |
| `curl -u alice:hunter2 https://example.com; rm -rf /tmp/t` | `alice:hunter2` | ok（`curl [REDACTED]`） | **LEAK** |

sh 原始输出（节选，逐字）：

```
{"hookSpecificOutput":{"permissionDecision":"deny","updatedInput":null},"systemMessage":"HOOK BLOCKED: rm is permanent deletion. Use trash command.\nCommand: aws configure set aws_secret_access_key TESTFIXTUREsecretVALUE0000000000000000; rm -rf /tmp/t\nUse trash/recycle bin instead of permanent deletion."}
```

→ 直接违反**验收标准 1**（「在 **ps1 与 sh 两端**日志/回显中均出现 `[REDACTED]` 且无明文」）。
ps1 端同一路径实测 PASS（其 `Deny-Command` L128 确实调用 `Redact-Secrets $script:curCmd`）。

---

## 2. 关键缺陷（D2，parity 测试形同虚设——正是简报要求"特别标注"的一类）

parity 测试**确实真实执行三端**（代码层面确认：`spawnSync('powershell.exe', … -RedactFile)` L100-104、
`spawnSync('wsl.exe', … --redact-stdin)` L135-139，不是比字符串常量）。我自己的变异验证：

| 变异 | 手法（隔离 TEMP 副本，原件零写入） | parity 结果 |
|---|---|---|
| **A. 基线** | 原件 | **[GREEN] exit=0** |
| **B. M1** | 从 sh `redact_text` 删掉 `aws-space` 规则（17491 → 17376 B） | **[RED] exit=1**，`AssertionError: 三端输出不一致（共 3 处）` |
| **C. M2** | **只把 sh 生产函数 `redact_cmd()` 改成直通**（`redact_text` 原封不动） | **[GREEN] exit=0** ← 闸门无感 |

M2 变异体的**真实生产输出**（同一份 hook，走 deny 路径）：

```
Command: mysql -pSup3rS3cret -e "select 1"; rm -rf /tmp/t      ← 明文，且 parity 判 GREEN
```

**结论**：`redact-parity.test.ts` 守的是 sh 端**生产环境永不调用的** `redact_text`，
因此它既能通过、又对"生产路径完全失效"零告警。简报 §2 要求的「变异必须变红」在**被测函数范围内成立**
（M1 变红），但该闸门**不能证明 sh 端在生产中真的脱敏**——这是必须打回的覆盖盲区，不是可选改进。

另：`assert` 用的是 `core === ps1 === sh` 的**输出一致**，比"命中集合一致"更强（这一点实现者的说法成立）。

---

## 3. 其余缺陷

### D3（P1）sh 生产路径含 GNU-only `sed` `I` 标志，违反 POSIX ERE 纪律

```
dangerous-commands.sh:164:  ... sed -E 's/(api[_-]?key|...|authorization)[=:].../\1=[REDACTED]/Ig'
```
`I` 是 GNU sed 扩展；BSD/macOS 自带 sed 不支持 → 该条规则在 macOS 上**静默失效**。
文件头 L21 自述「不使用 sed 的 GNU-only `I` 标志」，但生产函数里仍然留着。
（新增的 `redact_text()` 用的是运行时 `[Pp][Aa]…` 大小写类，写法是干净的；问题只在旧的 `redact_cmd`。）

### D4（P1）`-p` 全数字密码明文入日志——报告列为"取舍"，但它是真实泄漏面

实测（**ps1 与 sh 两端、以及 core 语义**均不匹配）：

| 载荷 | ps1 | sh | 说明 |
|---|---|---|---|
| `mysql -p12345678 -e "select 1"; rm -rf /tmp/t` | **LEAK** | **LEAK** | §11-1 自认 |
| `curl --user alice:hunter2 …` | **LEAK** | **LEAK** | §11-2 自认（`--user` 未覆盖） |
| `mysql -PS3cret …` | **LEAK** | **LEAK** | §11-2 |
| `ssh -i /home/u/.ssh/id_rsa host; rm -rf /tmp/t` | **LEAK** | **LEAK** | §11-2 |
| `rm -rf /tmp/t --password="a\"b"` | 部分脱敏 `--[REDACTED]b\"` | **LEAK（完全不脱敏）** | §11-4 + D1 叠加 |

`-p12345678` 是**最常见的弱口令形态**，且 `mysql -p***` 是 task 卡点名的场景类别。三端一致地不脱敏
≠ 可接受——它意味着"mysql 短参"这一类只解决了一半。建议用命令上下文限定（`mysql`/`mariadb` 之后）
而不是用"值须含非数字"这个启发式。

### D5（P2）多块 PEM 的跨端差异已确认（§11-3），但**不在 parity 语料内**

我自己实测（走真实入口 `-RedactFile` / `--redact-stdin`）：

```
single: ps1 = [REDACTED]                       sh = [REDACTED]                       ps1===sh : True
multi : ps1 = [REDACTED] mid-secret [REDACTED] sh = [REDACTED]                         ps1===sh : False
```

sh 因 `tr '\n' ' '` 折叠单行后用贪婪 `.*`，从第一个 BEGIN 吞到**最后一个** END。
方向是**过度脱敏**（保守），可接受；但 parity 语料只含单块 PEM，**该分歧不被闸门覆盖**。

---

## 4. 逐项检查表（含我自跑命令与输出）

### 4.1 第 1 项：四类残留在 ps1 / sh 两端脱敏 —— **FAIL（sh 端）**

见第 1 节。ps1 **PASS**，sh **FAIL**。

### 4.2 第 2 项：parity 测试真实性 —— **PASS（有重大保留）**

- 真实执行三端：**是**。代码审查：ps1 走 `spawnSync powershell.exe -RedactFile`；sh 走 `spawnSync wsl.exe --redact-stdin`；
  core 直接 `import '../src/redact.ts'`。三端都用**真实生产函数入口**（ps1 的 `-RedactFile` 与 sh 的 `--redact-stdin` 都是本轮新增的**测试专用入口**）。
- 语料规模：**23 条**（13 含密钥 + **10** 无误伤对照）→ 满足 ≥12 / ≥5。
- 我的变异验证：**M1（删被测规则）→ RED exit=1**；`MUTATION-VERIFY` 在被测函数范围内成立。
- **保留意见**：**M2（破坏生产路径）→ 仍 GREEN**，见第 2 节。故该测试**不能作为"sh 端生产脱敏有效"的证据**。

### 4.3 第 3 项：三端语义集合逐条比对 —— **FAIL**

| 语义 | core `SECRET_RULES` | ps1 `RedactRules` | sh `redact_text`（测试入口） | **sh 生产 `redact_cmd`** |
|---|---|---|---|---|
| 规则条数 | 13 | 13 | 13 | **2** |
| aws-access-key-id / github-pat / openai-sk / anthropic / jwt / pem | 有 | 有 | 有 | **仅 AKIA/gh/sk** |
| 空格键值（`aws_secret_access_key V`） | 有 | 有 | 有 | **无** |
| 引号含空格值 | 有 | 有 | 有 | **无** |
| `-p<v>` / `-u u:p` | 有 | 有 | 有 | **无** |
| generic 键名（token/credential/passwd…） | 有 | 有 | 有 | **部分（`[=:]` 形态）** |
| long-random ≥40 | 有 | 有 | 有 | **无** |
| 哨兵防二次命中 | 有 | 有 | 有 | **无** |
| 替换保留键名 | 整段 | 整段 | 整段 | **保留键名** |

→ **测试入口层面三端已对齐（PASS）；生产层面 sh 仍是旧 2 条（FAIL）**。
简报 §3 要求「不得以移植性为借口漏掉形态」——此处不是移植性问题，而是**接线遗漏**。

### 4.4 第 4 项：无倒退 / CHANGED=0 —— **PASS**

我独立做的 before/after 判定对照（before = `git show HEAD:assets/hooks/dangerous-commands.ps1`，
sha `252D9CF70F7839D9…` / 28183 B；after = 主源 `EA71C7CB…` / 31397 B），**真实 spawn + stdin**：

```
DECISION-DIFF: total=68  CHANGED=0
```

68 条覆盖删除类 / 回收站类 / git 破坏类 / 包装与插词绕过 / 全角 / 纯注释 / 四类残留命令本身 / 常规放行。
独立复现了报告 §9 的 `total=65 CHANGED=0`（我用 68 条，结论一致）。

**无误伤逐字不变**（真实 stdin，pwsh）：`echo hello` / `git status` / `ls -la` / `npm run build --prefix packages/core` /
`ssh -p2222 host` / `mkdir -p /tmp/empty_dir` / `sudo -u root whoami` / `docker run -p 8080:80 nginx` → 全部 allow、输出为空（逐字不变）。
parity 测试内也断言了这 10 条 core 输出 `=== 原文` 且 `hits.length === 0`。

### 4.5 第 5 项：副本 SHA/BOM + POSIX ERE —— **FAIL（ERE 部分）**

**ps1 六副本**（全部 `EA71C7CBF32251BB…` / 31397 B / **BOM=True** / CR=0，`distinct = 1`）：PASS
`audit/scripts`、`rg/assets/hooks`、`rg/skills/…/scripts`、`~/.claude/hooks`、`~/.codex/hooks`、`~/.gemini/config/hooks`

**sh 三副本**（全部 `1D2E93F337B8DDBF…` / 20443 B / 无 BOM / LF，`distinct = 1`）：PASS
`audit/scripts`、`rg/skills/…/scripts`、`audit-xhs-publish/scripts`
（`rg/assets/hooks/` 下确无 `.sh`，任务卡"四副本"有误 → 报告已勘误，实测 3 份，**认可**）

**core**：`redact.ts` sha `A6B52316BC74C7AE…` / 8870 B。

**POSIX ERE 合规**：新增 `redact_text()` **干净**（用 `[[:space:]]` + 运行时 `[Pp][Aa]…` 大小写类，无 `\b`/`\s`/lookaround，兼容 bash 3.2）；
但**生产 `redact_cmd()` L164 仍含 GNU-only `sed` `I` 标志** → 见 D3。另有 L277 `${CMD_SEG}diskpart\b` 使用 GNU grep 的 `\b`
（**属 G15b 之前的既有代码**，非本次引入，一并记录）。

### 4.6 第 7 项：测试真实性 —— **PASS**

| 套件 | 我自跑结果 |
|---|---|
| `node --test "packages/*/test/*.test.ts" "tests/*/*.test.ts"` | **tests 368 / pass 368 / fail 0**（exit 0） |
| ps1 `hook-rules-test.ps1` | 37 PASS / 0 FAIL，exit 0 |
| ps1 `hook-fp-regression.ps1` | 8 PASS / 0 FAIL，exit 0 |
| ps1 `hook-bypass-regression.ps1`（pwsh7） | 20 PASS / 0 FAIL，exit 0 |
| ps1 `hook-audit-reregress.ps1` | `PASS: 59/59`，exit 0 |
| ps1 `hook-redact-test.ps1` | **89/89**，0 FAIL，exit 0 |
| sh `sh-hook-test.sh` | `PASS: 67/67`，exit 0 |
| sh `sh-audit-edge.sh` | `TOTAL: 40 PASS: 40 FAIL: 0`，exit 0 |
| sh `sh-audit-bypass.sh` | `TOTAL: 192 PASS: 192 FAIL: 0 / ALL PASS`，exit 0 |

- 368 确实**含**新增的 8（`redact.test.ts` 7 + `redact-parity.test.ts` 1），与报告一致；非恒绿（M1 可使其变红，且回滚 16d 亦可使 reregress 变红，见我的 G4 复验）。
- 断言强度：core 侧对 13 条密钥断言"必含 `[REDACTED]`"、对 10 条对照断言"逐字不变 + hits 为空"，**不是**仅判存在性。
- **但**：`hook-redact-test.ps1`（89）与 parity 都**只走测试入口**，没有一条断言覆盖 sh 的 `redact_cmd()` 生产出口 → 见 D2。

---

## 5. 特别标注（简报点名要求）

| 项 | 结论 |
|---|---|
| **仍未脱敏的形态** | ① **sh 端全部四类残留（生产路径）**；② 两端 `-p<全数字>`、`--user u:p`、`-P<v>`、`ssh -i`；③ sh 端引号内含转义引号的值完全泄漏 |
| **判定回归** | **无**。68 条 before/after `CHANGED=0`，四套 ps1 + 三套 sh 全绿 |
| **parity 测试形同虚设** | **部分成立**——它真实执行三端且对"删规则"敏感（M1 红），但**不覆盖 sh 生产出口**（M2 绿），因此对本次最严重的缺陷零告警 |
| **副本不一致** | **无**。ps1 6/6、sh 3/3 各自 SHA 唯一，BOM 状态正确 |

---

## 6. §11 九项未解决问题逐条判定

| # | 报告中的问题 | 我的判定 | 理由 |
|---|---|---|---|
| 1 | 全数字密码 `-p12345678` 不脱敏 | **必须打回（P1）** | 实测两端明文入 deny 输出；`mysql -p<pass>` 是任务卡点名场景，弱口令是最常见形态。建议改为命令上下文限定（`mysql|mariadb` 之后）而非"值须含非数字" |
| 2 | 短参覆盖有限（`--user`/`-P`/`--auth`/`-i`） | **必须打回（P1，至少 `--user`）** | `--user u:p` 与已覆盖的 `-u u:p` 是**同一语义**，只补短参不补长参属明显不对称；实测明文泄漏 |
| 3 | 多块 PEM 的 sh 贪婪差异 | **可接受取舍**（但须补语料） | 我实测确认分歧存在，方向是**过度脱敏**（安全侧）；但 parity 语料只有单块，需加一条多块用例并在断言中显式豁免 |
| 4 | 引号内转义引号提前闭合 | **可接受取舍**（但 sh 侧被 D1 放大） | ps1 部分脱敏、core 同构；sh 因未接新函数而**完全不脱敏**——属 D1 的后果，修 D1 后回到"部分脱敏" |
| 5 | 哨兵纪律靠人守、无自动断言 | **可接受取舍（建议加测试）** | 哨兵设计正确且三端一致（我的 R1 用例输出 `aws configure set [REDACTED]` 无多余 `]`，佐证有效）；建议补一条"新增规则不得直写 `[REDACTED]`"的单测 |
| 6 | sh 每调用多约 15 次 `tr` | **可接受取舍** | 三套 sh 回归全绿（67/40/192），无功能影响；属性能优化项 |
| 7 | `dist/agent-risk-guard-v0.*` 未重建 | **可接受（有条件）** | 需确认 dist 不被 agent 直接加载；若会被加载则升级为必修。本轮未验证其注册状态，**标注为未独立验证** |
| 8 | 生产日志仍有历史明文（`%TEMP%\riskguard-hook-calls.log`） | **接受现状** | 按纪律**未清理**；属 G15 遗留，非本卡范围，但应在后续卡中处理（用户确认后进回收站） |
| 9 | 七个 ps1 变体未对齐（universal/agy/xhs） | **可接受取舍** | 与我在 G4 复验中的观察一致（xhs 快照仍有 6 处 POSIX 类）；G15 已实测未注册，非活跃面 |

---

## 7. 最小复现（REJECT 依据）

```powershell
# 1) 真实 spawn 子进程 + JSON 喂进程 stdin（不要用 -Cmd，也不要用同进程管道）
$cmd  = 'mysql -pSup3rS3cret -e "select 1"; rm -rf /tmp/t'
$json = '{"tool_name":"Bash","tool_input":{"command":' + (ConvertTo-Json $cmd -Compress) + '}}'
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName  = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'   # ps1 端对照
$psi.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "...\agent-risk-guard-audit\scripts\dangerous-commands.ps1"'
$psi.RedirectStandardInput=$true; $psi.RedirectStandardOutput=$true; $psi.UseShellExecute=$false
$p=[System.Diagnostics.Process]::Start($psi); $p.StandardInput.Write($json); $p.StandardInput.Close()
$p.StandardOutput.ReadToEnd()      # → ps1: mysql [REDACTED] -e ...      ✅

# 2) sh 端（WSL）
#    printf '%s' '<上面的 JSON>' | bash /mnt/e/.../agent-risk-guard-audit/scripts/dangerous-commands.sh
#    → Command: mysql -pSup3rS3cret -e "select 1"; rm -rf /tmp/t        ❌ 明文泄漏
```

一键复现脚本（我自建，非交付物）：`agent-risk-guard/tasks/.tmp/g15b/leak-probe.ps1` → `out-leak-probe.txt`

## 8. 修复建议（最小改动）

1. **把 `redact_cmd()` 改为调用 `redact_text()`**（这是本次唯一的结构性修复）：
   ```sh
   redact_cmd() {
       printf '%s' "$cmd" | tr '\n' ' ' | redact_text \
         | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\r/\\r/g'
   }
   ```
   同时删掉 L164 的 GNU-only `I` 标志写法（D3 一并消除）。
2. **把 parity 闸门钉到生产出口**：新增一条断言，直接调用（或断言）`deny_command` 的 **systemMessage** 对四类残留不含明文——
   即"改坏 `redact_cmd` 必须变红"。否则 M2 这类缺陷还会再次静默通过。
3. **补 `--user u:p` 长参**，并处理 `-p<全数字>`（建议上下文限定到 `mysql|mariadb`）。
4. 修完后重跑：`node --test`(368)、ps1 五套(37/8/20/59/89)、sh 三套(67/40/192)、六副本/三副本 SHA+BOM。

## 9. 我的证据文件（均为第二方自建，非交付物）

目录：`agent-risk-guard/tasks/.tmp/g15b/`

| 文件 | 用途 |
|---|---|
| `leak-probe.ps1` / `out-leak-probe.txt` | **D1 决定性证据**：四类残留在 ps1(脱敏)/sh(明文) 真实 deny 路径对照 |
| `mutation.ps1` / `out-mutation.txt` | **D2 决定性证据**：M1 红（删规则）/ M2 绿（破坏生产路径）；原件 SHA 复核未变 |
| `arch-check.ps1` / `out-arch.txt` | ps1 六副本 / sh 三副本 SHA+BOM+CR；ERE/GNU-only 扫描；ps1 五套件 |
| `decision-diff.ps1` / `out-decision-diff.txt` | 68 条 before(`git show HEAD`)/after 判定 `CHANGED=0` |
| `residual-probe.ps1` / `out-residual.txt` | §11-1/2/4 残留形态双端实测（全数字 `-p`、`--user`、`-P`、`ssh -i`） |
| `pem-probe.ps1` / `out-pem.txt` | §11-3 多块 PEM：`ps1 = [REDACTED] mid-secret [REDACTED]` vs `sh = [REDACTED]` |

**纪律声明**：全程只读 + 隔离 TEMP 副本实验；未修改任何被审文件（脚本内 SHA before/after 比对
`unchanged=True`：sh `1D2E93F3…`、ps1 `EA71C7CB…`）；未真实执行任何危险命令（只喂 JSON 文本）；
未清理任何真实日志（`%TEMP%\riskguard-hook-calls.log` 未触碰）。

---

## 10. 最终裁决

**REJECT。** 理由不是"覆盖面还不够完美"，而是**验收标准 1 在 sh 端直接不成立**：
新增的 13 条 `redact_text()` 在生产中从未被调用，`redact_cmd()` 仍是旧的 2 条 GNU-only 实现，
四类点名残留（含 `aws_secret_access_key` 空格形态、`--password="含 空格"`、`mysql -p<v>`、`curl -u u:p`）
在 sh 钩子的 deny 输出里**全部明文泄漏**，且 parity 闸门对此**恒绿无感**。

ps1 端、副本一致性、判定零改动、全部回归套件均 PASS，修复面很小（D1 一处接线 + D3 一处 sed 写法 +
闸门补一条生产出口断言），修完可快速复验。
