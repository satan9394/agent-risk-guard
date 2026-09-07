# dangerous-commands-universal.ps1 — 跨 7 家 Agent 通用版（规则集与 dangerous-commands.ps1 完全同步）
# 改动记录：原 ask 级全部改为 deny；补充 POSIX 删除类（unlink/shred/find -delete）、
#           git 破坏整类、任意管道到 shell、IEX+WebClient、subprocess、truncate/块设备、
#           docker system prune/volume rm；预处理剥离 echo/注释/字符串前缀防误伤。
# 安装：在 settings.json / hooks.json PreToolUse 中引用此脚本
# 输入：stdin JSON { tool_name, tool_input: { command }, ... }
# 输出：stdout JSON { hookSpecificOutput: { permissionDecision }, systemMessage }
# 退出码：0 = 继续（允许或已处理拒绝）
# 编码：UTF-8 with BOM（Windows PowerShell 5.1 必须）

# 测试钩子：-Cmd 参数或 RG_CMD 环境变量提供命令时跳过 stdin（生产走 stdin；测试用此路径避免 stdin EOF 慢）
param([string]$Cmd = '')

$ErrorActionPreference = 'Stop'

if (-not [string]::IsNullOrWhiteSpace($Cmd)) {
    $data = @{ tool_name = 'Bash'; tool_input = @{ command = $Cmd } }
} elseif ($env:RG_CMD) {
    $data = @{ tool_name = 'Bash'; tool_input = @{ command = $env:RG_CMD } }
} else {
    # ---- 读取 stdin ----
    try {
        $inputJson = [Console]::In.ReadToEnd()
    } catch {
        exit 0
    }
    if ([string]::IsNullOrWhiteSpace($inputJson)) { exit 0 }
    try {
        $data = $inputJson | ConvertFrom-Json
    } catch {
        $data = $null
    }
    if (-not $data -or -not $data.tool_name) { exit 0 }
}

# ---- 只拦截 shell 类工具（P0-12 修复：Bash/Shell/Command/Execute 等均拦截） ----
if ($data.tool_name -notmatch '(?i)^(bash|shell|command|execute|powershell|pwsh|zsh|fish|cmd)$') { exit 0 }

$cmdRaw = $data.tool_input.command
if ([string]::IsNullOrWhiteSpace($cmdRaw)) { exit 0 }
# R15 修复（对齐 core normalizeFullWidth）：全角字符 → ASCII（ｒｍ　－ｒｆ → rm -rf），防 Unicode 绕过
$cmd = [regex]::Replace($cmdRaw, '[\uFF01-\uFF5E]', { param($m) [char]([int]$m.Value[0] - 0xfee0) })
$cmd = $cmd -replace '\u3000', ' '

# ---- 预处理（P2-02 落地：剥离纯注释行/echo 前缀，防 P1 误伤） ----
# 纯注释行（整行以 # 开头）→ 放行
if ($cmd -match '^\s*#') { exit 0 }
# $cmdTest：规则匹配用的命令文本，剥离 echo/printf 引号字符串内容 + python print(...) 字符串内容
#（其中关键词只是文本/文档，非命令）；保留分隔符后的真实命令（cmd /c del、echo x; rm、python 真实调用仍可见）
$cmdTest = $cmd -replace '(?i)\b(?:echo|printf)\s+["''][^"'']*["'']', 'echo ""'
$cmdTest = $cmdTest -replace "(?i)\bprint\s*\(['""][^'""]*['""]\)", 'print()'

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
        systemMessage = "⛔ HOOK 已拦截危险命令：$reason`n命令：$cmd`n如确需执行，请在 Claude Code 外部手动操作。"
    }
    Write-Output ($result | ConvertTo-Json -Depth 10 -Compress)
    exit 0
}

# ---- ========== 危险命令模式匹配 ========== ----
# 全部为致命级别 — 硬拦截，不询问

# 0b) 纯注释短路（R8 误伤修复：以 # 开头的整行注释不是命令，放行）
if ($cmd -match '^\s*#') { exit 0 }

# 1) rm -rf 根目录或 HOME
if ($cmdTest -match '\brm\s+-rf?\s+(/\s*\*?\s*($|[&\|#;]|\$HOME|~))') {
    Deny-Command '尝试递归强制删除根目录 (rm -rf / 或 /$HOME/~)'
}

