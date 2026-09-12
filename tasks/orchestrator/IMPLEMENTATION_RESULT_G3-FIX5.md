# IMPLEMENTATION RESULT G3-FIX5 —— 向上对齐（动 ps1）+ 结构性收敛 + 修闸门自相矛盾

> 实现者：G3-FIX5 Implementer。**本文件不宣布成功**——裁决权在独立 Evaluator。
> 依据：`FIX_BRIEF_G3-FIX5.md`（逐条执行）；参照 `EVALUATION_RESULT_G3-FIX4.md`（REJECT 裁决 + §4-A 的 12 条 / §4-B 的 24 条 / §2.4d 的既存分歧族）。
> 纪律：D6 真实 spawn + 进程 stdin（sh 一律 `wsl.exe -e bash <wsl路径>`）；D7 构造邻居；D8 四列基线；D9 ps1 逐份复核 BOM（**本轮触发 1 次**，已修）；D10 跨端探针串行；D12 一致性**向上**对齐。
> 证据目录：`E:\DeepSeek_Harness\workspace\2026_08_21\agent-risk-guard\tasks\orchestrator\_g3fix5*`

---

## 0. 一页速览

| # | 任务卡要求 | 落实 | 位置 |
|---|---|---|---|
| A | 向上对齐 sudo / 路径前缀（sh + ps1 同批） | 两端新增**统一前缀** `CMD_PRE` / 内联同形，覆盖 10 组危险基座 | sh L415；ps1 L271/279/287/320-332/347/354/357/360/364/367/393/492/498 |
| A+ | 锚点审计中发现的第二类缺口：**命令位包装**（`cmd /c` / `command` / `env`） | 两端同批并入统一前缀（ps1 五套之一 `cmd /c del /f C:\x\y` 就是靠它保住的） | sh L415 + L432；ps1 同 18 处 |
| B | 结构性收敛：ps1 也做空引号归一 | ps1：`$cmdOrig`（回显/日志）+ `$cmd` 就地归一 → **全部规则**读归一文本；sh：`cmd="$cmdNoq"` **全局归一**（回退 M2 收窄） | ps1 L223-224；sh L397 |
| C | 修闸门自相矛盾 + 补语料 | F1–F15 由 `allow` 改钉 `deny`（与 C6/C12/C16/C17 同判）；新增 K 段 38 条（前缀面 / 既存分歧族 / 包装面 / 过拦面） | `packages/core/test/decision-parity.test.ts` |

**红线结果（详见 §6）**：G3 五条原分歧 0 回退；R2 不回退；parity A/B/C 绿；M2r/M4r 变异仍红；`sh-failclosed-test` 34/34；sh 四套 × 三棵树全绿；**ps1 五套全绿**；node 全量绿；sh ×3 + ps1 ×6 全部 distinct=1、ps1 BOM=True、行尾 LF；过拦面全 allow。

**但仍有 2 条既存两端分歧未消（pre-G3 起，非本轮引入），如实登记于 §8。**

---

## 1. 改动逐条对照（可指代码行）

### 1.1 sh（`agent-risk-guard-audit/scripts/dangerous-commands.sh`，41374 → 44326 B）

