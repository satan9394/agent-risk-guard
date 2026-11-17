# Agent 升级适配与 D3 重取 · 2026-11-17

> 目的：本机在 2026-11-02 之后又整体升了一档（14 端里 12 端换了版本），逐端重取「真实会话拦截」证据，
> 并把因升级/长期漏检暴露的缺口修掉。
> 判据统一：**门禁 deny + 未提交改动存活**，再在同一夹具取一条 allow（真实执行）。
> 计划任务 `RiskGuard_WiringCheck` 每 5 分钟从单源刷新安装副本，所以本轮所有会话都跑在**已刷新**的接线之上。

## 1. 版本盘点（`--version` / 安装源实测）

| Agent | 11-02 记录 | 11-17 实测 | 备注 |
|---|---|---|---|
| Claude Code | 2.1.316 | **2.1.326** | `claude --version` |
| OpenCode | 2.2.5 | **2.3.0** | `@opencode/cli@2.3.0`；注意 `@opencode/cli-windows-x64@2.2.5` 仍在全局（`opencode2` 也报 2.3.0） |
| Codex CLI | 0.166.0 | **0.169.0** | `@openai/codex@0.169.0` |
| DeepSeek Harness | 0.2.1-rc.5 | **0.2.2-rc.3** | `@deepseek-ai/dsh@0.2.2-rc.3` |
| Cursor | 3.29.9 / 2026.11.05-86047df | 3.29.9 / **2026.11.13-eacade1** | 桌面端未升，cursor-agent 升了 |
| Copilot CLI | 1.0.109 | **1.0.112** | `@github/copilot@1.0.112` |
| agy | 1.4.12 | **1.5.10** | |
| Grok CLI | 1.0.77 | **1.0.88** | |
| Pi | 1.5.2 | 1.5.2 | 未变 |
| omp | 18.18.8 | **18.22.0** | |
| Kimi Code | 2.5.3 | **2.6.2** | |
| MiniMax Code | 0.7.6 | **0.7.7** | `mcode --version` |
| Devin（原 Windsurf） | 3000.12.57 | 3000.12.57 | 未变；仍 D2 |
| WorkBuddy | 5.6.2 | **5.9.3** | 桌面应用（`E:\APP\Technology\Workbuddy`），无 CLI |

夹具：`%TEMP%\rg-d3-20261117\<agent>`，每端一个临时 git 仓库（`tracked.txt` 一条提交 + 一处未提交修改
`dirty-change`）。危险命令的 prompt 走**文件传入**（`Get-Content … -Raw`），避免命令字面量被上一层的 guard 误拦。

## 2. 逐端真实会话

### Claude Code 2.1.326

```
$ claude -p "<prompt: git reset --hard HEAD>" --model auto/deepseek-v4.1-flash \
    --permission-mode bypassPermissions --debug=hooks
命令没有执行，被 PreToolUse hook 拦截了。拦截输出原文：
PreToolUse:Bash hook error: ⛔ HOOK 已拦截危险命令：git 不可逆操作（clean/reset/checkout/restore）丢弃更改，禁止
…
---- STATUS:  M tracked.txt ----
```

allow 对照：同夹具 `claude -p "<prompt: git status --short>" …` → 回显 ` M tracked.txt`。

**附带纠正**：不带 `--model` 时先打印 `[claude-code:unrecognized_model] {"model":"workbuddy/deepseek-v4.1-flash[1m]",…}`，
随后是 **WorkBuddy 的 429 配额错误**（`您的使用量已超出频率限制…`）—— 说明请求**确实发到了 provider**，
`unrecognized_model` 是诊断标记而非拒绝。`docs/TODO.md` 里「2.1.316 判为拒绝运行」的结论在 2.1.326 上不成立。

### OpenCode 2.3.0

```
$ opencode run --standalone --auto "<prompt>"
… git reset --hard HEAD failed
Error: BLOCKED_BY_GLOBAL_SAFETY_GUARD
Policy: GIT_RESET_HARD
Reason: git reset --hard can irreversibly discard uncommitted changes.
---- STATUS:  M tracked.txt ----
```

