# 会话交接 · 2026-11-17（agent-risk-guard：本机 14 端全量适配 + doctor/status 覆盖补齐）

> 给下一个会话的交接单。规则正文在 `AGENTS.md`，不在这里重复。
> 取值一律以命令为准（HEAD / PR 号以 `git log` / `gh pr list` 为准）。

## 1. 本段做了什么

### 1.1 版本盘点 + 逐端 D3 重取（12 端换了版本）

| Agent | 11-02 记录 | 11-17 实测 |
|---|---|---|
| Claude Code | 2.1.316 | **2.1.326** |
| OpenCode | 2.2.5 | **2.3.0** |
| Codex CLI | 0.166.0 | **0.169.0** |
| DeepSeek Harness | 0.2.1-rc.5 | **0.2.2-rc.3** |
| Cursor | 3.29.9 / 2026.11.05-86047df | 3.29.9 / **2026.11.13-eacade1** |
| Copilot CLI | 1.0.109 | **1.0.112** |
| agy | 1.4.12 | **1.5.10** |
| Grok CLI | 1.0.77 | **1.0.88** |
| Pi | 1.5.2 | 1.5.2（同版本复验） |
| omp | 18.18.8 | **18.22.0** |
| Kimi Code | 2.5.3 | **2.6.2** |
| MiniMax Code | 0.7.6 | **0.7.7** |
| Devin | 3000.12.57 | 3000.12.57（仍 D2） |
| WorkBuddy | 5.6.2 | **5.9.3**（桌面端，未取新会话） |

每端都取了「deny + 脏改动存活」与「allow + 真实执行」两条证据；原始输出、命令、日志时间戳见
`tasks/orchestrator/AGENT_UPGRADE_D3_20261117.md`。`compatibility.json` 的 `componentInventory.version`
与 notes 已同步。

### 1.2 真正的代码缺口：doctor / status 看不见 8 个已安装 Agent

cursor / copilot / grok / devin / pi / omp / kimi-code / minimax-code 早已接线、D3 在案，但：

- `cmdDoctor` 的 `order` 只有 6 端；
- `runtime-probe` 没有它们的分支；
- `discovery.ts` 的注册表里没有 dsh / pi / omp / kimi-code / minimax-code / devin，copilot 的探针是
  「按 CC 内核猜」的错误路径，grok / cursor 只探 `%APPDATA%`。

⇒ 已安装的这 8 端在 `doctor` 与 `status` 里**一行都不输出**（与 2026-09-21 agy 同一个坑）。

修法：

- `runtime-probe.ts` 新增 `HOOK_FILE_AGENTS` 表（`json` / `toml` / `artifact-only` 三种形态，
  `cursor` / `permissionDecision` / `grok` / `devin` / `bridge` 五种 self-test 协议）；
- `HOOK_SINGLE_SOURCE_MAP` 补 4 个适配器 + bridge + pi/omp 扩展（新鲜度不再恒为 null）；
- `discovery.ts` 注册表补齐 14 端、修正探针，`claude-code-copilot` 退役为 `copilot`；
- `cmdDoctor` / `cmdStatus` 的 `order` 扩到 14，`doctorFixHint` 对这 8 端指向 wiring-check；
- WorkBuddy 状态改与 agy 同口径（此前 doctor 说 PASS、status 说未安装）。

结果：`doctor` = **14 PASS / 0 WARN / 0 FAIL / 4 SKIP**（cline/aider/goose 未安装；hermes 是
documented-only 的残留配置目录，明确写「未提供门禁」而不是静默）；`status` 14 行全 ACTIVE。

### 1.3 新增回归测试

`packages/installer/test/doctor-agent-coverage.test.ts`（6 条，已加进 `test-all.ps1`）。
其中「假 home 里接线 cursor → doctor 必须真去探（不是 SKIP）」是 order 覆盖的证据；
已验证把 `order` 砍回 6 端会让它**变红**。

### 1.4 文档纠正

