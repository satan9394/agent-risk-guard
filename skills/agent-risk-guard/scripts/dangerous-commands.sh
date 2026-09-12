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
# 2026-09-11 G15b-FIX2（复验打回后的修复）：
#   [R1] `-u` 与 `--user` 拆成两条规则（旧实现把「密码段须含非数字」守卫加在共用分支上，令
#        `curl -u alice:123456` 明文泄漏）；`--user` 额外锚定 curl/wget，非认证用法逐字不变。
#   [R2] mysql/mariadb 的全数字 `-p` 规则改为**命令词锚定**（段首/;&| 之后/sudo|env|command 之后），
#        消除 `ssh mysql -p2222 host`、`psql -h mysql -p5432` 的端口误伤。
#   [R2-生产路径] redact_cmd() 不再折叠换行（改为逐行脱敏 + 跨行 PEM 补脱敏 + JSON \n 转义），
#        使多行命令的生产输出与 core/ps1 逐字一致（旧实现会跨行命中别的命令的端口）。判定逻辑零改动。
# 注意：这与 .ps1 不同之处仅在平台相关项（reg delete / icacls / certutil 等 Windows 工具不在此列）

set -euo pipefail

# ===== 脱敏（G15b，2026-09-11）=======================================================
# canonical = packages/core/src/redact.ts 的 SECRET_RULES（14 条）。本段是它的 POSIX ERE 等价实现，
# 三端（core / ps1 / sh）语义一致性由 packages/core/test/redact-parity.test.ts 守住。
#
# 可移植性纪律（BSD/macOS 亦须工作）——本段不出现「词边界锚点」「空白类转义」「lookaround」这类
# GNU 扩展，也不使用 sed 的 GNU-only 大小写标志（下方注释用中文/英文名指代这些记号，以免机械 grep 误判）：
#   1) 词边界：三端**一律去掉词边界锚点**，改用「独特前缀 + 贪婪量词」；确需左边界者（-p/-u）
#      三端同形写作 (^|[^-A-Za-z0-9_])。去掉词边界锚点只增加命中，不减少 G15 既有覆盖。
#   2) 大小写不敏感：用运行时生成的 [Pp][Aa]… 字符类（一次 tr + bash 循环，兼容 macOS 自带 bash 3.2，
#      不依赖 bash4 的 ${var^^}）。
#   3) 空白类：一律 [[:space:]]。
# 与 ps1 的已知写法差异：跨行 PEM 在 ps1 用「惰性通配（可跨行、非贪婪）」，本侧 sed 逐行处理，
#   故在 redact_cmd() 内先把换行临时映射为 \002（非 '-'、非空白），再用 [^-]* 跨行匹配 PEM
#   （PEM 正文是 base64，不含 '-'，等价于「匹配到下一个 -----END 为止」的惰性语义）——这样**多块/多行
#   PEM 也能逐块替换**，与 core 的惰性量词结果一致（G15b-FIX 前为贪婪 .*，多块时会从第一个 BEGIN
#   吞到最后一个 END，与 core 不一致）。G15b-FIX2 起 redact_cmd() **不再**把换行折叠成空格（见该函数）。
# 注：本文件**判定规则段**另有一处 GNU 风格的词边界锚点（diskpart 那条 grep，属 G15 之前的既有代码、
#   不在脱敏路径上）；本卡不动它，以免改变判定结果（判定 CHANGED=0 是硬约束）。

