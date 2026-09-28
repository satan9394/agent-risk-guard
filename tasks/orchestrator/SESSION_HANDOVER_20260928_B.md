# 会话交接 · 2026-09-28（第二段：三件套落地）

> **用途**：本文件是**给下一个会话（或清理上下文后的自己）的交接单**。
> 上一段（2026-09-27 起）的交接单是 `SESSION_HANDOVER_20260928.md`（四条约 PR），**本文件接续它**。
> **它不是产品文档**：放在 `tasks/orchestrator/`（与 `PRODUCT_STATE.md` / `DSH_RECOVERY_*.md` 同类）；
> **被取代后可移除**。规则文件（`AGENTS.md`）只放引用，不承载正文。

---

## 1. 项目当前状态（2026-09-28 第二段收尾时核对）

| 项 | 值 |
|---|---|
| 仓库 | `E:\DeepSeek_Harness\workspace\2026_08_21\agent-risk-guard`（remote `satan9394/agent-risk-guard`） |
| 分支 / HEAD | `main` = **`9e4884f`**（与 `origin/main` 一致）；工作区**干净**（`git status` 无输出） |
| 版本 / Release | 产品版本 `0.3.2`；**最新 Release 仍是 `v0.3.2`（2026-09-19）**——本段全部改动**未发版、未打 tag** |
| 本机接线 | `riskguard-wiring-check.ps1`（只读）**exit 0**；dsh headless / web 两 profile 逐条一致（单源 **74** 条） |
| 本次会话合并的 PR | **#34 / #35 / #36 / #37**（四条，均 CI 全绿后 squash 合并，分支已删） |
| 本机 goal 插件 | `@prevalentware/opencode-goal-plugin` **0.1.53**，`opencode plugin list` 可见 `local.goal-mode.server`——**重启后已确认加载** |

**支持面 D 级（`packages/installer/compatibility.json` 为准）**：
`workbuddy` 的 windows 本段由 **D2 → D3**（真实会话证据，见 §2.3）；macos/linux 仍 D0。

---

## 2. 本段做了什么（三件事，逐一对应你交办的 1/2/3）

### 2.1 PR #34 — wiring-check 的 DSH 段 YAML 校验加固（`01d1c59`）

**起因**：合并你 2026-09-24 那份未提交的 `scripts/riskguard-wiring-check.ps1` 增强（PyYAML 校验 +
索引对齐原位替换 + `# N3 预算闸门` 以下用户尾部保留式重组）。方向正确，但审查出**三处坑**，一并修掉：

1. **重组/替换写盘后不复验就宣布成功** → 抽 `Repair-DshPatchFromSource()`，写完必过
   `Test-YamlSyntax` 复验；复验失败明打「需人工处理」，**不谎称已修复**。
2. **python 缺失时 YAML 校验静默跳过** → 打一次 `[Warn]`（此前防线少一层且无人知晓）。
3. **PS 5.1 NativeCommandError 陷阱（你原版同病）**：坏 YAML 时 python 把 traceback 写上 stderr，
   `2>$null` 重定向会把它包成 ErrorRecord，撞脚本级 `EAP=Stop` → **直接终止整个巡检**（不是优雅报
   `[!!]`，而是死在该行）。修法：python 侧 `sys.excepthook` 吞 traceback（stderr 零输出）+ 函数内
   局部 `EAP=Continue` 双保险。

**验证**：密封测试（假 `USERPROFILE`，不碰生产面）**20/20**，覆盖三条自愈路径 + python 缺失路径；
测试沉淀为 `tasks/orchestrator/rg-wiring-check-sealed-test.ps1`（可复用，见 §5）。
生产只读复跑 `powershell`(5.1) 与 `pwsh`(7) **双 exit 0**。

### 2.2 PR #35 — 入库仓库规则入口与交接单（`df54b3b`）

- `AGENTS.md` / `CLAUDE.md`：本仓规则入口，**此前只在本地未跟踪**（clone 出去的副本拿不到规则）；
- `tasks/orchestrator/SESSION_HANDOVER_20260928.md`：上一段会话的交接单；
- `.gitignore`：**`pnpm-lock.yaml` 登记为忽略**。

> ⚠️ **此处修正了上一段交接单的建议**：它原写「`pnpm-lock.yaml` 应一并提交」。核查后发现**仓库统一 npm**
> （`package-lock.json` 是唯一锁文件、CI 用 `npm ci`，见 `.github/workflows/ci.yml`），双锁文件并存只会
> 制造歧义 → 改为忽略。

### 2.3 PR #36 — WorkBuddy windows D2 → D3（`998156d`）

**起因**：你贴了三个 ID（`traceId` / `conversationRequestId` / `conversationId`）。用它们从本机取证
（`%TEMP%\riskguard-hook-calls.log` + 回收站 `$I*` 元数据 + 会话产物互证），满足仓库硬约束 5 的全部要件：

- **危险命令被拒**：hook 日志 `decision=deny` 两条——`shred`（06:00:52）、`Clear-Content`（06:01:56），
  均为**委派后仍拦**的不可逆操作；