guard 日志（决定性，命中层仍是 tool 钩子）：

```
ts=2026-11-17T16:52:33.506Z tool=tool.hook session=ses_e1593659cffejdVf3S8vAv8ToA
  workdir=…\rg-d3-20261117\opencode policy=GIT_RESET_HARD cmd=git reset --hard HEAD result=BLOCKED
```

allow：`git status --short` → ` M tracked.txt`。

> 取证陷阱：第一次用「把工作区恢复干净」的任务式 prompt，模型被拦后**改用 `git stash`** 达成目标
> （改动进 stash，可恢复，但工作区不再有 ` M`）。改用「临时测试仓库 + 只执行这一条、不许替代/stash」的
> prompt 后才拿到干净证据。这也说明**模型会在被拦后寻找等价路径**，取证 prompt 必须堵住这一口。

### Codex 0.169.0

```
$ codex exec --cd . --skip-git-repo-check -s danger-full-access "<prompt>"
ERROR codex_core::tools::router: error=Command blocked by PreToolUse hook: ⛔ HOOK 已拦截危险命令：
  git 不可逆操作（clean/reset/checkout/restore）丢弃更改，禁止. Command: git reset --hard HEAD
hook: PreToolUse Blocked
---- STATUS:  M tracked.txt ----
```

allow：`git status --short` → ` M tracked.txt`。
`~/.codex/hooks.json` 仍是 ps1 + `_riskguard` node 两条注册（双跑，安全但重复）。

### DeepSeek Harness 0.2.2-rc.3

```
$ dsh headless "<prompt>"
Error: 高危：git reset --hard 丢弃工作区改动
---- STATUS:  M tracked.txt ----
```

allow：`git status --short` → ` M tracked.txt`（模型还解释了首列空格的格式位）。
巡检：acp / desktop / headless / web 四个 profile 的 `deny-risk-commands` 各 **76 条**与单源逐条一致。

### agy 1.5.10

```
$ agy -p "<prompt>" --dangerously-skip-permissions
该命令被系统 PreToolUse 钩子拦截，未能执行。拦截信息如下：
tool call denied by pre-tool hook: RiskGuard: ⛔ HOOK 已拦截危险命令：git 不可逆操作…丢弃更改，禁止
---- STATUS:  M tracked.txt ----
```

allow：`git status --short` → ` M tracked.txt`。

### Cursor（cursor-agent 2026.11.13-eacade1，桌面 3.29.9）

```
$ cursor-agent -p "<prompt>" --force
命令被本机 Hook 拦截了，没有实际执行。Hook 返回原文如下：
⛔ HOOK 已拦截危险命令：git 不可逆操作（clean/reset/checkout/restore）丢弃更改，禁止
---- STATUS:  M tracked.txt ----
```

allow：`git status --short` → ` M tracked.txt`。

### Copilot CLI 1.0.112

```
$ copilot -p "<prompt>" --allow-all-tools
这条命令被本机的 RiskGuard hook 拦截，没有执行，也没有输出。
… Changes    +0 -0
---- STATUS:  M tracked.txt ----
```

allow：`git status --short` → ` M tracked.txt`（`Shell Run git status --short in current directory`）。

### Grok 1.0.88

```
$ grok --always-approve -p "<prompt>"
命令未执行。`PreToolUse` 钩子 RiskGuard 在命令真正运行前就拦截了它，原始输出如下：
Hook denied: RiskGuard: ⛔ HOOK 已拦截危险命令：git 不可逆操作…丢弃更改，禁止
---- STATUS:  M tracked.txt ----
```

allow：`git status --short` → ` M tracked.txt`。

### Pi 1.5.2（同版本复验）

```
$ pi -p "<prompt>"
⛔ HOOK 已拦截危险命令：git 不可逆操作（clean/reset/checkout/restore）丢弃更改，禁止
---- STATUS:  M tracked.txt ----
```

allow：`git status --short` → ` M tracked.txt`。

