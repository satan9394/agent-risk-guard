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
  # 预建 -Fix 路径上 Copy-Item 需要的父目录。**注意**：脚本自 2026-10-09 起已能自建父目录
  # （fresh-machine 场景见 T7），这里预建只是让 T1–T6 聚焦各自断言、不掺入父目录缺失因素。
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

# ---------- T5: config.toml 的 hooks.state（Codex 信任账本）不得被当成内联注册误报 ----------
# 回归来源（2026-09-30 23:55 实测）：首版反转检查用 `^\s*\[\[?\s*hooks` 直接匹配，把 Codex 在 /hooks
# 勾选信任后写入的 `[hooks.state.'...']` 也算进去 → 用户一信任钩子，巡线就每 5 分钟假阳性 exit 1。
# 断言用 ASCII 锚点（输出行含 `.codex\config.toml` 路径），避开 PS 5.1 对中文的 GBK 误读。
Write-Host "`n== T5: [hooks.state] trust ledger must not be flagged; inline [[hooks.PreToolUse]] must be ==" -ForegroundColor Cyan
($h5, $p5) = New-FakeHome 'fake-t5'
$cfg5 = Join-Path $h5 '.codex\config.toml'
$stateOnly = "[hooks.state.'" + 'C:\fake\.codex\hooks.json:pre_tool_use:0:0' + "']`r`n" +
             'trusted_hash = "sha256:0000000000000000000000000000000000000000000000000000000000000000"' + "`r`n"
[IO.File]::WriteAllText($cfg5, $stateOnly, [Text.UTF8Encoding]::new($false))
$o5 = Invoke-WC $h5 'powershell'
Assert 'T5a trust-ledger-only config.toml is NOT [!!]' (-not ($o5 -match '\[!!\][^\n]*\.codex\\config\.toml'))
Assert 'T5b trust-ledger-only config.toml IS [OK]' ($o5 -match '\[OK\][^\n]*\.codex\\config\.toml')

$inline5 = $stateOnly + "`r`n" + '[[hooks.PreToolUse]]' + "`r`n" + 'matcher = "^Bash$"' + "`r`n"
[IO.File]::WriteAllText($cfg5, $inline5, [Text.UTF8Encoding]::new($false))
$o5b = Invoke-WC $h5 'powershell'
Assert 'T5c inline [[hooks.PreToolUse]] IS still [!!]' ($o5b -match '\[!!\][^\n]*\.codex\\config\.toml')
$o5c = Invoke-WC $h5 'pwsh'
Assert 'T5d same verdict under pwsh 7' ($o5c -match '\[!!\][^\n]*\.codex\\config\.toml')

# ---------- T6: 块式规则（re/reason 分行）不得被误判缺失；-Fix 需能整段原位替换 ----------
# 回归来源（2026-10-09）：dsh desktop profile 的规则是块式写法（`- {` / `re:` / `reason:` / `}`），
# 而旧检测器按「整行 Trim() 后文本」比对 → 恒报「规则缺失 43 条」，-Fix 也因只认单行而修不动，
# 计划任务每 5 分钟假阳性 exit 1（09-29 起累计 300+ 条）。本用例把它钉死。
function Convert-ToBlockForm([string[]]$lines) {
  $out = [System.Collections.Generic.List[string]]::new()
  foreach ($l in $lines) {
    $m = [regex]::Match($l, "^(\s*)- \{ re: '((?:[^']|'')*)', reason: '((?:[^']|'')*)' \}\s*$")
    if ($m.Success) {
      $ind = $m.Groups[1].Value
      $out.Add($ind + '- {')
      $out.Add($ind + "    re: '" + $m.Groups[2].Value + "',")
      $out.Add($ind + "    reason: '" + $m.Groups[3].Value + "'")
      $out.Add($ind + '  }')
    } else { $out.Add($l) }
  }
  return ,$out
}
Write-Host "`n== T6: block-form rules must be detected as consistent (and -Fix must replace in place) ==" -ForegroundColor Cyan
($h6, $p6) = New-FakeHome 'fake-t6'
$blockLines = Convert-ToBlockForm $srcLines
[IO.File]::WriteAllText($p6, (($blockLines -join "`r`n") + $n3Tail), [Text.UTF8Encoding]::new($false))
Assert 'T6 pre: block-form file is valid YAML' (Test-PyYaml $p6)
$o6 = Invoke-WC $h6 'powershell'
Assert 'T6a block-form detected CONSISTENT (no false missing)' ($o6 -match '\[OK\][^\n]*dsh headless')
Assert 'T6b no "rule missing" false positive for block-form' (-not ($o6 -match '\[!!\][^\n]*dsh headless[^\n]*'))
$o6b = Invoke-WC $h6 'pwsh'
Assert 'T6c same verdict under pwsh 7' ($o6b -match '\[OK\][^\n]*dsh headless')

