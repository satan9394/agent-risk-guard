# dangerous-commands-universal.ps1 — 跨 7 家 Agent 通用版（规则集与 dangerous-commands.ps1 完全同步）
# 改动记录：原 ask 级全部改为 deny；补充 POSIX 删除类（unlink/shred/find -delete）、
#           git 破坏整类、任意管道到 shell、IEX+WebClient、subprocess、truncate/块设备、
#           docker system prune/volume rm；预处理剥离 echo/注释/字符串前缀防误伤。
# 改动记录（GAN-AUDIT-5AGENTS 修复，2026-09-06）：
#           [P0-大小写] PowerShell/cmd/bash 命令名与参数大小写不敏感：PowerShell -match 默认即
#                case-insensitive，并对 shell 类命令规则显式加 (?i) 保证鲁棒（保留 -cmatch 敏感位。
#                Python/Node 类 shutil/os/pathlib/fs 规则保持原文大小写语义）。
#           [P0-fail-closed] shell 类工具内 stdin 读失败/空输入/JSON 解析失败/缺 command → 一律输出
#                deny JSON；仅"已知非 shell 工具名（不在白名单）"仍放行。
#           [P1-落盘执行] 远程下载落盘再执行链（curl -o / wget -O / iwr -OutFile → &&|;bash|sh|pwsh|& 执行）。
#           [P1-插词] 命令词内部引号/反引号插词（r'm'、R`emove-Item、R'EMOVE'-'ITEM'）→ 剥引号后重查。
#           [P1-包装变体] bash -lc/-ec/-xec、sh -c；git rm；find -execdir。
#           [P2-误伤] ri 仅在有删除标志/Windows 路径时拦（放开 Ruby ri 文档）；echo/printf 未加引号文本
#                整体剥离防"echo del hello"误伤。
# 改动记录（T11/Finding 18 用户实测修复，2026-09-08）：
#           [F18-回收站清空] Clear-RecycleBin（含 -Force/-DriveLetter 各变体）、cleanmgr（含 /sagerun 等）、
#                直删 $Recycle.Bin 存储（C:\$Recycle.Bin 等任意盘 × 删除动词，含引号插词变体）→ deny，
#                reason 统一「回收站清空不可逆，如需清理请用户手动操作」；拦 Agent 工具调用，不拦用户手动清空。
# 安装：在 settings.json / hooks.json PreToolUse 中引用此脚本
# 输入：stdin JSON { tool_name, tool_input: { command }, ... }
# 输出：stdout JSON { hookSpecificOutput: { permissionDecision }, systemMessage }
# 退出码：0 = 继续（允许或已处理拒绝）
# 编码：UTF-8 with BOM（Windows PowerShell 5.1 必须）

# 测试钩子：-Cmd 参数或 RG_CMD 环境变量提供命令时跳过 stdin（生产走 stdin；测试用此路径避免 stdin EOF 慢）
param([string]$Cmd = '')

$ErrorActionPreference = 'Stop'

# 当前命令文本（脚本作用域），供 Deny-Command 在 fail-closed 早期路径也能安全引用
$script:curCmd = ''

# ---- 辅助函数：返回拒绝（全部硬拦截，不询问）----
# 日志写到 %TEMP%（不污染 skill 发布目录；生产调试时查看 %TEMP%\riskguard-hook-calls.log）
$hookLog = Join-Path $env:TEMP 'riskguard-hook-calls.log'
function Write-HookLog {
    param([string]$Decision, [string]$Reason)
    try {
        $line = '{0}  [HookInvoked] decision={1} reason={2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Decision, $Reason
        Add-Content -LiteralPath $hookLog -Value $line -Encoding UTF8
    } catch { }
}
function Deny-Command($reason) {
    Write-HookLog 'deny' $reason
    $result = @{
        hookSpecificOutput = @{
            hookEventName = 'PreToolUse'
            permissionDecision = 'deny'
            permissionDecisionReason = "⛔ HOOK 已拦截危险命令：$reason"
            updatedInput = $null
        }
        systemMessage = "⛔ HOOK 已拦截危险命令：$reason`n命令：$($script:curCmd)`n如确需执行，请在 Agent 外部手动操作。"
    }
    Write-Output ($result | ConvertTo-Json -Depth 10 -Compress)
    exit 0
}

