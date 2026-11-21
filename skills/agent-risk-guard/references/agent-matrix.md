# Agent 机制矩阵

主流 AI 编码 Agent 的"危险命令拦截"机制、全局配置位置与默认安全态。
数据来源：rulesync 兼容矩阵（2026-08）+ 实测（Claude Code/OpenCode/Codex/DSH）+ 官方文档。

## 机制类型说明

- **hooks**：执行前钩子，可编程拦截/改写工具调用（最可靠，可"自动拒绝"）
- **permissions**：内置权限系统（ask/allow/deny 规则，可 deny 高危命令）
- **插件/门禁**：插件系统在工具执行前拦截（如 OpenCode `tool.execute.before`、DSH `tools/pre-execute`）
- **sandbox**：文件/网络隔离（限制"能碰什么"，不能逐命令拒绝）
- **rules/ignore**：模型级提示 + 忽略文件（**非强制**，只靠模型自觉）

## 全表（✅=支持 🌏=全局模式）

| Agent | 全局配置 | rules | hooks | permissions | sandbox | 默认安全态 | reference |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Claude Code | `~/.claude/settings.json` | ✅ | ✅ PreToolUse | ✅ | ✅(mac/Linux) | 中 | claude-code.md |
| OpenCode | `~/.config/opencode/opencode.json` | ✅ | ✅ 插件 | ✅ | ❌ 无内建 | **低（默认全 allow）** | opencode.md |
| Codex CLI | `~/.codex/config.toml` + `hooks.json` | ✅ | ✅ PreToolUse（Bash；apply_patch 的 shell 形态已拦，原生需授信） | ✅(含 Windows) | ✅(含 Windows) | 中（原生 apply_patch 未授信前 fail-open） | codex.md |
| DeepSeek Harness | `~/.dsh/profiles/*/cordis.patch.yml` | ✅ | ✅ pre-execute | ✅(沙箱+审批) | ✅(仅文件) | 中（headless 已设 danger-full-access + never；web/desktop 未改） | dsh.md |
| Antigravity CLI (agy) | `~/.gemini/config/hooks.json` + `hooks/` | ✅ | ✅ PreToolUse run_command | ✅(deny) | — | 中（fail-closed 适配器） | codex.md（复用 codex 规则源）+ agy 内联 |
| WorkBuddy (CodeBuddy) | `~/.workbuddy/settings.json` + `hooks/` | ✅ | ✅ PreToolUse（CC 兼容） | ✅ | — | 中（**须 RG_ALLOW_DELETE=1**：删除委派给平台 safe-delete，不可逆仍拦） | workbuddy.md |
| Copilot CLI | `~/.copilot/hooks/` | ✅ | ✅ PreToolUse（PascalCase，**D3 2026-11-12**） | ✅ | — | 中（shell 面；MCP/网络未覆盖） | copilot-goose-grok.md |
| Cline | VS Code 设置 + `.clinerules` | ✅ | ✅ PreToolUse(v3.36+) | ✅(auto-approve) | — | 中 | cline-kilo-qwen.md |
| Qwen Code | `~/.config/qwen-code/` + `.qwen/` | ✅ | ✅ PreToolUse | ✅(deny) | — | 中 | cline-kilo-qwen.md |
| Cursor | `~/.cursor/hooks.json` | ✅ | ✅ preToolUse（`Shell|Delete`，**硬拦，D3 2026-11-11**） | ✅ | — | 中（`Write`/MCP 未覆盖；`beforeShellExecution` 非硬闸门） | cursor-windsurf.md |
| AugmentCode | `~/.augment/settings.json` | ✅ | ✅ PreToolUse | ✅ | — | 中 | augmentcode.md |
| Amp | 项目设置 `amp.config.json` | ✅ | — | ✅(deny) | ✅(sandbox) | 中 | amp-roo.md |
| Roo Code | VS Code 设置 + `.roo/rules/` | ✅ | ⚠️(部分) | ✅(auto-approve) | — | 中 | amp-roo.md |
| Goose | `~/.config/goose/` | ✅ | ✅ | ✅ | — | 中 | copilot-goose-grok.md |
| Grok CLI | `~/.grok/hooks/` | ✅ | ✅ PreToolUse（**D3 2026-11-13**） | ✅ | — | 中（vendor 崩溃/超时 fail-open） | copilot-goose-grok.md |
| Hermes Agent | `~/.hermes/` | ✅ | ✅ PreToolUse | ✅ | — | 中 | copilot-goose-grok.md |
| Copilot CLI | `~/.copilot/` | ✅ | ✅ | ✅ | — | 中 | copilot-goose-grok.md |
| Windsurf → Devin | `%APPDATA%\devin\config.json` 或 `.devin/hooks.v1.json` | ✅ | ✅ PreToolUse(exec)（**D2**：dangerous 模式不触发 hook） | ✅ | — | **低（print 模式要么被审批拦、要么 hook 不跑）** | windsurf-zed-warp.md |
| Zed | 项目设置 | ✅ | ❌ | ✅(deny) | — | 中 | windsurf-zed-warp.md |
| Warp | 项目设置 | ✅ | ❌ | ✅(deny) | — | 中 | windsurf-zed-warp.md |
| Pi | `~/.pi/agent/` | ✅ | ✅ tool_call 扩展（**硬拦，D3 2026-11-11**） | ❌ | ❌ | 中（只拦 shell；无沙箱） | pi-aider.md |
| Oh My Pi (omp) | `~/.omp/agent/` | ✅ | ✅ tool_call 扩展（`hooks/pre/`，**硬拦，D3 2026-11-11**） | ❌ | ❌ | 中（只拦 shell） | pi-aider.md |
| Kimi Code | `~/.kimi-code/` | ✅ | ✅ PreToolUse `[[hooks]]`（**D3 2026-11-11**，fail-open） | ❌ | ❌ | 中（hook 故障放行） | pi-aider.md |
| MiniMax Code | `~/.minimax/` | ✅ | ✅ PreToolUse `hooks.json`（**D3 2026-11-11**，fail-open） | ❌ | ❌ | 中（hook 故障放行） | pi-aider.md |
| Aider | `~/.aider.conf.yml` + `.aiderignore` | ✅ | ❌ | ❌ | ❌ | **低（最小攻击面）** | pi-aider.md |

