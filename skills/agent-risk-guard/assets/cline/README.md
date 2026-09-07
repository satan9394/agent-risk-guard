# Cline 安全加固指南

## 文件说明

- `vscode-settings.json` — VS Code settings.json 中需合并的 Cline 安全配置段

## 加固步骤

### 1. 关闭 YOLO mode + 收紧 auto-approve

在 VS Code `settings.json`（`%APPDATA%\Code\User\settings.json`）中添加：

```json
{
  "cline.autoApprove.enabled": false,
  "cline.autoApprove.allowedTools": ["readFile", "listFiles", "searchFiles"],
  "cline.yoloMode": false
}
```

- `yoloMode: false` — 禁用全自动批准（最关键）
- `autoApprove.allowedTools` — 只允许只读工具自动批准，Bash 必须确认

### 2. 配置 PreToolUse Hook（需 Cline v3.36+）

#### 2a. 复制 hook 脚本

```powershell
# 创建 hooks 目录
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.cline\hooks"

# 复制通用 hook 脚本（路径按本机 Skill 安装位置调整；以下为默认示例）
Copy-Item "$env:USERPROFILE\.claude\skills\custom\agent-risk-guard-audit\scripts\dangerous-commands-universal.ps1" `
    "$env:USERPROFILE\.cline\hooks\dangerous-commands.ps1"
```

#### 2b. 在 VS Code settings.json 中注册 hook

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

> **注意**：`${workspaceFolder}` 是 Cline 的变量，指向当前工作区根目录。
> 如果 hook 脚本放在全局目录（`~/.cline/hooks/`），需用绝对路径替代。

### 3. 添加项目级规则（模型级，非强制）

在项目根目录创建 `.clinerules` 文件：

```
安全铁律：
- 删除文件/目录必须使用回收站（Windows: Microsoft.VisualBasic.FileIO.FileSystem::DeleteFile/DeleteDirectory 带 SendToRecycleBin）
- 禁止使用 Remove-Item、del、rm -rf、shutil.rmtree、fs.rmSync 等永久删除命令
- 所有删除操作必须经过用户确认
```

### 4. 验证

在 Cline 中执行：

```
Remove-Item test.txt    # 应被 hook 拒绝或弹确认
rm -rf /tmp/test        # 应被 hook 拒绝或弹确认
git status              # 应正常放行
```

## 局限

- Cline hooks 需 v3.36+，旧版无 hooks 系统
- `.clinerules` 只是模型级提示，可能被 prompt injection 绕过
- 必须配合 hooks 硬拦截才能确保安全
