# dangerous-commands-agy.ps1 — Antigravity CLI (agy) PreToolUse hook 适配器（v0.1）
# 复用同目录 dangerous-commands.ps1 的同一套 GAN 加固规则集；不改共享脚本，零风险给 CC/Codex。
# 输入：stdin agy 官方格式 { toolCall: { name, args: { CommandLine, Cwd } }, stepIdx, ... }
# 输出：stdout 顶层 JSON { decision: "allow"|"deny", reason? }（agy 官方 PreToolUse 输出格式）
# 退出码：恒 0（agy 要求 hook 恒 exit 0，决策放 stdout；非零退出视为 hook 失败/可能放行）
# 编码：UTF-8 with BOM（Windows PowerShell 5.1 必须）

param([string]$Cmd = '')

$ErrorActionPreference = 'Stop'
$shared = Join-Path $PSScriptRoot 'dangerous-commands.ps1'

function Emit-Allow {
    Write-Output (@{ decision = 'allow' } | ConvertTo-Json -Compress)
    exit 0
}
function Emit-Deny([string]$reason) {
    Write-Output (@{ decision = 'deny'; reason = "RiskGuard: $reason" } | ConvertTo-Json -Compress)
    exit 0
}

# ---- 取命令文本：-Cmd 测试模式（agy 格式）或 stdin ----
$cmdRaw = $null
if (-not [string]::IsNullOrWhiteSpace($Cmd)) {
    $cmdRaw = $Cmd
} else {
    try { $inputJson = [Console]::In.ReadToEnd() } catch { Emit-Deny 'stdin read error (fail-closed)' }
    if ([string]::IsNullOrWhiteSpace($inputJson)) { Emit-Allow }
    try { $data = $inputJson | ConvertFrom-Json } catch { Emit-Deny 'unparseable hook input (fail-closed)' }
    if ($data.toolCall -and $data.toolCall.args) {
        $cmdRaw = $data.toolCall.args.CommandLine
        if (-not $cmdRaw) { $cmdRaw = $data.toolCall.args.command }
    }
}
if ([string]::IsNullOrWhiteSpace($cmdRaw)) { Emit-Allow }

# ---- 转 CC 格式喂共享规则脚本（stdin） ----
$cc = @{ tool_name = 'Bash'; tool_input = @{ command = $cmdRaw } } | ConvertTo-Json -Compress
try {
    $out = ($cc | & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $shared 2>$null) -join "`n"
} catch {
    Emit-Deny 'rules engine error (fail-closed)'
}

if ([string]::IsNullOrWhiteSpace($out)) { Emit-Allow }

# ---- 解析共享脚本输出（CC 风格 JSON；deny → agy deny） ----
try {
    $r = $out | ConvertFrom-Json
    if ($r.hookSpecificOutput.permissionDecision -eq 'deny') {
        $reason = $r.hookSpecificOutput.permissionDecisionReason
        if (-not $reason) { $reason = 'dangerous command blocked by RiskGuard' }
        Emit-Deny $reason
    }
} catch { }
Emit-Allow
