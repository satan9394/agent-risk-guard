# Windsurf / Zed / Warp：rules + permissions（有限拦截）

## Windsurf

机制：**无 hooks、无权限系统**，主要靠**规则文件**（模型级提示）+ ignore 文件（保护敏感路径）。
配置：`.windsurfrules`（项目）+ 全局 rules + `.codeiumignore`

### 配置文件

- 项目：`.windsurfrules`（规则）
- 全局：`~/.codeium/windsurf/memories/global_rules.md`
- ignore：`.codeiumignore`

### 加固建议

1. `.windsurfrules` 写"删除必须进回收站"（模型级，非强制）
2. `.codeiumignore` 覆盖敏感路径（`.env`、密钥、`~/.ssh`）
3. **无法机器级拦截**——只能靠规则提示 + ignore 保护
4. 补充防线：外部包装（容器）、关键路径 ignore

### 验证

rules 类只能靠"让模型执行删除命令，看它是否遵守规则"——**不遵守不算 bug**（prompt injection 可绕过）。

### 局限

Windsurf 无 hooks、无权限系统（rulesync 表无 hooks/permissions）→ 只能 rules 提示 + ignore 保护，**无法机器级拦截**。

---

## Zed

机制：**permissions 系统**（ask/allow/deny），无 hooks。
配置：项目设置

### 权限配置

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

1. **设置 permissions.deny**：拒绝删除类命令
2. 查 auto-approve 范围，收紧 Bash 自动批准
3. **无 hooks**——权限系统是唯一防线

### 验证

让 Zed 执行 `Remove-Item` → 应被权限系统拒绝。

---

## Warp

机制：**permissions 系统**（ask/allow/deny），无 hooks。
配置：项目设置

### 权限配置

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

1. **设置 permissions.deny**：拒绝删除类命令
2. 查 auto-approve 范围，收紧 Bash 自动批准
3. **无 hooks**——权限系统是唯一防线

### 验证

让 Warp 执行 `Remove-Item` → 应被权限系统拒绝。

---

## 共同验证

| 测试命令 | 期望 | 说明 |
|---------|------|------|
| `Remove-Item test.txt` | 被拦 | PowerShell 删除 |
| `rm -rf /tmp/test` | 被拦 | POSIX 删除 |
| `git status` | 放行 | 白名单 |

## 陷阱

- Windsurf 只能靠规则提示，无法机器级拦截。
- Zed/Warp 有 permissions 但无 hooks，拦截能力有限。
- 三者都是 VS Code 类或独立终端，配置通过各自设置界面。