- **安全命令放行**：python 分析 / `ls` / 回收站只读盘点多条 `decision=allow`；
- **委派链路端到端实证**：3 条删除命令经 `[delete-exempted:RG_ALLOW_DELETE]` 放行，7 个测试文件
  **全部落进回收站**（原路径 / 大小 / 删除时间逐一吻合），**永久删除实际发生 0 起**。

三处同步：`compatibility.json`（两处 D2→D3 + notes 证据段）、`references/workbuddy.md`（D3 段重写 +
新增三条陷阱）、`README.md` 支持面表；矩阵由生成器重生成（非手改）；`CHANGELOG` / `docs/decisions.md` 补行。
证据三件套入仓：`WORKBUDDY_D3_SESSION_20260928.md`（会话自产报告）+ `wb-d3-20260928-repro-cmd.txt`
+ `wb-d3-20260928-analyze.py`。

### 2.4 PR #37 — 本交接单 + 规则文件引用方式（`9e4884f`）

- 新增本文件；`AGENTS.md` 的「新会话先读」由**写死文件名**改为**取最新一份** `SESSION_HANDOVER_*.md`
  （同日多份取后缀最大的，如 `_B` 接续上一份）——规则文件只做引用，日后新增交接不必再改规则文件。

---

## 3. 未完成 / 待办（**复核从这里开始**）

### 3.1 需要你决策的三点

1. **WorkBuddy `Remove-Item` 一路仍不可用，但拦它的不是本项目**（本段发现，**未修**）：
   hook 已按委派放行（日志三条均 `[delete-exempted]`），执行侧被**平台沙箱**拦下
   （`sandbox-center cmd decisionRecord missing actual resource subject`）；同一会话里 bash `rm` /
   python `os.remove` / .NET `File::Delete` 三路都走通并进了回收站。**是否要向 WorkBuddy 侧反馈**由你定。
2. **是否给 `compatibility.json` 的 workbuddy 加 `D4`**：硬约束里 D4 = 「重复 / 生产验证」。本段只取到
   一次真实会话（D3），**没有**做第二次复现，故**未**报 D4。若你认为一次会话 + 委派端到端实证已够，
   可再跑一次真实会话后升 D4。
3. **是否把本段的 `rD` 误拦修掉**（见 3.2 第 1 条）：按项目政策，**过拦 = 放松方向 = 敏感方向**，
   须独立一轮 + 专门验收，不能夹带在其他 PR 里。默认**不修**。

### 3.2 已登记未修（`docs/TODO.md`，本段新增两条）

1. **已知过拦：只读盘点回收站的 Python 命令被误判为「回收站清空族」deny**（`docs/TODO.md` §已知过拦）：
   根因链——引擎的**去引号副本**把 `d=r'D:\$Recycle.Bin\…'` 变成 `rD:\…`，前缀 `r` + 盘符 `D` 拼成伪词
   **`rD`**，撞删除动词词边界里的 **`rd`**（Windows `rmdir` 简写）；同条命令又含 `$Recycle.Bin` 路径
   → 命中「直删回收站存储」。复现材料（已入仓）：`wb-d3-20260928-repro-cmd.txt`、`wb-d3-20260928-analyze.py`。
   **注意**：该误拦就是本段 D3 取证时 05:59:29 那条 deny，**已排除出 D3 正面证据**。
2. **`-Fix` 对全新机器缺父目录会直接崩**（`docs/TODO.md` §运维脚本欠账）：目标 home 缺
   `~/.claude/hooks` 等目录时 `Copy-Item` 抛 `DirectoryNotFoundException`，撞 `EAP=Stop` 终止整个巡检；
   `settings.json` 段同病。影响面仅「从没装过该 Agent 的机器上跑 `-Fix`」，本机无感。

### 3.3 上一段交接单留下、本段**未动**的开口项

1. **跨端闸门 CI 时长**（每次碰引擎多约 19 分钟）：优化方向「一次 bash 会话批量喂载荷」会**换掉闸门
   「逐条真实 spawn」的设计前提**，属独立决策（`DECISIONS.md` D-0054）。**不要顺手改**。
2. **macOS trash 实测**：无硬件，`docs/TODO.md` 挂着。
3. **hook 性能优化 / `agy-plan-readonly` 入仓**：TODO 标注「待确认 / 独立开一轮」。
4. **`~/.config/opencode/AGENTS.md` 与其余四份规则文件不再逐字同步**：**有意例外**（D-0053）。
5. **全局 goal 插件**（本段配好并已验证加载）：见 §4 第 1 条，**不要再装第二套 goal 插件**。

### 3.4 归档仓侧（`E:\Code_file\Claude_code`）本段应记的内容

- 日记：`Notes/2026/09/NOTES_20260928.md`（追加本段条目——**注意该文件同一天已有多条，追加前必须重读**）；
- 决策：`Notes/DECISIONS.md` 追加 **D-0057**（goal 插件选型与全局落点，见 §4）。
  **追加编号前必须当次重读最大编号**（D-0055 就是撞号改号的前例）。