# ---- 读取输入（GAN P0-fail-closed：shell 类工具内异常一律 deny，而非放行）----
if (-not [string]::IsNullOrWhiteSpace($Cmd)) {
    $data = @{ tool_name = 'Bash'; tool_input = @{ command = $Cmd } }
} elseif ($env:RG_CMD) {
    $data = @{ tool_name = 'Bash'; tool_input = @{ command = $env:RG_CMD } }
} else {
    # ---- 读取 stdin ----
    try {
        $inputJson = [Console]::In.ReadToEnd()
    } catch {
        Deny-Command '无法读取 hook 输入（读取 stdin 失败）'
    }
    if ([string]::IsNullOrWhiteSpace($inputJson)) { Deny-Command 'hook 收到空输入（未提供命令）' }
    try {
        $data = $inputJson | ConvertFrom-Json
    } catch {
        Deny-Command 'JSON 解析失败，无法确认命令安全'
    }
    if (-not $data) { Deny-Command '无法解析 hook 输入' }
}

# ---- 只拦截 shell 类工具（闭集白名单；Wsl/Nushell 等不在名单者按需求放行）----
$tn = $data.tool_name
if ([string]::IsNullOrWhiteSpace($tn)) { exit 0 }
if ($tn -notmatch '(?i)^(bash|shell|command|execute|powershell|pwsh|zsh|fish|cmd)$') { exit 0 }

# ---- shell 工具：command 缺失/为空 → fail-closed deny ----
if ($null -eq $data.tool_input -or $null -eq $data.tool_input.command) { Deny-Command "shell 工具 ($tn) 缺少 command 字段" }
$cmdRaw = [string]$data.tool_input.command
if ([string]::IsNullOrWhiteSpace($cmdRaw)) { Deny-Command "shell 工具 ($tn) 的 command 为空" }
$script:curCmd = $cmdRaw

# R15 修复（对齐 core normalizeFullWidth）：全角字符 → ASCII（ｒｍ　－ｒｆ → rm -rf），防 Unicode 绕过
$cmd = [regex]::Replace($cmdRaw, '[\uFF01-\uFF5E]', { param($m) [char]([int]$m.Value[0] - 0xfee0) })
$cmd = $cmd -replace '\u3000', ' '

# ---- 预处理（P2-02 + GAN P2 强化：剥离注释/echo/printf 显示文本整体，防误伤）----
# 纯注释行（整行以 # 开头）→ 放行
if ($cmd -match '^\s*#') { exit 0 }
# $cmdTest：规则匹配用的命令文本；剥离 echo/printf 显示文本（含未加引号参数，如 "echo del hello"）
# 到下一个语句分隔符/换行，以及 python print(...) 字符串内容——其中关键词仅为文本/文档，非命令；
# 保留分隔符后的真实命令（cmd /c del、echo x; rm、python 真实调用仍可见）
$cmdTest = $cmd -replace '(?is)\b(?:echo|printf)\b[^;&|\r\n]*(?=[;&|\r\n]|$)'
$cmdTest = $cmdTest -replace "(?i)\bprint\s*\(['""][^'""]*['""]\)", 'print()'
# 命令词插词归一（GAN P1-插词）：r'm'→rm、R`emove-Item→Remove-Item、R'EMOVE'-'ITEM'→REMOVE-ITEM；
# 在 $cmdTest 基础上进一步剥离内部单/双引号与反引号，用于补查删除类插词变体
$cmdNaked = $cmdTest -replace '["''`]', ''

# ---- ========== 危险命令模式匹配 ========== ----
# 全部为致命级别 — 硬拦截，不询问

# 0b) 纯注释短路（R8 误伤修复：以 # 开头的整行注释不是命令，放行）
if ($cmd -match '^\s*#') { exit 0 }

# 1) rm -rf 根目录或 HOME（大小写不敏感）
if ($cmdTest -match '(?i)\brm\s+-rf?\s+(/\s*\*?\s*($|[&\|#;]|\$HOME|~))') {
    Deny-Command '尝试递归强制删除根目录 (rm -rf / 或 /$HOME/~)'
}

# 2) rm -rf 关键系统目录
if ($cmdTest -match '(?i)\brm\s+-rf?\s+/(bin|boot|dev|etc|lib|lib64|proc|sys|usr|var)\b') {
    Deny-Command '尝试删除关键系统目录'
}

