# IMPLEMENTATION_BRIEF — G5：sh 端畸形输入 fail-open → fail-closed（P0 安全）

- 生成：2026-09-11 · Orchestrator Round 84（切片 #6）
- 依赖：**须在 G15b 闭环后执行**（两者同改 `dangerous-commands.sh`，不可并行）
- 编排器实证（本轮亲跑，非转述）：脚本 `_g5_probe_ps1.ps1` / `_g5_probe_sh.sh`

## 目标
让 sh hook 在**输入不可解析**时与 ps1 端一致地 **fail-closed（deny）**，并始终以 **exit 0 + 决策 JSON** 返回（不得裸 exit 1）。

## 用户场景 / 当前问题（实测对照表）

| 输入 | ps1（现状=目标） | sh（现状） | 差异 |
|---|---|---|---|
| **空 stdin** | `deny`「hook 收到空输入（未提供命令）」 | **exit 0、无输出 → 放行** | ❌ **fail-open** |
| **畸形 JSON** | `deny`「JSON 解析失败，无法确认命令安全」 | **exit 0、无输出 → 放行** | ❌ **fail-open** |
| 合法 JSON 但缺 `command` | `deny`「shell 工具 (Bash) 缺少 command 字段」 | `exit 1`、无输出 | ⚠️ 违反 exit-0 契约 |
| 普通命令 `echo hello` | allow | allow | ✓ 一致 |
| 危险命令对照 | deny | deny | ✓ 一致 |

**根因（已定位到行）**：`dangerous-commands.sh`
- L90 `if [ -z "$inputJson" ]; then exit 0; fi` ← 空输入放行
- L141 `if [ -z "$cmd" ]; then exit 0; fi` ← 解析失败/无命令放行

**危害**：同一份规则，Windows 拦得住、Linux/Git Bash 遇畸形输入静默放行 → **用户以为被保护，实际裸奔**。这正是本项目最核心的信任错位面在产品上的具体形态。

## 理想行为
1. 空 stdin、畸形 JSON、缺 `command` 字段 → **输出与 ps1 同义的 deny JSON**（`hookSpecificOutput.permissionDecision="deny"` + 可读理由），**exit 0**。
2. 正常路径（合法 JSON + 命令）**判定零变化**。
3. 不得引入裸 `exit 1`／不得因 `set -euo pipefail` 而静默中止（历史上已有一次此类 fail-open，见 L125-128 注释）。

## 涉及模块
- `agent-risk-guard-audit/scripts/dangerous-commands.sh`（主源）+ **3 副本**（skills/agent-risk-guard/scripts、audit-xhs-publish/scripts）
- 测试：sh 三套 + 新增畸形输入回归用例
- **不在本卡范围**：agy（Antigravity）hooks —— 编排器本轮**未核实**其行为，按纪律不凭猜测扩大 scope（G2 教训：曾据未核实的描述写出错误任务卡）。agy 待单独核实后另开卡。

## 不能破坏什么
1. **正常路径判定零变化**：sh 三套（67/40/192）全绿；抽样 before/after 判定 CHANGED=0。
2. **exit 0 契约**：hook 运行时任何分支都不得返回非 0（deny 是正常决策，不是错误）。
3. **POSIX 兼容**：BSD/macOS bash 3.2 可用（禁 GNU 专属写法）。
4. 无 python3 时的 grep 回退路径仍需工作（且**不得因回退而放宽**）。
5. 无 BOM、LF 行尾、3 副本 SHA 一致。
6. G15b 刚建立的**跨端 parity 测试**必须仍然通过（若 parity 语料只覆盖合法输入，需扩展以覆盖畸形输入——否则「三端一致」名不副实）。

## 验收标准
1. **复现编排器的对照表**并逐行转为 deny（给出 sh 端自跑输出）。
2. **新增回归测试**：空 stdin / 畸形 JSON / 缺 command 字段 → 必须 deny 且 exit 0；**变异验证**（把修复回退 → 测试必须变红）。
3. **parity 测试扩展到畸形输入**：三端对同一批畸形输入的决策一致（这是本卡最重要的防复发闸门）。
4. sh 三套仍 67/40/192；node 全量不回归。
5. 3 副本 SHA 一致、无 BOM、LF。

## 错误场景
- stdin 只有空白字符（`\n`、空格）→ 应视为空输入 deny。
- 超长输入 / 含 NUL 字节 → 不崩溃、按 deny 处理或安全放行（须明确选一并说明）。
- python3 存在但解析抛异常 → deny（不是 exit 1）。
- Git Bash 的 GBK 代码页 → 不因转码失败而放行。
- **正常输入末尾带换行**（真实调用形态）→ 仍须 allow（避免修 fail-open 时误伤正常路径——这是本卡最大回归风险）。

## 测试要求
畸形输入矩阵 × 三端 + 变异验证 + 正常路径判定对照 + sh 三套回归 + parity 扩展。
