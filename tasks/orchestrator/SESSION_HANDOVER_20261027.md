# 会话交接 · 2026-10-27（agent-risk-guard：六端升级适配 + D3 重取 + 贡献 PR 评审）

> **用途**：给下一个会话（或清理上下文后的自己）的交接单，放在 `tasks/orchestrator/`。
> **规则文件（`AGENTS.md`）只引用、不承载正文**。本文不写「写下去就过时」的值
> （HEAD / PR 编号 / 末次 commit 一律以 `git log` 为准；PR 编号仅作历史指代）。

---

## 1. 项目当前状态（读时以命令为准）

| 项 | 怎么取 | 本段收尾时的实际值 |
|---|---|---|
| 分支 / 最近提交 | `git log --oneline -6` | `main`，含「hooks 修复」与「dsh 补跑」两笔 squash 提交 + setup-node 7.1.0 |
| 工作区是否干净 | `git status -sb` | 干净 |
| 是否发了版 | `gh release list --limit 1` | 未发；仍按「约 30 天一版」政策 |
| 本机接线体检 | `pwsh scripts/riskguard-wiring-check.ps1` | **exit 0** |
| main CI | `gh run list --branch main --limit 3` | 最新一次全绿（含 ps1-hook 跨端闸门） |

---

## 2. 本段做了什么

### 2.1 六端升级盘点

| Agent | 旧记录 | 本机实测 |
|---|---|---|
| Claude Code | 2.1.295 | **2.1.311** |
| Codex CLI | 0.162.0-alpha.17.2 | **0.164.0** |
| OpenCode | 2.0.28 | **2.2.0** |
| DeepSeek Harness | 0.2.0-rc.2 | **0.2.1-rc.3** |
| agy | 1.3.2 | **1.4.8** |
| WorkBuddy | 5.6.2 | 本机已无安装（D3 证据沿用 2026-09-28） |

五端 `componentInventory.version` 与 D3 证据已写进 `packages/installer/compatibility.json`。

### 2.2 Claude Code 2.1.311 的三处 fail-open（本轮最重要）

首次复验时 `claude -p` 里 `git reset --hard` **直接执行成功**。逐层定位出三条独立原因，任一都会 fail-open：

1. **matcher 漏新工具名**：Windows 上 shell 调用可能走 `PowerShell` 工具，只写 `"matcher": "Bash"` 时该调用
   完全不进 hook（`--debug=hooks` 里没有任何 `PreToolUse` 行）。
2. **反斜杠路径被 POSIX 派发打碎**：hook 命令改由 POSIX shell 执行，`C:\Users\…` 的反斜杠被吃掉 →
   `-File` 找不到脚本 → `exit 127` → 判定被丢弃。debug 原文：`finished with status 127`。
3. **输出 schema 收紧**：`"updatedInput": null` 被 2.1.311 的 JSON 校验拒绝
   （`hookSpecificOutput.updatedInput: expected record, received null`），整条 deny 作废。

修法：matcher 改 `Bash|PowerShell`；命令用正斜杠绝对 `powershell.exe`；引擎五处实现（`assets/hooks/dangerous-commands.ps1`、
skill 内 ps1、`dangerous-commands-universal.ps1`、`dangerous-commands.sh`）**统一省略** `updatedInput`。
真实会话复验：`git reset --hard` 被 deny 且脏改动保留，同会话 `git status --short` 放行并真实执行。

### 2.3 巡检与测试的配套改动

- `scripts/riskguard-wiring-check.ps1`：claude 段从「有 PreToolUse」升级为「**matcher 覆盖 PowerShell** +
  **命令为正斜杠路径**」两条断言；`-Fix` 按新形态生成（旧形态会写回一个失效注册）。
- 同一脚本：把已退役的 `~/.claude/skills/custom/agent-risk-guard-audit` 从必检项降级
  （skills-manager 接管后该目录不存在，原先每 5 分钟恒 `exit 1`）。
- `skills/agent-risk-guard/tests/hook-rules-test.ps1` 与 `sh-hook-test.sh`：新增「deny 输出不含 `updatedInput`」断言。
- `tasks/orchestrator/rg-wiring-check-sealed-test.ps1`：T7 夹具先清旧残留（保证可复跑），新增 T7f/T7g 锁住
  `-Fix` 产物形态；现 **42/42**。

### 2.4 Linux trash 去除对 `gio` 的硬依赖

