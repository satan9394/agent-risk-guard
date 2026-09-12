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
# 2026-09-11 G5（P0 安全：sh 端畸形输入 fail-open → fail-closed）：
#   [F1] 空 stdin / 畸形 JSON / 缺 command 字段一律输出 **deny JSON 并 exit 0**（旧实现：前两者静默放行，
#        后者因 grep 回退在 `set -e` 下退出 1 而中止 → 无决策输出）。判定规则零改动。
#   [F2] `redact_cmd()` 步骤 3 的 JSON 转义补齐**全部 C0 控制字符（含 TAB）**——旧实现只转义 \ " CR 与换行，
#        命令含 TAB 时输出非法 JSON（调用方 JSON.parse 失败 → 相当于放行）。
#   [F3] 纯注释放行改为「整串第一个非空白字符是 #」（旧实现用逐行锚点，`危险命令\n# 注释` 被提前放行）。
# 2026-09-11 G3（跨端判定收敛 + 跨端判定闸门）：
#   [T3] 空引号归一：判定前只删除**空引号对**（'' / ""）→ `rm'' --help` ≡ `rm --help`（放行），
#        而 `rm'' -rf /tmp/t` → `rm -rf /tmp/t` **仍然 deny**（归一后照常跑全部规则，无短路）。
#        注意：回显/脱敏仍用**原始命令**（cmdOrig），故生产出口与 core/ps1 的逐字一致性不变。
#   [T5/T2 + 大小写整类] 判定规则 grep 一律 `-i`（ps1 的 `-match` 默认大小写不敏感，本侧旧实现漏了）；
#        唯一例外 `git switch -C` 保持**大小写敏感**（ps1 L481 用 -cmatch 精确大写，`-c` 为安全的新建分支）。
#   [T9/T10] command 非字符串按 PowerShell `[string]` 转换语义处理：null → 缺字段 deny；`[]`/`{}` →
#        空串 deny；`["rm","-rf","/tmp/t"]` → "rm -rf /tmp/t" deny；`123`/`true`/`{"a":1}` → 同 ps1 放行。
#   以上跨端一致性由 packages/core/test/decision-parity.test.ts 守住（真实 spawn + 进程 stdin）。
#
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

# ---- 辅助函数：拒绝出口（含脱敏 + JSON 转义）----------------------------------------
# G5 重排：本块**必须在读取 stdin 之前定义**——空输入 / 畸形 JSON 也要经由 deny_command 输出决策
#   JSON；旧实现这两条路径落在函数定义之前（`exit 0` 无输出）→ 静默放行。
# 脱敏：回显命令前替换密钥/token；转义：见 json_escape_text()（\ " 与全部 C0 控制字符）
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
    # G3：回显/脱敏用**原始命令**（空引号归一前的 cmdOrig），保证生产出口与 core/ps1 逐字一致
    safe=$(printf '%s' "$cmdOrig" | redact_text)
    # 2) 跨行 PEM 补脱敏：PEM 是三端唯一允许跨行的规则，而步骤 1 的逐行处理必然漏掉它。
    #    把换行临时映射为 \002（非 '-'、非空白）以便 [^-]* 跨过，跑完立即还原为换行；
    #    本趟只跑 PEM 规则，其余规则保持「不跨行」的语义。
    safe=$(printf '%s' "$safe" | tr '\n' '\002' \
        | sed -E "s#-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----[^-]*-----END (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----#${REDACT_SENTINEL}#g" \
        | sed -e "s#${REDACT_SENTINEL}#[REDACTED]#g" \
        | tr '\002' '\n')
    # 3) JSON 转义（G5：原为「\ \" CR + 换行」四条，TAB 等 C0 控制字符原样输出 → JSON 非法）
    json_escape_text "$safe"
}

