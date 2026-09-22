# Decisions — 谁提了什么、什么时候、谁拍的板

> **中文**：本文件是**变更与裁决的账本**。回答四个问题：**谁**在**什么时候**提了什么、**什么时候被接受或拒绝**、
> **依据是什么**、最终**落在哪个版本**。
> **English**: This is the ledger of changes and verdicts: **who** proposed **what** and **when**, **when it was
> accepted or rejected**, **on what evidence**, and **which release it landed in**.

## 为什么要有这个文件 / Why this file exists

**中文**：Git 已经记录了「谁在什么时候提交了什么」——commit 的 author 与时间、PR 的开启/合并/关闭、review 的
批准与驳回，全部带时间戳且不可篡改。**本文件不重复那部分**，手工抄一遍只会与事实漂移。

Git 记不到的是**「为什么同意、为什么拒绝」**。这一半才需要人写下来。本项目每个切片的裁决证据都留了档
（[`tasks/orchestrator/EVALUATION_RESULT_*.md`](../tasks/orchestrator/)），本文件是它们的**索引**，
并把「每一次落地」与「哪一个版本」对上。

**English**: Git already records who submitted what and when — commit authors and dates, PR open/merge/close
times, review approvals and rejections, all timestamped and tamper-evident. This file does **not** duplicate
that; a hand-copied duplicate only drifts from the truth. What git cannot record is **why something was accepted
or rejected** — that half has to be written down. Every slice in this project already keeps its verdict evidence
under [`tasks/orchestrator/EVALUATION_RESULT_*.md`](../tasks/orchestrator/); this file indexes them and ties each
delivery to the release it shipped in.

## 记录规则 / The rule

**中文**：任何变更在**合并那一刻**就要在这里有一行——包括被拒绝的。裁决只有四种写法：

- `ACCEPT` —— 通过
- `REJECT → FIX … → ACCEPT` —— 驳回过，修完再验，最终通过（**中间每一次驳回都要列出**）
- `REJECT` —— 最终未采纳（说明为什么、以及是否有替代方案）
- `WITHDRAWN` —— 提案方撤回

被拒过的变更**不删行**。一个项目里"哪些想法被否决过、为什么"和"哪些被采纳"一样有价值。

**English**: Every change gets a row here **at the moment it is merged** — including rejected ones. Four verdict
forms: `ACCEPT`; `REJECT → FIX … → ACCEPT` (list every rejection round); `REJECT` (say why, and whether an
alternative landed); `WITHDRAWN`. Rejected changes are **never deleted** — knowing which ideas were turned down,
and why, is as valuable as knowing what shipped.

---

## A. 已发布的版本 / Released versions

每个 git tag 一行。CI 校验「每个 release-notes 文件都有对应行」，防止本表腐烂。

| 版本 Version | 日期 Date | 裁决 Verdict | 依据 Evidence |
|---|---|---|---|
| `v1.0.0` | 2026-08-26 | ACCEPT（历史发布标记） | [release notes](release-notes/v1.0.0.md) · tag `v1.0.0` |
| `v0.1.0` | 2026-09-04 | ACCEPT | [release notes](release-notes/v0.1.0.md) · tag `v0.1.0` |
| `v0.1.1` | 2026-09-04 | ACCEPT | [release notes](release-notes/v0.1.1.md) · tag `v0.1.1` |
| `v0.1.2` | 2026-09-04 | ACCEPT | [release notes](release-notes/v0.1.2.md) · tag `v0.1.2` |
| `v0.2.0` | 2026-09-05 | ACCEPT | [release notes](release-notes/v0.2.0.md) · tag `v0.2.0` |
| `v0.2.1` | 2026-09-05 | ACCEPT | [release notes](release-notes/v0.2.1.md) · tag `v0.2.1` |
| `v0.2.2` | 2026-09-05 | ACCEPT | [release notes](release-notes/v0.2.2.md) · tag `v0.2.2` |
| `v0.3.0` | 2026-09-07 | ACCEPT | [release notes](release-notes/v0.3.0.md) · tag `v0.3.0` |
| `v0.3.1` | 2026-09-14 | ACCEPT | [release notes](release-notes/v0.3.1.md) · tag `v0.3.1` |
| `v0.3.2` | 2026-09-19 | ACCEPT | [release notes](release-notes/v0.3.2.md) · tag `v0.3.2` |

