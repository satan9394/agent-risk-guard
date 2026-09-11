# PRODUCT_STATE — agent-risk-guard

- 更新：2026-09-11 · Orchestrator Round 17（G4 切片闭环）
- 状态机：AUDIT ✅ → SYNTHESIS ✅ → ROADMAP ✅ → SLICE ✅ → IMPLEMENT ✅ → EVALUATE ✅(ACCEPT) → FIX（无需，验收直接通过）

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
**G4 — ps1 规则 16d 死代码（P0）已闭环并经独立验收 ACCEPT**：
- 修复：`[[:space:]]` → `\s`（.NET 正则有效语法），canonical + universal 双文件
- 传播：六处 canonical 副本 SHA256 全同（`D6D726D2`）、BOM 全部保留、24004 字节逐字节一致
- 回归：4 套 ps1（37/20/8/59，pwsh7 + PS5.1 双引擎）+ 3 套 sh（67/40/192）全绿
- **因果级证据**：回滚实验（POSIX 形态 → 恰 2 条 16d 用例转红 57/59 exit=1；改回 `\s` → 59/59 exit=0；字节级还原无损）
- 收尾：发布侧（skills）测试副本已同步 G4 用例（53→59 例），套件 59/59 通过

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
- **P0 护栏可信度**：G1 doctor FAIL 却 exit 0｜G2 doctor 不验新鲜度/真实拦截｜G3 规则 5 副本漂移 M7 只锁 2 处｜~~G4 ps1 16d 死代码~~✅本轮已闭环｜G5 sh/agy fail-open｜G15 ps1 密钥明文泄漏
- **P1 首次使用**：G6 Node 版本无预检｜G7 未知命令静默 exit 0｜G8 install 不支持 dsh/agy｜G9 SKILL.md 路径失效｜G10 误拦无恢复出口｜G12 硬编码路径｜G13 ps1 零 CI｜G16 POSIX 回收站链断｜G17 DSH 无 NFKC+误伤｜G18 opencode 拦截面窄
- **P2-3 成熟度**：G11 双接线体系｜G19 agy 判决面｜G20 名义分包｜G21 性能 4-5s｜G22 CLI 口径不一｜G23 dist 累积｜**🆕 G24 rule 16 help 豁免泄漏**（`rm --help; rm <file>` ps1 allow / sh deny）

## 其他新发现（本轮审计，此前文档未记录）
- **A-F1 本机 claude-code 实际裸奔**（doctor 报 FAIL 但 exit 0）— 文档警告的场景正在本机发生 → 归入 G1/G2
- **D-F4 DSH 门禁无 NFKC**（全角 ｒｍ 通过、ASCII rm 误拦）— 四端归一化不一致 + 误伤 → G17
- **D-F5 ps1 明文记录密钥**（日志 + deny 回显均无脱敏，sh/opencode 有 redact）→ G15
- **C-F6 版本号撒谎**（root 0.3.0 vs 各包 0.1.0）→ G20

## 当前最高价值下一步
1. ~~完成 G4 实现与独立验收~~ ✅ 已完成（ACCEPT）
2. **下一轮（NOW）：G1+G2（doctor 验证闭环）**— 与 G4 同属 P0，是「护栏可信度」的第二块基石：doctor 必须能回答"保护真的生效吗"（实弹探测 + 失败传播 + 新鲜度校验）。**注**：G2 的"实弹探测"必须遵循本轮沉淀的方法学（子进程真实 stdin，勿用同进程管道）
3. 再下一轮：G15（密钥泄漏）+ G5（fail-open 对齐）+ G3（规则单源收敛）+ G24（rule 16 泄漏）

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
