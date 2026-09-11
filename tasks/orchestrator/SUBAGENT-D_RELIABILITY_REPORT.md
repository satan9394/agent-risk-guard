# SUBAGENT-D 独立可靠性/安全审计报告 — agent-risk-guard（安全护栏）

- 审计日期：2026-09-10；审计人：独立子代理 D（只读审计，未修改任何代码）
- 审计对象：`agent-risk-guard`（主仓）+ 证据链（t1-wsl-report / t2-gitbash-report / GAN-AUDIT-5AGENTS / real-agent-conformance-final-report / deployment-status）
- 方法：纯静态分析 + 只读正则语义探测，**未执行任何危险命令**。仅有的执行是：
  1) pwsh 正则语义探测（`-match '[[:space:]]'` 等，无副作用）；
  2) 一条含全角文本的无害探测命令，用于实证本机 DSH 门禁的 NFKC 行为（输出两个全角字符，未执行任何删除）。
- 视角：**假设系统必然失败**。默认所有 agent 侧对 hook 异常/超时/非零退出按 allow 处理，规则必有漏网，接线必有漂移。

---

## 发现一览（10 条）

| # | 优先级 | 标题 |
|---|--------|------|
| F1 | P0 | 三条 hook 链 fail-open/fail-closed 语义不一致，sh 端坏 JSON/空输入/缺 python3 静默放行 |
| F2 | P0 | ps1 规则 16d 是死代码：`[[:space:]]` 在 .NET 正则中无效 → 变量赋值/间接 rm 在 PowerShell 端完全漏拦（已实证） |
| F3 | P0 | 回收站保证链在 POSIX 端断裂：无 trash 落地、无验证、报错文案指向不存在的命令 |
| F4 | P1 | DSH deny-risk-commands 无 NFKC 归一化 + 词级正则：全角绕过面 + 高误伤（本机门禁实测） |
| F5 | P1 | 密钥泄漏：ps1 hook 明文记录/回显完整命令（allow 写盘、deny 回显均无脱敏） |
| F6 | P1 | settings.json 外部覆盖历史 ≥3 次复发；doctor/自愈只查「字符串在位」，给虚假安全感 |
| F7 | P1 | 多副本漂移：规则集 ≥4 份副本，universal 旧版（17.7KB，缺 `(?i)`）留在分发面，dist/ 含 3 份旧归档 |
| F8 | P1 | opencode 插件只拦 `bash` 工具 + 崩溃 fail-open 按关键词兜底 + opencode.json 可被 edit 工具摘除 |
| F9 | P2 | hook 超时/延迟：Git Bash 4–5s/次 vs CC 接线 timeout=10s；无内部超时，共享日志/配置写入无锁 |
| F10 | P2 | agy 适配器：规则引擎输出为空/无 decision 字段时落到 allow；路径硬编码 `~/.codex/hooks` |

---

## F1 [P0] 三条 hook 链 fail-open/fail-closed 语义不一致，sh 端坏 JSON/空输入/缺 python3 静默放行

**问题**：同一产品、相同的「shell 工具缺 command / JSON 解析失败 / 空 stdin」，三端决策相反：ps1 fail-closed（deny），sh 与 agy fail-open（allow）。

**证据**：
- `skills/.../scripts/dangerous-commands.sh` L18-19：`inputJson=$(cat 2>/dev/null || true); if [ -z "$inputJson" ]; then exit 0; fi`（空 stdin → allow）；L70：`if [ -z "$cmd" ]; then exit 0; fi`（缺 command → allow）；L31-43 `extract_field` 的 python 分支 `except: pass` 静默吞坏 JSON，grep 兜底首匹配 + 引号截断（t1 §4a 已实证：无 python3 时曾 exit 127 fail-open；2026-09-10 修复改为 `|| true` 让 grep 兜底**可达**——把「响亮崩溃」换成了「静默半解析」，仍为 fail-open）。
- `assets/hooks/dangerous-commands.ps1` L66-77：stdin 读取失败/空输入/解析失败 → `Deny-Command`（fail-closed）；L86-88：shell 工具缺 command/空 command → deny。
- `assets/hooks/agy-dangerous-commands.ps1` L28-31、L44-47：空 stdin / 无 CommandLine → `{"decision":"allow"}`（fail-open）。
- 平台语义缺口：CC/Codex 对 PreToolUse hook 的**非零退出/超时默认按 allow 处理**（仅显式 deny JSON 或 exit 2 才阻止）——sh 端任何 `set -euo pipefail` 命中的脚本错误都会转化为「无决策输出 + 非零退出」的放行。

