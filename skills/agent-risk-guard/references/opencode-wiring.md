# OpenCode RiskGuard 接线指南（已实测，2026-08-24）

## 为什么需要接线

R17 实测发现：把插件文件放进 `~/.config/opencode/plugins/` **不会自动生效**——
opencode 1.18 要求插件在 `opencode.json` 的 `plugin` 数组里**显式声明**。
未声明时：插件文件存在但从未加载（R17 中哨兵曾被删除 = 无插件防护状态）。

## 接线步骤（三选一，前两者已验证）

### 方式 A：全局注册（推荐，所有项目生效）

1. 把 `scripts/opencode/destructive-operation-guard.ts`（27308B，R16 修复版）
   复制到 `~/.config/opencode/plugins/`（覆盖 08-22 旧版）。
2. 编辑 `~/.config/opencode/opencode.json`，在 `plugin` 数组加：
   ```json
   "plugin": [
     "@beremaran/opencode-goal",
     "./plugins/destructive-operation-guard.ts"
   ]
   ```
   （相对路径基于 `~/.config/opencode/`；或绝对路径亦可）
3. 重启 opencode 生效。

### 方式 B：项目级注册（隔离测试）

项目根放 `opencode.json`：
```json
{
  "plugin": ["./.opencode/plugins/destructive-operation-guard.ts"]
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

## 注意

- `tool.execute.before` 钩子对 bash/Remove-Item 命令用 `throw Error` 拒绝（模型看到
  `BLOCKED_BY_GLOBAL_SAFETY_GUARD` + 策略 + 原因）。
- **安全警示**：若全局 `opencode.json` 中含明文 API key（如 `sk-...`、tavily/exa），
  建议改用环境变量/密钥管理器（本项目不代为修改生产配置）。