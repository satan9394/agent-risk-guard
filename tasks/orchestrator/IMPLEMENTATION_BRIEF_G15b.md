# IMPLEMENTATION_BRIEF — G15b：脱敏残留与三端对齐（P0 安全）

- 生成：2026-09-11 · Orchestrator Round 22（切片 #5）
- 来源：G15 独立验收（EVALUATION_RESULT_G15.md 残留 R1-R4 + 三端漂移）；PRODUCT_GAP_MAP G15b
- 编排器实证（本轮亲查代码）：
  - `packages/core/src/redact.ts`：**9 条** `SECRET_PATTERNS`（canonical，TS）
  - `dangerous-commands.ps1:57-68`：**10 条** `RedactPatterns`（ps1，已比 core 多一条）
  - `dangerous-commands.sh:90-96`：**仅 2 条** sed 规则（键值类 + token 形状类）→ **三端已实质漂移**

## 目标
(a) 补齐仍泄漏的密钥形态（**含任务卡用户场景点名的 `aws configure set aws_secret_access_key …`**）；
(b) 把三端（core / ps1 / sh）脱敏模式收敛到**可验证的一致**，并加**跨端一致性测试**防止再度漂移。

## 用户场景 / 当前问题（Evaluator 已实测确认仍泄漏）
| 形态 | 示例 | 为何现行模式漏掉 |
|---|---|---|
| AWS CLI 空格形态 | `aws configure set aws_secret_access_key TESTFIXTUREsecretVALUE...` | 键值模式要求 `[:=]`，此处是**空格分隔** |
| 带引号含空格值 | `--password="correct horse battery staple"` | 值正则 `[^\s'",;}\]]+` 遇空格即停，反引号组不闭合 → 整条不匹配 |
| mysql 短参 | `mysql -pSup3rS3cret -e "…"` | `-p<pass>` 非键名形态 |
| curl 基本认证 | `curl -u alice:hunter2 https://…` | `-u user:pass` 非键名形态 |

另有：**sh 覆盖面弱于 ps1**（sh 缺 `sk-`/JWT/≥40 位长串），三端不一致本身就是风险（用户在不同平台得到不同保护强度）。

## 理想行为
1. **补齐模式**（三端同源）：
   - 键值对：在既有 `[:=]` 形态之外，支持**空格分隔**的 `aws_secret_access_key VALUE` / `aws_access_key_id VALUE` / `secret_access_key VALUE` 等
   - **带引号的值可含空格**：`password="a b c"`、`token='x y'` 应整体替换
   - CLI 短参/长参：`-p<value>`、`-u user:pass`、`--password[= ]value`、`--token[= ]value`、`--api-key[= ]value`、`--secret[= ]value`
2. **单一源**：以 `packages/core/src/redact.ts` 为 canonical；ps1 与 sh 的模式集与之对齐（允许平台语法差异，但**语义集合必须一致**）。
3. **防漂移机制**：新增**跨端一致性测试**——同一份语料（含全部密钥形态 + 无误伤对照）分别喂三端，断言**判定集合一致**（ps1 需真实 spawn；sh 走 WSL/bash；core 直接 import）。测试必须在**任一端漏掉某形态时变红**。
4. **不倒退**：现有 G15 已覆盖的 10 类不得回退；判定逻辑（allow/deny）**零改动**；JSON 合法性、日志上限、BOM 保持。

## 涉及模块
- `packages/core/src/redact.ts`（canonical 模式集；如新增模式先改此处）
- `agent-risk-guard-audit/scripts/dangerous-commands.sh`（`redact_cmd`，POSIX ERE —— **不含 lookaround/`\b` 的 GNU 依赖**，需用 `[[:space:]]` 等可移植写法）
- `agent-risk-guard-audit/scripts/dangerous-commands.ps1`（`RedactPatterns`，.NET 正则）
- 测试：`packages/core/test/*.test.ts`（新增 parity 测试）、`agent-risk-guard-audit/tests/hook-redact-test.ps1`（扩用例）、sh 套件
- 同步：ps1 **六副本**（audit/scripts、assets/hooks、skills/…/scripts、~/.claude/hooks、~/.codex/hooks、~/.gemini/config/hooks）；sh **三副本**（audit/scripts、skills/agent-risk-guard/scripts、audit-xhs-publish/scripts）
  - **勘误（Round 25，由 Implementer 实测纠正）**：本卡初稿写"sh 四副本"有误，实测全工作区只有 **3 份** sh（同为 `0A742936472A` / 15522 B）。以实测为准。

## 不能破坏什么
1. **判定逻辑零改动**（脱敏只在输出出口）——G15 已建立的 72 次 before/after 判定对照必须仍然 CHANGED=0。
2. 现有测试全绿：ps1 五套（37/20/8/59 + 60）、sh 三套（67/40/192）、core/installer/e2e（**360/360** 基线）。
3. **UTF-8 BOM 保持**（ps1 六副本）。
4. 日志上限/轮转/写盘降级行为不变。
5. 不得过度脱敏（`echo hello` / `git status` / `ls -la` / 普通路径逐字不变）。
6. sh 侧模式须为 **POSIX ERE 兼容**（BSD/macOS grep/sed 亦需工作——项目已有此纪律）。

## 验收标准
1. **四类残留全部覆盖**：`aws configure set aws_secret_access_key <val>`、`--password="含 空格"`、`mysql -p<val>`、`curl -u user:pass` —— 在 **ps1 与 sh 两端**日志/回显中均出现 `[REDACTED]` 且无明文（给出双端实证输出）。
2. **core 同步**：`redact.ts` 含上述能力，其单测覆盖。
3. **parity 测试存在且有效**：新增跨端一致性测试；**故意从任一端删一条模式 → 该测试变红**（变异验证，须记录）。
4. **无误伤**：正常命令三端输出逐字不变。
5. **判定不变**：抽样对照 before/after 判定 CHANGED=0。
6. 全量测试全绿（给前后数字）+ 六副本/四副本 SHA 一致 + BOM 保持。

## 错误场景
- 引号值以引号结尾但中间含空格/转义引号 → 整体替换且不破坏 JSON。
- 极长值、值含 `=`、值含中文 → 不误伤、不崩溃。
- sh 侧 sed 不支持某写法 → 用可移植替代（不得因为移植性而漏形态；若确有无法移植的形态，**必须在 parity 测试中显式豁免并注明理由**）。
- 单端语法差异导致 parity 失败 → 以 core 语义为准，调整平台实现。

## 测试要求
- parity 测试须：语料 ≥12 条（含全部密钥形态 + ≥5 条无误伤对照）、三端真实执行（ps1 spawn 子进程喂 stdin；sh 走 bash/WSL；core 直接 import）、断言**每端命中集合一致**。
- 变异验证：删除任一端的任一模式 → parity 测试必须变红（记录实证）。
- 回归：ps1 五套 + sh 三套 + `node --test` 全量（基线 360）。

## 交付物
`IMPLEMENTATION_RESULT_G15b.md`：改动摘要 + 三端模式对照表（新增/对齐后）+ 四类残留的双端实证（前后）+ parity 测试说明与变异验证 + 测试前后数字 + 未解决问题（尤其**无法跨端对齐的形态**须显式列出）。
