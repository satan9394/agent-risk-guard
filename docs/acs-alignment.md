# OWASP ACS v0.1.0 Alignment — 边界与工程说明（v0.2.0 建立，v0.2.1 Schema Conformance Patch）

> 定位声明（§五十七）：**OWASP ACS v0.1.0 aligned（experimental）** 与
> **Experimental OWASP ACS v0.1.0 schema-conformant wire gateway**，
> 不是 ACS Certified / Compliant / Official ACS Implementation / Fully ACS Compatible。
> 依据：ACS 仍处 Public Preview，官方尚无正式 conformance 标准/registry（研究报告 §对齐边界）。

## 1. 核心原则

> **ACS is an interoperability layer, not the RiskGuard core.**

- RiskGuard 的成熟安全内核（RiskEvent → Policy Engine → Decision）保持标准无关，**不 import ACS**。
- ACS 是 **Boundary Protocol**（`packages/acs/`），负责 inbound（ToolCallRequest → RiskEvent）与 outbound（Decision → Result）。
- v0.2.1 只补 **Wire Schema Conformance**（线协议 / JSON Schema 层），不推翻 v0.2.0 架构（§二）。

数据流：

```
Vendor Agent                       ACS Tool Call Request        JSON-RPC Request Envelope (--wire)
    ↓                                    ↓                                   ↓
Vendor Adapter                      ACS Gateway (packages/acs)   evaluateAcsEnvelope() (wire mode)
    ↓                                    ↓                                   ↓
RiskEvent  ──→  RiskGuard Policy Engine  ← RiskEvent                    RiskEvent
    ↓                                    ↓                                   ↓
Decision ──→ ACS Mapping Layer ──→ ACS Result ──→ JSON-RPC Response Envelope
```

## 2. 版本固定（§三）

| 项 | 值 |
|---|---|
| `ACS_SPEC_VERSION` | `0.1.0`（官方 wire spec 版本，完整 SemVer；写进 acs_version） |
| `ACS_VERSION` | `0.1.0`（兼容别名 = `ACS_SPEC_VERSION`） |
| `ACS_PROFILE` | `experimental-0.1`（profile / namespace，与 spec version 分离，§三） |
| `compatibility.json acsProfile` | `experimental-0.1.0`（§五十） |
| legacy fixture 命名空间 | `tests/fixtures/acs-v0.1/`（v0.2.0 兼容集，不删除） |
| 官方 fixture 命名空间 | `tests/fixtures/acs-v0.1.0/`（payload/ + envelope/，§四十五/§四十六） |
| 官方 schema 快照 | `tests/vendor/owasp-acs-v0.1.0/`（pinned commit `f46d260d…468e`，§二十四/§二十五） |

未来 ACS v1/v2 并存：新增 `acs-v1` 版本面，不修改 v0.1 语义。

## 3. Inbound 映射（ToolCallRequest → RiskEvent）

| ACS 字段 | RiskEvent 目标 |
|---|---|
| `tool`（必填） | `source.tool`（经 capability 归一为 domain） |
| `operation` | `operation.action` |
| `capability`（**可选**，§四） | 显式 → 经 capability taxonomy 归一；缺失 → 从 tool/operation/raw_command/arguments **推导**（§三十一） |
| `raw_command` | `command.raw`；并触发 `classifyShellCommand` 细化 domain/action |
| `arguments`（**必填**，§四） | 经 `unwrapAcsArguments` 解析 value-wrapper（§三十三）后提取 target |
| `intent` | `context.metadata.intent` —— **contextual evidence，绝不决定 allow**（§七） |
| 参数级 `provenance` | `context.metadata.provenance`（保留 `argumentPath = /arguments/<key>`，§三十四/§三十五） |
| envelope `metadata` | `context.metadata.acs`（agentId / sessionId / turnId…，§三十六；Core 不解释） |

- capability 推导规则（§三十一/§三十二）：`capability present → 官方名归一`（未知 → fail-closed，绝不静默 reinterpret）；`capability absent → deriveAcsCapability()`（raw_command 分类优先，其次 tool.name + operation）；`derive 不确定 → fail-closed deny`。
- 只读命令（`isReadOnlyCommand`）→ `filesystem.read`（Profile B 放行，与 vendor adapter 同模式）。

## 4. Outbound 映射（Decision → ACS Result）

官方必填（§十三/§十四/§十五/§十六）：`type = "final"` / `acs_version = "0.1.0"` / `request_id`（wire 模式回显 params.request_id，payload 模式由 gateway 生成合法 UUID）/ `decision`。

| RiskGuard Decision | ACS Result | 说明 |
|---|---|---|
| `allow` | `allow` | |
| `deny` | `deny` | 保留 reasoning / ruleId / reason_codes / policy_references |
| `deny` + `safeAlternative` | `modify` 或 `deny` | **仅当 arguments 能安全表达 operation/path/mode 改写**才 `modify`（官方 `parameter_overrides`，§十八/§十九）；否则 `deny`（§二十：`Safe replacement is available conceptually but cannot be represented safely in this ACS payload.`） |
| `ask` | `ask` | 官方 `ask_details`（approver / question / timeout_seconds，§二十二） |
| （默认映射） | `defer` | **仅协议支持**（官方 `defer_details`，§二十三），默认映射永不产生 defer |