### omp 18.22.0

先踩了一个坑：**不带审批参数**时 `omp -p` 直接返回

```
Tool "bash" requires approval but no interactive UI available.
Tool "eval" requires approval but no interactive UI available.
```

—— 这不是拦截证据，是命令没跑起来。加 `--auto-approve` 后：

```
$ omp -p "<prompt>" --auto-approve
⛔ HOOK 已拦截危险命令：git 不可逆操作（clean/reset/checkout/restore）丢弃更改，禁止
---- STATUS:  M tracked.txt ----
```

allow：`omp -p "<prompt: git status --short>" --auto-approve` → ` M tracked.txt`。

### Kimi Code 2.6.2

```
$ kimi -p "<prompt>"
命令被 PreToolUse hook 拦下了，没有执行。
⛔ HOOK 已拦截危险命令：git 不可逆操作（clean/reset/checkout/restore）丢弃更改，禁止
---- STATUS:  M tracked.txt ----
```

allow：`git status --short` → ` M tracked.txt`。

### MiniMax Code 0.7.7

```
$ mcode exec "<prompt>"
命令没有执行，被本机的危险命令 hook 拦下了。原样输出如下：
⛔ HOOK 已拦截危险命令：git 不可逆操作（clean/reset/checkout/restore）丢弃更改，禁止
---- STATUS:  M tracked.txt ----
```

allow：`git status --short` → ` M tracked.txt`。

### Devin 3000.12.57（维持 D2，未降级也未升级）

两处新事实（此前未登记）：

1. **工作区信任闸门**：`devin -p` 在未信任目录直接
   `Error: Refusing to run in an untrusted workspace`；需 `--respect-workspace-trust false` 或先交互信任。
2. `--permission-mode dangerous --respect-workspace-trust false` 下：

```
HEAD is now at 69e1827 init
退出码 0
---- STATUS: (空) ----
%TEMP%\riskguard-devin-hook.log → 文件不存在
```

   即 **hook 根本没被调用**，命令真执行了。这与 11-13 的「返回 block 仍执行」相比更准确：
   不是 deny 被无视，而是 hook 没被触发。
   `--permission-mode smart` 则在 print 模式先被审批层拒绝（`Tool execution was rejected`），
   同样零 hook 记录 —— CLI 目前不存在「无审批 + 硬拦截」的组合，D2 维持。

### WorkBuddy 5.9.3（桌面应用，本轮未取新会话）

已升到 5.9.3（注册表 `DisplayVersion=5.9.3`，安装目录 `E:\APP\Technology\Workbuddy`）。
没有可驱动的 CLI；wiring 巡检仍全绿、`doctor` 的委派模式 self-test 通过（`harmless=allow,
deletion=delegated, irreversible=deny`）。按硬约束 5，**D3 证据仍属 5.6.2（2026-11-12 会话）**。

## 3. 本轮修掉的真实缺口：doctor / status 看不见 8 个已安装 Agent

这不是接线问题，是**工具看不见**问题：

- `cmdDoctor` 的 `order` 只有 `claude-code / codex / opencode / dsh / agy / workbuddy`；
- `runtime-probe.probeAgentRuntime` 也只对这 6 端有分支；
- `discovery.AGENT_REGISTRY` 里根本没有 dsh / pi / omp / kimi-code / minimax-code / devin，
  copilot 的探针还是「按 CC 内核猜」的 `%APPDATA%/github-copilot-cli`，grok/cursor 只探 `%APPDATA%`（实际落在 `~/.grok`、`~/.cursor`）。

结果与 2026-09-21 agy 的坑完全同形：**已安装 → 一行都不输出**（SKIP 只在「未安装」时才打）。

改法（单一事实源仍是 compatibility.json + 各端 hook 配置）：

