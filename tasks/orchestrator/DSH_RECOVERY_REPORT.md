# DSH Recovery Report

> 项目：`agent-risk-guard`（E:\DeepSeek_Harness\workspace\2026_08_21\agent-risk-guard）
> 生成：2026-09-12 · 依据：本项目 Git 事实 + `DSH_RECOVERY_CHECKPOINT.md`（仅本项目，未读取其他项目）

> **更新（2026-09-12 下午 · G24 已收尾）**：§7 第 1 项 **G24 已实现 → 独立 Evaluator 判 PASS（ACCEPT）→ 已提交**。
> 裁决与证据见 `tasks/orchestrator/EVALUATION_RESULT_G24.md`，实现记录见 `IMPLEMENTATION_RESULT_G24.md`。
> 本报告中凡「G24 未修 / 待独立验收」的表述，一律以 §2/§3/§4/§7 的更新行与文末「附：G24 执行记录」为准。
> **G24 已闭环，下一轮从 §7 第 2 项起（G3-FIX8）。**

## 1. 当前项目状态

这是一个「AI 编码代理的确定性护栏」项目（PreToolUse hook + 三端规则：core TS / ps1 / sh）。本会话以 Product Evolution Orchestrator 身份跑了 256 轮，**关闭了 7 个切片**（G4 / G1+G7 / G2 / G15 / G25 / G15b / G5），每个都过了独立 Evaluator 验收。当前 **HEAD = `98c6f4b`**（G24 提交；其父为 `7835a58`）。⚠️ 生成时 `git diff --stat` 与 `git diff --cached --stat` **均为空**；G24 落地期间一度非空（4 个已跟踪文件 +51/−4），**提交后已跟踪文件再次回到全净**（工作树只剩未跟踪的恢复/证据文件，见 §3）。最后一个切片 **G3（三端判定收敛）仍在收尾**：FIX7 已提交，编排者自验 A/B 两面通过，但**残留 C 面"包装词选项"仍是安全方向的放松**。项目整体处于「**保护已可信、剩余是体验与打磨**」的状态；G24 修复后，§4 的「真安全洞」一项已从 ps1 侧消除并闭环，**残留同类洞在 sh 侧**（见 §4.1）。

## 2. 本次长运行实际成果

| 改动 | 证据 | 状态 |
|---|---|---|
| G4：ps1 规则 16d 死代码（`[[:space:]]` 在 .NET 正则无效） | commit `67faab8` | KEEP |
| G1+G7：CLI 退出码契约（doctor FAIL→1 / 未知命令→2 / hook 恒 0） | commit `552fca3` | KEEP |
| G25：hook 运行时入口 fail-open（`tool_input.command` 形状） | 随 `552fca3` | KEEP |
| G2：doctor 新鲜度（规则数 + hook 脚本 SHA256） | commit `25e658d` | KEEP |
| G15：ps1 密钥明文泄漏（日志 + deny 回显） | commit `a9177c3` | KEEP |
| **G15b：三端脱敏对齐**（走 REJECT→FIX→FIX2→FIX3 四轮；根因是 **sh 生产出口从未接线**，四类密钥明文泄漏而闸门恒绿） | `210788d` 及提交链、`redact-parity.test.ts` A/B/C | KEEP |
| **G5：sh hook fail-open → fail-closed**（空 stdin/畸形 JSON/缺 command/含 TAB/首行危险+次行 `#` 由静默放行改为 deny + 合法 JSON） | `3fe7d85`、`sh-failclosed-test.sh` 34/34 | KEEP |
| G3：跨端判定收敛 + **常设 `decision-parity` 闸门（196 条 + 跨端身份断言）** | `9f1a818`/`e62d721`/`5e51b06` | **REVIEW**（C 面残留未收） |
| **G24：ps1 rule 16 的 help 豁免粒度**（整条命令级抑制 → 仅豁免它自己那次直接调用） | commit `98c6f4b`；主源 `4dfe66cb2e310933` → `9889f367f2944756`；闸门新增 M 段 15 条；独立 Evaluator **PASS** | **KEEP（ACCEPT）** |
| 方法学纪律 **D1–D13**（攻击面/邻居面/对照面/引擎面/环境面/时序面、向上对齐原则） | `tasks/orchestrator/DECISIONS.md` | KEEP |
| AWS 官方文档示例值清理（触发 GitHub 密钥告警）→ 51 文件替换为合成值 | commit `d169d26`、`git grep` 三值归零 | KEEP（历史待人工 dismiss） |

