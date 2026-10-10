# tasks/orchestrator —— 内部开发过程记录（**非产品文档**）

> **本目录不是本产品的一部分。** 它收留的是「多 Agent 协同时的开发过程产物」：
> 切片派工单、评测裁决、实现结果、会话交接、事故恢复记录、证据快照。它们解释**为什么**某个决定
> 被做出或被否决，但**不是**给使用者看的文档，也不构成任何对外承诺。

## 里面有什么

| 前缀 | 含义 |
|---|---|
| `IMPLEMENTATION_BRIEF_*` | 给实现 Agent 的派工单（任务边界 + 验收口径） |
| `IMPLEMENTATION_RESULT_*` | 实现 Agent 的交付说明 |
| `EVALUATOR_BRIEF_*` / `EVALUATION_RESULT_*` | 独立评测 Agent 的派工单与裁决（含 REJECT 记录） |
| `FIX_BRIEF_*` | 返工派工单 |
| `SESSION_HANDOVER_*` | 会话交接单（同日多份取后缀最大的，如 `_B` 接续上一份） |
| `SUBAGENT-*_REPORT.md` | 并行子 Agent 的专项报告 |
| `PRODUCT_STATE.md` / `PRODUCT_GAP_MAP.md` / `PROJECT_BRIEF.md` | 阶段性产品状态快照 |
| `DSH_RECOVERY_*` | 一次事故的恢复记录 |
| `WORKBUDDY_D3_SESSION_*` / `wb-*` | WorkBuddy D3 取证材料（会话自产报告 + 最小复现 + 分析脚本） |
| `rg-wiring-check-sealed-test.ps1` | **可复用**的接线巡检密封测试（假 `USERPROFILE`，不碰生产面） |

## 阅读约定

- **面向使用者的文档在仓库根的 [`README.md`](../../README.md)、[`docs/`](../../docs/)、
  [`CHANGELOG.md`](../../CHANGELOG.md)、[`SECURITY.md`](../../SECURITY.md)。**
- `docs/decisions.md` 的 B 表（切片级裁决）会**链接到本目录**作为「依据 Evidence」——所以
  这些文件不能随手删；改动它们等于改动证据链。
- 这里的文本可能含**开发机的绝对路径**（`E:\DeepSeek_Harness\…`、`C:\Users\…`）与 WorkBuddy /
  Codex 会话 id。它们是记录的一部分，属**有意保留的取证信息**，不是配置依赖。
- 目录里的 `_` 前缀散落脚本（`_g15_*` / `_probe_*` 等）由 `.gitignore` 排除，**不进版本库**。

## 为什么不搬走

历史上这些文件一直被 `docs/decisions.md` 引用，且「哪些想法被否决过、为什么」与「哪些被采纳」
同样有价值（见 `docs/decisions.md` 顶部规则）。因此**保留原位、加本标签说明性质**，而不是移出
或删除——搬走会同时打断裁决表的证据链与「拒绝记录」的可查性。