| # | 行 | 改动 | 依据 |
|---|---|---|---|
| B-1 | **L397** 新增 `cmd="$cmdNoq"` | **全局空引号归一**（就地替换检测文本）；`cmdOrig`（L388）仍供回显/脱敏 | 必修 B；回退 FIX4/M2 的「只给删除族」收窄 |
| B-2 | L390-396 | 归一注释块重写（记录方向、豁免、回显口径） | 防后来者误读 |
| B-3 | L382-386 | 把 FIX4 的「cmd 保持原样」注释标注为**已回退** | 同上 |
| A-1 | **L415** 新增 `CMD_PRE` | `CMD_PRE='(^|[;&|])[[:space:]]*(sudo[[:space:]]+)?(/[^[:space:];&|]*/)?(cmd[[:space:]]+/c[[:space:]]+|cmd\.exe[[:space:]]+/c[[:space:]]+|command[[:space:]]+|env[[:space:]]+)?'` | 必修 A + 包装面 |
| A-2 | L424（规则 1 rmdir/unlink/shred） | `${CMD_SEG}` → `${CMD_PRE}` | 必修 A |
| A-3 | L429（裸 rm）+ **L432 rmseg 抽取式** | 锚 → `CMD_PRE`；抽取 sed 同步（换 `#` 分隔符 + 分组号 `\4`→`\5`） | 必修 A；不加抽取式同步会让 `sudo rm --help` 误拦 |
| A-4 | L443（del/erase/ri/rd/rmdir 族） | `${CMD_SEG}` → `${CMD_PRE}`（`Clear-Content`/`.Delete(` 保持无锚） | 必修 A；与 ps1 16b2 同口径 |
| A-5 | L455（引号插词 rm） | `${CMD_SEG}` → `${CMD_PRE}` | 必修 A |
| A-6 | L469（find -delete / -exec rm） | 段首锚 → `CMD_PRE` | **★ FIX4 12 条放松的正解** |
| A-7 | L476（xargs/for rm） | 同上 | **★ 同上** |
| A-8 | L539（diskpart/mkfs/fdisk/parted/wipefs） | `${CMD_SEG}` → `${CMD_PRE}` | 必修 A + 既存分歧族 |
| A-9 | L551（format） | 同上 | 同上 |
| A-10 | L585（shutdown/reboot/halt/poweroff） | 补绝对路径前缀 + 包装前缀 | 必修 A |
| A-11 | L593（chmod 777） | 补 sudo + 路径 + 包装前缀 | **★ FIX4 U2 的 sh 侧** |
| C-1 | L29 / L440-442 / L453-454 | 陈旧注释更新为 FIX5 口径 | 诚实性 |

### 1.2 ps1（`agent-risk-guard-audit/scripts/dangerous-commands.ps1`，34523 → 39349 B）

| # | 行 | 改动 | 依据 |
|---|---|---|---|
| B-4 | **L223-224** 新增 `$cmdOrig = $cmd` / `$cmd = $cmd -replace "''",'' -replace '""',''` | 归一提升为**检测用文本**；`$cmdTest`/`$cmdNaked`（L233/237）随之从归一文本派生 | 必修 B（Evaluator §5 建议） |
| B-5 | **L592** `Write-HookLog 'allow' $cmdOrig` | 日志读**原文** | 回显/日志口径 |
| A-12 | L271（规则 6 shutdown） | 补绝对路径 + 包装前缀 | 必修 A |
| A-13 | **L279（规则 7 format）** | `\bformat…`（无锚）→ 段首锚 + sudo + 路径 + 包装 | 既存分歧族（Evaluator §2.4d） |
| A-14 | **L287（规则 8 diskpart）** | `$cmdTest \bdiskpart\b`（无锚）→ `$cmd` + 同形锚 | 同上（且修掉 `git commit -m "remove Diskpart usage"` 的误伤） |
| A-15 | **L320/323/326/329/332（规则 14 五条）** | `\bdel\s+` / `\berase\b` / `\bri\s+(…)` / `\brmdir\s+(…)` / `\brd\s+(…)`（全无锚）→ 同形锚 | 既存分歧族；**16f（回收站）保持无锚补查，故 `rd C:\$Recycle.Bin` 等仍 deny** |
| A-16 | **L347（规则 16 rm）** | 补 sudo/路径/包装；**豁免前瞻用同一前缀** | 必修 A（`sudo rm --help` 不得误拦） |
| A-17 | L354/357/360/364/367（16b 五条：unlink/shred/find/-exec/xargs） | 补统一前缀 | **★ FIX4 12 条放松的正解** |
| A-18 | L393（16c 引号插词 rm） | 补统一前缀 | 必修 A |
| A-19 | **L492（规则 28 shutdown）** | 补路径 + 包装前缀 | 必修 A |
| A-20 | **L498（规则 29 chmod 777）** | 补 sudo + 路径 + 包装前缀 | **★ FIX4 U2 的 ps1 侧（U2 洞堵上）** |
| — | L340（规则 15 `rm -rf` 任意位置）、L312（Remove-Item）、L375（Clear-Content）、L381（`.Delete(`） | **刻意不动** | G11/G12/G15/G16 依赖其无锚 deny；动了两端同形残留会破 |