- `docs/TODO.md`：`[claude-code:unrecognized_model]` 是诊断标记不是拒绝；2.1.326 上默认
  `workbuddy/deepseek-v4.1-flash[1m]` 确实发到了 provider（回 429 配额）。**未改用户模型偏好**。
- `docs/adding-an-agent.md` 新增 §2.5「三张登记表」：`AGENT_REGISTRY` / `HOOK_FILE_AGENTS` / `order`，
  以及五种协议不能套用 CC payload 的原因。
- `references/`：`windsurf-zed-warp.md`（Devin 的两条新行为）、`pi-aider.md`（omp 18.22 的审批陷阱）、
  `agent-matrix.md`（14 端版本行 + Devin 行改 D2）。

## 2. 未完成 / 待办

1. **WorkBuddy 5.9.3 的 D3**：桌面应用无 CLI，需一次人工桌面会话（prompt `git reset --hard HEAD`，
   期望 `⛔ HOOK 已拦截…` 且 `M tracked.txt` 存活）。现在记录的 D3 仍属 5.6.2。
2. **Devin 升 D3 只有两条路**：Desktop 交互取证，或等 vendor 修复 `--permission-mode dangerous`
   不触发 hook（本轮复验：适配器日志零记录、命令真执行；`smart` 在 print 模式又被审批层拒绝）。
3. **Codex `hooks.json` 双注册**仍未合并（2026-11-02 起的旧账）：ps1 + `_node` 两条，每次 Bash 跑两遍。
   结论仍是「合并无收益」，但两处脚本都要跟单源走。
4. **本地残留分支**（远端已删，仓库 guard 拦 `git branch -D`，需人工删）：`pr51-review`、`merge-test`、
   `fix/agent-upgrade-20261027`、`docs/dsh-d3-20261027`、`docs/session-handover-20261027`。
5. **`AGENTS.md` 与 `CLAUDE.md` 的工作区改动**（`M AGENTS.md` / `D CLAUDE.md`）是别人留下的，本段未动。
6. **密封测试已修好并纳入交接清单**（原先 T9d/T9g/T10c 三条一直红，见 CHANGELOG）。以后改 Cursor
   接线时要同步改这三条里的具体取值断言；交接清单已加 `rg-wiring-check-sealed-test.ps1`（期望 64/64）。

## 3. 复验清单

```powershell
cd E:\DeepSeek_Harness\workspace\2026\08\21\agent-risk-guard

git log --oneline -6 ; git status --short

node bin/riskguard.mjs doctor                # 期望 14 PASS / 0 FAIL / 4 SKIP
node bin/riskguard.mjs status                # 期望 14 行 ACTIVE

node --test packages/installer/test/doctor-agent-coverage.test.ts      # 期望 7/7
& .\test-all.ps1                             # 期望 exit 0

pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\riskguard-wiring-check.ps1   # 期望 exit 0
pwsh -NoProfile -ExecutionPolicy Bypass -File tasks\orchestrator\rg-wiring-check-sealed-test.ps1   # 期望 64/64
node scripts/generate-agent-security-matrix.ts --check
node scripts/check-compatibility-docs.ts
node scripts/check-decisions-log.ts
```

改过 `skills/agent-risk-guard/**` 时必须做个人技能分发链：

```powershell
& "$env:USERPROFILE\.skills-manager\bin\skills-manager-cli.exe" skills update agent-risk-guard
# 4 个部署点（claude/opencode/dsh/antigravity）是 junction，update 后逐点比 hash
```

## 4. 证据产物

| 产物 | 用途 |
|---|---|
| `tasks/orchestrator/AGENT_UPGRADE_D3_20261117.md` | 14 端真实会话的完整记录（命令、输出、日志时间戳、取证陷阱） |
| `packages/installer/test/doctor-agent-coverage.test.ts` | 覆盖回归闸门（7 条，含反向对照与回退变红验证） |
| `packages/installer/compatibility.json` | 版本与 D3 备注的唯一事实源 |
