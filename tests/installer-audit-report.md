# RiskGuard Installer（M6 部署层）对抗审查报告

> 审查员角色：GAN 式判别器（只找 bug，不表扬）
> 审查时间：2026-08-24
> 审查范围：`packages/installer/src/` — deploy.ts, backup.ts, rollback.ts, uninstall.ts, doctor.ts, discovery.ts
> 验证方法：Node.js 直接 import 各函数，对输出做 JSON.parse / YAML 结构分析 / 注入探测

---

## P0 — 写坏生产 / 回滚失败

### P0-1：rollbackAgent 导入 trash 但从未调用——回滚直接覆盖生产文件，当前状态丢失

**文件**：`rollback.ts` 第 12 行导入 `trash`，第 30-33 行回滚逻辑

**触发输入**：任何 `rollbackAgent()` 调用

**实测输出**：
```
importLine: "import { trash } from '../../trash/src/index.ts';"
trashCallCountOutsideImport: 0
```
通过 `readFileSync` + 正则统计确认：函数体中 `trash(` 出现次数为 0。回滚逻辑（第 32 行）直接 `cp(src, dst, { recursive: true })` 覆盖目标文件，不调用 `trash(dst)` 保留当前版本。

**分析**：
文件头注释明确写道「先把现场 move 到回收入站再拷贝备份回来」「铁律遵守：被替换的原文件进回收站，不硬删」。但代码完全未实现。一旦回滚目标文件已被用户修改（不是 RiskGuard 注入的内容），该修改将被永久覆盖且无法恢复。

同文件还导入了 `mkdir`、`copyFile`、`rm`（第 9 行），均未使用——说明这段代码写了一半就提交了。

**修复建议**：
```typescript
// 在 cp 之前加：
try { await trash(dst); } catch { /* 目标不存在，跳过 */ }
await cp(src, dst, { recursive: true });
```

---

### P0-2：planDshPatch 对反斜杠过度转义——DSH deny-risk-commands 正则语义损坏

**文件**：`deploy.ts` 第 133 行

**触发输入**：`planDshPatch(defaultDenyRules())`

**实测输出**：
```
originalRuleValue: "\bRemove-Item\b"          // JS 字符串值：单反斜杠
yamlReValue: "\\bRemove-Item\\b"              // YAML 输出：双反斜杠
backslashDoubled: true
BUG: true
analysis: "YAML value has 2 extra backslash(es). Regex engine will misbehave."
```

**分析**：
`planDshPatch` 第 133 行执行 `re.replace(/\\/g, '\\\\')`，将每个 `\` 替换为 `\\`。但在 YAML 单引号字符串中，反斜杠是**字面量**（唯一转义序列是 `''` → `'`）。因此：

| 阶段 | 值 |
|------|-----|
| JS 正则规则（`defaultDenyRules()[0]`） | `\bRemove-Item\b`（word boundary） |
| `planDshPatch` 输出到 YAML | `'\\bRemove-Item\\b'` |
| YAML 单引号解析结果 | `\\bRemove-Item\\b`（双反斜杠） |
| 正则引擎实际收到 | `\\bRemove-Item\\b`（匹配字面 `\\b` 而非 word boundary） |

**35 条规则全部受影响**。所有 `\b`（word boundary）、`\s`（whitespace）、`\\`（字面反斜杠）正则在 DSH 端都会语义错误。`\\b` 会匹配字面 `\\b` 两字符序列而非词边界，导致大量漏检。

**正确做法**：YAML 单引号字符串不需要转义反斜杠，只需转义单引号（`'` → `''`）。替换逻辑应为：
```typescript
const escaped = re.replace(/'/g, "''");
const ruleLines = rules.map((re) => `          - { re: '${escaped}', ... }`);
```

---

## P1 — 格式 / 注入 / 语义 bug

### P1-1：planDshPatch 未转义 YAML 单引号——恶意规则可破坏 YAML 结构

**文件**：`deploy.ts` 第 133 行

**触发输入**：`planDshPatch(["test', 'injected': 'evil"])`

**实测输出**：
```
generatedLine: "          - { re: 'test', 'injected': 'evil', reason: 'RiskGuard：删除必须进回收站' }"
hasUnescapedSingleQuoteInValue: true
```

**分析**：
规则字符串中的单引号 `'` 未被转义。在 YAML 中，`'test', 'injected': 'evil'` 会被解析为：
- 值 `test`（在第一个 `'` 处终止）
- 然后遇到 `, 'injected': 'evil'` 等无效 YAML token