**ps1 一次性替换的机械校正**：`(?:sudo\s+)?(?:/[^\s;&|]*/)?` 共 **18 处**（含规则 16 的两处前瞻），由 `_g3fix5_addwrap.ps1` 统一追加包装组，避免逐条手改产生形差。

### 1.3 闸门（`packages/core/test/decision-parity.test.ts`）

- F 段表头与 F1–F15 的 `expect` 由 **allow → deny**，F7/F8/F9/F13 加 `★FIX4 自相矛盾点` 注（与 C6/C16/C17/C12 同判）。
- 新增 **K 段 38 条**（K1–K38）：A 面（sudo / `sudo''` / `/usr/bin/` × chmod/find -delete/find -exec/xargs/shutdown/rm）、B 面（既存分歧族 × diskpart/rmdir/format）、C 面（补前缀后的过拦面）、D 面（`cmd /c` / `command` / `env` 包装）。
- 文件头新增「已知残留不入语料」的显式声明（`rmdir <无标志路径>`、`echo "Format-Volume guide"`），并写明**不得为过闸门放宽 deny 语义**（D12）。

---

## 2. §A 的四列 before/after（ps1 / pre-G3 / post-G3 / post-FIX5）

原始数据：`_g3fix5_probe_before.json`（142 条 × 4 列）与 `_g3fix5_probe_after.json`（160 条 × 2 列），合并表见 `_g3fix5_tables.md`。

### 2.1 §1 点名的 12 条真实危险命令（+2 条同族邻居）

| 载荷 | ps1(FIX4) | pre-G3 sh | post-G3 sh | sh(FIX4) | **ps1(FIX5)** | **sh(FIX5)** | 应然 |
|---|---|---|---|---|---|---|---|
| `sudo chmod 777 /x` | allow | **deny** | deny | allow ⚠ | **deny** | **deny** | deny |
| `sudo'' chmod 777 /x` | allow | deny | deny | allow | **deny** | **deny** | deny |
| `/usr/bin/chmod 777 /x` | allow | allow | allow | allow | **deny** | **deny** | deny |
| `sudo find /tmp -delete` | allow | **deny** | deny | allow ⚠ | **deny** | **deny** | deny |
| `sudo'' find /tmp -delete` | allow | deny | deny | allow | **deny** | **deny** | deny |
| `/usr/bin/find /tmp -delete` | allow | deny | deny | allow ⚠ | **deny** | **deny** | deny |
| `sudo find /tmp -exec rm {} ;` | allow | deny | deny | allow | **deny** | **deny** | deny |
| `/usr/bin/find /tmp -exec rm {} ;` | allow | deny | deny | allow | **deny** | **deny** | deny |
| `sudo xargs rm < list.txt` | allow | **deny** | deny | allow ⚠ | **deny** | **deny** | deny |
| `sudo'' xargs rm < list.txt` | allow | deny | deny | allow | **deny** | **deny** | deny |
| `/usr/bin/xargs rm < list.txt` | allow | deny | deny | allow | **deny** | **deny** | deny |
| `sudo'' shutdown /s` | allow | deny | deny | allow | **deny** | **deny** | deny |
| `/usr/bin/shutdown /s`（同族邻居） | allow | allow | allow | allow | **deny** | **deny** | deny |
| `sudo rm x`（同族邻居） | allow | allow | allow | allow | **deny** | **deny** | deny |

（⚠ = FIX4 相对 pre-G3 的**真实回归**；`sudo shutdown` / `/usr/bin/shutdown` 见 §2.3 表。）