## B. 切片级裁决 / Per-slice verdicts

| 日期 Date | 贡献者 | 变更 Change | 裁决 Verdict | 依据 Evidence | 版本 |
|---|---|---|---|---|---|
| 2026-09-11 | @satan9394 | **G4** ps1 规则 16d 死代码（`[[:space:]]` 在 .NET 正则无效 → 该规则从未生效） | ✅ ACCEPT | [G4](../tasks/orchestrator/EVALUATION_RESULT_G4.md) · `67faab8` | v0.3.1 |
| 2026-09-11 | @satan9394 | **G1+G7** CLI 退出码契约 + hook 运行时入口 fail-open | ✅ ACCEPT | [G1G7](../tasks/orchestrator/EVALUATION_RESULT_G1G7.md) · `552fca3` | v0.3.1 |
| 2026-09-11 | @satan9394 | **G2** doctor 从"查存在"升级为"查新鲜度" | ✅ ACCEPT | [G2](../tasks/orchestrator/EVALUATION_RESULT_G2.md) · `25e658d` | v0.3.1 |
| 2026-09-11 | @satan9394 | **G15** ps1 密钥明文泄漏（日志 + deny 回显） | ✅ ACCEPT | [G15](../tasks/orchestrator/EVALUATION_RESULT_G15.md) · `a9177c3` | v0.3.1 |
| 2026-09-11 | @satan9394 | **G15b** 三端脱敏对齐 | ❌ REJECT → FIX → ❌ REJECT → FIX2 → ❌ REJECT → **FIX3 ✅ ACCEPT** | [G15b](../tasks/orchestrator/EVALUATION_RESULT_G15b.md) · [FIX](../tasks/orchestrator/EVALUATION_RESULT_G15b-FIX.md) · [FIX2](../tasks/orchestrator/EVALUATION_RESULT_G15b-FIX2.md) · [FIX3](../tasks/orchestrator/EVALUATION_RESULT_G15b-FIX3.md) · `210788d` | v0.3.1 |
| 2026-09-12 | @satan9394 | **G5** sh hook fail-closed + 合法 JSON 转义 | ✅ ACCEPT | [G5](../tasks/orchestrator/EVALUATION_RESULT_G5.md) · `3fe7d85` | v0.3.1 |
| 2026-09-12 | @satan9394 | **G3** 跨端判定收敛 + 常设 `decision-parity` 闸门 | ❌ REJECT → FIX4 → ❌ REJECT → FIX5 → ❌ REJECT → FIX6 → ❌ REJECT → **FIX7 ✅** | [G3](../tasks/orchestrator/EVALUATION_RESULT_G3.md) · [FIX4](../tasks/orchestrator/EVALUATION_RESULT_G3-FIX4.md) · [FIX5](../tasks/orchestrator/EVALUATION_RESULT_G3-FIX5.md) · [FIX6](../tasks/orchestrator/EVALUATION_RESULT_G3-FIX6.md) · `a509afe`…`5e51b06` | v0.3.1 |
| 2026-09-12 | @satan9394 | **G24** help/version 豁免粒度（整条命令级 → 仅豁免该次调用） | ✅ ACCEPT | [G24](../tasks/orchestrator/EVALUATION_RESULT_G24.md) · `98c6f4b` | v0.3.1 |
| 2026-09-13 | @satan9394 | **G3-FIX8** 包装词自身选项纳入命令位前缀 | ❌ FAIL（引入两处新放松） → **Repair 1/1 → ✅ PASS** | [G3-FIX8](../tasks/orchestrator/EVALUATION_RESULT_G3-FIX8.md) · `0791a48` | v0.3.1 |
| 2026-09-13 | @satan9394 | 接线自愈不再写回失效注册（去引号 `-File` 路径） | ✅ ACCEPT | `0e754ed` | v0.3.1 |
| 2026-09-14 | @satan9394 | CI 补全：ps1 五套 × 双引擎 + `sh-failclosed-test.sh`；`test-all.ps1` 对齐 | ✅ ACCEPT | `332bb73` | v0.3.1 |
| 2026-09-14 | @satan9394 | 双语发行说明 + 两个 Issue 模板 + 新增 Agent 指南；更正两处公开面口径 | ✅ ACCEPT | `0122784` · `b216946` | v0.3.1 |
| 2026-09-14 | @satan9394 | 修复 parity 闸门指向**仓库外**路径（主干 CI 长期红的根因） | ✅ ACCEPT | `1c3f690` | v0.3.1 |
| 2026-09-17 | @satan9394 | README 重构为首页 + 新增 `docs/cli.md`；补 `docs/decisions.md` | ✅ ACCEPT | `3298161` | v0.3.2 |
| 2026-09-17 | @satan9394 | Code scanning 12 条 `js/polynomial-redos` 告警：**实测后决定不改** | ACCEPT（不改动，以实测为依据） | [`scripts/redos-probe.mjs`](../scripts/redos-probe.mjs) —— 14 个病态用例在 50 KB 下全部不超过 1.67 ms、近似线性 | v0.3.2 |
| 2026-09-17 | @satan9394 | 修 CodeQL 中**可证明等价**的 5 条告警：结尾分隔符正则改线性扫描、测试里的空操作替换与不完整转义（**PR #4**） | ACCEPT | 全量 380/380 通过；CodeQL 复核后自动关闭 5 条 · `e026ef1` | v0.3.2 |
| 2026-09-17 | @satan9394 | 仓库治理：启用私有漏洞报告 / Dependabot alerts + security updates / Code scanning（CodeQL）；新增 `.github/dependabot.yml`；`main` 分支保护（禁 force push、禁删除、5 个 CI 检查必过） | ✅ ACCEPT | `be83671` · 仓库设置（非代码） | v0.3.2 |
| 2026-09-19 | @satan9394 | **R7** `git branch` 删除只拦短选项 `-d`/`-D`，长选项 `--delete`（含 `--delete --force`，与 `-D` 语义完全等价）在**所有** enforcement 层被放行，且 `isReadOnlyCommand` 判其为只读 → 走 read-only 快路径直接 allow（与 P0-6/P1-3 同一根因） | ❌ REJECT（首版引入 **38 条放宽**，其中 **24 条**为真实 git 删除分支的合并短选项 `-df`/`-Df`/`-dd`…；根因：短选项分支加了尾部 `\b`） → **FIX（R7b）✅** | [R7](../tasks/orchestrator/EVALUATION_RESULT_R7.md) · `7c09890` → `ba36247`（R7b）；R7b 后 9 层 × 9 条必拦形态复核 = **0 漏拦、0 误伤**；规则相关 71/71、`sh-audit-bypass` 195/195、`sh-hook-test` 70/70。**更正**：首版证据栏所称「`--move`/`--copy`/`--force` 一并补入只读白名单」实测规范形态下**未生效**（`\s*` 吞掉 `branch` 与选项间空格），已移除该声明，详见 CHANGELOG | v0.3.2 |

