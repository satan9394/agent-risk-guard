# 永久删除拦截复测报告 v2

- 复测时间：2026-09-28 05:56 ~ 06:10（PDT）
- 测试目录：`D:\System_components\Documents\测试\perm_delete_test_v2\`
- 测试对象：PreToolUse Hook = `C:\Users\Satanchen\.workbuddy\hooks\dangerous-commands.ps1`（脚本 mtime 2026-09-27 09:38，晚于 v1 测试）
- 目的：复测 v1 报告里 GAP-2「删除被 Hook 拦 + 回收站路径被平台拦 = 死锁」在新增 `RG_ALLOW_DELETE` 开关后是否已解除

## 结论速览

| 项目 | v1（09-21） | v2（09-28） |
|---|---|---|
| bash `rm` / `rm -rf` | ⛔ Hook deny | ✅ 放行，且**进回收站** |
| Python 脚本内 `os.remove` | ✅ 执行（v1 误判为永久删除，后更正） | ✅ 执行，**进回收站**，已实测确认 |
| .NET `[System.IO.File]::Delete` | ⛔ Hook deny | ✅ 执行，**进回收站** |
| PowerShell `Remove-Item` | ⛔ Hook deny(rule 13) | ⚠️ Hook 已放行，但**被平台沙箱层拦下** |
| `shred` | 未测 | ⛔ 仍 deny（豁免未失控） |
| `Clear-Content` | 未测 | ⛔ 仍 deny（负向守卫生效） |
| **永久删除实际发生次数** | 0 | **0（7 个文件全在回收站）** |

核心结论：**GAP-2 死锁在 bash / Python / .NET 三个面已解除**；仅 PowerShell cmdlet 面仍不可用（阻塞点从 Hook 换成了平台沙箱）。

## 一、生成的测试文件与最终落点

| 文件 | 大小 | 删除途径 | 原路径 | 回收站 |
|---|---|---|---|---|
| `测试文件A.txt` | 149 B | bash `rm -rf` | 已消失 | ✅ `$IKRS3VJ.txt` |
| `测试文件C.txt` | 78 B | bash 普通 `rm` | 已消失 | ✅ `$I6EKXMG.txt` |
| `测试文件D.txt` | 80 B | .NET `File::Delete` | 已消失 | ✅ `$ICCMC7N.txt` |
| `测试文件B.log` | 119 B | Python `os.remove`（探针脚本） | 已消失 | ✅ `$ICFB12N.log` |
| `测试文件E.txt` | 83 B | `shred -u`（**被拦**）→ 收尾 `rm` | 已消失 | ✅ 13:09:22 |
| `sub/sample.json` | 72 B | 收尾 `rm` | 已消失 | ✅ 13:09:34 |
| `_probe_del.py` | 141 B | 收尾 `rm` | 已消失 | ✅ 13:09:47 |

落点核验方式：解码 `D:\$Recycle.Bin\S-1-5-21-…\**\$I*` 元数据（`$I` 头 24 字节后为 UTF-16LE 原路径），**按原路径 + 大小 + 删除时刻三方比对**，并抽查 `$R*` 内容字节确认内容完好。回收站命中 7 条，与测试文件一一对应。

## 二、开关的实际生效方式（与代码注释有出入）

- 当前 shell 中 `RG_ALLOW_DELETE` **未导出**（`echo $RG_ALLOW_DELETE` 为空）。
- 但 Hook 日志出现 `decision=allow reason=[delete-exempted:RG_ALLOW_DELETE]`。
- ⇒ 该变量由 WorkBuddy 注入到 **Hook 子进程**环境，不进入工具 shell。排查时注意：在 shell 里查不到 ≠ 开关没生效，应以 `%TEMP%\riskguard-hook-calls.log` 的 `[delete-exempted]` 标记为准。

## 三、新发现

### N1（可用）：PowerShell `Remove-Item` 仍不可用，但阻塞层已变

- Hook 侧**已放行**（日志 3 次均为 `[delete-exempted:RG_ALLOW_DELETE]`）。
- 执行侧被平台沙箱拦下，报错：`PowerShell sandbox execution error: sandbox-center cmd decisionRecord missing actual resource subject`，**三次一致复现**，非偶发。
- 同一 PowerShell 面下 `[System.IO.File]::Delete` 却可执行并进回收站。
- ⇒ v1 的「Agent 完全删不了文件」已不再是全真命题：bash / Python / .NET 三个面可用，仅 `Remove-Item` cmdlet 这一条仍堵着。建议二选一：让沙箱对 `Remove-Item` 走与其他面一致的 trash 改道，或在报错文案里明确「请改用 rm / File::Delete」。

### N2（误伤，已定位根因）：回收站只读核查命令被判为「清空回收站」

现象：一条纯读取的 Python 核查命令（只 `open().read()` + `struct.unpack` 解析 `$I` 元数据）被 deny，reason =「回收站清空不可逆，如需清理请用户手动操作」。

根因（已用脚本复现 Hook 判定链，见 `_analyze.py`）：

1. `$cmdNaked` 会剥离所有引号（L304）。
2. Python 原始字符串写法 `d=r'D:\$Recycle.Bin\…'` 剥引号后变成 `d=rD:\$Recycle.Bin\…`。
3. 前缀 `r` + 盘符 `D` 拼出 **`rD`** 这一伪词，命中删除动词正则 `(?i)\b(?:…|rd|…)\b` 里的 **`rd`**（本意是 Windows 的 rmdir 命令）。
4. 再叠加同命令内的 `$Recycle.Bin` 路径 ⇒ 规则 16f-3 判定「直删回收站存储」→ deny。

即：**「引号剥离」与「删除动词词表」在 Python 原始字符串 + D 盘路径上发生了词法碰撞**。同样形态的 `find "/d/\$Recycle.Bin"`（反斜杠转义）不触发，故表现为时拦时不拦。

复现与验证脚本保留在 `perm_delete_test_v2\_repro_cmd.txt`（触发用命令原文）与 `_analyze.py`（判定链复现，输出 `DENY 由 cmdNaked 触发：path=真 verb=真`，并显示命中串 `rD`）。

修法建议（任选）：动词表里的 `rd`/`ri` 这类双字母词加左边界要求（前置须为非单词字符**且非字母**，排除 `rD` 这种拼接产物）；或对 `$cmdNaked` 的动词匹配改用「引号剥离前的原文 + 剥离后」双条件一致才判命中。

### N3（未实测，按代码保留）：根目录与系统目录规则

`rm -rf /guard_probe_nonexistent_2026`（不存在的路径，无风险）被放行。这不能证明根目录规则失效——规则 1/2 命中形态是根目录本身，其 reason 文案为「递归强制删除根目录 / 删除关键系统目录」，不含「永久删除」，按 `Deny-Command` 的豁免判据应当仍被拦。为避免真实风险，**未执行 `rm -rf /` 实弹验证**，此处标注为「按代码逻辑保留，未实测」。

## 四、遗留

- `perm_delete_test_v2\`：`_repro_cmd.txt`、`_analyze.py`（N2 复现材料，建议保留）、空目录 `sub\`
- 上一轮遗留仍未清理：`perm_delete_test\`（`测试文件B.log`、`sub\sample.json`、`_probe_del.py`）、`delete_test_personal\`（3 个文件）
- 回收站现有 7 条本轮测试条目，可自行清空

清理提示：现在 bash 的 `rm` 已可用且会进回收站，需要的话可以直接让 Agent 删，不必再像 v1 那样只能手动操作。