虽然当前 35 条默认规则中不含单引号，但 `defaultDenyRules()` 是 public 函数，外部可传入任意规则。如果未来有人添加含单引号的正则（如 PCRE 的 `'` 字面匹配），YAML 会被破坏。

**实际影响**：中等。当前默认规则集安全，但接口设计不防御未来扩展。

**修复建议**：在 `planDshPatch` 中对规则值做 `re.replace(/'/g, "''")`。

---

### P1-2：uninstallFromJsonConfig 的 permissions 过滤使用子串匹配——误删用户配置

**文件**：`uninstall.ts` 第 47 行

**触发输入**：
```json
{
  "permissions": {
    "allow": ["/risk-guard-rules/safe", "/normal/path"]
  }
}
```
`uninstallFromJsonConfig(file, ["risk-guard"])`

**实测输出**：
```
allowBefore: ["/risk-guard-rules/safe", "/normal/path"]
allowAfter: ["/normal/path"]
accidentalRemoval: true
```

**分析**：
`filterById`（第 34-36 行）使用 `String(x[key] ?? x['id'] ?? '').includes(i)` 进行匹配。对于 permissions 数组，过滤逻辑是：
```typescript
cfg.permissions[k] = cfg.permissions[k].filter((p: string) => !idents.some((i) => p.includes(i)));
```

这使用**子串包含**而非**精确匹配**。如果用户在 `permissions.allow` 中有一条路径包含 RiskGuard 的 ident 子串（如 `/risk-guard-rules/safe`），卸载时会被误删。

同理，hooks 数组的 `filterById`（第 34 行）也使用 `includes`，可能匹配到非 RiskGuard 的 hook（如果其 matcher 字符串碰巧包含 ident 子串）。

**修复建议**：
- hooks：添加 RiskGuard 专用标记字段（如 `_riskguard: true`），卸载时精确匹配该标记
- permissions：改用精确匹配而非子串匹配，或使用 RiskGuard 专用的命名约定前缀

---

### P1-3：uninstall 不支持 DSH YAML / Codex Markdown / Gemini Policy 三种配置格式

**文件**：`uninstall.ts`（仅 `uninstallFromJsonConfig`）

**实测确认**：
- DSH `cordis.patch.yml` 是 YAML 格式 → 无对应卸载函数
- Codex `AGENTS.md` 是 Markdown 格式 → 无对应卸载函数
- Gemini `gemini-policy.json` 虽然是 JSON，但结构是 `policies[]` 数组，不是 hooks/permissions → `uninstallFromJsonConfig` 不识别此结构

**分析**：
`planAll()` 生成 5 种配置，但 `uninstall.ts` 只有一个函数且仅处理 hooks/permissions 结构。5 种目标中只有 Claude Code 的 settings.json 能被完整卸载。

**修复建议**：
- `uninstallFromYamlConfig(filePath, idents)`：解析 YAML，按 `id` 字段定位删除
- `uninstallFromMarkdown(filePath, sectionPattern)`：按标题模式删除 RiskGuard 段落
- `uninstallFromGeminiPolicy(filePath, policyName)`：按 `policies[].name` 定位删除

---

### P1-4：backupPaths 使用 basename 平铺——同名文件互相覆盖

**文件**：`backup.ts` 第 37 行

**触发输入**：备份两个不同路径但同名的文件

**实测分析**：
```typescript
const rel = basename(p); // 扁平平铺，避免目录层级纠缠
const dst = join(dstDir, rel);
```

如果备份 `/a/settings.json` 和 `/b/settings.json`，两者都会映射到 `<ts>/settings.json`，后者覆盖前者。虽然当前使用场景只备份单一路径的目标文件，但函数接口是 `paths: string[]`，允许传入多路径。

**修复建议**：保留完整相对路径结构，或在同名文件冲突时报错。

---

### P1-5：rollbackAgent 的 listBackupTimestamps 重新内联导入 readdir

**文件**：`rollback.ts` 第 43 行

**分析**：
```typescript
async function listBackupTimestamps(agentRoot: string): Promise<string[]> {
  try {
    const { readdir } = await import('node:fs/promises');  // ← 重复导入
```
文件顶部（第 9 行）已经从 `node:fs/promises` 导入了 `cp`、`mkdir`、`copyFile`、`rm`，但 `listBackupTimestamps` 又动态导入了 `readdir`。这不是 bug 但说明代码质量低——可能是从别处复制粘贴时遗留。

---

## P2 — 测试盲区 / 设计建议