**触发条件**：无 python3 的 Linux/macOS/CI 环境；agent 侧发来坏 JSON；工具名字段拼写变体（`"Bash "`、`"bash.exe"`、`Wsl`/`Nushell` 等非白名单名早退于 L47-52/83 直接 allow）。

**影响**：防护静默消失时无任何告警；同一护栏在 Windows 拦、在 POSIX 放，违反「确定性」卖点；坏 JSON 场景下 sh 侧任何转义引号后半截命令都不被分析。

**建议**：sh 端与 ps1 对齐 fail-closed（坏 JSON/缺 command/解析失败 → 输出 deny JSON）；无 python3 时 stderr 输出 `WARN: python3 missing` 且**不得降级为半解析**（或明确降级为 deny）；把三端 fail 语义表写进接线文档；doctor 增加实弹探测（见 F6）。

---

## F2 [P0] ps1 规则 16d 死代码：`[[:space:]]` 在 .NET 正则中无效 → 变量赋值/间接 rm 漏拦（已实证）

**问题**：PowerShell 的 `-match` 走 .NET 正则，**不支持 POSIX 字符类** `[[:space:]]`。ps1 规则 16d（唯一使用处）整条不生效，GAN 宣称已修的「变量赋值/反斜杠 rm」在 Windows 端等于没有。

**证据**：
- `assets/hooks/dangerous-commands.ps1` L252 四个分支全部含 `[[:space:]]`。
- 只读实测（本机 pwsh）：
  - `'a b' -match '[[:space:]]'` → **False**；`'x=s' -match '[[:space:]]'` → **False**（对照 `'q w' -match '\s'` → True）。
  - `$a=rm; $a -rf /tmp/t` 用规则文本 `=[[:space:]]*"?rm([[:space:]]|"|;|$)` 匹配 → **False**；对照去掉类的 `=q(;|$)` 形状能命中。→ 16d 四分支全部恒 False（死代码），连无空格变体也拦不住。
- 测试盲区：ps1 四套测试（37+8+18+53）grep 不到任何 `$x=` / `X=` / `CMD=` 用例；sh 套件有（`sh-audit-bypass.sh` L339 `X=rm; $X -rf` deny，靠 grep ERE 的 POSIX 类生效）→ **sh 拦、ps1 放，且全绿掩盖**。

**触发条件**：Windows 端（CC/Codex 命中的 ps1 hook）执行 `$x=rm; $x -rf /tmp/t`、`$x = rm; …`、`$x="rm -rf …"; $x`、同构 `Remove-Item` 变体（其他规则不含 `rm` 文本，均无法命中）→ 放行。

**影响**：PowerShell/Windows 主路径存在可直接利用的间接删除绕过；且是 2026-09-10「三端对齐」声明的回归（t1 附2 声称 ps1 已同步 sh 10b）。

**建议**：把全部 `[[:space:]]` 替换为 `\s`（ps1 仅 L252 一处，但应全文 grep）；补 ps1 回归用例：`$x=rm` / `$x = rm` / `$x="rm -rf"` / Remove-Item 空距与非空距变体，并加入 M7 对齐测试跨端断言（同用例 sh/ps1 必须同判定）。

---

## F3 [P0] 回收站保证链在 POSIX 端断裂：无 trash 落地、无验证、报错文案指向不存在的命令

**问题**：护栏的核心承诺是「删除必须进回收站」。Windows 端有 pwsh `Microsoft.VisualBasic` 替代路径，但 POSIX 端（sh hook 覆盖的 Linux/macOS）只有「拦截」，没有可用的回收站实现，也没有任何验证环节保证删除真的进了回收站。

