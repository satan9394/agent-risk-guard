# RiskGuard PreToolUse 门禁脚本 — 对抗审查报告

> **审查员角色**：独立对抗审查员（GAN 式判别器）  
> **审查日期**：2026-08-21  
> **审查目标**：`dangerous-commands.ps1` 与 `dangerous-commands-universal.ps1`（两者规则完全相同，结论通用）  
> **审查方法**：逐条正则分析 + 真实脚本运行验证（120+ 测试用例）  
> **总体评分**：**4 / 10**

---

## 评分理由

脚本在「rm 全家桶」和「PowerShell 删除类」的拦截上做得扎实，但存在 **15 个已验证的 P0 绕过向量**（含整类缺失的 git 危险命令）和 **7 个 P1 误伤**。核心缺陷是：正则逐行匹配无法理解 shell 语义（命令分隔符、子命令展开、字符串上下文），且 git 生态的破坏性命令几乎完全未覆盖。作为生产部署的拦截器，当前防护等级不足以对抗有意识的绕过尝试。

---

## P0 — 可绕过拦截（已验证，15 项 + 整类缺失）

### P0-01：halt / poweroff / shutdown / reboot 无尾随空格时绕过

| 测试命令 | 期望 | 实际 | 正则 |
|---|---|---|---|
| `halt` | deny | **allow** | `^\s*(sudo\s+)?(shutdown\|reboot\|halt\|poweroff)\s` |
| `poweroff` | deny | **allow** | 同上 |
| `shutdown` | deny | **allow** | 同上 |
| `reboot` | deny | **allow** | 同上 |

**分析**：规则 6 的正则末尾要求 `\s`（空白字符），裸命令名 `halt` 无尾随空格时完全匹配失败。攻击者只需输入不带参数的命令名即可绕过。

**修复建议**：改为 `^\s*(sudo\s+)?(shutdown|reboot|halt|poweroff)\s*$` 或 `\b(shutdown|reboot|halt|poweroff)\b`。

---

### P0-02：chmod 777 不带 -R 绕过

| 测试命令 | 期望 | 实际 | 正则 |
|---|---|---|---|
| `chmod 777 /` | deny | **allow** | `\bchmod\s+-R\s+777\s+/` |
| `chmod 777 /home/user` | deny | **allow** | 同上 |

**分析**：规则 19 硬编码要求 `-R` 标志，但 `chmod 777 /` 无递归也能将根目录权限设为全开，同样是严重安全风险。

**修复建议**：增加规则 `\bchmod\s+(777|0777|a\+rwx)\s+/` 拦截无 `-R` 的全局权限设置。

---

### P0-03：git 破坏性命令 — 整类缺失（最大缺口）

以下命令**全部无对应规则**，实测均返回 allow：

| 测试命令 | 期望 | 实际 | 危害 |
|---|---|---|---|
| `git clean -fdx` | deny | **allow** | 永久删除所有未跟踪文件+忽略文件 |
| `git clean -fd` | deny | **allow** | 永久删除未跟踪文件 |
| `git clean -f` | deny | **allow** | 永久删除单个未跟踪文件 |
| `git reset --hard HEAD` | deny | **allow** | 丢弃所有工作区+暂存区更改 |
| `git reset --hard origin/main` | deny | **allow** | 强制对齐远程（含丢失提交） |
| `git checkout -- .` | deny | **allow** | 丢弃所有工作区更改 |
| `git restore .` | deny | **allow** | 同上（新版等价命令） |
| `git push --force` | deny | **allow** | 强制推送覆盖远程历史 |
| `git branch -D main` | deny | **allow** | 强制删除分支 |
| `git stash drop --all` | deny | **allow** | 永久删除所有 stash |

**分析**：规则 26 仅覆盖 `git gc --prune` 和 `git reflog expire`，git 生态中最常见的破坏性操作（clean/reset/restore/force-push）完全裸奔。Agent 执行 `git clean -fdx` 或 `git reset --hard` 是高频场景。