# 3) dd 直接写入块设备
if ($cmd -match '(?<!\S)dd\s+if=.*\s+of=\s*/dev/\w+') {
    Deny-Command '尝试直接写入块设备 (dd to /dev/*)'
}

# 4) mkfs 格式化
if ($cmd -match '(?i)\bmkfs\.\w+\s+/dev/\w+') {
    Deny-Command '尝试格式化文件系统 (mkfs)'
}

# 5) fork 炸弹
if ($cmd -match '^:\(\)\{') {
    Deny-Command '检测到 fork 炸弹'
}

# 6) shutdown / reboot
if ($cmd -match '(?i)^\s*(sudo\s+)?(shutdown|reboot|halt|poweroff)\s') {
    Deny-Command '尝试关闭或重启系统'
}

# 7) format 磁盘
if ($cmd -match '(?i)\bformat\s+[A-Z]:\s*[/]') {
    Deny-Command '尝试格式化磁盘'
}

# 8) diskpart (Windows 磁盘分区操作；P1-01 修复：$cmdTest 剥离 echo 字符串防误伤)
if ($cmdTest -match '(?i)\bdiskpart\b') {
    Deny-Command '尝试操作磁盘分区 (diskpart)'
}

# 9) PowerShell 磁盘格式化/清理（R3 修复：$cmdTest 剥离 echo 字符串防误伤）
if ($cmdTest -match '(?i)\b(Clear-Disk|Format-Volume|Format-Partition|Format-Drive)\b') {
    Deny-Command '尝试格式化/清理磁盘 (PowerShell)'
}

# 10) Python shutil.rmtree — 永久删除，不进回收站（Python 大小写敏感，保持原文）
if ($cmdTest -match '\bshutil\.rmtree\b') {
    Deny-Command 'Python shutil.rmtree 是永久删除（不进回收站）。请改用 pwsh 的 Microsoft.VisualBasic 回收站命令'
}

# 11) Python os.remove / os.unlink / os.rmdir — 永久删除（Python 大小写敏感）
if ($cmdTest -match '\bos\.(remove|unlink|rmdir)\b') {
    Deny-Command 'Python os.remove/os.unlink/os.rmdir 是永久删除（不进回收站）。请改用 pwsh 的 Microsoft.VisualBasic 回收站命令'
}

# 12) Python pathlib.Path.unlink / pathlib.Path.rmdir — 永久删除（Python 大小写敏感）
if ($cmdTest -match '\.(unlink|rmdir)\s*\(') {
    Deny-Command 'Python pathlib.Path.unlink()/Path.rmdir() 是永久删除（不进回收站）。请改用 pwsh 的 Microsoft.VisualBasic 回收站命令'
}

# 13) PowerShell Remove-Item — 永久删除（铁律：必须进回收站；大小写不敏感）
if ($cmdTest -match '(?i)\bRemove-Item\b') {
    Deny-Command 'Remove-Item 是永久删除（不进回收站）。请改用 pwsh 的 Microsoft.VisualBasic 回收站命令'
}

# 14) del / erase / ri / rd / rmdir — 永久删除（铁律；大小写不敏感；ri 仅在有删除标志/盘符时拦）
if ($cmdTest -match '(?i)\bdel\s+') {
    Deny-Command 'del 是永久删除（不进回收站）。请改用 pwsh 的 Microsoft.VisualBasic 回收站命令'
}
if ($cmdTest -match '(?i)\berase\b') {
    Deny-Command 'erase 是永久删除（不进回收站）。请改用 pwsh 的 Microsoft.VisualBasic 回收站命令'
}
if ($cmdTest -match '(?i)\bri\s+(?:(-r|-f|-recurse|-force|-confirm|-literalpath)\b|[A-Za-z]:[\\/])') {
    Deny-Command 'ri（Remove-Item 别名）递归/强制删除是永久删除（不进回收站）。请改用 pwsh 的 Microsoft.VisualBasic 回收站命令'
}
if ($cmdTest -match '(?i)\brmdir\s+(/s|/q|-r|-recurse|-f|-force)') {
    Deny-Command 'rmdir 递归/强制删除是永久删除（不进回收站）。请改用 pwsh 的 Microsoft.VisualBasic 回收站命令'
}
if ($cmdTest -match '(?i)\brd\s+(/s|/q|-r|-recurse|-f|-force)') {
    Deny-Command 'rd 递归/强制删除是永久删除（不进回收站）。请改用 pwsh 的 Microsoft.VisualBasic 回收站命令'
}
if ($cmd -match '\[System\.IO\.(File|Directory)\]::Delete') {
    Deny-Command '.NET 直接删除是永久删除（不进回收站）。请改用 pwsh 的 Microsoft.VisualBasic 回收站命令'
}