## 3. 未提交 / 半成品

1. `tasks/orchestrator/FIX_BRIEF_G3-FIX8.md` —— **已写好但未派活**（仅"包装词选项"一轴）
2. `DSH_RECOVERY_CHECKPOINT.md`（本项目根目录）—— 未提交，属恢复点文件
3. 大量未跟踪证据文件：`tasks/orchestrator/_ev2_*`、`_g15_*`、`_g3fix*`、`_probe_*` 等
4. 未跟踪临时目录：`.eval-tmp/`、`tasks/eval-g2/`、`tasks/eval-g4/`
5. 已跟踪文件**无未提交改动**（`git diff` 为空）—— ⚠️ 此条在 G24 落地期间一度不成立（4 文件 +51/−4），**现已在 `98c6f4b` 提交后恢复成立**
6. ~~**G24 修复（未提交、未验收）**~~ → **✅ 已由 `98c6f4b` 提交**：`agent-risk-guard-audit/scripts/dangerous-commands.ps1`（主源）与
   `dangerous-commands-universal.ps1`（同源同缺陷）的修复，外加 6 份 canonical 副本与 2 份 universal 副本的同步
   （**同一角色内无发散**，8 份 BOM 全保留）；`packages/core/test/decision-parity.test.ts` 新增 M 段 15 条
   （+34/−1）。提交面 6 文件 +341/−4（代码/测试 4 + 两张切片卡片）
7. G24 证据文件（未跟踪，`tasks/orchestrator/`）：`_g24_probe.mjs` / `_g24_patch.mjs` / `_g24_patch_universal.mjs` /
   `_g24_sync.mjs` / `_g24_mutant.mjs` / `_g24_suites.ps1` / `_g24_verify.ps1` / `_g24_commit_msg.txt` 及对应
   `_g24_*.txt`、`_g24_mutants/`（与本项目 `_ev2_*` / `_g15_*` 同类，按惯例不入库）

## 4. 当前风险

1. ~~**G24 未修（真安全洞）**：`rm --help; rm <file>` 在 ps1 下 allow、sh 下 deny —— help 豁免是整条命令级抑制~~
   → **✅ 已修并闭环（2026-09-12，commit `98c6f4b`，独立 Evaluator 判 PASS）**：`rm --help; rm <file>` 及 `-h` /
   `--version` / `-V` / `&&` / `sudo` / 绝对路径 / 空引号 / 中间夹句共 9 条危险载荷**两端 deny**；纯 help/version
   用例**两端 allow**（Evaluator 自建 20 条变体 + 15 条邻居，零过拦）。**决定性证据**：对 312 条载荷做
   旧规则 vs 新规则决策差 → **45 条差异全部是 allow→deny，放松 0 条**；universal 同法 23/23 收紧、0 放松。
   **【新】** 同族缺陷仍在 **sh 侧**：`rm /tmp/t; rm --help`（sh 的 rmseg 抽取式用贪婪 `.*` 取**最后一个** rm 的
   实参）与 `rm --help`＋换行＋`rm <file>`（sh 的 sed **逐行**处理 + `head -1`，只看第一行）两条为
   ps1 deny / sh allow。方向是 ps1 **收紧**而非放松，故按惯例**保留分歧并登记**（已写入闸门头部），本轮未修
2. **G3 C 面放松未收**：`sudo -u root diskpart`、`nice -n 5 diskpart` 等 8–10 条**真实危险命令两端放行**（pre-G3 ps1 为 deny，属 D12 意义上的放松残留）
3. **GitHub 密钥告警未 dismiss**：锚定历史提交 `a9177c3c`（AWS 官方文档示例值，非真凭据）；HEAD 已清理，**需在 Security 页人工 dismiss**，或 force-push 重写历史
4. **FIX6 轮的 `node` 全量未独立验证**：因验收期产品树被并行改动（D13 的直接代价）
5. **树间不一致**：`agent-risk-guard-audit-xhs-publish` 的 ps1 是另一代 21KB 变体，不在 6 份同步清单内，其自有套件 50/53

