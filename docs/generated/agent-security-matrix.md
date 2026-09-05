# Agent Security Matrix

> 自动生成自 `packages/installer/compatibility.json`（schemaVersion 2.0，product 0.2.0，ACS profile experimental-0.1）。
> 手工修改本文件无效；运行 `node scripts/generate-agent-security-matrix.ts` 重新生成。

## 验证等级（D0–D4）

| 等级 | 定义 |
| --- | --- |
| D0 | Unsupported |
| D1 | Implementation exists |
| D2 | Automated test verified |
| D3 | Real agent execution verified |
| D4 | Repeated / production verified |

## 安全执行边界（Compatibility v2）

| Agent | Enforcement | Fail mode | 政策范围 | 用户可关闭 | Agent 可绕过 | Hook 失败语义 | 边界层 | 条件可用性 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| claude-code | hard | fail-closed | user | supported | unsupported | fail-closed | L0,L1,L2 | — |
| opencode | hard | fail-closed | user | supported | unsupported | fail-closed | L0,L1,L2 | — |
| codex | hard | fail-closed | user | supported | unknown | fail-closed | L0,L2 | — |
| dsh | hard | fail-closed | user | supported | unsupported | fail-closed | L0,L2,L3 | — |
| cursor | hard | unknown | user | supported | unknown | unknown | L0,L2 | — |
| windsurf | hard | unknown | user | supported | unknown | unknown | L0,L2 | hook:supported@Restricted Mode disabled |
| grok | soft | fail-open | user | supported | unknown | fail-open | L0 | — |
| pi | none | unknown | — | not-applicable | not-applicable | unknown | — | — |

## Capability Matrix（per-surface 证据）

| Agent | Capability | Enforcement | Windows | macOS | Linux |
| --- | --- | --- | --- | --- | --- |
| claude-code | shell.execute | hard | D3 | — | — |
|  | filesystem.write | hard | D2 | — | — |
|  | filesystem.delete | hard | D3 | — | — |
|  | git.destructive | hard | D3 | — | — |
|  | mcp.invoke | unknown | D0 | — | — |
|  | network.connect | unknown | D0 | — | — |
| opencode | shell.execute | hard | D3 | — | — |
|  | filesystem.write | hard | D3 | — | — |
|  | filesystem.delete | hard | D3 | — | — |
|  | git.destructive | hard | D2 | — | — |
|  | mcp.invoke | unknown | D0 | — | — |
|  | network.connect | unknown | D0 | — | — |
| codex | shell.execute | hard | D2 | — | — |
|  | filesystem.write | hard | D2 | — | — |
|  | filesystem.delete | hard | D2 | — | — |
|  | git.destructive | hard | D2 | — | — |
|  | mcp.invoke | unknown | D0 | — | — |
|  | network.connect | unknown | D0 | — | — |
| dsh | shell.execute | hard | D3 | — | — |
|  | filesystem.write | hard | D3 | — | — |
|  | filesystem.delete | hard | D3 | — | — |
|  | git.destructive | hard | D3 | — | — |
|  | mcp.invoke | unknown | D0 | — | — |
|  | network.connect | unknown | D0 | — | — |
| cursor | shell.execute | hard | D2 | — | — |
|  | filesystem.write | unknown | D0 | — | — |
|  | mcp.invoke | unknown | D0 | — | — |
| windsurf | shell.execute | hard | D2 | — | — |
|  | mcp.invoke | unknown | D0 | — | — |
| grok | shell.execute | soft | D1 | — | — |
| pi | — | — | — | — | — |

## Surface 覆盖（EvidenceState：supported / unsupported / unknown / not-applicable）

| Agent | Shell | Filesystem | Git | MCP | Network |
| --- | --- | --- | --- | --- | --- |
| claude-code | supported | supported | supported | unknown | unknown |
| opencode | supported | supported | supported | unknown | unknown |
| codex | supported | supported | supported | unknown | unknown |
| dsh | supported | supported | supported | unknown | unknown |
| cursor | supported | unknown | unknown | unknown | unknown |
| windsurf | supported | unknown | unknown | unknown | unknown |
| grok | supported | unknown | unknown | unknown | unknown |
| pi | not-applicable | not-applicable | not-applicable | not-applicable | not-applicable |

## 说明

- EvidenceState 语义：`supported` 有证据支持 / `unsupported` 有证据不支持 / `unknown` 无证据（不是不支持）/ `not-applicable` 不适用。
- Fail mode 与 Hard Deny 是两回事（v0.2.0 §三十二）：hard=true 只说明 hook 支持 DENY；hook 崩溃后 Agent 是否继续由 fail mode 描述。
- "Hard at this enforcement point"（§三十五）：runtime-enforced deny before tool execution，不做"AI 无论如何都绕不过"式宣传。
