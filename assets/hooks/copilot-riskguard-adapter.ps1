# Copilot CLI preToolUse adapter (2026-11-12)
#
# Copilot CLI's preToolUse speaks its own decision protocol, not Claude's:
#   deny -> stdout {"permissionDecision":"deny","permissionDecisionReason":"..."}
#   (a non-zero exit, incl. 2, also denies; command preToolUse is fail-closed on errors)
# PascalCase "PreToolUse" gets the VS Code compatible payload:
#   { hook_event_name, session_id, cwd, tool_name: "Bash", tool_input: { command } }
# Runtime tools map to Claude names: bash/powershell -> Bash, create -> Write, edit -> Edit.
#
# Rules stay in the one shared engine (dangerous-commands.ps1, or RG_ENGINE_PS1).
# This adapter only translates payloads and decisions; anything unreadable is denied.

param([string]$Engine = '')

$ErrorActionPreference = 'Stop'
$log = Join-Path $env:TEMP 'riskguard-copilot-hook.log'

function Write-GateLog([string]$decision, [string]$reason) {
    try {
        $line = '{0}  [HookInvoked] decision={1} reason={2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $decision, $reason
        Add-Content -LiteralPath $log -Value $line -Encoding UTF8
    } catch { }
}

function Deny([string]$message) {
    Write-GateLog 'deny' $message
    @{ permissionDecision = 'deny'; permissionDecisionReason = "RiskGuard: $message" } | ConvertTo-Json -Compress
    exit 2
}

$ms = New-Object System.IO.MemoryStream
try {
    [Console]::OpenStandardInput().CopyTo($ms)
} catch {
    Deny 'cannot read hook input (fail-closed)'
}
$bytes = $ms.ToArray()
if ($bytes.Length -eq 0) { Deny 'empty hook input (fail-closed)' }
$text = [System.Text.Encoding]::UTF8.GetString($bytes)

try {
    $data = $text | ConvertFrom-Json -ErrorAction Stop
} catch {
    Deny 'hook input is not valid JSON (fail-closed)'
}

$tool = [string]$data.tool_name
$cmd = [string]$data.tool_input.command

# Only shell surfaces are gated here; other tools pass through unchanged.
if ([string]::IsNullOrWhiteSpace($cmd)) {
    Write-GateLog 'allow' "non-shell tool: $tool"
    '{}'
    exit 0
}

if (-not $Engine) { $Engine = Join-Path $PSScriptRoot 'dangerous-commands.ps1' }
if (-not (Test-Path -LiteralPath $Engine)) {
    Deny "rules engine not found: $Engine"
}

$hostExe = (Get-Process -Id $PID).Path
$payload = @{ tool_name = 'Bash'; tool_input = @{ command = $cmd } } | ConvertTo-Json -Compress
# The engine emits UTF-8 with Chinese text; decode the child pipe as UTF-8 rather than
# inheriting the console code page (GBK here), which used to break ConvertFrom-Json.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$engineOut = $null
try {
    $engineOut = ($payload | & $hostExe -NoProfile -ExecutionPolicy Bypass -File $Engine 2>$null | Out-String).Trim()
} catch {
    Deny 'rules engine failed (fail-closed)'
}

$decision = $null
$reason = 'blocked by RiskGuard'
try {
    $parsed = $engineOut | ConvertFrom-Json -ErrorAction Stop
    if ($parsed.hookSpecificOutput) {
        $decision = [string]$parsed.hookSpecificOutput.permissionDecision
        if ($parsed.hookSpecificOutput.permissionDecisionReason) {
            $reason = [string]$parsed.hookSpecificOutput.permissionDecisionReason
        }
    }
} catch {
    # Fail-closed: the engine prints JSON only when it denies, so any unparseable
    # non-empty output is still a denial — keep its text as the reason for the agent.
    if ([string]::IsNullOrWhiteSpace($engineOut)) {
        Write-GateLog 'allow' $cmd
        '{}'
        exit 0
    }
    Deny ("rules engine output not parseable (fail-closed): " + $engineOut)
}

if ($decision -eq 'deny') { Deny $reason }
Write-GateLog 'allow' $cmd
'{}'
exit 0
