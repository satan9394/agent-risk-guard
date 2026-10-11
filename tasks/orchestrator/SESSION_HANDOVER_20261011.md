# 会话交接 · 2026-10-11（agent-risk-guard：健康治理 + 发版政策 + `/plan` 复核）

> **用途**：给下一个会话（或清理上下文后的自己）的交接单。放在 `tasks/orchestrator/`，与
> `PRODUCT_STATE.md` / `SESSION_HANDOVER_20260928_B.md` 同类；**被取代后可移除**。
> **规则文件（`AGENTS.md`）只引用，不承载正文**。
> **本文不写「写下去就过时」的值**（HEAD / PR 编号 / 末次 commit 一律以 `git log` 为准）。

---

## 1. 项目当前状态（读时以命令为准）

| 项 | 怎么取 |
|---|---|
| 分支 / HEAD / 最近提交 | `git log --oneline -8` |
| 工作区是否干净 | `git status -sb`（期望干净，或仅 `.tmp`/忽略物） |
| 是否发了版 | `git tag --sort=-creatordate | Select-Object -First 3` 与 `gh release list --limit 1`；**本仓日常不发版**（见 §2.2） |
| 未完成项 | `docs/TODO.md` 未勾选条目（本段收尾时 **16 条**，均为 backlog/roadmap/有意延后，**无一条属安全方向**） |
| 本机接线体检 | `pwsh scripts/riskguard-wiring-check.ps1`（期望 **exit 0**） |

---

## 2. 本段（2026-10-10 ~ 10-11）做了什么 —— 4 个 PR，全部合并到 `main`

### 2.1 修 2 个真实缺陷 + OpenCode 适配（PR #44）
- **缺陷①**：`scripts/riskguard-wiring-check.ps1` 的 DSH 规则比对原为「整行 `Trim()` 后文本」，
  而 `~/.dsh/profiles/desktop` 的规则是 **YAML 块式写法**（`re`/`reason` 分行），永远对不上 inline 单源 →
  恒报「规则缺失 43 条」，`-Fix` 又只认单行、修不动，计划任务每 5 分钟假阳性 `exit 1`（09-29 起累计 300+ 条）。
  **修法**：抽取改格式无关的 `Get-RuleEntries`（`re|||reason` 规范化 + 正确解析 YAML 单引号 `''` 转义 + 字符偏移）；
  `-Fix` 按偏移从后往前**整条原位替换**。
- **缺陷②**：`-Fix` 在**全新机器**（缺 `~/.claude/hooks` 等父目录）时 `Copy-Item` 抛
  `DirectoryNotFoundException` 撞 `EAP=Stop` **终止整个巡检**。**修法**：restore 前建父目录；`settings.json` 缺失从空对象起步。
- **OpenCode 2.0.26 回归**：新增断言「插件不得顶层导入 `@opencode-ai/plugin`」（宿主该包已升到 1.14.28，类型面与插件 V2 入口不一致，顶层导入会把 V2 加载绑死在漂移包上 → fail-open）。
- **验证**：密封测试 **40/40**（新增 T6 块式 10 断语、T7 全新机器 5 断语）；**回退对比**同一块式文件旧逻辑缺 74 / 新逻辑缺 0；生产只读巡检 exit 0；平台无关测试 261/261。

### 2.2 定「开发/发版政策」（PR #45；归档仓 `Notes/DECISIONS.md` 记为 D-0072）
- 默认工作流 = **先本地提交，再推远程**；**日常只提交、不打 tag、不发 Release**；**发版节奏 ≈ 30 天一个版本**（个人开发、时不时修一修）。
- 约定落在 **`AGENTS.md`**（规则入口）。
- 附带实测：`main` 有仓库规则「必须 PR + 5 项状态检查」，**直接 `git push origin main` 会被拒**（`GH013`）→「提交到远程」的实际形态是 **分支 → PR → CI 绿 → 合并**。

### 2.3 登记 3 项待办（PR #46）
`/plan` 多轮（当时列为可疑）、agy 版本漂移、发布产物 tests 的 CI 断言建议。**其中 `/plan` 那条已在 PR #47 推翻**（见下）。

### 2.4 `/plan` 多轮注入复核 = **非漏洞**（PR #47，关闭该条）
此前担心 `plan-readonly-guard` 只读**最后一条** `USER_INPUT`，若 agy 只在首轮注 `/plan` 会漏判放行。**双证否掉**：
1. **官方文档**（`antigravity.google/docs/cli/modes`）：*plan 模式生效期间，CLI **automatically prepends the `/plan` prefix to your prompts***（每轮）。
2. **本机探针**（新会话，`Shift+Tab` 进 plan 后**不打 `/plan`**）：两轮 `USER_INPUT` **都自动带了 `/plan`**，均未写出文件。
3. 旧会话复核 + hook 单测：**前缀在 ⟺ plan 模式开**；「只带首轮标记」的会话是之后切出了 plan。
- 残留（保留观察）：若 agy 将来「plan 生效却不补前缀」，hook 会退回 fail-open，届时以「agent 是否仍拒绝写入」佐证。

