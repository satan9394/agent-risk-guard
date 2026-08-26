# DSH RiskGuard 接线 API 实证（D2，2026-08-24）

来源：本机 DSH web profile 实际加载的插件与全局安装包源码，非文档转述。

## 1. 实证来源

| 来源 | 路径 | 关键内容 |
|---|---|---|
| 实际生效插件 | `~/.dsh/profiles/web/node_modules/deny-risk-commands/index.js` | `ctx.on('tools/pre-execute')` 完整示例（含 PreToolDecision 形状注释） |
| pre-execute 瀑布 + guard | `D:\...\nvm_a\v22.19.0\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-tools\lib\index.js` | `tools/pre-execute` waterfall 触发点、`guard()` 注册、`guardReason()` 单调拒绝 |
| 插件树（只读） | `dsh --profile web --dump-config` | deny-risk-commands 为唯一门禁插件，30 条正则规则 |

## 2. 确认的 API 契约

### 2.1 tools/pre-execute（可扩展瀑布，先到先得）

```ts
ctx.on('tools/pre-execute', (exec, next) => PreToolDecision)
// exec = { name, arguments, signal, agent?, parent? }
//   arguments 为已解析参数对象；pwsh/bash 命令文本位于 exec.arguments.command
// PreToolDecision = { kind: 'allow' } | { kind: 'deny', reason } | { kind: 'ask', reason? }
// 不拦截时调用 next() 放行到瀑布下一段
```

实现中触发点（dsh-tools/lib/index.js）：

```js
const gate = await this.ctx.waterfall(carrier, "tools/pre-execute", exec, () => Promise.resolve({ kind: "allow" }));
const askResolution = gate.kind === "ask" ? await this.serviceAsk(exec, gate) : { decision: gate, approvalCancelled: false };
```

### 2.2 tools.guard()（单调最终拒绝，文档 RG-I03 的实际载体）

```js
ctx.tools.guard(guard) {
  return this.layers.effect(this.ctx, (layer) => layer.guards.append(guard), { label: "tools.guard()", notify: false });
}
// guard(exec) 同步检查：返回 string（原因）即拒绝；返回 undefined 放行
// 注释原文："no guard can force-allow a call another guard denied"
// 作用域：ctx 注册 → 全局；agent.ctx 注册 → 仅该 agent
// 多层：guardReason(exec) 先查全局层，再按 agent 作用域链查找
```

### 2.3 拒绝决议（allow 也会被 guard 驳回）

```js
const denialReason = decision.kind === "allow" ? this.guardReason(exec) : decision.reason;
if (denialReason !== void 0) return await next({ kind: "post-result", exec, result: this.materializeFinalResult({ content: [{ type: "text", text: `Error: ${denialReason}` }] }) });
```

即：pre-execute 返回 allow 后，guard 层仍可拒绝；被拒后模型看到 `Error: <reason>`。

## 3. 对 RiskGuard 设计的验证

- RG-I01 永久删除 deny+trash → 由 pre-execute listener 或 guard 承载，均可行
- RG-I02/RG-I03（自保护、ALLOW+DENY=DENY）→ **guard 层天然单调**，正是文档语义；pre-execute 瀑布本身不是单调的（先到先得），所以自保护类不变量应注册为 guard
- RG-I04 fail-closed → listener/guard 异常需自身 catch，运行时不会自动 fail-closed（deny-risk-commands 对非 pwsh/bash 工具直接 next() 放行）
- 本机 deny-risk-commands 纯正则门禁即 RG-I05 的活例：正则黑名单挡得住字面量，挡不住结构等价（编码/别名/实例方法），需要 policy 层兜底

## 4. 遗留（仍未验证）

- ~~`exec.arguments` 对 **pwsh** 的确切字段~~ → **已实证**：本机 web 会话中 deny-risk-commands 插件通过对 pwsh 工具生效（含 `Remove-Item` 的命令行文本在派发前被拦，模型收到 `Error: 全局铁律：...`），代码路径同样是 `exec.arguments.command`；bash 经 `-c` 传入时 `arguments.command` 语义一致（两工具共用该字段）
- ask 的 serviceAsk 人工审批 UI 细节
- guard 与 pre-execute 之间是否存在「guard 注册时机」限制（需真实插件测试，属 M7 项）