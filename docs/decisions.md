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
| 2026-09-17 | @satan9394 | README 重构为首页 + 新增 `docs/cli.md`；补 `docs/decisions.md` | ✅ ACCEPT | `3298161` | 未发布 |
| 2026-09-17 | @satan9394 | 仓库治理：启用私有漏洞报告 / Dependabot alerts + security updates / Code scanning（CodeQL）；新增 `.github/dependabot.yml`；`main` 分支保护（禁 force push、禁删除、5 个 CI 检查必过） | ✅ ACCEPT | `be83671` · 仓库设置（非代码） | 未发布 |

> **未发布**的变更排在表末，等下一个版本发布时把「版本」列填上。
> Changes not yet released sit at the bottom until the next release fills in the version column.
