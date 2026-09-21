# agy-hook-test.ps1 — Antigravity CLI (agy) 适配器规则回归（v0.2 协议面 + 规则判定）
#
# 用法：powershell -ExecutionPolicy Bypass -File agy-hook-test.ps1   （pwsh 同）
#
# 为什么单列一套（2026-09-21 新建）：
#   其它 5 套 ps1 套件都用 `-Cmd <文本>` 直调规则引擎，而 agy 适配器**不是那个接口** ——
#   它读 **stdin 的 protojson**（`{toolCall:{name,args:{CommandLine}}}`）、把结果转成
#   **stdout 顶层 JSON**（`{decision,reason}`）、并且**退出码恒 0**。照抄别的套件会得到
#   「全部 allow」的假绿灯（CC 形状的 payload 里没有 CommandLine → 适配器按 allow 放行）。
#
# 本套件同时钉三件事：
#   ① 规则判定（危险 → deny / 无害 → allow，含 R7c 的三种 branch 形态）；
#   ② 协议面（exit 恒 0、stdout 必须是**合法 JSON**、deny 带 `RiskGuard:` 前缀、
#      allow **不得**带 reason）；
#   ③ 输出编码（stdout 字节必须是**合法 UTF-8 且不含替换字符** —— 曾因按 GBK 写出而乱码）。
#
# 密闭性：不碰真实 home。适配器按「同目录 dangerous-commands.ps1」解析规则引擎，
#   本套件就位于 skills/agent-risk-guard/tests/，引擎是其兄弟 `../scripts/dangerous-commands.ps1`。
# 双引擎：子进程用**当前宿主引擎**（$PID 的可执行路径），所以 PS 5.1 与 pwsh 7 各测一遍。

$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot '..\scripts\agy-dangerous-commands.ps1'
if (-not (Test-Path -LiteralPath $script)) { Write-Output "MISSING adapter: $script"; exit 1 }
$engine = Join-Path $PSScriptRoot '..\scripts\dangerous-commands.ps1'
if (-not (Test-Path -LiteralPath $engine)) { Write-Output "MISSING sibling engine: $engine"; exit 1 }

$hostExe = (Get-Process -Id $PID).Path
$utf8Strict = New-Object System.Text.UTF8Encoding($false, $true)

