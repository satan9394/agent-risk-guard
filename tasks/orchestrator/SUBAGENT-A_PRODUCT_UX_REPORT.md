# SUBAGENT-A — agent-risk-guard 独立 UX 审计报告（首次使用与验证闭环）

- 审计时间：2026-08-21 会话（40 分钟限时）
- 审计范围：README / `bin/riskguard.mjs` / `packages/cli/src` / `packages/installer/src`（doctor·install·index）/ `scripts/riskguard-wiring-check.ps1` / `skills/agent-risk-guard/SKILL.md` + **CLI 只读实测**（detect / detect --json / status / doctor / help / install --dry-run / 未知命令 / install --agent dsh）
- 审计方式：只读。未运行任何写操作（未执行 bootstrap / install 落地 / -Fix），未修改代码。
- 核心问题：完全陌生的人能否独立完成「第一次成功使用并验证保护生效」？结论：**不能顺畅完成**。主要断点在验证闭环（P0）、环境预检（P1）、DSH/AGY 安装入口缺失（P1）、技能资产路径失效（P1）。

> 本机实况基线（审计时）：`status` 显示 Claude Code **BROKEN**（manifest 在，wiring 缺失）、OpenCode/Codex/DSH **ACTIVE**；`doctor` 输出 `3 PASS / 0 WARN / 1 FAIL / 7 SKIP` 且 **exit 0**。`~/.claude/settings.json` 实测仅有个人 Setup hooks，**无 PreToolUse** —— 正是项目文档所警告的「防护静默失效（fail-open）」真实场景。

---

## 发现 1【P0】保护验证闭环不可信：doctor FAIL 但退出码 0，且 FAIL 行不带任何修复动作

**问题**：新手跑 `doctor` 看到 `1 FAIL` 却拿到 `exit 0`；FAIL 行只说「RiskGuard hook 注入缺失」，不告诉下一步该执行什么。用户据此无法回答「保护是否生效」——而这正是 onboarding 的核心目标。

**证据**：
- `packages/cli/src/commands.ts:566-610` `cmdDoctor` 只拼字符串返回；`Summary: 3 PASS / 0 WARN / 1 FAIL / 7 SKIP` 后不设置非零退出码；`index.ts:111` 所有子命令统一 `process.exit(0)`。
- 实测输出：`FAIL  claude-code    RiskGuard hook 注入缺失` → `=== exit: 0 ===`。
- 实测 `~/.claude/settings.json` 仅剩 `Setup` hooks（两条个人命令），无 `PreToolUse`；而 `~/.riskguard/manifests/claude-code.json` 存在（604B）→ `status` 判 `BROKEN`。即本机 Claude Code 当前**无机器层拦截**，而 README 支持矩阵仍向其宣称 D3 Verified。
- `doctor.ts:24-30` `hasRiskGuardHook` 用子串启发式（`_riskguard` / `riskguard-pre-tool-hook` / `dangerous-commands`），存在「旧接线/半残接线被误判 ok」的空间。

**影响**：这是最高影响问题。「验证保护生效」这一步对新手不可完成：不知道要重跑 `install --agent claude` 修复；写脚本/CI 监控者也会被 exit 0 骗过。项目历史教训（README:274-276 明述 settings.json 曾被外部还原、防护静默失效）恰在本机复现，而工具自身反馈不足以驱动修复。

**建议**：
- `doctor` 出现 FAIL 时 `process.exit(1)`；FAIL/WARN 行尾追加可直接执行的修复命令（如 `node bin/riskguard.mjs install --agent claude`）。
- `status` 对 BROKEN 给出补救指引；README 快速开始补「BROKEN = 防护失效，重跑 install 即 repair」步骤。

---

## 发现 2【P1】CLI 依赖 Node ≥22.18 的 .ts 原生 type-stripping，却无版本预检：老版本首个命令即原生报错

**问题**：`node bin/riskguard.mjs` 直接 `import 'packages/cli/src/index.ts'`，依赖 Node 原生 TypeScript type-stripping（22.6+ 需 flag、23.6+ 默认开启）。版本不满足时，新手的第一条命令得到的是 Node 原始 `ERR_UNKNOWN_FILE_EXTENSION` 报错，没有任何「请安装 Node ≥22.18」的人话提示。

**证据**：
- `bin/riskguard.mjs:11`：`await import(pathToFileURL(join(root,'packages','cli','src','index.ts')).href)`。
- CLI 三文件（bin / index.ts / cli.ts）均无版本检查；`packages/core/package.json:13-14`、`packages/acs/package.json:13-14` 的 `engines: node >=22.18` 只在子包声明、跑 `node bin/...` 时根本不会触发。
- README:134 宣称「零依赖、零构建」，Node 版本是唯一前置条件，但没有友好失败路径。

