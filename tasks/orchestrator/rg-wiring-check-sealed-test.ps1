# 密封测试：scripts/riskguard-wiring-check.ps1 的 DSH YAML 校验/自愈路径
# 用假 USERPROFILE 隔离，绝不碰生产面。只判 dsh 段（其余检查点在假 home 下必然 [!!]，属预期）。
# 断言一律用 ASCII 锚点或落盘文件状态：powershell 5.1 子进程按 GBK 误读无 BOM 的 UTF-8 脚本，
# 中文输出是乱码，断言中文字符串必假阴性（已踩过）。
$ErrorActionPreference = 'Stop'
$repo = 'E:\DeepSeek_Harness\workspace\2026_08_21\agent-risk-guard'
$src  = Join-Path $repo 'assets\dsh\deny-risk-commands.patch.yml'
$tmp  = Join-Path $repo 'tasks\.tmp'
$py   = 'D:\Technology_application\Anconda_All\Anaconda3\envs\claude\python.exe'

$srcLines = [IO.File]::ReadAllLines($src, [Text.Encoding]::UTF8)
$firstRuleIdx = -1
for ($i = 0; $i -lt $srcLines.Count; $i++) { if ($srcLines[$i] -match "re:\s*'") { $firstRuleIdx = $i; break } }
if ($firstRuleIdx -lt 0) { throw '单源里没找到规则行' }
$n3Tail = "`r`n`r`n# N3 预算闸门`r`n- insert:`r`n    - id: custom-note`r`n      name: 'sealed-test-tail'`r`n"

$script:pass = 0; $script:fail = 0
function Assert([string]$name, [bool]$cond) {
  if ($cond) { Write-Host "  [PASS] $name" -ForegroundColor Green; $script:pass++ }
  else { Write-Host "  [FAIL] $name" -ForegroundColor Red; $script:fail++ }
}
function New-FakeHome([string]$name) {
  $h = Join-Path $tmp $name
  # 预建 -Fix 路径上 Copy-Item 需要的父目录（脚本对「全新机器无目录」会直接崩，已登记为独立问题，不在本测试范围）
  foreach ($d in @('.dsh\profiles\headless', '.claude\hooks', '.codex\hooks', '.gemini\config\hooks', '.workbuddy\hooks', '.config\opencode\plugins')) {
    New-Item -ItemType Directory -Force (Join-Path $h $d) | Out-Null
  }
  return @($h, (Join-Path $h '.dsh\profiles\headless\cordis.patch.yml'))
}
function Invoke-WC([string]$fakeHome, [string]$engine, [switch]$Fix, [string]$scriptPath) {
  if (-not $scriptPath) { $scriptPath = Join-Path $repo 'scripts\riskguard-wiring-check.ps1' }
  $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $scriptPath)
  if ($Fix) { $argList += '-Fix' }
  $prev = $env:USERPROFILE
  try { $env:USERPROFILE = $fakeHome; $out = (& $engine @argList 2>&1 | Out-String) }
  finally { $env:USERPROFILE = $prev }
  return $out
}
function Test-PyYaml([string]$path) {
  & $py -c "import yaml, sys; sys.excepthook = lambda *a: sys.exit(3); yaml.safe_load(open(sys.argv[1], 'r', encoding='utf-8'))" $path 2>$null
  return ($LASTEXITCODE -eq 0)
}

# ---------- T1: 坏 YAML + N3 尾 → -Fix 重组 → 复验通过 → 规则一致 ----------
Write-Host "`n== T1: broken YAML + N3 tail, -Fix should rebuild + revalidate (powershell 5.1) ==" -ForegroundColor Cyan
($h1, $p1) = New-FakeHome 'fake-t1'
$broken = $srcLines.Clone()
$broken[$firstRuleIdx] = "  - { id: BROKEN-SEALED, re: 'unclosed"
[IO.File]::WriteAllText($p1, (($broken -join "`r`n") + $n3Tail), [Text.UTF8Encoding]::new($false))
Assert 'T1 pre: constructed file is indeed broken YAML' (-not (Test-PyYaml $p1))
$o1 = Invoke-WC $h1 'powershell' -Fix
Assert 'T1a YAML failure reported (YAMLException line)' ($o1.Contains('YAMLException'))
Assert 'T1b rebuild+revalidate success line ([Fix]...dsh headless...YAML)' ($o1 -match '\[Fix\][^\n]*dsh headless[^\n]*YAML')
Assert 'T1c final dsh check OK' ($o1 -match '\[OK\][^\n]*dsh headless')
Assert 'T1d healed file parses with PyYAML' (Test-PyYaml $p1)
$t1text = [IO.File]::ReadAllText($p1, [Text.Encoding]::UTF8)
Assert 'T1e user tail (N3 section) preserved' ($t1text.Contains('# N3 预算闸门') -and $t1text.Contains('sealed-test-tail'))
Assert 'T1f single-source rules present' ($t1text.Contains('deny-risk-commands') -and -not $t1text.Contains('BROKEN-SEALED'))