## 高价值结论

1. **有 hooks 的**（Claude Code/OpenCode/Codex/Copilot/Goose/Grok/Hermes/Cursor/Cline/Qwen/AugmentCode/Amp/Roo Code/OpenClaw）：用 PreToolUse 类钩子做"自动拒绝"黑名单命令，最可靠。**通用 hook 脚本 `scripts/dangerous-commands-universal.ps1` 可直接复用**（Windows ps1 多维套件 + bash sh 52/52，四轮 GAN 审查至 8/10）。
2. **只有 permissions 的**（Zed/Warp/Takt 等）：用 deny 规则硬拦删除类命令。
3. **只有 rules/ignore 的**（Windsurf/Aider/Claude Desktop）：只能 rules 提示 + ignore 保护敏感路径，**无法机器级拦截**，需外部包装（容器/包装脚本）。Claude Desktop 主要靠 MCP 插件生态，无内建命令拦截。
4. **内建无权限、但有 pre-tool 扩展点的**（Pi / omp / Kimi Code / MiniMax Code）：RiskGuard 已用扩展或 hook 接硬拒（D3 2026-11-11），但这些 hook 只管 Agent 的工具调用、不是沙箱；文件写入/MCP/网络与用户手敲命令仍需容器化或包装。Aider 没有此挂点，只能外部隔离。
5. **截图补充**（2026-08 调研）：OpenClaw（Clawland AI 开源 Agent 框架）有权限系统；Claude Desktop 无命令级拦截（仅 MCP）；Grok Build（Grok CLI 前身）hooks 格式同 Claude Code。

## 覆盖率（2026-08 更新）