**影响**：Node 20 / 22.0-22.17 用户（相当主流）在第一次运行即卡死，且看到的错误与产品无关，无从排查。

**建议**：`bin/riskguard.mjs` 顶部加版本预检，不满足时打印「RiskGuard requires Node >= 22.18 (current: x.y.z)，安装指引 <链接>」并 exit 1；或在 README 首条放 `npx node@24 bin/riskguard.mjs ...` 兜底。

---

## 发现 3【P1】未知/拼错子命令静默落入 hook 运行时，输出 deny JSON，且一切命令一律 exit 0

**问题**：拼错命令（如 `riskguard doctorr` / `riskguard bootstraps`）不会提示用法，而是进入 stdin hook 运行时，输出一条看似「被拦截」的 JSON 并以 0 退出。

**证据**：
- `packages/cli/src/index.ts:46-47`：非 `known` 子命令直接返回空 cmd；`111-119`：落入 hook 运行时，空 stdin → `{"decision":"deny","degraded":true,"reason":"empty input (fail-closed)","ruleId":"RG-CLI-000"}`。
- 实测：`node bin/riskguard.mjs frobnicate` 输出上述 JSON，`=== exit: 0 ===`。一个不了解项目的人会以为「RiskGuard 拒绝了什么」，与他的意图完全无关。
- 附带：所有子命令/失败路径均 `process.exit(0)`（`index.ts:111-130`），脚本无法靠退出码判断 install/doctor 成败（install 失败是「rolled back」文案，但 exit 仍 0）。

**影响**：误操作无引导（浪费 onboarding 时间）；自动化/CI 无法检测任何失败态，与发现 1 叠加使「确定性」产品在可观测性上不确定。

**建议**：未知子命令输出 `Unknown command: <x>. Run 'node bin/riskguard.mjs help'` 并 exit 2；子命令失败与检测失败（doctor FAIL、install 未全成功）设置非零退出码；`help` 中对 `--json` 结果与退出码约定做说明。

---

## 发现 4【P1】`install` 不支持 DSH / AGY：`--agent dsh` 报「Unknown agent」，全装静默跳过，README 却把 DSH 列为一等 Verified Agent

**问题**：`detect/status/doctor` 都覆盖 dsh（本机 detected、doctor PASS、README 矩阵 D3 Verified），但 `install` 明确排除 dsh/agy：`--agent dsh` 输出误导性的「Unknown agent: dsh. Skipped.」；`install --all` 的候选列表只含 claude-code/opencode/codex，**静默不装 DSH 与 AGY**，输出里也不提示「DSH 不在 CLI 安装范围，请走 SKILL/wiring-check 路径」。

**证据**：
- `packages/cli/src/commands.ts:88-92`：`installerKey` 对 dsh 返回 null → `resolveTargets` 报 `Unknown agent`；`308-310`候选过滤 `filter(a => a.installed && installers[a.id])`，installers 仅 3 个（`135-179`）。
- 实测：`node bin/riskguard.mjs install --agent dsh` → `Unknown agent: dsh. Skipped.`；`detect` 上一步刚显示 `DSH detected`。
- README:99（DSH ✅ Verified）与 151-179 快速开始把 dsh 纳入 detect/status/doctor 的同等叙述，但整个 README 无一处告诉用户「DSH/AGY 的门禁要装，须用 SKILL 或 wiring-check.ps1，CLI 装不了」。

**影响**：以 DSH 为主力 agent 的新手（本项目目标用户画像）会把「3/5 已装」误认为全部落地；报错文案「Unknown agent」直接误导排查方向。

**建议**：报错改为明确语义（如 `dsh 不支持 CLI 安装：请用 skills/agent-risk-guard 或 scripts/riskguard-wiring-check.ps1 -Fix 落地 pre-execute patch`）；`install` 输出尾部增加「未覆盖：dsh/agy，安装方式见 <链接>」；README 快速开始补对应指引。

---

## 发现 5【P1】SKILL.md 快速适配/下发资产引用不存在的路径（scripts/…），与仓库实际布局（assets/…）脱节

**问题**：README:120-130 把 `skills/agent-risk-guard/SKILL.md` 定为 canonical 安装路径（「安装后按 SKILL.md 的快速适配流程」），但 SKILL.md 里 Step 3 与「下发资产」引用的脚本路径在仓库中不存在，新手照做第一步就卡死。