# 15) rm -rf 非系统路径（原 ask → deny；大小写不敏感）
if ($cmdTest -match '(?i)\brm\s+-rf?\s+') {
    Deny-Command '递归强制删除操作（rm -rf）是永久删除（不进回收站），请确认目标和范围；如需删除请改用回收站命令'
}

# 16) rm 不带 -rf（R8 修正：命令起始/分隔符锚定，避免 echo "use rm" 注释误伤；含换行分隔；R25 排除 help/version 误伤）
if (($cmd -match '(?i)(?:^|[;&|\r\n])\s*rm(?:\s+|["'']?\s*-\s*)') -and ($cmd -notmatch '(?i)(?:^|[;&|\r\n])\s*rm\s+(-h|--help|--version|-V)\b')) {
    Deny-Command 'rm 在 Git Bash 下是永久删除（不进回收站），请改用 pwsh 的 Microsoft.VisualBasic 回收站命令'
}

# 16b) POSIX 删除类补充（R8 实测：unlink/shred/find -delete 曾漏拦；锚定防 echo 注释误伤）
if ($cmd -match '(?i)(?:^|[;&|\r\n])\s*unlink(?:\s+|["'']?\s*-\s*)') {
    Deny-Command 'unlink 是永久删除（不进回收站），请改用回收站命令'
}
if ($cmd -match '(?i)(?:^|[;&|\r\n])\s*shred(?:\s+|["'']?\s*-\s*)') {
    Deny-Command 'shred 是永久销毁（不可恢复），禁止'
}
if ($cmd -match '(?i)(?:^|[;&|\r\n])\s*find\b[^|;&\n]*\s-delete\b') {
    Deny-Command 'find -delete 是永久删除（不进回收站），请改用回收站命令'
}
# GAN P1-包装变体：find -execdir 与 -exec 同拦
if ($cmd -match '(?i)(?:^|[;&|\r\n])\s*find\s+[^|;&]*\s-(?:exec|execdir)\b[^|;&]*\brm\b') {
    Deny-Command 'find -exec/-execdir rm 是永久删除（不进回收站），请改用回收站命令'
}
if ($cmd -match '(?i)(?:^|[;&|\r\n])\s*(?:\bxargs\b[^|;&\n]*\brm\b|\bfor\b[^;]*;\s*do[^;]*\brm\b)') {
    Deny-Command '批量/循环 rm 删除是永久删除（不进回收站），请改用回收站命令'
}

# 16b2) 覆盖对齐补缺（R23：defaultDenyRules 35 条的漏网——rimraf / Clear-Content / fs.remove / .Delete）
if ($cmd -match '(?i)\brimraf\b') {
    Deny-Command 'rimraf 是永久删除（不进回收站），请改用回收站命令'
}
if ($cmd -match '(?i)\bClear-Content\b') {
    Deny-Command 'Clear-Content 清空文件内容是永久删除，请改用回收站命令'
}
if ($cmd -match '\bfs\.remove\w*\s*\(') {
    Deny-Command 'fs-extra remove 是永久删除（不进回收站），请改用回收站命令'
}
if ($cmd -match '\.Delete\s*\(') {
    Deny-Command '.NET 实例方法 Delete() 是永久删除（不进回收站），请改用回收站命令'
}

# 16c) 引号插词绕过防护（R8＋HOOK-AUDIT P0-09：rm''-rf / rm"" -rf 任意引号组合；R25 排除 help/version）
if ($cmd -match '(?i)(?:^|[;&|\r\n])\s*rm\s*["'']*\s*-(?!-?h(?:elp)?\b|version\b|V\b)[a-z]+') {
    Deny-Command '引号插词的 rm 变体是永久删除（不进回收站），请改用回收站命令'
}

# 16d) 变量赋值危险 + 反斜杠/前导斜杠 rm（R25 对齐 sh 10b：X=rm; $X -rf / r\m / \rm / /rm）
if ($cmd -match '(?i)=[[:space:]]*"?rm([[:space:]]|"|;|$)' -or $cmd -match '(?i)=[[:space:]]*"?Remove-Item([[:space:]]|"|;|$)' -or $cmd -match '(?:^|[;&|\r\n])[\\/]{1,2}rm([[:space:]]|-)' -or $cmd -match 'r[\\/]m([[:space:]]|-)') {
    Deny-Command '变量赋值/反斜杠前缀的 rm 是间接永久删除（不进回收站），请改用回收站命令'
}