| 状态 | Agent 数量 | 说明 |
|------|-----------|------|
| ✅ 有完整下发脚本 | 6 | Claude Code / Codex / OpenCode / DSH + 通用脚本（Cursor/Goose/Grok/Hermes/Copilot）+ agy 适配器（`scripts/agy-dangerous-commands.ps1`） |
| ⚠️ 有 references 无脚本 | 6 | Cline / Qwen / AugmentCode / Amp / Roo / OpenClaw |
| ❌ 未覆盖 | 6 | Windsurf / Aider / Zed / Warp / Claude Desktop / Pi |

## 注意事项

- **Antigravity CLI (agy)**：hook 走 `~/.gemini/config/hooks.json` 的 PreToolUse `run_command` 事件（工具名为 shell.execute / CommandLine），用 `scripts/agy-dangerous-commands.ps1` 适配器翻译到规则引擎（引擎按优先级探测：`RISKGUARD_AGY_ENGINE` → 适配器**同目录** `dangerous-commands.ps1` → `~/.codex/hooks/`）。**last verified：agy 1.4.12（Windows，2026-11-02）**——`agy -p` 真实会话 `git reset --hard` 被 deny、脏改动保留、`git status --short` 放行；更早证据：1.4.8（2026-10-27）、1.2.7（2026-09-21）与 1.1.27（2026-09-06）同样通过。适配器 fail-closed（规则引擎缺失/输出不可解析一律 deny，绝不静默放行）。⚠️ 测法提示：用「把文件永久删掉」类提示词会被模型在**规则层**直接拒绝（零工具调用），那是 soft 遵循、**不构成硬拦截证据**；须用模型不认为该拒绝的命令（如 git reset）方能触发钩子。
- **本机实测版本（2026-11-21 全量重取）**：Claude Code **2.1.330** / OpenCode **2.3.2**（`opencode2` 同版本；全局仍残留 `@opencode/cli-windows-x64@2.2.5`；Desktop 随包 CLI 2.3.2 共用同一 `~/.config/opencode` 与同一插件）/ Codex CLI **0.171.0** / DeepSeek Harness **0.2.2-rc.5** / agy **1.5.14** / Cursor **3.29.9（桌面）+ cursor-agent 2026.11.19-f005e9d** / Copilot CLI **1.0.114** / Grok **1.0.92** / Pi **1.6.0** / omp **19.0.1** / Kimi Code **2.7.2** / MiniMax Code **0.7.9** / Devin **3000.14.30821（D2，dangerous 模式仍绕过 hook）** / WorkBuddy **5.9.3（无 CLI，D3 证据仍属 5.6.2）**。版本以每端 `--version` 为准，`riskguard doctor` / `status` 已覆盖全部 14 端；11-21 逐端 D3 重取记录见 `tasks/orchestrator/AGENT_ADAPT_20261121.md`。
- 配置管理器（cc-switch 等）会回写 Claude Code 的 settings.json，改 hooks 后需复查。
- Codex hooks 在原生 Windows 有 bug（#24453），配置后必须真实会话实测。
- macOS 沙箱用 Seatbelt、Linux 用 bubblewrap、Windows（Codex）用受限令牌/ACL。
- **通用脚本** `dangerous-commands-universal.ps1` 适用于所有使用 PreToolUse JSON 格式的 Agent（CC/Codex/Cursor/Goose/Grok/Hermes/Copilot），单脚本覆盖 7 家。

- **已评估不登记（2026-11-21）**：**Multica**（`multica` CLI / `%LOCALAPPDATA%\Programs\@multicadesktop`）是云端 Agent 平台——`multica agent` 只管创建/克隆/指派 Agent 与 MCP 绑定，本地没有「工具调用执行前」拦截点，不适用；**Kiro**（`%APPDATA%\Kiro` 桌面 IDE，`~/.kiro` 只有 `settings/mcp.json` + skills）本机没有 CLI 也没有 hooks 配置文件，登记成 documented-only 只会产出证明不了机制的 SKIP，不登记。判据统一：**该形态有没有 pre-execution 工具拦截点**，有才登记。