# 2) rm -rf 关键系统目录
if ($cmdTest -match '\brm\s+-rf?\s+/(bin|boot|dev|etc|lib|lib64|proc|sys|usr|var)\b') {
    Deny-Command '尝试删除关键系统目录'
}

# 3) dd 直接写入块设备
if ($cmd -match '(?<!\S)dd\s+if=.*\s+of=\s*/dev/\w+') {
    Deny-Command '尝试直接写入块设备 (dd to /dev/*)'
}

# 4) mkfs 格式化
if ($cmd -match '\bmkfs\.\w+\s+/dev/\w+') {
    Deny-Command '尝试格式化文件系统 (mkfs)'
}

# 5) fork 炸弹
if ($cmd -match '^:\(\)\{') {
    Deny-Command '检测到 fork 炸弹'
}

# 6) shutdown / reboot
if ($cmd -match '^\s*(sudo\s+)?(shutdown|reboot|halt|poweroff)\s') {
    Deny-Command '尝试关闭或重启系统'
}

# 7) format 磁盘
if ($cmd -match '\bformat\s+[A-Z]:\s*[/]') {
    Deny-Command '尝试格式化磁盘'
}

# 8) diskpart (Windows 磁盘分区操作；P1-01 修复：$cmdTest 剥离 echo 字符串防误伤)
if ($cmdTest -match '\bdiskpart\b') {
    Deny-Command '尝试操作磁盘分区 (diskpart)'
}

# 9) PowerShell 磁盘格式化/清理（R3 修复：$cmdTest 剥离 echo 字符串防误伤）
if ($cmdTest -match '\b(Clear-Disk|Format-Volume|Format-Partition|Format-Drive)\b') {
    Deny-Command '尝试格式化/清理磁盘 (PowerShell)'
}

# 10) Python shutil.rmtree — 永久删除，不进回收站
if ($cmdTest -match '\bshutil\.rmtree\b') {
    Deny-Command 'Python shutil.rmtree 是永久删除（不进回收站）。请改用 pwsh 的 Microsoft.VisualBasic 回收站命令'
}

# 11) Python os.remove / os.unlink / os.rmdir — 永久删除
if ($cmdTest -match '\bos\.(remove|unlink|rmdir)\b') {
    Deny-Command 'Python os.remove/os.unlink/os.rmdir 是永久删除（不进回收站）。请改用 pwsh 的 Microsoft.VisualBasic 回收站命令'
}

# 12) Python pathlib.Path.unlink / pathlib.Path.rmdir — 永久删除
if ($cmdTest -match '\.(unlink|rmdir)\s*\(') {
    Deny-Command 'Python pathlib.Path.unlink()/Path.rmdir() 是永久删除（不进回收站）。请改用 pwsh 的 Microsoft.VisualBasic 回收站命令'
}

# 13) PowerShell Remove-Item — 永久删除（铁律：必须进回收站；R3 修复：$cmdTest 防 echo 误伤）
if ($cmdTest -match '\bRemove-Item\b') {
    Deny-Command 'Remove-Item 是永久删除（不进回收站）。请改用 pwsh 的 Microsoft.VisualBasic 回收站命令'
}

# 14) del / erase / ri / rd / rmdir — 永久删除（铁律；P1-01 修复：$cmdTest 剥离 echo 字符串，保留 cmd /c 场景）
if ($cmdTest -match '\bdel\s+') {
    Deny-Command 'del 是永久删除（不进回收站）。请改用 pwsh 的 Microsoft.VisualBasic 回收站命令'
}
if ($cmdTest -match '\berase\b') {
    Deny-Command 'erase 是永久删除（不进回收站）。请改用 pwsh 的 Microsoft.VisualBasic 回收站命令'
}
if ($cmdTest -match '\bri\s+') {
    Deny-Command 'ri（Remove-Item 别名）是永久删除（不进回收站）。请改用 pwsh 的 Microsoft.VisualBasic 回收站命令'
}
if ($cmdTest -match '\brmdir\s+(/s|/q|-r|-recurse|-f|-force)') {
    Deny-Command 'rmdir 递归/强制删除是永久删除（不进回收站）。请改用 pwsh 的 Microsoft.VisualBasic 回收站命令'
}
if ($cmdTest -match '\brd\s+(/s|/q|-r|-recurse|-f|-force)') {
    Deny-Command 'rd 递归/强制删除是永久删除（不进回收站）。请改用 pwsh 的 Microsoft.VisualBasic 回收站命令'
}
if ($cmd -match '\[System\.IO\.(File|Directory)\]::Delete') {
    Deny-Command '.NET 直接删除是永久删除（不进回收站）。请改用 pwsh 的 Microsoft.VisualBasic 回收站命令'
}

