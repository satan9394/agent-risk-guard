#!/usr/bin/env bash
# sh-failclosed-test.sh — G5（2026-09-11）：sh hook 的**失败语义（fail-closed）与 JSON 合法性**回归
#
# 覆盖（任务卡「目标行为」1-4 + 纪律 D7 邻居面）：
#   ① 空 stdin / 仅空白 stdin / 畸形 JSON / 缺 tool_input / 缺 command 键 / command 为空的
#      → 必须输出 **deny JSON 且 exit 0**（旧实现：前五条静默放行或裸 exit 1）；
#   ② 命令含 TAB / CR / 引号 / 反斜杠 / 其它 C0 控制字符 / 换行 → 输出必须是**合法 JSON**
#      （旧实现 TAB 原样输出 → JSON.parse 失败 → 调用方拿不到 permissionDecision，等价放行）；
#   ③ 多行命令评估整条：`危险命令\n# 注释` 必须 deny（旧实现按逐行锚点提前放行）；
#   ④ 正常 allow/deny 路径逐字不变（`git status` / `ls -la` / `echo hello` 仍 allow）。
#   ⑤ D7 邻居：`#` 在命令中间/末尾、TAB 在引号内、command 为空串、命令末尾带换行。
#
# 用法：bash sh-failclosed-test.sh [hook.sh]
# 退出码：0 = 全绿；1 = 有失败（供变异验证判断「回退修复 → 必红」）
set -u
export PYTHONUTF8=1 PYTHONIOENCODING=utf-8
HOOK="${1:-$(dirname "$0")/../scripts/dangerous-commands.sh}"
pass=0; fail=0; total=0
TAB=$(printf '\t')
# 单次 hook 调用的墙钟上限（防某条载荷让被测脚本挂死拖垮整套；macOS 无 timeout 时自动退化为不限时）
TMO=""
command -v timeout >/dev/null 2>&1 && TMO="timeout 15"

