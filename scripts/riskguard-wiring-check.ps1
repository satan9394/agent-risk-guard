# riskguard-wiring-check.ps1 — RiskGuard 生产接线巡检 + 自愈
#
# 背景（real-agent-conformance-final-report 遗留第 1 条）：claude-code settings.json 的
# PreToolUse 曾多次被外部还原丢失（hooks 只剩 Setup、bypassPermissions），防护静默失效（fail-open）。
# 本脚本把「doctor 巡检 + 接线在位/hash 校验」立为日常治理动作：缺即报，-Fix 则从仓库单源恢复。
#
# 用法：
#   pwsh scripts/riskguard-wiring-check.ps1            # 只读巡检，缺失/漂移即非零退出
#   pwsh scripts/riskguard-wiring-check.ps1 -Fix       # 巡检并自动从单源恢复（备份进回收站目录）
#
# 检查点（单一规则源纪律，全部期望字节一致）：
#   ps1      : .claude/hooks + .codex/hooks + .gemini/config/hooks ← 仓库 assets/hooks/dangerous-commands.ps1
#   opencode : .config/opencode/plugins ← 仓库 assets/opencode/agent-risk-guard.ts
#   dsh      : profiles/*/cordis.patch.yml ← 仓库 assets/dsh/deny-risk-commands.patch.yml
#              （组合文件不整比 hash，改为**逐条正则文本比对**；缺任一条即失败，-Fix 按单源替换）
#   接线     : cc settings.json PreToolUse 在位 / codex hooks.json+config.toml / agy hooks.json / dsh patch 注入
#
# 退出码：0 = 全部 OK；1 = 发现缺失或漂移（-Fix 后仍残留）；2 = 本机无法定位仓库单源

param([switch]$Fix)

$ErrorActionPreference = 'Stop'
$repo = 'E:\DeepSeek_Harness\workspace\2026_08_21\agent-risk-guard'
$userHome = $env:USERPROFILE
$backupRoot = Join-Path $userHome '.risk-guard-backup'
$issues = @()

function Write-Check([string]$name, [bool]$ok, [string]$detail) {
  if ($ok) { Write-Host ("  [OK]  {0}  {1}" -f $name, $detail) -ForegroundColor Green }
  else     { Write-Host ("  [!!]  {0}  {1}" -f $name, $detail) -ForegroundColor Red; $script:issues += $name }
}

