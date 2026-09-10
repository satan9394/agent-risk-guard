# RiskGuard dangerous-commands.sh — WSL Ubuntu 跨系统测试报告（t1)

- 测试日期：2026-08-21（WSL 会话）
- 测试环境：WSL2 Ubuntu 24.04.4 LTS（kernel 6.6.87.2-microsoft-standard-WSL2，WSL 2.6.2.0 / WSLg 1.0.71），locale en_US.UTF-8
  - bash 5.2.21、git 2.43.0、python3 3.12.3（/usr/bin/python3）、node v22.22.2；/tmp 可写
- 被测对象：`/mnt/e/DeepSeek_Harness/workspace/2026_08_21/agent-risk-guard-audit/scripts/dangerous-commands.sh`（Windows 源 `E:\...\agent-risk-guard-audit\scripts\dangerous-commands.sh`，mode 777、LF 行尾、无 CRLF，248 行）
- 测试方式：三套件直接以该 hook 为参数运行；40 例补充探测与全部环境实验通过 "stdin JSON → 解析 permissionDecision" 的方式执行，**未真实运行任何危险命令**（探测输入仅作为 JSON 文本喂给 hook，判定后丢弃）。三套件的 run_case 实现亦为纯 JSON 喂入，不执行命令。

## 1. 结论摘要

- 三套件：**59/59 + 40/40 + 186/186 = 285/285 全 PASS，0 FAIL**。回归基线健康。
- 补充探测：**40 例，36 PASS / 4 FAIL（漏拦）**，均为"期望 deny 实际 allow"。
- 4 个漏拦点：`git checkout -- f`、`git restore f`、`git rm f`、`perl -e 'unlink "x"'`。
- 稳健性发现：**无 python3 时 hook 因 `set -euo pipefail` 直接退出 127（fail-open），行 53 的 grep 回退是死代码**；有 python3 时转义引号/NFKC/pty 均正确。
- 总判断：hook 在真实 Linux（WSL2）下主路径工作符合预期，误伤极少；存在 4 个可复现的规则漏拦与 1 个环境相关的崩溃点，建议按第 5 节修复并补回归。

## 2. 三套件结果明细

### 2.1 sh-hook-test.sh（规则主集）— PASS: 59/59
尾部证据：
```
PASS [expect allow] got allow  <- python main.py
PASS: 59/59
```
覆盖：删除类 8、git 破坏整类 14（含 `git push --force-with-lease` 放行）、磁盘 4、管道/子展开/eval 4、全角 NFKC 4、引号插词 1、系统类 3、docker 5、误伤 16。失败用例：无。

### 2.2 sh-audit-edge.sh（边界审计）— TOTAL: 40 PASS: 40 FAIL: 0
尾部证据：
```
  PASS [crlf-rm] [expect deny] got deny  <- rm -rf\r/tmp/t
=== TOTAL: 40 PASS: 40 FAIL: 0 ===
```
覆盖：反引号、heredoc、base64/解压管道、herestring、变量间接、alias、反斜杠命令名、certutil/reg/net/bcdedit/takeown/icacls/.NET/PowerShell 磁盘/IEX、echo 边界、rm --help 放行、chmod 777 无尾随空格、docker exec、rm -rf 无空格、CRLF。失败用例：无。

### 2.3 sh-audit-bypass.sh（绕过/误伤/差距专项）— TOTAL: 186 PASS: 186 FAIL: 0（ALL PASS）
尾部证据：
```
TOTAL: 186  PASS: 186  FAIL: 0
ALL PASS
```
覆盖 25 组：子展开、bash -c/eval 包裹、引号插词、git 整类、管道到 shell、docker、certutil/wmic、truncate、PowerShell 删除、Python/Node 删除、格式、误伤 40+、ps1 覆盖差距、fail-open（SQL 工具名/坏 JSON/空 stdin）、变量赋值、Unicode、命令链、sudo 前缀、find -exec、xargs、重定向隐藏、docker exec。失败用例：无。

> 三套件全部用例均通过 —— 但套件内 git 恢复类只测了 `git checkout -- .`、`git restore .` 两种"整目录"形态，未覆盖 `<file>` 形态，也未覆盖 `git rm`、perl one-liner，因此全绿与第 3 节的真实漏拦并存（这正是补充探测的价值）。

## 3. 补充系统性探测（40 例）

方法：bash 脚本（/tmp/probe-riskg.sh，经 /tmp 中转）逐条构造 `{"tool_name":"Bash","tool_input":{"command":"<命令>"}}`（python3 json.dumps 编码），喂给 hook stdin，解析输出中的 permissionDecision，记录 exit code。hook 对 deny 与 allow 均 exit 0；deny 输出 `{"hookSpecificOutput":{"permissionDecision":"deny",...}}`，allow 无输出。

