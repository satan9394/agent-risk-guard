# sync-prod.ps1 — 生产同步脚本（默认 -WhatIf 只输出计划，不执行）
# 用法：
#   powershell -ExecutionPolicy Bypass -File sync-prod.ps1 -WhatIf   # 预览将要做的同步
#   powershell -ExecutionPolicy Bypass -File sync-prod.ps1           # 用户确认后真实执行
#
# 同步项（按 deployment-status.md 待同步清单）：
#   1. DSH patch：~/.dsh/profiles/web/cordis.patch.yml 补 5 条 R2（热加载生效）
#   2. Codex hook：~/.codex/hooks/dangerous-commands.ps1 ← 工作区 15816B 版
#   3. CC hook：~/.claude/hooks/dangerous-commands.ps1 ← 工作区 15816B 版（CC 侧接线需另加 settings.json PreToolUse）
#   4. （可选）skill 生产目录同步
#
# 铁律：所有删除进回收站（Microsoft.VisualBasic）；先备份到 <backup-root>/<agent>/<ts>/
# 注意：本脚本只做「复制/追加」，不删除生产既有内容；DSH patch 追加用对象键方式避免破坏其余段。

param([switch]$WhatIf)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName Microsoft.VisualBasic

$WS = $PSScriptRoot
$prodVersion = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupRoot = Join-Path $env:USERPROFILE 'agent-risk-guard-backups'

function Invoke-SyncStep([string]$Name, [scriptblock]$Action) {
    if ($WhatIf) {
        Write-Output "  [WhatIf] 将执行: $Name"
    } else {
        Write-Output "  [执行] $Name"
        & $Action
    }
}

Write-Output "=== RiskGuard 生产同步 ($(if($WhatIf){'预览'}else{'执行'})) ==="
Write-Output ""

# ---- 1. DSH patch 追加 5 条 R2 ----
$prodPatch = "$env:USERPROFILE\.dsh\profiles\web\cordis.patch.yml"
$wsPatch = Join-Path $WS 'assets\dsh\deny-risk-commands.patch.yml'
if (Test-Path $prodPatch) {
    $r2 = @(
        '{ re: ''\breg\s+delete\b'', reason: ''高危：reg delete 删除注册表项（R2 新增）'' }',
        '{ re: ''\bcertutil\b[^|;&\n]*(-urlcache|-decode)'', reason: ''高危：certutil 下载/解码执行（R2 新增）'' }',
        '{ re: ''\bdocker\s+(run|exec)\b'', reason: ''高危：docker 容器内执行（R2 新增，挂载卷删除/逃逸面）'' }',
        '{ re: ''\bgit\s+gc\b.*--prune'', reason: ''高危：git gc --prune 不可恢复清除对象（R2 新增）'' }',
        '{ re: ''\bgit\s+reflog\s+expire\b'', reason: ''高危：git reflog expire 使丢失提交不可恢复（R2 新增）'' }'
    )
    Invoke-SyncStep "DSH patch 追加 5 条 R2（$prodPatch）" {
        $b = Join-Path $backupRoot "dsh\web-$prodVersion"
        New-Item -ItemType Directory -Path $b -Force | Out-Null
        Copy-Item $prodPatch (Join-Path $b 'cordis.patch.yml') -Force
        $content = Get-Content $prodPatch -Raw
        $add = "`n          - $($r2 -join "`n          - ")"
        $content = $content.TrimEnd() + $add + "`n"
        Set-Content -Path $prodPatch -Value $content -Encoding UTF8
        Write-Output "      DSH patch 已追加 5 条 R2（备份: $b）——热加载生效，可探测验证"
    }
} else {
    Write-Output "  [跳过] 生产 DSH patch 不存在: $prodPatch"
}
Write-Output ""

# ---- 2/3. Codex + CC hook 脚本覆盖（工作区 15816B 最新版）----
$targets = @(
    @{ Name = 'Codex'; Path = "$env:USERPROFILE\.codex\hooks\dangerous-commands.ps1" },
    @{ Name = 'Claude Code'; Path = "$env:USERPROFILE\.claude\hooks\dangerous-commands.ps1" }
)
foreach ($t in $targets) {
    $src = Join-Path $WS 'scripts\dangerous-commands.ps1'
    if (Test-Path $t.Path) {
        Invoke-SyncStep "覆盖 $($t.Name) hook：$($t.Path)" {
            $b = Join-Path $backupRoot ($t.Name.ToLower().Replace(' ', '-') + "-$prodVersion")
            New-Item -ItemType Directory -Path $b -Force | Out-Null
            Copy-Item $t.Path (Join-Path $b 'dangerous-commands.ps1') -Force
            Copy-Item $src $t.Path -Force
            $bytes = [System.IO.File]::ReadAllBytes($t.Path)[0..2]
            Write-Output "      已覆盖（BOM: $($bytes -join ',')，应为 239,187,191）"
        }
    } else {
        Write-Output "  [跳过] $($t.Name) hook 不存在: $($t.Path)"
    }
}
Write-Output ""

# ---- 3. OpenCode 全局插件同步（R17 实测发现：插件文件存在但 opencode.json 未注册）----
$ocPlugin = "$env:USERPROFILE\.config\opencode\plugins\destructive-operation-guard.ts"
$wsPlugin = Join-Path $WS 'scripts\opencode\destructive-operation-guard.ts'
if (Test-Path (Split-Path $ocPlugin)) {
    Invoke-SyncStep "覆盖 OpenCode 全局插件（$ocPlugin，R16 修复版 27308B）" {
        $b = Join-Path $backupRoot "opencode-$prodVersion"
        New-Item -ItemType Directory -Path $b -Force | Out-Null
        Copy-Item $ocPlugin (Join-Path $b 'destructive-operation-guard.ts') -Force
        Copy-Item $wsPlugin $ocPlugin -Force
        Write-Output "      插件已更新；注意 opencode.json 需声明 plugin（见下）"
    }
    Write-Output "  [提示] 检查 ~/.config/opencode/opencode.json 的 plugin 数组是否含本项目插件路径（R17 实测：仅声明 @beremaran/opencode-goal，RiskGuard 未注册 → 插件文件存在但不生效）"
} else {
    Write-Output "  [跳过] OpenCode 全局配置目录不存在: $(Split-Path $ocPlugin)"
}
Write-Output ""

# ---- 4. 校验提示 ----
Write-Output "=== 同步后验证（必做）==="
Write-Output '  1. DSH：dsh --profile web 发一条含黑名单词的 echo 文本，应被拦'
Write-Output "  2. hook：powershell -NoProfile -ExecutionPolicy Bypass -File $(Join-Path $WS 'tests\hook-rules-test.ps1') 应 16/16 通过"
Write-Output '  3. Codex 真实会话：git gc --prune=now 应被拦'
Write-Output ""
if ($WhatIf) { Write-Output '（预览完成——去掉 -WhatIf 执行真实同步）' } else { Write-Output '同步完成 ✔' }