function Invoke-AgyHook([string]$payload) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $hostExe
  $psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$script`""
  $psi.UseShellExecute = $false
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  $p.StandardInput.Write($payload)
  $p.StandardInput.Close()
  $ms = New-Object System.IO.MemoryStream
  $p.StandardOutput.BaseStream.CopyTo($ms)
  $p.WaitForExit()
  $bytes = $ms.ToArray()
  $valid = $true; $text = ''
  try { $text = $utf8Strict.GetString($bytes) } catch { $valid = $false }
  return [pscustomobject]@{ bytes = $bytes; text = $text.Trim(); validUtf8 = $valid; exit = $p.ExitCode }
}

function New-AgyPayload([string]$cmd) {
  $o = [ordered]@{ toolCall = [ordered]@{ name = 'run_command'; args = [ordered]@{ CommandLine = $cmd } } }
  return ($o | ConvertTo-Json -Depth 6 -Compress)
}

# 判定用例：cmd = 命令；expect = deny|allow
$cases = @(
  # ---- 危险（必须 deny）----
  @{ cmd = 'rm -rf /tmp/x';                     expect = 'deny' },
  @{ cmd = 'Remove-Item C:\temp\x -Force';      expect = 'deny' },
  @{ cmd = 'git reset --hard HEAD';             expect = 'deny' },
  @{ cmd = 'git clean -fd';                     expect = 'deny' },
  @{ cmd = 'diskpart';                          expect = 'deny' },
  @{ cmd = 'Clear-RecycleBin -Force';           expect = 'deny' },
  @{ cmd = 'cmd /c del /f C:\x\y';              expect = 'deny' },
  # R7c：三种 branch 删除形态（此前 sh 只看首字符 / 长选项重排序全端漏拦）
  @{ cmd = 'git branch -D feature';             expect = 'deny' },
  @{ cmd = 'git branch -fd feature';            expect = 'deny' },
  @{ cmd = 'git branch --force --delete feature'; expect = 'deny' },
  @{ cmd = 'git update-ref -d refs/heads/x';    expect = 'deny' },
  # ---- 无害（必须 allow）----
  @{ cmd = 'git status';                        expect = 'allow' },
  @{ cmd = 'git log --oneline';                 expect = 'allow' },
  @{ cmd = 'ls -la';                            expect = 'allow' },
  @{ cmd = 'Get-ChildItem';                     expect = 'allow' },
  @{ cmd = 'echo hello';                        expect = 'allow' },
  @{ cmd = 'npm test';                          expect = 'allow' },
  # R7c 反向守卫：不删分支的 branch 用法必须仍放行
  @{ cmd = 'git branch -a';                     expect = 'allow' },
  @{ cmd = 'git branch --list';                 expect = 'allow' },
  @{ cmd = 'git branch --contains feat-d';      expect = 'allow' }
)

$total = 0; $pass = 0
foreach ($c in $cases) {
  $total++
  $r = Invoke-AgyHook (New-AgyPayload $c.cmd)
  $decision = 'invalid'
  $reason = ''
  try { $j = $r.text | ConvertFrom-Json; $decision = [string]$j.decision; $reason = [string]$j.reason } catch { }
  $ok = $true; $why = @()
  if (-not $r.validUtf8) { $ok = $false; $why += 'stdout 非法 UTF-8' }
  if ($r.text -match [char]0xFFFD) { $ok = $false; $why += 'stdout 含替换字符（编码回归）' }
  if ($r.exit -ne 0) { $ok = $false; $why += "exit=$($r.exit)（agy 要求恒 0）" }
  if ($decision -ne $c.expect) { $ok = $false; $why += "decision=$decision" }
  if ($c.expect -eq 'deny' -and $reason -notlike 'RiskGuard:*') { $ok = $false; $why += 'deny 缺 RiskGuard: 前缀' }
  if ($c.expect -eq 'allow' -and $reason -ne '') { $ok = $false; $why += 'allow 不得带 reason' }
  if ($ok) { $pass++ }
  Write-Output ("{0} [expect {1}] got {2}{3}  <- {4}" -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $c.expect, $decision, $(if ($why.Count) { ' (' + ($why -join '; ') + ')' } else { '' }), $c.cmd)
}

# ---- 协议面：畸形输入 ----
$proto = @(
  # 空 stdin → 适配器显式回 allow（无命令可判）
  @{ name = '空 stdin';                 payload = '';                                                         expect = 'allow'; expectFailClosed = $false },
  # 非法 JSON → fail-closed deny
  @{ name = '非法 JSON';                payload = '{ broken';                                                  expect = 'deny';  expectFailClosed = $true },
  # 缺 CommandLine（args 空）→ allow
  @{ name = '缺 CommandLine';           payload = '{"toolCall":{"name":"run_command","args":{}}}';             expect = 'allow'; expectFailClosed = $false },
  # 空 CommandLine → allow
  @{ name = '空 CommandLine';           payload = '{"toolCall":{"name":"run_command","args":{"CommandLine":"   "}}}'; expect = 'allow'; expectFailClosed = $false }
)
foreach ($p in $proto) {
  $total++
  $r = Invoke-AgyHook $p.payload
  $decision = 'invalid'; $reason = ''
  try { $j = $r.text | ConvertFrom-Json; $decision = [string]$j.decision; $reason = [string]$j.reason } catch { }
  $ok = ($r.validUtf8 -and $r.exit -eq 0 -and $decision -eq $p.expect)
  $why = @()
  if ($r.exit -ne 0) { $why += "exit=$($r.exit)" }
  if ($decision -ne $p.expect) { $why += "decision=$decision" }
  if ($p.expectFailClosed -and ($reason -notmatch 'fail-closed')) { $ok = $false; $why += ' 应带 fail-closed 措辞' }
  if ($ok) { $pass++ }
  Write-Output ("{0} [expect {1}] got {2}{3}  <- {4}" -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $p.expect, $decision, $(if ($why.Count) { ' (' + ($why -join '; ') + ')' } else { '' }), $p.name)
}

Write-Output ("PASS: {0}/{1}" -f $pass, $total)
Write-Output ("  engine={0}  host={1}" -f (Split-Path $engine -Leaf), (Split-Path $hostExe -Leaf))
exit $(if ($pass -eq $total) { 0 } else { 1 })
