# OpenCode RiskGuard 接线指南（已实测，2026-08-24；2026-09-23 按 V2 双入口重写）

## 为什么需要接线

R17 实测发现：把插件文件放进 `~/.config/opencode/plugins/` **在 V1（1.18.x）下不会自动生效**——
opencode 1.18 要求插件在 `opencode.json` 的 `plugin` 数组里**显式声明**。
未声明时：插件文件存在但从未加载（R17 中哨兵曾被删除 = 无插件防护状态）。

> **2026-09-22 起（V2，`@opencode/cli` >= 2.0）规则变了**：V2 不再接受配置里的 `.ts` 文件路径
> （`configured plugin path must be a directory`），改为**自动发现 `~/.config/opencode/plugins/*.ts`**，
> 因此 V2 下 **不要**再往配置里写插件路径。判定形态见 `packages/installer/src/merge.ts` 的
> `detectOpencodeConfigMode`（`plugins` 键 → V2、`plugin` 键 → V1、两键都无则看 `cli.json`）。

## 接线步骤

### 方式 A：全局注册（推荐，所有项目生效）

1. 把 `scripts/opencode/agent-risk-guard.ts`（**38,925 B / 735 行，V1+V2 双入口**）复制到
   `~/.config/opencode/plugins/`。
   ⚠️ **文件名必须是 `agent-risk-guard.ts`**：`destructive-operation-guard.ts` 是 v0.1 旧快照，
   顶层 `import { tool } from "@opencode-ai/plugin"`、只导出 `{id, server}`、**没有 `setup`**，
   在 V2 上 `ctx.shell.hook` / `ctx.tool.hook` / `ctx.permission.hook` / `create.before` 四项
   **全缺** ⇒ 装得上但**不拦任何东西**（门禁形同虚设，且不会报错）。
2. **V1 才需要改配置**：编辑 `~/.config/opencode/opencode.json`，在 `plugin` 数组加：
   ```json
   "plugin": [
     "@beremaran/opencode-goal",
     "./plugins/agent-risk-guard.ts"
   ]
   ```
   （相对路径基于 `~/.config/opencode/`；或绝对路径亦可）
   **V2 跳过本步**——本地插件由 `plugins/` 目录自动发现，配置里不该出现该字符串
   （`merge.ts` 还会顺手清理 V1 时代残留的文件路径引用）。
3. 重启 opencode 生效。

### 方式 B：项目级注册（隔离测试）

项目根放 `opencode.json`（V1 形态）：
```json
{
  "plugin": ["./.opencode/plugins/agent-risk-guard.ts"]
}
```
插件文件放 `<项目>/.opencode/plugins/`。仅该项目生效。

### 方式 C：OPENCODE_CONFIG 环境变量

`OPENCODE_CONFIG=<配置路径>` 指向自建配置（含 plugin 声明）——适合 CI/隔离环境。

## 验证（已实测通过）

| 步骤 | 结果 |
|------|------|
| 插件加载（trash 工具对模型可见） | ✅ 模型列举工具时出现 trash |
| 模型拒绝永久删除（rm/Remove-Item） | ✅ 两次拒绝 + 建议 trash |
| 模型调用 trash 工具移入回收站 | ✅ `⚙ trash {path}` 执行成功 |
| Windows 回收站确认收到 | ✅ Shell.Application 0xA 列出该文件 |
| V2 加载（`opencode plugin list`） | ✅ 2026-09-22 真机 OpenCode **2.0.13** 显示 `agent-risk-guard` 加载成功 |

V1/V2 双入口的加载判定，可对着单源直接核（无需真机）：

```powershell
$p = 'scripts/opencode/agent-risk-guard.ts'
# V2 必须项：id + setup + 三个 ctx.*.hook
Select-String $p -Pattern 'id:\s*"agent-risk-guard"', 'async setup\(', 'ctx\.shell\.hook\("create\.before"', 'ctx\.tool\.hook\("execute\.before"', 'ctx\.permission\.hook\("evaluate"'
# V1 必须项：server 入口
Select-String $p -Pattern 'async function v1Server', 'export default \{ \.\.\.plugin, server: v1Server \}'
```

## 注意

- 拦截钩子按形态分工：V2 的 `ctx.shell.hook("create.before")` 是**硬闸门**（抛错阻断），
  `ctx.tool.hook("execute.before")` 是第二道（shell + guard 文件自保护）；V1 走
  `tool.execute.before`。两者都对 bash/Remove-Item 命令拒绝，模型看到
  `BLOCKED_BY_GLOBAL_SAFETY_GUARD` + 策略 + 原因。
- **安全警示**：若全局 `opencode.json` 中含明文 API key（如 `sk-...`、tavily/exa），
  建议改用环境变量/密钥管理器（本项目不代为修改生产配置）。