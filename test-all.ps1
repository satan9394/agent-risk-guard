# test-all.ps1 — RiskGuard monorepo 统一测试运行器
# 用法：& .\test-all.ps1
# 依赖：Node >= 22.18（原生 TS type-stripping，无需构建）

$ErrorActionPreference = 'Stop'
$ROOT = $PSScriptRoot
$fails = 0

function Run-Test([string]$Name, [string[]]$Files) {
    Write-Output "=== $Name ==="
    $out = node --test $Files 2>&1
    $out | Select-Object -Last 8
    if ($LASTEXITCODE -ne 0) {
        Write-Output "❌ $Name FAILED"
        $script:fails++
    } else {
        Write-Output "✅ $Name PASS"
    }
    Write-Output ""
}

Run-Test "core/policy-engine" @("$ROOT\packages\core\test\policy-engine.test.ts")
Run-Test "core/normalize" @("$ROOT\packages\core\test\normalize.test.ts")
Run-Test "core/path-junction (M7 D3 real)" @("$ROOT\packages\core\test\path-junction.test.ts")
Run-Test "core/classify-fuzz (M7)" @("$ROOT\packages\core\test\classify-fuzz.test.ts")
Run-Test "e2e/cli" @("$ROOT\tests\e2e\cli.e2e.test.ts")
Run-Test "product (merge/manifest/compat/hook schema)" @("$ROOT\tests\product\product.test.ts")
Run-Test "release-hardening (config-read/runtime-state/alias/merge)" @("$ROOT\tests\release-hardening\release-hardening.test.ts")
Run-Test "release-hardening lifecycle E2E" @("$ROOT\tests\release-hardening\lifecycle.e2e.test.ts")
Run-Test "transaction fault-injection (v0.1.1)" @("$ROOT\tests\transaction\transaction.test.ts")
Run-Test "adapters M3 (claude/cursor/grok/windsurf/dsh)" @("$ROOT\tests\adapter\adapters.test.ts")
Run-Test "adapters M4 (opencode)" @("$ROOT\tests\adapter\adapters-m4.test.ts")
Run-Test "adapter audit re-regress (GAN R14)" @("$ROOT\tests\adapter\adapter-audit-reregress.test.ts")
Run-Test "opencode guard re-regress (GAN R16)" @("$ROOT\tests\adapter\opencode-guard-reregress.test.ts")
Run-Test "trash/windows (D3 real)" @("$ROOT\packages\trash\test\trash.windows.test.ts")
Run-Test "adversarial corpus (D4)" @("$ROOT\tests\adversarial\adversarial-corpus.test.ts")
Run-Test "rule alignment (single source)" @("$ROOT\tests\adversarial\rule-alignment.test.ts")
Run-Test "installer M6 (discovery/deploy/backup/doctor)" @("$ROOT\packages\installer\test\installer.test.ts")
Run-Test "installer audit re-regress (GAN R22)" @("$ROOT\packages\installer\test\installer-audit-reregress.test.ts")
Run-Test "codex M5 (rules-compiler)" @("$ROOT\packages\codex\test\rules-compiler.test.ts")
Run-Test "dsh plugin M2 (pre-execute + guard)" @("$ROOT\packages\dsh\test\dsh-plugin.test.ts")
Run-Test "dsh guard hardening (P2-3)" @("$ROOT\packages\dsh\test\guard-hardening.test.ts")

# hook 管线验证（D3，PS 驱动真实脚本 + RedirectStandardInput）
Write-Output "=== hook pipeline (CC/Codex PreToolUse, D3 real) ==="
$hookOut = powershell -NoProfile -ExecutionPolicy Bypass -File "$ROOT\..\agent-risk-guard-audit\tests\hook-rules-test.ps1" 2>&1
$hookOut | Select-Object -Last 4
if ($LASTEXITCODE -ne 0) {
    Write-Output "❌ hook pipeline FAILED"
    $script:fails++
} else {
    Write-Output "✅ hook pipeline PASS"
}
Write-Output ""

Write-Output "=== hook bypass regression (R8) ==="
$bypassOut = powershell -NoProfile -ExecutionPolicy Bypass -File "$ROOT\..\agent-risk-guard-audit\tests\hook-bypass-regression.ps1" 2>&1
$bypassOut | Select-Object -Last 4
if ($LASTEXITCODE -ne 0) {
    Write-Output "❌ hook bypass regression FAILED"
    $script:fails++
} else {
    Write-Output "✅ hook bypass regression PASS"
}
Write-Output ""

Write-Output "=== hook FP regression (R8) ==="
$fpOut = powershell -NoProfile -ExecutionPolicy Bypass -File "$ROOT\..\agent-risk-guard-audit\tests\hook-fp-regression.ps1" 2>&1
$fpOut | Select-Object -Last 4
if ($LASTEXITCODE -ne 0) {
    Write-Output "❌ hook FP regression FAILED"
    $script:fails++
} else {
    Write-Output "✅ hook FP regression PASS"
}
Write-Output ""

Write-Output "=== hook audit re-regress (GAN R8) ==="
$auditOut = powershell -NoProfile -ExecutionPolicy Bypass -File "$ROOT\..\agent-risk-guard-audit\tests\hook-audit-reregress.ps1" 2>&1
$auditOut | Select-Object -Last 4
if ($LASTEXITCODE -ne 0) {
    Write-Output "❌ hook audit re-regress FAILED"
    $script:fails++
} else {
    Write-Output "✅ hook audit re-regress PASS"
}
Write-Output ""

# sh 版 hook（Linux/macOS）：wsl bash 驱动（Windows 路径转 /mnt/ 形式；R25：59+edge40+bypass186 三套件）
Write-Output "=== hook sh (Linux/macOS, WSL; 3 suites) ==="
$shSuites = @('sh-hook-test.sh', 'sh-audit-edge.sh', 'sh-audit-bypass.sh')
$shFailed = $false
foreach ($shName in $shSuites) {
    $shWinPath = (Resolve-Path "$ROOT\..\agent-risk-guard-audit\tests\$shName").Path
    $shMnt = '/mnt/' + (($shWinPath -replace '^([A-Za-z]):', '$1' -replace '\\', '/').ToLowerInvariant())
    $shOut = wsl bash $shMnt 2>&1
    $shTail = $shOut | Select-Object -Last 2
    Write-Output "[$shName] $($shTail -join ' ')"
    if ($LASTEXITCODE -ne 0) { $shFailed = $true } else { $shFailed = $shFailed -or (($shOut | Select-String '^  FAIL \[').Count -gt 0) }
}
if ($shFailed) {
    Write-Output "❌ hook sh FAILED"
    $script:fails++
} else {
    Write-Output "✅ hook sh PASS"
}
Write-Output ""

if ($fails -gt 0) {
    Write-Output "总计: $fails 组失败"
    exit 1
}
Write-Output "全部测试通过 ✔"
exit 0