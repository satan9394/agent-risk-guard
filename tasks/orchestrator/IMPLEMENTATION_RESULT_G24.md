# IMPLEMENTATION_RESULT — G24

- 切片：**G24 — ps1 rule 16 的 help/version 豁免粒度**
- 来源卡：`DSH_RECOVERY_REPORT.md` §7 第 1 项（范围：「从*整条命令级*改为*仅豁免直接调用*」）
- 状态：**IMPLEMENTED · 自验通过 · 已由独立 Evaluator 判 ACCEPT**（见 `EVALUATION_RESULT_G24.md`）
- 实现轮：2026-09-12（编排者直接实现；未开实现者 Subagent）
- 基线 HEAD：`7835a58`

---

## 1. 缺陷

ps1 hook 的 rule 16（「rm 不带 -rf = 永久删除」）用一个**作用于整条命令**的否定条件做 help/version 豁免：

```powershell
if (($cmd -match ($CMD_PRE + 'rm(?:\s+|["'']?\s*-\s*)')) -and ($cmd -notmatch ($CMD_PRE + 'rm\s+(-h|--help|--version|-V)\b'))) {
```

`-notmatch` 的求值对象是**整个 `$cmd`**，因此命令里**任意位置**出现一次 `rm --help`，就把整条命令的
rule 16 一并关掉：

```
rm --help; rm /tmp/t      →  ps1: allow   sh: deny
```

第二段真实执行 `rm /tmp/t`（永久删除，且不进回收站），却被前一段无害的 `--help` 掩蔽。这是**跨端发散中
「ps1 比 sh 更宽」**的一个实例，方向属 D12 意义上的**放松**（安全方向），优先级高于过拦类问题。

## 2. 修法（最小改动）

把豁免从「整条命令级否定」收成 `rm` 之后的**调用点前瞻**——只豁免它自己那次直接调用：

```powershell
if ($cmd -match ($CMD_PRE + 'rm(?!\s+(?:-h|--help|--version|-V)\b)(?:\s+|["'']?\s*-\s*)')) {
```

前瞻复用**与豁免完全相同的标志集与词边界**（`-h|--help|--version|-V` + `\b`），故语义上是把
「`A ∧ ¬B`」换成「`A ∧ ¬B@调用点`」，不引入新的标志语义。`CMD_PRE` 未改动，`sudo` / 绝对路径 /
`cmd /c` / `command` / `env` 等前缀行为因此原样保留。

**结构性论证（Evaluator 补充）**：设 `A` = 旧第一子句、`B` = 旧豁免子句、`C` = 新子句。`C ⇒ A`，且 `B` 与
`C` 的前瞻用的是同一标志集与 `\b`，故 `A ∧ ¬B ∧ ¬C` 不可满足 —— 旧能匹配而新不能匹配的，只能是「其中
至少一次 rm 调用不满足 help 形式」的形态。45 条实测差异与之一致（全部 allow→deny）。

## 3. 落盘面（8 份 ps1，逐份独立哈希）

| 角色 | 路径 | sha256(前16) 前 → 后 | 字节 | 行尾 / BOM |
|---|---|---|---|---|
| canonical 主源 | `agent-risk-guard-audit/scripts/dangerous-commands.ps1` | `4dfe66cb2e310933` → `9889f367f2944756` | 41329 → 41948 | LF / BOM 保留 |
| canonical 副本 | `agent-risk-guard/assets/hooks/dangerous-commands.ps1` | 同上 | 41948 | LF / BOM |
| canonical 副本 | `agent-risk-guard/skills/agent-risk-guard/scripts/dangerous-commands.ps1` | 同上 | 41948 | LF / BOM |
| canonical 副本 | `~/.claude/hooks/dangerous-commands.ps1` | 同上 | 41948 | LF / BOM |
| canonical 副本 | `~/.codex/hooks/dangerous-commands.ps1` | 同上 | 41948 | LF / BOM |
| canonical 副本 | `~/.gemini/config/hooks/dangerous-commands.ps1` | 同上 | 41948 | LF / BOM |
| universal 主源 | `agent-risk-guard-audit/scripts/dangerous-commands-universal.ps1` | `13feb6cca3571090` → `ac566be720a9006c` | 17685 → 17887 | **CRLF 逐字保留** / BOM |
| universal 副本 | `agent-risk-guard/skills/agent-risk-guard/scripts/dangerous-commands-universal.ps1` | 同上 | 17887 | CRLF / BOM |

- `agent-risk-guard-audit/` 不是 git 仓库，故主源不进提交（与 G4/`210788d` 相同）。
- **修 universal 的理由**：它承载**同一条 rule 16 的同一缺陷**（跨 7 家通用 hook 形态），按 G4
  「canonical + universal 双文件」先例同批修；它不在 6 份同步清单内、也不被任何套件覆盖，
  因此另立一份哈希台账。
