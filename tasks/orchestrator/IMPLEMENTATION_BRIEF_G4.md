# IMPLEMENTATION_BRIEF — G4：ps1 规则 16d 死代码修复

- 生成：2026-09-11 · Orchestrator Vertical Slice 选择
- 来源：SUBAGENT-D F2（P0 实证）；PRODUCT_GAP_MAP G4

## 目标
修复 PowerShell hook（dangerous-commands.ps1）规则 16d 的死代码问题：`[[:space:]]` POSIX 字符类
在 .NET 正则（PowerShell `-match`）中无效，导致"变量赋值/间接删除"类规则（$x=rm; $x -rf 等）
在 Windows 端完全失效（恒 False → 放行），而 sh 端同类规则生效。修复后 sh/ps1 两端对同一
绕过向量给出一致判定。

## 用户场景
Windows 用户（Claude Code / Codex / AGY 均调用 ps1 hook）执行或诱导模型执行：
- `$x=rm; $x -rf /tmp/t`
- `$x = rm; $x -rf /tmp/t`
- `$x="rm -rf /tmp/t"; $x`
- `$x=Remove-Item; $x -Path C:\temp -Recurse -Force`（同构变体）
当前全部放行（16d 死代码）；修复后应被 deny（与 sh 端一致）。

## 当前问题（证据）
- `assets/hooks/dangerous-commands.ps1` 规则 16d（约 L246-248）：四分支全部含 `[[:space:]]`。
- 实证（pwsh）：`'a b' -match '[[:space:]]'` → **False**（对照 `'a b' -match '\s'` → True）。
- `$a=rm; $a -rf /tmp/t` 用规则文本匹配 → False；去掉 POSIX 类后能命中。
- 四套 ps1 测试（37+8+18+53）无任何 `$x=` / `X=` / `CMD=` 用例 → 全绿掩盖。
- sh 端等价规则存在且生效（sh-audit-bypass.sh L339 `X=rm; $X -rf` → deny）。

## 理想行为
ps1 hook 对上述 4 类变体输出 deny（permissionDecision=deny），与 sh 端判定一致。

## 涉及模块
- `assets/hooks/dangerous-commands.ps1`（规则 16d：`[[:space:]]` → `\s`）
- 同步副本：`skills/agent-risk-guard/scripts/dangerous-commands.ps1`
- 生产三处：`~/.claude/hooks/`、`~/.codex/hooks/`、`~/.gemini/config/hooks/`
- 测试：`agent-risk-guard-audit/tests/hook-audit-reregress.ps1`（或 bypass 套件）补用例

## 不能破坏什么
- ps1 其它规则的正则语义（`[[:space:]]` 只在 16d 使用，但应全文 grep 确认无其它误用；若有，一并替换）
- sh 端等价规则行为（ps1 修复不得改变 sh 判定，保持跨端一致）
- 现有 4 套 ps1 回归（37+8+18+53）必须保持全绿
- 文件必须保持 UTF-8 with BOM（PowerShell 5.1 无 BOM 解析中文会 ParseError，历史上踩过坑）

## 验收标准
1. ps1 文件中不再出现 `.NET 正则语义下的 POSIX 字符类误用`（grep `[[:space:]]` 于 ps1 断言为零或全部为 `\s`/`[ \t]` 等价物）
2. 新回归用例通过：`$x=rm; $x -rf /tmp/t`、`$x = rm; ...`、`$x="rm -rf"`、Remove-Item 变体 → 全部 deny
3. 现有 4 套 ps1 回归全绿（37/37+8/8+18/18+53/53）
4. sh 端同向量仍 deny（不回归），sh 三套件保持全绿
5. 四处 ps1 副本（assets+skills+生产 3 处）字节一致，BOM 保持

## 错误场景
- `$x=rm --help`（无害帮助）→ 应 allow（对照组）
- `$x = rm -h` → allow
- 正常命令 `echo hello` / `git status` → allow（无误伤）

## 测试要求
- ps1 回归补 4-6 个 16d 相关用例（deny 组 + allow 对照组）
- 跨端一致性：同一用例集在 sh 与 ps1 都要跑（声明即可，实际执行在验证阶段）
- 修复后用 pwsh 直接跑 hook-rules-test.ps1 等确认