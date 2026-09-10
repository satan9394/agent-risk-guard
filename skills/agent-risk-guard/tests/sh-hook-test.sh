#!/usr/bin/env bash
# sh-hook-test.sh — dangerous-commands.sh（Linux hook）规则验证（对齐 ps1 测试集）
# 用法：bash sh-hook-test.sh  <path-to-hook.sh>
set -u
# 跨平台编码一致性（2026-09-10）：Windows python 默认按 GBK 解码 UTF-8，全角用例在 Git Bash 失真；强制 UTF-8 模式
export PYTHONUTF8=1 PYTHONIOENCODING=utf-8
HOOK="${1:-$(dirname "$0")/../scripts/dangerous-commands.sh}"
pass=0
total=0

run_case() {
    local cmd="$1" expect="$2"
    local json tool dec
    json=$(printf '{"tool_name":"Bash","tool_input":{"command":%s}}' "$(printf '%s' "$cmd" | python3 -c 'import sys,json;print(json.dumps(sys.stdin.read()))')")
    tool=$(printf '%s' "$json" | "$HOOK" 2>/dev/null)
    if printf '%s' "$tool" | grep -q '"permissionDecision"[[:space:]]*:[[:space:]]*"deny"'; then
        dec="deny"
    else
        dec="allow"
    fi
    total=$((total+1))
    if [ "$dec" = "$expect" ]; then
        pass=$((pass+1))
        echo "PASS [expect $expect] got $dec  <- $cmd"
    else
        echo "FAIL [expect $expect] got $dec  <- $cmd"
    fi
}

# 删除类
run_case 'rm -rf /tmp/x' deny
run_case 'rm x' deny
run_case 'shutil.rmtree("b")' deny
run_case 'os.remove("f.txt")' deny
run_case 'fs.rmSync("x",{recursive:true})' deny
run_case 'unlink /tmp/x' deny
run_case 'shred -u /tmp/x' deny
run_case 'find /tmp -delete' deny
run_case 'echo x; rm -rf /tmp' deny
# git 破坏整类
run_case 'git clean -fdx' deny
run_case 'git reset --hard HEAD' deny
run_case 'git checkout -- .' deny
run_case 'git restore .' deny
run_case 'git push --force origin main' deny
run_case 'git push -f origin main' deny
run_case 'git branch -D main' deny
run_case 'git stash drop --all' deny
run_case 'git switch -C main' deny
run_case 'git switch -c feature' allow
run_case 'git worktree remove --force' deny
run_case 'wmic shadowcopy delete' deny
run_case 'git gc --prune=now --aggressive' deny
run_case 'git reflog expire --expire=now --all' deny
# 2026-09-10 跨平台测试补回归：git 文件形态 / git rm / perl-ruby one-liner
run_case 'git checkout -- f' deny
run_case 'git restore f' deny
run_case 'git rm f' deny
run_case 'git rm --cached f' deny
run_case 'git restore --help' allow
run_case 'git checkout --help' allow
run_case "perl -e 'unlink \"x\"'" deny
run_case "ruby -e 'File.delete(\"x\")'" deny
# 磁盘
run_case 'mkfs.ext4 /dev/sda1' deny
run_case 'dd if=/dev/zero of=/dev/sda' deny
run_case 'wipefs -a /dev/sda' deny
run_case 'truncate -s 0 /dev/sda' deny
# 管道/子展开/eval
run_case 'echo rm -rf /tmp/t | bash' deny
run_case 'cat script.sh | bash' deny
run_case '$(rm -rf /tmp/t)' deny
run_case 'eval "rm -rf /tmp/t"' deny
# R15 全角（NFKC 归一化后应拦）
run_case 'ｒｍ　－ｒｆ　／ｔｍｐ' deny
run_case 'ｇｉｔ　ｃｌｅａｎ　－ｆｄｘ' deny
run_case 'Ｒｅｍｏｖｅ－Ｉｔｅｍ　Ｃ：\ｘ' deny
run_case 'bash -c "rm -rf /tmp/t"' deny
# 引号插词
run_case "rm'' -rf /tmp/t" deny
# 系统
run_case 'halt' deny
run_case 'reboot' deny
run_case 'chmod 777 /' deny
# docker
run_case 'docker system prune -af' deny
run_case 'docker volume rm data' deny
run_case 'docker volume prune' deny
run_case 'docker volume prune -f' deny
run_case 'docker run --rm -v /:/host alpine rm -rf /host/etc' deny
# 误伤（应放行）
run_case 'echo "use rm to delete files"' allow
run_case 'echo "diskpart tutorial"' allow
run_case 'git push --force-with-lease origin main' allow
run_case 'echo "Remove-Item docs"' allow
run_case 'python -c "print('"'"'use os.remove() to delete'"'"')"' allow
run_case "python -c \"print('docs: shutil.rmtree mentioned')\"" allow
run_case 'git status' allow
run_case 'git push origin main' allow
run_case 'git branch -a' allow
run_case 'git log' allow
run_case 'ls -la' allow
run_case 'cat file.txt' allow
run_case 'npm test' allow
run_case 'node script.js' allow
run_case 'python main.py' allow

echo "PASS: $pass/$total"
[ "$pass" = "$total" ] && exit 0 || exit 1