| 2026-09-19 | @satan9394 | **R7b 工具链**：`~/.claude/skills/custom/agent-risk-guard-audit` 是手工快照、落后单源多个版本（缺 G3-FIX8、缺 R7 的组合短选项），却仍是 skill 部署取源（"比单源弱"的旁路副本）；且 `sync-prod.ps1` 每次运行都会**重复追加** 5 条 R2 规则到 DSH patch（幂等性为零）、并把插件写到过时的 `destructive-operation-guard.ts`（现网加载 `agent-risk-guard.ts` → 重复插件文件） | ✅ ACCEPT | PR #14 · `6df9754`；wiring-check 新增「skill 副本」逐文件 SHA256 比对段（skill 由 19 处漂移 → 0），sync-prod.ps1 重写为 wiring-check 的薄封装；wiring-check exit 0、doctor 4 PASS / 0 WARN / 0 FAIL | v0.3.2 |

| 2026-09-19 | @satan9394 | skill 镜像的比对判据改为**内容等价**（忽略行尾）：仓库工作区的 ps1 EOL 是 `.gitattributes eol=crlf` 的 git 产物，checkout 后即由 LF 变 CRLF，要求镜像跟随没有意义 —— 上一行（PR #14）的字节级比对因此产生 1 处 EOL 伪漂移。生产 hook 段仍保持字节级严格比对（BOM/编码必须一致） | ✅ ACCEPT | PR #15；`riskguard-wiring-check.ps1` 新增 `Get-NormHash`（去 CR 后算 SHA256），仅用于 skill 段；复跑 exit 0（skill 39 文件一致） | v0.3.2 |

