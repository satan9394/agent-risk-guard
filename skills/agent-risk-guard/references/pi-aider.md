# Pi / Oh My Pi / Kimi Code / MiniMax Code / Aider：内建权限的边界

Pi 系（Pi、omp）、Kimi Code、MiniMax Code **都没有内建的命令黑名单**，但它们提供了**工具调用前的可编程拦截点**，RiskGuard 已经接上；Aider 仍只能靠外部隔离。

## Pi Coding Agent（@earendil-works/pi-coding-agent）

- 仓库：<https://github.com/earendil-works/pi>（`@earendil-works/pi-coding-agent`）
- **官方明示**：Pi 没有内建 permission system（不限制文件、进程、网络、凭据）；默认以启动用户的权限运行。
- 但 Pi 有 **extensions**（`~/.pi/agent/extensions/`、`.pi/extensions/`），其中 `pi.on("tool_call")` 可以在工具执行前 `return { block: true, reason }` —— 这就是机器级硬门禁的挂点。
- RiskGuard 接线（2026-11-11）：`assets/pi/riskguard-extension.ts` 由 `riskguard-wiring-check.ps1` 铺到 `~/.pi/agent/extensions/riskguard.ts`，把 `bash` 的 `input.command` 交给 `~/.risk-guard/riskguard-bridge.mjs`，桥再调**同一份** `assets/hooks/dangerous-commands.ps1`；规则仍是单一事实源，扩展本身不写规则。
- 边界：只覆盖 shell 工具（`bash`）；`write`/`edit` 工具与 MCP 没有接。桥报告规则引擎异常时 **fail-closed**（返回 block），不是放过。
- 官方给的隔离方案仍然有效（容器化 `containerization.md`：Gondolin / Docker / OpenShell），适合需要连文件写入都隔离的场景。

### 加固建议（Pi）

1. 保留 RiskGuard 扩展（已有 D3，`git reset --hard` 被拒且改动保留）
2. 需要更强隔离时再套 Docker / OpenShell / Gondolin
3. 不要因为「装了扩展」就宣称 Pi 有完整沙箱——它没有

### 验证（Pi）

`pi -p "Run exactly this shell command: git reset --hard HEAD"` → 返回 HOOK 拦截原因，`git status --short` 仍有未提交改动；`git status --short` 本身正常放行。

## Oh My Pi（omp，`@oh-my-pi/pi-coding-agent`）

- omp 是 Pi 的 fork，扩展 API 同形（`pi.on("tool_call")`）。
- 原生发现只扫 `~/.omp/agent/hooks/pre|post/*.ts`（**直接放在 `hooks/` 下不会被发现**，官方 `docs/hooks.md` 明示），所以 RiskGuard 的落点是 `~/.omp/agent/hooks/pre/riskguard.ts`，与 Pi 共用同一扩展源码。
- 边界同上：shell 面 D3；omp 启动时自带的一批 MCP 目录（AWS / Looker / Atlassian 等）不受此门禁约束。

### 验证（omp）

`omp -p "Run exactly this shell command: git reset --hard HEAD"` → block，未提交改动保留；`git status --short` 放行。

## Kimi Code（`@moonshot-ai/kimi-code`）

- Hooks 写在 `~/.kimi-code/config.toml` 的 `[[hooks]]`，字段只有 `event` / `matcher` / `command` / `timeout`（多写会导致配置加载失败）。
- `PreToolUse` 的 `command` 收到 stdin JSON（`hook_event_name`、`tool_name`、`tool_input`…），退出码 `2` 阻断、stderr 作为原因；也可以 stdout 返回 `hookSpecificOutput.permissionDecision=deny`。
- RiskGuard 接线：`riskguard-wiring-check.ps1` 追加一段 `[[hooks]]`，命令是 `"<node>" "~/.risk-guard/riskguard-bridge.mjs"`（TOML 字面量字符串 + 正斜杠，因为 Windows 上 Kimi 用 Git Bash 执行 hook；路径带空格必须加引号）。
- 边界：**官方语义是 fail-open** —— hook 崩溃、超时、非 0/2 退出码都按「没跑」处理；所以它是「命中即硬拒」，但不是 fail-closed 防线。Kimi 桌面端 1.1.0 曾不执行 `config.toml` 的 `[[hooks]]`（MoonshotAI/kimi-code#4254），CLI 2.5.3 正常。