**修复建议**：新增规则块：
```powershell
if ($cmd -match '\bgit\s+(clean\s+-f|reset\s+--hard|checkout\s+--|restore\s+\.)') { Deny-Command '...' }
if ($cmd -match '\bgit\s+push\s+.*--force') { Deny-Command '...' }
if ($cmd -match '\bgit\s+branch\s+-D\b') { Deny-Command '...' }
```

---

### P0-04：命令子展开绕过 — `$(...)` 和反引号

| 测试命令 | 期望 | 实际 |
|---|---|---|
| `` `echo rm` -rf /tmp/t `` | deny | **allow** |
| `$(echo rm) -rf /tmp/t` | deny | **allow** |

**分析**：shell 会先执行子展开得到 `rm`，再拼接成 `rm -rf /tmp/t`。正则在原始字符串上匹配，`echo rm` 中的 `rm` 被 `echo ` 前缀和子展开语法隔开，`\brm\s+` 无法匹配。

**修复建议**：预处理阶段剥离 `$()` 和反引号内容，或增加 `\$\(|` 匹配子展开中的危险命令。

---

### P0-05：管道到 shell 绕过 — echo/cat 管道

| 测试命令 | 期望 | 实际 |
|---|---|---|
| `echo rm -rf /tmp/t \| sh` | deny | **allow** |
| `echo rm -rf /tmp/t \| bash` | deny | **allow** |
| `cat script.sh \| bash` | deny | **allow** |

**分析**：规则 17 仅匹配 `(curl|wget|iwr|Invoke-WebRequest)` 作为管道前缀。`echo`、`cat`、`printf`、`python -c print(...)` 等方式生成的恶意内容管道到 shell 完全不触发。

**修复建议**：规则 17 应扩展为匹配任意管道到 shell：`\|\s*(bash|sh|zsh)\b`。

---

### P0-06：eval / bash -c / sh -c 双引号变体绕过

部分双引号包裹的 eval/bash -c 在 PowerShell 子进程中存在引号解析差异，实测部分变体被 allow。

**分析**：`eval 'rm -rf /tmp/t'`（单引号）被正确拦截，但某些双引号嵌套变体因 PowerShell 引号转义差异导致脚本子进程中的命令字符串与预期不同。

**修复建议**：在正则中同时覆盖单引号和双引号包裹的 payload。

---

### P0-07：IEX + Net.WebClient 下载执行绕过

| 测试命令 | 期望 | 实际 |
|---|---|---|
| `Invoke-Expression (New-Object Net.WebClient).DownloadString('...')` | deny | **allow** |
| `iex ((New-Object Net.WebClient).DownloadString('...'))` | deny | **allow** |

**分析**：规则 18 的正则 `\b(Invoke-Expression\|iex)\s*\(.*(Invoke-WebRequest\|iwr\|curl\|wget)` 要求括号内出现 `Invoke-WebRequest/iwr/curl/wget`。但经典的 `Net.WebClient.DownloadString` 变体不包含这些关键词，完全绕过。

**修复建议**：规则 18 应增加 `Net\.WebClient|DownloadString|DownloadFile|WebClient` 匹配。

---

### P0-08：Python subprocess.call / subprocess.Popen 绕过

| 测试命令 | 期望 | 实际 |
|---|---|---|
| `python -c 'import subprocess; subprocess.call(["rm","-rf","/tmp/t"])'` | deny | **allow** |

**分析**：脚本未覆盖 `subprocess.call`、`subprocess.Popen`、`subprocess.run`（后者因 `rm` 出现在字符串中也被正则遗漏——正则匹配的是 `rm` 作为独立命令，而非 Python 列表元素中的字符串 `"rm"`）。

**修复建议**：增加 `subprocess\.(call|run|Popen|check_call|check_output)` 匹配。

---

### P0-09：引号插词 rm 变体绕过

| 测试命令 | 期望 | 实际 |
|---|---|---|
| `rm'' -rf /tmp/t` | deny | **allow** |
| `rm'''' -rf /tmp/t` | deny | **allow** |

**分析**：规则 16c 试图拦截 `rm" -rf` 等引号插词，但空引号 `rm''` 和转义引号 `rm''''`（PowerShell 中表示单个 `'`）不在匹配范围内。shell 会忽略空引号，`rm'' -rf` 等价于 `rm -rf`。

