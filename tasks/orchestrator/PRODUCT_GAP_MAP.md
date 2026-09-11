# PRODUCT_GAP_MAP — agent-risk-guard（Orchestrator 第三阶段综合）

> **状态更新（2026-09-11 · Round 23）** — 本文件是 Round 1-6 的原始合成，**保留不改写**（历史可追溯）；
> 下列为已发生的状态变化，权威现状以 `PRODUCT_STATE.md` 为准：
>
> **已闭环（4 个切片，均经独立验收）**
> - ~~**G4**~~ ✅ ps1 规则 16d 死代码（`[[:space:]]` 在 .NET 正则无效）— 提交 `67faab8`
> - ~~**G1 + G7**~~ ✅ CLI 退出码契约（doctor FAIL→1 / 未知命令→2 / hook 运行时恒 0）— 提交 `552fca3`
> - ~~**G2**~~ ✅（大部分）doctor 验证深度：dsh 规则数新鲜度 + hook 脚本 hash 新鲜度 + `runDoctors` 标 deprecated — 提交 `25e658d`
>   - **重要修正**：G2 原始描述（"doctor 只查字符串在位、无实弹"）**大部分不成立** —— 审计读的是已废弃的 `doctor.ts`；CLI 实际走 `runtime-probe.ts`，**早已实现实弹自检**（子进程 stdin 喂无害/危险 payload）。真实残余已收窄并闭环
> - ~~**G15**~~ ✅ ps1 密钥明文泄漏（日志 + deny 回显）— 提交 `a9177c3`；生产含密钥日志已回收站清理
> - ~~**G25**~~ ✅ hook 运行时入口 fail-open（`tool_input.command` 形状）— 随 `552fca3` 修复
>
> **新增缺口（原表未含）**
> - **G15b（P0 安全，进行中）**：脱敏残留 —— `aws configure set aws_secret_access_key <值>`（空格分隔）、带引号含空格密码、`mysql -p<值>`、`curl -u user:pass` 仍泄漏；**三端已漂移**（core 9 / ps1 10 / sh 2），sh 覆盖面弱于 ps1。修复方案含**跨端 parity 测试**防漂移
> - **G24（P2）**：rule 16 的 help 豁免为**整条命令级抑制** → `rm --help; rm <file>` 在 ps1 下 allow、sh 下 deny（独立 Evaluator 发现）
> - **G26（P2）**：legacy doctor（`runDoctors` + 子串级 `checkClaudeHook/checkCodexHook/checkOpencodePlugin`）仍在导出面 —— **两份审计被其误导的根因**，建议删除或移出导出
> - **G27（P3）**：`cmdStatus` 不展示新鲜度（只跑 status 的用户看不到陈旧提示）
>
> **本轮沉淀的方法学（防再次误判）**
> 1. 审计/验证**必须核对调用链实际路径**，否则会评估已废弃实现（G2 的教训）
> 2. ps1 hook 用 `[Console]::In.ReadToEnd()` 读**进程 stdin** —— 同进程管道探测会得假阳性"全 deny"
> 3. **A/B 对照脚本必须隔离 TEMP** —— 否则污染生产日志并制造假泄漏证据（G15 的教训）
> 4. **独立 Evaluator 不可省略**：它两次推翻实现者结论（G15 的假泄漏证据；G4 的"4 向量全依赖 16d"）


- 生成：2026-09-11 · Round 1-6（四份独立审计已全部读完：A-UX / B-竞品 / C-架构 / D-可靠性）
- 方法：去重（A/C/D 多处同一根因三面）、冲突检测、依赖分析、成本/收益判断，非简单合并
- 优先级：P0=阻碍核心使用/严重安全/数据风险；P1=明显破坏核心体验；P2=显著提升成熟度；P3=高级；P4=可选

---

## 综合轴一：护栏可信度（A+C+D 交叉印证，最高优先级）

四份审计独立指向同一个根因：**「保护确实生效」无法被可信地验证，且防护可能静默失效**。这是安全护栏产品的致命伤——用户无法知道自己是否被保护。