**证据**：
- t1 §4d：WSL distro **未安装 trash**（报错文案建议的 `Use trash command` 指向不存在的命令）；对 /mnt/c 文件的删除绕过 Windows 回收站直接永久删除；hook 是唯一拦截层。
- t2 §5.1/5.3：Git Bash 的 rm 是 MSYS rm → 永久删除；同样是纯文本拦截、无回收站替代。
- `dangerous-commands.sh` deny 输出固定文案 `Use trash/recycle bin instead of permanent deletion`（L103）——全平台同文案，不探测 `trash` 是否存在，不给替代命令。
- opencode 的 trash 工具（`assets/opencode/agent-risk-guard.ts` L477-500）依赖 `pwsh` 子进程——macOS/Linux 默认无 pwsh（失败时只回 `Do NOT fall back`，无可用疏导）。
- PROJECT_BRIEF 已知约束：「macOS 真机 trash 命令实测待补」→ 承诺链完全没有 POSIX 端实证。

**触发条件**：WSL / macOS / Linux CI 上任何合法删除需求被拦截后，模型按文案尝试 `trash` → command not found → 删除任务永远无法完成；或用户为完成工作关掉 hook / 手动永久删除。

**影响**：护栏只「堵」不「疏」，把用户推向永久删除或拆护栏；「删除必须进回收站」在 3/4 平台无落地；也无法事后验证删除目标是否真实进入回收站（无回收站身份/路径校验）。

**建议**：部署文档与 doctor 增加 POSIX 前置检查（apt install trash-cli / brew install trash，无则告警即 fail-closed 提示）；deny 文案改为探测 trash 存在性后给出具体可执行替代；在 macOS 真机补 D3 实测并锁定为验收项；规划「删除-回收站」双向校验（删除后验证回收站条目）。

---

## F4 [P1] DSH deny-risk-commands 无 NFKC 归一化 + 词级正则：全角绕过面 + 高误伤（本机门禁实测）

**问题**：ps1/sh/opencode 三端都有 NFKC 全角归一化（R15 修复），**唯独 DSH 的 deny-risk-commands patch 没有**；且规则是裸词级正则，误伤面宽（本次审计过程被该门禁连拦 5 次，连无害探测文本都中招）。