# 15) rm -rf 非系统路径（原 ask → deny）
if ($cmdTest -match '\brm\s+-rf?\s+') {
    Deny-Command '递归强制删除操作（rm -rf）是永久删除（不进回收站），请确认目标和范围；如需删除请改用回收站命令'
}

# 16) rm 不带 -rf（R8 修正：命令起始/分隔符锚定，避免 echo "use rm" 注释误伤；含换行分隔；R25 排除 help/version 误伤）
if (($cmd -match '(?:^|[;&|\r\n])\s*rm(?:\s+|["'']?\s*-\s*)') -and ($cmd -notmatch '(?:^|[;&|\r\n])\s*rm\s+(-h|--help|--version|-V)\b')) {
    Deny-Command 'rm 在 Git Bash 下是永久删除（不进回收站），请改用 pwsh 的 Microsoft.VisualBasic 回收站命令'
}

# 16b) POSIX 删除类补充（R8 实测：unlink/shred/find -delete 曾漏拦；锚定防 echo 注释误伤）
if ($cmd -match '(?:^|[;&|\r\n])\s*unlink(?:\s+|["'']?\s*-\s*)') {
    Deny-Command 'unlink 是永久删除（不进回收站），请改用回收站命令'
}
if ($cmd -match '(?:^|[;&|\r\n])\s*shred(?:\s+|["'']?\s*-\s*)') {
    Deny-Command 'shred 是永久销毁（不可恢复），禁止'
}
if ($cmd -match '(?:^|[;&|\r\n])\s*find\b[^|;&\n]*\s-delete\b') {
    Deny-Command 'find -delete 是永久删除（不进回收站），请改用回收站命令'
}
if ($cmd -match '(?:^|[;&|\r\n])\s*find\s+[^|;&]*\s-exec\b[^|;&]*\brm\b') {
    Deny-Command 'find -exec rm 是永久删除（不进回收站），请改用回收站命令'
}
if ($cmd -match '(?:^|[;&|\r\n])\s*(?:\bxargs\b[^|;&\n]*\brm\b|\bfor\b[^;]*;\s*do[^;]*\brm\b)') {
    Deny-Command '批量/循环 rm 删除是永久删除（不进回收站），请改用回收站命令'
}

# 16b2) 覆盖对齐补缺（R23：defaultDenyRules 35 条的漏网——rimraf / Clear-Content / fs.remove / .Delete）
if ($cmd -match '\brimraf\b') {
    Deny-Command 'rimraf 是永久删除（不进回收站），请改用回收站命令'
}
if ($cmd -match '\bClear-Content\b') {
    Deny-Command 'Clear-Content 清空文件内容是永久删除，请改用回收站命令'
}
if ($cmd -match '\bfs\.remove\w*\s*\(') {
    Deny-Command 'fs-extra remove 是永久删除（不进回收站），请改用回收站命令'
}
if ($cmd -match '\.Delete\s*\(') {
    Deny-Command '.NET 实例方法 Delete() 是永久删除（不进回收站），请改用回收站命令'
}

# 16c) 引号插词绕过防护（R8＋HOOK-AUDIT P0-09：rm''-rf / rm"" -rf 任意引号组合；R25 修复：排除 -h/--help/--version 误伤）
if ($cmd -match '(?:^|[;&|\r\n])\s*rm\s*["'']*\s*-(?!-?h(?:elp)?\b|version\b|V\b)[a-z]+') {
    Deny-Command '引号插词的 rm 变体是永久删除（不进回收站），请改用回收站命令'
}