| ID | 问题 | 证据 | 用户影响 | 根本原因 | 建议 | 优先级 |
|----|------|------|---------|---------|------|--------|
| G1 | doctor FAIL 但 exit 0、无修复指引 | A-F1 实测：本机 claude-code 无 PreToolUse（裸奔）doctor 仍 exit 0；index.ts:111 全命令 exit 0 | 新手无法确认保护是否生效；CI 监控被 exit 0 骗过 | CLI 全命令统一 exit 0，无失败传播 | doctor FAIL → exit 1 且 FAIL 行带修复命令 | **P0** |
| G2 | doctor 只查"字符串在位"不验"新鲜度+真实拦截"，stale 是死代码 | C-F3（doctor.ts stale 无产出）；D-F6（settings.json ≥3 次外部覆盖复发而巡检报 OK） | 陈旧/残缺接线报 OK = 虚假安全感 | doctor 用子串启发式，无效果验证 | doctor/wiring-check 增加**实弹探测**（喂 known-deny JSON 断言 deny），已装 vs 单源 SHA256 | **P0** |
| G3 | 规则集 5+ 种独立实现，M7 只锁 2 处；universal/dist 旧副本漂移且仍在分发面 | C-F1（patch/deploy/ps1/sh/opencode 5 套，M7 只对齐 YAML↔TS）；C-F7（universal 354 行与 canonical 不同、不进检测）；D-F7（SHA256 实证漂移 + dist 3 份旧归档） | 规则加一条漏同步 → 某平台防护缺一条，CI 不报 | 多副本人工同步，无生成器/全量断言 | 规则收敛单一机器可读源 + 生成器；M7 扩到 ps1/sh/opencode/universal/dist 全副本 | **P0** |
| G4 | ps1 规则 16d 死代码：`[[:space:]]` 在 .NET 正则无效 → Windows 端变量赋值/间接 rm 完全漏拦（已实证） | D-F2：`'a b' -match '[[:space:]]'`=False；`$x=rm;$x -rf` ps1 放行、sh 拦截，四套 ps1 测试无 `$x=` 用例全绿掩盖 | Windows 主力平台存在可直接利用的间接删除绕过 | .NET 正则不支持 POSIX 类；测试盲区 | ps1 `[[:space:]]`→`\s` 全量替换 + 补 ps1 回归用例 + 跨端同用例断言 | **P0** |
| G5 | sh/agy 坏 JSON/空输入/缺 python3 fail-open（静默放行），与 ps1 fail-closed 不一致 | D-F1（sh exit 0 空输入/缺 command；agy 空输出/无字段 allow）；C-F2（grep 回退引号截断 bug，无 python3 CI 场景缺失） | 同一护栏 Windows 拦、POSIX 放；静默消失无告警 | 三端 fail 语义未对齐 | sh/agy 对齐 fail-closed（解析失败 deny + degraded 标记）；补无 python3 CI 场景 | **P0** |

## 综合轴二：首次使用体验（A 主证，B 佐证）

| ID | 问题 | 证据 | 建议 | 优先级 |
|----|------|------|------|--------|
| G6 | 无 Node ≥22.18 预检，低版本 Node 首命令原生报错 | A-F2（bin 直接 import .ts，engines 只在子包） | bin 顶部版本预检 + 人话提示 | P1 |
| G7 | 未知子命令静默落入 hook 运行时输出 deny JSON；全命令 exit 0 | A-F3（`riskguard frobnicate` 输出 deny JSON exit 0） | 未知命令 exit 2 + help 指引 | P1 |
| G8 | install 不支持 dsh/agy 且报"Unknown agent"误导；--all 静默跳过 | A-F4（installers 仅 3 家；README 宣称 DSH 一等） | 明确语义报错 + README 引导 wiring-check 路径 | P1 |
| G9 | SKILL.md 资产路径 scripts/… 全部失效（实际在 assets/…） | A-F5（glob 实测 scripts/ 无资产） | SKILL.md 路径修正 + 存在性自检 | P1 |
| G10 | 误拦恢复无产品化出口（无 allowlist/例外；JIT 放行未实现） | A-F7（无 allowlist 配置；B 竞品 shellfirm 替代建议是信任关键） | 用户级 allowlist JSON + 拒绝时给替代建议（B-缺失5 低成本高分） | P1 |
| G11 | 双接线体系（node-hook vs ps1-hook）并存，doctor/uninstall 无法区分/清净 | A-F6 | 收敛单一接线入口 + doctor 标注规则源 + uninstall 追踪 ps1 | P2 |
| G12 | wiring-check.ps1 硬编码本机仓库路径，外部克隆即失败 | A-F8（$repo 硬编码）；C-F5（三处脚本硬编码路径） | `$PSScriptRoot/..` 定位 + -Repo 参数 | P1 |
| G13 | ps1 防线零 CI 覆盖（主力平台）；CI 只有 macOS+ubuntu sh | C-F4（ci.yml 无 windows job，4 套 ps1 回归只本地） | ci.yml 加 windows-latest job 跑 ps1 套件；Git Bash 纳入 | P1 |
| G14 | README detect --json 键数漂移、CJK 对齐、交互全装无确认 | A-F9 | 文档修正 + 交互确认行 | P3 |

## 综合轴三：数据与密钥（D 主证）

| ID | 问题 | 证据 | 建议 | 优先级 |
|----|------|------|------|--------|
| G15 | ps1 hook 明文记录/回显完整命令（allow 写盘、deny 回显）无脱敏 | D-F5（%TEMP% 日志明文；systemMessage 原样回显） | 复用 sh/opencode redact 正则 + 日志轮转/ACL + 测试断言 | **P0** |
| G16 | POSIX 回收站链断裂：无 trash 落地、无验证、文案指向不存在命令 | D-F3（t1 §4d WSL 无 trash；opencode trash 依赖 pwsh） | 部署文档/doctor POSIX 前置检查 + deny 文案探测 trash + macOS 真机 D3 | P1 |
| G17 | DSH 门禁无 NFKC + 词级误伤（本机实证连拦 5 次无害探测） | D-F4（全角 ｒｍ 通过、ASCII rm 被拦；无 cmdTest 剥离） | DSH 规则引擎 NFKC + echo 剥离 + 规则边界修正 | P1 |
| G18 | opencode 插件只拦 bash 工具 + 崩溃按关键词兜底 + opencode.json 可被 edit 摘除 | D-F8 | 扩 task 工具名 + 崩溃 fail-closed + 注册文件自保护 | P1 |
| G19 | agy 空输出/无 decision 字段 allow；路径硬编码 ~/.codex | D-F10 | 四态回归（空输出/无字段/坏 JSON/空输入全部 deny）+ 路径单源 | P2 |

