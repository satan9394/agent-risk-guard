# sync-prod.ps1 — 生产部署入口（薄封装）
#
# 2026-09-19 重写：本脚本原先自己实现「DSH patch 追加 + hook 覆盖」，与
# scripts/riskguard-wiring-check.ps1 职责重叠且已过时，实测有两个真实缺陷：
#   · 每次运行都会把 5 条 R2 规则**重复追加**到 ~/.dsh/profiles/web/cordis.patch.yml
#     （规则数翻倍，且是追加式、幂等性为零）；
#   · 把插件写到 ~/.config/opencode/plugins/destructive-operation-guard.ts，
#     而现网实际加载的是 agent-risk-guard.ts → 会多出一个重复的插件文件。
# 现统一委派给单源巡检器 riskguard-wiring-check.ps1（逐条正则校验 + -Fix 自愈 + 备份进
# ~/.risk-guard-backup/），避免两个部署脚本各自漂移。
#
# 用法：
#   pwsh skills/agent-risk-guard/sync-prod.ps1          # 只读巡检
#   pwsh skills/agent-risk-guard/sync-prod.ps1 -Fix     # 巡检并从单源自愈部署

param([switch]$Fix)

$ErrorActionPreference = 'Stop'

$repoRoot = $null
try { $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..') -ErrorAction Stop).Path } catch { }
$wiring = if ($repoRoot) { Join-Path $repoRoot 'scripts\riskguard-wiring-check.ps1' } else { $null }

if (-not $wiring -or -not (Test-Path $wiring)) {
    Write-Host "未找到单源巡检器 scripts/riskguard-wiring-check.ps1。" -ForegroundColor Red
    Write-Host "本脚本已改为薄封装：旧的追加式逻辑会重复注入 DSH 规则，并写入过时的插件文件名。"
    Write-Host "请在 agent-risk-guard 仓库内运行：" -ForegroundColor Yellow
    Write-Host "  pwsh scripts/riskguard-wiring-check.ps1 -Fix"
    exit 2
}

Write-Host "委派给单源巡检器：$wiring" -ForegroundColor Cyan
$argv = @('-NoProfile', '-File', $wiring)
if ($Fix) { $argv += '-Fix' }
& pwsh @argv
exit $LASTEXITCODE
