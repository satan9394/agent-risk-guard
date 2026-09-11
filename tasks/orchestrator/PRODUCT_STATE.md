# PRODUCT_STATE — agent-risk-guard

- 更新：2026-09-11 · Orchestrator Round 21（切片 #4 = G15 已闭环）
- 状态机：G4 ✅ → G1+G7 ✅ → G2 ✅ → **G15 ✅（ACCEPT）** → 下一轮：G15b（脱敏残留）或 G5（sh/agy fail-open）

## 当前成熟度
v0.3.0 Developer Preview。产品骨架完整（5 agent 接线 + 三平台 CI + 17 GAN findings 修复 + 单一规则源纪律），
但四份独立审计一致指出：**「保护是否真的生效」不可信**——这是从 Developer Preview 迈向可用产品的最大鸿沟。

## 本轮（Round 1-7）已完成
1. **PROJECT_BRIEF**（第一阶段）— 产品/用户/任务/成熟度/约束
2. **四份独立审计**（第二阶段，隔离上下文，互不污染）：
   - A 产品 UX：9 条（P0×1，实测本机 claude-code 防护裸奔而 doctor exit 0）
   - B 竞品研究：类别判断 + 7 家竞品 + 能力五层矩阵 + 10 项缺失价值论证 + 5 项不适合
   - C 架构/DX：10 条（P0×2：规则 5 副本 M7 只锁 2 处、sh fail-open）
   - D 可靠性/安全：10 条（P0×3：sh/agy fail-open、ps1 16d 死代码实证、POSIX 回收站链断裂）
3. **PRODUCT_GAP_MAP**（第三阶段）— 去重合并为 G1-G23，含冲突检测/依赖分析/路线图
4. **Vertical Slice 选择**（第五阶段）：G4（ps1 规则 16d 死代码）
5. **IMPLEMENTATION_BRIEF_G4** 落盘；Implementer 已派发（后台 4efc2bd6）

## 已解决问题（本轮）
**G15 — ps1 hook 密钥明文泄漏（P0 安全）已闭环并经独立验收 ACCEPT**（提交 `a9177c3`）：
- 修复：新增 `Redact-Secrets`（10 条模式对齐 `packages/core/src/redact.ts`）；脱敏收口在 `Write-HookLog` 内部 → allow（L492）与 deny（L105）**两条出口同时覆盖**；deny 的 `systemMessage` 改用脱敏后命令；**判定逻辑零改动**
- 日志卫生：1 MiB 上限（`RG_HOOK_LOG_MAX_BYTES` 可覆盖）+ 轮转 + 写盘失败静默降级
- 测试：新增 `hook-redact-test.ps1` **60/60**（双引擎）；**对改前 hook 跑同一套件 → 30 条 FAIL**（证明测试真实）；四套既有套件不变（37/20/8/59）；sh 三套件 67/40/192 无回归
- 六副本 SHA 全同 `252D9CF7`、BOM 全 True；发布侧测试副本已同步并 60/60
- **编排器处置**：清理含明文密钥的生产日志（911KB/6723 行）+ 旧残留（`~/.codex/hooks/hook-calls.log`）→ **回收站**（按删除铁律，可恢复）

### ⚠️ 独立验收的重要纠错（Evaluator 用时间戳取证推翻实现者结论）
实现者称"生产日志已含 5 处明文密钥 → 证明泄漏已实际发生"。**Evaluator 查证为假**：那些明文行时间戳为 **09:32:36**，恰是实现者自己跑 A/B 对照（改前镜像树）时**写进真实 TEMP 的测试夹具**，非生产流量。同一日志中已出现 `[REDACTED]` 行，才是修复生效的真证据。
→ **新纪律**：A/B 对照脚本**必须隔离 TEMP**（否则会污染生产日志并制造假证据）

