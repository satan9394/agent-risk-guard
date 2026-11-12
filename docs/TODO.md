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
- [ ] **WorkBuddy 是否升 D4**：**不升（保持 windows=D3）**。D4 =「重复 / 生产验证」，硬约束 5 要求「不止一次真实会话 + 行为对照」；当前只有 2026-09-28 这一次真实会话（D3）。本机 WorkBuddy 不是常用工具、无第二次会话的自然时机，**不为凑等级脚本化重放**（其删除语义已由平台 safe-delete shim 委派，重放价值低、风险高）。若日后用户恰好在 WorkBuddy 里再触发一次真实拦截，可顺手补第二次证据升 D4。

## v0.2.0 遗留（下一阶段，见 docs/devlog-2026-09-05-v0.2.0.md）

- [ ] **真实 Agent D3 Conformance（P1 顺序 §二十八）**：Cursor 已于 2026-11-08 完成（preToolUse hook 真机 deny/allow，见 `compatibility.json`）；剩余 **Copilot CLI / Windsurf** 的真实会话执行。Cursor 的 official payload fixture → adapter contract test 已补齐；conformance harness（§二十九）仍待接入。Cursor 侧的已知边界登记在本节下方。
- [ ] **Cursor 已登记边界（2026-11-08 实测）**：① `beforeShellExecution` 只是审批层，`--force` 下 deny 会被绕过 → 不作为硬闸门，只挂 `preToolUse`；② `failClosed` 未启用（ps1 引擎以空输出表示放行，设 true 会误拦正常命令），hook 崩溃/超时因此 fail-open；③ 非 shell 工具（Delete / Write）目前只有适配器 D2 单元测试，尚无生产 hook 覆盖；④ Cursor 默认会读 `~/.claude/settings.json` 的 Claude hooks，但那边 matcher 是 `Bash|PowerShell`，对不上 Cursor 的 `Shell` 工具名，不能当兜底。
- [ ] **Copilot CLI machine Policy Hook PoC**：system policy（`/etc/github-copilot/policy.d/` / `C:\ProgramData\GitHub\Copilot\policy.d\` / Registry）→ RiskGuard Machine Guard（§三十，本轮只预留 policyScope）
- [ ] **MCP canonical capability 深化**：`mcp.invoke` 从近似映射升级为一等 capability（server/tool identity，tool poisoning 门禁，P1）
- [ ] **Gemini BeforeTool adapter（D2）**：P2 顺序（§二十八）

## DSH 覆盖边界（2026-11-12 登记）

- [x] **dsh-ops 的 `ops_bash` 白名单缺口（2026-11-12 已补判据）**：原判据只匹配 `exec.name` 为 `pwsh` / `bash`
  的调用，dsh-ops 启用 bash 时发布的 `ops_bash`（自带 MSYS bash）不过闸。已把插件判据改成 fail-closed 结构性判据：
  只要 `arguments.command` 是字符串就按执行器处理，例外表默认只有 `str_replace_editor`（它的 `command` 是编辑动作名）；
  实测 rc.2 + dsh-ops 里带 `command` 字符串的工具只有 pwsh / bash / 持久化 shell / `ops_bash` / 该编辑器。
  16 条用例矩阵覆盖 pwsh、bash、sh、`ops_bash`、`pwsh_persistent`、`bash_persistent`、未知同名工具、编辑器误杀、
  无 `command` 参数、`arguments` 为 JSON 字符串，全 PASS。插件同时从 `file:`（复制）改成 `link:`（junction），
  避免「改了源码、profile 跑旧副本」的漂移。
  本机仍保持 `global.bash: false` + `hidePwsh: false`；**恢复 `ops_bash` 现在只剩一个开关决定**，
  不再是门禁缺口（真跑一次 `ops_bash` 的拒/放仍待取证）。
- [x] **PTC 内层调用是否绕过门禁（2026-11-12 源码核实）**：不绕过。`run_code` 内的 `tools.pwsh(...)`
  走同一个工具管线 —— `@deepseek-ai/dsh-tools` 的 `pipeline.js` 在派发前执行
  `ctx.waterfall(..., 'tools/pre-execute', exec, ...)`；`@deepseek-ai/dsh-tool-executor-ptc` 直接 import
  `ToolExecutionPipeline` / `executeToolBatch` 并构造同一个 pipeline（`executor.prepare(input)`），工具名保持 `pwsh`。
  本轮**未**单独跑 PTC 会话取证：`dsh headless` 用的 headless profile 没有 dsh-ops（无 `run_code`），
  而 web profile 的 ops-ptc 只能从 GUI 驱动；结论基于 0.2.2-rc.2 安装包源码。真实 PTC 会话复验仍待一次
  「web profile + ops-ptc」的会话。

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
- [ ] **只读盘点回收站的 Python 命令被误判为「回收站清空族」deny**（2026-09-28 WorkBuddy 真实
  会话发现，登记延后）：一条只 `open().read()` + `struct.unpack` 解析 `$I*` 元数据的只读命令被拦。
  根因链：① 引擎的去引号副本把 `d=r'D:\$Recycle.Bin\…'` 变成 `rD:\…`；② 前缀 `r` + 盘符 `D`
  拼成伪词 **`rD`**，撞删除动词词边界里的 `rd`（Windows `rmdir` 简写）；③ 同条命令又含
  `$Recycle.Bin` 路径 → 命中「直删回收站存储」判定。复现材料（已入仓）：
  `tasks/orchestrator/wb-d3-20260928-repro-cmd.txt`（最小复现）、`wb-d3-20260928-analyze.py`。
  ps1 引擎实测命中；其余端同规则但去引号实现各异，未逐端复测。**修法方向**（届时独立一轮）：
  `rd`/`ri` 这类双字母动词的词边界要求前导字符**非字母**（排除 `rD` 这类拼接产物），或动词匹配
  改在去引号前的原文上做。
- [x] **`skills/agent-risk-guard/scripts/opencode/destructive-operation-guard.ts` 是旧代次副本**
  （27.5KB / v0.1 时代）而现网加载的是 `assets/opencode/agent-risk-guard.ts`（32.4KB）；
  `SKILL.md` 与 `references/opencode-wiring.md` 仍把它写成部署取源，照做会装回旧插件。
  R7c 只同步了其中的 `git branch` 规则，**未做整代对齐**（属独立欠账）。
  **2026-09-23 已闭环**：单源覆盖 + 统一文件名为 `agent-risk-guard.ts`（旧名副本移入回收站），
  `SKILL.md` / `references/{opencode-wiring,opencode}.md` / `sync-prod.ps1` 同步改名与体积，
  巡检 4a 由「只查 ps1 一个文件」改为逐对锚定四个单源（含 opencode 插件与 dsh patch），
  并补 4b 的**反向比对**（安装侧多余文件报出并 `-Fix` 移入回收站）。
  同批还发现并修掉两处**同型漂移**：skill 内 dsh patch 停在 R7b（缺 R7c 收紧）、
  agy 适配器此前完全不在比对范围。见 `docs/decisions.md` 2026-09-23 行。

## 运维脚本欠账（wiring-check 等）

- [x] **`riskguard-wiring-check.ps1 -Fix` 不支持全新机器**（2026-09-28 密封测试发现，**2026-10-09 已修**）：
  目标 home 缺 `~/.claude/hooks` 等父目录时，ps1 段 `Restore-Single-Source` 的
  `Copy-Item $source $dest -Force` 直接抛 `DirectoryNotFoundException`，撞脚本级 `EAP=Stop`
  **终止整个巡检**（dsh 段都跑不到）；`settings.json` 段同病（node 读不到缺失文件，只报失败、
  不自愈）。**修法（已落地）**：restore 前 `New-Item -Force` 建父目录；`settings.json` 合并 helper
  改为缺失时从空对象起步（等价新建）。密封测试扩 **T7**（无父目录 + 无 settings.json 的 fake home）
  钉死；旧脚本在同场景复现 `Could not find a part of the path …\\.claude\\hooks\\…` 且未跑到 dsh 段。
- [x] **dsh desktop profile 的块式规则被误判「缺失 43 条」**（2026-10-09 发现并修，此前未登记）：
  规则比对原为「整行 `Trim()` 后文本」，块式写法（`re`/`reason` 分行）永远对不上 inline 单源 →
  `~/.dsh/profiles/desktop` 恒报缺失、`-Fix` 修不动，计划任务每 5 分钟假阳性 exit 1
  （`~/.risk-guard-backup/wiring-check-task.log` 09-29 起累计 300+ 条）。**修法（已落地）**：抽取改
  格式无关的 `Get-RuleEntries`（`re|||reason` 规范化 + 正确解析 `''` 转义）+ `-Fix` 按字符偏移从后往前
  原位替换整条。密封测试扩 **T6**；回退对比：块式文件旧逻辑缺 74 / 新逻辑缺 0。

## agy（Antigravity CLI）相关欠账

> 2026-09-21 C 批已闭环：agy 纳入 `doctor`（此前「已安装却在 doctor 里一行都没有」）、
> 新增 `agy-hook-test.ps1`（6 套 × 双引擎进 CI）、适配器规则引擎改为按优先级探测
> （不再硬编码 `~/.codex/hooks/`）、`agy-dangerous-commands.ps1` 纳入接线巡检（此前是
> 唯一没有哈希纪律的生产脚本）、生成器 timeout 对齐实测值 15s。**以下为仍未做的部分。**

- [ ] **`agy-plan-readonly.ps1` 入仓（判为「有用，但需独立切片」）**：该 hook 现在只活在
  `~/.gemini/config/hooks/agy-plan-readonly.ps1`（19,247B）＋ 个人脚本归档
  `E:\Code_file\Claude_code\2026\09\20\`（含 **59/59** 测试台），**不在仓库、不在巡检、不在 CI**。
  它是唯一压在热路径上（`matcher: "*"`，每次 agy 工具调用都过）却完全未版本化的脚本 ——
  静默坏掉无人发现。**为什么不并进 R7c/agy 那批**：它属**另一条政策轴**（「plan 模式下按能力
  只读」），而本产品章程是不可逆破坏拦截；混进 `deny-risk-commands` 单源链会模糊产品边界。
  它**已通过在真实会话验证**（2026-09-20 FDE 项目：`/plan` 会话里 `Create(...)` 被拦、诊断日志
  `DENY tool: write_to_file`、且证明 hook deny 压得过 `always-proceed`；非 plan 会话全放行）。
  **入仓需做的四件事**：① 定义单源并纳入 `HOOK_SINGLE_SOURCE_MAP` + 巡检；② 把 59/59 测试台
  收进 `skills/agent-risk-guard/tests/` 并进 CI；③ `compatibility.json` 增补对应能力面
  （plan 模式下 `filesystem.write` = deny）；④ 处理下述**已登记的具体缺口**（`/plan` 多轮那条已于
  2026-10-10 判定「非漏洞」并关闭；余下为解释器全禁体感、钩子成本两项）。建议独立开一轮。
- [x] **`/plan` 多轮注入：已闭环 —— 判定「非漏洞」（2026-10-10 定论）**。此前担心：
  `plan-readonly-guard` 只读**最后一条** `USER_INPUT` 判是否 plan 模式，而若 agy 只在第 1 轮注 `/plan`、
  后续不注，则多轮 plan 会话会漏判放行。本轮两步取证**否掉了这个担心**：
  ① **官方文档**（`antigravity.google/docs/cli/modes`）：*When `plan` mode is active through `Shift+Tab`
  cycling or the `--mode` flag, the CLI **automatically prepends the `/plan` instruction prefix to your
  prompts*** —— 即 plan 模式生效期间**每轮 prompt 都自动补**；
  ② **本机探针实证**：新开会话 `f9ff8ce3`，第 1 轮 `Shift+Tab` 进 plan 后**不打 `/plan`** 直接发文字、
  第 2 轮直接发「执行」，两轮 transcript 的 `USER_INPUT` **都自动带了 `/plan`**，两轮均未写出文件；
  ③ 复核旧会话 `f29e7d71`（3 轮、仅首轮带标记）：其第 2 轮**前缀缺失且 agent 直接执行 `npm install` 成功**
  —— 而 plan 模式本身禁止写代码 ⇒ 该轮 plan 模式实际已关（用户已 `Shift+Tab` 切出）。
  **⇒ 前缀在 ⟺ plan 模式开，两边自洽；hook 判据成立**。「只带首轮标记」的会话一律是之后切出了 plan 模式。
  **残留（保留不删，供日后对照）**：若 agy 将来出现「plan 生效却不补前缀」的回归，hook 会退回 fail-open；
  届时判据是「agent 是否仍在拒绝写入」。⚠ 复核涉及含明文 api key 的 transcript，**未摘录、不入仓**。
- [ ] **plan 模式下解释器全禁的体感代价**：`python -c "…"` 被 deny（第一 token 是绝对路径 python、
  `-c` 可任意执行），研究只能降级到 `view_file`/`grep_search`；数据类项目的 plan 研究体感变差，
  若要改善需另开一个窄口子（需权衡：开了就是可执行面）。
- [ ] **plan 钩子成本约 0.5s/工具调用**（几乎全是 PowerShell 进程启动；80 字节空脚本走 `-File`+stdin
  就要 560ms），而它 matcher 是 `"*"`。若体感太慢，可把 matcher 收窄到已知写工具集合，代价是
  未知新工具不再默认拦截。
- [x] **agy 版本漂移（2026-10-10 登记，2026-10-27 闭环）**：`compatibility.json` 的 agy `componentInventory.version`
  原记 **1.3.2**、D3 证据停在 **1.1.27 / 1.2.7**。2026-10-27 在 **1.4.8** 上做真实会话复验（`agy -p`：`git reset --hard`
  被 pre-tool hook deny、脏改动保留；`git status --short` 放行并真实执行），版本已更新为实测 1.4.8，D3 证据同步刷新。
- [ ] **OpenCode V2 的「非工具 shell」不在拦截面内（2026-11-02 登记）**：V2 插件契约里只有 tool 域可以 fail
  （`packages/core/src/plugin/hooks.ts` 的 `Failures`），`ctx.shell.hook("create.before")` 是 `never` 失败通道，
  抛错拦不住。因此 **TUI 里用户自己敲 `!` 起的 shell、以及任何不经 `Tool.execute` 的 shell 端点**都没有硬闸门。
  agent 的工具调用（含 2.2.5 里 `bash`→`shell` 的改名）由 `tool.execute.before` 正常覆盖，已实测。
  顺带验过 Code Mode（`execute`）不构成绕过：2.2.5 的 `tools` 目录里**没有** `shell`（实测抛 `Unknown tool 'shell'`），
  只能拿到 MCP 工具与插件工具（如 `trash`），所以无法在 JS 里间接调 shell。
  若要处置，只能评估权限层能否拦到 shell 端点（当前 `permission.hook("evaluate")` 对 `action=shell` 已生效），
  属独立切片，别在文档里把它写成「所有 shell 都被拦」。
- [ ] **dsh desktop profile 由 Electron 应用独占管理（2026-11-02 登记）**：0.2.1-rc.5 期间该 profile 的
  `cordis.patch.yml` 整段丢了 `deny-risk-commands`（桌面端实际裸奔），已由巡检 `-Fix` 追加注入并复验 74 条一致。
  风险是应用侧以后重写该文件时可能再次丢掉，只能靠计划任务巡检兜底（现在 `-Fix` 已能整段补装，密封用例 T8）。
  若再次复发，应查 Desktop 的 profile 写入行为，而不是手补一次了事。
- [x] **本机 Claude Code 默认模型已切换（2026-11-02 登记并当日闭环）**：原 `model` 与 `ANTHROPIC_DEFAULT_*`
  全是 `workbuddy/deepseek-v4.1-flash[1m]`，2.1.316 直接判 `unrecognized_model` 拒绝运行。
  经用户确认后改为 `auto/deepseek-v4.1-flash[1m]`（magpie 路由组），备份在 `~/.claude/settings.json.bak-model-20261102`。
  复验（默认模型、不带 `--model`）：`git log --oneline -1` 放行并回显（05:36:23 allow）；
  `git branch -D scratch` 被 PreToolUse deny（05:37:55）、分支保留。仍会打一行 `unrecognized_model` 提示，但可正常执行。
- [x] **Codex hooks.json 双注册：复核后决定保留（2026-11-02 登记并当日闭环）**：`PreToolUse` 下同时有
  自包含的 `~/.codex/hooks/dangerous-commands.ps1` 与 `_riskguard` 的 `node … pre-tool-hook.ts`，每条 Bash 跑两遍。
  实测两个引擎在 6 条样本上判定一致（git reset / branch -D / rm -rf / Remove-Item / curl|bash 全 deny，git status allow），
  且**注册项的命令 spawn 失败会被 Codex 静默忽略**（人为插入指向不存在脚本的第三条，安全命令仍放行）——
  也就是说单条 hook 是单点故障、坏掉即 fail-open。成本实测 ps1 ≈563ms、node ≈131ms/次；删掉 node 只省 131ms。
  结论：**保留两条**，作为「跨引擎 + 跨路径」的冗余；不为省 0.13s 引入单点。以后若要收敛，应先让 installer 把
  node hook 的脚本复制到 `~/.codex/hooks/`（去掉仓库路径依赖），再单留 node 并实测 spawn 失败的 fail-closed 行为。
- [ ] **建议：给发布产物加「不得含 `tests/`」的 CI 断言（2026-10-10 登记）**：Release 附件
  `agent-risk-guard-v<ver>.tar.gz` 目前不含测试，但这是 `scripts/build-release.ts` +
  `packages/cli/src/runtime-install.ts::collectRuntimeFiles()` 的**行为**，不是硬约束——谁改收集器都可能
  把 `test*` 放进去而无人发现（2026-10-09 核实：`collectTs()` 显式跳过 `test`/`tests`/`node_modules`）。
  建议在 CI 里对 build 出的 artifact 断言「无 `tests?/` 路径」。属独立小切片。
- [x] **Linux CI 回滚用例偶发假红（2026-10-27 登记并当日修掉）**：根因是 `packages/trash/src/linux.ts` 只调
  `gio trash`，而 CI 的 ubuntu-latest 在镜像切换期并非每台都装 `gio`（同一天同一 SHA 出现「Node 22 红 / Node 24 绿」
  又反过来），命令缺失时 `trash()` 返回 `ok:false` → 事务回滚判 `REMOVE-FAILED`。已改为
  「外部命令 → 备用命令 → freedesktop 规范自实现」三级，并加 Linux-only 测试（清空 `PATH` 仍须进回收站）。
  验收：WSL 里把 `PATH` 收窄到只剩 node（等价于 runner 无 `gio`）后，`tests/transaction` **10/10** 通过。
- [x] ~~真实 agy 会话 D3 复验（当前 agy 1.2.7，D3 证据停在 1.1.27）~~ —— **已完成，2026-09-21**。
  agy **1.2.7** 真实会话里 `run_command` 执行 `git reset --hard HEAD` 被 hook 拒绝
  （`tool call denied by pre-tool hook: RiskGuard: ⛔ HOOK 已拦截危险命令：…`），同会话 `Read` 与
  `git status` 放行、工作区未提交改动存活；钩子日志有对应的 `decision=deny` 行。
  `compatibility.json` 的 agy `componentInventory.version` 已由 1.1.27 升至 **1.2.7**。
  ⚠️ 方法论教训（已写进 notes）：用「把文件永久删掉」这类提示词会被 agy 在**规则层直接拒绝**
  （一次工具调用都不发，钩子日志零记录）——那是 `soft` 遵循而非 `hard` 拦截，**不构成 D3 证据**；
  必须用模型不认为该拒绝的命令（如 git reset）才能触发钩子。
- [ ] **生成值 vs 本机手工值的两处差异（有意保留）**：引擎 `powershell.exe`（生成器，兼容无 pwsh
  的机器）vs `pwsh`（本机，规避 5.1 编码类问题）；guard 名 `riskguard-dangerous-commands` vs
  `dangerous-commands-guard`。已在新版 `agyHooksConfig()` 注释中写明，doctor 不认名字所以无功能影响；
  若将来要统一，先确认新机器的 pwsh 可用性再动。

- [ ] **`riskguard-wiring-check.ps1 -Fix` 不能给没有 `# N3 预算闸门` 标记的 dsh profile 追加新规则**
      （2026-11-11 加 `git -C` 伞形规则时暴露）：desktop/headless 两份 profile 命中「缺 1 条」但
      没有同位次可替换的条目，兜底重组又要求 N3 标记，只能手工插入。要么给兜底加「按
      deny-risk-commands 规则块末尾插入」，要么在巡检里明确提示「需人工插入」并给出插入点。

## 长期（roadmap，见 docs/ecosystem-benchmark.md）

- bash AST 角色解析（allowlister 式：管道过滤命令按角色判定）
- 入站 secret 扫描 + commit 时 staged diff 扫描
- JIT 限时放行（被拦请求申请 15min/1h/session 放行）
- hash-chain 审计账本（防篡改日志链）
- prompt injection 检测（工具输出 / 抓取内容扫描）
- OS 级沙箱指引（Windows 可行方案：受限账号 / WSL 容器）
