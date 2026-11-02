# 会话交接 · 2026-11-02（agent-risk-guard：五端再升级适配 + 巡检自愈补强）

> 给下一个会话的交接单。规则正文在 `AGENTS.md`，不在这里重复。
> 取值一律以命令为准（HEAD / PR 号以 `git log` / `gh pr list` 为准）。

## 1. 本段做了什么

### 1.1 五端版本盘点 + 真实会话重取（D3）

| Agent | 上一份记录 | 本段实测 |
|---|---|---|
| OpenCode | 2.2.0 | **2.2.5** |
| Claude Code | 2.1.311 | **2.1.316** |
| Codex CLI | 0.164.0 | **0.166.0** |
| DeepSeek Harness | 0.2.1-rc.3 | **0.2.1-rc.5** |
| agy | 1.4.8 | **1.4.12** |

五端都是当前最新稳定版；每端都取了「deny + 脏改动存活」与「allow + 真实执行」两条证据。
完整命令、原始输出、hook 日志时间戳见 `tasks/orchestrator/AGENT_UPGRADE_D3_20261102.md`。
`packages/installer/compatibility.json` 的 `componentInventory.version` 与 notes 已同步。

### 1.2 OpenCode V2 的闸门分层（文档写反了，已纠正）

V2 插件契约里**只有 `tool` 域可以 fail**：`packages/core/src/plugin/hooks.ts` 的 `Failures` 把
shell / permission / session / aisdk 全标 `NoFailures`。因此 `ctx.shell.hook("create.before")` **拦不住**，
硬闸门是 `ctx.tool.hook("execute.before")`；`ctx.permission.hook("evaluate")` 是权限层第二道。
本轮真实会话的 guard 日志是 `tool=tool.hook`，与结论一致。

插件侧改动（`assets/opencode/agent-risk-guard.ts`）：
- V2 工具钩子同时认 `shell` 与 `bash`（2.2.5 起 `bash` 按 `shell` 执行，插件自带同名工具仍优先）；
- 日志标签分 `tool.hook` / `shell.hook`，取证时能看出来是哪层命中；
- 文档 `references/opencode.md`（重写）、`opencode-wiring.md`、`SKILL.md`、`AGENTS.md` 同步这条边界。

**残余风险**：TUI 里用户自己敲 `!` 起的 shell 不经 `Tool.execute`，不在拦截面内。已登记 `docs/TODO.md`。

### 1.3 dsh desktop 整段丢门禁（已修，且 -Fix 现在能自愈）

`~/.dsh/profiles/desktop/cordis.patch.yml` 只剩 `llm-pi-ai` + `agent-default-model`，
`deny-risk-commands` 整段消失（桌面端实际裸奔）。旧巡检对「整段缺失」只报 `[!!]`，`-Fix` 修不动。

现在 `scripts/riskguard-wiring-check.ps1 -Fix`：从一个源截出 `- insert:` 段 → 追加到 profile patch 末尾 →
写后做 YAML 复验 → 失败则回滚原文。密封用例新增 **T8**（整段缺失 + 保留用户内容 + 注入后仍合法 + 规则数一致）。
本机现场：`[Fix] 已向 dsh desktop 追加 deny-risk-commands 注入` → 三 profile 各 74 条逐条一致。

### 1.4 巡检 python 探测（本机环境漂移）

Anaconda 已于 2026-10-29 卸载，脚本仍硬编码 `…\Anaconda3\envs\claude\python.exe` → YAML 校验长期静默跳过。
改为 `RISKGUARD_YAML_PY`（显式覆盖，命中即不回退）→ `D:\Python\Agents\Scripts\python.exe` → `.venv` →
PATH，并检查解释器能 `import yaml`；T4 改用环境变量构造「python 缺失」。

### 1.5 其它文档/适配层

- `packages/adapters/opencode` 的接线样板从 V1（`tool.before` + `output.error`）改为 V2
  （`async setup(ctx)` + `ctx.tool.hook("execute.before")` + 抛错），`adapters-m4` 断言跟着改；
  `packages/installer/src/discovery.ts` 的备注同步。
- `docs/TODO.md` 新增三条登记：OpenCode 非工具 shell 的边界、dsh desktop 可能被应用重写、
  **本机 Claude Code 默认模型指向 `workbuddy/...` 已被 2.1.316 判为 `unrecognized_model`（属用户偏好，未改）**。

## 2. 未完成 / 待办

1. **Claude Code 默认模型**：`~/.claude/settings.json` 的 `model` 与 `ANTHROPIC_DEFAULT_*` 全是
   `workbuddy/deepseek-v4.1-flash[1m]`，2.1.316 直接拒绝运行；本段取证用 `--model auto/deepseek-v4.1-flash` 绕过。
   要改默认需用户点头（换成哪条 magpie 模型属偏好）。
2. **OpenCode `!` shell 边界**：若要补，只能评估权限层是否覆盖 shell 端点；现无硬闸门。
3. **dsh desktop**：Electron 应用独占该 profile（CLI 拒绝 `--dump-config`），若应用再次重写 patch，
   靠计划任务巡检 `-Fix` 兜底；复发时应查 Desktop 侧写入行为。
4. **Codex hooks 双注册**：`hooks.json` 仍是 ps1 + `_riskguard` node 两条，每次 Bash 跑两遍（安全但重复）。
   与 10-27 交接同一项，仍未合并。
5. **本地残留分支**：`pr51-review`、`merge-test`、`fix/agent-upgrade-20261027`、`docs/dsh-d3-20261027`、
   `docs/session-handover-20261027`（远端已删，仓库 guard 拦 `git branch -D`，需人工删）。

## 3. 复验清单

```powershell
cd E:\DeepSeek_Harness\workspace\2026_08_21\agent-risk-guard

git log --oneline -6 ; git status --short

pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\riskguard-wiring-check.ps1          # 期望 exit 0
pwsh -NoProfile -ExecutionPolicy Bypass -File tasks\orchestrator\rg-wiring-check-sealed-test.ps1  # 期望 49/49

node scripts/generate-agent-security-matrix.ts --check
node scripts/check-compatibility-docs.ts
node scripts/check-decisions-log.ts

node --test tests/adapter/*.test.ts tests/compatibility/compatibility-v2.test.ts
node bin/riskguard.mjs doctor
```

个人技能分发链（改过 `skills/agent-risk-guard/**` 时必须做）：

```powershell
# 1) 旧真身备份到 ~/.risk-guard-backup/skill-sync-<ts>/
# 2) 用仓库 skills/agent-risk-guard 覆盖 ~/.agents_four_skills/agent-risk-guard
& "$env:USERPROFILE\.skills-manager\bin\skills-manager-cli.exe" skills update agent-risk-guard
# 3) 4 个部署点（claude/opencode/dsh/antigravity）是 junction，update 后逐点比 hash
```

## 4. 证据产物

| 产物 | 用途 |
|---|---|
| `tasks/orchestrator/AGENT_UPGRADE_D3_20261102.md` | 五端真实会话的完整记录（命令、输出、日志时间戳、取证陷阱） |
| `tasks/orchestrator/rg-wiring-check-sealed-test.ps1` | 密封测试，现 **49/49**（含 T8 整段注入） |
| `packages/installer/compatibility.json` | 版本与 D3 备注的唯一事实源 |