### 2.2 §B 的 24 条空引号危险写法（全部 allow → deny）

A 组 15 条（命令词之间）：`g''it clean -f`、`g''it reset --hard`、`g''it rm x`、`g''it push --force`、`g''it branch -D x`、`r''mdir /s /q x`、`R''MDIR /s /q x`、`s''hutdown /s`、`c''hmod 777 /x`、`d''iskpart`、`sh''red -u /tmp/t`、`un''link /tmp/t`、`f''ind /tmp -delete`、`d''el /f x`、`e''rase x`
B 组 9 条（危险词内部）：`git cl''ean -f`、`git res''et --hard`、`shut''down /s`、`ch''mod 777 /x`、`unl''ink /tmp/t`、`shr''ed -u /tmp/t`、`rmd''ir /s /q x`、`di''skpart`、`fi''nd /tmp -delete`

**24/24 全部**：FIX4 两端 `allow` → FIX5 两端 **`deny`**（逐行见 `_g3fix5_tables.md` §2）。

反向守卫（**仍 deny**）：`rm'' --help` 之外的 16 条 —— `r''m -rf /tmp/t`、`rm'' -rf''`、`R''emove-Item x`、`;''rm -rf /tmp/t`、`''rm -rf /tmp/t`、`rm''-rf /tmp/t`、`rm' '-rf /tmp/t`、`""rm -rf /tmp/t`、`sudo'' rm -rf /tmp/t`、`r''m'' -rf /tmp/t`、`rm'''' -rf /tmp/t`、`R''''emove-Item x`、`''''''''rm -rf /tmp/t`、`rm"""" -rf`、`sudo'' rm -rf` … **全 deny**。
豁免面（**仍 allow**）：`rm'' --help` / `rm'' -h` / `rm'' --version` / `rm'' -v` / `rm''''` / `rm"" -h` / `r''m --help` / `RM --help` / `RM -H` / `RM -V` —— **10/10 allow**。

### 2.3 既存分歧族（Evaluator §2.4d，≥12 条）

sudo / `sudo''` / `/usr/bin/` × {diskpart, rmdir, format} = 9 条：FIX4 `ps1=deny / sh=allow` → FIX5 **两端 deny**。
其镜像 `x <词>` 3 条：FIX4 `ps1=deny / sh=allow` → FIX5 **两端 allow**（`x` 不是可执行命令；这是**修正 ps1 的误伤**，**不是** D12 意义上的「放松真实危险命令」，已在闸门 K18/K22/K26 的 note 里写明）。
`git commit -m "remove Diskpart usage"`（FIX4 报告登记的「唯一残余分歧」）→ 两端 allow（ps1 的无锚误伤修正）。

---

## 3. 逐处锚点两端对照表（含取舍）

