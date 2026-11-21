# Grok Build (xAI) PreToolUse adapter (2026-11-13)
#
# Grok Build reads personal hooks from ~/.grok/hooks/*.json and speaks its own decision
# protocol (docs.x.ai/build/features/hooks):
#   deny  -> stdout {"decision":"deny","reason":"..."}  AND exit 2
#   allow -> exit 0 (stdout ignored)
#   crash / timeout / malformed output -> fail-OPEN, so this adapter must always answer.
# Payload on stdin is camelCase: { hookEventName, sessionId, cwd, workspaceRoot, toolName, toolInput }
# (snake_case is accepted too, so the same file also works for Claude-shaped payloads.)
#
# IMPORTANT: do not name the parsed payload `$input` — PowerShell's automatic $input
# variable makes the host consume stdin first, leaving 0 bytes here and producing a
# fail-closed deny on every call (found 2026-11-13). It is `$toolInputData` below.
#
# Rules stay in the one shared engine (dangerous-commands.ps1 next to this file, or RG_ENGINE_PS1).
# This adapter only translates payloads and decisions.

param([string]$Engine = '')

$ErrorActionPreference = 'Stop'
$log = Join-Path $env:TEMP 'riskguard-grok-hook.log'

function Write-GateLog([string]$decision, [string]$reason) {
    try {
        $line = '{0}  decision={1} tool={2} reason={3}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $decision, $script:toolName, $reason
        Add-Content -LiteralPath $log -Value $line -Encoding UTF8
    } catch { }
}

function Deny([string]$message) {
    Write-GateLog 'deny' $message
    @{ decision = 'deny'; reason = "RiskGuard: $message" } | ConvertTo-Json -Compress
    exit 2
}

$script:toolName = ''

$ms = New-Object System.IO.MemoryStream
try {
    [Console]::OpenStandardInput().CopyTo($ms)
} catch {
    Deny 'cannot read hook input (fail-closed)'
}
$bytes = $ms.ToArray()
if ($bytes.Length -eq 0) { Deny 'empty hook input (fail-closed)' }
$text = [System.Text.Encoding]::UTF8.GetString($bytes).TrimStart([char]0xFEFF)

try {
    $data = $text | ConvertFrom-Json -ErrorAction Stop
} catch {
    Deny 'hook input is not valid JSON (fail-closed)'
}

$tool = [string]$data.toolName
if ([string]::IsNullOrWhiteSpace($tool)) { $tool = [string]$data.tool_name }
$script:toolName = $tool

$toolInputData = $data.toolInput
if ($null -eq $toolInputData) { $toolInputData = $data.tool_input }
$cmd = [string]$toolInputData.command

# Non-shell tools (Read / Edit / Write / MCP ...) carry no command and pass through unchanged.
if ([string]::IsNullOrWhiteSpace($cmd)) {
    Write-GateLog 'allow' 'non-shell tool'
    '{}'
    exit 0
}

if (-not $Engine) {
    if ($env:RG_ENGINE_PS1) { $Engine = $env:RG_ENGINE_PS1 } else { $Engine = Join-Path $PSScriptRoot 'dangerous-commands.ps1' }
}
if (-not (Test-Path -LiteralPath $Engine)) {
    Deny "rules engine not found: $Engine"
}

# The shared engine reads Claude-shaped snake_case JSON with tool_name in its shell whitelist.
$hostExe = (Get-Process -Id $PID).Path
$payload = @{ tool_name = 'Bash'; tool_input = @{ command = $cmd } } | ConvertTo-Json -Compress
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
    # The engine prints JSON only when it denies; any unparseable non-empty output is a denial.
    if ([string]::IsNullOrWhiteSpace($engineOut)) {
        Write-GateLog 'allow' $cmd
        '{}'
        exit 0
    }
    Deny ('rules engine output not parseable (fail-closed): ' + $engineOut)
}

if ($decision -eq 'deny') { Deny $reason }
Write-GateLog 'allow' $cmd
'{}'
exit 0