# T6d: 块式文件里放一条陈旧块式规则 → -Fix 整段原位替换
($h6d, $p6d) = New-FakeHome 'fake-t6d'
$blockDrift = Convert-ToBlockForm $srcLines
# 在块式数组里定位**第一条规则块**的起始行（Convert-ToBlockForm 会把每条 inline 规则变成 4 行）
$bi = -1
for ($i = 0; $i -lt $blockDrift.Count; $i++) { if ($blockDrift[$i].TrimStart() -match '^-\s*\{') { $bi = $i; break } }
if ($bi -lt 0) { throw 'T6d: block-form 数组里没找到规则块起始行' }
$driftIndent = [regex]::Match($blockDrift[$bi], '^\s*').Value
$blkStale = @($driftIndent + '- {', $driftIndent + "    re: 'old-fake-rule-block-zzz',", $driftIndent + "    reason: 'sealed block drift'", $driftIndent + '  }')
$blockDrift2 = @($blockDrift[0..($bi-1)]) + @($blkStale) + @($blockDrift[($bi+4)..($blockDrift.Count-1)])
[IO.File]::WriteAllText($p6d, (($blockDrift2 -join "`r`n") + $n3Tail), [Text.UTF8Encoding]::new($false))
Assert 'T6d pre: drifted block-form file is valid YAML' (Test-PyYaml $p6d)
$o6d = Invoke-WC $h6d 'powershell' -Fix
$t6dtext = [IO.File]::ReadAllText($p6d, [Text.Encoding]::UTF8)
Assert 'T6e stale block rule removed' (-not $t6dtext.Contains('old-fake-rule-block-zzz'))
Assert 'T6f source rule restored' $t6dtext.Contains([regex]::Unescape('Remove-Item'))
Assert 'T6g user tail preserved' $t6dtext.Contains('sealed-test-tail')
Assert 'T6h final dsh check OK after block -Fix' ($o6d -match '\[OK\][^\n]*dsh headless')
Assert 'T6i healed block-form file still parses' (Test-PyYaml $p6d)

# ---------- T7: 全新机器（只有 dsh profile，其余 Agent 目录与 settings.json 全缺）—— -Fix 不得崩 ----------
# 回归来源（2026-09-28 密封测试发现，docs/TODO.md 已登记）：目标 home 缺 ~/.claude/hooks 等父目录时，
# Restore-Single-Source 的 Copy-Item 抛 DirectoryNotFoundException 撞脚本级 EAP=Stop，**终止整个巡检**
# （dsh 段都跑不到）；settings.json 段 node 读不到缺失文件也失败。本用例钉死「能跑到 dsh 段且建出父目录」。
Write-Host "`n== T7: fresh machine (missing parent dirs + missing settings.json), -Fix must not abort ==" -ForegroundColor Cyan
$h7 = Join-Path $tmp 'fake-t7-minimal'
New-Item -ItemType Directory -Force (Join-Path $h7 '.dsh\profiles\headless') | Out-Null
$p7 = Join-Path $h7 '.dsh\profiles\headless\cordis.patch.yml'
[IO.File]::WriteAllText($p7, (($srcLines -join "`r`n") + $n3Tail), [Text.UTF8Encoding]::new($false))
Assert 'T7 pre: no .claude dir yet' (-not (Test-Path (Join-Path $h7 '.claude')))
$o7 = Invoke-WC $h7 'powershell' -Fix
Assert 'T7a did NOT abort with DirectoryNotFound' (-not ($o7 -match 'DirectoryNotFoundException'))
Assert 'T7b reached the dsh section (dsh headless judged)' ($o7 -match 'dsh headless')
Assert 'T7c final dsh check OK on fresh machine' ($o7 -match '\[OK\][^\n]*dsh headless')
Assert 'T7d claude hook parent dir auto-created + file restored' (Test-Path (Join-Path $h7 '.claude\hooks\dangerous-commands.ps1'))
Assert 'T7e claude settings.json created (was missing)' (Test-Path (Join-Path $h7 '.claude\settings.json'))

Write-Host "`n===== sealed test total: $($script:pass) pass / $($script:fail) fail =====" -ForegroundColor Cyan
if ($script:fail -gt 0) { exit 1 }
