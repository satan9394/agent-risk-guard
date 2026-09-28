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
- **真实会话（D3）：已取得（2026-09-28）。** 会话 `conversationId a051ea4d-f94d-4eb8-847a-431e8a3bb9b6`
  （证据三件入仓：`tasks/orchestrator/WORKBUDDY_D3_SESSION_20260928.md` 为会话自产复测报告，
  另两件为复现材料）：
  - **危险命令被拒**：`%TEMP%\riskguard-hook-calls.log` 里 `decision=deny` 两条——`shred`（06:00:52）、
    `Clear-Content`（06:01:56），均为「委派后仍拦」的不可逆操作（注意 05:59:29 另有一条「回收站清空族」
    deny，事后被证实是**误拦**，已登记 `docs/TODO.md` 已知过拦，不作正面证据）；
  - **安全命令放行**：python 分析脚本、`ls`、回收站 `$I*` 只读盘点等多条 `decision=allow`；
  - **委派链路端到端实证**：3 个 `rm` 经 `[delete-exempted:RG_ALLOW_DELETE]` 放行，随后盘点
    `D:\$Recycle.Bin` 的 `$I*` 元数据，7 个测试文件的原路径/大小/删除时间逐一吻合，**永久删除
    实际发生 0 起**——委派不仅放行了命令，而且删除确实改道进了回收站。

## 陷阱

1. **不要**手工去掉 `RG_ALLOW_DELETE=1` —— 会与平台 safe-delete 死锁（命令被拦且无法改道）。
2. 注册命令用**带引号的绝对解释器路径**：不加引号在部分 spawn 路径下会静默失效（同 agy 2026-09-13 的教训）。
3. `timeout` 别调太小：hook 内部还要再 spawn 一次规则引擎（可能再调 python3/grep），10–15s 起。
4. `~/.workbuddy/settings.json` 体积很大（大量非 RiskGuard 字段），merge 必须**保留用户全部字段**，只追加 `PreToolUse` 条目。
5. 卸载按 `id: riskguard-workbuddy-hook` / `_riskguard` marker 精确移除，**不碰**用户自己的 hook。
6. **hook 日志里 `[delete-exempted:RG_ALLOW_DELETE]` 才是委派生效的判据**（2026-09-28 会话实证）：
   `RG_ALLOW_DELETE` 由平台注入到 **hook 子进程**，在工作 shell 里 `echo $RG_ALLOW_DELETE` 是空的——
   shell 里查不到 ≠ 没生效。
7. **`Remove-Item` cmdlet 一路仍不可用，但拦它的不是本项目**：hook 已按委派放行（日志三条均
   `[delete-exempted]`），执行侧被**平台沙箱**拦下（`sandbox-center cmd decisionRecord missing actual
   resource subject`），疑似平台自身缺陷；同会话里 bash `rm` / Python `os.remove` / .NET `File::Delete`
   三路删除均可走通并进回收站。排障时先分清「hook 拦」还是「平台沙箱拦」。
8. **只读盘点回收站的 Python 命令可能被误拦**（`r'D:\$Recycle.Bin…'` 原始字符串去引号后 `r`+`D`
   拼成 `rD` 伪词撞 `rd` 动词边界）——已登记 `docs/TODO.md` 已知过拦，修复走独立一轮。