**证据**：
- 本机实证（harmless 探测）：pwsh 命令文本含 ASCII `rm`/`Remove-Item`/`ri` → DSH 门禁拦截（连续 5 次实锤，包括 `Write-Output` 的**输出标签字符串**里的 `rm` 与变量名 `$RI`）；同一探测把目标词换成全角 `ｒｍ`（U+FF52 U+FF4D）→ **通过执行**。→ 门禁对原始字符串做 ASCII 正则，无 NFKC，无字符串上下文剥离。
- `assets/dsh/deny-risk-commands.patch.yml` 全部规则为 ASCII 字面：`\br[`\\]?m\b`（L74）会命中任何单词 `rm`（`echo rm` 误伤）；`\bClean-Disk\b`/`\bri\s+` 等均无 echo/print 剥离（ps1 用 `$cmdTest` 剥离，DSH 无等价物）。
- yml 头注释 L7-15 自述：插件缺失 / patch 解析失败 / rules 被同 profile 其它层覆盖 → **静默失效（fail-open）**，无加载期自检。

**触发条件**：`ｒｍ　－ｒｆ　／ｔｍｐ` 类全角命令经 DSH 工具派发（某 shell/终端可做 NFKC 归一化）；反向：任何含单词 `rm`/`ri` 的正常文本命令被误拦。

**影响**：DSH 端存在与 R15 同源的 Unicode 绕过缺口（四端归一化不一致）；误伤面会让用户删除规则（可用性反噬安全性）；fail-open 自述意味着单点插入件消失时无感知。

**建议**：DSH 门禁引擎加 NFKC 归一化与 echo/字符串剥离（对齐 ps1 `$cmdTest`）；把「插件存在 + 规则加载 + 实弹探测」纳入 doctor；规则 `\br[`\\]?m\b` 改为命令边界 + 排除 echo 文本。

---

## F5 [P1] 密钥泄漏：ps1 hook 明文记录/回显完整命令（无脱敏）

**问题**：ps1 hook 无论 allow 还是 deny，都会把**完整原始命令**写入共享临时日志或回显给模型，不带任何脱敏；而 sh/opencode 都有 redact。

**证据**：
- `assets/hooks/dangerous-commands.ps1` L431：`Write-HookLog 'allow' $cmd` → `%TEMP%\riskguard-hook-calls.log` 明文写全命令（含 `curl -H "Authorization: …"`、`npm publish` token、CI 密钥注入等任何 allow 命令），无轮转、无权限收紧、无脱敏。
- L53：deny 时 `systemMessage` 原样拼接 `命令：$($script:curCmd)` → 含密钥的命令以明文进入 agent 上下文与 UI（随后可能进对话记录/转录）。
- 对照：`dangerous-commands.sh` 有 `redact_cmd()`（L90-96，仅用于 deny 文案，日志本来就没有）；opencode 有 `redact()`（L43-46）。

**触发条件**：任何含密钥/token/口令的命令经过 ps1 hook 一次（无论拦截与否）。

**影响**：`%TEMP%\riskguard-hook-calls.log` 演化成长期明文凭证库（同机多 agent 可读）；deny 回显把密钥灌进模型上下文，放大泄漏面。

**建议**：ps1 日志与 systemMessage 复用 sh/opencode 的同一套 redact 正则；日志加大小上限/轮转与最小 ACL；把「hook 输出不含密钥明文」加入测试断言。

---

## F6 [P1] settings.json 外部覆盖历史 ≥3 次复发；doctor/自愈只查「字符串在位」，给虚假安全感

**问题**：`~/.claude/settings.json` 的 PreToolUse 接线已被外部覆盖/还原丢失多次（有档可查 ≥3 次），而 doctor 与 wiring-check 只做字符串/哈希在位检查，**不验证 hook 是否真的能 deny** —— 防护静默消失时巡检照样报 OK。

**证据**：
- 复发记录：`docs/GAN-AUDIT-5AGENTS.md` L69（2026-09-08 06:55 被重写后仅存 `hooks.Setup`、无 PreToolUse）；`docs/real-agent-conformance-final-report.md` L86（21:45 同样丢失，靠备份 `settings-restore-20260906224852.json` 恢复）；`docs/deployment-status.md` L11-12（早期仅 Setup hooks + `defaultMode: bypassPermissions` + 脚本 SHA 漂移）。
- `packages/installer/src/doctor.ts`：checkClaudeHook 只 `raw.includes('PreToolUse') && hasRiskGuardHook(raw)`（子串级）；checkDshPatch 只查 `raw.includes('deny-risk-commands')`（L58）；checkCodex 同子串级。→ **文档能引用、文件存在、脚本已删除、脚本内容被改坏，均判 ok**。
- `scripts/riskguard-wiring-check.ps1` 只做 hash/在位/规则数对比，无实弹拦截验证。
- 根因放大器：CC 的 PreToolUse matcher 仅为 `Bash|PowerShell` —— agent 用 edit/apply_patch/write 工具改写 settings.json 完全不在拦截范围（见 F8），外部工具/用户/被诱导 agent 均可一击拆钩。

**触发条件**：任何进程用**非 shell 工具**覆盖 settings.json / hooks.json / opencode.json（settings.json 里 `defaultMode: bypassPermissions` 时 CC 自己也常重写权限段）。

**影响**：护栏无声消失 + 巡检误报 OK = 最危险的「信任错位」；历史上已发生 3 次而未在巡检期被发现。

**建议**：doctor/wiring-check 增加**实弹探测**：向每个注册 hook 管道喂一条 known-deny JSON（如 `{"tool_name":"Bash","tool_input":{"command":"rm -rf /tmp/x"}}`，纯 JSON 文本，不执行）断言输出 deny——这才是接线在位的充分条件；同时把 settings.json/hooks.json 纳入受保护路径（CC 侧靠 hook 无法自护，见 F8 建议）。

---

## F7 [P1] 多副本漂移：规则集 ≥4 份副本，universal 旧版留在分发面，dist/ 含 3 份旧归档

**问题**：「单一规则源」纪律未覆盖所有副本；已有一份正式分发面副本与其他不同步，且 dist/ 保留 3 个旧版本归档可直接被误安装。

**证据**：
- SHA-256 实测：`assets/hooks/dangerous-commands.ps1` == `skills/agent-risk-guard/scripts/dangerous-commands.ps1`（`40185A84…`，24058B，同步 OK）；**`skills/.../dangerous-commands-universal.ps1`（`9BB6374D…`，17739B）漂移**——规则 16d 缺 `(?i)`（universal L216 vs 主版 L252），大小差 6.3KB，头注释却自称「完全同步」。
- `dist/agent-risk-guard-v0.2.0 ~ v0.2.2` 三份归档内为 2026-09-10 修复前规则（无 git checkout--/restore/git rm/perl-ruby 补齐）。
- `scripts/riskguard-wiring-check.ps1` 只校验 ps1×3 + opencode + dsh；**不校验 sh、universal 副本、dist 归档**；t1/t2 的 299/299 只在 audit 工作区副本上跑。

**触发条件**：用户从 skill 包安装（获 universal 旧版）或手滑用 dist/ 旧归档初始化 → 拿到缺 `(?i)`/缺修复的规则集，且 M7/巡检不报。

**影响**：分发面 = 弱规则面；跨副本行为差异难排查（本次 F2 的 16d 死代码只在主版存在，universal 版规则 16d 也死但连大小写都不同）。

**建议**：构建/发布流水线强制「所有规则副本 + dist 归档 = 单源 SHA 白名单」(M7 扩到 universal/sh/dist)；废弃或删除 universal 副本（或改为运行时生成）；wiring-check 增加对 skill 包内副本的 hash 校验。

---

## F8 [P1] opencode 插件：只拦 `bash` 工具 + 崩溃 fail-open 按关键词兜底 + opencode.json 可被 edit 摘除

**问题**：插件拦截面 = 单一工具名 `bash`；分析异常时按 `hasDangerousSignal` 关键词决定放行；自保护只覆盖插件文件本体，不覆盖注册文件。

**证据**：
- `assets/opencode/agent-risk-guard.ts` L508：`if (input.tool === "bash")` —— opencode 的 `task`/`webtools` 等工具调用旁路；L555-567：catch 中仅当 `hasDangerousSignal(cmd)`（关键词表 L405-415）才 block，否则 allow（audit 报告 `OPENCODE-PLUGIN-AUDIT.md` L317 自认该 fail-open 设计）。
- 自保护：L518-554 的 edit/write/apply_patch 拦截只对 `pp.label === "Guard plugin file"` 生效；`~/.config/opencode/opencode.json`（插件注册文件）不在 edit 拦截名单（checkProtected 的 CFG 保护只走 bash 删除类）。
- `unwrapWrapper`/detect 正则对 base64 UTF-16LE、`bash --noprofile -c` 等历史绕过有多次修复记录，但任何一次新异常都会落到关键词兜底。

**触发条件**：`task` 工具执行危险脚本；构造触发分析异常的混淆命令且不含关键词表字面量；用 edit 工具把 opencode.json 中的插件注册摘掉。

**影响**：opencode 端存在「工具名旁路 + 崩溃旁路 + 自删接线」三层放行面；关键词兜底是启发式，与「确定性拦截」卖点冲突。

**建议**：扩展到 `task` 等可执行工具名；崩溃路径改 fail-closed（无决策即 deny，与 ps1 对齐）；把 opencode.json/设置文件纳入 edit/write/apply_patch 保护名单。

---

## F9 [P2] hook 超时/延迟：Git Bash 4–5s/次 vs CC 接线 timeout=10s；无内部超时，共享写入无锁

**问题**：Git Bash 端单次 hook 4–5s（t2 §5.4），CC 接线 `timeout: 10`（`settings.hooks.json` L10 与 wiring-check L147），余量仅 ~1 倍；慢机/杀软扫描/大输入可能触发超时，而 hook 侧无内部超时，超时后的 agent 行为默认放行。

**证据**：
- t2 §5.4：Git Bash 单次 4025–5324ms，WSL ~188–207ms（慢 20–28 倍）；t2 明言性能优化未做。
- ps1 `[Console]::In.ReadToEnd()` 无超时（L67）；sh 侧一次调用内部约 3 次 python3 spawn（t2 §5.4）。
- 并发：5 个 agent 共享 `%TEMP%\riskguard-hook-calls.log`（Add-Content 无锁）与同一份 settings.json/hooks.json；wiring-check -Fix 写入无原子替换。

**触发条件**：杀软扫描 PowerShell 冷启动、WSL/共享盘 IO 抖动、超大 JSON 输入。

**影响**：超时一边是放行（多数 agent 对超时/异常按 allow），一边是防护消失；并发写同一配置可能产生半写状态，触发 F6 的「外部覆盖」复发。

**建议**：合并 spawn 为单次 python3 调用（t2 已提）；hook 内部加读输入超时并 deny-on-timeout；日志/配置写入用原子替换 + 互斥（文件锁或 temp+rename）；在接线文档标注各 agent 超时/非零退出语义并给出预算。

---

## F10 [P2] agy 适配器：规则引擎输出为空/无 decision 字段时落到 allow；路径硬编码 `.codex`

**问题**：agy 适配器的 fail-closed 只覆盖「缺失/异常」两类，**输出为空或 JSON 无 decision 字段时静默 allow**；且主规则引擎路径硬编码到 `~/.codex/hooks`。

**证据**：
- `assets/hooks/agy-dangerous-commands.ps1` L49：`$main = Join-Path $env:USERPROFILE '.codex\hooks\dangerous-commands.ps1'`（依赖 codex 副本，与 wiring-check 的 `.gemini/config/hooks` 纠正方向矛盾）。
- L56-72：`& $main -Cmd $cmd 2>$null | Out-String` → 若输出为空（引擎被替换为「退出 0 无输出」的占位，或输出缺少 `hookSpecificOutput.permissionDecision` 字段），**跳过 L63 的 deny 分支，直接落到 L72 `{"decision":"allow"}`**；L60-69 的 try/catch 只兜「无法解析」，不兜「解析成功但无 decision」。

**触发条件**：codex hook 副本缺失→deny（OK）；副本存在但被换成空输出占位/劣化版 → allow。

**影响**：agy 端的第二条失败面（第一条是 stdin 为空 allow）；codex 接线一旦漂移，agy 静默退化 —— 与 F6/F7 叠加构成「一键拆三端」。

**建议**：空输出或 `permissionDecision` 缺失一律 deny；路径改为单源变量（与 wiring-check 同一清单）；补 agy 适配器回归：空输出/无字段/坏 JSON/空输入四态断言。

---

## 审计方法声明与局限

1. 本报告仅做静态阅读 + 无副作用的正则语义探测；所有危险命令只以 JSON 文本形式出现在分析中，从未执行。
2. 未验证项：Claude Code/Codex 对 hook 超时与非零退出的精确处置（依赖官方文档语义，未在真机复现）；MAC 真机 trash 行为（项目自身待补）。
3. 引用证据均来自本仓库文件与 t1/t2 实测报告，行号为审计时刻的版本。
4. 特别说明：审计过程中的 5 次 DSH 门禁拦截与 1 次全角通过，是本机 `cordis.patch.yml` deny-risk-commands 的**现场行为证据**（F4），同时证明该门禁在本会话的 pwsh 工具上是激活且误伤性的。

---

## 修复优先级建议（自愈治理）

1. **立即（P0）**：ps1 L252 `[[:space:]]`→`\s` 并补回归（F2）；sh 坏 JSON/缺 command 改 fail-closed deny（F1）；doctor/wiring-check 加实弹 deny 探测（F6）。
2. **本周（P1）**：三端统一 redact（F5）；DSH 规则引擎 NFKC + echo 剥离（F4）；丢弃 universal/dist 旧副本并扩 M7 白名单（F7）；opencode 崩溃 fail-closed + task 工具名 + 注册文件自保护（F8）。
3. **下个迭代（P2）**：POSIX trash 前置与校验（F3 需跨平台排期）；性能合并 spawn + 超时语义文档（F9）；agy 四态回归（F10）。