| # | 命令 | 期望 | 实际 | exit | 判定 |
|---|---|---|---|---|---|
| 1 | rm -rf /tmp/x | deny | deny | 0 | PASS |
| 2 | rm x | deny | deny | 0 | PASS |
| 3 | shutil.rmtree("b") | deny | deny | 0 | PASS |
| 4 | os.remove("f") | deny | deny | 0 | PASS |
| 5 | unlink /tmp/x | deny | deny | 0 | PASS |
| 6 | shred -u /tmp/x | deny | deny | 0 | PASS |
| 7 | find /tmp -delete | deny | deny | 0 | PASS |
| 8 | echo x; rm -rf /tmp | deny | deny | 0 | PASS |
| 9 | git clean -fdx | deny | deny | 0 | PASS |
| 10 | git reset --hard HEAD | deny | deny | 0 | PASS |
| 11 | git push --force origin main | deny | deny | 0 | PASS |
| 12 | git branch -D x | deny | deny | 0 | PASS |
| 13 | git checkout -- f | deny | **allow** | 0 | FAIL（漏拦）|
| 14 | git restore f | deny | **allow** | 0 | FAIL（漏拦）|
| 15 | git stash drop | deny | deny | 0 | PASS |
| 16 | git rm f | deny | **allow** | 0 | FAIL（漏拦）|
| 17 | python -c 'os.remove("x")' | deny | deny | 0 | PASS |
| 18 | node -e 'fs.unlinkSync("x")' | deny | deny | 0 | PASS |
| 19 | perl -e 'unlink "x"' | deny | **allow** | 0 | FAIL（漏拦）|
| 20 | r\m -rf /tmp/x | deny | deny | 0 | PASS |
| 21 | echo cm0gLXJmIC90bXAveA== \| base64 -d \| bash | deny | deny | 0 | PASS |
| 22 | $x='rm'; $x -rf /tmp | deny | deny | 0 | PASS |
| 23 | find /tmp -exec rm {} \; | deny | deny | 0 | PASS |
| 24 | rm --help（无害）| allow | allow | 0 | PASS |
| 25 | rm -rf --help（实为恶意）| deny | deny | 0 | PASS |
| 26 | bash -c "rm -rf /tmp/t" | deny | deny | 0 | PASS |
| 27 | eval F="rm -rf /tmp/t" | deny | deny | 0 | PASS |
| 28 | export CMD=rm | deny | deny | 0 | PASS |
| 29 | git status | allow | allow | 0 | PASS |
| 30 | git push --force-with-lease origin main | allow | allow | 0 | PASS |
| 31 | ls -la /tmp | allow | allow | 0 | PASS |
| 32 | echo hello | allow | allow | 0 | PASS |
| 33 | cat /etc/hostname | allow | allow | 0 | PASS |
| 34 | node -e 'console.log(1+1)' | allow | allow | 0 | PASS |
| 35 | echo "rm is a normal word" | allow | allow | 0 | PASS |
| 36 | 全角 ｒｍ　－ｒｆ　／ｔｍｐ（NFKC）| deny | deny | 0 | PASS |
| 37 | tab 分隔 rm -rf\t/tmp/t | deny | deny | 0 | PASS |
| 38 | CRLF 注入 rm -rf\r/tmp/t | deny | deny | 0 | PASS |
| 39 | rm -rf /mnt/c/Users/x | deny | deny | 0 | PASS |
| 40 | Remove-Item -rf C:\temp | deny | deny | 0 | PASS |

**汇总：TOTAL=40 PASS=36 FAIL=4（全部为漏拦 allow，exit 均 0）**。失败清单（probe 原样）：
```
git checkout -- f | expect=deny got=allow
git restore f | expect=deny got=allow
git rm f | expect=deny got=allow
perl -e unlink x | expect=deny got=allow
```

## 4. WSL 环境差异观察

### (a) shebang / 依赖
- 被测 hook 首行 `#!/usr/bin/env bash`，LF 行尾（grep `\r` 计数为 0）。在 drvfs（/mnt/e）下 mode 显示 777，可直接 shebang 执行；实测"直接调用（不经 bash 前缀）"对 allow/deny 两种输入均 exit 0，无需 chmod。
- **python3 是硬依赖**：JSON 解码（正确处理 `\"` 转义引号）与 NFKC 全角归一化都走 python3（本机 /usr/bin/python3，3.12.3）。
- 关键发现（DBG 实证）：构造 PATH 不含 python3 的 grep 回退环境（/tmp/nopybin 仅软链 cat/printf/grep/sed/tr/head）后，
  - `bash -x` 追踪显示流程在 `cmd=$(printf ... | python3 -c ...)` 处中断（`+ cmd=` 之后无后续指令）；
  - 插入 `DBG1 tool=[$tool_name] cmd=[$cmd]` 探针后，无 python3 运行**探针未打印**（脚本在到达探针前已被 `set -euo pipefail` 杀掉），有 python3 运行正常打印 `cmd=[unlink /tmp/x]` 并 deny；
  - 即无 python3 时 hook 对任何 Bash 工具 JSON 都**立即退出 127、无任何决策输出 → fail-open**，而脚本注释声称的"grep 回退"（第 53 行）在 errexit 下是死代码。
  - 附加实证：grep 回退即便能到达，在 `\"` 转义（如 `echo "he said \"rm -rf /tmp\""`）时会截断漏拦——有 python3 时该用例 deny，无 python3 时 allow。这是脚本头部注释已承认的已知 bug，但"直接崩溃 127"比"截断漏拦"更严重。
