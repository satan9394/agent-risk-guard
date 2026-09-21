# DSH Recovery Checkpoint

> 生成时间：2026-09-12 12:30 · 触发：DSH Emergency Brake（紧急止损协议）
> 项目：`agent-risk-guard`（E:\DeepSeek_Harness\workspace\2026_08_21\agent-risk-guard）

## 1. 原始目标
以 **Product Evolution Orchestrator** 身份持续回答"当前距离成熟产品最大的缺口是什么"，通过独立 Subagent 做审计/实现/验收（Separation of Cognition），逐个关闭产品缺口。

## 2. 已完成
**7 个切片已闭环，每个都过了独立 Evaluator 的 ACCEPT**：
- **G4** ps1 规则 16d 死代码（`[[:space:]]` 在 .NET 正则无效）
- **G1+G7** CLI 退出码契约（doctor FAIL→1 / 未知命令→2 / hook 运行时恒 0）
- **G2** doctor 验证深度（规则数 + hook 脚本 SHA 新鲜度）
- **G15** ps1 密钥明文泄漏（日志 + deny 回显）
- **G25** hook 运行时入口 fail-open（随 G1+G7）
- **G15b** 三端脱敏对齐 — 走过 REJECT→FIX→FIX2→FIX3 四轮；**根因是 sh 生产出口从未接线**（四类密钥明文泄漏而闸门恒绿），最终三端一致 + 常设 parity 闸门 A/B/C
- **G5** sh hook fail-open → fail-closed（空 stdin / 畸形 JSON / 缺 command / 含 TAB / 首行危险+次行 `#` 由"静默放行"改为 deny + 合法 JSON）

**方法学纪律 D1–D13** 已固化于 `tasks/orchestrator/DECISIONS.md`（D6 攻击面 / D7 邻居面 / D8 对照面 / D9 引擎面-BOM / D10 环境面-假红 / D12 **向上对齐**不得向下 / D13 **验收期冻结产品树**）。

## 3. 当前代码/文件状态
- **HEAD = `7835a58`**；`git diff --stat HEAD` **为空** → 已跟踪文件全部已提交，**无未提交改动**
- 主源（非 git 工作树 `agent-risk-guard-audit\scripts\`）：sh `F80DABF048C3`、ps1 `4DFE66CB2E31`（= FIX7 版，已同步副本并提交）
- 已提交产物：`packages/core/test/{redact,redact-parity,decision-parity}.test.ts`、`skills/agent-risk-guard/scripts/*`（sh ×3 / ps1 ×6 副本 distinct=1，ps1 BOM=True）
- **未跟踪**：`tasks/orchestrator/FIX_BRIEF_G3-FIX8.md`（**已写好但未派活**）、`_ev2_*` 证据、`.eval-tmp/`、`tasks/eval-g2|g4/`

## 4. 已知未完成（最多 5 项）
1. **G3（进行中）**：FIX7 已提交并被编排者自验（A 面 8/8、真子 shell 5/5、B 面 6/6 全对）；**残留 C 面"包装词选项"仍为放松**——`sudo -u root diskpart`、`nice -n 5 diskpart` 等 8–10 条两端 allow，而 pre-G3 ps1 是 deny。**FIX8 任务卡已写好未派活**
2. **G3 边角残留**：过拦/奇异语法类（任务卡已定：只修安全方向，其余登记）
3. **G3b**：三端"从单一 spec 生成"大重构（设计上延后）
4. **P1 首次使用体验 9 项**：G6/G8/G9/G10/G12/G13/G16/G17/G18（其中 **G10 误拦无恢复出口**价值最高）
5. **P2/P3 成熟度 9 项**：G11/G19/G20/G21/G22/G23/**G24（rule 16 help 豁免泄漏，真安全洞）**/G26/G27

## 5. 当前风险（最多 5 项）
1. **G24 未修**：`rm --help; rm <file>` 在 ps1 下 allow、sh 下 deny → 真安全洞
2. **G3 FIX8 未做**：包装词选项放松尚未收回（orchestrator 已实测确认）
3. **GitHub 密钥告警未 dismiss**：告警锚定历史提交 `a9177c3c`（AWS 官方文档示例值，非真凭据）；**HEAD 已清理**（`git grep` 三值归零），但**历史告警需在 GitHub Security 页手动 dismiss**（或 force-push 重写历史）
4. **`node` 全量在 FIX6 轮未独立验证**（因验收期产品树被并行改动，D13 的直接代价）
5. **xhs-publish 树**的 ps1 是另一代 21KB 变体，不在 6 份同步清单内，其自有套件 50/53 → 树间不一致

## 6. 后台任务处理
- 已中断的 Subagent：**0 个**（`list_agents(descendants)` 显示全部 27 个均为 `ready`，无运行中）
- 已终止的 Job：**0 个**（`job_list` 返回无后台任务）
- 无法确认的后台任务：**无**

## 7. 推荐下一步（严格 3 项，按价值排序）
1. **修 G24**（`rm --help; rm <file>` 的 help 豁免整条命令级抑制 → 真安全洞，改动小）
2. **收尾 G3-FIX8**（`FIX_BRIEF_G3-FIX8.md` 已就绪，仅"包装词选项"一轴，配反向守卫；改完即关 G3）
3. **修 G10**（误拦无恢复出口 → 直接影响可用性，是"误拦即弃用"的根因）

## 8. 恢复方式
下一次新会话开始时：
1. 先阅读本文件
2. 再读 `tasks/orchestrator/PRODUCT_STATE.md`（顶部状态块）+ `DECISIONS.md`（D1–D13）
3. 只选择上面 §7 的**一个**任务继续
4. **不要**自动恢复此前的全面审计/自动迭代循环；G3 已定停止规则——**只有安全方向（放松/fail-open/丢拦截）才开新轮，过拦与边角一律登记延后**
