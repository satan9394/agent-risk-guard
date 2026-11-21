# 会话交接 — 2026-11-21（agent-risk-guard：全端适配复验 + 新 Agent 面判定）

> 下一场会话的接入口。规则不变（见 `AGENTS.md`），本文不重复那条。
> 取值一律以现场为准：HEAD / PR 号看 `git log` / `gh pr list`。

## 1. 这一场做了什么

### 1.1 版本盘点 + 逐端 D3 重取（12 端，另外 2 端有明确原因未取）

本机再次全量漂移：Claude Code **2.1.330** / OpenCode **2.3.2** / Codex **0.171.0** /
DSH **0.2.2-rc.5** / agy **1.5.14** / cursor-agent **2026.11.19-f005e9d** / Copilot **1.0.114** /
Grok **1.0.92** / Pi **1.6.0** / omp **19.0.1** / Kimi **2.7.2** / MiniMax **0.7.9** /
Devin **3000.14.30821**；WorkBuddy 5.9.3 未变。

12 个可驱动 CLI 逐端重取「deny + 未提交改动存活」与「allow + 真实执行」，全部通过；
**Devin 维持 D2**（`--permission-mode dangerous` 下 `git reset --hard` 真的执行，hook 零调用 ——
版本升了但机制没修）；**WorkBuddy D3 未取**（无 CLI，证据仍属 5.6.2）。
证据：`tasks/orchestrator/AGENT_ADAPT_20261121.md` + `tasks/orchestrator/rg-evidence-20261121/*.txt`（14 个文件）。

### 1.2 新 Agent 面判定（本轮唯一新增的结论面）

判据：**该形态有没有「工具调用执行前」的拦截点，有才登记。**

- **OpenCode Desktop**（11-20 安装，随包 CLI 2.3.2）→ 不新增 agent 键。用 Desktop 随包
  `opencode-cli.exe` 复跑同一条取证 prompt，得到与 CLI 完全一致的 `BLOCKED_BY_GLOBAL_SAFETY_GUARD /
  GIT_RESET_HARD` ⇒ **能证到的是「随包 CLI 与 CLI 共用 `~/.config/opencode` 与同一插件」**（桌面窗口本身未直接取证）。
  写进 `references/opencode-wiring.md` 的「三种可执行形态」小节。
- **Multica**（11-19 安装，`multica` CLI 是云端 Agent 平台）→ 不登记。
- **Kiro**（`%APPDATA%\Kiro` 桌面 IDE，`~/.kiro` 只有 `settings/mcp.json` + skills，无 CLI / 无 hooks）→ 不登记。
- **T3 Code (Beta)**（`~/.t3/bin/t3.cmd`，按 provider 起会话的封装层）、**Grok Bot**、**cagent** → 已扫描，不登记。
- **Mavis**（`~/.mavis/bin/mavis.cmd`）→ **已不可驱动**：shim 指向的 `%LOCALAPPDATA%\Programs\MiniMax\MiniMax.exe`
  已被卸载，只剩数据目录。历史结构仍记一笔：coder 是内嵌 OpenCode、配置根独立
  （`plugin: ["mavis"]`、`permission "*": allow`），重装后按 `docs/TODO.md` 的接线办法接。
- Hermes 维持 documented-only（`~/.hermes` 无二进制：只有 `config.yaml` + `.env` + 空 `skills\`）。

### 1.3 改了什么

- `packages/installer/compatibility.json`：14 条 `componentInventory.version` 刷新 + notes 各加一段
  「2026-11-21 复验」（历史段落未删改，27 行原位替换）。
- `skills/agent-risk-guard/references/agent-matrix.md`：「本机实测版本」行刷新 + 新增「已评估不登记」条目。
- `skills/agent-risk-guard/references/opencode-wiring.md`：新增 Desktop 形态小节与取证判据。
- `docs/TODO.md`：新增 5 条（WorkBuddy D3、Devin dangerous 绕过、Desktop 窗口内未取证、三个不登记面、旧包残留）。
- `CHANGELOG.md` `[Unreleased] ### Changed` 一条；`docs/decisions.md` B 表一行（2026-11-21）。
- **规则单源、三个引擎文件、任何 hook 接线形态均未改动。**

## 2. 未闭环

1. WorkBuddy 5.9.3 的 D3：需一次人工桌面会话。
2. Devin 升 D3：`dangerous` 仍绕过 hook，只剩 Desktop 交互或等 vendor。
3. OpenCode Desktop **窗口内**会话原文未取（只证到同包 CLI）。
4. 全局旧包 `@opencode/cli-windows-x64@2.2.5` 与 `@opencode/cli@2.3.2` 并存，判版本有歧义；清理属用户环境。
5. **Mavis 已不可驱动**：`~/.mavis/bin/mavis.cmd` 的宿主（`%LOCALAPPDATA%\Programs\MiniMax`）已卸载，
   只剩数据目录；重装后再按 `docs/TODO.md` 接线。
6. Cursor 的引擎侧 deny 原文已按时间窗归档进证据文件；若要强归属（日志不记 agent 名），可在配额恢复后重跑一次。

## 3. 现场核对清单

```powershell
cd E:\DeepSeek_Harness\workspace\2026\08\21\agent-risk-guard

git log --oneline -5 ; git status --short
node bin/riskguard.mjs doctor                # 期望 14 PASS / 0 WARN / 0 FAIL / 4 SKIP
node bin/riskguard.mjs status                # 期望 14 行 ACTIVE
node --test packages/installer/test/doctor-agent-coverage.test.ts   # 期望 7/7
& .\test-all.ps1                             # 期望 exit 0
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\riskguard-wiring-check.ps1        # 期望 exit 0
pwsh -NoProfile -ExecutionPolicy Bypass -File tasks\orchestrator\rg-wiring-check-sealed-test.ps1  # 期望 64/64
node scripts/generate-agent-security-matrix.ts --check
node scripts/check-compatibility-docs.ts
node scripts/check-decisions-log.ts
```

改过 `skills/agent-risk-guard/**` 时不要忘记分发：

```powershell
& "$env:USERPROFILE\.skills-manager\bin\skills-manager-cli.exe" skills update agent-risk-guard
```

## 4. 证据索引

| 证据 | 用途 |
|---|---|
| `tasks/orchestrator/AGENT_ADAPT_20261121.md` | 本轮版本表、新面判定表、逐端会话原文摘录、取证陷阱、闸门结果 |
| `tasks/orchestrator/rg-evidence-20261121/*.txt` | 14 个文件：每端 deny / allow 原始输出 + `git status --short` 存活记录 |
| `packages/installer/compatibility.json` | 版本与 D 级的唯一事实源 |
