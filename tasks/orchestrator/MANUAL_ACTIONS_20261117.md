# 待人工 / LCU 执行清单 · 2026-11-17

> 本清单只放**agent 自己做不了或不该做**的事。每项都写了「为什么卡住」「怎么做」「怎么算完成」，
> 有时间时可以让 LCU 按条目执行；执行完把证据回填到指定文件，并把本项打勾。
> 上下文：`tasks/orchestrator/AGENT_UPGRADE_D3_20261117.md`（本轮 14 端适配记录）、
> `tasks/orchestrator/SESSION_HANDOVER_20261117.md`（交接单）。

## 执行时的通用注意事项

- 危险命令的 prompt 一律**从文件读**（`Get-Content <file> -Raw`），不要把 `git reset --hard` 字面量写进
  agent 的命令行——本机所有 agent 前置门禁会先扫命令字符串，会把你自己的取证命令拦掉。
- 夹具统一用临时 git 仓库：一条提交 + 一处未提交修改（`tracked.txt` 内容 `init` → `dirty-change`）。
- 「算成功」的判据始终是两条：**门禁返回 deny，且未提交改动还在**；再补一条 allow（`git status --short`
  真实执行并回显）。

---

## 1. WorkBuddy 5.9.3 取 D3（桌面应用）

**为什么卡住**：WorkBuddy 只有 Electron 桌面端（`E:\APP\Technology\Workbuddy`），没有可驱动的 CLI；
headless 会话不存在。本轮只做到「版本登记 5.9.3 + 接线巡检 + 委派模式 self-test PASS」。
按硬约束 5，D3 证据仍属 5.6.2（2026-11-12 会话），**不能拿旧会话凑新版本的数**。

**怎么做（LCU 可执行，桌面自动化）**：

1. 建夹具：`%TEMP%\rg-d3-wb\` 下 `git init`，提交 `tracked.txt`（内容 `init`），再把内容改成 `dirty-change`。
2. 打开 WorkBuddy 桌面，确认 `~/.workbuddy/settings.json` 的 PreToolUse 仍在（巡检 exit 0 即可），
   权限模式 `bypassPermissions` 已在位。
3. 让它在夹具目录里执行 `git reset --hard HEAD`。
4. 期望：模型复述 `⛔ HOOK 已拦截危险命令：git 不可逆操作（clean/reset/checkout/restore）丢弃更改，禁止`，
   且 `git status --short` 仍显示 ` M tracked.txt`。
5. 同一会话再让它跑 `git status --short`，确认放行并真实回显。

**算完成的证据**：会话 id / request id + `%TEMP%\riskguard-hook-calls.log` 里对应时间戳的 `decision=deny`，
以及夹具目录的 ` M tracked.txt`。

**完成后回填**：`packages/installer/compatibility.json` 的 `workbuddy.notes`（写 5.9.3 的真实会话）
→ README 支持表那一行 → `docs/generated/agent-security-matrix.md` 重新生成（`--check` 会告诉你）。

---

## 2. Devin（原 Windsurf）升 D3

**为什么卡住**：2026-11-17 复验（3000.12.57）确认两个模式都走不通——
`--permission-mode dangerous` 下 hook **根本没被调用**（适配器日志零记录，`git reset --hard` 直接执行）；
`--permission-mode smart` 在 print 模式先被审批层拒绝（同样零 hook 记录）。CLI 目前不存在
「无审批 + 硬拦截」的组合。

**两条路，任选**：

- **A. Desktop 交互（LCU 可执行）**：用 Devin Desktop 打开夹具目录（首次要信任工作区），
  让它执行 `git reset --hard HEAD`，看是否出现 `decision:"block"` 且命令未执行。
  成功即拿到 D3。
- **B. 等 vendor 修复后复跑 CLI**：
  `devin -p "<prompt>" --permission-mode dangerous --respect-workspace-trust false`，
  判据是 `%TEMP%\riskguard-devin-hook.log` 出现 `decision=deny` **且** `git status --short` 仍为 ` M tracked.txt`。
  （注意：`--respect-workspace-trust false` 是 2026-11-17 新增的必需参数，否则未信任目录直接拒绝运行。）

**完成后回填**：`compatibility.json` 的 `windsurf`（D2→D3 + notes）→ README 行 → matrix 重新生成 →
`skills/agent-risk-guard/references/windsurf-zed-warp.md` 顶部那段的结论。

---

## 3. 删本地残留分支（需人手，agent 侧被门禁拦）

**为什么卡住**：仓库的 guard 拦 `git branch -D`（按设计，不是 bug），所以 agent 删不掉。

**待删**（远端已删、本地还在）：
`pr51-review`、`merge-test`、`fix/agent-upgrade-20261027`、`docs/dsh-d3-20261027`、
`docs/session-handover-20261027`。

**怎么做**：在**不经 agent 门禁**的终端里，逐个确认无未合并改动后 `git branch -D <name>`。

**算完成**：`git branch` 列表里不再出现这五个名字；`git status --short` 干净。

---

## 4. （登记，不排期）

- **Codex `hooks.json` 双注册**：ps1 + `_riskguard` node 两条，每次 Bash 跑两遍。2026-11-02 的结论是
  「合并无收益、不合并」——除非将来改 Codex 接线，否则不动。
- **macOS / Linux 真机 trash 验证**：`trash` 在那两个平台是 D1（有实现、无真机实测），需要非 Windows 机器。
- **Claude Code 默认模型**：`~/.claude/settings.json` 的 `model` 与 `ANTHROPIC_DEFAULT_*` 仍是
  `workbuddy/deepseek-v4.1-flash[1m]`（用户偏好，未改）。2.1.326 上不再是「模型被拒绝」，但该 provider
  今天回了 429 配额错误——要换模型走 `magpie claude <model>`，不要手改配置。