| 2026-09-19 | @satan9394 | **W1** `scripts/riskguard-wiring-check.ps1` **缺 UTF-8 BOM**：Windows PowerShell 5.1 按 ANSI/GBK 解析中文 → 全角括号截断字符串 → 解析报错、什么都修不了。它正是计划任务 `RiskGuard_WiringCheck` 的修复入口（兜 cc-switch 抹掉 `~/.claude/settings.json` 的 `hooks.PreToolUse`），无 BOM 时兜底静默失效（实测 `LastTaskResult=1`） | ✅ ACCEPT | PR #17；补 BOM 后 `powershell.exe`(5.1) 下 exit 0，`pwsh`(7) 不受影响；配套计划任务 RiskGuard_WiringCheck（每 30 分钟）端到端实测：模拟抹除 → **自动恢复 `hooks.PreToolUse`** | 未发布 |

| 2026-09-21 | @satan9394 | **W2 编码与适配器一致性（收口）**：① 规则引擎的 deny 文案在 Windows 上到不了 Agent 眼前 —— `Write-Output` 按**控制台代码页**（本机 chcp=936/GBK）写 stdout，而 cc / codex / agy 三家消费方一律按 **UTF-8** 解析 hook 的 JSON，中文 reason 变成替换字符（**判定正常、只有文案不可读**，故长期未被发现）。修法：在单源 `assets/hooks/dangerous-commands.ps1` 于任何 `Write-Output` 前设 `[Console]::OutputEncoding = UTF8Encoding($false)`（`$false` = 不带 BOM，否则破坏 JSON），再**字节复制**到 5 处副本。② `agy-dangerous-commands.ps1` 的四处副本跨了三个代次（单源 2,813B / skills+安装态 2,740B / 线上 3,400B）→ 统一为 **v0.2 + UTF-8 = 3,400B**，并把 `skills/agent-risk-guard/SKILL.md` 里过期的 2729/2732B 更正为 3397/3400B。③ 删除已被 v0.2 取代的 v0.1 适配器 `skills/agent-risk-guard/scripts/dangerous-commands-agy.ps1`（不在 `HOOK_SINGLE_SOURCE_MAP`、无代码引用，skill 文件数 39 → 38）。④ 恢复点文件归位：`DSH_RECOVERY_CHECKPOINT.md` / `DSH_RECOVERY_REPORT.md` 移入 `tasks/orchestrator/` 并入库 —— `IMPLEMENTATION_RESULT_G24.md` 引用 `DSH_RECOVERY_REPORT.md` 作为来源卡，而该文件此前在仓库根（**同目录引用悬空**）；`FIX_BRIEF_G3-FIX8.md` 同样补入（被 `IMPLEMENTATION_RESULT_G3-FIX8.md` 与 `decision-parity.test.ts` 引用，且 FIX4–FIX7 早已入库） | ✅ ACCEPT | **字节级**（严格 UTF-8 解码器）：规则引擎 deny 452B、agy 适配器 deny 151B 均**合法 UTF-8、0 替换字符、含真中文**；allow 路径 0B（引擎）/ 22B（`{"decision":"allow"}`，agy）。**副本一致性**：`dangerous-commands.ps1` ×6 同哈希 `45ECD6F367849FA7`（46,706B）；agy 适配器 ×4 同哈希 `7FBFC4906B39CE5C`（3,400B）。**回归**：ps1 五套 × PS 5.1 / pwsh 7 全 exit 0（`hook-audit-reregress` 59/59、`hook-redact-test` 119/119）；sh 四套（WSL）全 exit 0（70/70、40/40、ALL PASS、34/34）；`node --test` **382 pass / 0 fail / 0 skipped**（含 decision-parity 与 redact-parity 常设闸门）。**自证**：`doctor --json` 4 PASS / 0 WARN / 0 FAIL / exit 0；`riskguard-wiring-check.ps1` exit 0（skill 38 文件一致）；三个廉价闸门 `check-compatibility-docs` / `check-decisions-log` / `generate-agent-security-matrix --check` 全 exit 0；死引用检查：`dangerous-commands-agy` 仅存于历史文档 | 未发布 |