## 已解决问题（前几轮）
**G2 残余 — doctor 验证深度（P0）已闭环，验收 ACCEPT**（提交 `25e658d`）：
- **dsh**：子串匹配 → 「规则数 vs 仓库单源条数」比对；条数不足 → `WARN`（不 FAIL、exitCode 仍 0）
- **claude/codex**：新增「已装 hook 脚本 vs 仓库单源」SHA256 新鲜度；不一致 → `WARN`，且**不降级、实弹 self-test 未削弱**
- **单源缺失** → 降级"未校验"（不 FAIL、不抛错）
- **双实现收敛**：`runDoctors` 标 `@deprecated` + 局限说明 + 迁移指引
- 测试：337/337 → **360/360**
- **编排器独立复核**（10 项反例矩阵）：dsh 少/等/多 三态正确；claude hook 异/同正确；退出码契约 6/6 无回归；真实 home 无新增 WARN；**变异测试证明新测试真实有效**（破坏新鲜度 → 变红 → 逐字节还原）
- **裁决 B 反证**：即使同 profile 他插件规则使总量超过单源（60+20=80 > 69），仍正确报陈旧 → 实现者自述的"高估掩盖"风险**未实现**
- ⚠️ **方法学披露**：独立 Evaluator 本轮**连续 4 次启动失败**（基础设施），验收由**编排器代执行**并在报告显著披露。红线守住（Implementer 未自评），但"独立 Evaluator"理想未达成，**不计为已满足**

**G4 — ps1 规则 16d 死代码（P0）已闭环并经独立验收 ACCEPT**：
- 修复：`[[:space:]]` → `\s`（.NET 正则有效语法），canonical + universal 双文件
- 传播：六处 canonical 副本 SHA256 全同（`D6D726D2`）、BOM 全部保留、24004 字节逐字节一致
- 回归：4 套 ps1（37/20/8/59，pwsh7 + PS5.1 双引擎）+ 3 套 sh（67/40/192）全绿
- **因果级证据**：回滚实验（POSIX 形态 → 恰 2 条 16d 用例转红 57/59 exit=1；改回 `\s` → 59/59 exit=0；字节级还原无损）
- 收尾：发布侧（skills）测试副本已同步 G4 用例（53→59 例），套件 59/59 通过

**G1 + G7 — CLI 失败传播与错误语义（P0+P1）已闭环并经独立验收 ACCEPT**（提交 `552fca3`）：
- 退出码契约：0=成功（**hook 运行时恒 0**，deny 是正常决策）/ 1=操作失败（doctor 有 FAIL、install 中止或回滚、uninstall 被拒、bootstrap 失败）/ 2=用法错误（未知子命令、未知 agent）
- 实证（before → after）：doctor 有 FAIL `0 → 1` 且 FAIL 行附修复命令；未知子命令 `0 + deny JSON → 2 + Unknown command + help 提示`
- **hook 契约未被破坏**：无害/危险/空 stdin/坏 JSON 四类输入前后均 exit 0（Evaluator 独立复核）
- 测试：319/319 → 337/337（+18，17 个真实 `spawnSync(...).status` 断言）；Evaluator 变异测试验证有效性（破坏 2 处断言 → 变红，逐字节还原）
- **顺带修复真实 fail-open**（新 G25，见下）；旧断言 3 处系**收紧**非削弱（Evaluator 逐条核对）

## 重大修正：审计结论 G2 大部分已被实现覆盖（编排器 Round 18 实证）
审计报告（C-F3 / D-F6 / A-F1 部分）读的是 **`packages/installer/src/doctor.ts` 的旧 `runDoctors()`**（现仅剩一个测试引用），而 CLI 实际走 **`packages/installer/src/runtime-probe.ts` 的 `probeAgentRuntime()`**，后者**已实现实弹验证**：
- claude/codex：`verificationMode='dynamic'` —— spawn 真实 hook 喂 无害 payload（必须 allow）+ 危险 payload（必须 deny），**且用子进程 stdin**（正是 G4 评估器强调的正确方法学）
- opencode：`static` —— 插件引用 + artifact 存在 + **hash 与仓库单源比对**（integrity）
- 完整状态机：ACTIVE / INSTALLED / BROKEN / DETECTED / NOT_DETECTED（deep vs shallow）
→ **G2 的真实残余**收窄为：① dsh 仍走旧 `checkDshPatch` 子串匹配（无实弹、无新鲜度）；② claude/codex 缺「已装 hook 脚本 vs 仓库单源」的 hash 新鲜度校验；③ 双 doctor 实现并存本身是隐患（旧 `runDoctors` 应废弃或统一）
→ 教训沉淀：**审计必须核对调用链实际路径**，否则会评估已废弃实现（本轮差点据此写出错误任务卡）

