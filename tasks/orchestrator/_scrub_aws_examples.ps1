# 把 AWS 官方文档示例值替换为显式合成值（保留各文件 BOM 状态，D9）
$root = 'E:\DeepSeek_Harness\workspace\2026_08_21'
$map = [ordered]@{
  'ASIAZZTESTFIXTURE999'                    = 'ASIAZZTESTFIXTURE999'   # ASIA + 16 [0-9A-Z]
  'AKIAZZTESTFIXTURE999'                    = 'AKIAZZTESTFIXTURE999'   # AKIA + 16 [0-9A-Z]
  'TESTFIXTUREsecretVALUE0000000000000000'= 'TESTFIXTUREsecretVALUE0000000000000000'
  'TESTFIXTUREsecretVALUE'                           = 'TESTFIXTUREsecretVALUE'
}
$dirs = @("$root\agent-risk-guard", "$root\agent-risk-guard-audit", "$root\agent-risk-guard-audit-xhs-publish")
$changed = @()
foreach ($d in $dirs) {
  if (-not (Test-Path $d)) { continue }
  Get-ChildItem $d -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch '\\node_modules\\|\\\.git\\' -and $_.Length -lt 3MB } |
    ForEach-Object {
      $p = $_.FullName
      $bytes = [System.IO.File]::ReadAllBytes($p)
      $hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
      $text = [System.Text.Encoding]::UTF8.GetString($bytes)
      if ($hasBom) { $text = $text.TrimStart([char]0xFEFF) }
      $orig = $text
      foreach ($k in $map.Keys) { $text = $text.Replace($k, $map[$k]) }
      if ($text -ne $orig) {
        $enc = New-Object System.Text.UTF8Encoding($hasBom)
        [System.IO.File]::WriteAllText($p, $text, $enc)
        $changed += $p.Replace($root, '')
      }
    }
}
Write-Output ("已处理文件数 = " + $changed.Count)
$changed | Group-Object { Split-Path $_ -Parent } | Sort-Object Count -Descending | Select-Object -First 12 Count,Name | Format-Table -AutoSize | Out-String -Width 120