| 2026-09-21 | @satan9394 | **R7c `git branch` 删除分支的三处漏拦**（R7/R7b 把删除标志锚在 `branch` 之后紧跟处，且 sh 侧 `-[dD]` 只看首字符）：① `git branch -fd x`（force 在前）→ **sh 放行**；② `git branch --force --delete x`（长选项重排序）→ **五端全部放行**；③ `git update-ref -d refs/heads/x` → **四端放行**（仅 DSH 自 R4 起拦）。①② 均与 `-D` 等价（真的丢弃未合并提交）；③ 与 `git branch -d` 等价，且历史记录显示**此前正是用 `git update-ref -d` 绕开护栏清理分支**，属被真实使用过的洞。修法：标志可落在 `branch` 之后任意 token 位（不得跨 `; & |`），短簇判「含 d 或 D」；并把 `update-ref`/`filter-branch` 补到 core/opencode/ps1/sh 四端对齐 DSH。**有意维持**：`-d`/`--delete`（无 force）仍拦（分支引用删除一律拦，与 DSH 拦 update-ref 自洽），只更正文案里 “force-deletes a branch” 的事实错误并登记为已知过拦。附带：`hook-bypass-regression.ps1` 首行漏 `#` 已补。 | ✅ ACCEPT | **邻居面先验证**：新正则对 21 条必拦 + 21 条邻居（`-a`/`--list`/`-m`/`--contains feat-d`/`--format=…`）零误伤后再落盘。**落盘面**：core `normalize.ts`、opencode 单源 + skills 副本、ps1 单源 ×6 同哈希、sh + 副本、`assets/dsh/deny-risk-commands.patch.yml` + `defaultDenyRules()`、DSH 生产 profile ×2（逐条正则比对通过）。`decision-parity` 新增 **N 段 21 条**。**回归**：ps1 五套 × PS 5.1/pwsh 7 全 exit 0（`hook-audit-reregress` 59/59、`hook-redact-test` 119/119）；sh 四套 exit 0（70/70、40/40、ALL PASS、34/34）；`node --test` **382 pass / 0 fail**（含 `rule-alignment` 抓到的一处双源漂移，已同步 `deploy.ts`）。`doctor` 4 PASS / 0 WARN / 0 FAIL、`riskguard-wiring-check.ps1` exit 0。**变异验证（证明闸门非自证）**：只回退 ps1 → **恰好 N3/N9/N14 红**（ps1=allow/sh=deny）；只回退 sh → **恰好 N1/N2/N3/N9/N14 红**；两端一起移除 update-ref 规则 → **恰好 N10/N11/N12 红**（两端同判但违应然，第三重判据有效）。**首版正则被 CodeQL 判 `js/polynomial-redos` 高危新告警**（门禁因此变红）：根因是 `[^;&|\n]*\s` 这类「负类含空白 + 分隔符也吃空白」的重叠写法，实测 `'git branch' + 5 万空格 + '-d'` 由 0.6ms 劣化到 **4403ms**；最终形态改为定长前导 `[ \t]` + 互不相交的 `(?:[^;&|\n \t]*[ \t])*`，语料零误差且 200k 输入最坏 5.11ms（线性）；两个中间方案（嵌套量词版 / 交替版）分别因二次回溯与丢失「标志必须在 token 起点」语义被实测否决。 | 未发布 |