- 版本差异：Ubuntu 24.04 的 python3（3.12）与脚本测试过的版本行为一致；无平台专属 API 差异。

### (b) 非交互 vs 交互
- hook 无任何 tty/交互判断，纯 stdin-JSON 非交互契约；决策输出为一行 JSON，exit 恒 0。
- pty 对照：用 `script -qec` 在伪终端下喂入全角危险命令，pty 与非 pty 输出**完全一致**（同样的 deny JSON、同样 exit 0）。hook 决策与终端形态无关。
- 交互模式（`bash -i` 直接跑 hook）不适用：它会在 hook 退出后继续等待 stdin，10s 内未自行退出（外层 120s 超时被杀）。实际部署（PreToolUse hook）均为非交互子进程，此现象不影响真实使用，仅说明交互执行不在契约内。

### (c) /tmp 路径语义
- WSL 的 /tmp 与 / 同盘：/dev/sdd ext4（真实 Linux 磁盘，非 tmpfs），权限 1777，本用户可写。对 WSL 而言 /tmp 是"真 Linux 路径"——在这里执行 rm 就是永久删除，无回收站兜底。
- **/tmp 是共享且不可靠的临时区**：本会话中三套件日志、probe 日志等在约 04:13（疑似 distro 重启，systemd-private-* 目录时间戳刷新）后被清掉，同时出现其他 harness 代理的产物（mikgo.*、serveg4.log）。这说明同一 WSL distro 被多个子代理并发使用，跨调用依赖 /tmp 中的中间文件不可靠——工作证据必须留在转录与报告文件中。
- /mnt/e、/mnt/c 均为 drvfs/9p（`df -T` 直证）；hook 的判定只基于命令文本，与路径现实无关（39 号用例 deny，且换成 /mnt/c 前缀同样处理）。

### (d) Windows/WSL 特化异常
- drvfs 下文件 mode 显示 777（Windows 属性映射），LF 行尾正常；若未来用 Windows 工具改写引入 CRLF，`#!/usr/bin/env bash\r` 会使 shebang 失效（本文件已排除）。
- 全角 NFKC 归一化在 WSL 下工作正常（unicodedata），中文文件名（`rm -rf /tmp/测试文件` 在 bypass 套件中 deny）、tab、CRLF 注入均正确拦截。
- 真实危险性提示：整套保护链在 WSL 下无第二道防线——本 distro 未安装 `trash`（hook 报错文案里建议的 "Use trash command" 指向不存在的命令）；WSL 里对 /mnt/c 文件执行删除会绕过 Windows 回收站直接永久删除。hook 在这里是唯一拦截层，规则漏拦（第 5 节）的实际危害在 WSL 下被放大。
- 三套件在 WSL 下的通过率与脚本预期完全一致，未发现任何因 bash/git/python 版本导致的平台差异失败。

## 5. 问题清单与建议

### 漏拦（探测实证，建议进回归）
1. **P1 `git checkout -- <file>`（如 `git checkout -- f`）→ allow**。规则 `checkout[[:space:]]+--[[:space:]]*\.` 只匹配 `-- .` 整目录形态；`-- f` 会丢弃工作区单文件改动。建议改为 `git checkout --(可选空白)(\.|文件路径)` 或整体按 restore 类处理。
2. **P1 `git restore <file>` → allow**。规则只有 `restore[[:space:]]*\.$` 与 `restore[[:space:]]+--staged`；`git restore f`（回滚单文件）漏拦。建议补 `<path>` 形态。
3. **P1 `git rm <file>` → allow，全无规则**。git rm 删除索引（及工作区）文件，属于破坏性操作类，当前规则集（clean/reset/checkout/restore/switch/worktree/push/branch/stash/gc/reflog）均未覆盖。建议新增 `git rm` 规则（`git rm --cached` 可酌情放行）。
4. **P2 `perl -e 'unlink "x"'` → allow**。unlink 规则用段首/分隔符锚定（`(^|[;&|])[[:space:]]*unlink`），`-e` 参数里出现的中段目标词匹配不到；python 由 `os.remove` 类、node 由 `fs.*` 类兜底，perl/ruby 等无任何模式。建议增加解释器 one-liner 删除类（如"`-e`/`-E` 参数内含 unlink/rmdir/shred"），或把 `perl|ruby` 行为纳入通用 one-liner 检测。

