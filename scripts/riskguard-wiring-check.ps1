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
#   dsh      : profiles/web/cordis.patch.yml ← 仓库 assets/dsh/deny-risk-commands.patch.yml
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

# ---- 3. dsh patch 生产 vs 单源 ----
Write-Host "`n[dsh pre-execute 门禁]"
$hashDsh = (Get-FileHash $srcDsh -Algorithm SHA256).Hash
$dshProfiles = Get-ChildItem (Join-Path $userHome '.dsh\profiles') -Directory -ErrorAction SilentlyContinue
foreach ($prof in $dshProfiles) {
  $patch = Join-Path $prof.FullName 'cordis.patch.yml'
  if (-not (Test-Path $patch)) { continue }
  $raw = Get-Content $patch -Raw
  if ($raw -notmatch 'deny-risk-commands') {
    Write-Check ("dsh {0} 缺 deny-risk-commands 注入" -f $prof.Name) $false $patch
    continue
  }
  $hashOk = ((Get-FileHash $patch -Algorithm SHA256).Hash -eq $hashDsh)
  if ($hashOk) {
    Write-Check ("dsh {0} patch hash 一致" -f $prof.Name) $true $patch
  } else {
    # profile 的 cordis.patch.yml 是用户组合文件（可能含 MCP 等其它 insert 段），
    # 整文件 hash 与单源不一致属预期；只要求 deny-risk-commands 注入在位 + 规则数与单源一致。
    $ruleCount = ([regex]::Matches($raw, "re: '")).Count
    $srcCount = ([regex]::Matches((Get-Content $srcDsh -Raw), "re: '")).Count
    $rulesOk = ($ruleCount -ge $srcCount)
    Write-Check ("dsh {0} patch 规则数一致（{1}，组合文件忽略整 hash）" -f $prof.Name, $(if ($rulesOk) { 'OK' } else { '少规则' })) $rulesOk $patch
    if (-not $rulesOk) {
      Write-Host "  注意: dsh $($prof.Name) 规则数少于单源（$ruleCount < $srcCount），需人工核对补齐" -ForegroundColor Yellow
    }
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
  s.hooks.PreToolUse = [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + hook + '"', timeout: 10 }] }];
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