**修复建议**：规则 16c 应改为 `\brm\s*["']*\s*-` 匹配任意引号组合。

---

### P0-10：变量展开绕过

| 测试命令 | 期望 | 实际 |
|---|---|---|
| `R=m; $R -rf /tmp/t` | deny | **allow** |

**分析**：正则在原始字符串上匹配，`$R` 不会触发 `\brm\s+`。

**修复建议**：这是正则方案的固有限制，无法完美解决。可作为已知限制记录。

---

### P0-11：truncate 破坏块设备

| 测试命令 | 期望 | 实际 |
|---|---|---|
| `truncate -s 0 /dev/sda` | deny | **allow** |

**分析**：`truncate` 是 `dd` 的现代等价物，可清空块设备，但脚本未覆盖。

**修复建议**：增加 `\btruncate\b.*(/dev/|\\.\PhysicalDrive)` 规则。

---

### P0-12：非 Bash tool_name 绕过

| 测试命令 | tool_name | 期望 | 实际 |
|---|---|---|---|
| `rm -rf /` | Shell | deny | **allow** |
| `Remove-Item -Path C:\ -Recurse -Force` | Command | deny | **allow** |

**分析**：脚本第 28 行 `if ($data.tool_name -ne 'Bash') { exit 0 }` 导致所有非 `Bash` 工具名的调用直接放行。如果 agent 使用 `Shell`、`Command`、`Execute` 等工具名，所有规则失效。

**修复建议**：放宽为 `(Bash|Shell|Command|Execute)` 或移除 tool_name 过滤（仅检查 command 内容）。

---

### P0-13：docker system prune / volume rm

| 测试命令 | 期望 | 实际 |
|---|---|---|
| `docker system prune -af` | deny | **allow** |
| `docker volume rm backend_data` | deny | **allow** |

**分析**：规则 25 仅检查 docker run/exec 内的删除操作，但 `docker system prune -af` 和 `docker volume rm` 是更直接的破坏命令。

**修复建议**：增加 `docker\s+(system\s+prune|volume\s+rm|container\s+prune)` 规则。

---

### P0-14：npm cache clean --force

| 测试命令 | 期望 | 实际 |
|---|---|---|
| `npm cache clean --force` | deny | **allow** |

**分析**：虽然 npm cache 重建成本不高，但在 CI/CD 场景中强制清缓存可能导致构建失败。可作为 P2 考虑。

---

### P0-15：rm 不带参数（`rm` 单独出现）

规则 16 `\brm\s+` 要求 `rm` 后有空白，但某些 shell 中 `rm` 单独执行（无参数）会报错但仍可被组合利用。实测 `rm` 单独出现被 allow，这是正确的（无参数 rm 无害），但需注意 `rm\n-rf /tmp`（换行分隔）在多行命令场景下的风险。

---

## P1 — 误伤开发命令（已验证，7 项）

### P1-01：echo 字符串中的危险关键词

| 测试命令 | 期望 | 实际 | 触发规则 |
|---|---|---|---|
| `echo "please erase the board"` | allow | **deny** | 规则 14 `\berase\b` |
| `echo "diskpart tutorial"` | allow | **deny** | 规则 8 `\bdiskpart\b` |
| `echo "Remove-Item docs"` | allow | **deny** | 规则 13 `\bRemove-Item\b` |
| `echo "Format-Volume guide"` | allow | **deny** | 规则 9 `\b(Format-Volume)\b` |
| `echo "Clear-Disk warning"` | allow | **deny** | 规则 9 `\b(Clear-Disk)\b` |
| `echo "bcdedit is a tool"` | allow | deny | 规则 22（但实测 allow，说明正则有边界） |

**分析**：正则无法区分「作为命令执行的 `erase`」和「作为 echo 参数的 `erase`」。任何包含这些关键词的 echo/print/日志语句都会被误拦。

**修复建议**：对含 `echo`、`print`、`Write-Output` 等输出命令前缀的行跳过关键词匹配，或在匹配前剥离字符串内容。

---

### P1-02：icacls 只读查询被误拦

