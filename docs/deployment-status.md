# RiskGuard 生产部署现状核对（Round 8，2026-08-24）

> 铁律：开发产物只在工作区；生产目录改动待用户确认。
> 本文件记录「生产实际接线」与「工作区单源」的差距，作为同步清单依据。

> ## ⚠️ 本文是 2026-08-24 的**时点快照**，其中多条结论**已经过期**（2026-09-13 加注更正）
>
> 本文保留原文不改，作为历史证据。**不要把下面的结论当作现状**。至少以下几条已经变化：
>
> - **「Claude Code 实际没有删除拦截」已不再成立**：`~/.claude/settings.json` 的 `PreToolUse`
>   （matcher `Bash` → `~/.claude/hooks/dangerous-commands.ps1`）已接线，危险载荷实测被 deny；
>   2026-09-13 复核时仍在位。
>   ——但它**丢失过一次**（settings.json 只剩 `Setup`），而当时 hook 脚本在位、哈希正确、套件全绿。
>   这就是"看起来在、其实不在"。**任何"已接线"的结论都必须现场实测，不能引用本文或任何旧文档。**
> - **生产 hook 脚本已多次升级**：本文引用的 6899B / 7425B 等字节数为**当时值**。当前单源
>   `dangerous-commands.ps1` = `0DFDCD5596F76827` / 44327 B / BOM=True，**ps1 ×7 份同哈希**（含 xhs 树）；
>   `dangerous-commands.sh` = `A809CCFB9311F0EC` / 51754 B，**sh ×3 份同哈希**。
> - **Codex 不再是「唯一真实生效」**：OpenCode / DSH / AGY 都有真实会话 D3 证据。
>   注意 **DSH 的保护来自 `deny-risk-commands` 规则补丁（正则层），不是 `@riskguard/dsh` 插件**
>   （插件已实现且有测试，但未接进任何 profile）——README 支持矩阵已注明。
> - **回归套件已补齐**：`hook-bypass-regression` / `hook-redact-test` / `sh-failclosed-test` 等已在 CI 与本地运行器里。
>
> **当前权威状态（按此为准，不按本文）**：
> `README.md` 的支持矩阵 → `packages/installer/compatibility.json`（D 级单一事实源）
> → 本机实际接线用只读巡检复核：`pwsh -File scripts/riskguard-wiring-check.ps1`（缺失/漂移时退出码非 0）。
> 各版本"出了什么问题、改了什么"见 [`docs/release-notes/`](release-notes/)。

## 已确认的生产接线

| Agent | 接线点 | 状态 | 证据 |
|-------|--------|------|------|
| **Codex** | `~/.codex/hooks.json` → PreToolUse → `~/.codex/hooks/dangerous-commands.ps1` | ✅ 已注册且**真实生效** | `hook-calls.log`：2026-08-23 22:06:36 `decision=deny (rm -rf)` |
| **Claude Code** | `~/.claude/settings.json` | ⚠️ **仅 Setup hooks（开发服务启动），无 PreToolUse 删除拦截**；`defaultMode: bypassPermissions` | settings.json 实测 |
| **CC 侧 hook 脚本** | `~/.claude/hooks/dangerous-commands.ps1`（6899B） | ⚠️ 存在但**未接线**；且为 08-23 版（无 R2） | SHA 与工作区不一致 |
| **Codex 侧 hook 脚本** | `~/.codex/hooks/dangerous-commands.ps1`（7425B） | ⚠️ 08-23 版（无 R2、无 BOM 修复） | SHA 与工作区不一致 |

## 关键结论

1. **Codex 是当前唯一真实生效的删除拦截**（hook 调用 + deny 记录双重实锤）。
2. **Claude Code 实际没有删除拦截**——`bypassPermissions` + 无 PreToolUse hook，Bash 删除命令直接执行。这是真实风险敞口。
3. **生产 hook 脚本落后于工作区单源**：工作区 = 生产基线 + R2 五向量（certutil/docker/gc/reflog/reg delete）+ BOM 修复，两处生产脚本均缺 R2。

## 待同步清单（用户确认后执行）

