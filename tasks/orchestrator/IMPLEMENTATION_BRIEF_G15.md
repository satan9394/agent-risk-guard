# IMPLEMENTATION_BRIEF — G15：ps1 hook 密钥明文泄漏（P0 安全）

- 生成：2026-09-11 · Orchestrator Round 20（切片 #4）
- 来源：PRODUCT_GAP_MAP G15（P0）；审计 D-F5
- 编排器实证（本轮亲查代码，ps1 在 G4 后为 432 行）：
  - L36：`$hookLog = Join-Path $env:TEMP 'riskguard-hook-calls.log'`
  - L37-42：`Write-HookLog`（直接 Add-Content，无脱敏、无大小上限、无轮转）
  - L45：deny 路径 `Write-HookLog 'deny' $reason`
  - **L53**：deny 输出 `systemMessage` 内嵌 `$($script:curCmd)` —— **完整原文命令**（含密钥）进入 agent 上下文与 UI
  - **L431**：`Write-HookLog 'allow' $cmd` —— **所有** allow 命令全文入日志（`curl -H "Authorization: Bearer …"`、`npm publish --token=…` 等）
  - 对照：sh 有 `redact_cmd()`（`dangerous-commands.sh:90-96`）、TS 有 `packages/core/src/redact.ts`（8 类模式）——**唯 ps1 无任何脱敏**

## 目标
ps1 hook 不再把明文密钥写入日志或回显给 agent：日志与 `systemMessage` 出口一律先脱敏；日志加大小上限/轮转，避免长期累积成明文凭据库。**判定逻辑不变**（脱敏只作用于输出侧）。

## 用户场景
1. 用户（或 agent）执行含 token 的命令（`curl -H "Authorization: Bearer sk-..."`、`npm publish --token=...`、`aws configure set aws_secret_access_key ...`）→ 命令被 allow，**完整密钥写进 `%TEMP%\riskguard-hook-calls.log`**，同机任何进程可读，长期累积。
2. 命令被 deny 时，`systemMessage` 把含密钥的完整命令**回显进 agent 对话上下文**，进而可能进入会话记录/转录。

## 理想行为
1. **日志脱敏**：`Write-HookLog` 写盘前对命令/原因做脱敏（allow 与 deny 路径都覆盖）。
2. **回显脱敏**：`Deny-Command` 的 `systemMessage` 中命令文本先脱敏再嵌入。
3. **模式对齐**：脱敏模式应覆盖 `packages/core/src/redact.ts` 的核心类（AWS AKIA/ASIA、GitHub `gh[pousr]_`、`sk-`/`sk-ant-`/`sk-proj-`、JWT `eyJ…`、PEM 私钥块、`password=`/`api_key=`/`token=`/`client_secret=` 键值、`Authorization: Bearer …`、≥40 位长随机串），并与 sh `redact_cmd` 保持语义一致（三端同源纪律；差异须在注释说明）。
4. **日志卫生**：加大小上限（建议 ~1-2 MB）与轮转或截断策略，避免无限增长；写入失败不得影响 hook 判定。
5. **JSON 合法性**：脱敏后仍须正确转义（`\` `"` 换行），输出必须是合法 JSON。

## 涉及模块
- `agent-risk-guard-audit/scripts/dangerous-commands.ps1`（主源；L36-53、L431 附近）
- 同步：`assets/hooks/`、`skills/agent-risk-guard/scripts/`、生产三处（`~/.claude/hooks`、`~/.codex/hooks`、`~/.gemini/config/hooks`）
- 参考实现：`packages/core/src/redact.ts`、`agent-risk-guard-audit/scripts/dangerous-commands.sh`（redact_cmd）
- 测试：`agent-risk-guard-audit/tests/hook-*.ps1`

## 不能破坏什么
1. **判定逻辑**：allow/deny 结果不得因脱敏而改变（脱敏只在输出/日志出口）。
2. **输出 JSON 契约**：`hookSpecificOutput.permissionDecision` 等字段形状不变；CC/Codex 解析依赖。
3. 现有 ps1 四套测试全绿（当前 **37 / 20 / 8 / 59**；注意 bypass 在 PS5.1 下因测试文件无 BOM 只跑 18）。
4. **UTF-8 BOM 必须保持**（无 BOM → PS5.1 解析崩，历史踩过）。
5. 不得过度脱敏造成正常命令不可读（例：`echo hello`、普通路径、短参数不得被替换）。

## 验收标准
1. **日志脱敏可证**：用含已知密钥形态的命令（至少覆盖 `sk-…`、`AKIA…`、`password=…`、`Authorization: Bearer …`）跑 hook → **日志文件中出现 `[REDACTED]` 且不出现原密钥**。
2. **回显脱敏可证**：构造一条**会 deny** 的含密钥命令 → `systemMessage` 中密钥被替换为 `[REDACTED]`，且 JSON 可被 `ConvertFrom-Json` 解析。
3. **判定不变**：上述命令的 deny/allow 结果与改动前一致（列对照表）。
4. **日志上限生效**：可实证（如写入超过阈值后被截断/轮转，或提供可配置上限并验证）。
5. **无误伤**：普通命令（`echo hello`、`git status`、`ls -la`）日志与回显保持原样。
6. 四套 ps1 测试全绿 + 新增脱敏用例；六处副本 SHA256 一致 + BOM 保持。

## 错误场景
- 脱敏后字符串含引号/反斜杠 → 必须仍是合法 JSON（不得产生解析失败）。
- 日志文件被占用/无权限 → 不得抛错影响判定（静默降级）。
- 日志为空/不存在 → 首次写入正常创建。
- 命令本身无密钥 → 输出与改动前一致（不做无谓替换）。

## 测试要求
- 新增用例覆盖：日志脱敏（allow 路径）、回显脱敏（deny 路径）、JSON 合法性（`ConvertFrom-Json` 解析成功）、无误伤对照、日志上限。
- 测试须**真实 spawn hook**（子进程 stdin；注意本 hook 用 `[Console]::In.ReadToEnd()` 读进程 stdin，**同进程管道无效**——这是本项目已沉淀的方法学陷阱）。
- 回归：四套 ps1 测试前后数字 + 确认 sh/opencode 侧未受影响。

## 交付物
`IMPLEMENTATION_RESULT_G15.md`：改动摘要 + 脱敏前后对照（含真实日志片段与 systemMessage）+ 模式对齐说明（与 core/sh 的差异）+ 测试数字 + 六副本 hash/BOM + 未解决问题。