# 16d) 变量赋值危险 + 反斜杠/前导斜杠 rm（R25 对齐 sh 10b：X=rm; $X -rf / r\m / \rm / /rm）
if ($cmd -match '=[[:space:]]*"?rm([[:space:]]|"|;|$)' -or $cmd -match '=[[:space:]]*"?Remove-Item([[:space:]]|"|;|$)' -or $cmd -match '(?:^|[;&|\r\n])[\\/]{1,2}rm([[:space:]]|-)' -or $cmd -match 'r[\\/]m([[:space:]]|-)') {
    Deny-Command '变量赋值/反斜杠前缀的 rm 是间接永久删除（不进回收站），请改用回收站命令'
}

# 17) 管道到 shell 执行远程代码（原 ask → deny）
if ($cmd -match '(curl|wget|iwr|Invoke-WebRequest)\s+.*\s*\|\s*(bash|sh|iex|Invoke-Expression|zsh)') {
    Deny-Command '远程内容管道到 shell 执行，存在代码注入风险'
}

# 18) PowerShell 远程下载执行（原 ask → deny）
if ($cmd -match '(Invoke-Expression|iex)\s*\(.*(Invoke-WebRequest|iwr|curl|wget)') {
    Deny-Command '远程下载并执行代码，存在代码注入风险'
}

# 19) chmod -R 777 系统路径（原 ask → deny）
if ($cmd -match '\bchmod\s+-R\s+777\s+/') {
    Deny-Command '递归设置系统路径 777 权限，存在安全风险'
}

# 20) 用户/权限管理（原 ask → deny）
if ($cmd -match '\bnet\s+(user|localgroup)\s+') {
    Deny-Command '用户或权限管理操作'
}

# 21) 注册表删除（原 ask → deny）
if ($cmd -match '\breg\s+delete\s+(HKLM|HKCR|HKCU)') {
    Deny-Command '尝试删除注册表项'
}

# 22) bcdedit 删除（原 ask → deny）
if ($cmd -match '\bbcdedit\s+/delete') {
    Deny-Command '尝试删除启动配置'
}

# 23) takeown 系统路径（P1-02 修复：icacls 只读查询不再误拦，icacls 写操作由规则 36）
if ($cmd -match '\btakeown\s+.*(system32|Windows|Program\s*Files)') {
    Deny-Command '尝试获取系统文件所有权（takeown）'
}

# 24) R2 新增：certutil 下载/解码执行（绕过 PowerShell 策略的经典下载器）
if ($cmd -match '\bcertutil\b.*(-urlcache|-split|-f\b|-decode)') {
    Deny-Command 'certutil 下载/解码执行，请使用受控下载方式'
}

# 25) R2 新增：docker run/exec 容器内破坏（含挂载宿主卷，容器逃逸等效）
if ($cmd -match '\bdocker\s+(run|exec)\b[^|;&\n]*\b(rm|rmdir|remove-item|shutil|rmtree|delete)\b') {
    Deny-Command 'docker 容器内删除/破坏操作（含挂载卷逃逸面）'
}

# 26) R2 新增：git gc --prune / git reflog expire（不可恢复清除 git 对象/历史）
if ($cmd -match '\bgit\s+gc\b.*--prune|\bgit\s+reflog\s+expire\b') {
    Deny-Command 'git 对象/历史不可恢复清除操作'
}

# 27) 通用 reg delete（放宽到任意注册表键；生产版仅 HKLM/HKCR/HKCU）
if ($cmd -match '\breg\s+delete\b') {
    Deny-Command '注册表删除操作'
}

# 28) 系统操作（P0-01 修复：halt/poweroff/shutdown/reboot 无尾随空格）
if ($cmd -match '(?:^|[;&|\r\n])\s*(?:sudo\s+)?(?:shutdown|reboot|halt|poweroff)\b') {
    Deny-Command '系统关闭/重启操作'
}

# 29) chmod 全局权限（P0-02 修复：不带 -R 的 777 也拦）
if ($cmd -match '(?:^|[;&|\r\n])\s*chmod\s+(?:-[^ ]+\s+)?(?:777|0777|a\+rwx)\s+') {
    Deny-Command '设置全局权限（chmod 777）存在安全风险'
}

