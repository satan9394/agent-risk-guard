# Amp / Roo Code：sandbox + auto-approve

## Amp（Sourcegraph）

机制：sandbox 模式 + 权限系统，支持配置拒绝规则。
文档：<https://ampcode.com/docs>

### 配置文件

- 全局：`~/.amp/config.json`
- 项目：`.amp/`（规则）+ `amp.config.json`（项目级设置）

### 权限配置

```json
{
  "permissions": {
    "bash": {
      "deny": ["Remove-Item*", "rm -rf*", "del /f*", "shutil.rmtree*", "os.remove*"]
    }
  }
}
```

### Sandbox 模式

Amp 支持 sandbox 模式（文件系统隔离），可限制命令执行范围：

```json
{
  "sandbox": {
    "enabled": true,
    "mode": "workspace-write"
  }
}
```

### 加固建议

1. **启用 sandbox**：`sandbox.mode: "workspace-write"`
2. **设置 permissions.deny**：拒绝删除类命令
3. 查 auto-approve 范围，收紧 Bash 自动批准

### 验证

让 Amp 执行 `Remove-Item` → 应被权限系统拒绝。

---

## Roo Code（VS Code 扩展）

机制：auto-approve 设置 + hooks（部分支持），VS Code 扩展。
文档：<https://docs.roocode.com/features/auto-approving-actions>

### 配置文件

- VS Code 设置：`settings.json` → `roo.*`
- 项目规则：`.roo/rules/`

### Auto-approve 设置

| 设置 | 说明 | 安全建议 |
|------|------|---------|
| `roo.autoApprove.enabled` | 启用自动批准 | ❌ 关闭 |
| `roo.autoApprove.allowedTools` | 允许自动批准的工具列表 | 只允许 Read/Glob/Grep |
| `roo.yoloMode` | 全自动批准所有工具 | ❌ 禁用 |

### 加固建议

1. **关闭 YOLO mode**
2. **收紧 auto-approve**：只允许 Read/Glob/Grep
3. `.roo/rules/` 写"删除必须进回收站"（模型级，非强制）

### 验证

让 Roo Code 执行 `Remove-Item` → 应弹确认或被拒绝。

---

## 共同验证

| 测试命令 | 期望 | 说明 |
|---------|------|------|
| `Remove-Item test.txt` | 被拦 | PowerShell 删除 |
| `rm -rf /tmp/test` | 被拦 | POSIX 删除 |
| `git status` | 放行 | 白名单 |

## 陷阱

- Amp sandbox 模式可能不支持 Windows（需确认）。
- Roo Code hooks 支持有限，主要靠 auto-approve 收紧。
- 两者都是 VS Code 扩展，配置通过 VS Code settings.json。