Write-Host "`n== T1b2: same fake home under pwsh 7 (already healed, should be consistent) ==" -ForegroundColor Cyan
$o1b = Invoke-WC $h1 'pwsh'
Assert 'T1g pwsh: dsh section consistent' ($o1b -match '\[OK\][^\n]*dsh headless')

# ---------- T2: 坏 YAML 且无 N3 标记 → 重组放弃，不得谎称修复 ----------
Write-Host "`n== T2: broken YAML without N3 tail, -Fix must not fake-fix ==" -ForegroundColor Cyan
($h2, $p2) = New-FakeHome 'fake-t2'
[IO.File]::WriteAllText($p2, ($broken -join "`r`n"), [Text.UTF8Encoding]::new($false))
$o2 = Invoke-WC $h2 'powershell' -Fix
Assert 'T2a YAML failure reported' ($o2.Contains('YAMLException'))
Assert 'T2b N3-missing reason printed' ($o2.Contains("'# N3"))
Assert 'T2c no fake rebuild success line' (-not ($o2 -match '\[Fix\][^\n]*dsh headless[^\n]*YAML'))
Assert 'T2d file left broken (unchanged)' (-not (Test-PyYaml $p2))

# ---------- T3: YAML 合法但一条规则被旧规则顶位 → 原位替换 + 复验 ----------
Write-Host "`n== T3: valid YAML with one stale rule, -Fix should replace in place ==" -ForegroundColor Cyan
($h3, $p3) = New-FakeHome 'fake-t3'
$drift = $srcLines.Clone()
$ruleIndent = [regex]::Match($srcLines[$firstRuleIdx], '^\s*').Value
$drift[$firstRuleIdx] = $ruleIndent + "- { re: 'old-fake-rule-zzz', reason: 'sealed drift' }"
[IO.File]::WriteAllText($p3, (($drift -join "`r`n") + $n3Tail), [Text.UTF8Encoding]::new($false))
Assert 'T3 pre: constructed file is valid YAML' (Test-PyYaml $p3)
$o3 = Invoke-WC $h3 'powershell' -Fix
Assert 'T3a replacement happened (file state)' (Test-PyYaml $p3)
$t3text = [IO.File]::ReadAllText($p3, [Text.Encoding]::UTF8)
Assert 'T3b stale rule removed' (-not $t3text.Contains('old-fake-rule-zzz'))
Assert 'T3c source rule restored' $t3text.Contains([regex]::Unescape('Remove-Item'))
Assert 'T3d user tail preserved' $t3text.Contains('sealed-test-tail')
Assert 'T3e final dsh check OK' ($o3 -match '\[OK\][^\n]*dsh headless')

# ---------- T4: python 缺失 → 警告一次且不静默 ----------
Write-Host "`n== T4: missing python should warn once and continue ==" -ForegroundColor Cyan
($h4, $p4) = New-FakeHome 'fake-t4'
[IO.File]::WriteAllText($p4, (($srcLines -join "`r`n") + $n3Tail), [Text.UTF8Encoding]::new($false))
$scriptCopy = Join-Path $tmp 'wc-pymiss.ps1'
$scriptText = [IO.File]::ReadAllText((Join-Path $repo 'scripts\riskguard-wiring-check.ps1'), [Text.Encoding]::UTF8)
$scriptText = $scriptText.Replace('D:\Technology_application\Anconda_All\Anaconda3\envs\claude\python.exe', 'D:\nonexistent\sealed-test\python.exe')
# 必须带 BOM 写回：原脚本带 BOM，PS 5.1 靠 BOM 识别 UTF-8；无 BOM 副本会被按 GBK 误读直接解析错误
[IO.File]::WriteAllText($scriptCopy, $scriptText, [Text.UTF8Encoding]::new($true))
$o4 = Invoke-WC $h4 'powershell' -Fix -scriptPath $scriptCopy
$warnCount = ([regex]::Matches($o4, [regex]::Escape('D:\nonexistent\sealed-test\python.exe'))).Count
Assert 'T4a warn line with missing-python path appears exactly once' ($warnCount -eq 1)
Assert 'T4b rule comparison still ran and consistent' ($o4 -match '\[OK\][^\n]*dsh headless')

Write-Host "`n===== sealed test total: $($script:pass) pass / $($script:fail) fail =====" -ForegroundColor Cyan
if ($script:fail -gt 0) { exit 1 }