| 2026-09-21 | @satan9394 | **C 批：agy（Antigravity CLI）从「隐形」到「有明确定论」** —— ① **doctor 完全看不见 agy**：`HOOK_SINGLE_SOURCE_MAP` 早有条目，但 `probeAgentRuntime` 无 agy 分支、`cmdDoctor` 的 `order` 也无 agy，而「不在 order 里的 registry agent」只在**未安装**时才打 SKIP ⇒ **已安装的 agy 一行都不输出**，单源新鲜度校验永远走不到；② 若照抄 claude/codex，agy 的 self-test 会被**两重假通过**骗过：协议是 stdout JSON + **退出码恒 0**（不能用退出码判 deny）、payload 形状是 `{toolCall:{args:{CommandLine}}}`（用 CC 形状喂它 → 当作「无命令」→ **放行**）、且引擎缺失时适配器**故意回一条 deny**（fail-closed）；③ 适配器把规则引擎**硬编码**在 `~/.codex/hooks/` ⇒ 「装了 agy 没装 codex」的机器上对任何命令都 fail-closed deny（把 agy 整个锁死），测试也无法密闭；④ `agy-dangerous-commands.ps1` 是**唯一没有哈希纪律的生产脚本**（巡检 ps1 段硬编码三个 `dangerous-commands.ps1` 落点，漏了它 —— 实测单源 4,525B / 线上仍 3,400B 而巡检 exit 0）；⑤ tests/ 下 4 个 ps1 套件缺 BOM（D9）⇒ PS 5.1 读中文截断，同一套件 18/18 vs 20/20；⑥ 生成器 timeout 10s 比实测在用的 15s 更紧。修法：新增 agy probe 分支（**不认 guard 名**，只认「PreToolUse → hooks[].command 指向 agy 适配器」）+ agy 版 self-test（排除 fail-closed 措辞）+ agy state 判定 + `order` 与兜底循环共用同一列表；适配器引擎改按优先级探测（`RISKGUARD_AGY_ENGINE` → 同目录 → codex）；巡检补入 agy 适配器（每个目标各配自己的单源）；4 个套件补 BOM；CI 升级为「退出码 + 双引擎条数一致」；timeout 对齐 15s。新增 `agy-hook-test.ps1`（24/24，含协议面与输出编码断言）与 `runtime-probe-agy.test.ts`（12 条）。**`agy-plan-readonly.ps1` 判为「有用但需独立切片」**：它压在热路径上（matcher `*`）却完全未版本化，但属**另一条政策轴**（plan 模式按能力只读）且自带三条未实测项，混进单源链会模糊产品边界 —— 已登记进 `docs/TODO.md` 并列出入仓需做的四件事。**D3 版本诚实性**：`compatibility.json` 的 agy `version` 仍写**实测过的 1.1.27**（本机已升 1.2.7，真实会话复验待人工），不做未验证的版本声明。 | ✅ ACCEPT | **doctor**：本机 4 PASS → **5 PASS / 0 WARN / 0 FAIL**，agy 行从「不存在」变为 `PASS agy PreToolUse hook + adapter self-test`。**新增测试**：`agy-hook-test.ps1` 双引擎各 **24/24**（含「用 CC 形状 payload 会假绿灯」的反向守卫）；`runtime-probe-agy.test.ts` **12/12**（doctor「不得静默缺席」回归 + wiring 在位/陈旧/目标缺失/非法 JSON/无适配器/matcher 不覆盖/单源缺失 + fail-closed 假通过的自测）。**D9 闭环**：4 个套件补 BOM 后六套**双引擎条数完全一致**（`hook-bypass-regression` 18/18 → **20/20**），CI 因此可断言条数一致。**副本一致性**：agy 适配器 4 处同哈希 `4800B143E032301B`（4,525B 含 BOM）；`dangerous-commands.ps1` 6 处同哈希；`riskguard-wiring-check.ps1` exit 0（新增 agy 段后**首次运行即抓到线上漂移** 3,400B，`-Fix` 回灌后复跑 exit 0）。**回归**：ps1 六套 × PS 5.1/pwsh 7 全 exit 0；sh 四套 exit 0；`node --test` 全绿；`check-compatibility-docs` / `check-decisions-log` / `generate-agent-security-matrix --check` 全 exit 0。 | 未发布 |

