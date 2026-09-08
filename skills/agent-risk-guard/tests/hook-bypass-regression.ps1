hook-bypass-regression.ps1 — Round 8 绕过回归（与 GAN 审查互补，锚定修复后行为）
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot '..\scripts\dangerous-commands.ps1'
$stdinTmp = Join-Path $env:TEMP 'rg-probe-in.json'
$stdoutTmp = Join-Path $env:TEMP 'rg-probe-out.txt'

$cases = @(
  # 换行/分隔符变体
  @{ cmd = "echo hi`nrm -rf /tmp";         expect = 'deny' },
  @{ cmd = 'echo hi && rm -rf /tmp';       expect = 'deny' },
  @{ cmd = 'echo hi | rm -rf /tmp';        expect = 'deny' },
  @{ cmd = 'echo hi; rm -rf /tmp';         expect = 'deny' },
  # 引号/转义
  @{ cmd = 'rm" -rf /tmp"; echo ok';       expect = 'deny' },
  @{ cmd = 'rm -rf /tmp # comment';        expect = 'deny' },
  # $() / 反引号 命令替换包裹
  @{ cmd = '$(rm -rf /tmp)';               expect = 'deny' },
  @{ cmd = '`rm -rf /tmp`';                expect = 'deny' },
  # 等价命令
  @{ cmd = 'unlink /tmp/x';                expect = 'deny' },
  @{ cmd = 'shred -u /tmp/x';              expect = 'deny' },
  @{ cmd = 'find /tmp -delete';            expect = 'deny' },
  # 大小写
  @{ cmd = 'RM -rf /tmp';                  expect = 'deny' },
  # cmd wrap
  @{ cmd = 'cmd /c del /f C:\x\y';         expect = 'deny' },
  # ---- T11/Finding 18：清空回收站绕过变体 ----
  @{ cmd = 'CLEAR-RECYCLEBIN -FORCE'; expect = 'deny' },
  @{ cmd = 'powershell -Command "Clear-RecycleBin"'; expect = 'deny' },
  @{ cmd = 'Clear-Recycle''Bin -Force'; expect = 'deny' },
  @{ cmd = 'cleanmgr /verylowdisk'; expect = 'deny' },
  # 正常命令（放行）
  @{ cmd = 'git log';                      expect = 'allow' },
  @{ cmd = 'python main.py';               expect = 'allow' },
  @{ cmd = 'node script.js';               expect = 'allow' }
)

$pass = 0
foreach ($c in $cases) {
  $raw = (& $script -Cmd $c.cmd 2>&1 | Out-String).Trim()
  $decision = if ($raw -match '"permissionDecision"\s*:\s*"deny"') { 'deny' } else { 'allow' }
  $ok = $decision -eq $c.expect
  if ($ok) { $pass++ }
  Write-Output ("{0} [expect {1}] got {2}  <- {3}" -f ($(if($ok){'PASS'}else{'FAIL'})), $c.expect, $decision, $c.cmd)
}
Write-Output ("{0}/{1}" -f $pass, $cases.Count)
exit $(if ($pass -eq $cases.Count) { 0 } else { 1 })