**证据**：
- `SKILL.md:71-76`（P0 行）：`scripts/dangerous-commands.ps1`、`scripts/opencode/destructive-operation-guard.ts`；`SKILL.md:223-227` 下发资产：`scripts/dangerous-commands.ps1`、`scripts/agy-dangerous-commands.ps1`、`scripts/dangerous-commands-universal.ps1`、`scripts/opencode/destructive-operation-guard.ts`、`scripts/dangerous-commands.sh`。
- 实测 glob：`scripts/` 下**无任何 .ps1/.sh/opencode 文件**（只有 7 个 .ts 构建脚本 + wiring-check.ps1）；资产实际在 `assets/hooks/dangerous-commands.ps1`、`assets/hooks/agy-dangerous-commands.ps1`、`assets/opencode/agent-risk-guard.ts`（旧名 `destructive-operation-guard.ts` 与 `dangerous-commands-universal.ps1`、`dangerous-commands.sh` 均不存在）。

**影响**：canonical 入口给的是死路径；同时旧/新插件名并存（doctor 也认旧名 `doctor.ts:95`）会让用户困惑「到底哪个是标准」。

**建议**：SKILL.md 资产表改为 `assets/hooks/*` / `assets/opencode/agent-risk-guard.ts` 等实际路径并加存在性自检；统一插件命名，去掉旧名残留（至少加「旧名已废弃」注释）。

---

## 发现 6【P2】两套并行的接线/规则体系（CLI node-hook vs SKILL/wiring-check ps1-hook），doctor 无法区分，uninstall 清不干净

**问题**：同一批 agent（claude/codex/opencode）存在两种互不相同的「官方」接线：CLI installer 注入 `node …/pre-tool-hook.ts`（TS 策略引擎），SKILL/wiring-check 部署 `assets/hooks/dangerous-commands.ps1`（66 条规则）+ dsh patch + agy。doctor 的 `hasRiskGuardHook` 对两种标记都放行，用户无法得知自己跑的是哪套规则；uninstall 只按 manifest 逆操作，ps1 hook 文件不在 manifest 内，卸载后 `.claude/hooks/dangerous-commands.ps1` 残留仍可能被配置引用。

**证据**：
- `commands.ts:135-163`（注入 `pre-tool-hook.ts`）vs `scripts/riskguard-wiring-check.ps1:76-171`（部署 ps1 资产 + 合并 settings.json）——两套接线可能同时存在或互相覆盖（ps1 -Fix 的合并逻辑 `143-149` 只在无 PreToolUse 时添加，不感知 node-hook）。
- `doctor.ts:24-30` 同时匹配 `_riskguard`/`pre-tool-hook.ts` 与 `dangerous-commands`，state 只有 ok/missing 二值，不区分规则源；`uninstall`（`commands.ts:645-695`）仅处理 manifest 追踪的 artifacts，ps1 接线不在追踪内。

**影响**：新手上路同时存在两个「真相」，`doctor` PASS 无法回答「我在跑哪套规则、是否漂移」（wiring-check 的 hash 校验只覆盖 ps1 一套）；卸载/修复可能出现半清状态。

**建议**：收敛单一接线入口（CLI install 统一为资产部署或统一为 node-hook）；doctor/status 明确标注规则源（`node-hook(TS)` / `ps1 asset` / `both`）与 hash 校验；uninstall 把 ps1 资产纳入 manifest 追踪。

---

## 发现 7【P2】误拦恢复没有产品化途径：无 allowlist/例外/放行机制，「人工放行」只是设计声明，用户被误拦后唯一出路是改脚本或卸载

**问题**：README 的设计声明是「宁可误拦、可人工放行」（fail-closed），但产品内没有任何「被误拦怎么办」的界面/文档：无 allowlist 配置、无例外指令、无放行命令，JIT 限时放行在 roadmap（未实现）。误拦（如已知的 DSH `-Format` 词级误伤面，见 PROJECT_BRIEF:35）场景下，用户只能手改 hook 脚本——而手改后 `uninstall` 又会因 hash 不符拒绝卸载（`commands.ts:651-665`），形成新的僵局。

**证据**：
- `docs/ecosystem-benchmark.md:72`：「误拦可人工放行」仅作为与 allowlister 的取舍声明；`docs/TODO.md:30` JIT 放行为 roadmap 未实现；`packages/core/src/rules/default-policy.ts` 为静态规则，无用户可配置例外面。
- 拦截反馈本身是好的一方：ps1 deny reason 全部给出替代方案（`assets/hooks/dangerous-commands.ps1:160` 等「请改用 pwsh 的 Microsoft.VisualBasic 回收站命令」），TS 侧 `renderClaudeDecision` 带 `systemMessage + safeAlternative`（`adapters/claude/src/index.ts:91-100`）——缺的是「这条规则误伤了我，如何永久豁免」。

