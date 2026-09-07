# hook-fp-regression.ps1 — Round 8 误伤回归（echo 字符串/注释/rmdir 非递归应放行；-Cmd 模式）
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot '..\scripts\dangerous-commands.ps1'
$cases = @('echo "use rm to delete files"', '# rm -rf / is dangerous', 'rmdir /tmp/empty_dir', 'echo shred the log', 'echo unlink it')
$pass = 0
foreach ($c in $cases) {
  $raw = (& $script -Cmd $c 2>&1 | Out-String).Trim()
  $d = if ($raw -match '"permissionDecision"\s*:\s*"deny"') { 'deny' } else { 'allow' }
  $ok = $d -eq 'allow'
  if ($ok) { $pass++ }
  Write-Output ("{0} [expect allow] got {1}  <- {2}" -f ($(if($ok){'PASS'}else{'FAIL'})), $d, $c)
}
Write-Output ("{0}/{1}" -f $pass, $cases.Count)
exit $(if ($pass -eq $cases.Count) { 0 } else { 1 })