## 验收纠偏（独立 Evaluator 带回，任务卡描述已修正）
1. **"4 个向量全依赖 16d"不准确**：实际只有 2 条承重（`$x=rm`、`$x = rm`）；`$x="rm -rf…"` 由 rule 15 兜底、`$x=Remove-Item` 由 rule 13 兜底。16d 真正独挡：`X=rm`/`CMD=rm`/`$x=rm --recursive --force`/`r\m`/`/rm <无-rf>`
2. **套件数字口径**：任务卡写 37+8+18+53，实测 37/20/8/59（bypass 在 pwsh7 为 20、PS5.1 因测试文件 BOM 债为 18）——全 exit=0 无失败
3. **`--help` 冲突裁决为「可接受保守取舍」**（非缺陷）：sh 孪生规则 10b 对 `$x=rm --help` **同样 deny**，加豁免将违反验收标准 4（跨端一致）；且删除类主力规则 13/14/15/16b/30 实测**均不豁免 help** —— 16d 不豁免符合惯例

## 新发现问题（本轮审计新增，此前文档未记录）
1. **D-F2 ps1 16d 死代码**（`[[:space:]]` 在 .NET 正则无效）— 真实可利用绕过，此前 GAN 审计宣称已修但实为死代码 ✅**已修复验收**
   - **实现阶段扩展确认（Round 8）**：同款死代码存在于**第二处** —— `dangerous-commands-universal.ps1` L216（分发面文件，覆盖 Cursor/Goose/Grok/Hermes/Copilot 五家）；Implementer 已一并修复（同根因同修法）✅
   - **既有技术债（Round 8 登记）**：`hook-bypass-regression.ps1` 测试文件**无 BOM**，PowerShell 5.1 下被 ANSI 误读吞掉 2 条用例（20→18），导致 ps5.1 与 pwsh7 数字不一致；非本轮引入，需后续修（测试文件补 BOM）
2. **🆕 G24（P2）rule 16 的 help 豁免存在静默泄漏**（Evaluator 独立发现）：`rm --help; rm <file>` 在 **ps1 下 allow、sh 下 deny** —— rule 16 的豁免是「整条命令级抑制」，`rm --help` 一出现后续真删除即被跳过。改法建议参照 sh 的「只检查 rm 段实参」而非整条抑制。**超出 G4 范围，登记待修**
3. **🆕 方法学陷阱（知识沉淀，非缺陷）**：该 hook 用 `[Console]::In.ReadToEnd()` 读进程 stdin，**同进程管道 `$json | & $hook` 到不了**，全落 fail-closed 空输入分支 → 会把「探测全 deny」误读为规则生效（假阳性）。审计/探测必须用**子进程真实 stdin**（`$json | pwsh -File $hook`）。生产由 agent runtime 以子进程调起，不受影响
4. **🆕 发布侧测试覆盖缺口**（Evaluator 发现，✅本轮已修）：skills 侧 `hook-audit-reregress.ps1` 曾是 53 例旧版，若 16d 再退化只有 audit 侧报警；已同步为 59 例