# 16e) GAN P1-插词：剥离内部引号/反引号后的 rm / Remove-Item 删除类补查（r'm'、R`emove-Item）
if ($cmdNaked -match '(?i)(?:^|[;&|\r\n])\s*rm(?:\s+|-)\s*(?:-r\S*|-f\b|-recurse|-force)') {
    Deny-Command '含插词的 rm 变体是永久删除（不进回收站），请改用回收站命令'
}
if ($cmdNaked -match '(?i)\bRemove-Item\b') {
    Deny-Command '含插词的 Remove-Item 是永久删除（不进回收站），请改用回收站命令'
}

# 16f) 回收站清空类（T11/Finding 18 用户实测：危险删除已拦、但回收站可被清空 = 删除链最后一环无人拦截）
#      拦的是 Agent 的工具调用；用户手动清空回收站是正常操作，不受影响。
$reRecycleBinPath = '(?i)\$recycle\.bin'
$reRecycleBinDelVerb = '(?i)\b(?:Remove-Item|ri|rm|rmdir|rd|del|erase|unlink|shred|rimraf)\b|\bfs\.(?:promises\.)?(?:rm|unlink|rmdir)(?:Sync)?\s*\(|\.Delete\s*\(|\[System\.IO\.(?:File|Directory)\]::Delete'
# 1) PowerShell Clear-RecycleBin（含 -Force / -DriveLetter 各变体；引号插词一并查）
if (($cmdTest -match '(?i)\bClear-RecycleBin\b') -or ($cmdNaked -match '(?i)\bClear-RecycleBin\b')) {
    Deny-Command '回收站清空不可逆，如需清理请用户手动操作'
}
# 2) cleanmgr 磁盘清理（含 /sagerun 等变体，会连带清空回收站）
if (($cmdTest -match '(?i)\bcleanmgr(?:\.exe)?\b') -or ($cmdNaked -match '(?i)\bcleanmgr(?:\.exe)?\b')) {
    Deny-Command '回收站清空不可逆，如需清理请用户手动操作'
}
# 3) 直接删除回收站存储 $Recycle.Bin（C:\$Recycle.Bin 等任意盘符；删除动词与路径同现即拦，含插词变体）
if ((($cmdTest -match $reRecycleBinPath) -or ($cmdNaked -match $reRecycleBinPath)) -and (($cmdTest -match $reRecycleBinDelVerb) -or ($cmdNaked -match $reRecycleBinDelVerb))) {
    Deny-Command '回收站清空不可逆，如需清理请用户手动操作'
}

# 17) 管道到 shell 执行远程代码（原 ask → deny）
if ($cmd -match '(?i)(curl|wget|iwr|Invoke-WebRequest)\s+.*\s*\|\s*(bash|sh|iex|Invoke-Expression|zsh)') {
    Deny-Command '远程内容管道到 shell 执行，存在代码注入风险'
}

# 18) PowerShell 远程下载执行（原 ask → deny）
if ($cmd -match '(?i)(Invoke-Expression|iex)\s*\(.*(Invoke-WebRequest|iwr|curl|wget)') {
    Deny-Command '远程下载并执行代码，存在代码注入风险'
}

# 18b) GAN P1-落盘执行：远程下载到本地文件后立即执行（curl -o / wget -O / -OutFile → &&|;bash|sh|pwsh|&）
if ($cmd -match '(?is)(?:curl|wget)\b[^\n]*?\s(?:-o|-O|--output)\s+[^\n]*?(?:&&|\||;)[^\n]*?(?:bash|sh|pwsh|powershell)\b') {
    Deny-Command '远程内容落盘后立即执行，存在代码注入风险'
}
if ($cmd -match '(?is)(?:iwr|invoke-webrequest)\b[^\n]*?-outfile\s+[^\n]*?(?:&&|\||;)[^\n]*?(?:bash|sh|pwsh|powershell|&\s*\S+\.(?:ps1|sh)\b)') {
    Deny-Command '远程内容落盘后执行，存在代码注入风险'
}