### 稳健性
5. **P2 无 python3 时 hook 直接 exit 127 且 fail-open；第 53 行 grep 回退为死代码**。根因：`set -euo pipefail` 下 `cmd=$(printf ... | python3 ...)` 失败即中止脚本，后面的 `if [ -z "$cmd" ]; then cmd=$(grep 回退)` 永远执行不到。建议：`cmd=$(... python3 ...) || cmd=$(grep 回退)`（显式 OR 回退），并考虑用 `set +e` 包住解析段；同时把"grep 回退在 `\"` 转义会截断"的已知限制在无 python3 时显式告警（如 stderr 提示 `WARN: python3 missing`），避免静默 fail-open。

### 观察/建议
6. 误伤控制验证良好：echo/printf 带引号字符串、`rm --help`、`--force-with-lease`、`find -exec cat`、`xargs -0 grep`、`chmod 755`、`docker ps/pull`、`git gc`（无 --prune）、`reflog show`、`bash -c "echo hello"` 等全部正确放行；`rm -rf --help`（实为恶意）正确拒绝。
7. 建议把第 5 节 1–4 用例追加进 sh-hook-test.sh 的 git/解释器区作回归，防止修复回退。
8. 环境提示（非 hook 问题）：WSL distro 未装 trash；若 RiskGuard 推荐"trash 命令"工作流，建议在部署文档里注明 WSL 下需 `sudo apt install trash-cli`，否则报错文案指向的命令不可用。

## 附：关键输出摘录

- 三套件尾部：
  - `PASS: 59/59`
  - `=== TOTAL: 40 PASS: 40 FAIL: 0 ===`
  - `TOTAL: 186  PASS: 186  FAIL: 0` / `ALL PASS`
- deny 输出样例（`rm -rf /tmp/x`）：`{"hookSpecificOutput":{"permissionDecision":"deny","updatedInput":null},"systemMessage":"HOOK BLOCKED: rm is permanent deletion. Use trash command.\nCommand: rm -rf /tmp/x\nUse trash/recycle bin instead of permanent deletion."}`（exit 0）
- 无 python3 复现：`printf '{"tool_name":"Bash","tool_input":{"command":"ls -la"}}' | PATH=/tmp/nopybin /bin/bash -x /tmp/hook-nopy-test.sh` → 追踪止于 `+ cmd=`（python3 调用失败被杀）；DBG 探针无 python3 时未打印。
- pty 对照：全角危险命令在 `script -qec`（伪终端）与非 pty 下输出逐字节一致的 deny JSON，均 exit 0。

---

## 附2：修复记录（2026-09-10 已执行，见 tasks/t2-gitbash-report.md 交叉验证）

本报告发现的 5 项问题已全部修复并跨平台验证，详情：

1. **P0 全角 NFKC（WSL 下无问题；Git Bash 下已修）**：`dangerous-commands.sh` 顶部加 `export PYTHONUTF8=1`，python3 段内 `sys.stdin/stdout.reconfigure(encoding="utf-8")`。实测 Git Bash 下 `stdin_enc=utf-8 utf8_mode=1`，全角用例由 allow → deny；三套件顶部同步 export。
2. **git 文件形态漏拦 ×3**：`git checkout -- <file>`、`git restore <file>`、`git rm <file>` 规则补齐（ps1/opencode 同步，deploy/dsh patch 原已覆盖）。
3. **perl/ruby one-liner**：新增 `perl|ruby -e/-E` 内含 unlink/rmdir/File.delete 拦截（sh/ps1/opencode 三端同步）。
4. **grep 回退死代码 fail-open**：cmd 提取/NFKC 段 python3 调用加 `|| true` 显式回退，grep 回退可达（不再被 set -euo pipefail 中止）。
5. **三套件跨平台一致性**：sh 三套件 + ps1 审计测试顶部 export PYTHONUTF8/PYTHONIOENCODING；ps1 测试脚本补回 UTF-8 BOM（无 BOM 时 PowerShell 5.1 按 GBK 解析中文致 ParseError）。

**回归结果（修复后）**：WSL sh 三套件 67/67+40/40+192/192=299/299；Git Bash sh-hook-test 由 56/59 → 59+/59+（P0 用例转 PASS，最终数字见 t2 附录）；ps1 四套件 37/37+8/8+18/18+53/53；opencode 插件 33/33；M7 对齐 4/4。全部副本哈希同步一致。