function Backup-File([string]$src) {
  if (-not $Fix) { return }
  try {
    $stamp = Get-Date -f 'yyyyMMddHHmmss'
    $rel = $src.Substring($userHome.Length).TrimStart('\').Replace('\', '-')
    $dir = Join-Path $backupRoot 'riskguard-wiring-check'
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    Copy-Item $src (Join-Path $dir ("{0}.{1}.bak" -f $rel, $stamp)) -Force
  } catch { Write-Host "  备份失败(继续): $($_.Exception.Message)" -ForegroundColor Yellow }
}

function Restore-Single-Source([string]$dest, [string]$source, [string]$label) {
  if (-not $Fix) { return }
  if (Test-Path $source) {
    Backup-File $dest
    Copy-Item $source $dest -Force
    Write-Host ("  [Fix] 已从单源恢复 {0}" -f $label) -ForegroundColor Cyan
  } else {
    Write-Host ("  [Fix] 单源缺失，无法恢复 {0}（来源: {1}）" -f $label, $source) -ForegroundColor Yellow
  }
}

Write-Host "RiskGuard 生产接线巡检（$(Get-Date -f 'yyyy-MM-dd HH:mm:ss')）" -ForegroundColor White
Write-Host "仓库单源: $repo"

if (-not (Test-Path $repo)) { Write-Host "单源仓库不存在: $repo" -ForegroundColor Red; exit 2 }

# ---- 0. 仓库单源自身存在性 ----
$srcPs1  = Join-Path $repo 'assets\hooks\dangerous-commands.ps1'
$srcOc   = Join-Path $repo 'assets\opencode\agent-risk-guard.ts'
$srcDsh  = Join-Path $repo 'assets\dsh\deny-risk-commands.patch.yml'
Write-Check '单源 ps1 存在' (Test-Path $srcPs1) $srcPs1
Write-Check '单源 opencode 存在' (Test-Path $srcOc) $srcOc
Write-Check '单源 dsh patch 存在' (Test-Path $srcDsh) $srcDsh
if (-not (Test-Path $srcPs1) -or -not (Test-Path $srcOc) -or -not (Test-Path $srcDsh)) { exit 2 }

function Test-Hash([string]$expected, [string]$path) {
  if (-not (Test-Path $path)) { return $false }
  return ((Get-FileHash $path -Algorithm SHA256).Hash -eq $expected)
}

# ---- 1. ps1 三处生产 vs 单源 ----
Write-Host "`n[ps1 危险命令 hook]"
$hashPs1 = (Get-FileHash $srcPs1 -Algorithm SHA256).Hash
$ps1Dests = @(
  (Join-Path $userHome '.claude\hooks\dangerous-commands.ps1'),
  (Join-Path $userHome '.codex\hooks\dangerous-commands.ps1'),
  (Join-Path $userHome '.gemini\config\hooks\dangerous-commands.ps1')
)
foreach ($d in $ps1Dests) {
  $ok = Test-Hash $hashPs1 $d
  Write-Check ("ps1: " + (Split-Path (Split-Path $d -Parent) -Leaf)) $ok $d
  if (-not $ok) { Restore-Single-Source $d $srcPs1 (Split-Path (Split-Path $d -Parent) -Leaf) }
}

# ---- 2. opencode 生产插件 vs 单源 ----
Write-Host "`n[opencode 插件]"
$hashOc = (Get-FileHash $srcOc -Algorithm SHA256).Hash
$ocDest = Join-Path $userHome '.config\opencode\plugins\agent-risk-guard.ts'
$ok = Test-Hash $hashOc $ocDest
Write-Check 'opencode 插件 hash 一致' $ok $ocDest
if (-not $ok) { Restore-Single-Source $ocDest $srcOc 'opencode' }
# opencode.json 注册检查
$ocJson = Join-Path $userHome '.config\opencode\opencode.json'
$ocReg = (Test-Path $ocJson) -and ((Get-Content $ocJson -Raw) -match 'agent-risk-guard|destructive-operation-guard')
Write-Check 'opencode.json 插件注册' $ocReg $ocJson

# ---- 3. dsh patch 生产 vs 单源（逐条正则比对）----
Write-Host "`n[dsh pre-execute 门禁]"
$hashDsh = (Get-FileHash $srcDsh -Algorithm SHA256).Hash

# 抽取文件里的规则行：Raw = 含缩进原文，Text = 去空白后的规范文本
function Get-RuleTexts([string]$path) {
  $out = [System.Collections.Generic.List[object]]::new()
  foreach ($l in [System.IO.File]::ReadAllLines($path, [System.Text.Encoding]::UTF8)) {
    if ($l -match "re:\s*'") { $out.Add([pscustomobject]@{ Raw = $l; Text = $l.Trim() }) }
  }
  return ,$out
}

$srcRules = Get-RuleTexts $srcDsh
$srcSet = @($srcRules | ForEach-Object { $_.Text })

$dshProfiles = Get-ChildItem (Join-Path $userHome '.dsh\profiles') -Directory -ErrorAction SilentlyContinue
foreach ($prof in $dshProfiles) {
  $patch = Join-Path $prof.FullName 'cordis.patch.yml'
  if (-not (Test-Path $patch)) { continue }
  $raw = Get-Content $patch -Raw
  if ($raw -notmatch 'deny-risk-commands') {
    Write-Check ("dsh {0} 缺 deny-risk-commands 注入" -f $prof.Name) $false $patch
    continue
  }
  if ((Get-FileHash $patch -Algorithm SHA256).Hash -eq $hashDsh) {
    Write-Check ("dsh {0} patch hash 一致" -f $prof.Name) $true $patch
    continue
  }

  # profile 的 cordis.patch.yml 是用户组合文件（可能含 MCP 等其它 insert 段），
  # 整文件 hash 不一致属预期 —— 所以**逐条比对规则正则文本**。
  # 2026-09-19 教训：旧实现只比「规则条数」，规则被等量替换（1 条旧换 1 条新）时静默漏报，
  # 导致 R7 的 `--delete` 收紧长期没落到 DSH 生产面（见 tasks/orchestrator/EVALUATION_RESULT_R7.md §5）。
  $liveRules = Get-RuleTexts $patch
  $liveSet = @($liveRules | ForEach-Object { $_.Text })
  $missing = @($srcSet | Where-Object { $liveSet -notcontains $_ })
  $extra   = @($liveSet | Where-Object { $srcSet -notcontains $_ })

  # 先自愈（-Fix），再据最终状态判定
  if ($Fix -and $missing.Count -gt 0) {
    # 索引对齐替换：单源第 k 条 ↔ 生产第 k 条；仅当生产第 k 条确属「多出来的」旧规则时才替换，
    # 以免破坏用户自定义内容。只替换/不删除。
    Backup-File $patch
    $rawText = [System.IO.File]::ReadAllText($patch, [System.Text.Encoding]::UTF8)
    $changed = 0
    for ($k = 0; $k -lt $srcRules.Count; $k++) {
      $srcLine = $srcRules[$k].Text
      if ($liveSet -contains $srcLine) { continue }
      if ($k -lt $liveRules.Count -and ($extra -contains $liveRules[$k].Text)) {
        $indent = [regex]::Match($liveRules[$k].Raw, '^\s*').Value
        $rawText = $rawText.Replace($liveRules[$k].Raw, $indent + $srcLine)
        $changed++
      }
    }
    if ($changed -gt 0) {
      [System.IO.File]::WriteAllText($patch, $rawText, [System.Text.UTF8Encoding]::new($false))
      Write-Host ("  [Fix] 已按单源替换 {0} 条规则（备份到 ~/.risk-guard-backup/）" -f $changed) -ForegroundColor Cyan
      $liveSet = @(Get-RuleTexts $patch | ForEach-Object { $_.Text })
      $missing = @($srcSet | Where-Object { $liveSet -notcontains $_ })
    } else {
      Write-Host "  [Fix] 未能定位可替换的旧规则（需人工处理）" -ForegroundColor Yellow
    }
  }

  if ($missing.Count -eq 0) {
    $note = if ($extra.Count -gt 0) { "，另有 {0} 条自定义规则" -f $extra.Count } else { "" }
    Write-Check ("dsh {0} 规则逐条一致（{1} 条{2}）" -f $prof.Name, $srcSet.Count, $note) $true $patch
  } else {
    Write-Check ("dsh {0} 规则缺失 {1} 条（与单源逐条比对）" -f $prof.Name, $missing.Count) $false $patch
    foreach ($m in $missing) { Write-Host ("     缺失: {0}" -f $m) -ForegroundColor Yellow }
    if (-not $Fix) { Write-Host "  注意: 加 -Fix 可从单源替换这些规则（备份到 ~/.risk-guard-backup/）" -ForegroundColor Yellow }
  }
}
if (-not $dshProfiles) {
  Write-Check 'dsh profiles 目录' $false (Join-Path $userHome '.dsh\profiles')
}

# ---- 4. 接线在位（settings.json / hooks.json / config.toml）----
Write-Host "`n[接线在位]"
$ccSettings = Join-Path $userHome '.claude\settings.json'
$ccRaw = if (Test-Path $ccSettings) { Get-Content $ccSettings -Raw } else { '' }
$ccOk = ($ccRaw -match 'PreToolUse') -and ($ccRaw -match 'dangerous-commands')
Write-Check 'claude-code settings.json PreToolUse' $ccOk $ccSettings
if (-not $ccOk -and $Fix) {
  Backup-File $ccSettings
  # 合并式添加 PreToolUse（node 处理 JSON，保留其他字段；command 指向 ~/.claude/hooks 的危险命令脚本）
  $helper = Join-Path $env:TEMP 'riskguard-cc-pretooluse.js'
  @'
const fs = require('fs');
const p = process.argv[2];
const hook = process.argv[3];
const s = JSON.parse(fs.readFileSync(p, 'utf8'));
s.hooks = s.hooks || {};
if (!s.hooks.PreToolUse) {
  // 2026-09-13 修复（实测）：路径**无空白/引号时不加引号**。带引号写法在本机两种 spawn 机制
  // （cmd /c 与直接 spawnArgs）下都会让 hook 静默失效——powershell 收到字面引号报
  // `Illegal characters in path`、退出 4294770688、不产出 deny；去引号后同一批危险载荷能正常 deny。
  // 该缺陷会让本脚本的 -Fix 动作**写回一个失效的注册**（即"自愈"其实制造裸奔）。含空白时才退回加引号。
  const hookArg = /[\s"]/.test(hook) ? '"' + hook + '"' : hook;
  s.hooks.PreToolUse = [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File ' + hookArg, timeout: 10 }] }];
}
fs.writeFileSync(p, JSON.stringify(s, null, 2) + '\n', 'utf8');
'@ | Set-Content -Path $helper -Encoding UTF8
  $hookPath = Join-Path $userHome '.claude\hooks\dangerous-commands.ps1'
  node $helper $ccSettings $hookPath
  if ($LASTEXITCODE -eq 0) {
    Write-Host "  [Fix] claude-code settings.json 已合并式恢复 PreToolUse（备份到 ~/.risk-guard-backup/）" -ForegroundColor Cyan
  } else {
    Write-Host "  [Fix] settings.json 恢复失败（node 退出码 $LASTEXITCODE）" -ForegroundColor Red
  }
  $issues = @($issues | Where-Object { $_ -ne 'claude-code settings.json PreToolUse' })
}

$codexHooks = Join-Path $userHome '.codex\hooks.json'
$codexOk = (Test-Path $codexHooks) -and ((Get-Content $codexHooks -Raw) -match 'PreToolUse') -and ((Get-Content $codexHooks -Raw) -match 'dangerous-commands')
Write-Check 'codex hooks.json PreToolUse' $codexOk $codexHooks

$codexToml = Join-Path $userHome '.codex\config.toml'
$tomlOk = (Test-Path $codexToml) -and ((Get-Content $codexToml -Raw) -match 'hooks') -and ((Get-Content $codexToml -Raw) -match 'dangerous-commands')
Write-Check 'codex config.toml [hooks]' $tomlOk $codexToml

$agyHooks = Join-Path $userHome '.gemini\config\hooks.json'
$agyOk = (Test-Path $agyHooks) -and ((Get-Content $agyHooks -Raw) -match 'dangerous-commands')
Write-Check 'agy hooks.json' $agyOk $agyHooks

# ---- 汇总 ----
Write-Host ""
if ($issues.Count -eq 0) {
  Write-Host "巡检通过：全部接线在位且哈希一致。`n（日常建议：每周跑一次；或接入计划任务）" -ForegroundColor Green
  exit 0
} else {
  Write-Host ("发现 {0} 项问题：{1}" -f $issues.Count, ($issues -join ' / ')) -ForegroundColor Red
  if ($Fix) { Write-Host "已尝试自动恢复（见上方 [Fix] 行），请复跑确认；仍残留项需人工处理。" -ForegroundColor Yellow }
  else { Write-Host "使用 -Fix 可从仓库单源自动恢复（恢复前自动备份到 ~/.risk-guard-backup/）。" -ForegroundColor Yellow }
  exit 1
}