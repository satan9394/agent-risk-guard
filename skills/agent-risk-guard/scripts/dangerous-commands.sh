#!/usr/bin/env bash
# dangerous-commands.sh — 跨 Agent 通用 PreToolUse hook（Linux/macOS 版）
# 兼容：Claude Code / Codex / Cursor / Goose / Grok / Hermes / Copilot CLI
# ⚠️ 输出形状仅 Claude Code / Codex（hookSpecificOutput.permissionDecision）实测；
#    Cursor/Goose/Grok/Hermes/Copilot 需真实会话验证输出格式，落地前先核对各家 hooks 文档。
# 输入：stdin JSON { tool_name, tool_input: { command }, ... }
# 输出：stdout JSON { hookSpecificOutput: { permissionDecision }, systemMessage }
# 退出码：0 = 已处理（允许或拒绝）
#
# 依赖：python3（JSON 解析，正确处理含转义引号的命令）；无 python3 时回退 grep（引号截断有 bug）
# 安装：chmod +x dangerous-commands.sh，然后在 hooks 配置中引用
# 2026-08-24：规则集与 dangerous-commands.ps1（Windows 版）同步（R2 向量 + git 破坏整类 + 子展开/管道防绕过）
# 注意：这与 .ps1 不同之处仅在平台相关项（reg delete / icacls / certutil 等 Windows 工具不在此列）

set -euo pipefail

# ---- 读取 stdin ----
inputJson=$(cat 2>/dev/null || true)
if [ -z "$inputJson" ]; then exit 0; fi

# P0 编码修复（2026-09-10 WSL/Git Bash 跨平台测试发现）：
# Git Bash 的 python3 常为 Windows 原生 build（Anaconda / msys ucrt），stdin 默认按 ANSI 代码页
# （GBK/cp936）解码 UTF-8，全角字符进管道即乱码 → NFKC 归一化失效 → 全角危险命令被放行。
# 强制 UTF-8 模式（对 Linux 无副作用）；并在 python3 内 reconfigure stdin/stdout 兜底。
export PYTHONUTF8=1

# ---- 提取 JSON 字段（优先 python3，fallback grep）----
# python3 正确处理转义引号；grep 方案在命令含 \" 时会截断（已实测 bug）
extract_field() {
    local field="$1"
    if command -v python3 >/dev/null 2>&1; then
        printf '%s' "$inputJson" | python3 -c 'import sys,json
sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")
try:
    d=json.load(sys.stdin)
    print(d.get(sys.argv[1], ""), end="")
except Exception:
    pass' "$field" 2>/dev/null && return 0
    fi
    echo "$inputJson" | grep -o "\"$field\"\s*:\s*\"[^\"]*\"" | head -1 | sed 's/.*"\([^"]*\)"/\1/'
    return 0
}

tool_name=$(extract_field tool_name <<< "$inputJson")
# 只拦截 shell 类工具（对应 .ps1 的 P0-12 修复：Bash/Shell/Command/Execute 等）
case "$tool_name" in
    Bash|Shell|Command|Execute|bash|shell|command|execute|zsh|fish|cmd)
        ;;
    *)
        exit 0 ;;
esac

