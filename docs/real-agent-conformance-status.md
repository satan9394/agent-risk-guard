# Real Agent Conformance（v0.3.0）— 进度与诚实结论

> 任务书 Phase B：v0.3.0 Real Agent Conformance（Cursor / GitHub Copilot CLI / Windsurf 真实 D3）。
> 本文件记录真实状态：哪些已完成、哪些受环境限制、如何解锁。核心原则：**Real execution evidence > mock confidence**，
> **No side effect = D3 proof**，环境无法完成的绝不伪造 D3（§二十七/§三十三）。

## 一句话结论（2026-09-05）

RiskGuard 的 ACS 协议层已在 v0.2.2 冻结并发布。v0.3.0 的**基础设施 + 三家 adapter 全部就绪（D2）**，
但**真实 D3 会话在本机未完成**：Cursor 已装但需 GUI/终端 Agent 会话（需登录态），Copilot CLI 与 Windsurf
**未安装** → SKIP。真实 D3 证据尚未产生，`compatibility.json` 里三家仍是 D2（诚实，未升 D3）。

## 已完成

| 项 | 状态 |
|---|---|
| D3 evidence 格式（机器可读 + 校验 + 脱敏 + 新鲜度 + per-capability） | `packages/acs/src/real-conformance.ts` + 6 条测试 |
| Real Conformance Runner（检测 + fixture + 诚实 SKIP） | `scripts/run-real-conformance.ts`（T2 git + T3 sentinel + manifest） |
| Cursor adapter（preToolUse） | `packages/adapters/cursor`（D2，既有） |
| **Copilot CLI adapter（preToolUse + policy.d machine policy）** | `packages/adapters/copilot`（D1/D2，本轮新增，官方 hooks-reference 核查） |
| Windsurf adapter（pre_run_command exit 2） | `packages/adapters/windsurf`（D2，既有） |
| compatibility.json 更新（copilot 条目 D2 + policyScope user+machine） | 已完成 |
| 全量测试 | **292/292 通过** |

## 环境探测（本机 2026-09-05）

| Agent | 环境 | 结论 |
|---|---|---|
| Cursor | `cursor` CLI 存在，版本 **3.17.21**（`cursor agent` 子命令存在：「Start the Cursor agent in your terminal」） | 检测可用；真实 D3 需登录态 + 终端/GUI Agent 会话 |
| GitHub Copilot CLI | `gh` 2.90 已装，但 `gh copilot` 扩展**未安装** | **SKIP**（环境不存在） |
| Windsurf | 不在 PATH | **SKIP**（环境不存在） |

## 解锁真实 D3 所需（环境/用户动作）

1. **Cursor D3**：在登录态的 Cursor 中，用 `cursor agent`（终端）或 GUI 对 fixture 发起真实会话——
   提示 Agent 执行 `git reset --hard`（T2）与永久删除 sentinel（T3），核对 preToolUse hook deny 且副作用未发生。
   fixture 由 `node scripts/run-real-conformance.ts cursor` 生成（含 sentinel sha256 + git dirty 状态）。
2. **Copilot CLI D3**：`gh extension install github/gh-copilot` 安装扩展 + 登录 Copilot 席位，
   再走 Layer A（`%USERPROFILE%\.copilot\hooks\`）用户 hook；Layer B machine policy 需管理员权限（policy.d / HKLM）。
3. **Windsurf D3**：安装 Windsurf CLI，验证 `pre_run_command` exit 2 阻断 + Restricted Mode 下 hook 不加载。

## 诚实性要点（为什么没有升 D3）

- Copilot CLI `preToolUse` deny 存在版本回归（copilot-cli issue #3874，2026-06）：`permissionDecision=deny` / exit 2
  在部分版本「工具仍被执行」→ `failMode` 记 unknown，不能写 hardDeny D3（§三十二/§三十四）。
- Cursor 真实 hook 触发与 deny 的 side-effect 核验只能在真实会话里做，adapter 单测只到 D2（§四十一）。
- 未安装 / 未登录的环境 → SKIP，而非 UNKNOWN 或伪造 PASS（§四十四）。

## 后续决策点（待确认）

- 是否安装 `gh copilot` 扩展 + Windsurf 以补真实 D3；
- 或按任务书 §五十 诚实发布 v0.3.0（Cursor D2 / Copilot D2 / Windsurf D2，evidence 记录 SKIP 原因）；
- 或把 v0.3.0 发布推迟到真实 D3 证据就绪之后。
