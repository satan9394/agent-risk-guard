# WorkBuddy (CodeBuddy Code 桌面版)：PreToolUse hook 拦截

机制：**Claude Code 兼容的 `PreToolUse` hook** —— 配置写在 `~/.workbuddy/settings.json` 的
`hooks.PreToolUse[]`，`hooks[].command` 在工具调用**前**执行；stdout 回 CC 风格
`{"hookSpecificOutput":{"permissionDecision":"deny"}}` 即拒绝（退出码 0；空 stdout = 放行）。
官方说明见 CodeBuddy / WorkBuddy 桌面版的设置面板（对应 `settings.json` 的 `hooks` 段）。

## 配置文件

- `~/.workbuddy/settings.json` —— `hooks.PreToolUse`（我方条目**必须**带 `RG_ALLOW_DELETE=1` 前缀）
- `~/.workbuddy/hooks/dangerous-commands.ps1` —— 规则引擎（与 claude / codex / agy **同一单源**）
- 同目录还有 `CODEBUDDY.md` / `SOUL.md` / `USER.md` —— 平台的规则与身份文件，**不是**拦截机制

## 接线示例（settings.json）

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "_riskguard": true,
        "id": "riskguard-workbuddy-hook",
        "matcher": "Bash|PowerShell",
        "hooks": [
          {
            "type": "command",
            "command": "RG_ALLOW_DELETE=1 \"C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe\" -NoProfile -ExecutionPolicy Bypass -File \"C:/Users/<you>/.workbuddy/hooks/dangerous-commands.ps1\"",
            "statusMessage": "RiskGuard: checking dangerous commands",
            "timeout": 15
          }
        ]
      }
    ]
  }
}
```

一键生成（同时把 ps1 单源复制到 `~/.workbuddy/hooks/`）：

```powershell
node bin/riskguard.mjs install --agent workbuddy
node bin/riskguard.mjs doctor      # 按委派模式做运行时自检
```

## 为什么必须带 `RG_ALLOW_DELETE=1`

WorkBuddy 自带 **safe-delete shim**（bash `safe-bin/{rm,rmdir,unlink}`、Node shim、Python
`sitecustomize.py`、覆写 PowerShell `Remove-Item`），会把删除**改道进回收站**。
若 hook 按默认模式拦下删除类命令，会两头落空：

1. 命令不执行 → shim 没机会改道；
2. hook 的 deny 文案建议的「VB 回收站」路径又被平台**硬编码黑名单**拦住
   （禁 `Add-Type` / `New-Object -ComObject` / `Reflection.Assembly::Load`），且无配置开关。

所以 WorkBuddy 上的正确姿势是**委派**：把「永久删除」类拦截让给下游 shim，hook 只拦**不可逆**操作 ——
`rm -rf /`、系统目录、`shred`、`wmic shadowcopy`、回收站清空族
（`Clear-RecycleBin` / `cleanmgr` / 直接删 `$Recycle.Bin`）；`Clear-Content` 显式排除。

## 验证

- **自动化（本仓 `tests/adapter/workbuddy-injection.test.ts`，D2 证据）**
  - 注入形状：`RG_ALLOW_DELETE=1` 前缀 + `-File <home>/.workbuddy/hooks/dangerous-commands.ps1`、幂等、按独立 marker 精确卸载；
  - 委派矩阵（**真 spawn**）：无害 → allow、`Remove-Item` → allow（已委派）、`git reset --hard` → deny、`rm -rf /` → deny。
- **运行时自检**：`node bin/riskguard.mjs doctor` / `status` —— `deep` 时按委派模式跑上述三条断言
  （若删除类仍被拦，说明前缀没生效 → 报 FAIL 并提示，不静默放过）。
- **真实会话（D3）：尚未取得。** 2026-09-21 有过一次真实会话并暴露了五处问题（已修复），但那次早于
  R18 规则，**不作** D3 依据。要升 D3，需要真实会话里「一条危险命令被拒 + 一条安全命令放行」的原始输出。

## 陷阱

1. **不要**手工去掉 `RG_ALLOW_DELETE=1` —— 会与平台 safe-delete 死锁（命令被拦且无法改道）。
2. 注册命令用**带引号的绝对解释器路径**：不加引号在部分 spawn 路径下会静默失效（同 agy 2026-09-13 的教训）。
3. `timeout` 别调太小：hook 内部还要再 spawn 一次规则引擎（可能再调 python3/grep），10–15s 起。
4. `~/.workbuddy/settings.json` 体积很大（大量非 RiskGuard 字段），merge 必须**保留用户全部字段**，只追加 `PreToolUse` 条目。
5. 卸载按 `id: riskguard-workbuddy-hook` / `_riskguard` marker 精确移除，**不碰**用户自己的 hook。