# fail-open 修复（2026-09-10 测试发现）：set -euo pipefail 下 python3 缺失时，命令替换失败会
# 直接中止脚本（exit 127、无决策输出 → 静默放行），下方 grep 回退是死代码。改用显式 || 回退。
cmd=""
if command -v python3 >/dev/null 2>&1; then
    cmd=$(printf '%s' "$inputJson" | python3 -c 'import sys,json
sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")
try:
    d=json.load(sys.stdin)
    print(d.get("tool_input",{}).get("command",""), end="")
except Exception:
    pass' 2>/dev/null) || true
fi
if [ -z "$cmd" ]; then
    cmd=$(echo "$inputJson" | grep -o '"command"\s*:\s*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"/\1/')
fi
if [ -z "$cmd" ]; then exit 0; fi

# R15 修复（对齐 .ps1 与 core normalizeFullWidth）：NFKC 归一化（全角 ｒｍ → rm），防 Unicode 绕过
# 2026-09-10：加 || true 防 python3 缺失时 fail-open 中止；reconfigure 兜底 GBK 平台
if command -v python3 >/dev/null 2>&1; then
    cmd=$(printf '%s' "$cmd" | python3 -c 'import sys,unicodedata
sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")
print(unicodedata.normalize("NFKC", sys.stdin.read()), end="")') || true
fi

# ---- 纯注释行放行（对齐 .ps1） ----
case "$cmd" in
    ' '*|'#'*) if [ "${cmd%%[![:space:]]*}" = "#" ]; then exit 0; fi ;;
esac
# 简化：整行以 # 开头（允许前导空白）放行
if printf '%s' "$cmd" | grep -qE '^[[:space:]]*#'; then exit 0; fi

# ---- 辅助函数：返回拒绝（含脱敏 + JSON 转义）----
# 脱敏：回显命令前替换密钥/token；转义：\ -> \\, " -> \", 换行 -> \n，保证合法 JSON
redact_cmd() {
    local safe
    safe=$(printf '%s' "$cmd" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\r/\\r/g' | tr '\n' ' ')
    safe=$(printf '%s' "$safe" | sed -E 's/(api[_-]?key|token|secret|password|credential|authorization)[=:][[:space:]]*[A-Za-z0-9._~+\/-]{4,}/\1=[REDACTED]/Ig')
    safe=$(printf '%s' "$safe" | sed -E 's/(AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{16,}|sk_live-[A-Za-z0-9]{16,}|pk_live-[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{8,}|Bearer[[:space:]]+[A-Za-z0-9._~+\/-]{20,})/[REDACTED]/g')
    printf '%s' "$safe"
}

deny_command() {
    local reason="$1"
    local safe
    safe=$(redact_cmd)
    cat <<EOF
{"hookSpecificOutput":{"permissionDecision":"deny","updatedInput":null},"systemMessage":"HOOK BLOCKED: ${reason}\nCommand: ${safe}\nUse trash/recycle bin instead of permanent deletion."}
EOF
    exit 0
}

# ---- 命令边界匹配（对齐 .ps1：段首/分隔符锚定，防 echo rm 字符串误伤）----
# CMD_SEG：行首 或 分隔符(; & |) + 可选前导空白（含换行作为空格）
CMD_SEG='(^|[;&|])[[:space:]]*'
# echo/printf 引号参数剥离（对齐 .ps1 $cmdTest）：echo "xxx" → echo ""（无引号 rm 是真实危险，不剥）
cmdtest=$(printf '%s' "$cmd" | sed -E 's/(echo|printf)[[:space:]]+["'"'"'][^"'"'"']*["'"'"']/echo ""/g' | sed -E "s/print[[:space:]]*\(['\"][^'\"]*['\"]\)/print()/g")

# 1) POSIX 删除类（命令边界锚定；echo/printf 参数已剥离；R25：rm --help/-h/--version 无害）
if printf '%s' "$cmdtest" | grep -qE "${CMD_SEG}rmdir([[:space:]]|-)|${CMD_SEG}unlink([[:space:]]|-)|${CMD_SEG}shred([[:space:]]|-)"; then
    deny_command "POSIX permanent deletion (rmdir/unlink/shred). Use trash command."
fi
# rm：排除 --help/-h/--version（无害）；其余 rm 实参一律拦
if printf '%s' "$cmdtest" | grep -qE "(^|[;&|])[[:space:]]*rm([[:space:]]|-)"; then
    rmseg=$(printf '%s' "$cmdtest" | sed -nE 's/.*(^|[;&|])[[:space:]]*rm[[:space:]]*([^;&|]*)/\2/p' | head -1 | sed 's/[[:space:]]*$//')
    case "$rmseg" in
        -h|--help|-V|--version) ;;  # 帮助/版本 → 放行
        *) deny_command "rm is permanent deletion. Use trash command." ;;
    esac
fi