# JSON 字符串转义（G5 新增，POSIX awk，不依赖 GNU 扩展）。
# 旧实现只处理 `\`、`"`、CR、换行；**TAB 以及其余 C0 控制字符（U+0000–U+001F）按 JSON 规范必须转义**，
# 否则 deny JSON 无法被 JSON.parse 解析——调用方拿不到 permissionDecision，等价于放行（实测复现）。
# 换行仍写成 \n 转义（而非折叠成空格），与 core/ps1 的生产语义逐字一致（G15b-FIX2 不变量）。
json_escape_text() {
    printf '%s' "$1" | awk '
    BEGIN {
        for (i = 1; i <= 31; i++) {
            c = sprintf("%c", i)
            if (i == 8) e = "\\b"
            else if (i == 9) e = "\\t"
            else if (i == 10) e = "\\n"
            else if (i == 12) e = "\\f"
            else if (i == 13) e = "\\r"
            else e = sprintf("\\u%04x", i)
            m[c] = e
        }
    }
    {
        out = ""
        n = length($0)
        for (j = 1; j <= n; j++) {
            ch = substr($0, j, 1)
            if (ch == "\\") out = out "\\\\"
            else if (ch == "\"") out = out "\\\""
            else if (ch in m) out = out m[ch]
            else out = out ch
        }
        if (NR > 1) printf "\\n"
        printf "%s", out
    }'
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

# G15b 测试入口：--redact-stdin 从 stdin 读纯文本，输出脱敏结果后退出。
# 走的是**真实生产函数** redact_text（而非测试内复制的模式表），供跨端 parity 测试调用。
if [ "${1:-}" = "--redact-stdin" ]; then
    redact_text
    exit 0
fi

# ---- 读取 stdin（G5：空输入不再放行，交由下方 fail-closed 状态机处理）----
cmd=""
cmdOrig=""
tool_name=""
inputJson=$(cat 2>/dev/null || true)

# P0 编码修复（2026-09-10 WSL/Git Bash 跨平台测试发现）：
# Git Bash 的 python3 常为 Windows 原生 build（Anaconda / msys ucrt），stdin 默认按 ANSI 代码页
# （GBK/cp936）解码 UTF-8，全角字符进管道即乱码 → NFKC 归一化失效 → 全角危险命令被放行。
# 强制 UTF-8 模式（对 Linux 无副作用）；并在 python3 内 reconfigure stdin/stdout 兜底。
export PYTHONUTF8=1

# ===== G5（2026-09-11）：输入解析 fail-closed 状态机（对齐 .ps1 L177-206）=================
# 旧实现的三个出口都不合格（编排者 + 本轮实测复现，见 _g5_before_probe.txt）：
#   ① 空 stdin：`if [ -z "$inputJson" ]; then exit 0; fi` → 无输出、exit 0 = **静默放行**；
#   ② 畸形 JSON：python 分支 `except: pass` 吞掉异常 → cmd 为空 → 同一出口 **静默放行**；
#   ③ 缺 command 字段：grep 回退无匹配时 grep 退出 1，`set -euo pipefail` 直接中止 → **exit 1、无输出**
#      （decision JSON 没产出，调用方同样拿不到 deny）——即「裸 exit 1」违反 exit-0 契约。
# 现按 ps1 语义：**解析成功才谈判定**；解析失败一律 deny，且 deny 也 exit 0（拒绝是决策，不是错误）。
#
# p_status 取值（一次 python3 调用给出单行两字段 "状态<TAB>tool_name"）：
#   OK        解析成功且 tool_input.command 存在
#   NO_TI     tool_input 缺失或不是对象            → shell 工具则 deny
#   NO_CMD    tool_input 是对象但没有 command 键   → shell 工具则 deny
#   NOT_OBJ   合法 JSON 但不是对象（ps1 取不到 tool_name → 放行，此处保持一致）
#   PARSE_ERR 解析失败（含空输入、python3 崩溃）→ deny
#   GREP      无 python3，走 grep 回退（**不得放宽**：解析不了 command 就不放行）
if command -v python3 >/dev/null 2>&1; then
    parsed=$(printf '%s' "$inputJson" | python3 -c 'import sys,json
sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")
def sane(v):
    return (v if isinstance(v,str) else ("" if v is None else str(v))).replace("\t"," ").replace("\n"," ").replace("\r"," ")
try:
    d=json.loads(sys.stdin.read())
except Exception:
    print("PARSE_ERR\t", end=""); sys.exit(0)
if not isinstance(d,dict):
    print("NOT_OBJ\t", end=""); sys.exit(0)
tn=sane(d.get("tool_name"))
ti=d.get("tool_input")
if not isinstance(ti,dict):
    print("NO_TI\t"+tn, end=""); sys.exit(0)
if "command" not in ti or ti.get("command") is None:
    # G3/T9：JSON null 与「缺 command 键」同义（对齐 ps1 L204 的 `$null -eq ...command`）→ deny
    print("NO_CMD\t"+tn, end=""); sys.exit(0)
print("OK\t"+tn, end="")' 2>/dev/null) || parsed=""
    # 协议字段用 TAB 分隔；python3 已把 tool_name 内的 TAB/换行折叠为空格，故解析仍是单行两字段
    tab=$(printf '\t')
    p_status=${parsed%%"$tab"*}
    tool_name=${parsed#*"$tab"}
    tool_name=${tool_name%%"$tab"*}
    # python3 崩溃/无输出 → 视为解析失败（fail-closed，与 ps1 L187/L193 的 except 分支同义）
    [ -n "$p_status" ] || p_status="PARSE_ERR"
else
    # ---- 无 python3：grep 回退（保留原有能力，且不得放宽）----
    p_status="GREP"
    tool_name=$(echo "$inputJson" | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"/\1/') || true
fi

# ① 解析失败 → deny（ps1 L189/L193；空输入另给更具体的文案）
if [ "$p_status" = "PARSE_ERR" ]; then
    if [ -z "$(printf '%s' "$inputJson" | tr -d '[:space:]')" ]; then
        deny_command "hook 收到空输入（未提供命令）"
    fi
    deny_command "JSON 解析失败，无法确认命令安全"
fi

# ② 只拦截 shell 类工具（对应 .ps1 的 P0-12 与 L199-201：未知/缺失 tool_name → 放行）
case "$tool_name" in
    Bash|Shell|Command|Execute|bash|shell|command|execute|zsh|fish|cmd)
        ;;
    *)
        exit 0 ;;
esac

# ③ shell 工具：command 缺失/为空 → deny（ps1 L204/L206；旧实现分别是 exit 1 与 exit 0 放行）
if [ "$p_status" = "NO_TI" ] || [ "$p_status" = "NO_CMD" ]; then
    deny_command "shell 工具 (${tool_name}) 缺少 command 字段"
fi

# fail-open 修复（2026-09-10 测试发现）：set -euo pipefail 下 python3 缺失时，命令替换失败会
# 直接中止脚本（exit 127、无决策输出 → 静默放行），下方 grep 回退是死代码。改用显式 || 回退。
if command -v python3 >/dev/null 2>&1; then
    cmd=$(printf '%s' "$inputJson" | python3 -c 'import sys,json
from decimal import Decimal
sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")
def ps_num(f):
    # G3-FIX4/R4：把 Python float 渲染成 **.NET double 默认 ToString()（G 格式）** 的近似值。
    # 实测口径（`_g3fix4_float_probe*.mjs`，逐条真跑 ps1 的 `[string]$data.tool_input.command`）：
    #   定点 ↔ 科学 的分界 = 十进制指数 e10 ∈ [-4, 14] 用**定点**，否则用科学记数；
    #     1e2→"100"、0.1→"0.1"、0.0001→"0.0001"、123456789012345.6→"123456789012345.6"
    #     1e15→"1E+15"、1e16→"1E+16"、1.5e16→"1.5E+16"、1e21→"1E+21"
    #     1e-5→"1E-05"、1e-6→"1E-06"、1.5e-6→"1.5E-06"、1e-15→"1E-15"、-1e-5→"-1E-05"
    #   科学记数的指数一律**大写 E + 符号 + 至少两位**；尾数去掉多余 ".0"。
    # ⚠️ 这是**近似**，不是忠实复刻。已知残差来自 PowerShell 5.1 的 ConvertFrom-Json **数字类型映射**：
    #   无指数的十进制字面量（`0.00001`）被解析成 Decimal → [string] 保持定点 "0.00001"；
    #   带指数的字面量（`1e-5`）被解析成 Double → [string] 走上面的 G 格式 "1E-05"。
    #   二者是**同一个 double 值**，Python 侧拿不到原始字面量文本，故无法区分——已实测登记该残差类。
    #   **该残差对本产品的 permissionDecision 无任何影响**（两种渲染都不命中任何规则）。
    if f != f: return "NaN"
    if f == float("inf"): return "Infinity"
    if f == float("-inf"): return "-Infinity"
    r = repr(f)
    if "e" in r:
        e10 = int(r.split("e")[1])
    else:
        s = r.lstrip("-")
        if s.startswith("0."):
            frac = s[2:]
            e10 = -(len(frac) - len(frac.lstrip("0")) + 1)
        else:
            e10 = len(s.split(".")[0]) - 1
    d = Decimal(r)
    if -4 <= e10 <= 14:
        out = format(d, "f")
        if "." in out: out = out.rstrip("0").rstrip(".")
        return out if out not in ("", "-") else "0"
    t = abs(d).normalize().as_tuple()
    digits = "".join(str(x) for x in t.digits)
    exp10 = t.exponent + len(digits) - 1
    mant = (digits[0] + ("." + digits[1:] if len(digits) > 1 else "")).rstrip("0").rstrip(".")
    return ("-" if d < 0 else "") + mant + "E" + ("+" if exp10 >= 0 else "-") + str(abs(exp10)).rjust(2, "0")
def ps_cast(v):
    # G3/T9/T10 + G3-FIX4：把 JSON 值渲染成 PowerShell `[string]` 的**近似**结果
    #   （ps1 L205 `[string]$data.tool_input.command`）。
    # ⚠️ 声明口径（G3-FIX4/R4 更正）：**不得**称其为"忠实复刻"。它是**逐条实测校准**的近似实现；
    #    已实测对齐的形态：null / true / false / str / int / float / [] / 顶层 dict / 数组按空格拼接 /
    #    嵌套数组；剩余差异（若有）逐条登记在 IMPLEMENTATION_RESULT_G3-FIX4.md 的「ps_cast 语义表」。
    if v is None: return ""
    if v is True: return "True"
    if v is False: return "False"
    if isinstance(v,str): return v
    if isinstance(v,int): return str(v)
    if isinstance(v,float): return ps_num(v)
    if isinstance(v,list): return " ".join(ps_elem(x) for x in v)
    if isinstance(v,dict):
        if not v: return ""          # 空对象 → "" → 落「command 为空」分支 deny（ps1 实测同）
        return "@{" + "; ".join(str(k)+"="+ps_elem(x) for k,x in v.items()) + "}"
    return str(v)
def ps_elem(v):
    # 数组元素位 / 哈希值位的渲染（实测 PowerShell）：
    #   list → "System.Object[]"（`[["rm"]]` 实测吻合，保留）
    #   dict → ""                （`[{"a":1}]` → ""；`{"a":{"b":1}}` → "@{a=}"；**不是**类型名）
    # G3-FIX4/R2（fail-open 回归）：旧实现 dict 分支返回 "System.Management.Automation.PSCustomObject"
    #   → `command:[{"cmd":"rm -rf /tmp/t"}]` 得到非空字串 → 绕过「command 为空 → deny」→ sh 由 deny 变 allow。
    if isinstance(v,list): return "System.Object[]"
    if isinstance(v,dict): return ""
    return ps_cast(v)
try:
    d=json.load(sys.stdin)
    print(ps_cast(d.get("tool_input",{}).get("command","")), end="")
except Exception:
    pass' 2>/dev/null) || true
fi
if [ -z "$cmd" ]; then
    # G5：补 `|| true`——旧实现此行没有保护，grep 无匹配时返回 1，`set -e` 直接中止脚本（裸 exit 1）
    cmd=$(echo "$inputJson" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"/\1/') || true
fi
# shell 工具但 command 为空/仅空白 → deny（旧实现 exit 0 放行）
if [ -z "$(printf '%s' "$cmd" | tr -d '[:space:]')" ]; then
    deny_command "shell 工具 (${tool_name}) 的 command 为空"
fi

# R15 修复（对齐 .ps1 与 core normalizeFullWidth）：NFKC 归一化（全角 ｒｍ → rm），防 Unicode 绕过
# 2026-09-10：加 || true 防 python3 缺失时 fail-open 中止；reconfigure 兜底 GBK 平台
if command -v python3 >/dev/null 2>&1; then
    cmd=$(printf '%s' "$cmd" | python3 -c 'import sys,unicodedata
sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")
print(unicodedata.normalize("NFKC", sys.stdin.read()), end="")') || true
fi

# ===== G3-FIX4/R1：空引号归一**只给 rm / Remove-Item 删除族**（对齐 ps1 L222 `$cmdNaked`）=========
# G3/T3 的原始意图：`rm'' --help` 在 ps1 侧等价于 `rm --help` → 放行；本侧引号插词规则把它当
#   「引号插词的 rm」直接 deny → 误拦。
# G3 的错误：把归一**施加到全部规则**（`cmd` 被就地替换），而 ps1 **只在删除族**用剥离引号的文本
#   （ps1 L222 定义 `$cmdNaked`，ps1 L374/L378 起**仅** rm / Remove-Item 使用它）。于是凡「删除族之外」
#   的命令被空引号插词（`g''it clean -f` / `s''hutdown /s` / `c''hmod 777` / `r''mdir /s` / `un''link` …）
#   都会在 sh 侧命中、在 ps1 侧不命中 → **13 条新跨端分歧**（Evaluator G3 §2.2b R1 实测）。
# G3-FIX4 修法：`cmd` 保持原样（其余全部规则照旧用它），另存 `cmdNoq`（= 删空引号对后的文本），
#   **只**喂给 rm / Remove-Item 族规则：L360 bare rm、L370b Remove-Item 补查、L375 引号插词 rm、
#   L379 r..m、L394 rm -rf 任意位置；对应的 echo/printf 剥离版为 cmdtestNoq（见下方 L353 区）。
# 归一方向恒为「多看见」：删空引号只会让命令词与分隔符**相邻**（`;''rm` → `;rm`、`r''m` → `rm`），
#   不会把危险词藏起来，故不构成新的绕过面（邻居面钉在 decision-parity.test.ts B 段 Q1–Q12）。
# 回显/脱敏用原始命令 cmdOrig（见 redact_cmd），故 deny JSON 与 core/ps1 的逐字一致性不受影响。
cmdOrig="$cmd"
cmdNoq=$(printf '%s' "$cmd" | sed -E "s/''//g; s/\"\"//g")

# ---- 纯注释命令放行（对齐 .ps1 L215 的「整串开头 `\s*#`」语义）----
# G5：旧实现用 grep 的**逐行**锚点 `^[[:space:]]*#`，任一行以 # 开头即放行，于是
#   `rm -rf /tmp/t\n# note`（首行危险、次行注释）被提前放行 = fail-open（ps1 为 deny）。
#   `tr -d '[:space:]'` 去掉全部空白（含换行）后取首字符，即「整串第一个非空白字符」，
#   与 ps1 的 `^\s*#`（`^`=字符串开头，`\s*` 可跨行）等价。判定结果对单行命令逐字不变。
case "$(printf '%s' "$cmd" | tr -d '[:space:]' | cut -c1)" in
    '#') exit 0 ;;
esac

# ---- 命令边界匹配（对齐 .ps1：段首/分隔符锚定，防 echo rm 字符串误伤）----
# CMD_SEG：行首 或 分隔符(; & |) + 可选前导空白（含换行作为空格）
CMD_SEG='(^|[;&|])[[:space:]]*'
# echo/printf 引号参数剥离（对齐 .ps1 $cmdTest）：echo "xxx" → echo ""（无引号 rm 是真实危险，不剥）
cmdtest=$(printf '%s' "$cmd" | sed -E 's/(echo|printf)[[:space:]]+["'"'"'][^"'"'"']*["'"'"']/echo ""/g' | sed -E "s/print[[:space:]]*\(['\"][^'\"]*['\"]\)/print()/g")
# G3-FIX4/R1：同一剥离规则施加到**空引号归一后**的 cmdNoq 上——rm / Remove-Item 删除族专用。
#   ps1 侧对应物是 $cmdNaked（= $cmdTest 再去引号，ps1 L223），故这里先 $cmdTest 再归一，顺序等价。
cmdtestNoq=$(printf '%s' "$cmdNoq" | sed -E 's/(echo|printf)[[:space:]]+["'"'"'][^"'"'"']*["'"'"']/echo ""/g' | sed -E "s/print[[:space:]]*\(['\"][^'\"]*['\"]\)/print()/g")

# 1) POSIX 删除类（命令边界锚定；echo/printf 参数已剥离；R25：rm --help/-h/--version 无害）
if printf '%s' "$cmdtest" | grep -qiE "${CMD_SEG}rmdir([[:space:]]|-)|${CMD_SEG}unlink([[:space:]]|-)|${CMD_SEG}shred([[:space:]]|-)"; then
    deny_command "POSIX permanent deletion (rmdir/unlink/shred). Use trash command."
fi
# rm：排除 --help/-h/--version（无害）；其余 rm 实参一律拦
# G3-FIX4/R1：改用 **cmdtestNoq**（空引号归一后的文本）——这是 rm 族，与 ps1 rule 16 同口径。
if printf '%s' "$cmdtestNoq" | grep -qiE "(^|[;&|])[[:space:]]*rm([[:space:]]|-)"; then
    # G3/T5：rmseg 抽取前先小写（sed 的 I 标志是 GNU-only，本文件禁用），保证 `RM --help` 亦判为无害
    rmseg=$(printf '%s' "$cmdtestNoq" | tr '[:upper:]' '[:lower:]' | sed -nE 's/.*(^|[;&|])[[:space:]]*rm[[:space:]]*([^;&|]*)/\2/p' | head -1 | sed 's/[[:space:]]*$//')
    case "$rmseg" in
        -h|--help|-v|--version) ;;  # 帮助/版本 → 放行（小写化后比较，-h/-H/-V/-v 与 ps1 同义）
        *) deny_command "rm is permanent deletion. Use trash command." ;;
    esac
fi

# 1b) PowerShell 删除类（R15 补齐：Remove-Item/del/erase，-i 大小写不敏感对齐 .ps1；R23 加 Clear-Content/.Delete；R25 加 ri/rd）
# G3-FIX4/R1：本规则**保持用未归一的 cmdtest**——ps1 侧 rmdir/del/erase/ri/rd 只查 $cmdTest（ps1 L297–L311），
#   不做引号剥离；若此处吃 cmdtestNoq，`r''mdir /s` 会被误拦（ps1 allow）→ 反向制造 R1 型分歧。
if printf '%s' "$cmdtest" | grep -qiE "${CMD_SEG}Remove-Item|${CMD_SEG}del([[:space:]]|-)|${CMD_SEG}erase([[:space:]]|-)|${CMD_SEG}ri([[:space:]]|-)|${CMD_SEG}rd([[:space:]]|-)|${CMD_SEG}rmdir([[:space:]]|-)|Clear-Content|\.Delete[[:space:]]*\("; then
    deny_command "PowerShell/CMD permanent deletion (Remove-Item/del/erase/ri/rd/rmdir/Clear-Content/.Delete). Use trash command."
fi
# 1b-2) G3-FIX4/R1：Remove-Item 的**空引号插词**补查（对齐 ps1 16e L378 的 $cmdNaked `\bRemove-Item\b`）。
#   这是唯一需要「归一文本」的非 rm 词条，故单列一条，避免把归一泄漏给 del/erase/ri/rd/rmdir。
if printf '%s' "$cmdtestNoq" | grep -qiE '\bRemove-Item\b'; then
    deny_command "PowerShell/CMD permanent deletion (Remove-Item/del/erase/ri/rd/rmdir/Clear-Content/.Delete). Use trash command."
fi

# 引号插词 rm 变体（rm'' -rf / rm" " -rf / r''m，对齐 .ps1 16c；R25：实引号 + 任意引号内内容）
# G3-FIX4/R1：rm 族 → 用 cmdtestNoq。
if printf '%s' "$cmdtestNoq" | grep -qiE "${CMD_SEG}rm[[:space:]]*[\"''][^;&|]*[[:space:]]*-[a-z]"; then
    deny_command "Quoted-word rm variant is permanent deletion."
fi
# 引号插词在命令名内（r''m / r""m）——G3-FIX4/R1：rm 族 → cmdtestNoq；
#   单引号奇数次（r"m / r'm）不会被空引号归一消除，仍由本条的 ["']+ 兜住（与 ps1 $cmdNaked 同口径）。
if printf '%s' "$cmdtestNoq" | grep -qiE 'r["'"'"']+m([[:space:]]|-)'; then
    deny_command "Quoted-name rm variant is permanent deletion."
fi

# 2) find -delete / -exec rm
# G3-FIX4/R3-审计：补前导锚 `(^|[;&|])[[:space:]]*`，对齐 ps1 L333/L337 的 `(?:^|[;&|\r\n])\s*find\b`。
#   旧实现**完全没有前导锚**，`-i` 之后 `git commit -m "always FIND -delete carefully"` 这类引号内文本被点着 → 新过拦。
if printf '%s' "$cmd" | grep -qiE '(^|[;&|])[[:space:]]*find[^;&|\n]*-delete|(^|[;&|])[[:space:]]*find[^;&|\n]*-exec[^;&|\n]*rm'; then
    deny_command "find -delete/-exec rm is permanent deletion."
fi

# 3) xargs/for 批量 rm
# G3-FIX4/R3-审计：同上补前导锚，对齐 ps1 L340 的 `(?:^|[;&|\r\n])\s*(?:\bxargs\b…|\bfor\b…)`。
if printf '%s' "$cmd" | grep -qiE '(^|[;&|])[[:space:]]*(xargs[^;&|\n]*rm|for[^;]*(;|do)[^;]*rm)'; then
    deny_command "xargs/for rm is permanent deletion."
fi

# 3b) rm -rf 任意位置（对齐 .ps1 15 区：echo/printf 引号已由 cmdtest 剥离，无引号 echo rm -rf 也是真实危险）
# G3-FIX4/R1：rm 族 → cmdtestNoq（`rm'' -rf` 归一后由此条兜住）。
if printf '%s' "$cmdtestNoq" | grep -qiE 'rm[[:space:]]+-r{0,1}f{0,1}[[:space:]]+'; then
    deny_command "rm -rf recursive delete is permanent deletion."
fi

# 4) Python 删除类（含 __import__/importlib 动态；用 cmdtest 防 print/echo 字符串误伤）
if printf '%s' "$cmdtest" | grep -qiE 'shutil\.rmtree|os\.(remove|unlink|rmdir|removedirs)|pathlib[^;]*\.(unlink|rmdir)|__import__\(["'"'"']shutil["'"'"']\).*rmtree|importlib\.import_module\(["'"'"']shutil["'"'"']\).*rmtree'; then
    deny_command "Python permanent deletion detected. Use trash command."
fi

# 5) Python subprocess 动态执行（对齐 .ps1 33）
if printf '%s' "$cmd" | grep -qiE 'subprocess\.(call|run|Popen|check_call|check_output)'; then
    deny_command "Python subprocess dynamic execution detected."
fi

# 6) Node.js 删除类
if printf '%s' "$cmd" | grep -qiE 'fs\.(rmSync|unlinkSync|rmdirSync|rm\(|unlink\(|rmdir\()|fs\.promises\.rm|rimraf|fs-extra[^;]*remove'; then
    deny_command "Node.js permanent deletion detected. Use trash command."
fi

# 6b) Perl/Ruby 解释器 one-liner 删除类（2026-09-10 补：unlink 段首锚定匹配不到 -e/-E 参数中段）
if printf '%s' "$cmd" | grep -qiE '(perl|ruby)[[:space:]]+-[eE][[:space:]]+["'"'"'][^"'"'"']*(unlink|rmdir|shred|File::delete|rm[[:space:]]*-rf)'; then
    deny_command "Perl/Ruby one-liner permanent deletion detected."
fi

# 7) Git 破坏性操作整类（对齐 .ps1 30 + R3：switch -C / worktree / force-with-lease 放宽）
# 2026-09-10 跨平台测试补缺口：checkout -- <file>、restore <file>（原只匹配整目录形态）、git rm
# 误伤防线：git restore --help/-h/--version 放行（restore 后跟 --help 不是破坏性操作）
# G3：本节整类改 -i（对齐 ps1 的 -match 默认大小写不敏感）。**唯一例外** `git switch -C` 保持
#   大小写敏感——ps1 L481 用 -cmatch 精确大写，而 `-c` 是安全的新建分支（sh-hook-test 有 allow 用例）。
if printf '%s' "$cmd" | grep -qiE 'git[[:space:]]+restore[[:space:]]+--(help|version)'; then
    :
elif printf '%s' "$cmd" | grep -qiE 'git[[:space:]]+(clean[[:space:]]+-f|reset[[:space:]]+--hard|checkout[[:space:]]+--([[:space:]]|$)|restore([[:space:]]|$))' || printf '%s' "$cmd" | grep -qE 'git[[:space:]]+switch[[:space:]]+-C'; then
    deny_command "git irreversible operation (clean/reset/checkout/restore/switch -C) blocked."
fi
if printf '%s' "$cmd" | grep -qiE 'git[[:space:]]+rm([[:space:]]|$)'; then
    deny_command "git rm permanently deletes tracked files (no recycle bin)."
fi
if printf '%s' "$cmd" | grep -qiE 'git[[:space:]]+worktree[[:space:]]+remove[[:space:]]+--force'; then
    deny_command "git worktree remove --force discards changes."
fi
# R3+R4 修复：--force 后须空白/结尾（放开 --force-with-lease）；覆盖 -f 短标志（R4-01）
if printf '%s' "$cmd" | grep -qiE 'git[[:space:]]+push[^;]*--force([[:space:]]|$)|git[[:space:]]+push[^;]*-f([[:space:]]|$)'; then
    deny_command "git push --force/-f overwrites remote history."
fi
if printf '%s' "$cmd" | grep -qiE 'git[[:space:]]+branch[[:space:]]+-[dD]'; then
    deny_command "git branch -d/-D deletes branch."
fi
if printf '%s' "$cmd" | grep -qiE 'git[[:space:]]+stash[[:space:]]+drop'; then
    deny_command "git stash drop deletes stash."
fi
# R3 新发现：wmic shadowcopy delete（勒索软件前置）
if printf '%s' "$cmd" | grep -qiE 'wmic[^;]*(shadowcopy|shadowstorage)[^;]*delete|wmic[^;]*delete'; then
    deny_command "wmic delete (shadowcopy/system admin) blocked."
fi

# 8) 磁盘操作（diskpart/format 用命令边界匹配以防 echo 字符串误伤）
if printf '%s' "$cmd" | grep -qiE "${CMD_SEG}diskpart\b|${CMD_SEG}mkfs\.|${CMD_SEG}fdisk|${CMD_SEG}parted|${CMD_SEG}wipefs"; then
    deny_command "Disk formatting/partitioning detected."
fi
if printf '%s' "$cmd" | grep -qiE 'dd[[:space:]].*of=/dev/'; then
    deny_command "dd writing to device destroys data."
fi
if printf '%s' "$cmd" | grep -qiE 'truncate[^;]*(/dev/|PhysicalDrive|\\\\\.\\\\)'; then
    deny_command "truncate to block device destroys data."
fi
# G3：补齐 ps1 L262 的 `\s*[/]` 尾巴——ps1 只拦 `format X: /...`（真格式化），裸 `format C:` 放行；
#   本侧旧实现漏了该尾巴，`-i` 后大写 `FORMAT C:` 会与 ps1 发散（邻居探针 C15 实测）。对齐后两端同判。
if printf '%s' "$cmd" | grep -qiE "${CMD_SEG}format[[:space:]]+[A-Za-z]:[[:space:]]*/"; then
    deny_command "format destroys disk data."
fi

# 9) 远程代码执行（管道到 shell：任意来源，R25 补 base64/xxd/zcat/gunzip/bzip2/tar/xz）
if printf '%s' "$cmd" | grep -qiE '(echo|cat|printf|tee|curl|wget|iwr|base64|xxd|zcat|gunzip|bzip2|tar|xz)[^|;]*\|[[:space:]]*(bash|sh|zsh|pwsh|powershell)'; then
    deny_command "Pipe to shell is code injection risk."
fi

# 10) 子展开 / 反引号包裹 + herestring（R25：`/<<< 任意位置）
if printf '%s' "$cmd" | grep -qiE '\$\([^)]*(rm|Remove-Item|del|rmdir|shutdown)|`[^`]*(rm|Remove-Item|del|rmdir|shutdown)|<<<?[[:space:]]*["'"'"'][^"'"'"']*(rm[[:space:]]*-rf|rmdir[[:space:]]*/s)'; then
    deny_command "Command substitution / backtick / herestring with dangerous command."
fi

# 10b) 变量赋值危险 + 反斜杠/前导斜杠 rm（R25：X=rm; $X -rf / r\m / /rm）
# G3-FIX4/R3-审计：前导锚 `(^|[;&|[:space:]])` → `(^|[;&|])[[:space:]]*`，对齐 ps1 L370 的 `(?:^|[;&|\r\n])`。
#   旧锚含 `[:space:]`，`-i` 之后会把「引号内文本」当命令词点着（同 L489/L494/L509 一类）。
if printf '%s' "$cmd" | grep -qiE '=[[:space:]]*["'"'"']*rm([[:space:]]|["'"'"']|;|$)|=[[:space:]]*["'"'"']*Remove-Item([[:space:]]|["'"'"']|;|$)|(^|[;&|])[[:space:]]*[\\/]{1,2}rm([[:space:]]|-)|r[\\/]m([[:space:]]|-)'; then
    deny_command "Variable assignment / backslash-prefixed rm (dangerous execute)."
fi

# 11) eval / shell -c 包裹（单双引号 + R25 变量间接 F="rm -rf"; eval $F）
if printf '%s' "$cmd" | grep -qiE 'eval[[:space:]]+(\$[A-Za-z_0-9]+|["'"'"'][^"'"'"']*(rm[[:space:]]*-rf|rmdir[[:space:]]*/s))'; then
    deny_command "eval-wrapped dangerous command."
fi
if printf '%s' "$cmd" | grep -qiE '(bash|sh|pwsh|powershell)[[:space:]]+-c[[:space:]]+(\$[A-Za-z_0-9]+|["'"'"'][^"'"'"']*(rm[[:space:]]*-rf|rmdir[[:space:]]*/s))'; then
    deny_command "shell -c wrapped dangerous command."
fi

# 12) 系统级操作（无尾随空格变体，对齐 .ps1 28）
# G3-FIX4/R3（必修）：前导锚 `(^|[;&|[:space:]])` → `(^|[;&|])[[:space:]]*`，逐字对齐 ps1 L463
#   `(?:^|[;&|\r\n])\s*`。旧锚含 `[:space:]` → `-i` 之后 `git commit -m "remove SHUTDOWN path"`
#   这类**合法 commit message**里的「空格 + shutdown」被当命令词点着 → 新过拦 + 新分歧。
if printf '%s' "$cmd" | grep -qiE '(^|[;&|])[[:space:]]*(sudo[[:space:]]+)?(shutdown|reboot|halt|poweroff)([[:space:]]|$)'; then
    deny_command "System shutdown/reboot blocked."
fi

# 13) chmod 全局权限（无 -R 也拦，对齐 .ps1 29）
# G3-FIX4/R3-审计（裁决点名 L494 chmod vs ps1 L468）：同一类锚点不一致，一并改，
#   ps1 L468 = `(?:^|[;&|\r\n])\s*chmod\s+(?:-[^ ]+\s+)?(?:777|0777|a\+rwx)\s+`。
if printf '%s' "$cmd" | grep -qiE '(^|[;&|])[[:space:]]*chmod[[:space:]]+(-[^[:space:]]+[[:space:]]+)?(777|0777|a\+rwx)[[:space:]]+'; then
    deny_command "chmod global permission (777) is a security risk."
fi

# 14) docker 破坏扩展（对齐 .ps1 35 + R4-03：volume prune；R25 补 exec）
if printf '%s' "$cmd" | grep -qiE 'docker[[:space:]]+(system[[:space:]]+prune|volume[[:space:]]+(rm|prune)|container[[:space:]]+prune|run[^;]*(rm|rmdir)|exec[^;]*(rm|rmdir))'; then
    deny_command "docker prune/volume rm/container delete destroys data."
fi

# 15) git gc --prune / reflog expire（R2）
if printf '%s' "$cmd" | grep -qiE 'git[[:space:]]+gc[^;]*--prune|git[[:space:]]+reflog[[:space:]]+expire'; then
    deny_command "git gc --prune / reflog expire destroys history."
fi

# 16) 引号插词 rm（rm''-rf，对齐 .ps1 16c；R25：需实引号，rm -h 不误伤）
# G3-FIX4/R3-审计：前导锚含 `[:space:]` → `(^|[;&|])[[:space:]]*`，对齐 ps1 L365 16c
#   `(?:^|[;&|\r\n])\s*`。旧锚在 `-i` 之后会点着「引号内/参数位」的 rm 串。
# G3-FIX4/R1-回归修补：本规则同时改用 **cmdtestNoq**（rm 族归一文本）。若仍读原始 `$cmd`，
#   `rm'' -h` 会因为归一前还带着引号而命中本规则 → sh deny（ps1 allow，闸门 Q12 实测变红）。
#   归一是「多看见」方向，故改用归一文本不会漏拦：`rm''-rf` 由 L396 裸 rm 规则承接。
if printf '%s' "$cmdtestNoq" | grep -qiE '(^|[;&|])[[:space:]]*rm[[:space:]]*["'"'"'][^[:space:]]*[[:space:]]*-[a-z]'; then
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