---

## 4. 本段对全局配置的改动（**不在本仓库的 diff 里，容易漏**）

1. **OpenCode goal 插件：全局换成 `@prevalentware/opencode-goal-plugin`（只装这一版）**
   - 改动落点：`~/.config/opencode/opencode.json` 的 `plugins`（V2 对象形式，含
     `options: {auto_continue: true, max_auto_turns: 12, max_goal_duration_seconds: 1800, locale: "zh-CN"}`）
     与 `~/.config/opencode/cli.json` 的 `plugins`（字符串数组，TUI 侧栏 / 命令面板集成）。
   - **替换掉的是** `github:beremaran/opencode-goal#8f8bf84…`（两插件会在 `/goal` 命令与工具名上撞车）。
     替换前备份：`opencode.json.bak-20260928` / `cli.json.bak-20260928`（同目录）。
   - **实测已生效**：`opencode plugin list` → `local.goal-mode.server  0.1.53  @prevalentware/opencode-goal-plugin`。
   - **状态文件**：`%APPDATA%\opencode-goal-plugin\goals.json`（**不是** 用户主目录下的
     `~/.local/share/opencode-goal-plugin/goals.json`，旧插件若有状态与本插件互不影响）。
   - **不要**再按另一套（loop / ensemble / Ralph）配 goal 或同时装两版。

---

## 5. 本段的可复用产物

| 文件 | 用途 |
|---|---|
| `tasks/orchestrator/rg-wiring-check-sealed-test.ps1` | **wiring-check 的密封测试**（假 `USERPROFILE`，**不碰生产面**）：20 条断言覆盖坏 YAML 重组、无 N3 标记拒绝重组、原位替换、python 缺失告警。直接 `pwsh -File` 跑，末行打印 `20 pass / 0 fail` |
| `tasks/orchestrator/WORKBUDDY_D3_SESSION_20260928.md` | WorkBuddy D3 会话自产报告（D3 证据之一） |
| `tasks/orchestrator/wb-d3-20260928-{repro-cmd.txt,analyze.py}` | `rD` 伪词误拦的复现材料（修 3.2 第 1 条时用） |
| `tasks/.tmp/` 下旧产物 | 上一段的 `probe-dyndel.mjs` / `rg-parity-r18.mjs` 等仍在（被 gitignore，可复用；见上一段交接单 §6） |

---

## 6. 权威记录指针（细节以这些为准，本文件只是索引）

- `docs/decisions.md` B 表末三行（wiring-check 加固 / WorkBuddy D3 / 跨端闸门）
- `CHANGELOG.md` `[Unreleased]`（含 D3 证据段与逐套测试数字）
- `packages/installer/compatibility.json`（D 级单一事实源）· `docs/generated/agent-security-matrix.md`（自动生成）
- `skills/agent-risk-guard/references/workbuddy.md`（委派语义 + D3 证据 + 三条陷阱）
- `docs/TODO.md`（已知过拦 / 运维脚本欠账，本段新增两条）
- 上一段交接单：`tasks/orchestrator/SESSION_HANDOVER_20260928.md`
- 归档侧：`E:\Code_file\Claude_code\Notes\{2026/09/NOTES_20260928.md, DECISIONS.md}`

---

## 7. 复核清单（建议按序执行）

```powershell
cd E:\DeepSeek_Harness\workspace\2026_08_21\agent-risk-guard

# 0) 现状
git log --oneline -4 ; git status --short          # 期望 HEAD=9e4884f，工作区干净

# 1) 巡线（只读）：五端 + skill 副本是否仍与单源一致
& powershell -NoProfile -ExecutionPolicy Bypass -File scripts\riskguard-wiring-check.ps1   # 期望 exit 0

# 2) wiring-check 密封测试（假 home，不碰生产）
pwsh -NoProfile -ExecutionPolicy Bypass -File tasks\orchestrator\rg-wiring-check-sealed-test.ps1  # 期望 20/20

# 3) WorkBuddy 专项
node --test tests/adapter/workbuddy-injection.test.ts

# 4) 文档闸门
node scripts/generate-agent-security-matrix.ts --check
node scripts/check-compatibility-docs.ts
node scripts/check-decisions-log.ts

# 5) 跨端闸门（改过引擎才需要；全量约 10 分钟走 WSL / 约 42 分钟走 Git Bash）
node --test packages/core/test/decision-parity.test.ts
```

**判读要点**：
- 第 5 步输出里 `ends: ps1 via … + sh via …` 会告明用的哪两端；若出现 `CROSS-END GATE NOT RUN`，
  说明**这条红线没跑**（**不是通过**）。
- 本段**未改引擎文件**（规则 / hook / 语料都没动），故第 5 步非必需；但若要复跑，记得两端必须同时在场。
- 若第 1 步报漂移，用 `-Fix`（会备份到 `~/.risk-guard-backup/`）后再复核一次。