# 1b) PowerShell 删除类（R15 补齐：Remove-Item/del/erase，-i 大小写不敏感对齐 .ps1；R23 加 Clear-Content/.Delete；R25 加 ri/rd）
if printf '%s' "$cmdtest" | grep -qiE "${CMD_SEG}Remove-Item|${CMD_SEG}del([[:space:]]|-)|${CMD_SEG}erase([[:space:]]|-)|${CMD_SEG}ri([[:space:]]|-)|${CMD_SEG}rd([[:space:]]|-)|${CMD_SEG}rmdir([[:space:]]|-)|Clear-Content|\.Delete\s*\("; then
    deny_command "PowerShell/CMD permanent deletion (Remove-Item/del/erase/ri/rd/rmdir/Clear-Content/.Delete). Use trash command."
fi

# 引号插词 rm 变体（rm'' -rf / rm" " -rf / r''m，对齐 .ps1 16c；R25：实引号 + 任意引号内内容）
if printf '%s' "$cmdtest" | grep -qE "${CMD_SEG}rm[[:space:]]*[\"''][^;&|]*[[:space:]]*-[a-z]"; then
    deny_command "Quoted-word rm variant is permanent deletion."
fi
# 引号插词在命令名内（r''m / r""m）
if printf '%s' "$cmd" | grep -qE 'r["'"'"']+m([[:space:]]|-)'; then
    deny_command "Quoted-name rm variant is permanent deletion."
fi

# 2) find -delete / -exec rm
if printf '%s' "$cmd" | grep -qE 'find[^;&|\n]*-delete|find[^;&|\n]*-exec[^;&|\n]*rm'; then
    deny_command "find -delete/-exec rm is permanent deletion."
fi

# 3) xargs/for 批量 rm
if printf '%s' "$cmd" | grep -qE '(xargs[^;&|\n]*rm|for[^;]*(;|do)[^;]*rm)'; then
    deny_command "xargs/for rm is permanent deletion."
fi

# 3b) rm -rf 任意位置（对齐 .ps1 15 区：echo/printf 引号已由 cmdtest 剥离，无引号 echo rm -rf 也是真实危险）
if printf '%s' "$cmdtest" | grep -qE 'rm[[:space:]]+-r{0,1}f{0,1}[[:space:]]+'; then
    deny_command "rm -rf recursive delete is permanent deletion."
fi

# 4) Python 删除类（含 __import__/importlib 动态；用 cmdtest 防 print/echo 字符串误伤）
if printf '%s' "$cmdtest" | grep -qE 'shutil\.rmtree|os\.(remove|unlink|rmdir|removedirs)|pathlib[^;]*\.(unlink|rmdir)|__import__\(["'"'"']shutil["'"'"']\).*rmtree|importlib\.import_module\(["'"'"']shutil["'"'"']\).*rmtree'; then
    deny_command "Python permanent deletion detected. Use trash command."
fi

# 5) Python subprocess 动态执行（对齐 .ps1 33）
if printf '%s' "$cmd" | grep -qE 'subprocess\.(call|run|Popen|check_call|check_output)'; then
    deny_command "Python subprocess dynamic execution detected."
fi

# 6) Node.js 删除类
if printf '%s' "$cmd" | grep -qE 'fs\.(rmSync|unlinkSync|rmdirSync|rm\(|unlink\(|rmdir\()|fs\.promises\.rm|rimraf|fs-extra[^;]*remove'; then
    deny_command "Node.js permanent deletion detected. Use trash command."
fi

# 6b) Perl/Ruby 解释器 one-liner 删除类（2026-09-10 补：unlink 段首锚定匹配不到 -e/-E 参数中段）
if printf '%s' "$cmd" | grep -qE '(perl|ruby)[[:space:]]+-[eE][[:space:]]+["'"'"'][^"'"'"']*(unlink|rmdir|shred|File::delete|rm[[:space:]]*-rf)'; then
    deny_command "Perl/Ruby one-liner permanent deletion detected."
fi

# 7) Git 破坏性操作整类（对齐 .ps1 30 + R3：switch -C / worktree / force-with-lease 放宽）
# 2026-09-10 跨平台测试补缺口：checkout -- <file>、restore <file>（原只匹配整目录形态）、git rm
# 误伤防线：git restore --help/-h/--version 放行（restore 后跟 --help 不是破坏性操作）
if printf '%s' "$cmd" | grep -qE 'git[[:space:]]+restore[[:space:]]+--(help|version)'; then
    :
