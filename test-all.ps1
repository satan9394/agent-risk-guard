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
# 2026-09-13 补：两个**跨端闸门**此前只跑在 CI（CI 用 glob `packages/core/test/*.test.ts` 自动带上），
# 本地这份手工清单漏了它们 —— 而它们正是 G24 那类「两端判定发散」唯一能挡住的东西。
# 代价：decision-parity 单套实测 ~250 s（它真实 spawn 两端、逐条喂 ~211 条载荷）。
Run-Test "core/decision-parity (cross-end gate; slow ~250s)" @("$ROOT\packages\core\test\decision-parity.test.ts")
Run-Test "core/redact-parity (cross-end redaction gate)" @("$ROOT\packages\core\test\redact-parity.test.ts")
Run-Test "e2e/cli" @("$ROOT\tests\e2e\cli.e2e.test.ts")
Run-Test "product (merge/manifest/compat/hook schema)" @("$ROOT\tests\product\product.test.ts")
Run-Test "release-hardening (config-read/runtime-state/alias/merge)" @("$ROOT\tests\release-hardening\release-hardening.test.ts")
Run-Test "release-hardening lifecycle E2E" @("$ROOT\tests\release-hardening\lifecycle.e2e.test.ts")
Run-Test "transaction fault-injection (v0.1.2)" @("$ROOT\tests\transaction\transaction.test.ts")
Run-Test "distribution standalone (requires build-release)" @("$ROOT\tests\distribution\standalone.e2e.test.ts")
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
Run-Test "acs gateway v0.1 (inbound/outbound/gateway)" @("$ROOT\packages\acs\test\acs.test.ts")
Run-Test "acs golden fixtures (v0.2.0)" @("$ROOT\tests\acs\golden-fixtures.test.ts")
Run-Test "acs cli evaluate (v0.2.0)" @("$ROOT\tests\acs\cli-acs-evaluate.test.ts")
Run-Test "acs schema conformance v0.1.0 (official JSON Schema, ajv)" @("$ROOT\tests\acs-schema-conformance\schema-conformance.test.ts", "$ROOT\tests\acs-schema-conformance\snapshot-integrity.test.ts")
Run-Test "compatibility v2 (migration + boundaries)" @("$ROOT\tests\compatibility\compatibility-v2.test.ts")
Run-Test "conformance framework (C1-C10)" @("$ROOT\tests\conformance\conformance.test.ts")

# ============ hook 判定回归（D3：真实 spawn；ps1 五套 + sh 四套）============
# 套件来源 = **仓库内** `skills/agent-risk-guard/tests/`，与 CI 用的是同一份、同一位置。
# （改动前这里指向仓库外的 `..\agent-risk-guard-audit\tests\`；那个树不在 git 里，CI checkout 拿不到，
#   且它会随开发漂移 —— 2026-09-13 实测仓库内那份 `hook-redact-test.ps1` 就落后了两代。
#   套件本身是自定位的：ps1 用 `Join-Path $PSScriptRoot '..\scripts\...'`，sh 默认同路径并支持传参。）
# ps1 两套引擎各跑一遍：D9 记录 `hook-bypass-regression.ps1` 无 BOM → PS 5.1 报 18/18、pwsh 报 20/20，
#   两者都 exit 0，**计数不同不是回归**；引擎缺失时跳过并说明。
$hookTests = Join-Path $ROOT 'skills\agent-risk-guard\tests'
$ps1Suites = @('hook-rules-test', 'hook-bypass-regression', 'hook-fp-regression', 'hook-audit-reregress', 'hook-redact-test')
$shSuites = @('sh-hook-test.sh', 'sh-audit-edge.sh', 'sh-audit-bypass.sh', 'sh-failclosed-test.sh')

foreach ($eng in @('powershell', 'pwsh')) {
    if (-not (Get-Command $eng -ErrorAction SilentlyContinue)) {
        Write-Output "=== ps1 hook suites ($eng) — 引擎缺失，跳过 ==="
        Write-Output ""
        continue
    }
    Write-Output "=== ps1 hook suites ($eng, 5 suites) ==="
    foreach ($s in $ps1Suites) {
        $suitePath = Join-Path $hookTests "$s.ps1"
        $out = & $eng -NoProfile -ExecutionPolicy Bypass -File $suitePath 2>&1
        $tail = ($out | Select-Object -Last 1)
        Write-Output "[$eng/$s] $tail"
        if ($LASTEXITCODE -ne 0) {
            Write-Output "❌ $s ($eng) FAILED"
            $script:fails++
        }
    }
    Write-Output ""
}

# sh 版 hook（Linux/macOS）：wsl bash 驱动（Windows 路径转 /mnt/ 形式；四套件）
Write-Output "=== sh hook suites (Linux/macOS, WSL; 4 suites) ==="
$shFailed = $false
foreach ($shName in $shSuites) {
    $shWinPath = (Resolve-Path (Join-Path $hookTests $shName)).Path
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