| 危险基座 | sh 规则（FIX5 行） | ps1 规则（FIX5 行） | FIX4 锚（sh / ps1） | FIX5 锚（两端同形） | 取舍与理由 |
|---|---|---|---|---|---|
| rmdir / unlink / shred | L424 | 14 L329 / 16b L354·L357 | `CMD_SEG` / `\b` 无锚·段首锚 | **CMD_PRE / 同形** | 向上补 sudo+路径；ps1 的 rmdir 由无锚改锚（修误伤） |
| rm（裸 rm + help 豁免） | L429 / L432 | 16 L347 | `CMD_SEG` / 段首锚 | **CMD_PRE / 同形** | 向上；豁免前瞻同批加前缀 |
| del / erase / ri / rd | L443 | 14 L320·323·326·332 | `CMD_SEG` / `\b` 无锚 | **CMD_PRE / 同形** | 向上；ps1 无锚 → 锚（消除既存分歧） |
| Remove-Item / Clear-Content / `.Delete(` | L443（无锚） / 431 | 13 L312 / 16b2 L375·L381（无锚） | 无锚 / 无锚 | **保持无锚（两端同形）** | 这两类**刻意不加锚**：加了会让 `echo "Remove-Item docs"` 之外的合法引号文本行为变化；FIX4 的 1b-2 补查已同形 |
| rm 引号变体 | L455 | 16c L393 | `CMD_SEG` / 段首锚 | **CMD_PRE / 同形** | 向上 |
| find -delete / -exec rm | L469 | 16b L360·L364 | 段首锚 / 段首锚 | **CMD_PRE / 同形** | **★ 修复 FIX4 的 12 条**：FIX4 把两端锚「对齐」成都不认 sudo/路径 → 两端一起漏 |
| xargs / for rm | L476 | 16b L367 | 段首锚 / 段首锚 | **CMD_PRE / 同形** | **★ 同上** |
| diskpart / mkfs / fdisk / parted / wipefs | L539 | 8 L287（**仅 diskpart**；ps1 无 fdisk/parted/wipefs 规则） | `CMD_SEG` / `\b` 无锚 | **CMD_PRE / 同形** | 向上 + 既存分歧；**ps1 仍缺 fdisk/parted/wipefs → 保留分歧，登记 §8** |
| format | L551 | 7 L279 | `CMD_SEG` / `\b` 无锚 | **CMD_PRE / 同形** | 向上 + 既存分歧 |
| shutdown / reboot / halt / poweroff | L585 | 6 L271 + 28 L492 | 已有 sudo、无路径 / 已有 sudo | **CMD_PRE / 同形** | 向上补路径 + 包装 |
| chmod 777 | L593 | 29 L498 | 无 sudo / 无 sudo | **CMD_PRE / 同形** | **★ U2 洞：两端一起堵** |
| `rm -rf` 任意位置 | L481 | 15 L340 | 无锚 / 无锚 | **保持无锚（两端同形）** | G11/G12/G15/G16 依赖；锚化会让「引号内 `RM -rf`」两端一起 allow → 属加固候选，超出本卡 |
| icacls | L593（大 OR 无锚） | 36 L574（段首锚） | 无锚 / 段首锚 | **未动（保留分歧）** | 动任一端都会新造分歧或放松；本卡未点名，登记 §8 |
| 命令位包装 `cmd /c` / `command` / `env` | L415 + L432 | 18 处 | 不存在 | **新增（两端同形）** | ps1 五套 `hook-bypass-regression` 第 26 条靠它保住；方向为**向上**（sh 也一起拦） |

**`/usr/bin/` 第二前缀的口径决定**（任务卡要求逐条列出）：FIX4 时 **ps1 完全没有路径前缀**，sh 也没有。本轮**两端同时**接受「以 `/` 开头的绝对路径」形态（`/[^\s;&|]*/`）——
- 取更严者：`/usr/bin/chmod`、`/usr/bin/find`、`/usr/bin/xargs`、`/usr/bin/shutdown` 由 allow → **deny**（sh 侧 pre-G3 里 `find`/`xargs`/`chmod` 的旧无锚正则偶然命中过，属**恢复拦截**）。
- 限「绝对路径」而非任意 `*/`：避免 `cat ./etc/mkfs.conf`、`./tools/format.py` 这类相对路径误伤（已探针核对：`git diff --stat /usr/bin/README` allow）。
- 未纳入：`~` 展开、`$PATH` 变量、`doas`、`busybox find`、`bash -c "…"` 的完整包装 —— 登记 §8。

---

## 4. 闸门期望修正清单

