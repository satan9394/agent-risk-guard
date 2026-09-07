# Cline / Qwen Code：hooks + auto-approve 规则

## Cline（v3.36+ hooks 系统）

机制：VS Code 扩展，v3.36 引入 hooks 系统（PreToolUse/PostToolUse/UserPromptSubmit），支持 bash 脚本拦截。
文档：<https://cline.bot/blog/cline-v3-36-hooks>

### 配置文件

- VS Code 设置：`settings.json` → `cline.*`
- 项目规则：`.clinerules` / `.clinerules/`（模型级，非强制）
- Hooks：VS Code 设置 → `cline.hooks`

### Hooks 配置格式

```json
{
  "cline.hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "command": "powershell -NoProfile -ExecutionPolicy Bypass -File \"${workspaceFolder}/.cline/hooks/dangerous-commands.ps1\"",
        "timeout": 10
      }
    ]
  }
}
```

### Auto-approve 设置

| 设置 | 说明 | 安全建议 |
|------|------|---------|
| `cline.autoApprove.enabled` | 启用自动批准 | ❌ 关闭 |
| `cline.autoApprove.allowedTools` | 允许自动批准的工具列表 | 只允许 Read/Glob/Grep |
| `cline.yoloMode` | 全自动批准所有工具 | ❌ 禁用（等效 bypassPermissions） |

### 加固建议

1. **关闭 YOLO mode**（`cline.yoloMode: false`）
2. **收紧 auto-approve**：只允许 Read/Glob/Grep，Bash 保持需确认
3. **配置 PreToolUse hook**：复用 `dangerous-commands-universal.ps1`
4. `.clinerules` 写"删除必须进回收站"（模型级，非强制）

### 验证

让 Cline 执行 `Remove-Item` 测试文件 → 应被 hook 拒绝或弹确认。

---

## Qwen Code（hooks 系统，PR #1988）

机制：hooks 系统（PreToolUse/PostToolUse），支持 bash 脚本拦截。
文档：<https://qwenlm.github.io/qwen-code-docs/en/users/features/hooks/>

### 配置文件

- 全局：`~/.config/qwen-code/settings.json`
- 项目：`.qwen/`（规则）+ `.qwen/settings.json`（项目级设置）

### Hooks 配置格式

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "command": "powershell -NoProfile -ExecutionPolicy Bypass -File \"$HOME/.config/qwen-code/hooks/dangerous-commands.ps1\"",
        "timeout": 10
      }
    ]
  }
}
```

### Permissions 系统

Qwen Code 支持 `permissions` 配置（ask/allow/deny），可 deny 高危命令：

```json
{
  "permissions": {
    "bash": {
      "deny": ["Remove-Item*", "rm -rf*", "del /f*"]
    }
  }
}
```

### 加固建议

1. **配置 PreToolUse hook**：复用 `dangerous-commands-universal.ps1`
2. **设置 permissions.deny**：拒绝删除类命令
3. `.qwen/rules/` 写"删除必须进回收站"（模型级）

### 验证

让 Qwen Code 执行 `Remove-Item` → 应被 hook 拒绝。

---

## 共同验证

| 测试命令 | 期望 | 说明 |
|---------|------|------|
| `Remove-Item test.txt` | 被拦 | PowerShell 删除 |
| `rm -rf /tmp/test` | 被拦 | POSIX 删除 |
| `git status` | 放行 | 白名单 |
| `ls -la` | 放行 | 白名单 |

## 陷阱

- `.clinerules` / `.qwen/rules/` 只是模型级提示，模型可能不遵守（尤其 prompt injection 时）——必须配合 hooks 硬拦截。
- YOLO/全自动模式是最大的"裸奔"信号。
- Cline hooks 需 v3.36+，旧版无 hooks 系统。
