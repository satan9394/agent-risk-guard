# sh hook（dangerous-commands.sh）对抗审查报告 — R25

> 审查方式：GAN 独立判别器（独立子代理启动失败，由主代理接手完成）。
> 审查目标：`scripts/dangerous-commands.sh`（Linux/macOS 生产门禁，231→250 行）——
> 与已通过 4 轮审查的 ps1 hook 同规则集，但从未被独立判别器审过。
> 探测依据：子代理遗留的 40 用例 edge 脚本 + 主代理 59 用例原套件 + 23 用例 ps1↔sh 行为矩阵。

## 摘要

**初始评分：6.0/10**（sh 与 ps1 存在系统性覆盖差距，Windows/系统工具类规则缺失 + 多处绕过）。
修复后：edge 40/40、原 59/59、ps1↔sh 行为矩阵 23/23 一致。

## P0 — 绕过（已全修）

| # | 向量 | 现状 | 修复 |
|---|------|------|------|
| 1 | 反引号命令替换（`rm -rf /tmp/x` / echo `rm` / val=`rm`） | allow | 10 区正则放宽：反引号不要求闭合、任意位置 |
| 2 | base64/xxd/zcat/gunzip/bzip2 管道到 shell（echo b64 \| base64 -d \| bash） | allow | 9 区管道正则补 base64/xxd/zcat/gunzip/bzip2/tar |
| 3 | herestring（bash <<< "rm -rf /t"） | allow | 10 区补 <<< 内容检测 |
| 4 | 变量间接执行（X=rm; $X -rf /t / CMD=rm; $CMD / A=rm;B=-rf;C=/t;$A $B $C） | allow | 10b/16d 赋值启发式 + 尾缀 ; 与 $ |
| 5 | 变量间接 eval/bash -c（F="rm -rf"; eval $F / bash -c "$F"） | allow | 11 区 eval/-c 补 \$VAR 形式 |
| 6 | 反斜杠/前导斜杠 rm（r\m / \rm / /rm） | allow | 10b/16d 补 [\\/] 前缀与 r[\\/]m |
| 7 | docker exec rm（docker exec abc rm -rf /app） | allow | 14 区补 exec |

## P1 — ps1 规则覆盖差距（sh 缺失，已补齐）

| 缺失规则（ps1 有、sh 无） | 修复 |
|------|------|
| certutil -urlcache/-decode | 17 区（Windows/系统工具块） |
| reg delete | 17 区 |
| net user / localgroup | 17 区 |
| bcdedit /delete | 17 区 |
| takeown system32/windows | 17 区 |
| icacls /grant /deny /setintegritylevel | 17 区 |
| .NET [IO.File]::Delete / [IO.Directory]::Delete | 17 区 |
| Clear-Disk / Format-Volume | 17 区 |
| IEX + WebClient/DownloadString | 17 区 |
| rimraf / fs-extra remove（sh 已有，核对） | —（已覆盖） |
| Clear-Content / .Delete( | 1b 区 |

## P1 — 误伤缺陷（ps1 与 sh 共有，本次双修）

**rm --help / rm -h / rm --version / rm -V / rm -v 被误拦**：
- ps1 16 主规则的 help 排除在运行时不生效（`-` 已被消费，负前瞻位置偏移），16c 引号插词规则对 `rm -V/-v` 误拦
- sh 的 `rm[[:space:]]*["'']*[[:space:]]*-[a-z]`（16 区）因 `["'']*` 允许零引号，`rm -h` 等全被拦
- **修复**：ps1 16 主改 `-and (-notmatch ...rm\s+(-h|--help|--version|-V)\b)` 显式排除；16c 负前瞻修正。sh 16 区改 `["'']+`（至少一个实引号）+ 主 rm 规则 rmseg case 排除 help。
- 验证：两版 rm --help/-h/--version/-V/-v 全部 allow；rm x、rm -rf 仍 deny。

## 与 ps1 行为一致性

23 用例行为矩阵（rm 系/echo 引号剥离/echo 无引号 deny/git 破坏/docker/certutil/reg/反引号/变量间接/help 系/正常命令）：
**修复后零差异**。其中 `X=rm; $X -rf` 为 sh 先有（10b），ps1 补 16d 对齐。

## 验证

- edge 40/40（子代理遗留探测套件，含反引号/heredoc/base64/解压管道/herestring/变量间接/别名/反斜杠/系统工具/.NET/IEX/CRLF）
- 原 sh-hook-test 59/59
- ps1 hook-rules 21/21 + ps1-help-check 6/6
- ps1↔sh 矩阵 23/23 一致
- test-all 22 组全绿

## 终态

sh hook 与 ps1 完全对齐（规则集、防误伤、行为矩阵）。临时调试文件已回收。