elif printf '%s' "$cmd" | grep -qE 'git[[:space:]]+(clean[[:space:]]+-f|reset[[:space:]]+--hard|checkout[[:space:]]+--([[:space:]]|$)|restore([[:space:]]|$)|switch[[:space:]]+-C)'; then
    deny_command "git irreversible operation (clean/reset/checkout/restore/switch -C) blocked."
fi
if printf '%s' "$cmd" | grep -qE 'git[[:space:]]+rm([[:space:]]|$)'; then
    deny_command "git rm permanently deletes tracked files (no recycle bin)."
fi
if printf '%s' "$cmd" | grep -qE 'git[[:space:]]+worktree[[:space:]]+remove[[:space:]]+--force'; then
    deny_command "git worktree remove --force discards changes."
fi
# R3+R4 修复：--force 后须空白/结尾（放开 --force-with-lease）；覆盖 -f 短标志（R4-01）
if printf '%s' "$cmd" | grep -qE 'git[[:space:]]+push[^;]*--force([[:space:]]|$)|git[[:space:]]+push[^;]*-f([[:space:]]|$)'; then
    deny_command "git push --force/-f overwrites remote history."
fi
if printf '%s' "$cmd" | grep -qE 'git[[:space:]]+branch[[:space:]]+-[dD]'; then
    deny_command "git branch -d/-D deletes branch."
fi
if printf '%s' "$cmd" | grep -qE 'git[[:space:]]+stash[[:space:]]+drop'; then
    deny_command "git stash drop deletes stash."
fi
# R3 新发现：wmic shadowcopy delete（勒索软件前置）
if printf '%s' "$cmd" | grep -qE 'wmic[^;]*(shadowcopy|shadowstorage)[^;]*delete|wmic[^;]*delete'; then
    deny_command "wmic delete (shadowcopy/system admin) blocked."
fi

# 8) 磁盘操作（diskpart/format 用命令边界匹配以防 echo 字符串误伤）
if printf '%s' "$cmd" | grep -qE "${CMD_SEG}diskpart\b|${CMD_SEG}mkfs\.|${CMD_SEG}fdisk|${CMD_SEG}parted|${CMD_SEG}wipefs"; then
    deny_command "Disk formatting/partitioning detected."
fi
if printf '%s' "$cmd" | grep -qE 'dd[[:space:]].*of=/dev/'; then
    deny_command "dd writing to device destroys data."
fi
if printf '%s' "$cmd" | grep -qE 'truncate[^;]*(/dev/|PhysicalDrive|\\\\\.\\\\)'; then
    deny_command "truncate to block device destroys data."
fi
if printf '%s' "$cmd" | grep -qE "${CMD_SEG}format[[:space:]]+[A-Za-z]:"; then
    deny_command "format destroys disk data."
fi

# 9) 远程代码执行（管道到 shell：任意来源，R25 补 base64/xxd/zcat/gunzip/bzip2/tar/xz）
if printf '%s' "$cmd" | grep -qE '(echo|cat|printf|tee|curl|wget|iwr|base64|xxd|zcat|gunzip|bzip2|tar|xz)[^|;]*\|[[:space:]]*(bash|sh|zsh|pwsh|powershell)'; then
    deny_command "Pipe to shell is code injection risk."
fi

# 10) 子展开 / 反引号包裹 + herestring（R25：`/<<< 任意位置）
if printf '%s' "$cmd" | grep -qE '\$\([^)]*(rm|Remove-Item|del|rmdir|shutdown)|`[^`]*(rm|Remove-Item|del|rmdir|shutdown)|<<<?[[:space:]]*["'"'"'][^"'"'"']*(rm[[:space:]]*-rf|rmdir[[:space:]]*/s)'; then
    deny_command "Command substitution / backtick / herestring with dangerous command."
fi

