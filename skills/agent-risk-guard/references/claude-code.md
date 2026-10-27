# Claude Code：PreToolUse hook 拦截

机制：`settings.json` 的 `hooks.PreToolUse`（matcher Bash）→ 命令脚本读 stdin JSON → 命中黑名单输出 `permissionDecision: "deny"`。
官方文档：<https://code.claude.com/docs/en/hooks>（官方示例就是拦 `rm -rf`）。

## 配置文件

- 全局：`~/.claude/settings.json`
- 项目：`.claude/settings.json`（项目根）
- 脚本目录：`~/.claude/hooks/`

## 接线示例（settings.json）

```json
"hooks": {
  "PreToolUse": [
    {
      "matcher": "Bash|PowerShell",
      "hooks": [
        {
          "type": "command",
          "command": "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:/Users/<用户>/.claude/hooks/dangerous-commands.ps1",
          "timeout": 10
        }
      ]
    }
  ]
}
```

> ⚠️ 三条都是硬要求（2026-10-27 在 Claude Code 2.1.311 上实测，任一不满足都**静默 fail-open**）：
> 1. **matcher 必须覆盖 `PowerShell`**：Windows 上 shell 工具已不止 `Bash`，`git reset --hard` 这类调用会走
>    `PowerShell` 工具；只写 `Bash` 时它根本不进 hook（`--debug=hooks` 里一条 PreToolUse 都没有）。
> 2. **命令必须用正斜杠绝对路径**：hook 命令由 POSIX shell 派发，`C:\Users\...` 的反斜杠会被吃掉，
>    `-File` 收到 `C:UsersSatanchen...` → `exit 127`，判定被丢弃后命令照跑。
> 3. **hook 输出不得含 `updatedInput: null`**：2.1.311 的 JSON 校验要求该字段「若出现必须是 record」，
>    `null` 会让整条 deny 作废（debug 记 `Hook JSON output validation failed`）。省略即「不改写入参」。

## Hook 脚本要点（Windows PowerShell 版）

- 输入：stdin JSON `{"tool_name":"Bash","tool_input":{"command":"..."}}`；非 Bash 直接 `exit 0`。
- 输出：`{"hookSpecificOutput":{"permissionDecision":"deny"},"systemMessage":"..."}` 后 `exit 0`（0=已处理；脚本解析失败时也要 exit 0 放行，避免误伤所有命令）。
- **必须 UTF-8 with BOM**：PS 5.1 读无 BOM 的 UTF-8 会把中文按 GBK 解析导致字符串引号崩坏、整个脚本解析失败（实测坑）。
- 规则建议（"删除必须进回收站"铁律）：
  - PowerShell：`Remove-Item`、`del`、`erase`、`ri`、`rd`、`rmdir`、`rm`(命令位 `(^|[;&|])\s*rm\s+`)、`Clear-Content`、`[System.IO.(File|Directory)]::Delete`、实例 `.Delete(`；`Format-*`、`diskpart`、`Clear-Disk`
  - cmd/Git Bash：`del`、`erase`、`rm`、`rmdir`、`rd`、`unlink`、`shred`、`find -delete`（用 `\bfind\b[^|;&\n]*\s-delete\b`）、`find -exec rm`、`shutdown/reboot`
  - Python：`shutil.rmtree`、`os.remove/unlink/rmdir/removedirs`、`pathlib.Path.unlink/rmdir`
  - Node：`fs.rm/rmSync`、`fs.unlink/unlinkSync`、`fs.rmdir/rmdirSync`、fs-extra `remove`、`rimraf`
  - git：`git clean`、`git reset --hard`
  - 远程执行：`curl|bash` 管道、`Invoke-Expression`+下载、`chmod -R 777 /`、`reg delete`、`bcdedit /delete`

## 验证

**模拟 payload**（离线）：

```powershell
'{"tool_name":"Bash","tool_input":{"command":"Remove-Item test.txt"}}' |
  powershell -NoProfile -ExecutionPolicy Bypass -File ~/.claude/hooks/dangerous-commands.ps1
# 期望输出含 permissionDecision: deny；白名单命令（git status）无输出
```

**真实会话**（推荐带 debug，能直接看出 hook 有没有真的被调用）：

```powershell
claude -p "<让它执行 git reset --hard 的提示>" --permission-mode bypassPermissions `
  --output-format json --debug=hooks --debug-file .\cc-debug.txt
# 判读：cc-debug.txt 里必须出现 `PreToolUse:PowerShell [...] finished with status 0`；
# 只有 `status 127` 或完全没有 PreToolUse 行，都是「注册了但拦不住」= fail-open。
# 之后看 git status：脏改动仍在 → deny 生效。
```

## 陷阱

1. **cc-switch 类工具会回写 settings.json**（含 hooks）——改完让用户切一次 provider 复查，或把 hooks 加进配置管理器的模板。
2. **bypassPermissions 模式下 hook 仍触发**（hooks 独立于权限模式），但 deny 规则仍是唯一防线；`skipDangerousModePermissionPrompt: true` 时进入 bypass 无确认。
3. Windows 原生无沙箱（Bash sandbox 仅 macOS/Linux/WSL2）——hook 是 Windows 上的主要防线。
4. 别在测试命令里把黑名单词写进命令字面量（你自己的门禁会拦测试命令），用 payload 文件或独立脚本间接测。
5. **2026-08-24 本机实测**：`~/.claude/settings.json` 仅有 Setup hooks（开发服务启动），**未注册 PreToolUse 删除拦截**，且 `defaultMode: bypassPermissions`——审计时如发现同样情况属真实敞口，需补 PreToolUse hook 接线（见 `assets/claude-code/settings.hooks.json`）。
