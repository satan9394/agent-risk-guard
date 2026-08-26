# Adapter Contract v1 — Vendor Payload → RiskEvent → Decision 契约

> 来源：`Universal Agent Risk Guard.md` §7/§15。Core 不直接理解具体 Agent；Adapter 只做形状转换，不重新定义安全规则。

## 数据流

```text
Vendor Payload
     ↓
Adapter (packages/adapters/<agent>/src)
     ↓  normalize（公共基元见 @riskguard/core normalize.ts）
Normalized RiskEvent
     ↓  evaluate(event, policy) 纯函数
Decision (ALLOW / DENY / ASK / SAFE_REPLACEMENT)
     ↓
Vendor-specific Deny（各家 hook/插件/权限输出形状）
```

## RiskEvent v1（核心协议）

```ts
interface RiskEvent {
  schemaVersion: '1.0';
  source: { agent: string; agentVersion?: string; surface: string; tool?: string; toolCallId?: string };
  operation: { domain: Domain; action: Action; destructive: boolean; reversible: boolean };
  targets: EventTarget[];   // { kind, raw, canonical, scope, tags }
  command?: { raw?; shell?; argv?; parseConfidence? };
  context?: { cwd?; interactive?; sandbox?; env? };
}
```

- Domain 六大类：`filesystem / process / git / network / credentials / guard`（`risk-taxonomy.ts`）
- 新增风险类别只扩展 taxonomy，不破坏协议（版本化演进）

## Decision v1

```ts
interface Decision {
  decision: 'allow' | 'deny' | 'ask';
  ruleId?: string;
  reason?: string;
  safeAlternative?: { operation: string; description?: string };  // deny 时建议 trash
  monotonic?: boolean;   // guard() 不变量，后续不可撤销（RG-I03）
  degraded?: boolean;    // 解析失败 → fail-closed（RG-I04）
}
```

## Vendor 形状约定（各家 Adapter 必须产出）

简化输入（CLI 已支持）：

```json
{
  "agent": "cursor",
  "surface": "preToolUse",
  "domain": "filesystem",
  "action": "delete",
  "targetsRaw": ["C:\\proj\\x"],
  "commandRaw": "remove-item C:\\proj\\x -Recurse -Force",
  "cwd": "C:\\proj",
  "workspaceRoot": "C:\\proj",
  "profile": "autonomy-safe | strict"
}
```

或直接传入完整 `event` 对象（已归一化）。

## 适配器职责清单

| 职责 | 归属 |
|------|------|
| Vendor payload → 本契约形状 | Adapter |
| 路径 realpath/symlink 解析（Core 保持纯函数） | Adapter |
| 安全规则定义 | ❌ 禁止，Policy 唯一来源 |
| Decision → Vendor deny 形状 | Adapter |
| fail-closed 兜底 | Adapter + CLI（无效 JSON/空输入 → deny+degraded） |

## 验证等级（文档 §18）

- D1 Docs Confirmed — 官方文档确认 API 存在
- D2 Payload Tested — 本项目 tests/* 模拟 Vendor JSON
- D3 Live Agent Tested — 真实 Agent 会话 + sentinel 文件
- D4 Adversarial Hardened — 绕过语料测试，唯一可显示 HARDENED