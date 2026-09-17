## 变更类型 / Change type

- [ ] Bug fix（非破坏性修复 / non-breaking fix）
- [ ] Feature（非破坏性新能力 / non-breaking capability）
- [ ] Breaking change（会改变现有行为或接口 / changes existing behaviour or interfaces）
- [ ] 文档 / 测试 / CI 维护（docs / tests / CI）
- [ ] 新增 Agent 支持（new agent support）——建议同时开 *New agent support request* issue

## 改动摘要 / Summary

一句话说明改了什么、为什么。/ One sentence: what changed and why.

## 关联 issue / Related issue

Fixes #

## 影响面 / Impact

- 涉及包 / Packages: core / cli / trash / installer / dsh / adapters / hooks / 其他
- 是否改变默认 deny 行为？如果是，说明理由。/ Does this change default deny behaviour? If so, justify it.

## 测试 / Tests

- [ ] 新增 / 修改了测试用例（Added/updated tests）
- [ ] 本地全量通过（Local full run green）：`& .\test-all.ps1`（或等价 / or equivalent）
- [ ] 如有规则变更：`rule-alignment` 测试通过（skill 侧与 monorepo 侧同步 / rule change: alignment test passes）
- [ ] 如改了 hook 或规则：证明**回退本修复会让某个测试变红**（reverting this fix turns a test red）

## 安全自查 / Security self-check

- [ ] 本 PR 不含绕过载荷演示 / 真实凭证 / 敏感路径（如有必须，走 SECURITY 私密渠道）
      (No bypass payloads, real credentials or sensitive paths — those go through SECURITY.md)
- [ ] 没有把「永久删除」示例写入文档当作推荐用法
      (No permanent-deletion example presented as recommended usage)

---

## 裁决 / Verdict —— **由 review 的人填写，合并前必须填**

> 这是 git 记不到的那一半：**什么时候、被谁、为什么接受了或拒绝了**。
> 合并后请在本 PR 里留下结论，并在合并前于 [`docs/decisions.md`](../docs/decisions.md) **加一行**。
> This is the half git cannot record. Fill this in before merging, and add a row to
> [`docs/decisions.md`](../docs/decisions.md).

**裁决 / Verdict**（四选一 / pick one）：

- [ ] `ACCEPT` —— 通过 / accepted
- [ ] `REJECT → FIX … → ACCEPT` —— 驳回过、修改后再验、最终通过；**中间每一次驳回都要列出**
      (rejected, fixed, re-verified, finally accepted — list every rejection round)
- [ ] `REJECT` —— 最终未采纳（说明原因，以及是否有替代方案落地）
      (finally not accepted — say why, and whether an alternative landed)
- [ ] `WITHDRAWN` —— 提案方撤回 / withdrawn by the author

**裁决人 / Reviewed by**：（GitHub 账号 / handle）

**理由 / Reason**：为什么接受或拒绝——不是复述改动，而是判断依据（例如"重跑全量对照后 `deny→allow = 0`"）。

**证据 / Evidence**：链接到评估记录（`tasks/orchestrator/EVALUATION_RESULT_*.md`）、对比数据、复现命令或截图。
被拒过的变更**不删记录**——"哪些想法被否决过、为什么"和"哪些被采纳"一样有价值。
