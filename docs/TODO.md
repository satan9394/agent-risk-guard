# TODO — 待办清单

> 待确认 / 待执行事项。**发布类、生产同步类动作一律等用户确认后执行**；完成后勾选。
> 对应仓库：https://github.com/satan9394/agent-risk-guard

## 待用户确认（阻塞中，2026-08-29 R3 生态融合）

- [x] **生产 skill 目录同步（R3）**：生产 `~\.claude\skills\custom\agent-risk-guard-audit\` 的 `assets/dsh/deny-risk-commands.patch.yml` 35 → 47 条（解释器 one-liner / git 破坏清单 / Windows wrapper），同步仓库最新 patch 与文档（2026-09-10 已同步至 69 条新版）。**⚠️ 2026-09-13 复核更正**：原写「四处副本哈希一致」**不实**——复核当日该树 hooks 三份仍是 G24 之前的旧版（`dangerous-commands.ps1` = 17739 B / `9BB6374D8FC25B54`，其 L175 仍是旧 rule 16「整条命令级否定」，即 G24 修掉的那个静默泄漏；`dangerous-commands-universal.ps1` 与它**同哈希**＝误拷）。已于 2026-09-13 同步为 canonical：`9889F367F2944756` / `AC566BE720A9006C` / `F80DABF048C3E98A`，同步前备份于 `scripts.bak-20260913-041246`。**该树仍缺** `dangerous-commands-agy.ps1` 与 `agy-dangerous-commands.ps1`；`agent-risk-guard-audit-xhs-publish/scripts/` 仍为旧变体（不在本次授权范围，已登记待决）。
- [x] **DSH 门禁同步（R3）**：`~/.dsh/profiles/web/cordis.patch.yml` 的 deny-risk-commands 35 → 47 条，让新规则在 pre-execute 门禁真实生效（2026-09-10 已升至 69 条含 dd/format 修订，热加载生效）

## 已授权可执行（待安排）

- [x] **GitHub Release 页面**：v0.2.0（2026-08-21 补建，Pre-release）与 v0.2.1（ACS Schema Conformance Patch，Pre-release）已创建；`v1.0.0` 仍只有 git tag，无 Release 页面（建议带 CHANGELOG 摘要发布）
- [ ] **macOS / Linux trash 实测**：trash 包 macOS/Linux 分支为 D1（文档级）。**2026-09-10 WSL Ubuntu + Git Bash 双环境已实测 hook 规则集（见 tasks/t1-wsl-report.md、tasks/t2-gitbash-report.md，299/299 用例全过）**；macOS 真机 trash 命令实测仍待补。
- [x] **Codex D3 实测**：2026-09-07 CLI 真实会话 git reset 拦截 PASS；2026-09-10 用户语音会话实测 Remove-Item 永久删除被 PreToolUse hook 明确拦截（文件保留），删除类 D3 证据链闭合（已补录 compatibility.json）
- [x] **WSL + Git Bash 跨平台测试与修复（2026-09-10）**：sh Linux hook 在 WSL Ubuntu（真 Linux，299/299）与 Git Bash（MINGW64，修复后 299/299）全量验证；发现并修复 P0 全角 NFKC 编码绕过（PYTHONUTF8）、git checkout--/restore/git rm/perl-ruby 规则缺口、grep 回退死代码 fail-open；ps1/opencode 同步补齐，deploy/dsh patch 原本已覆盖；回归用例已进三套件。报告：tasks/t1-wsl-report.md、tasks/t2-gitbash-report.md（含修复记录）。
- [ ] **hook 性能优化（Git Bash 4-5s/次）**：合并 hook 内多次 python3 spawn 为单次调用（Git Bash 下实测单次 4.0-5.6s vs WSL 0.2s，慢 20-28 倍）；已文档标注延迟预算，待接入方确认是否优化。

## v0.2.0 遗留（下一阶段，见 docs/devlog-2026-09-05-v0.2.0.md）

- [ ] **真实 Agent D3 Conformance（P1 顺序 §二十八）**：基于统一 Conformance Framework（C1–C10）对 Cursor / Copilot CLI / Windsurf 做真实会话执行；Cursor 先做 official payload fixture → adapter contract test → conformance harness（§二十九）
- [ ] **Copilot CLI machine Policy Hook PoC**：system policy（`/etc/github-copilot/policy.d/` / `C:\ProgramData\GitHub\Copilot\policy.d\` / Registry）→ RiskGuard Machine Guard（§三十，本轮只预留 policyScope）
- [ ] **MCP canonical capability 深化**：`mcp.invoke` 从近似映射升级为一等 capability（server/tool identity，tool poisoning 门禁，P1）
- [ ] **Gemini BeforeTool adapter（D2）**：P2 顺序（§二十八）

## 已知过拦（登记延后，不开新轮）

> 项目停止规则：**只有安全方向（放松 / fail-open / 丢拦截）才开新轮，过拦与边角一律登记延后。**
> 本节记「拦截判定本身成立、但拦掉了本可放行的形态」。放松属 D12 意义上的敏感方向，
> 需要独立 Evaluator 专门一轮，故不夹带在其它 PR 里。

- [ ] **`git branch -d` / `--delete`（不带 force）被拦**（2026-09-21 R7c 登记）：
  git 的 `-d` 是**安全删除** —— 分支未合并进 HEAD/upstream 时 git 会直接拒绝，不会丢提交；
  真正不可逆的是 `-D` / `--delete --force`。当前五端（core / opencode / ps1 / sh / DSH）
  一律拦 `-d`，理由是**产品立场**「分支引用删除一律拦」——与 DSH 自 R4 起拦 `git update-ref`
  自洽，且被拦后的逃生路径（`git update-ref -d`）现已在五端同样拦死（R7c 补齐）。
  **若将来要放松**：须同步改 5 处规则 + `decision-parity` 的 N8/N14 两条语料 + 本条，
  并走独立验收；不得只改一端（R7 首版就是这样引入 38 条放松被 REJECT 的）。
- [ ] **`git branch -m/-M/-c/-C`（重命名/复制分支）不被判为破坏**：`-M` 会覆盖同名分支，
  理论上可丢引用；当前五端放行，与 `isReadOnlyCommand` 不把它们当只读的事实并不矛盾
  （既不只读、也不判破坏 → 走默认路径）。未实测是否值得收紧，登记。
- [ ] **`skills/agent-risk-guard/scripts/opencode/destructive-operation-guard.ts` 是旧代次副本**
  （27.5KB / v0.1 时代）而现网加载的是 `assets/opencode/agent-risk-guard.ts`（32.4KB）；
  `SKILL.md` 与 `references/opencode-wiring.md` 仍把它写成部署取源，照做会装回旧插件。
  R7c 只同步了其中的 `git branch` 规则，**未做整代对齐**（属独立欠账）。

## agy（Antigravity CLI）相关欠账

> 2026-09-21 C 批已闭环：agy 纳入 `doctor`（此前「已安装却在 doctor 里一行都没有」）、
> 新增 `agy-hook-test.ps1`（6 套 × 双引擎进 CI）、适配器规则引擎改为按优先级探测
> （不再硬编码 `~/.codex/hooks/`）、`agy-dangerous-commands.ps1` 纳入接线巡检（此前是
> 唯一没有哈希纪律的生产脚本）、生成器 timeout 对齐实测值 15s。**以下为仍未做的部分。**

- [ ] **`agy-plan-readonly.ps1` 入仓（判为「有用，但需独立切片」）**：该 hook 现在只活在
  `~/.gemini/config/hooks/agy-plan-readonly.ps1`（19,247B）＋ 个人脚本归档
  `E:\Code_file\Claude_code\2026\09\20\`（含 93/93 测试台），**不在仓库、不在巡检、不在 CI**。
  它是唯一压在热路径上（`matcher: "*"`，每次 agy 工具调用都过）却完全未版本化的脚本 ——
  静默坏掉无人发现。**为什么不并进 R7c/agy 那批**：它属**另一条政策轴**（「plan 模式下按能力
  只读」），而本产品章程是不可逆破坏拦截；混进 `deny-risk-commands` 单源链会模糊产品边界，
  且它自带三条未实测项（Shift+Tab 粘滞多轮、`$()` 无通用递归、`always-proceed` 下真删未验）。
  **入仓需做的四件事**：① 定义单源并纳入 `HOOK_SINGLE_SOURCE_MAP` + 巡检；② 把 93/93 测试台
  收进 `skills/agent-risk-guard/tests/` 并进 CI；③ `compatibility.json` 增补对应能力面
  （plan 模式下 `filesystem.write` = deny）；④ 三条未实测项逐一实测或登记。建议独立开一轮。
- [x] ~~真实 agy 会话 D3 复验（当前 agy 1.2.7，D3 证据停在 1.1.27）~~ —— **已完成，2026-09-21**。
  agy **1.2.7** 真实会话里 `run_command` 执行 `git reset --hard HEAD` 被 hook 拒绝
  （`tool call denied by pre-tool hook: RiskGuard: ⛔ HOOK 已拦截危险命令：…`），同会话 `Read` 与
  `git status` 放行、工作区未提交改动存活；钩子日志有对应的 `decision=deny` 行。
  `compatibility.json` 的 agy `componentInventory.version` 已由 1.1.27 升至 **1.2.7**。
  ⚠️ 方法论教训（已写进 notes）：用「把文件永久删掉」这类提示词会被 agy 在**规则层直接拒绝**
  （一次工具调用都不发，钩子日志零记录）——那是 `soft` 遵循而非 `hard` 拦截，**不构成 D3 证据**；
  必须用模型不认为该拒绝的命令（如 git reset）才能触发钩子。
- [ ] **两个 PreToolUse hook 共存仍待实测**：`~/.gemini/config/hooks.json` 里有两条 ——
  `dangerous-commands-guard`（matcher `run_command`）与 `plan-readonly-guard`（matcher `*`）。
  需在 agy 里按 Shift+Tab 切 plan 模式，让它写文件，确认 plan 钩子生效；再切回普通模式执行同一条
  命令，确认 **plan 钩子在非 plan 模式不误拦**。⚠️ 需人工在 TUI 里做（与上一项同一批，但没做）。
- [ ] **D4（Repeated / production verified）的门槛全项目未定义**：当前 10 个 Agent **没有任何一个
  在 D4**（claude-code / codex / opencode / dsh / agy 都是 D3）。agy 现在已具备「两个版本 × 两次
  真实会话」的证据形态，但**不单方面给单个 Agent 升 D4** —— 需先定义门槛（例如「≥2 个真实会话
  × ≥2 个版本」或「生产持续使用 N 天」），再统一评估各 Agent。这是 `docs/project-final-status.md`
  里 M7 一类的政策项，不是某个 Agent 的局部结论。
- [ ] **生成值 vs 本机手工值的两处差异（有意保留）**：引擎 `powershell.exe`（生成器，兼容无 pwsh
  的机器）vs `pwsh`（本机，规避 5.1 编码类问题）；guard 名 `riskguard-dangerous-commands` vs
  `dangerous-commands-guard`。已在新版 `agyHooksConfig()` 注释中写明，doctor 不认名字所以无功能影响；
  若将来要统一，先确认新机器的 pwsh 可用性再动。

## 长期（roadmap，见 docs/ecosystem-benchmark.md）

- bash AST 角色解析（allowlister 式：管道过滤命令按角色判定）
- 入站 secret 扫描 + commit 时 staged diff 扫描
- JIT 限时放行（被拦请求申请 15min/1h/session 放行）
- hash-chain 审计账本（防篡改日志链）
- prompt injection 检测（工具输出 / 抓取内容扫描）
- OS 级沙箱指引（Windows 可行方案：受限账号 / WSL 容器）