## 5. 建议保留

1. 7 个已闭环切片的全部提交（均经独立验收）
2. `packages/core/test/decision-parity.test.ts`（跨端判定 + 身份断言闸门）与 `redact-parity.test.ts` A/B/C
3. `tasks/orchestrator/DECISIONS.md` 的 D1–D13
4. `tasks/orchestrator/PRODUCT_STATE.md` 顶部状态块（权威现状）
5. AWS 示例值清理提交 `d169d26`

## 6. 建议暂缓或丢弃

1. **G3 边角**（过拦/奇异语法类）→ 只修安全方向，其余登记延后
2. **G3b**（三端"从单一 spec 生成"大重构）→ 成本远大于收益
3. **G20 / G21 / G23**（名义分包 / 性能 / dist 快照）→ 纯架构打磨，LATER
4. **xhs-publish 树对齐** → 非活跃分发面，暂缓
5. 大量 `_ev2_*` / `_g15_*` 一次性证据文件 → 可归档或丢弃（非代码）

## 7. 下一步

1. ~~**修 G24**（范围：ps1 rule 16 的 help 豁免粒度 —— 从"整条命令级"改为"仅豁免直接调用"；可验证：`rm --help; rm <file>` 两端 deny，且 help 类用例仍 allow，跑 ps1 五套 + decision-parity）~~
   → **✅ 已闭环（2026-09-12）**：独立 Evaluator 判 **PASS**，已由 commit `98c6f4b` 提交。裁决见
   `tasks/orchestrator/EVALUATION_RESULT_G24.md`，实现记录见 `IMPLEMENTATION_RESULT_G24.md`
2. **收尾 G3-FIX8**（范围：仅"包装词自身选项"一轴，卡已就绪；可验证：10 条危险载荷两端 deny + 6 条反向守卫 allow + 变异红点恰好）
3. **修 G10 误拦无恢复出口**（范围：误拦时的用户逃生路径；可验证：构造误拦场景能给出恢复指引）
4. **【新】sh 侧 help 豁免同族缺陷**（范围：`rm /tmp/t; rm --help` 与多行 `rm --help`⏎`rm <file>` 两端收敛；
   可验证：这两条两端 deny 且 M10–M15 纯 help 用例不回归）。⚠️ 修 sh 前先确认顺序语义（"任意一次非 help 即拦"
   vs "最后一次调用说了算"），否则会把 ps1 已有的分歧原样复制到 sh

## 8. 恢复原则

下一次开发：
1. 新开干净会话
2. 先读本报告（再读 `PRODUCT_STATE.md` 顶部状态块 + `DECISIONS.md`）
3. 一次只选择一个任务（上面 §7 之一）
4. **不自动恢复旧 Goal**（原 Goal 已因 256 轮上限自行终止：`blocked / round-limit / disarmed`）
5. 不重新启动此前的开放式产品审计循环；**只有安全方向（放松 / fail-open / 丢拦截）才开新轮，过拦与边角一律登记延后**

---

## 附：G24 执行记录（2026-09-12）

> 任务来源：§7 第 1 项。**范围严格限定为「ps1 rule 16 的 help/version 豁免粒度」**；未开子 Agent，
> 未扩展 scope，未改动 sh 侧，未提交，未改 `PRODUCT_STATE.md` / `PRODUCT_GAP_MAP.md`。

### A. 缺陷与修法

ps1 rule 16 原写法（canonical L376）：

```powershell
if (($cmd -match ($CMD_PRE + 'rm(?:\s+|["'']?\s*-\s*)')) -and ($cmd -notmatch ($CMD_PRE + 'rm\s+(-h|--help|--version|-V)\b'))) {
```