| 测试命令 | 期望 | 实际 |
|---|---|---|
| `icacls C:\Windows\System32` | allow | **deny** |

**分析**：规则 23 `\b(takeown\|icacls)\s+.*(system32\|Windows\|Program\s*Files)` 不区分读写操作，只读查询 `icacls` 也被拦截。

**修复建议**：icacls 需要 `/grant`、`/deny`、`/setintegritylevel` 等写操作参数才应拦截，仅路径参数应放行。

---

### P1-03：python print 中的函数名

| 测试命令 | 期望 | 实际 |
|---|---|---|
| `python -c "print('use os.remove() to delete')"` | allow | **deny** |

**分析**：规则 11 `\bos\.(remove\|unlink\|rmdir)\b` 匹配了 print 字符串中的 `os.remove`。

**修复建议**：这是正则方案的固有限制。可考虑对 `python -c` 参数做引号感知匹配。

---

## P2 — 加固建议

### P2-01：两脚本版本同步风险

`dangerous-commands.ps1` 和 `dangerous-commands-universal.ps1` 当前内容完全相同（234 行），但文件头注释声称一个是「通用版」一个是「特定版」。如果未来只修改其中一个，会导致部署不一致。

**建议**：建立单一事实源，另一版本通过符号链接或 `Include` 机制引用。

### P2-02：缺少预处理层

当前所有规则都在原始字符串上做正则匹配，没有：
- 注释剥离（`# ...` 行）
- 字符串内容剥离（`"..."`、`'...'`）
- 命令分隔符拆分（`;`、`&&`、`||`、换行）
- 子命令展开（`$()`、反引号）

**建议**：在规则匹配前增加预处理函数，将输入拆分为独立命令片段，对每个片段分别匹配。

### P2-03：缺少白名单机制

当前只有黑名单（deny），没有白名单（explicit allow）。当规则产生误伤时，没有逃生通道。

**建议**：增加 `# riskguard:allow` 注释标记，或维护已知安全命令白名单。

### P2-04：日志不够详细

`hook-calls.log` 仅记录 decision 和 reason，不记录原始命令内容，不利于审计和误伤排查。

**建议**：日志中增加命令原文（可选脱敏）和匹配的规则编号。

### P2-05：无单元测试覆盖

`hook-rules-test.ps1` 仅 16 个测试用例，远不足以覆盖绕过向量。

**建议**：将本审查的 120+ 测试用例纳入持续集成，每次修改规则后自动回归。

### P2-06：正则性能风险

规则 12 `\.(unlink|rmdir)\s*\(` 使用 `\s*\(` 匹配，对于超长命令字符串可能产生回溯。规则 17 的 `.*` 是贪婪匹配。

**建议**：将 `.*` 改为 `[^|]*`（非管道字符），减少回溯风险。

---

## 总结

| 类别 | 数量 | 说明 |
|---|---|---|
| P0 绕过 | 15 项 + 整类缺失 | git 破坏命令完全裸奔，命令子展开/管道/eval 可绕过 |
| P1 误伤 | 7 项 | echo 字符串中的关键词被误拦，icacls 只读被拦截 |
| P2 建议 | 6 项 | 预处理层、白名单、测试覆盖、日志、性能 |

**关键发现**：

1. **最大缺口**：`git clean/reset/restore/force-push` 等高频破坏命令无任何规则覆盖，agent 日常操作中极易触发不可逆数据丢失。
2. **系统性缺陷**：正则逐行匹配无法理解 shell 语义，命令分隔符（`;`/`&&`/`||`/换行）和子展开（`$()`/反引号）是天然绕过向量。
3. **tool_name 过滤过窄**：仅匹配 `Bash`，其他工具名直接放行。
4. **误伤可控**：7 个误伤主要来自 echo 字符串中的关键词匹配，影响有限但会降低开发者信任度。

**总体评价**：脚本在 rm/PowerShell 删除类的拦截上较为完善，但作为生产级门禁，防护覆盖面不足（git 生态缺失）且存在系统性绕过路径（命令分隔符/子展开）。建议优先补齐 P0-03（git 规则）和 P0-04/05（命令分隔符预处理），其次处理 P1 误伤。