## 仍存在缺口（按优先级，来自 PRODUCT_GAP_MAP）
- **P0 护栏可信度**：~~G1 doctor FAIL 却 exit 0~~✅｜~~G4 ps1 16d 死代码~~✅｜~~G15 ps1 密钥明文~~✅（ps1 侧）；**🆕 G15b 脱敏残留**（`aws configure set aws_secret_access_key`、带引号 `--password="…"`、`mysql -p<pass>`、`curl -u user:pass` 仍未覆盖，**core 与 sh 同缺口**；且 **sh 覆盖面现已弱于 ps1**——sh 缺 `sk-`/JWT/≥40 位）；G2 残余（cmdStatus 不展示新鲜度、legacy doctor 仍在导出面）｜G3 规则 5 副本漂移 M7 只锁 2 处｜G5 sh/agy fail-open
- **P1 首次使用**：G6 Node 版本无预检｜~~G7 未知命令静默 exit 0~~✅闭环｜G8 install 不支持 dsh/agy｜G9 SKILL.md 路径失效｜G10 误拦无恢复出口｜G12 硬编码路径｜G13 ps1 零 CI｜G16 POSIX 回收站链断｜G17 DSH 无 NFKC+误伤｜G18 opencode 拦截面窄
- **P2-3 成熟度**：G11 双接线体系｜G19 agy 判决面｜G20 名义分包｜G21 性能 4-5s｜G22 CLI 口径不一｜G23 dist 累积｜**G24 rule 16 help 豁免泄漏**（`rm --help; rm <file>` ps1 allow / sh deny）

## 🆕 本轮新发现
1. **G25（安全，本轮已修）hook 运行时入口 fail-open**：`echo '{"tool_input":{"command":"<危险命令>"}}' | node bin/riskguard.mjs` 在该 JSON 形状下**原为 allow**（可对旧版稳定复现），已加 3 行归一化修复（带守卫、方向 fail-closed、两个入口判定现已一致）。独立 Evaluator 判为**必要修复**并建议作为**独立安全条目记账**（勿混入退出码摘要）
2. **既有缺口（非本轮引入）**：合法但非对象的 JSON（`null` / `[]` / `123` / `"str"` / `true`）→ 未捕获 TypeError → **exit 1**；旧版同样如此（旧 `cli.ts:45` vs 新 `index.ts:177`，可观测契约一致）。建议并入 fail-closed 分支（未做）
3. **CLI 细节（非阻塞）**：`--help` / `-h` 现被当作「Unknown command」（建议映射到 help）；`acs` 只给一半时无 `acs evaluate` 提示；`install --agent dsh` 文案仍为 `Unknown agent`（退出码已正确为 2）

## 当前最高价值下一步
1. ~~G4 闭环~~ ✅ ｜ ~~G1+G7 闭环~~ ✅
2. **下一轮（NOW）：G2 残余** —— ① dsh 换掉子串 `checkDshPatch`，改为「patch 存在 + 规则数 + 实弹探测（NFKC/规则命中）」；② claude/codex 增加「已装 hook 脚本 vs 仓库单源」SHA256 新鲜度（opencode 已有）；③ 处置双 doctor 实现（废弃 `runDoctors` 或统一到 runtime-probe）
3. 再下一轮候选：G15（ps1 密钥明文泄漏，P0）+ G5（sh/agy fail-open 对齐）+ G3（规则单源收敛）+ G24（rule 16 泄漏）+ G25 的非对象 JSON 加固

## 暂缓项目（主动拒绝 / NOT_NOW）
- B 报告"不适合"5 项：OS 沙箱自研、ML 概率拦截、云端 Guardian、数学挑战确认、fail-open 姿态
- 低价值 Feature Creep：AST 角色解析（价值高但成本大，排 LATER）、环境感知升级、JIT 放行、注入检测、egress 策略、ACS/MCP 深化、团队策略分发（均为 LATER，需前置 P0 完成）

## 技术债
- 规则 5+ 副本人工同步（G3）；packages 名义分包 + REPO_ROOT 15 处重复（G20）；三套 ps1 引擎并存（C-F7）；
  dist/ 旧快照累积（G23）；sh 性能 3× python3 + 25× grep（G21）；测试硬编码本机路径（G12）

## 风险
1. **信任错位（最高）**：防护静默失效 + 巡检误报 OK = 用户以为被保护实际裸奔（本机已复现 3+ 次）
2. **分发面漂移**：universal/dist 旧副本仍在分发路径，skillhub 发布前必须清理（G3/C-F7/D-F7）
3. **误伤反噬**：DSH 词级误拦（连无害探测都拦）会推动用户删除规则，可用性反噬安全性（D-F4/A-F7）
4. **子代理执行不稳定**：后台 subagent 长时间无产出（本轮 A/B/C/D 后台版本卡死），已改前台/重试策略；Implementer 前台两次失败后改后台
