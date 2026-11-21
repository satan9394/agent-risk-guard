# Cursor preToolUse adapter (2026-11-11)
#
# Cursor's preToolUse speaks its own protocol, not Claude's:
#   deny -> stdout {"permission":"deny","agent_message":"..."} and exit 0
# Shell events carry { tool_name: "Shell", tool_input: { command } };
# the native Delete tool carries { tool_name: "Delete", tool_input: { file_path } }.
#
# Rules stay in the one shared engine (dangerous-commands.ps1 next to this file,
# or RG_ENGINE_PS1). This adapter only translates payloads and decisions:
#   - Delete: denied. A native tool cannot route to the recycle bin, and the
#     deletion rule says permanent deletion is forbidden.
#   - Shell: run the shared engine and translate its Claude-shaped deny.
# Anything unreadable is denied (fail-closed) instead of letting a tool run.

param([string]$Engine = '')

$ErrorActionPreference = 'Stop'
$log = Join-Path $env:TEMP 'riskguard-hook-calls.log'

function Write-GateLog([string]$decision, [string]$reason) {
    try {
        $line = '{0}  [HookInvoked] decision={1} reason={2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $decision, $reason
        Add-Content -LiteralPath $log -Value $line -Encoding UTF8
    } catch { }
}

function Deny([string]$message) {
    Write-GateLog 'deny' $message
    @{ permission = 'deny'; agent_message = "RiskGuard: $message" } | ConvertTo-Json -Compress
    exit 0
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
if ($tool -eq 'Delete') {
    Deny 'the native Delete tool cannot use the recycle bin; delete through a shell command that sends the file to the recycle bin'
}
if ($tool -notmatch '^(Shell|Bash)$') {
    exit 0
}

$cmd = [string]$data.tool_input.command
if ([string]::IsNullOrWhiteSpace($cmd)) {
    Deny 'shell call has no command (fail-closed)'
}

if (-not $Engine) { $Engine = Join-Path $PSScriptRoot 'dangerous-commands.ps1' }
if (-not (Test-Path -LiteralPath $Engine)) {
    Deny "rules engine not found: $Engine"
}

$psExe = Join-Path $PSHOME 'powershell.exe'
$payload = @{ tool_name = 'Bash'; tool_input = @{ command = $cmd } } | ConvertTo-Json -Compress
$engineOut = $null
try {
    $engineOut = $payload | & $psExe -NoProfile -ExecutionPolicy Bypass -File $Engine 2>$null
} catch {
    Deny 'rules engine failed (fail-closed)'
}

$decision = $null
$reason = 'blocked by RiskGuard'
try {
    $parsed = ($engineOut | Out-String) | ConvertFrom-Json -ErrorAction Stop
    if ($parsed.hookSpecificOutput) {
        $decision = [string]$parsed.hookSpecificOutput.permissionDecision
        if ($parsed.hookSpecificOutput.permissionDecisionReason) {
            $reason = [string]$parsed.hookSpecificOutput.permissionDecisionReason
        }
    }
} catch {
    Deny 'rules engine returned no decision (fail-closed)'
}

if ($decision -eq 'deny') { Deny $reason }
Write-GateLog 'allow' $cmd
exit 0