# 10b) 变量赋值危险 + 反斜杠/前导斜杠 rm（R25：X=rm; $X -rf / r\m / /rm）
if printf '%s' "$cmd" | grep -qE '=[[:space:]]*["'"'"']*rm([[:space:]]|["'"'"']|;|$)|=[[:space:]]*["'"'"']*Remove-Item([[:space:]]|["'"'"']|;|$)|(^|[;&|[:space:]])[\\/]{1,2}rm([[:space:]]|-)|r[\\/]m([[:space:]]|-)'; then
    deny_command "Variable assignment / backslash-prefixed rm (dangerous execute)."
fi

# 11) eval / shell -c 包裹（单双引号 + R25 变量间接 F="rm -rf"; eval $F）
if printf '%s' "$cmd" | grep -qE 'eval[[:space:]]+(\$[A-Za-z_0-9]+|["'"'"'][^"'"'"']*(rm[[:space:]]*-rf|rmdir[[:space:]]*/s))'; then
    deny_command "eval-wrapped dangerous command."
fi
if printf '%s' "$cmd" | grep -qE '(bash|sh|pwsh|powershell)[[:space:]]+-c[[:space:]]+(\$[A-Za-z_0-9]+|["'"'"'][^"'"'"']*(rm[[:space:]]*-rf|rmdir[[:space:]]*/s))'; then
    deny_command "shell -c wrapped dangerous command."
fi

# 12) 系统级操作（无尾随空格变体，对齐 .ps1 28）
if printf '%s' "$cmd" | grep -qE '(^|[;&|[:space:]])(sudo[[:space:]]+)?(shutdown|reboot|halt|poweroff)([[:space:]]|$)'; then
    deny_command "System shutdown/reboot blocked."
fi

# 13) chmod 全局权限（无 -R 也拦，对齐 .ps1 29）
if printf '%s' "$cmd" | grep -qE '(^|[;&|[:space:]])chmod[[:space:]]+(-[^[:space:]]+[[:space:]]+)?(777|0777|a\+rwx)[[:space:]]+'; then
    deny_command "chmod global permission (777) is a security risk."
fi

# 14) docker 破坏扩展（对齐 .ps1 35 + R4-03：volume prune；R25 补 exec）
if printf '%s' "$cmd" | grep -qE 'docker[[:space:]]+(system[[:space:]]+prune|volume[[:space:]]+(rm|prune)|container[[:space:]]+prune|run[^;]*(rm|rmdir)|exec[^;]*(rm|rmdir))'; then
    deny_command "docker prune/volume rm/container delete destroys data."
fi

# 15) git gc --prune / reflog expire（R2）
if printf '%s' "$cmd" | grep -qE 'git[[:space:]]+gc[^;]*--prune|git[[:space:]]+reflog[[:space:]]+expire'; then
    deny_command "git gc --prune / reflog expire destroys history."
fi

# 16) 引号插词 rm（rm''-rf，对齐 .ps1 16c；R25：需实引号，rm -h 不误伤）
if printf '%s' "$cmd" | grep -qE '(^|[;&|[:space:]])rm[[:space:]]*["'"'"'][^[:space:]]*[[:space:]]*-[a-z]'; then
    deny_command "Quoted-word rm variant is permanent deletion."
fi

# 17) Windows/系统工具（R25 补齐对齐 ps1：certutil/reg/net/bcdedit/takeown/icacls/.NET/IEX）
if printf '%s' "$cmd" | grep -qiE 'certutil.*(-urlcache|-decode)|reg[[:space:]]+delete|bcdedit[[:space:]]+/delete|takeown.*(system32|windows)|icacls.*(/grant|/deny|/setintegritylevel)|net[[:space:]]+(user|localgroup)|\[(system\.)?io\.(file|directory)\]::delete|clear-disk.*-number|format-volume|iex[[:space:]]*\([^)]*(webclient|downloadstring)|invoke-expression.*(webclient|downloadstring)'; then
    deny_command "Windows/system tool destructive operation blocked."
fi

# 18) fork bomb
case "$cmd" in
    *':(){'*|*':|:&'*|*'};:'*) deny_command "Fork bomb detected." ;;
esac

# ===== 未匹配 — 放行 =====
exit 0