**影响**：误拦一次 + 无法快速恢复 = 用户卸载整体放弃（对安全工具是最大流失点）；也是「恢复途径」评分的直接扣分项。

**建议**：提供受支持的例外机制（如用户级 allowlist JSON 文件，规则引擎显式优先放行 + 审计标记），README/Security Model 写明误拦恢复步骤（改策略文件 → 重跑 doctor）；在 JIT 放行落地前至少文档化「手改脚本 + uninstall 豁免路径」。

---

## 发现 8【P2】wiring-check.ps1 硬编码本机绝对仓库路径，外部克隆即「单源仓库不存在」exit 2

**问题**：README:277-285 向所有用户推荐 `pwsh scripts/riskguard-wiring-check.ps1` 作为日常治理脚本，但脚本第 22 行把仓库路径写死为审计机路径；任何克隆到其他位置（乃至其他机器）的用户一运行就报「单源仓库不存在: E:\DeepSeek_Harness\…」并 exit 2——既无法巡检，报错还把作者本机路径暴露给用户。

**证据**：`scripts/riskguard-wiring-check.ps1:22` `$repo = 'E:\DeepSeek_Harness\workspace\2026_08_21\agent-risk-guard'`；`57`、`66` 依赖该路径 exit 2。

**影响**：新人复现 README 推荐动作时立即失败，且失败信息无意义；脚本同时被 DSH/AGY 修复流程依赖（发现 4/6 的补位路径），等于那条绕行路径对外部用户也关闭了。

**建议**：改为相对脚本位置的仓库定位（`$PSScriptRoot/..`）或接受 `-Repo <path>` 参数；找不到时输出「请用 -Repo 指定仓库路径」，不再暴露作者本机路径。

---

## 发现 9【P3】README/CLI 漂移与细节 UX：detect --json 键数、CJK 对齐、交互 install「回车=全装」无写入前确认

**问题**：多处置文案与实现不符；交互安装默认行为激进但无确认。

**证据**：
- `README.md:155` 声称 `detect --json` 返回 `{claude-code, codex, opencode, dsh}` 布尔表；实测返回 13 个键（含 cursor/hermes/agy 等，README 没提）。
- 实测 `detect` 人类输出中 `Copilot CLI（CC 内核）`（中文全角括号）等 CJK 显示名破坏 `padEnd(24)` 对齐，中文混排观感差。
- `commands.ts:236-294`：交互 install 中回车=全装、EOF/20s 超时/出错=静默全装（`276-277`），且选择后直接进入写入（`335-340`），无「将修改 N 个配置文件，确认？」最终确认。

**影响**：文档与实现不一致会让对照文档操作的新手困惑；静默全装对「只想保护一个 agent」的用户是意外变更面（虽然均带 backup/rollback，安全性 OK）。

**建议**：README 修正 detect --json 说明；CJK 用等宽填充或换表格输出；交互安装在选择后追加一行「将安装：X，将修改：<path 列表>，回车继续 / q 取消」。

---

## 审计范围说明

- 未执行：`bootstrap`、`install`（落地）、`uninstall`、wiring-check `-Fix`、SKILL 适配流程——均为写操作，超出只读审计约束。
- 未验证：Node 22.18 真机行为（本机为 v24.14.0）、CLI 交互 TTY 真实提示（代码审读 + dry-run/JSON 调用代替）。
- 遗漏风险提示（供后续）：`ACS` 子命令在 help/README 中篇幅很大但对「首次保护」无贡献，新手帮助页信息密度偏高，建议 help 分层（快速开始 5 条命令 vs 高级）。

---

### 汇总（按优先级）

| # | 优先级 | 一句话 |
|---|---|---|
| 1 | P0 | doctor FAIL 但 exit 0、无修复指引，验证闭环不可信（本机 cc 已裸奔复现） |
| 2 | P1 | 无 Node ≥22.18 预检，首个命令在低版本 Node 上原生报错 |
| 3 | P1 | 未知子命令静默落入 hook 运行时输出 deny JSON，且全命令 exit 0 |
| 4 | P1 | install 不支持 dsh/agy 且报「Unknown agent」误导，--all 静默跳过 |
| 5 | P1 | SKILL.md 资产路径 scripts/… 全部失效（实际在 assets/…） |
| 6 | P2 | node-hook 与 ps1-hook 双接线并存，doctor/uninstall 无法区分与清净 |
| 7 | P2 | 误拦恢复无产品化出口（无 allowlist/例外，JIT 放行未实现） |
| 8 | P2 | wiring-check.ps1 硬编码本机仓库路径，外部克隆即失败 |
| 9 | P3 | README detect --json 键数漂移、CJK 对齐、交互全装无确认 |