| 位置 | FIX4 期望 | FIX5 期望 | 理由 |
|---|---|---|---|
| F1–F5（`g''it …` 五条） | allow | **deny** | 空引号归一后两端同判 = C 段同型（C13 `GIT CLEAN -f` 等） |
| F6 `r''mdir /s /q x` | allow | **deny** | = C6 `RMDIR /s /q x` |
| F7 `R''MDIR /s /q x` | allow | **deny** | ★ 与 C6 **逐字同一条** bash 命令，FIX4 却钉 allow = 自相矛盾 |
| F8 `s''hutdown /s` | allow | **deny** | ★ 与 C16 同判 |
| F9 `c''hmod 777 /x` | allow | **deny** | ★ 与 C17 同判 |
| F10 `d''iskpart` | allow | **deny** | 归一后是危险命令 |
| F11 `sh''red -u /tmp/t` | allow | **deny** | = C8 `Shred -u` |
| F12 `un''link /tmp/t` | allow | **deny** | = C7 `UNLINK` |
| F13 `f''ind /tmp -delete` | allow | **deny** | ★ 与 C12 同判 |
| F14 `d''el /f x` / F15 `e''rase x` | allow | **deny** | 归一后是永久删除 |
| F16/F17/F18 | deny/deny/allow | **不变** | 反向守卫与对照 |
| 新增 K1–K38 | — | 见 §2.1/§2.3 | 补 Evaluator 点名的零覆盖面（A 面 + 既存分歧族 + 包装面 + 过拦面） |

**自相矛盾清单（任务卡 §3 点名）** —— 已全部消除：

| C 段 | F 段（FIX4） | bash 下是否同一条命令 | FIX5 后 |
|---|---|---|---|
| C6 `RMDIR /s /q x` = deny | F7 `R''MDIR /s /q x` = allow | **是**（`''` 被 shell 消去） | 两端 deny / 期望 deny |
| C12 `find /tmp -DELETE` = deny | F13 `f''ind /tmp -delete` = allow | 是 | 同上 |
| C16 `SHUTDOWN /s` = deny | F8 `s''hutdown /s` = allow | 是 | 同上 |
| C17 `CHMOD 777 /x` = deny | F9 `c''hmod 777 /x` = allow | 是 | 同上 |

---

## 5. 闸门变异证据（A/B 任一改回旧行为 → 必红）

变异体（隔离副本，**未改主源**；`_g3fix5_mutants/`）：

| 变异体 | 回退了什么 | sha256(16) | 字节 | BOM |
|---|---|---|---|---|
| `MA1-sh-noprefix.sh` | A：sh 的 `CMD_PRE` 退回 `(^|[;&|])[[:space:]]*` | `021b6f81b3daf1f4` | 44080 | False |
| `MA2-ps1-noprefix.ps1` | A：ps1 统一前缀里的 `(?:sudo\s+)?(?:/[^\s;&|]*/)?` 全删 | `5b0f23637f168c7a` | 38053 | True |
| `MB1-sh-nonorm.sh` | B：sh 删掉 `cmd="$cmdNoq"` | `f90759f7609750f3` | 44142 | False |
| `MB2-ps1-nonorm.ps1` | B：ps1 删掉空引号归一那一行 | `127da3439c7470ed` | 38568 | True |
| `M4r-fix5-redact-passthrough.sh` | 红线：`redact_text` 直通（FIX5 基底重建） | `1ee1919e1a591fc6` | 44106 | False |
| `M2r-fix5-tab-unescaped.sh` | 红线：TAB/C0 不转义（FIX5 基底重建） | `600247a76317e094` | 44181 | False |

结果见 §5.1（由 `_g3fix5_mutation.ps1` 生成，日志 `_g3fix5_gate_*.log`）。

<!--MUTATION-RESULTS-->

---

## 6. 回归数字

### 6.1 sh 四套 × 三棵树（真实 spawn；日志 `_g3fix5_suite_<树>_<套>.log`）

| 树 | sh-hook-test | sh-audit-bypass | sh-audit-edge | sh-failclosed-test |
|---|---|---|---|---|
| audit | **67/67 rc=0** | **192/192 FAIL=0 rc=0** | **40/40 rc=0** | **34/34 rc=0** |
| skills | **67/67 rc=0** | **192/192 FAIL=0 rc=0** | **40/40 rc=0** | **34/34 rc=0** |
| xhs-publish | **67/67 rc=0** | **192/192 FAIL=0 rc=0** | **40/40 rc=0** | **34/34 rc=0** |