### 2.5 顺带核实（不改文件）
- 「别人安装会不会拉到测试文件」：Release 附件 / `bootstrap` 运行时**不含**测试；`git clone` / `npx skills add` 含。归档仓 `Notes/DECISIONS.md` 记为 **D-0071**。
- 本机各 Agent 的**安装副本已是最新**（靠计划任务 `RiskGuard_WiringCheck` 每 5 分钟 `-Fix` 从单源回灌；`wiring-check` exit 0 即证）。
- 远程卫生：删除 **3 个已完全合并**的远程分支（`feat/real-agent-conformance`、`fix/acs-schema-conformance`、`fix/acs-version-gate-release-assets`）。

---

## 3. 未完成 / 待办（**复核从这里开始**）

**权威清单 = `docs/TODO.md` 的未勾选项**（本段收尾 16 条）。归类概览（不逐条抄，避免漂移）：

- **已决定不做**：WorkBuddy 升 D4（保持 windows=D3）。
- **按章程「登记延后、不开新轮」**（过拦/边角，属放松方向需独立 Evaluator）：`git branch -d` 过拦、`git branch -m/-M` 是否收紧、`rD` 伪词误拦。
- **需外部条件**：macOS/Linux trash 真机、Cursor / Copilot CLI / Windsurf 真实 D3、Copilot CLI machine Policy Hook PoC。
- **独立切片（建议下一轮优先）**：**`agy-plan-readonly.ps1` 入仓**（现只活在 `~/.gemini/config/hooks/` + 个人归档，含 59/59 测试台；唯一压在热路径却未版本化的脚本）。入仓四件事见 `docs/TODO.md`。
- **小尾巴**：agy 版本漂移（compatibility 记 1.3.2 / 本机 1.3.3，D3 证据停 1.2.7）、发布产物「不得含 `tests/`」的 CI 断言建议、hook 性能（Git Bash 4–5s）、plan 模式解释器全禁体感、`powershell.exe` vs `pwsh` 两处差异。
- **长期 roadmap**：bash AST 角色解析、入站 secret 扫描、JIT 限时放行、hash-chain 审计账本、prompt injection 检测、OS 级沙箱。

---

## 4. 对全局 / 本机的改动（**不在本仓 diff 里，容易漏**）

- **本轮未改任何全局配置**（只读复核 + 本仓 docs）。`~/.gemini/config/hooks/*` 与各 Agent 的 hook/插件**未被改动**。
- **删除的远程分支**（3 个，见 §2.5）；**保留未动**：本地仓库里一批 `[gone]` 分支（删除被本仓 guard `GIT_WORKTREE_DISCARD` 拦下，属正确行为）。
- 归档仓 `E:\Code_file\Claude_code`（本地专用、无 remote、每日 23:50 自动提交）：`Notes/2026/10/NOTES_20261010.md` 与 `NOTES_20261009.md` 追加了本段记录；`Notes/DECISIONS.md` 新增 D-0070（巡检须语义比对）、D-0071（分发面分治）、D-0072（发版政策）。

---

## 5. 可复用产物 / 证据

| 产物 | 用途 |
|---|---|
| `tasks/orchestrator/rg-wiring-check-sealed-test.ps1` | 接线巡检**密封测试**（假 `USERPROFILE`，不碰生产面）；现 **40/40**，含 T6 块式 / T7 全新机器 |
| `docs/TODO.md` | 唯一待办清单（权威） |
| `docs/decisions.md`（B 表） | 本段 2026-10-09/10 的裁决行 |
| `/plan` 探针方法 | 见 §2.4；复现：`Shift+Tab` 进 plan → 两轮都不打 `/plan` → 看 transcript 两条 `USER_INPUT` 是否都带 `/plan` |
| 归档仓 Notes/DECISIONS | 跨会话对账（D-0070/0071/0072） |

---

## 6. 复核清单（建议按序执行）

```powershell
cd E:\DeepSeek_Harness\workspace\2026_08_21\agent-risk-guard

# 0) 现状
git log --oneline -8 ; git status --short

# 1) 本机接线巡检（只读）：五端 + skill 副本是否与单源一致
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\riskguard-wiring-check.ps1   # 期望 exit 0

# 2) 密封测试（假 home，不碰生产）
pwsh -NoProfile -ExecutionPolicy Bypass -File tasks\orchestrator\rg-wiring-check-sealed-test.ps1  # 期望 40/40

# 3) 三个文档闸门
node scripts/generate-agent-security-matrix.ts --check
node scripts/check-compatibility-docs.ts
node scripts/check-decisions-log.ts

# 4) OpenCode 2.0.26 回归
node --test tests/adapter/opencode-guard-v2.test.ts

# 5) 跨端闸门（改过引擎文件才需要；本段未改引擎）
node --test packages/core/test/decision-parity.test.ts
```

**判读要点**：第 5 步若出现 `CROSS-END GATE NOT RUN`，那是**没跑**不是通过（需两端同时在场）。第 1 步报漂移用 `-Fix`（备份到 `~/.risk-guard-backup/`）后复核。

---

## 7. 下一次从哪继续

- **若继续做事**：优先 `agy-plan-readonly.ps1` 入仓（独立一轮）；其次把「agy 版本漂移」「发布产物 tests 断言」两条小尾巴清掉。
- **若只是接手**：先读 `docs/TODO.md` + 本文 §3，再按 §6 跑一遍体检。
- **不要做的事**：不要为「顺手」打 tag / 发 Release（日常只提交，见 §2.2）；不要把 transcript 里的明文密钥摘录进任何仓库文件。