# ci <word> → 大小写不敏感 ERE 片段：ci password → [Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]
ci() {
    local w="$1" up i out=""
    up=$(printf '%s' "$w" | tr '[:lower:]' '[:upper:]')
    for (( i = 0; i < ${#w}; i++ )); do
        out="${out}[${up:i:1}${w:i:1}]"
    done
    printf '%s' "$out"
}

# 键值对的「值」：双引号（可含空格）| 单引号（可含空格）| 不带引号的连续非空白（对齐 core 的 V）
REDACT_DQ='"'
REDACT_SQ="'"
# ⚠️ 可移植性陷阱（本轮实测踩到，勿改回）：POSIX 括号表达式内**反斜杠不是转义符**，`\]` 会被解析为
#    「排除反斜杠」+ 字面 `]`，令整条规则静默失效（aws_secret_access_key 空格形态因此漏脱敏）。
#    排除 `]` 的 POSIX 写法是把 `]` 放在 `^` 之后的首位：[^]'"'"'",;}[:space:]]（.NET/JS 用 \] 是对的）。
REDACT_VALUE="(${REDACT_DQ}[^${REDACT_DQ}]*${REDACT_DQ}|${REDACT_SQ}[^${REDACT_SQ}]*${REDACT_SQ}|[^]${REDACT_SQ}${REDACT_DQ},;}[:space:]]+)"

REDACT_CI_PASSWORD=$(ci password)
REDACT_CI_AUTHORIZATION=$(ci authorization)
REDACT_CI_BEARER=$(ci bearer)
REDACT_CI_BASIC=$(ci basic)
REDACT_CI_MYSQL=$(ci mysql)
REDACT_CI_MARIADB=$(ci mariadb)
# G15b-FIX2：mysql/mariadb 与 curl/wget 的**命令词锚定**前缀（对齐 core/ps1 的 ^|[;&|]\s*|sudo\s+|env\s+|command\s+）
REDACT_CI_SUDO=$(ci sudo)
REDACT_CI_ENV=$(ci env)
REDACT_CI_COMMAND=$(ci command)
# G15b-FIX3（P0）：锚点里的 `^` 三端**处理单位不同 → 语义不同**——core/ps1 是整串跑正则（`^` = 字符串开头），
#   本端 sed 是**逐行**处理（`^` = 行首）。故 core/ps1 侧给这两条规则加了 Multiline（`m` / 内联 `(?m)`，
#   见 packages/core/src/redact.ts L129/L146 与 dangerous-commands.ps1 同名规则），本端**无需改动**即已等价。
#   ⚠️ 本锚点（及任何含 `^` / `$` / `\n` 的规则）改动前，必须用**多行载荷**跑三端 parity（redact-parity PART B/C）。
REDACT_ANCHOR="(^[[:space:]]*|[;&|][[:space:]]*|${REDACT_CI_SUDO}[[:space:]]+|${REDACT_CI_ENV}[[:space:]]+|${REDACT_CI_COMMAND}[[:space:]]+)"
# generic-kv 键名（对齐 core：api_key|access_token|token|secret_key|client_secret|credential|secret|passwd）
REDACT_KEYS_GENERIC="$(ci api)[_-]?$(ci key)|$(ci access)[_-]?$(ci token)|$(ci token)|$(ci secret)[_-]?$(ci key)|$(ci client)[_-]?$(ci secret)|$(ci credential)|$(ci secret)|$(ci passwd)"
# aws-space-kv 键名（对齐 core：(aws_)?(secret_access_key|access_key_id|session_token)）
REDACT_KEYS_AWS="(($(ci aws)_)?)($(ci secret)_$(ci access)_$(ci key)|$(ci access)_$(ci key)_$(ci id)|$(ci session)_$(ci token))"

# 内部哨兵：规则替换先写入它，全部规则跑完后再统一映射为 [REDACTED]（sed 列表的最后一条）。
# 原因：若直接用 [REDACTED]，后一条键值规则会把前一条产出的 `[REDACTED`（值类排除 ]）再匹配一次，
# 留下多余的 `]`（实测 aws configure set aws_access_key_id AKIA… → `[REDACTED]]`）。三端同此处理。
REDACT_SENTINEL='@@RG_REDACTED@@'

# 对 stdin 文本做脱敏并输出（顺序与 core SECRET_RULES 完全一致：先专用后通用）
redact_text() {
    sed -E \
        -e "s#(AKIA|ASIA)[0-9A-Z]{16}#${REDACT_SENTINEL}#g" \
        -e "s#gh[pousr]_[A-Za-z0-9]{20,255}#${REDACT_SENTINEL}#g" \
        -e "s#sk-(proj-)?[A-Za-z0-9_-]{20,}#${REDACT_SENTINEL}#g" \
        -e "s#sk-ant-[A-Za-z0-9_-]{20,}#${REDACT_SENTINEL}#g" \
        -e "s#eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}#${REDACT_SENTINEL}#g" \
        -e "s#-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----[^-]*-----END (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----#${REDACT_SENTINEL}#g" \
        -e "s#\"?${REDACT_CI_PASSWORD}\"?[[:space:]]*[:=][[:space:]]*${REDACT_VALUE}#${REDACT_SENTINEL}#g" \
        -e "s#${REDACT_KEYS_AWS}([[:space:]]*[:=][[:space:]]*|[[:space:]]+)${REDACT_VALUE}#${REDACT_SENTINEL}#g" \
        -e "s#\"?(${REDACT_KEYS_GENERIC})\"?[[:space:]]*[:=][[:space:]]*${REDACT_VALUE}#${REDACT_SENTINEL}#g" \
        -e "s#${REDACT_CI_AUTHORIZATION}[[:space:]]*[:=][[:space:]]*(${REDACT_CI_BEARER}|${REDACT_CI_BASIC})[[:space:]]+[A-Za-z0-9._-]+#${REDACT_SENTINEL}#g" \
        -e "s#(^|[^-A-Za-z0-9_])-p[^[:space:]]*[^0-9[:space:]][^[:space:]]*#\1${REDACT_SENTINEL}#g" \
        -e "s#${REDACT_ANCHOR}(${REDACT_CI_MYSQL}|${REDACT_CI_MARIADB})([^;&|]*)([[:space:]])-p[0-9]+#\1\2\3\4${REDACT_SENTINEL}#g" \
        -e "s#(^|[^-A-Za-z0-9_])-u[[:space:]]+[^[:space:]:]+:[^[:space:]]+#\1${REDACT_SENTINEL}#g" \
        -e "s#${REDACT_ANCHOR}(curl|wget)([^;&|]*)([[:space:]]--user[[:space:]]+)[^[:space:]:]+:[^[:space:]]*[^0-9[:space:]:][^[:space:]]*#\1\2\3\4${REDACT_SENTINEL}#g" \
        -e "s#[A-Za-z0-9_-]{40,}#${REDACT_SENTINEL}#g" \
        -e "s#${REDACT_SENTINEL}#[REDACTED]#g"
}

# G15b 测试入口：--redact-stdin 从 stdin 读纯文本，输出脱敏结果后退出。
# 走的是**真实生产函数** redact_text（而非测试内复制的模式表），供跨端 parity 测试调用。
if [ "${1:-}" = "--redact-stdin" ]; then
    redact_text
    exit 0
fi

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
    echo "$inputJson" | grep -o "\"$field\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*"\([^"]*\)"/\1/'
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
    cmd=$(echo "$inputJson" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"/\1/')
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
# G15b-FIX（F1，2026-09-11）：**生产出口真正接到 redact_text()**（旧实现只有 2 条 sed，四类残留全泄漏）。
# G15b-FIX2（R2，2026-09-11）：**不再先折叠换行**——旧的 `tr '\n' ' '` 会让「命令词锚定」在生产路径失效，
#   使 `mysql …` 那一行把下一行 `ssh host -p2222` 的端口脱敏，而 ps1 不折叠 → 两端在同一份多行命令上发散
#   （且没有任何闸门覆盖：语料全是单行）。现改为「逐行脱敏 → 跨行 PEM 补脱敏 → JSON 转义时把换行写成
#   \n 转义」，生产出口与 core/ps1 的换行语义逐字一致。
# ⚠️ 教训：G15b 首轮只把新规则接进了 `--redact-stdin` 测试入口，生产出口漏接，导致 parity 恒绿而真实泄漏。
#    本函数是 deny_command() 的唯一出口，改动后必须由「生产出口断言 + M2 变异」把关（见 parity 测试）。
redact_cmd() {
    local safe
    # 1) 逐行脱敏：sed 天然按行处理，故命令词锚定的规则（-p / --user）不会跨原始行命中别的命令
    safe=$(printf '%s' "$cmd" | redact_text)
    # 2) 跨行 PEM 补脱敏：PEM 是三端唯一允许跨行的规则，而步骤 1 的逐行处理必然漏掉它。
    #    把换行临时映射为 \002（非 '-'、非空白）以便 [^-]* 跨过，跑完立即还原为换行；
    #    本趟只跑 PEM 规则，其余规则保持「不跨行」的语义。
    safe=$(printf '%s' "$safe" | tr '\n' '\002' \
        | sed -E "s#-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----[^-]*-----END (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----#${REDACT_SENTINEL}#g" \
        | sed -e "s#${REDACT_SENTINEL}#[REDACTED]#g" \
        | tr '\002' '\n')
    # 3) JSON 转义：\ -> \\、" -> \"、CR -> \r（sed）；换行 -> \n（awk：sed 的模式空间不含换行，
    #    只能逐行补写）。换行保留为 JSON 的 \n 转义（而非折叠成空格），与 core/ps1 一致。
    safe=$(printf '%s' "$safe" \
        | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\r/\\r/g' \
        | awk 'NR > 1 { printf "\\n" } { printf "%s", $0 }')
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
if printf '%s' "$cmdtest" | grep -qiE "${CMD_SEG}Remove-Item|${CMD_SEG}del([[:space:]]|-)|${CMD_SEG}erase([[:space:]]|-)|${CMD_SEG}ri([[:space:]]|-)|${CMD_SEG}rd([[:space:]]|-)|${CMD_SEG}rmdir([[:space:]]|-)|Clear-Content|\.Delete[[:space:]]*\("; then
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