> 说明：任务卡写的「67/40/34/192」是**四套的计数集合**；实测映射为 hook-test=67、audit-bypass=192、audit-edge=40、failclosed=34。**12/12 次运行 rc=0、FAIL=0。**

### 6.2 ps1 五套（本轮**首次动 ps1**，五套全跑）

| 套件 | 结果 |
|---|---|
| `hook-audit-reregress.ps1` | **59/59 rc=0** |
| `hook-bypass-regression.ps1` | **18/18 rc=0**（★ 第 26 条 `cmd /c del /f C:\x\y` 曾在中间态 FAIL，由命令位包装前缀修回） |
| `hook-fp-regression.ps1` | **8/8 rc=0**（含 `rmdir /tmp/empty_dir` expect allow，未被锚化破坏） |
| `hook-redact-test.ps1` | **60/60 rc=0** |
| `hook-rules-test.ps1` | **37/37 rc=0** |

### 6.3 其余红线

| 项 | 要求 | 实测 |
|---|---|---|
| `decision-parity.test.ts`（闸门本体，142 条语料） | 绿 | **exit=0 / pass 1 / fail 0**（263.0 s） |
| redact parity A/B/C | 绿 | **tests 3 / pass 3 / fail 0 / rc=0** |
| node 全量（repo 根 `node --test`） | 全绿 | 见 §5.1（`_g3fix5_node_full.log`） |
| 过拦面（合法命令） | 全 allow | 27 条探针 + K30–K32/K37/K38 **全 allow** |
| G3 五条原分歧 | 0 回退 | T2/T5/T9/T10 两端 deny、T3 两端 allow ✅ |
| R2（数组含对象→deny） | 不得回退 | R2a/R2b/R2c 两端 deny、R2d 两端 allow ✅ |

---

## 7. 副本表（D9）

| 组 | 副本 | sha256(16) | 字节 | BOM | 行尾 |
|---|---|---|---|---|---|
| sh ×3 | audit / skills / xhs-publish | **`692d0451a84c451e` ×3（distinct=1）** | 44326 ×3 | **False ×3** | LF（CRLF=0） |
| ps1 ×6 | audit / assets/hooks / skills / `~/.claude/hooks` / `~/.codex/hooks` / `~/.gemini/config/hooks` | **`5a18ef0f04ddd30d` ×6（distinct=1）** | 39349 ×6 | **True ×6（逐份复核）** | LF（CRLF=0） |

- 同步由 `_g3fix5_sync.ps1` 完成，日志 `_g3fix5_sync.txt`，末行 `SYNC-CHECK=PASS`。
- **D9 触发 1 次**：`edit` 工具写入 ps1 后 BOM 丢失（首次改动后实测 `BOM=False`），已就地补 `EF BB BF` 并逐份复核；此后所有 ps1 写入均用 `UTF8Encoding($true)`。
- 副本基线（改动前）：sh `a4b95f9cd683f3bc` ×3；ps1 `fb85cc0e4476ae58` ×6 —— 与 FIX4 Evaluator 的独立复算值**逐字一致**。

---

## 8. 未解决问题 / 主动收窄（诚实口径）

1. **2 条既存两端分歧未消（pre-G3 起，非本轮引入，未入闸门）**——
   - `rmdir /tmp/empty_dir`：sh **deny** / ps1 **allow**（四列实测 shPre=deny、shG3=deny、shFix4=deny）根因是 **POSIX `rmdir` 是永久删除、Windows `rmdir` 非递归是安全的**；两端各有测试套件把它钉死（sh「删除一律进回收站」铁律 / ps1 `hook-fp-regression` 第 3 条 expect allow）。**收紧任一端都会打破对端套件**，故按 D12 保留分歧并如实登记。
   - `echo "Format-Volume guide"`：sh **deny** / ps1 **allow**。根因是 sh 的 rule 17（`format-volume` 等）读**未剥离 echo 的原文**，而 ps1 rule 9 读 `$cmdTest`。同理 pre-G3 即存在。