- `modifications` 是官方 object 结构（§十七）：`modified_content` XOR `redactions` / `parameter_overrides`；**description-only 不是合法 modification**（§二十一）。
- `reasoning` 必须含 rule ID + risk category + operation + reason（§十五），禁止 "blocked / dangerous / denied" 式无意义文本。
- RiskGuard 特有信息统一进 `extensions.riskguard`（§十九）：`ruleId / degraded / verification / monotonic / acsVersion / profile`。
- `request_id` 是官方顶层字段，不放进 extensions（§十四）。

## 5. Wire Mode（§七/§八/§九/§十二）

**官方 conformance 对象是 Request Envelope → Gateway → Response Envelope**（§九）；payload mode 只是 RiskGuard convenience interface，**不等于官方 wire conformance**（§四十九）。

```
Request Envelope                    Response Envelope
{ jsonrpc: "2.0",                   { jsonrpc: "2.0",
  method: "steps/toolCallRequest",    id: <echo request.id>,      // §三十八
  id: 1,                              result: { type: "final",
  params: {                             acs_version: "0.1.0",
    acs_version: "0.1.0",               request_id: <echo params.request_id>,  // §三十七
    request_id: <uuid>,                 decision: allow|deny|modify|ask|defer,
    timestamp: <ISO 8601>,              ... } }
    metadata: { agent_id, session_id, ... },
    payload: { ToolCallRequest } } }
```

错误语义（§三十九/§四十/§四十一）——协议错误与 policy deny 严格分开：

| 场景 | 输出 |
|---|---|
| invalid JSON | `-32700 Parse error`（id null） |
| invalid envelope 结构 | `-32600 Invalid Request`（id 尽力回显） |
| params / payload 必填缺失或类型错误 | `-32602 Invalid params`（id 回显） |
| valid request 但安全映射失败（unknown operation / ambiguous capability） | **ACS deny + `degraded=true`**（result envelope，非协议错误） |
| 策略 deny / modify / ask | 正常 result envelope |

## 6. Compatibility Schema v2（真实执行边界）

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

## 7. Conformance Framework（C1–C10）

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
- C1–C10 = Agent enforcement capability；**ACS Schema Conformance = Protocol correctness**，是两件事（§五十一/§五十二），协议测试走 `tests/acs-schema-conformance/`。

## 8. ACS Schema Conformance（§二十九/§五十一~§五十六/§六十）

- **Layer 1**：RiskGuard 本地校验（`validateAcsToolCallRequest` / `validateAcsResult`）——快速、错误友好、fail-closed。
- **Layer 2**：官方 JSON Schema（`tests/vendor/owasp-acs-v0.1.0/`，pinned commit `f46d260d22fe6d6ad71e4d979be7e25d063c468e`，ajv Draft 2020-12）——**最终 conformance 判据**（§二十九/§五十三）。
- vendor schema 只读（§五十五）；`SCHEMA_SHA256SUMS` + `scripts/verify-acs-schema-snapshot.ts` 校验完整性（§五十四/§五十六）。
- `scripts/check-acs-upstream.ts`：informational drift check，不阻塞 CI（§二十七）。
- 官方 schema 是 v0.2.1 起 **Release Gate**（§五十三）：RiskGuard ACS 输出无法通过 pinned schema → CI fail。

## 9. SecurityAuditEvent（JSONL）

最小字段（§三十七）：`timestamp / agent / tool / capability / decision / ruleId / acsVersion / verificationMode / degraded`。
只做 JSONL / structured log；**不记录 raw_command / arguments / 凭据路径**（§三十八，出口统一 `redactSecrets`）。

## 10. CLI（§四十七/§四十八）

```bash
cat request.json  | riskguard acs evaluate                 # payload mode（默认）：ToolCallRequest → Result
cat request.json  | riskguard acs evaluate --profile strict
cat request.json  | riskguard acs evaluate --audit         # 追加一行脱敏 SecurityAuditEvent
cat envelope.json | riskguard acs evaluate --wire          # wire mode：Request Envelope → Response Envelope
```

- `acs evaluate` = **payload compatibility mode**（RiskGuard convenience interface）。
- `acs evaluate --wire` = **official ACS v0.1.0 JSON-RPC wire mode**（§四十八 help 明确两种模式）。
- payload mode 非法输入 → deny + `degraded: true`（RG-ACS-INVALID-001）；wire mode 协议错误 → JSON-RPC error，绝不抛 stack trace（§十八/§四十）。

## 11. 本轮明确不做（§二/§五十九）

不重构 Policy Engine / 不删除 RiskEvent / Core 不依赖 ACS / 不删除 packages/acs / 不重做 Compatibility v2 /
不扩完整 ACS 40+ schema / 不开始 Cursor / Copilot CLI / Windsurf D3 / 不扩 Agent（Gemini adapter / MCP capability expansion 留到 v0.3.0+）。
