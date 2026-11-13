# Devin CLI / Devin Desktop ("Devin Local", the successor of Windsurf's Cascade agent) adapter
# Wired by riskguard-wiring-check.ps1 (2026-11-13); no D3 yet because Devin auth is required.
#
# Official contract (docs.devin.ai/cli/extensibility/hooks/overview.md):
#   hooks file:  <project>/.devin/hooks.v1.json  |  %APPDATA%\devin\config.json ("hooks" key)
#   matcher:     regex against tool_name; the shell tool is "exec"
#   stdin:       { hook_event_name, tool_name, tool_input: { command }, session_id, prompt_id }
#   block:       exit 2, or stdout {"decision":"block","reason":"..."}
#   other exits: logged, do NOT block (so a crash is fail-open; this adapter always answers)
#
# Rules stay in the one shared engine (dangerous-commands.ps1 next to this file, or RG_ENGINE_PS1).

param([string]$Engine = '')

$ErrorActionPreference = 'Stop'
$log = Join-Path $env:TEMP 'riskguard-devin-hook.log'
$script:toolName = ''

function Write-GateLog([string]$decision, [string]$reason) {
    try {
        $line = '{0}  decision={1} tool={2} reason={3}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $decision, $script:toolName, $reason
        Add-Content -LiteralPath $log -Value $line -Encoding UTF8
    } catch { }
}

function Deny([string]$message) {
    Write-GateLog 'deny' $message
    @{ decision = 'block'; reason = "RiskGuard: $message" } | ConvertTo-Json -Compress
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
$text = [System.Text.Encoding]::UTF8.GetString($bytes).TrimStart([char]0xFEFF)

try {
    $data = $text | ConvertFrom-Json -ErrorAction Stop
} catch {
    Deny 'hook input is not valid JSON (fail-closed)'
}

$tool = [string]$data.tool_name
if ([string]::IsNullOrWhiteSpace($tool)) { $tool = [string]$data.toolName }
$script:toolName = $tool

$toolInputData = $data.tool_input
if ($null -eq $toolInputData) { $toolInputData = $data.toolInput }
$cmd = [string]$toolInputData.command

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