2. **`x <危险基座>` / 引号内文本**：ps1 由 deny → allow（本轮**唯一**的 ps1 放松面）。这些形态**不可执行**（`x` 不是命令）；受影响的 3 个族（diskpart/rmdir/format/del/erase/ri/rd）在 FIX4 时是**无锚误伤**，本轮改为与 sh 同形锚。**但它同时放松了未纳入统一前缀的包装形态**（`bash -c "rmdir /s /q x"` 除外——那条由两端各自的 `bash -c` 规则兜住）。这是本卡在 D12 意义上**最需要 Evaluator 复核**的一处取舍。
3. **统一前缀的包装面只覆盖 `cmd /c` / `command` / `env`**；`doas`、`busybox find`、`nohup`、`xargs -I{} sh -c`、`~`/`$PATH` 变量前缀、`$(…)` 内嵌（部分由 10/31 段规则兜住）**未覆盖**，登记为加固候选。
4. **ps1 仍缺 `fdisk` / `parted` / `wipefs` 规则**（sh 8 区有）→ `sudo fdisk` 类形态**分歧保留**（sh deny / ps1 allow）。
5. **`icacls` 规则两端不同形**（sh 大 OR 无锚 / ps1 段首锚）——本卡未动，分歧保留。
6. **`rm -rf` 任意位置**（sh L481 / ps1 L340）保持无锚：`git commit -m "drop RM -rf usages"` 类合法文本两端一起 deny（同形残留，与闸门 G11/G12 一致，加固候选）。
7. **时间盒**：本轮实际耗时明显超 30 分钟量级（探针 160 条串行 + 6 次闸门全量 + 12 套 sh + 5 套 ps1 + node 全量）。
8. **不声称「忠实复刻」或任何未逐条验证的话**：§2/§3 的每一格都来自 `_g3fix5_probe_*.json` 的真实 spawn；§6 的每一格都来自 `_g3fix5_suites.txt` / `_g3fix5_suite_*.log` / `_g3fix5_node_full.log`。

---

## 9. 证据清单（`tasks/orchestrator/`）

| 文件 | 内容 |
|---|---|
| `_g3fix5_cases.mjs` | 自造语料 160 条（M 前缀矩阵 40 · Q 空引号 35 · G 反向守卫 16 · D 既存分歧 12 · E 过拦面 27 · T 红线 12 · W 包装面 18） |
| `_g3fix5_probe.mjs` / `_g3fix5_probe_before.json` / `_g3fix5_probe_after.json` | 四/五列**串行**真实 spawn harness + 全量结果（0 条不可判读） |
| `_g3fix5_k_cases.mjs` / `_g3fix5_k.json` | 闸门 K 段 20 条的先行核验（0 mismatch） |
| `_g3fix5_tables.md` / `_g3fix5_diff.mjs` / `_g3fix5_changes.mjs` | 四列表格 / 汇总 / 逐行变化清单 |
| `_g3fix5_lines.txt` / `_g3fix5_lines.mjs` | sh / ps1 相对 FIX4 基线的**带行号**改动清单 |
| `_g3fix5_sync.ps1` / `_g3fix5_sync.txt` | 9 份副本同步 + sha/BOM/CRLF 复核（SYNC-CHECK=PASS） |
| `_g3fix5_suites.ps1` / `_g3fix5_suites.txt` / `_g3fix5_suite_*.log` | sh 四套 × 三棵树 + ps1 五套 + redact parity |
| `_g3fix5_mutants.ps1` / `_g3fix5_mutants.txt` / `_g3fix5_mutants/` | 6 个隔离变异体（4 个 A/B 回退 + 2 个红线） |
| `_g3fix5_mutation.ps1` / `_g3fix5_mutation.txt` / `_g3fix5_gate_*.log` / `_g3fix5_node_full.log` | 闸门变异证据 + node 全量 |
| `_g3fix5_addwrap.ps1` | 统一前缀的机械校正脚本（记录包装组是怎么进 18 处的） |