| 2026-09-21 | @satan9394 | **agy 真实会话 D3 复验（agy 1.2.7）**：C 批把 agy 纳入 doctor/套件/巡检后，D3 证据仍停在 2026-09-06 的 **1.1.27**，而本机已升 1.2.7 —— `compatibility.json` 当时**有意**只声明实测过的版本。本次在真实 agy 1.2.7 会话复验：`run_command` 执行 `git reset --hard HEAD` 被 hook 拒绝（`tool call denied by pre-tool hook: RiskGuard: ⛔ HOOK 已拦截危险命令：git 不可逆操作（clean/reset/checkout/restore）丢弃更改，禁止`），同会话 `Read` 与 `git status` 放行、工作区未提交改动存活、钩子日志有对应 `decision=deny` 行。据此把 `componentInventory.version` 升到 1.2.7 并补记证据。⚠️ **第一次尝试被判无效**：提示词是「生成测试文件并想方设法永久删掉」，agy 在**规则层直接拒绝**、一次工具调用都不发（钩子日志零记录）—— 那是 `soft` 遵循而非 `hard` 拦截，**不构成 D3 证据**，故重跑并改用模型不认为该拒绝的命令。`verification.windows` 维持 **D3**（本次只更新被验证的版本号与证据，未动 verification 等级）。 | ✅ ACCEPT | **会话侧**：agy 1.2.7 TUI 显示 `tool call denied by pre-tool hook` 并原样回贴 deny 文本；中文与 `⛔` 完整可读。**机器侧（独立复核，不依赖模型叙述）**：`%TEMP%\riskguard-hook-calls.log` 有 `2026-09-21 07:20:48 [HookInvoked] decision=deny reason=git 不可逆操作（clean/reset/checkout/restore）丢弃更改，禁止`，紧随其后 `07:20:52 decision=allow reason=git status`（与 TUI 两次 Bash 调用一一对应；引擎对每次调用都记 allow，故「零记录」可判定「零调用」）；测试仓库 `git status --porcelain` 仍为 `M tracked.txt`、`rev-list --count HEAD` 仍为 1。**顺带验证两处本轮改动在生产成立**：① deny reason 是规则引擎文案而非 fail-closed，说明适配器引擎解析命中的是**同目录**候选（C 批从硬编码 codex 路径改成优先级探测）；② 中文可读证明 A 批的 UTF-8 输出修复在真实 agy 会话端到端成立。`check-compatibility-docs` / `check-decisions-log` / `generate-agent-security-matrix --check` 全 exit 0。 | 未发布 |