# run_raw <label> <expect: deny|allow> <stdin 原文>
run_raw() {
    local label="$1" expect="$2" payload="$3" out rc
    total=$((total+1))
    out=$(printf '%s' "$payload" | $TMO bash "$HOOK" 2>/dev/null); rc=$?
    # ---- exit-0 契约：拒绝是决策，不是错误；任何分支都不得返回非 0 ----
    if [ "$rc" != "0" ]; then
        echo "  FAIL [$label] exit=$rc（违反 exit-0 契约：hook 中止 → 调用方拿不到决策）"
        fail=$((fail+1)); return
    fi
    if [ "$expect" = "allow" ]; then
        if [ -z "$(printf '%s' "$out" | tr -d '[:space:]')" ]; then
            echo "  PASS [$label] allow（无输出）"; pass=$((pass+1))
        elif printf '%s' "$out" | grep -q '"permissionDecision"[[:space:]]*:[[:space:]]*"deny"'; then
            echo "  FAIL [$label] 期望 allow，实得 deny"; fail=$((fail+1))
        else
            echo "  PASS [$label] allow（非 deny 输出）"; pass=$((pass+1))
        fi
        return
    fi
    # ---- expect=deny：必须**合法 JSON** 且 permissionDecision=deny ----
    local verdict
    verdict=$(printf '%s' "$out" | python3 -c 'import sys,json
raw=sys.stdin.read()
if raw.strip()=="":
    print("EMPTY"); raise SystemExit(0)
try:
    d=json.loads(raw)
except Exception as e:
    print("INVALID:"+str(e)[:60]); raise SystemExit(0)
hs=d.get("hookSpecificOutput") or {}
print("deny" if hs.get("permissionDecision")=="deny" else "other")' 2>/dev/null)
    if [ "$verdict" = "deny" ]; then
        echo "  PASS [$label] deny + JSON.parse OK"; pass=$((pass+1))
    else
        echo "  FAIL [$label] 期望 deny+合法 JSON，实得 ${verdict:-<空>}  原始输出=$(printf '%s' "$out" | head -c 200 | cat -v)"
        fail=$((fail+1))
    fi
}

# mkjson <command 原文> → 真实 stdin JSON（用 python3 生成转义，不经 shell 二次转义）
mkjson() {
    printf '%s' "$1" | python3 -c 'import sys,json;sys.stdout.write(json.dumps({"tool_name":"Bash","tool_input":{"command":sys.stdin.read()}}))'
}

echo "====== G5-A：异常输入必须 fail-closed（deny + exit 0）======"
run_raw 'empty-stdin'          deny  ''
run_raw 'whitespace-stdin'     deny  "$(printf '\n  \n')"
run_raw 'malformed-json'       deny  '{not json'
run_raw 'malformed-json-2'     deny  '{"tool_name":"Bash","tool_input":{"command":"rm -rf /tmp/x}'
run_raw 'missing-tool-input'   deny  '{"tool_name":"Bash"}'
run_raw 'missing-command-key'  deny  '{"tool_name":"Bash","tool_input":{}}'
run_raw 'empty-command'        deny  '{"tool_name":"Bash","tool_input":{"command":""}}'
run_raw 'blank-command'        deny  '{"tool_name":"Bash","tool_input":{"command":"   "}}'

echo ""
echo "====== G5-B：含控制字符/引号/换行的命令必须输出合法 JSON ======"
run_raw 'tab-separator'        deny  "$(mkjson "rm -rf /tmp/t${TAB}extra")"
run_raw 'tab-in-args'          deny  '{"tool_name":"Bash","tool_input":{"command":"rm -rf /tmp/t\textra"}}'
run_raw 'cr-in-command'        deny  '{"tool_name":"Bash","tool_input":{"command":"rm -rf /tmp/t\rx"}}'
run_raw 'quote-and-backslash'  deny  "$(mkjson 'rm -rf "/tmp/t" \x y')"
run_raw 'c0-control-0x01'      deny  '{"tool_name":"Bash","tool_input":{"command":"rm -rf /tmp/t\u0001x"}}'
run_raw 'multiline-danger'     deny  "$(mkjson "rm -rf /tmp/t"$'\n'"echo ok")"

echo ""
echo "====== G5-C：多行命令必须整条评估（# 注释不得提前放行）======"
# ⚠️ 构造纪律：**必须用 $'\n' 直连**，不能用 `$(printf '\n')`——命令替换会剥掉尾随换行，
#    那样这些载荷会退化成单行，测试看着绿却根本没覆盖多行形态（首轮自测已踩到）。
run_raw 'danger-then-comment'      deny  "$(mkjson "rm -rf /tmp/t"$'\n'"# note")"
run_raw 'danger-then-comment-then' deny  "$(mkjson "rm -rf /tmp/t"$'\n'"# note"$'\n'"echo ok")"
run_raw 'danger-trailing-comment'  deny  "$(mkjson 'rm -rf /tmp/t # note')"
run_raw 'danger-tab-comment'       deny  "$(mkjson "rm -rf /tmp/t #${TAB}note")"

echo ""
echo "====== G5-D：D7 邻居面 + 正常路径不变 ======"
run_raw 'comment-mid-allowed'      allow "$(mkjson 'git status # note')"
run_raw 'pure-comment'             allow "$(mkjson '# just a comment')"
run_raw 'indented-pure-comment'    allow "$(mkjson '   # indented comment')"
# 已知残留（与 ps1 同形，超出 G5 范围）：首行是注释时 ps1 的 `^\s*#` 亦放行，此处钉住现状不回归
run_raw 'comment-first-then-danger' allow "$(mkjson "# note"$'\n'"rm -rf /tmp/t")"
run_raw 'tab-inside-quotes'        allow "$(mkjson "echo \"a${TAB}b\"")"
run_raw 'trailing-newline-allow'   allow "$(mkjson "git status"$'\n')"
run_raw 'trailing-newline-deny'    deny  "$(mkjson "rm -rf /tmp/t"$'\n')"
run_raw 'non-shell-tool'           allow '{"tool_name":"SQL","tool_input":{"command":"rm -rf /tmp/x"}}'
run_raw 'no-tool-name'             allow '{"tool_input":{"command":"echo hi"}}'
run_raw 'json-non-object'          allow '"hello"'
run_raw 'allow-git-status'         allow "$(mkjson 'git status')"
run_raw 'allow-ls-la'              allow "$(mkjson 'ls -la')"
run_raw 'allow-echo-hello'         allow "$(mkjson 'echo hello')"
run_raw 'allow-git-switch-c'       allow "$(mkjson 'git switch -c feature')"
run_raw 'deny-rm-rf'               deny  "$(mkjson 'rm -rf /tmp/t')"
run_raw 'deny-git-reset-hard'      deny  "$(mkjson 'git reset --hard HEAD')"

echo ""
echo "====== TOTAL: $total  PASS: $pass  FAIL: $fail ======"
[ "$fail" -eq 0 ] && exit 0 || exit 1