# 19) chmod -R 777 系统路径（原 ask → deny）
if ($cmd -match '(?i)\bchmod\s+-R\s+777\s+/') {
    Deny-Command '递归设置系统路径 777 权限，存在安全风险'
}

# 20) 用户/权限管理（原 ask → deny）
if ($cmd -match '(?i)\bnet\s+(user|localgroup)\s+') {
    Deny-Command '用户或权限管理操作'
}

# 21) 注册表删除（原 ask → deny）
if ($cmd -match '(?i)\breg\s+delete\s+(HKLM|HKCR|HKCU)') {
    Deny-Command '尝试删除注册表项'
}

# 22) bcdedit 删除（原 ask → deny）
if ($cmd -match '(?i)\bbcdedit\s+/delete') {
    Deny-Command '尝试删除启动配置'
}

# 23) takeown 系统路径（P1-02 修复：icacls 只读查询不再误拦，icacls 写操作由规则 36）
if ($cmd -match '(?i)\btakeown\s+.*(system32|Windows|Program\s*Files)') {
    Deny-Command '尝试获取系统文件所有权（takeown）'
}

# 24) R2 新增：certutil 下载/解码执行（绕过 PowerShell 策略的经典下载器）
if ($cmd -match '(?i)\bcertutil\b.*(-urlcache|-split|-f\b|-decode)') {
    Deny-Command 'certutil 下载/解码执行，请使用受控下载方式'
}

# 25) R2 新增：docker run/exec 容器内破坏（含挂载宿主卷，容器逃逸等效）
if ($cmd -match '(?i)\bdocker\s+(run|exec)\b[^|;&\n]*\b(rm|rmdir|remove-item|shutil|rmtree|delete)\b') {
    Deny-Command 'docker 容器内删除/破坏操作（含挂载卷逃逸面）'
}

# 26) R2 新增：git gc --prune / git reflog expire（不可恢复清除 git 对象/历史）
if ($cmd -match '(?i)\bgit\s+gc\b.*--prune|\bgit\s+reflog\s+expire\b') {
    Deny-Command 'git 对象/历史不可恢复清除操作'
}

# 27) 通用 reg delete（放宽到任意注册表键；生产版仅 HKLM/HKCR/HKCU）
if ($cmd -match '(?i)\breg\s+delete\b') {
    Deny-Command '注册表删除操作'
}

# 28) 系统操作（P0-01 修复：halt/poweroff/shutdown/reboot 无尾随空格）
if ($cmd -match '(?i)(?:^|[;&|\r\n])\s*(?:sudo\s+)?(?:shutdown|reboot|halt|poweroff)\b') {
    Deny-Command '系统关闭/重启操作'
}

# 29) chmod 全局权限（P0-02 修复：不带 -R 的 777 也拦）
if ($cmd -match '(?i)(?:^|[;&|\r\n])\s*chmod\s+(?:-[^ ]+\s+)?(?:777|0777|a\+rwx)\s+') {
    Deny-Command '设置全局权限（chmod 777）存在安全风险'
}

# 30) git 破坏性整类（HOOK-AUDIT P0-03 + R3：clean/reset/checkout --/restore/switch -C/worktree rm/stash drop）
# R4-02 修复：switch 用 -cmatch 精确大写 -C（-c 创建分支是安全操作，不得误拦）
if ($cmd -match '(?i)\bgit\s+(?:clean\s+-f|reset\s+--hard|checkout\s+--\s*\.|restore\s*\.\s*$|restore\s+--staged)') {
    Deny-Command 'git 不可逆操作（clean/reset/checkout/restore）丢弃更改，禁止'
}
if ($cmd -cmatch '\bgit\s+switch\s+-C\b') {
    Deny-Command 'git switch -C 强制重置分支，丢弃更改，禁止'
}
if ($cmd -match '(?i)\bgit\s+worktree\s+remove\s+--force') {
    Deny-Command 'git worktree remove --force 丢弃工作区更改，禁止'
}
# R3+R4 修复：--force 后须有空白/结尾（放开 --force-with-lease），且覆盖 -f 短标志（R4-01）
if ($cmd -match '(?i)\bgit\s+push\s+.*--force(?:\s|$|\.)|\bgit\s+push\s+.*(?<![-\w])-f(?:\s|$|\.)') {
    Deny-Command 'git push 强制推送（-f/--force，非 --force-with-lease）覆盖远程历史，禁止'
}
if ($cmd -match '(?i)\bgit\s+branch\s+-[dD]\b') {
    Deny-Command 'git 删除分支（branch -d/-D），禁止'
}
if ($cmd -match '(?i)\bgit\s+stash\s+drop\b') {
    Deny-Command 'git stash drop 永久删除 stash，禁止'
}
# GAN P1-包装变体：git rm（永久删除文件）
if ($cmd -match '(?i)\bgit\s+rm\b') {
    Deny-Command 'git rm 是永久删除（不进回收站），禁止'
}
# R3 新发现：wmic shadowcopy delete（勒索软件前置；大小写不敏感）
if ($cmd -match '(?i)\bwmic\b[^|;&\n]*(?:shadowcopy|shadowstorage)[^|;&\n]*\bdelete\b|\bwmic\b[^|;&\n]*\bdelete\b') {
    Deny-Command 'wmic 删除（shadowcopy/系统管理）操作，禁止'
}