第二个 `-notmatch` 作用于**整个 `$cmd`**：命令里**任意位置**出现一次 `rm --help`，就把整条命令的
rule 16 一并关掉 → `rm --help; rm /tmp/t` 在 ps1 下 **allow**（sh 端 deny）。修法是把豁免收成
**调用点前瞻**，只豁免它自己那次直接调用：

```powershell
if ($cmd -match ($CMD_PRE + 'rm(?!\s+(?:-h|--help|--version|-V)\b)(?:\s+|["'']?\s*-\s*)')) {
```

`git diff` 恰好每文件 1 个 hunk（canonical +7/−1，universal +3/−1），未触碰任何其他规则。

### B. 落盘面（canonical ×6 同哈希、universal ×2 同哈希，8 份 BOM 全保留）

| 角色 | 路径 | sha(前16) 前 → 后 | 字节 | 行尾/BOM |
|---|---|---|---|---|
| canonical 主源 | `agent-risk-guard-audit/scripts/dangerous-commands.ps1` | `4dfe66cb2e310933` → `9889f367f2944756` | 41329 → 41948 | LF / BOM 保留 |
| canonical 副本 ×5 | `agent-risk-guard/assets/hooks/`、`agent-risk-guard/skills/agent-risk-guard/scripts/`、`~/.claude/hooks/`、`~/.codex/hooks/`、`~/.gemini/config/hooks/` | 同上（全同） | 41948 | LF / BOM |
| universal 主源 | `agent-risk-guard-audit/scripts/dangerous-commands-universal.ps1` | `13feb6cca3571090` → `ac566be720a9006c` | 17685 → 17887 | **CRLF 逐字保留** |
| universal 副本 ×1 | `agent-risk-guard/skills/agent-risk-guard/scripts/dangerous-commands-universal.ps1` | 同上 | 17887 | CRLF / BOM |

> 修 universal 的理由：它是**同一条 rule 16** 的同一缺陷（跨 7 家通用 hook 形态），按 G4「canonical +
> universal 双文件」的先例同批修；它不在 6 份同步清单、也不被任何套件覆盖。
> 中途一次超范围副作用已纠正：首版补丁把 universal 的 354 处 CRLF 归一成 LF，已从 in-tree 未改副本
> 重做并逐字保留行尾（断言：BOM 不变、无裸 LF、行数差恰为 +2）。

### C. 常设闸门新增 M 段（防回退）

`packages/core/test/decision-parity.test.ts` 新增 **M 段 15 条**（+34/−1），并同步更新头部语料说明与
「已知不入语料的分歧」清单：

- **M1–M9（expect=deny）**：`rm --help; rm /tmp/t`、`-h`、`--version`、`-V`、`&&`、`echo hi; rm --help; rm /tmp/t`、
  `sudo rm --help; …`、`rm'' --help; …`、`/usr/bin/rm --help; …`
- **M10–M15（expect=allow）**：`rm --help`、`rm -h`、`rm --version`、`rm -V`、`sudo rm --help`、`/usr/bin/rm --help`
  —— **反向守卫**，防「干脆取消豁免」式的过拦修法

### D. 验证（全部通过）

| 项 | 结果 |
|---|---|
| 两端探针（`_g24_probe.mjs`，32 条） | 修复前 11/32 不符应然、两端发散 10 → 修复后 **2/32、发散 4**（余下 2 条全部是 **sh 侧**缺陷，见 §4.1） |
| ps1 五套 × PowerShell 5.1 | 37/37、18/18、8/8、59/59、119/119 |
| ps1 五套 × pwsh 7.6.6 | 37/37、20/20、8/8、59/59、119/119 |
| sh 四套（WSL Ubuntu） | 67/67、40/40、192/192、34/34 |
| `decision-parity`（含新 M 段） | exit 0，2/2 pass |
| `redact-parity` | exit 0，3/3 pass |
| 副本同步 | canonical 6 份同哈希 + universal 2 份同哈希（**同一角色内 0 发散**），8 份 BOM 全保留；universal 保持原 CRLF（356 处、0 裸 LF） |
| **变异验证（D6）** | 把 rule 16 回退成旧写法得到的变异体 sha **恰为 `4dfe66cb2e310933`＝修复前逐字节**；对其跑闸门 → exit 1、**恰好 M1–M9 九条转红**（actual 9 / expected 0），**M10–M15 保持绿**；换回主源 → 全绿 |