### P2-1：deploy.ts 无 apply/write 函数——plan 模式无法实际部署

**分析**：
`deploy.ts` 有 `mode: 'plan' | 'apply'` 的类型定义，但只有 plan 函数。文档说「落盘由 deployTo(paths) 执行」，但该函数不存在。这意味着 installer 目前只能生成配置文本，不能实际写入。

这是**安全的**（fail-closed by absence），但与项目声称的「M6 部署层」定位不符。

---

### P2-2：rollbackAgent 回滚后无完整性验证

**分析**：
`cp(src, dst)` 完成后直接 `restored.push({ src, dst })`，不验证：
- 文件大小是否一致
- JSON 语法是否有效
- 内容是否与源文件相同

在磁盘满、文件系统错误等边缘情况下，cp 可能成功但目标文件不完整。

---

### P2-3：doctor.ts 的 Codex 检查路径不匹配

**文件**：`doctor.ts` 第 65 行检查 `~/.codex/hooks.json`，但 `discovery.ts` 第 52 行注册的 codex 机制是 `['sandbox', 'rules']`（无 hooks），且 `deploy.ts` 没有 `planCodexHook` 函数。

**分析**：
doctor 检查了一个 deploy 从未创建的文件。这要么是 doctor 领先于 deploy（预期有 codex hook 部署但未实现），要么是 doctor 误检。

---

### P2-4：testinstaller.test.ts 未覆盖的关键路径

| 路径 | 覆盖情况 |
|------|---------|
| `planGeminiPolicy` JSON 解析验证 | ❌ 未覆盖 |
| `planDshPatch` YAML 结构/缩进验证 | ❌ 未覆盖（仅检查含 id 和 "re: '"） |
| 注入探测（恶意规则字符串） | ❌ 未覆盖 |
| `uninstallFromJsonConfig` | ❌ 完全未覆盖 |
| 多次备份时间戳隔离 | ❌ 未覆盖 |
| rollback 选择最新备份验证 | ❌ 仅验证恢复成功，未验证版本正确性 |
| rollback 回滚前状态保留（trash） | ❌ 未覆盖 |
| backup 同名文件覆盖行为 | ❌ 未覆盖 |
| `expandProbePath` 环境变量展开 | ❌ 未覆盖 |
| `discoveryToJson` 输出格式 | ❌ 未覆盖 |

---

### P2-5：backup.ts 的 per-file 异常静默吞没

**文件**：`backup.ts` 第 46-48 行

```typescript
} catch (e) {
  // 单个文件失败不中断整体（可能已移动/不存在）
}
```

备份失败时 `entries` 中不包含该文件，调用方无法区分「文件不存在」和「磁盘错误」。建议至少记录错误信息。

---

### P2-6：doctor.ts 的 checkDshPatch 只检查字符串包含

**文件**：`doctor.ts` 第 49 行

```typescript
if (raw.includes('deny-risk-commands')) found.push(`${prof} ✓`);
```

仅检查文件是否包含 `deny-risk-commands` 字符串，不验证 YAML 结构是否有效、规则是否完整。一个被注释掉的或损坏的 deny-risk-commands 块也会报 `ok`。

---

## 总体评分

**评分：4.5 / 10**

**理由**：

1. **P0 级致命 bug × 2**：
   - 回滚函数导入 `trash` 但从未调用，回滚=覆盖而非恢复（铁律违反）
   - DSH YAML 反斜杠过度转义导致 35 条正则全部语义错误（部署上去等于没部署）

2. **P1 级严重缺陷 × 5**：
   - YAML 单引号注入风险
   - 卸载子串匹配误删用户配置
   - 3/5 目标格式无卸载支持
   - 备份同名覆盖
   - 代码重复导入

3. **设计层面**：
   - plan 函数完备但 apply 函数缺失，声称的「部署层」实际无法部署
   - 卸载只有 JSON 一种格式处理，与 5 种目标不对称
   - doctor 检查了 deploy 从未创建的文件

4. **测试盲区**：
   - 5 个 plan 函数中只有 2 个有解析验证
   - `uninstallFromJsonConfig` 零测试覆盖
   - 注入探测、回滚语义、幂等性均未测试

installer 作为唯一直接写入生产配置的代码层，格式正确性和回滚安全性是底线。当前实现在这两个底线上均有硬伤，不应在未修复 P0 的情况下上线。

---

*审查完毕。以上每条均通过 Node.js 直接 import 函数并构造输入验证，未修改任何源码。*
