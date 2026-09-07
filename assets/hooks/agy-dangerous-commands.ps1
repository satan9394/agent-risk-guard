# agy-dangerous-commands.ps1 — Antigravity CLI (agy) PreToolUse hook 适配器（v0.2，BOM + fail-closed 加固）
# 复用 codex 的 dangerous-commands.ps1 规则集（单一规则源，跨 agent 同步），
# 把 Antigravity 的 hook 协议翻译成该脚本能识别的格式。
# 编码：UTF-8 with BOM（Windows PowerShell 5.1 必须；无 BOM 时 5.1 按 ANSI 解析中文会崩）
#
# 输入（stdin，protojson camelCase）：
#   { "toolCall": { "name": "run_command", "args": { "CommandLine": "..." } }, ... }
# 输出（stdout）：
#   { "decision": "allow" | "deny", "reason": "..." }
# 退出码：0（钩子只输出决策，不抛错；agy 要求恒 exit 0）
#
# 失败策略（fail-closed，防守卫静默消失 = 用户 2026-09-06 遇到的问题）：
#   - 规则脚本缺失 / 调用错误 / 输出无法解析 → deny（绝不静默放行）
#   - stdin 为空 / 无 CommandLine → allow（无命令可查，非危险放行）
$ErrorActionPreference = 'Stop'

function Emit-Deny([string]$reason) {
    $esc = $reason.Replace('\', '\\').Replace('"', '\"').Replace("`r", '').Replace("`n", '\n')
    Write-Output ('{"decision":"deny","reason":"RiskGuard: ' + $esc + '"}')
    exit 0
}

try {
    $inputJson = [Console]::In.ReadToEnd()
} catch {
    Emit-Deny 'stdin read error (fail-closed)'
}
if ([string]::IsNullOrWhiteSpace($inputJson)) {
    Write-Output '{"decision":"allow"}'
    exit 0
}
try {
    $data = $inputJson | ConvertFrom-Json
} catch {
    Emit-Deny 'unparseable hook input (fail-closed)'
}

# 提取要执行的命令文本（兼容 CommandLine / command 两种键）
$cmd = $null
if ($data.toolCall -and $data.toolCall.args) {
    $cmd = $data.toolCall.args.CommandLine
    if (-not $cmd) { $cmd = $data.toolCall.args.command }
}
if ([string]::IsNullOrWhiteSpace($cmd)) {
    Write-Output '{"decision":"allow"}'
    exit 0
}

$main = 'C:\Users\Satanchen\.codex\hooks\dangerous-commands.ps1'
if (-not (Test-Path -LiteralPath $main)) {
    Emit-Deny "rules engine missing: $main (fail-closed)"
}

# 调用主规则脚本（-Cmd 模式），解析其 codex 格式输出
try {
    $out = (& $main -Cmd $cmd 2>$null | Out-String)
} catch {
    Emit-Deny 'rules engine error (fail-closed)'
}
if (-not [string]::IsNullOrWhiteSpace($out)) {
    try {
        $r = $out | ConvertFrom-Json
        if ($r.hookSpecificOutput.permissionDecision -eq 'deny') {
            Emit-Deny ([string]$r.hookSpecificOutput.permissionDecisionReason)
        }
    } catch {
        # 规则脚本输出了无法解析的内容 → fail-closed
        Emit-Deny "unparseable rules output (fail-closed): $($out.Substring(0, [Math]::Min(80, $out.Length)))"
    }
}

Write-Output '{"decision":"allow"}'
exit 0