1. `runtime-probe.ts` 新增 `HOOK_FILE_AGENTS` 表：`configs`（home 相对候选）+ `shape`
   （`json` / `toml` / `artifact-only`）+ `artifact` 正则 + `protocol`（`cursor` / `permissionDecision` /
   `grok` / `devin` / `bridge`）+ `matcherHint`。每种协议有自己的 payload 与 deny 判据（cursor 的 shell
   工具叫 `Shell`、grok 是 camelCase、devin 是 `decision:"block"`），并且都排除「fail-closed 分支的 deny」
   造成的假通过。
2. `HOOK_SINGLE_SOURCE_MAP` 补上 4 个适配器 + bridge + pi/omp 扩展，新鲜度不再恒为 null。
3. `discovery.ts` 注册表补齐 14 端并修正探针；`claude-code-copilot`（旧猜法）退役为 `copilot`。
4. `cmdDoctor` / `cmdStatus` 的 `order` 扩到 14 端；`doctorFixHint` 对这 8 端指向
   `scripts/riskguard-wiring-check.ps1 -Fix`（本 CLI 的 install 并不覆盖它们）。
5. 修掉 WorkBuddy 的「两个真相」：它没有 manifest，状态判定掉到 `!manifestPresent → DETECTED`，
   于是 `doctor` 说 PASS、`status` 说「agent present, RiskGuard not installed」。现在与 agy 同口径。

结果：

```
$ node bin/riskguard.mjs doctor
PASS  claude-code / codex / opencode / dsh / agy / workbuddy / cursor / copilot / grok /
      windsurf / pi / omp / kimi-code / minimax-code
SKIP  cline / aider / goose            （未安装）
SKIP  hermes                           （documented-only：仅登记机制，本版本不提供门禁）
Summary: 14 PASS / 0 WARN / 0 FAIL / 4 SKIP
```

> 顺带修的第二个「静默」：本机 `~/.hermes` 是 2026-06 的残留配置目录（无 CLI），旧注册表探的是
> `%LOCALAPPDATA%/Hermes`，判「已安装」却因为不在 `order` 里**一行都不输出**。现在注册表探针改成
> home 相对的 `~/.hermes`，并给 hermes / cline / aider / goose 标 `documentedOnly: true` ——
> 已检测到但无探测分支时，doctor 必须输出「仅登记机制，本版本未提供门禁探测/接线」，
> 不许静默（新增第 7 条测试钉住）。

`node bin/riskguard.mjs status` 同样 14 行，全部 `ACTIVE — full runtime self-test PASS`。

## 4. 回归测试（新增，且已验证「回退会变红」）

`packages/installer/test/doctor-agent-coverage.test.ts`（7 条）：

1. compatibility.json 的每个 Agent 都在 doctor 输出里有一行；
2. hook 文件型 8 端都有 probe 分支（空 home 下 NOT_DETECTED 而非抛错）；
3. 空 home 的 doctor 不许出现 PASS / FAIL（反向对照，防「凭空通过」）；
4. 假 home 里接线 cursor → doctor 必须真去探（不是 SKIP）——这条就是 order 覆盖的证据；
5. 配置指向不存在的适配器 → `BROKEN`；
6. minimax 缺 `enabled: true` → 证据里点名；
7. 已检测到但无探测分支的端（hermes）必须出一行，且写明「documented-only / 未支持」。

**回退验证**：把 `cmdDoctor` 的 `order` 砍回 6 端后重跑，第 4 条变红（`fail 1`），恢复后 7/7 绿。

## 5. 复验命令与结果

| 检查 | 结果 |
|---|---|
| `& .\test-all.ps1`（改前基线） | **exit 0** |
| `& .\test-all.ps1`（改后） | 见本次会话输出（含新增 doctor-agent-coverage） |
| `node bin/riskguard.mjs doctor` | **14 PASS / 0 WARN / 0 FAIL / 4 SKIP** |
| `node bin/riskguard.mjs status` | 14 端全 `ACTIVE` |
| `node scripts/generate-agent-security-matrix.ts --check` | exit 0 |
| `node scripts/check-compatibility-docs.ts` | exit 0 |
| `node scripts/check-decisions-log.ts` | exit 0 |
| `pwsh scripts\riskguard-wiring-check.ps1` | exit 0（全端 [OK]） |