证据：`tasks/orchestrator/_g24_before.txt`、`_g24_after.txt`、`_g24_sync.txt`、`_g24_suites.txt`、`_g24_verify.txt`。

### E. 本轮发现但未处置（按纪律只登记、不修）

1. **sh 侧同族缺陷**：`rm /tmp/t; rm --help`（rmseg 贪婪取**最后一个** rm 实参）与多行 `rm --help`⏎`rm <file>`
   （sed 逐行 + `head -1` 只看第一行）→ ps1 deny / sh allow。方向为 ps1 **收紧**（非放松），已写入闸门头部登记，
   见 §7.4
2. **既存分歧（非本次引入）**：`rm --help extra` → ps1 allow / sh deny（ps1 前瞻认「标志 + 词边界」，sh 的 `case` 要求实参逐字相等）
3. **drift 快照仍是旧 rule 16**：`agent-risk-guard-audit-xhs-publish/scripts/dangerous-commands.ps1`（L200）与
   同目录 `dangerous-commands-universal.ps1`（L175）—— 属 §4.5 / §6.4 已列的 xhs 树，未动
4. **历史基线/变异快照仍是旧写法**：`tasks/orchestrator/_g3fix*`、`_eval_g15` 等约 20 份 —— 是证据文件，**不应修改**
5. **工具面（非产品缺陷）**：Windows PowerShell 5.1 读取 **UTF-8 无 BOM** 的 `.ps1` 会按 ANSI 解码，中文注释
   破坏引号字面量并触发 `TerminatorExpectedAtEndOfString` 解析失败（本轮编排者自用验证脚本踩到，换 pwsh 即正常）。
   与已知 P0-1「ps1 无 BOM」同类，只记录

### F. 刻意未做

未改 `PRODUCT_STATE.md` / `PRODUCT_GAP_MAP.md`；未动 sh 侧；未把 M 段之外的任何既有分歧钉成断言；
未新建 Gap / Task；未刷新任何历史证据文件。

### G. 独立验收（2026-09-12）

- 方式：**1 个独立 Evaluator Subagent**（隔离上下文、未参与实现、**未派生任何 Subagent**、**未修改任何产品文件**；
  变异体与探针脚本一律写在 `%TEMP%\g24_eval\`）
- 裁决：**PASS**（`tasks/orchestrator/EVALUATION_RESULT_G24.md`，179 行）
- 关键证据（Evaluator 自建，非实现者提供）：
  1. **不得放松的决定性检查**：312 条载荷（211 `DECISION_CORPUS` + 20 `IDENTITY_CORPUS` + 81 自建）
     做旧规则 vs 新规则决策差 → **45 条差异全部 allow→deny，DENY→ALLOW = 0**；universal 同法 81 条 → 23/23 收紧、0 放松
  2. **闸门非自证式**：对旧规则变异体 → exit 1、**恰好 M1–M9 红**、M10–M15 绿；另造「整体删除豁免」的过拦变异体
     → exit 1、**M10–M15 变红**（证明反向守卫有效）
  3. `expect` 由**未被修改的 sh 端**独立佐证：全 211 条 `sh == expect` **211/211**
  4. 套件计数、副本哈希（canonical `9889f367…` / universal `ac566be7…`）、行尾/BOM、报告附录数字**逐项复现**
- 唯一未能完全复现的声明：附录原写「8 份 ps1，distinct=1」——字面为 **2 个**不同哈希（canonical 6 + universal 2），
  经判定**非实质性**（表格本身已分别写对）；已按此更正 §B/§D 措辞
- 安全方向上**无反例**：未发现任何「因 G24 而 ps1 放行、sh 拒绝」的新载荷
- 提交：**`98c6f4b`**（`fix(hooks): G24 help-exemption granularity …`，6 文件 +341/−4）


