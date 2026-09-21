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

# ---- 输出编码强制 UTF-8（2026-09-20）----
# 本适配器把引擎的同进程输出转成 agy 的 JSON 协议；Windows 下 Write-Output 默认按
# 控制台代码页（chcp=936/GBK）写 stdout，而 agy 按 UTF-8 解析 → 中文 reason 乱码。
# 引擎脚本内部已设同一行（同进程调用时即生效），此处再设一次是为了让本文件自足：
# 引擎缺失/早期 fail-closed 路径也不会以错误编码输出。UTF8Encoding($false) 不带 BOM。
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }

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

$main = Join-Path $env:USERPROFILE '.codex\hooks\dangerous-commands.ps1'
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