CI 上 `transaction` / `e2e/cli-exit-codes` / `release-hardening` 的回滚用例时红时绿（同一 SHA 换 Node 版本结果相反），
失败形态统一是 `REMOVE-FAILED: …/.riskguard/manifests/*.json`。根因：`packages/trash/src/linux.ts` 只调 `gio trash`，
而 ubuntu-latest 正处镜像切换期（26.04 已 GA），**并非每台 runner 都装了 `gio`**。
改为三级兜底：外部命令 → 备用命令 → 按 freedesktop 规范自实现；新增 `packages/trash/test/trash.linux.test.ts`
（清空 `PATH` 仍须进回收站）。反证：WSL 里把 `PATH` 只留 node（等价无 `gio`）跑 `tests/transaction` **10/10**。

### 2.5 dsh 0.2.1-rc.3 真实会话补跑

headless 默认 route 是 `deepseek-official`，那只 `DEEPSEEK_API_KEY` 已失效（401）；headless 的 bundle 里也**没有**
`llm-pi-ai`（直接切 `command` 会 `NO_ADAPTER`）。用 `--patch` overlay 注入 adapter + 改默认模型后跑通：
`git reset --hard` 被拒（`Error: 高危：git reset --hard 丢弃工作区改动`、脏改动保留），
`git status --short` 放行并回显。overlay 内容（本段用完即弃，按需重建）：

```yaml
- insert:
    - id: llm-pi-ai
      name: '@deepseek-ai/dsh-llm-pi-ai'
      config:
        providers:
          command:
            displayName: command
            apiKeyEnv: COMMAND_API_KEY
            api: openai-completions
            baseURL: https://api.commandcode.ai/provider/v1
            models:
              - id: deepseek/deepseek-v4.1-flash
                name: DeepSeek V4.1 Flash
                contextWindow: 500000
- id: agent-default-model
  config:
    provider: command
    model: deepseek/deepseek-v4.1-flash
```

### 2.6 贡献 PR 与依赖 PR

- **MiniMax Code（mcode）adapter**：已做完整评审并 **REQUEST_CHANGES**。四条阻塞：CI 未跑（fork PR 需维护者批准）、
  `docs/decisions.md` 与 main 冲突、缺 `compatibility.json` 条目与 `discovery` 注册（实测 `install --agent mcode`
  → `Unknown agent` / exit 2）、安装脚本零测试。两条建议：hook 命令路径转正斜杠（引本段 127 证据）、
  matcher 是否补小写 `powershell` 需实测。作者的 adpater 本身方向正确（双形态 matcher、空 command fail-closed）。
- **dependabot setup-node 7.0.0 → 7.1.0**：核过 SHA 与 v7.1.0 tag 一致后合并。

---

## 3. 未完成 / 待办（**复核从这里开始**）

权威清单仍是 `docs/TODO.md` 的未勾选项。本段新增/遗留：

1. **mcode PR 等待作者补料**：补完四项 + rebase 后需复审（重点：CI 绿、`compatibility.json` 与 `doctor` 可见、
   安装脚本假 home 测试、hook 命令正斜杠）。
2. **headless 默认模型未改**：本段只做了 `--patch` 验证，没有写进 `~/.dsh/profiles/headless/`。
   若要默认走 `command`：在 `cordis.patch.yml` 的 insert 段加 `llm-pi-ai`（不带 providers，读 settings.yaml 已有的定义），
   再把 `agent-default-model` 指向 `command / deepseek/deepseek-v4-flash`；改前备份，改后跑一次 PING + 真会话。
   ⚠️ 另有一个**配置漂移**：`~/.dsh/profiles/headless/settings.yaml` 写的 `agent-default-model` 是
   `jiyuanlvdonf`，但 `--dump-config` 实际生效的是 bundle 写死的 `deepseek-official` —— 那段配置是死的，别再被它误导。
3. **WorkBuddy**：本机未安装，D3 仍沿用 2026-09-28 的真实会话；不为了凑等级脚本化重放。
4. **本地残留分支**：`pr51-review`、`merge-test`、`fix/agent-upgrade-20261027`、`docs/dsh-d3-20261027`
   （远端已随合并删除）。仓库 guard 会拦 `git branch -D` / `git update-ref`，故未在会话内清除；人工删即可。

---

## 4. 对全局 / 本机的改动（**不在本仓 diff 里**）