### 验证（Kimi）

`kimi -p "Run exactly this shell command: git reset --hard HEAD"` → 会话显示 `⛔ HOOK 已拦截危险命令…`，改动保留；`git status --short` 放行。

## MiniMax Code（`@minimax-ai/code`，命令 `mcode`）

- 用户级 hooks 在 `~/.minimax/hooks.json`（项目级是 `<repo>/.minimax/hooks.json`），顶层必须有 `"enabled": true`，`PreToolUse` 用 `matcher` 匹配原生工具名（如 `bash`）。
- 命令通过 stdin 收 JSON，退出码 `2` 阻断、stderr 作为 agent 看到的原因；非 0/2 与超时都按「没跑」处理（fail-open）。
- RiskGuard 接线：`riskguard-wiring-check.ps1` 合并式写入 `~/.minimax/hooks.json`（保留用户已有条目，写前备份到 `~/.risk-guard-backup/`），`command` / `commandWindows` 都指向 `~/.risk-guard/riskguard-bridge.mjs`。

### 验证（MiniMax）

`mcode exec --prompt-mode coding "Run exactly this shell command: git reset --hard HEAD"` → 拒绝并说明规则，改动保留；`git status --short` 放行。

---

## Aider

- 配置：`~/.aider.conf.yml`（或 `aider_conf.yml` 项目级）+ `.aiderignore`（同 .gitignore 语义）
- **无 sandbox**（llm-safe-haven 评价："No sandbox, but minimal attack surface"）
- 默认只编辑 git 仓库内的文件（工作目录边界天然较小）；`--no-auto-commits` 等 flag 影响 git 行为

### 配置文件

- 全局：`~/.aider.conf.yml`
- 项目：`aider_conf.yml`（项目级）+ `.aiderignore`

### 加固建议（Aider）

1. `.aiderignore` 覆盖敏感路径（`.env`、密钥、`~/.ssh`）
2. 提示用户用 git 提交前审查 diff
3. 重要仓库开 `--yes-always` 慎重
4. 无 hooks/permissions → 无法机器级拦截删除命令

### 验证

让 Aider 执行 `rm -rf` → 应以用户权限直接执行（无拦截）——这正是要升级到容器化的原因。

---

## 共同结论

Pi / omp / Kimi Code / MiniMax Code 现在都有**机器级 shell 门禁**（RiskGuard 扩展或 hook → 共用规则引擎），但仍不是沙箱：文件写入、MCP、网络各自不同。Aider 没有可编程的 pre-tool 挂点，答案仍是**外部隔离**（容器/micro-VM/OpenShell）或工作目录边界 + ignore。审计报告要如实标注「拦到哪一层」，不要把 hook 写成 sandbox。

## 陷阱

- Pi 官方说「没有权限系统」不等于「没有可编程拦截点」——`tool_call` 扩展可以硬拦，但只管它拿到的工具调用，管不了用户自己在终端里敲的命令。
- Kimi Code / MiniMax Code 的 hook 语义是 **fail-open**：脚本崩溃、超时、路径写错都会静默放行。上线后必须用真实危险命令验证一次，不能只看配置文件存在。
- Kimi 在 Windows 通过 Git Bash 执行 hook 命令：路径带空格要引号，反斜杠会被 bash 吃掉，统一用正斜杠。
- omp 只发现 `hooks/pre|post/` 下的扩展；直接放 `hooks/` 根目录等于没装。
- Aider 的 `.aiderignore` 只是忽略文件，不是权限系统。
