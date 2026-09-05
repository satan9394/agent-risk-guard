# OWASP ACS v0.1 Alignment — 边界与工程说明（v0.2.0）

> 定位声明：**OWASP ACS v0.1 aligned（experimental）**，不是 ACS Certified / Compliant / Fully Compatible。
> 依据：ACS 仍处 Public Preview，官方尚无正式 conformance 标准/registry（研究报告 §对齐边界）。

## 1. 核心原则

> **ACS is an interoperability layer, not the RiskGuard core.**

- RiskGuard 的成熟安全内核（RiskEvent → Policy Engine → Decision）保持标准无关，**不 import ACS**。
- ACS 是 **Boundary Protocol**（`packages/acs/`），负责 inbound（ToolCallRequest → RiskEvent）与 outbound（Decision → Result）。
- 禁止为了"对齐 ACS"推翻现有架构（v0.2.0 目标 §二/§四十四）。

数据流：

```
Vendor Agent                       ACS Tool Call Request
    ↓                                    ↓
Vendor Adapter                      ACS Gateway (packages/acs)
    ↓                                    ↓
RiskEvent  ──→  RiskGuard Policy Engine  ← RiskEvent
    ↓                                    ↓
Decision ──→ ACS Mapping Layer ──→ ACS-compatible Result
```

## 2. 版本固定

| 项 | 值 |
|---|---|
| `ACS_VERSION` | `0.1`（显式固定，禁止 latest / auto-detect） |
| `ACS_PROFILE` | `experimental-0.1` |
| fixture 命名空间 | `tests/fixtures/acs-v0.1/` |

未来 ACS v1/v2 并存：新增 `acs-v1` 版本面，不修改 v0.1 语义。

## 3. Inbound 映射（ToolCallRequest → RiskEvent）

| ACS 字段 | RiskEvent 目标 |
|---|---|
| `tool` | `source.tool`（经 capability 归一为 domain） |
| `operation` | `operation.action` |
| `capability` | 经 capability taxonomy 归一（`capability-map.ts`） |
| `raw_command` | `command.raw`；并触发 `classifyShellCommand` 细化 domain/action |
| `arguments` | 提取 path / target / url / host / repo / branch 等 target |
| `intent` | `context.metadata.intent` —— **contextual evidence，绝不决定 allow**（§七） |
| `provenance` | `context.metadata.provenance`（evidence） |

- 未知 capability / 非法形状 → **fail-closed**（gateway 输出 deny + `extensions.riskguard.degraded=true`，无 stack trace）。
- 只读命令（`isReadOnlyCommand`）→ `filesystem.read`（Profile B 放行，与 vendor adapter 同模式）。

## 4. Outbound 映射（Decision → ACS Result）

| RiskGuard Decision | ACS Result | 说明 |
|---|---|---|
| `allow` | `allow` | |
| `deny` | `deny` | 保留 reasoning / ruleId / reason_codes / policy_references |
| `deny` + `safeAlternative` | `modify` | **Modification Proposal（§十二）：只提议，不执行**；由上游决定是否执行修改后的请求 |
| `ask` | `ask` | 非默认策略（§十三）：仅 context insufficient / medium-risk ambiguous |
| （默认映射） | `defer` | **仅协议支持**（类型 + 校验），默认映射永不产生 defer（§十四） |

- `reasoning` 必须含 rule ID + risk category + operation + reason（§十五），禁止 "blocked / dangerous / denied" 式无意义文本。
- RiskGuard 特有信息统一进 `extensions.riskguard`（§十九）：`ruleId / degraded / verification / monotonic / acsVersion / profile`。
- 不往 ACS 官方 schema 顶层加字段。

## 5. Compatibility Schema v2（真实执行边界）

v1 只有 `agent / integration / enforcement / verification(D0–D4)`；v2（schemaVersion `2.0`）补充：

- `surfaces`：shell / filesystem / git / mcp / network → **EvidenceState**（supported / unsupported / unknown / not-applicable；§二十三：不知道 ≠ false）。
- `enforcementDetail`：pre/post execution hook、hardDeny、failMode。
- `sandbox` / `policy`（含 `policyScope: user|machine|enterprise`，§三十 Copilot CLI 系统策略预留）。
- `bypass`：userCanDisable / agentCanBypass（§三十五：只写 "runtime-enforced deny before tool execution"，不宣传绝对硬拦截）。
- `hookFailureSemantics`：fail-open / fail-closed / warning-and-continue / unknown（§三十二：hard 与 crash 行为分开描述）。
- `conditionalAvailability`：如 Windsurf Restricted Mode → hooks 不加载（§三十一）。
- `securityBoundaries`：L0 Prompt / L1 Permission / L2 Runtime Hook / L3 Sandbox / L4 OS Policy / L5 External Gateway（§三十三/§三十四）。
- `capabilities`：per-capability matrix（enforcement × D 等级）。
- `componentInventory`：AGBoM 预留（§三十六），只记录组件清单。

**迁移**：loader 兼容 schemaVersion 1 与 2（§四十一），v1 数据升级不 crash；v2 未声明字段一律 unknown，不伪造 false。

## 6. Conformance Framework（C1–C10）

`packages/acs/src/conformance.ts` + `tests/conformance/`：

```
C1 Hook Available    C2 Pre-execution        C3 Hard Deny
C4 Deny survives bypass permissions          C5 Safe command allowed
C6 Dangerous command blocked                 C7 Tool never executed
C8 Hook failure semantics                    C9 User bypass behavior
C10 MCP coverage
```

状态：PASS / FAIL / SKIP / UNKNOWN。与 D0–D4 是**另一维度**（§二十七），不互相替代。

- 本轮：Framework 就绪，mock evidence 驱动 P0 四件套（claude-code / codex / opencode / dsh）。
- 下一阶段：同一框架对 Cursor / Copilot CLI / Windsurf 做真实 D3，不再靠人工报告判断。
- 真实会话（Real sessions）：本轮无；所有 P0 证据来自已有 D2/D3 实证 + compatibility.json。

## 7. SecurityAuditEvent（JSONL）

最小字段（§三十七）：`timestamp / agent / tool / capability / decision / ruleId / acsVersion / verificationMode / degraded`。
只做 JSONL / structured log；**不记录 raw_command / arguments / 凭据路径**（§三十八，出口统一 `redactSecrets`）。

## 8. CLI

```bash
cat request.json | riskguard acs evaluate          # stdin ToolCallRequest → stdout Result
cat request.json | riskguard acs evaluate --profile strict
cat request.json | riskguard acs evaluate --audit  # 追加一行脱敏 SecurityAuditEvent
```

非法输入 → deny + `degraded: true`（RG-ACS-INVALID-001），绝不抛 stack trace（§十八）。

## 9. 本轮明确不做（§四十四）

不重构 Policy Engine / 不删除 RiskEvent / Core 不依赖 ACS / 不新增大量危险命令规则 /
不一次支持 40+ ACS schema / 不开发完整 AGBoM / 不做 A2A / 不开发复杂 MCP security gateway /
不做企业控制台 / 不做 GUI / 不扩 10 个 Agent / 不追求 D4。