- `~/.claude/settings.json`：PreToolUse 的 matcher 改为 `Bash|PowerShell`，命令改为
  `C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe … -File C:/Users/Satanchen/.claude/hooks/dangerous-commands.ps1`。
  备份在临时目录的 `settings.json.bak`；**该形态已能由巡检 `-Fix` 再生**，不会成为不可复现的手改。
- 四个 hook 副本（claude / codex / gemini / workbuddy）经巡检 `-Fix` 从单源回灌；ps1 的 BOM 保持。
- `~/.dsh/` **未做任何永久改动**；headless 只是带 `--patch` 运行过。
- 真实会话夹具：`C:\Users\Satanchen\AppData\Local\Temp\opencode\rg-d3-20261027\`（每个 Agent 一个 git 夹具 +
  prompt 文件 + debug 日志 + settings 备份）。属临时目录，可随时清理；证据已抄进本文与
  `tasks/orchestrator/AGENT_UPGRADE_D3_20261027.md`。
- 证据日志：`%TEMP%\riskguard-hook-calls.log`（本段关键条目：claude 05:28:49 deny / 05:29:25 allow；
  codex 05:51:15 deny / 05:52:11 allow）。

---

## 5. 可复用产物 / 证据

| 产物 | 用途 |
|---|---|
| `tasks/orchestrator/AGENT_UPGRADE_D3_20261027.md` | 五端真实会话的完整记录（命令、原始输出、判读） |
| `tasks/orchestrator/rg-wiring-check-sealed-test.ps1` | 巡检密封测试（假 home，不碰生产面），现 42/42 |
| `packages/trash/test/trash.linux.test.ts` | Linux trash 兜底的可重复验证 |
| `skills/agent-risk-guard/references/claude-code.md` | 2.1.311 的三条硬要求与 debug 判读方法 |
| 本文 §2.5 的 overlay YAML | 需要用 dsh headless 跑真实会话时直接复用 |

真实会话的通用手法（下次照做）：每个 Agent 一个临时 git 夹具，预置一条未提交修改 → 让模型执行
`git reset --hard`（模型不会在规则层先拒绝的那类命令）→ 判据是「hook deny + 脏改动仍在」；再让同一会话执行
`git status --short`，判据是「放行 + 真实输出」。不要用「把文件永久删掉」类提示词（模型会在规则层拒绝、零工具调用，
不构成硬拦截证据）。

---

## 6. 复核清单（建议按序执行）

```powershell
cd E:\DeepSeek_Harness\workspace\2026_08_21\agent-risk-guard

# 0) 现状
git log --oneline -6 ; git status --short

# 1) 本机接线巡检（只读）：五端 + skill 副本是否与单源一致
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\riskguard-wiring-check.ps1   # 期望 exit 0

# 2) 密封测试（假 home，不碰生产）
pwsh -NoProfile -ExecutionPolicy Bypass -File tasks\orchestrator\rg-wiring-check-sealed-test.ps1  # 期望 42/42

# 3) 三个文档闸门
node scripts/generate-agent-security-matrix.ts --check
node scripts/check-compatibility-docs.ts
node scripts/check-decisions-log.ts

# 4) 定向回归
node --test tests/adapter/*.test.ts tests/compatibility/compatibility-v2.test.ts
node --test packages/trash/test/*.test.ts tests/transaction/transaction.test.ts

# 5) 跨端闸门（只有改过引擎文件才需要；本段改过，故应在改动定稿后跑）
node --test packages/core/test/decision-parity.test.ts packages/core/test/redact-parity.test.ts
```

**判读要点**：第 5 步若出现 `CROSS-END GATE NOT RUN`，那是**没跑**不是通过（需两端同时在场）。
第 1 步报漂移用 `-Fix`（自动备份到 `~/.risk-guard-backup/`）后复跑。改代码仍按章程补
`docs/decisions.md` 行 + `CHANGELOG [Unreleased]`；日常只提交不发版。

---

## 7. 下一次从哪继续

- **若继续做事**：先看 mcode PR 是否补料（§3.1）；其次可选把 headless 默认切到 `command`（§3.2，需备份 + 生效验证）。
- **若只是接手**：先读 `docs/TODO.md` 未勾项 + 本文 §3，再按 §6 跑一遍体检。
- **不要做的事**：不要为「顺手」打 tag / 发 Release；不要把会话里的明文密钥摘录进任何仓库文件；
  不要在某个 Agent 的适配器里另起一套规则。