# 30) git 破坏性整类（HOOK-AUDIT P0-03 + R3：clean/reset/checkout --/restore/switch -C/worktree rm/stash drop）
# R4-02 修复：switch 用 -cmatch 精确大写 -C（-c 创建分支是安全操作，不得误拦）
if ($cmd -match '\bgit\s+(?:clean\s+-f|reset\s+--hard|checkout\s+--\s*\.|restore\s*\.\s*$|restore\s+--staged)') {
    Deny-Command 'git 不可逆操作（clean/reset/checkout/restore）丢弃更改，禁止'
}
if ($cmd -cmatch '\bgit\s+switch\s+-C\b') {
    Deny-Command 'git switch -C 强制重置分支，丢弃更改，禁止'
}
if ($cmd -match '\bgit\s+worktree\s+remove\s+--force') {
    Deny-Command 'git worktree remove --force 丢弃工作区更改，禁止'
}
# R3+R4 修复：--force 后须有空白/结尾（放开 --force-with-lease），且覆盖 -f 短标志（R4-01）
if ($cmd -match '\bgit\s+push\s+.*--force(?:\s|$|\.)|\bgit\s+push\s+.*(?<![-\w])-f(?:\s|$|\.)') {
    Deny-Command 'git push 强制推送（-f/--force，非 --force-with-lease）覆盖远程历史，禁止'
}
if ($cmd -match '\bgit\s+branch\s+-[dD]\b') {
    Deny-Command 'git 删除分支（branch -d/-D），禁止'
}
if ($cmd -match '\bgit\s+stash\s+drop\b') {
    Deny-Command 'git stash drop 永久删除 stash，禁止'
}
# R3 新发现：wmic shadowcopy delete（勒索软件前置）
if ($cmd -match '\bwmic\b[^|;&\n]*(?:shadowcopy|shadowstorage)[^|;&\n]*\bdelete\b|\bwmic\b[^|;&\n]*\bdelete\b') {
    Deny-Command 'wmic 删除（shadowcopy/系统管理）操作，禁止'
}

# 31) 任意管道到 shell（P0-05 修复：echo|bash / cat|sh / printf|bash 等）
if ($cmd -match '(?:\becho\b|\bcat\b|\bprintf\b|\btee\b|curl|wget|iwr).{0,200}\|\s*(?:bash|sh|zsh|pwsh|powershell)\b') {
    Deny-Command '任意内容管道到 shell 执行，存在代码注入风险'
}
# 子展开/反引号包裹的危险命令（P0-04 一部分：剥壳后仍含 rm/Remove-Item）
if ($cmd -match '\$\([^)]*(?:rm|Remove-Item|del|rmdir|shutdown)|\x60[^\x60]*(?:rm|Remove-Item|del|rmdir|shutdown)\x60') {
    Deny-Command '命令子展开（$( )/反引号）内含危险操作，禁止'
}
# eval 包裹（P0-06：单双引号）
if ($cmd -match '\beval\s+["'']+[^"'']*(?:rm\s*-rf|Remove-Item|rmdir\s*/s)') {
    Deny-Command 'eval 包裹的危险命令，禁止'
}
if ($cmd -match '\b(?:bash|sh|pwsh|powershell)\s+-c\s+["'']+[^"'']*(?:rm\s*-rf|Remove-Item|rmdir\s*/s)') {
    Deny-Command 'shell -c 包裹的危险命令，禁止'
}

# 32) PowerShell 下载执行（P0-07 修复：IEX+Net.WebClient.DownloadString 经典变体）
if ($cmd -match '(?:iex|Invoke-Expression)\s*\([^)]*(?:Net\.WebClient|DownloadString|DownloadFile|WebClient)') {
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
if ($cmd -match '\bdocker\s+(?:system\s+prune|volume\s+(?:rm|prune)|container\s+prune)') {
    Deny-Command 'docker 批量清理（prune/volume rm）删除数据，禁止'
}

# 36) icacls 只读查询放行、写操作拦截（P1-02 修复：仅 /grant /deny /setintegritylevel 等拦）
if ($cmd -match '(?:^|[;&|\r\n])\s*icacls\b[^|;&\n]*(?:\/grant|\/deny|\/setintegritylevel|\/inheritancelevel:r)') {
    Deny-Command 'icacls 权限修改操作（system 路径），禁止'
}

# ===== 未匹配 — 放行 =====
Write-HookLog 'allow' $cmd
exit 0