> 一键工具：`agent-risk-guard-audit/sync-prod.ps1`（默认 `-WhatIf` 预览；确认后去参执行；
> 内含备份到 `~/.risk-guard-backup/<agent>/<ts>/`，遵循回收站铁律）。

- [ ] **DSH patch（最高优先，热加载即生效）**：`~/.dsh/profiles/web/cordis.patch.yml` ← 工作区 `assets/dsh/deny-risk-commands.patch.yml`——生产 30 条缺 **5 条 R2**（2026-08-24 逐条 diff 实证）：
  ```
  \breg\s+delete\b
  \bcertutil\b[^|;&\n]*(-urlcache|-decode)
  \bdocker\s+(run|exec)\b
  \bgit\s+gc\b.*--prune
  \bgit\s+reflog\s+expire\b
  ```
  改完热加载生效（2026-08 实测，无需重启 dsh web）；改后用无害探测命令（含新黑名单词的 echo 文本）验证。
- [ ] `~/.codex/hooks/dangerous-commands.ps1` ← 工作区 `agent-risk-guard-audit/scripts/dangerous-commands.ps1`（**15816B**，含 R2 + R4 + BOM + 误伤修复）
- [ ] `~/.claude/hooks/dangerous-commands.ps1` ← 同上
- [ ] `~/.claude/settings.json`：hooks.PreToolUse 注册 Bash 拦截（参照 skill 的 `assets/claude-code/settings.hooks.json`）；如需收紧可评估 `defaultMode` 调整
- [ ] skill 生产目录 `~/.claude/skills/custom/agent-risk-guard-audit/` 同步（脚本 patch 均已在工作区更新）

## 工作区脚本演进（2026-08-24）

| 版本 | 内容 | 状态 |
|------|------|------|
| 08-23 生产基线（192 行） | rm -rf 根/sys 专项、log 审计 | 生产在用（缺 R2） |
| Round 7 工作区 | 基线 + R2 五向量 + BOM | 16/16 通过 |
| Round 8 初版（9420B） | + POSIX 删除类补充（unlink/shred/find -delete/+exec rm/xargs/for）+ 引号插词防护 | 绕过探针 14/14，但**误伤 echo 字符串/注释** |
| **Round 9 终版（14828B）** | **GAN 三轮闭环（4/10→7/10→修复）**：git switch -C/worktree/wmic 新缺口封堵、force-with-lease 误拦修复、规则 9/13/33 用 $cmdTest（echo 误伤修复）；**sh 版同步全规则（WSL 50/50）** | reregress 32/32 + sh 50/50；hook-rules 16 + bypass 14 + FP 5；**19 组全绿** |

## GAN hook 审查（2026-08-24）

报告：`agent-risk-guard-audit/tests/HOOK-AUDIT-REPORT.md`（第一轮 318 行）+ `HOOK-AUDIT-ROUND3.md`（复评 422 行）
评分轨迹：**4/10 → 7/10**（复评确认 12/15 P0、4/7 P1 修复）
R3 复评后修复：git switch -C、git worktree remove --force、wmic shadowcopy delete、force-with-lease 误拦、规则 9/13/33 cmdTest 化
诚实保留（正则局限）：变量展开（R=m; $R）、npm cache clean（低风险）、rm 独参（无害）、python print 字符串（需 AST）

## 同步命令模板（铁律：回收站删旧 → Copy-Item 工作区 → 校验 BOM）

```powershell
# 1. 备份并回收旧版（回收站，非永久删）
Add-Type -AssemblyName Microsoft.VisualBasic
[Microsoft.VisualBasic.FileIO.FileSystem]::CopyFile($old,$backup)  # 先备份
[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($old,'OnlyErrorDialogs','SendToRecycleBin')
# 2. 覆盖为工作区版（含 BOM）
Copy-Item $workspaceScript $target -Force
# 3. 校验 BOM 与哈希
$b=[System.IO.File]::ReadAllBytes($target)[0..2]; $b -join ','  # 应为 239,187,191
```

## 验证方法（已固化）

`agent-risk-guard-audit/tests/hook-rules-test.ps1`：16 条用例（10 deny + 6 allow）经
RedirectStandardInput 喂真实脚本，16/16 通过；已纳入 test-all.ps1（D3 real 组）。
同步完成后对生产脚本再跑一次该测试确认生效。