## 综合轴四：维护与架构（C 主证）

| ID | 问题 | 证据 | 建议 | 优先级 |
|----|------|------|------|--------|
| G20 | "packages" 名义分包：跨包裸 .ts import、无依赖声明、版本号撒谎（root 0.3.0 vs 包 0.1.0） | C-F6（15 处 REPO_ROOT 推算重复） | 至少版本收敛 + REPO_ROOT 单一函数；远期真 workspace | P1 |
| G21 | hook 性能：Git Bash 4-5s/次（3× python3 + 25× grep spawn） | C-F8（t2 §5.4） | 单次 python3 全流程（顺带解决 G5 grep 回退） | P2 |
| G22 | CLI 口径不一致：detect 12 家/install 3 家/doctor 4 项，agy 无注入检查 | C-F9 | discovery 注册表驱动 install/doctor 同源 + agy 检查 | P2 |
| G23 | dist/ 4 版快照 1.6MB 常驻无清理 | C-F10 | clean script + 只留最新 N 版 | P3 |

---

## 冲突检测结论

1. **A-F1 / C-F3 / D-F6 是同一根因**（doctor 验证闭环不可信）→ 合并为 G1+G2，不重复计。
2. **C-F2 / D-F1 是同一根因**（sh fail-open）→ 合并为 G5。
3. **C-F1 / C-F7 / D-F7 同根**（多副本漂移）→ 合并为 G3。
4. **A-F8 / C-F5 同根**（硬编码路径）→ 合并为 G12。
5. 无实质性冲突（A 的 UX 建议与 C/D 的工程建议方向一致：都要求"可验证、可恢复、单一真相"）。
6. **B 的战略结论强化 G3/G16**：跨 agent 同源（M7）+ Windows 原生 + 回收站语义 = 官方平台做不了的护城河 → 多副本漂移（G3）与回收站断裂（G16）是战略级风险，不只是工程债。

---

## 依赖分析

- **G4 与 G3 联动**：ps1 死代码修复后的跨端断言依赖统一规则源（G3），但 G4 的 `\s` 替换本身独立可做 → G4 先行，G3 跟进。
- **G5 与 G21 联动**：改单次 python3 同时解决性能与 grep 回退 → G21 实现即 G5 收尾。
- **G2 与 G1 联动**：doctor 实弹探测（G2）需要失败传播（G1）配合才闭环。
- **G12 与 G8 联动**：wiring-check 是 dsh/agy 修复路径，可移植性（G12）是 G8 修复的前提。

---

## 第四阶段：路线图

- **NOW**（本轮 vertical slice）：G4（ps1 死代码，P0 实证）+ G1/G2（doctor 验证闭环，P0）——三者是「护栏可信度」最硬的三块，相互独立可并行。
- **NEXT**（下一轮）：G5（sh/agy fail-closed 对齐）+ G15（密钥泄漏 P0）+ G3（规则单源收敛启动）。
- **LATER**：G6-G14（UX 治理）、G16-G19（数据/DSH/opencode/agy 可靠性）、G20-G23（架构维护）。
- **NOT_NOW**（主动拒绝）：B 报告"不适合"5 项（OS 沙箱自研、ML 概率拦截、云端 Guardian、数学挑战确认、fail-open）；B"缺失"中 AST 角色解析/JIT 放行/注入检测等高级能力排入 roadmap 但非 NOW。

## 第五阶段：本轮 Vertical Slice 选择

**选择：G4 —— ps1 规则 16d 死代码修复（变量赋值/间接删除绕过，Windows 主力平台 P0 实证漏洞）**

理由：
1. **P0 + 实证**：D-F2 已用真机 pwsh 证明 `[[:space:]]` 在 .NET 正则恒 False，`$x=rm; $x -rf` Windows 端完全漏拦——是四份审计中唯一"可直接利用的安全漏洞"，优先级高于其他一切。
2. **收益明确**：修复 = 一行替换 + 回归用例，成本半天内，直接闭合 Windows 主力平台一个绕过面。
3. **与护栏可信度主线一致**：修复后需跨端断言（sh/ps1 同用例同判定），为 G3 规则单源铺路。
4. **独立可验收**：不依赖 G1/G2/G3 的任何部分，可单独完成 Implement→Evaluate→Fix 循环。

下一轮最值得分析的问题（第八阶段自动选择）：**G1/G2（doctor 验证闭环）**——与 G4 同属 P0 且独立，可在 G4 验收后立即推进。