# 31) 任意管道到 shell（P0-05 修复：echo|bash / cat|sh / printf|bash 等）
if ($cmd -match '(?is)(?:\becho\b|\bcat\b|\bprintf\b|\btee\b|curl|wget|iwr).{0,200}\|\s*(?:bash|sh|zsh|pwsh|powershell)\b') {
    Deny-Command '任意内容管道到 shell 执行，存在代码注入风险'
}
# 子展开/反引号包裹的危险命令（P0-04 一部分：剥壳后仍含 rm/Remove-Item）
if ($cmd -match '\$\([^)]*(?:rm|Remove-Item|del|rmdir|shutdown)|\x60[^\x60]*(?:rm|Remove-Item|del|rmdir|shutdown)\x60') {
    Deny-Command '命令子展开（$( )/反引号）内含危险操作，禁止'
}
# eval 包裹（P0-06：单双引号）
if ($cmd -match '(?i)\beval\s+["'']+[^"'']*(?:rm\s*-rf|Remove-Item|rmdir\s*/s)') {
    Deny-Command 'eval 包裹的危险命令，禁止'
}
# GAN P1-包装变体：bash -lc / sh -c / -ec / -xec 组合短参数（-c 前的 -l/-e/-x 一并吞掉）
if ($cmd -match '(?i)\b(?:bash|sh|pwsh|powershell)(?:\s+-[a-z]+)*\s+-c\s+["'']+[^"'']*(?:rm\s*-rf|Remove-Item|rmdir\s*/s|\brm\s+[^-\s]|git\s+rm)') {
    Deny-Command 'shell -c 包裹的危险命令，禁止'
}

# 32) PowerShell 下载执行（P0-07 修复：IEX+Net.WebClient.DownloadString 经典变体）
if ($cmd -match '(?i)(?:iex|Invoke-Expression)\s*\([^)]*(?:Net\.WebClient|DownloadString|DownloadFile|WebClient)') {
    Deny-Command '远程下载并执行代码（IEX+WebClient），存在代码注入风险'
}

# 33) Python 动态执行（P0-08 修复：subprocess.call/Popen/run/check_output；R3 修复：$cmdTest 防 echo 误伤）
if ($cmdTest -match 'subprocess\.(?:call|run|Popen|check_call|check_output)') {
    Deny-Command 'Python subprocess 动态执行危险命令，禁止'
}

# 34) truncate 块设备（P0-11 修复）
if ($cmd -match '\btruncate\b[^|;&\n]*(?:/dev/|\\\\\.\\PhysicalDrive)') {
    Deny-Command 'truncate 清空块设备，禁止'
}

# 35) docker 破坏扩展（P0-13 修复：system prune / volume rm / container prune）
if ($cmd -match '(?i)\bdocker\s+(?:system\s+prune|volume\s+(?:rm|prune)|container\s+prune)') {
    Deny-Command 'docker 批量清理（prune/volume rm）删除数据，禁止'
}

# 36) icacls 只读查询放行、写操作拦截（P1-02 修复：仅 /grant /deny /setintegritylevel 等拦）
if ($cmd -match '(?i)(?:^|[;&|\r\n])\s*icacls\b[^|;&\n]*(?:\/grant|\/deny|\/setintegritylevel|\/inheritancelevel:r)') {
    Deny-Command 'icacls 权限修改操作（system 路径），禁止'
}

# ===== 未匹配 — 放行 =====
Write-HookLog 'allow' $cmd
exit 0