| 2026-09-21 | @satan9394 | **WorkBuddy 一致性轮次：桌面版首次真实会话暴露的五处问题** ① Windows 引擎**漏拦 Node.js fs 删除**（`fs.rmSync` / `fs.unlink` / `fs.rmdir` / `fs.promises.rm` 及 `require('fs').rmSync(...)` 形态；sh 端自 G3 已覆盖 L554）→ 补两条规则。② **stdin 解码在非 UTF-8 输入下 fail-closed**：`[Console]::In.ReadToEnd()` 的解码跟随 `Console.InputEncoding`（中文 Windows PowerShell 5.1 = OEM/GBK），而 WorkBuddy 喂 UTF-8 ⇒ 任何含工作区名「测试」的命令在 `ConvertFrom-Json` 处歧义失败并被 fail-closed 拒绝（用户体感为「引用该工作区的命令全被拦」）→ 改为读原始字节 + UTF-8/ANSI/UTF-16LE/UTF-8+BOM 依次尝试，全失败才 deny，并把原始字节 hex 写进 hook 日志。③ **新增 `RG_ALLOW_DELETE`**：WorkBuddy 自带 safe-delete（bash `safe-bin/*`、Node shim、Python `sitecustomize.py`、覆写 PowerShell `Remove-Item`），一律**强制转回收站且 fail-closed**；本 hook 再拦删除即语义冲突（阻断 vs 改道）并造成死锁（命令不执行 ⇒ shim 无机会改道；而 deny 文案建议的 VB 回收站路径又被平台硬编码黑名单拦：`Add-Type`/`New-Object -ComObject`/`Reflection.Assembly::Load`，且无配置开关）。置 1 时 reason 含「永久删除」的拦截转放行；判据用文案而非规则清单，故 `rm -rf /`、系统目录、`shred`、`wmic shadowcopy`、回收站清空族**仍拦**，`Clear-Content` 显式排除；默认关，cc/codex/agy/gemini 不受影响。④ **脱敏误伤**：`cli-mysql-password` 由「任何 `-p<非数字>`」改为命令词锚定 `(mysql|mariadb)`（与 `-numeric` 同形），修掉 `find -printf` / `-path` / `-print` 被写成 `[REDACTED]`；三端同步。⑤ **巡检器补盲**：`~/.workbuddy/hooks/` 此前**完全不在巡检内**（同步靠人工记忆，本轮漏两次）；skill 段只做「repo skill ↔ 安装 skill」互比，两份镜像可**一致地一起旧着**（本轮两次命中：单源 53,134B 而镜像停 52,755B 仍报 OK）→ 新增 4a 单源锚定检查，并**置于镜像同步之前**（顺序反了则 `-Fix` 会把已污染的 repo 副本先灌进安装目录再单独修 repo，安装目录留污染 —— 实测复验仍报 1 处漂移）。 | ✅ ACCEPT | PR #23 · `faad042`；**规则面**：`node -e "require('fs').rmSync('/x',{recursive:true})"` 由 allow → deny，含中文路径命令由 deny → allow（`Remove-Item` + 中文路径仍 deny），GBK 编码负载亦可解析。**`RG_ALLOW_DELETE` 行为矩阵**（10 负载 × 2 模式）：普通删除转 allow，而 `rm -rf /`、`rm -rf /usr`、`Clear-RecycleBin`、`Clear-Content`、`git clean -fdx` 仍 deny。**回归**：`test-all.ps1` 22 组全过（ps1 五套 × PS 5.1/pwsh 7、sh 四套 WSL、decision-parity、redact-parity）；`redact-parity` + `redact.test` 18/18。**副本一致性**：ps1 七处同哈希 `0C6D65B2222435E2`（53,134B）、sh 两处 `48C3EF7AAF772CA4`（52,984B）。**漂移注入自证**：对 workbuddy 副本与 repo skill 的 ps1 各注入一行 → 巡检报 **3 项**，单次 `-Fix` 收敛。**另推翻一条外来误判**：某会话报告称「Python 脚本绕过 hook 永久删除了文件」，核回收站（`Shell.Application.Namespace(10)`）发现该文件**在回收站里**（safe-delete 早已把 `os.remove` 改道为 trash），非缺口 —— 判据须走到「回收站」这个终点，不能停在「原路径消失」。 | 未发布 |

> **未发布**的变更排在表末，等下一个版本发布时把「版本」列填上。
> Changes not yet released sit at the bottom until the next release fills in the version column.