- **中途一次超范围副作用已纠正**：首版补丁在写回时把 universal 的 354 处 CRLF 归一成 LF（等于全文重写）。
  发现后从 in-tree 的**未改副本**重做，逐字保留行尾，并以「BOM 不变 / 无裸 LF / 行数差恰为 +2」做断言。
  最终 universal 为 356 CRLF、**0 处裸 LF**。

## 4. 常设闸门新增 M 段（防回退，本切片最重要的副产品）

`packages/core/test/decision-parity.test.ts` 新增 **M 段 15 条**（+34/−1），并同步更新文件头部的语料说明
与「已知不入语料的分歧」清单：

| 段 | 条数 | expect | 内容 |
|---|---|---|---|
| M1–M9 | 9 | deny | 「一处 help 掩盖另一处真删除」：`rm --help/-h/--version/-V; rm /tmp/t`、`&&` 分隔、中间夹句、`sudo` 前缀、绝对路径前缀、空引号归一形态 |
| M10–M15 | 6 | allow | **反向守卫**：纯 `rm --help/-h/--version/-V`、`sudo rm --help`、`/usr/bin/rm --help` —— 防「干脆取消豁免」式的过拦修法 |

没有这条闸门，本修复只能靠一次性探针保证；有了它，任何把 rule 16 回退成整条命令级否定的改动都会在
提交前变红（已用变异体实证，见 `EVALUATION_RESULT_G24.md` §6）。

## 5. 验证（编排者自跑）

| 项 | 结果 |
|---|---|
| 两端探针 `_g24_probe.mjs`（32 条，`_g24_before.txt` / `_g24_after.txt`） | 修复前 11/32 不符应然、两端发散 10 → 修复后 **2/32、发散 4**（余下 2 条均为 **sh 侧**既有/新登记缺口） |
| ps1 五套 × PowerShell 5.1 | 37/37、18/18、8/8、59/59、119/119 |
| ps1 五套 × pwsh 7.6.6 | 37/37、20/20、8/8、59/59、119/119 |
| sh 四套（WSL） | 67/67、40/40、192/192、34/34 |
| `decision-parity.test.ts`（含新 M 段） | exit 0，2/2 |
| `redact-parity.test.ts` | exit 0，3/3 |
| 副本一致性 | canonical ×6 同哈希、universal ×2 同哈希，BOM 全保留 |
| 变异验证 | 回退 rule 16 得到的变异体 sha **恰为 `4dfe66cb2e310933`＝修复前逐字节**；对闸门跑 → exit 1、**恰好 M1–M9 九条红**、M10–M15 绿；换回主源 → 全绿 |

证据文件（`tasks/orchestrator/`，未跟踪，与 `_ev2_*` / `_g15_*` 同类处理）：`_g24_probe.mjs`、
`_g24_patch.mjs`、`_g24_patch_universal.mjs`、`_g24_sync.mjs`、`_g24_mutant.mjs`、`_g24_suites.ps1`、
`_g24_verify.ps1` 及 `_g24_*.txt`、`_g24_mutants/`。

## 6. 未处置（本切片登记，未修）

1. **sh 侧同族缺口**（本轮禁止处理）：`rm /tmp/t; rm --help`（rmseg 贪婪取**最后一个** rm 实参）与
   多行 `rm --help`⏎`rm <file>`（sed 逐行 + `head -1` 只看第一行）→ ps1 deny / sh allow。方向为 ps1 收紧。
2. **既存、非本切片引入**：`rm --help extra`、`rm --help;`、`rm --help 2>&1` 等「help 后带残留 token」形态
   → ps1 allow / sh deny。根因是 sh 的 `case` 要求实参逐字相等，而残留串会被拼回 rmseg。
3. `dangerous-commands-universal.ps1` 至今无 `sudo` / 绝对路径前缀支持（canonical 与 sh 在 G3-FIX5/A 已补）：
   `sudo rm --help; sudo rm /tmp/t` 在该文件下 allow。既存，且无套件覆盖该文件（Evaluator 发现）。
4. `xhs-publish` 两处 drift 快照仍是旧 rule 16（`dangerous-commands.ps1` L200、`-universal.ps1` L175）。
5. 工作区内约 16 份**历史证据树**仍含旧写法（`tasks/orchestrator/_g15_tree_*`、`_g3fix*`、`_eval_g4`、
   `_eval_g15`、`.eval-tmp/`）—— 属证据文件，**不应修改**。

## 7. 刻意未做

未改 sh 侧；未处理 G3-FIX8 / G10 / xhs 对齐 / 其他 parity 分歧；未刷新历史证据文件；未新建 Gap/Task；
未改 `PRODUCT_STATE.md`（本切片无独立编排轮，故只在恢复报告内维护状态）。
