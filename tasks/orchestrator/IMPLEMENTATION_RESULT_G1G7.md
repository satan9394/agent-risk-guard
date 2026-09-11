# IMPLEMENTATION_RESULT — G1（退出码可信）+ G7（错误语义）

- 实现者：独立 Implementer（DeepSeek Harness 子代理）
- 日期：2026-09-11
- 任务卡：`tasks/orchestrator/IMPLEMENTATION_BRIEF_G1G7.md`
- 仓库：`E:\DeepSeek_Harness\workspace\2026_08_21\agent-risk-guard`（git，main，基线 `67faab8`）
- 状态：**已实现 + 已自证（未提交，工作区改动留给 Evaluator 复核）**

---

## 1. 一句话结论

CLI 退出码现在可信：`doctor` 有 FAIL → **exit 1**（FAIL 行尾附可执行修复提示）；未知子命令 → **exit 2 + 用法提示**（不再输出 deny JSON）；install/uninstall 失败路径（预检中止、回滚、拒绝卸载）→ **exit 1**，未知 agent → **exit 2**；而 **hook 运行时（无子命令，stdin JSON → decision JSON）恒为 exit 0**，allow / deny / 空输入 / 坏 JSON 四种情形全部保持 0。既有测试套件 **337/337 全绿**（改前 319/319，+18 为本轮新增用例）。

---

## 2. 改动摘要

| 文件 | 改动 |
| --- | --- |
| `packages/cli/src/commands.ts` | 新增退出码契约块（`CommandOutcome` / `DoctorResult` / `DoctorCheckResult` + 契约注释）；`cmdDoctor` 改为返回 `{ text, exitCode, counts, checks }`（**判定逻辑逐条不变**，仅把 FAIL/WARN/PASS/SKIP 同时记入 `checks`）；新增 `--json` 机器可读报告；FAIL 行尾追加可执行修复提示；install / uninstall 抽出结构化核心 `runInstall` / `runUninstall` + `installExitCode` / `uninstallExitCode`（`cmdInstall` 字符串 API 保持不变供既有测试调用，新增 `cmdInstallResult`；`cmdUninstall` 改为返回 `CommandOutcome`）；`cmdBootstrap` 改为返回 `CommandOutcome`；`cmdHelp` 增加「Exit codes」与 hook 运行时说明 |
| `packages/cli/src/index.ts` | `parseArgs` 区分「无参数（hook 运行时）」与「未知子命令」；`runSubcommand()` 由 `boolean` 改为返回退出码（`number \| null`）；`main()` 传播退出码；子命令内异常改为一行 stderr 提示 + exit 1（不再抛 stack trace）；hook 运行时路径保持 exit 0（另见 §7.1 的输入形状归一化） |
| `tests/e2e/cli-exit-codes.e2e.test.ts` | **新增 18 个用例**，全部 `spawnSync` 真实进程并断言 `.status`（回滚 1 例走 CLI 入口同一函数，因 argv 无法注入故障） |
| `tests/release-hardening/lifecycle.e2e.test.ts` | 3 处断言从「旧行为 exit 0」更新为新契约（见 §5.3） |
| `README.md` / `README.en.md` | 新增「7. 退出码约定」小节（含 hook 运行时恒 0 的说明） |

设计取舍（可复核）：`cmdInstall` 保留返回字符串的旧签名，因为 `tests/transaction/transaction.test.ts`（9 处）与 `tests/e2e/install-ux.test.ts`（4 处）直接调用它并断言字符串——不改既有测试的语义即可拿到退出码，新增 `cmdInstallResult` 承载退出码。`cmdDoctor` 无任何直接调用方，故直接改为结构化返回（任务卡建议的 `{ text, exitCode }` 形状）。`cmdUninstall` 同样无直接调用方，直接改为结构化返回，避免留死代码。

---

## 3. 退出码契约（对外承诺，已写入 help 与 README）

| 码 | 含义 |
| --- | --- |
| `0` | 成功：子命令正常完成；doctor 有 WARN 无 FAIL；install 幂等（`already installed`）；卸载「本来就没装」；dry-run。**hook 运行时恒 0**（allow/deny 都是正常决策；空输入/坏 JSON 的 fail-closed deny 也不是错误）。 |
| `1` | 操作失败：doctor ≥1 FAIL；install 中止（配置损坏 / 插件同名异内容）/ 回滚 / self-test 未过 / 显式指定的 agent 未安装；uninstall 被拒或失败；bootstrap 失败；子命令内部异常。 |
| `2` | 用法错误：未知子命令（拼写错误、空参数字符串）；install/uninstall 指定未知或本 CLI 不支持的 agent。 |

---

## 4. 退出码对照表（改前 → 改后，均实测）

证据脚本：`node tasks/orchestrator/_g1g7_probe.mjs`（同一脚本改前/改后各跑一次）
补验脚本（skipped / bootstrap 分支）：`node tasks/orchestrator/_g1g7_extra.mjs`
回滚取证脚本：`node tasks/orchestrator/_g1g7_rollback.mjs`
原始输出：`tasks/orchestrator/_g1g7_probe_before.txt`、`tasks/orchestrator/_g1g7_probe_after.txt`

| 命令 / 场景 | 改前 | 改后 | 改后 stdout 关键内容 |
| --- | --- | --- | --- |
| `doctor`（真实 home：3 PASS / 0 WARN / 1 FAIL / 7 SKIP） | **0** | **1** | `FAIL  claude-code    RiskGuard hook 注入缺失  → 重跑: …install --agent claude-code` |
| `doctor`（fake home：Claude 检出但未接线） | 0 | **1** | 同上（fake home 复现同一 FAIL） |
| `doctor`（fake home：本机无 agent，全 SKIP、无 FAIL） | 0 | **0** | `Summary: 0 PASS / 0 WARN / 0 FAIL / 11 SKIP` |
| `doctor`（fake home：真安装后全 PASS） | 0 | **0** | `Summary: 1 PASS / 0 WARN / 0 FAIL / 10 SKIP` |
| `doctor --json`（有 FAIL） | 0（无 JSON，只有文本） | **1** | `{pass,warn,fail,skip,exitCode,checks[]}` 可 `JSON.parse` |
| `frobnicate`（未知子命令） | **0 + deny JSON** | **2** | `Unknown command: frobnicate` + `Run 'node bin/riskguard.mjs help' for usage.`，**无** deny JSON |
| `doctorr`（拼写错误） | 0 + deny JSON | **2** | `Unknown command: doctorr` |
| `''`（空参数） | 0 + deny JSON | **2** | `Unknown command: (empty argument)` |
| `acs`（两词命令拆开） | 0 + deny JSON | **2** | `Unknown command: acs` |
| hook：`{"tool_name":"Bash","tool_input":{"command":"echo hi"}}` | 0 + allow | **0** + allow | decision JSON |
| hook：危险命令（Claude PreToolUse 形状） | 0 + **allow（fail-open）** | **0** + **deny** | `ruleId: RG-GIT-001`（见 §7.1） |
| hook：危险命令（`commandRaw` 形状） | 0 + deny | **0** + deny | `ruleId: RG-GIT-001` |
| hook：空 stdin | 0 + fail-closed deny | **0** + fail-closed deny | `reason: empty input (fail-closed)` |
| hook：坏 JSON | 0 + fail-closed deny | **0** + fail-closed deny | `reason: invalid json input (fail-closed)` |
| `install --agent claude`（配置坏 JSON → abort，零写入） | 0 | **1** | `installation aborted` |
| `install --agent oc`（插件同名异内容 → abort） | 0 | **1** | `plugin installation aborted` |
| `install`（VERIFY 失败 → 真回滚，配置零残留、无 manifest） | 0 | **1** | `install verification FAILED and was rolled back`（`_g1g7_rollback.mjs` 实证 exitCode=1；同场景正常安装对照 = 0） |
| `install --agent codex`（未检测到 → skipped，显式指定） | 0 | **1** | `Codex CLI not detected. Skipped.` |
| `install --agent nonsense`（未知 agent） | 0 | **2** | `Unknown agent: nonsense. Skipped.` |
| `install`（已装再装 → 幂等） | 0 | **0** | `already installed (idempotent, no change)` |
| `install --dry-run`（无 agent 检出） | 0 | **0** | `No installable agents detected on this machine.` |
| `uninstall --agent claude`（未装过） | 0 | **0** | `not installed (no manifest)` |
| `uninstall --agent claude`（安装后配置损坏 → 拒绝） | 0 | **1** | `uninstall refused` |
| `bootstrap`（全新安装成功） | 0 | **0** | `Integrity: OK` |
| `bootstrap`（已装且校验通过） | 0 | **0** | `already installed and verified` |
| `bootstrap`（runtime INCOMPLETE / 装后自校验失败） | 0 | **1** | 附 `--force` 修复指引 |
| `uninstall --dry-run`（未装过） | 0 | **0** | `No files changed (dry-run).` |
| 子命令内部异常 | 未捕获 → stack trace，exit 1 | **1** | 一行 `RiskGuard: <message>` → stderr |
| `status` / `detect` / `version` / `help` / `acs evaluate` | 0 | **0** | 未改变语义 |

`bin/riskguard.mjs`（用户入口）与 `packages/cli/src/index.ts` 行为一致（探针末尾单独验证了 launcher 的 doctor FAIL → 1）。

---

## 5. 测试

### 5.1 数字（同一套 CI 测试集，改前/改后各跑一次全量）

| | 测试数 | 通过 | 失败 | 说明 |
| --- | --- | --- | --- | --- |
| 改前（基线 `67faab8`） | 319 | 319 | 0 | `packages/*/test` + `tests/**`（CI `ci.yml` 的 platform-independent 集合） |
| 改后 | **337** | **337** | **0** | +18 = 新增 `tests/e2e/cli-exit-codes.e2e.test.ts` |

CI 守卫脚本（本地复跑，均 OK）：`scripts/check-compatibility-docs.ts`、`scripts/verify-acs-schema-snapshot.ts`、`scripts/generate-agent-security-matrix.ts --check`。
`dist/`（gitignore）已用 `node scripts/build-release.ts` 重建，`tests/distribution` 因此跑在新代码上。

### 5.2 新增用例（`tests/e2e/cli-exit-codes.e2e.test.ts`，18 个）

全部 **真实 spawn** `node bin/riskguard.mjs`（等价 `packages/cli/src/index.ts`）并断言 `spawnSync(...).status`：

1. doctor 有 FAIL → 1（且 FAIL 行尾含 `→ 重跑: node bin/riskguard.mjs install --agent claude-code`）
2. doctor 无 FAIL（全 SKIP）→ 0
3. doctor 全 PASS（fake home 真安装后）→ 0
4. doctor --json + FAIL → 1 且 JSON 可解析（`fail≥1`、`exitCode=1`、FAIL check 带 `fix`）
5. 未知子命令 → 2 + 用法提示 + **不含** deny JSON / `fail-closed`
6. 拼写错误（`doctorr`）→ 2
7. 空字符串子命令 → 2
8. hook allow → 0 + `decision: allow`
9. hook deny（Claude 形状危险命令）→ **0** + `decision: deny`
10. hook deny（`commandRaw` 形状）→ 0 + deny
11. hook 空输入 → 0 + fail-closed deny
12. hook 坏 JSON → 0 + fail-closed deny
13. install 失败（配置损坏 → abort）→ 1
14. install 未知 agent → 2
15. install 回滚（VERIFY 失败 → `rolled back`）→ exitCode 1（调用 `index.ts` 同一个 `cmdInstallResult`；argv 无法注入故障）
16. install 幂等再装 → 0
17. uninstall 被拒（安装后配置损坏）→ 1
18. uninstall 未安装过的 agent → 0

### 5.3 对既有测试的修改（唯一一处，3 个断言）

`tests/release-hardening/lifecycle.e2e.test.ts` 中 3 个断言显式编码了**旧的**「失败也 exit 0」行为，与验收标准 4 直接冲突，故按新契约更新（其余断言与「零写入」「文件未被覆盖」等验证全部保留、未削弱）：

| 行 | 场景 | 改前 | 改后 |
| --- | --- | --- | --- |
| ~176 | 坏 JSON 配置 → install 拒绝且零写入（P0-2） | `assert.equal(r.status, 0)` | `assert.equal(r.status, 1)` |
| ~198 | `--agent nonsense` 未知 alias | `assert.equal(u.status, 0)` | `assert.equal(u.status, 2)` |
| ~225 | OpenCode 插件同名异内容 → 拒绝安装（P0-3） | `assert.equal(r.status, 0)` | `assert.equal(r.status, 1)` |

`tests/transaction`、`tests/e2e/install-ux`、`tests/product`、`packages/installer/test`、`tests/distribution` 等**未做任何修改**（`cmdInstall` 字符串 API 保持不变）。

---

## 6. 逐条验收标准自证

| # | 标准 | 结论 | 证据 |
| --- | --- | --- | --- |
| 1 | doctor FAIL>0 → 1；全 PASS/无 FAIL → 0 | ✅ | 真实 home `doctor` → exit 1（Summary 3/0/1/7）；fake home CLAUDE 未接线 → 1；全 SKIP → 0；真安装全 PASS → 0 |
| 2 | 未知子命令 → 2 且含 `Unknown command` + help 提示；不再输出 deny JSON | ✅ | 探针 3 行 + 用例 5/6/7 |
| 3 | hook 契约：allow → exit 0；危险 payload → exit 0 + deny JSON | ✅ | 用例 8/9/10 + 空输入/坏 JSON（用例 11/12） |
| 4 | install/uninstall 失败路径非零 | ✅ | install abort → 1（配置损坏 / 插件同名异内容，均经真实 CLI）、**真回滚（VERIFY 失败）→ 1 且配置零残留、无 manifest**（用 `index.ts` 同一函数的故障注入实证 + 用例 15）、uninstall 拒绝 → 1（用例 17） |
| 5 | 现有测试全绿（前后数字） | ✅ | 319/319 → 337/337（§5.1） |
| 6 | FAIL 行含可执行修复提示 | ✅ | `FAIL  claude-code    RiskGuard hook 注入缺失  → 重跑: node bin/riskguard.mjs install --agent claude-code` |
| 附 | runtime-probe 探测逻辑未改动 | ✅ | `packages/installer/src/runtime-probe.ts` 零改动；`cmdDoctor` 的判定顺序/条件逐条保持（仅把计数行同时记入 `checks`） |
| 附 | `--json` 模式下退出码语义一致 | ✅ | `doctor --json` + FAIL → 1 且 JSON 可解析（用例 4） |

---

## 7. 未解决问题 / 风险 / 需要评审的决策

### 7.1 【需评审】hook 运行时新增「Claude PreToolUse 输入形状」归一化（1 行，可回退）

**做了什么**：`index.ts` hook 运行时在 `commandRaw` 缺省时，从 `tool_input.command` 补出 `commandRaw`，其余判定完全交给 core 策略引擎。

**为什么**：验收标准 3 要求「危险 payload → deny JSON」。改前用任务卡同款 payload 形状实测是 **allow（fail-open）**：

```
改前：{"tool_name":"Bash","tool_input":{"command":"git reset --hard HEAD"}} | node bin/riskguard.mjs
      → {"decision":"allow","ruleId":"RG-UNKNOWN-001",...}   exit 0     ← 危险命令被放行
改后：同一输入 → {"decision":"deny","ruleId":"RG-GIT-001",...}  exit 0
```

`bin/riskguard.mjs` 此前完全忽略 `tool_input`（`commandRaw`/`domain`/`action` 全缺省时走 `filesystem.write` 放行）。**真实 CC/Codex 接线走 `packages/cli/src/pre-tool-hook.ts`（未改动）**，此入口是通用 hook 运行时。若 Evaluator 判定这超出「只改退出码与提示」的范围，回退只需删掉 `index.ts` 中该 3 行即可（其余验收项不受影响；但验收标准 3 的「危险 payload → deny」在 Claude 形状下将回到 allow）。

### 7.2 【决策】`install --agent <已知但本机未检测到的 agent>` → 1

显式指定目标却没装成，视为失败（`state: 'skipped'` + `explicitTargets`）。未显式指定时（无 `--agent`，扫描式安装）skipped 仍算 0。若期望「环境不具备 ≠ 失败」，改 `installExitCode` 一处即可。

### 7.3 【遗留，未在本轮修】`install --agent dsh` 的提示语

dsh 是已知 agent 但不在本 CLI 安装范围（`installerKey('dsh') === null`），输出仍是 `Unknown agent: dsh. Skipped.`（现在退出码为 2，可被脚本察觉）。**提示语未改**（不给这一行加歧义/不扩大改动面）。建议后续单独卡片：改为「dsh 不在本 CLI 安装范围，请用 skills/agent-risk-guard/sync-prod.ps1」并同样 exit 2。

### 7.4 【决策】用法错误的输出通道 = stdout

`Unknown command: …` + help 提示写 **stdout**（与 CLI 现有「所有命令输出走 stdout」一致，也是编排器复现旧行为时捕获的通道）。若 CI 契约更希望用法错误走 stderr，属于一次性调整。

### 7.5 【提示】doctor 人类输出多了一行（追加，未重排）

FAIL>0 时 Summary 之后追加一行 `Exit code 1 (N FAIL). Fix the FAIL item(s) above, then re-run doctor.`。Summary 行本身格式与位置不变；只解析 Summary 的既有消费方不受影响。

### 7.6 【提示】`acs evaluate` 退出码保持 0

按任务卡「默认保持 0 除非确认应传播」处理——本轮未改。

### 7.7 【状态】改动未提交

工作区改动如下，留给 Evaluator 复核 / Orchestrator 决定提交：
`M packages/cli/src/{commands,index}.ts`、`M tests/release-hardening/lifecycle.e2e.test.ts`、`M README.md`、`M README.en.md`、`?? tests/e2e/cli-exit-codes.e2e.test.ts`、`?? tasks/orchestrator/_g1g7_probe.mjs`、`?? tasks/orchestrator/_g1g7_probe_before.txt`、`?? tasks/orchestrator/_g1g7_probe_after.txt`、`?? tasks/orchestrator/_g1g7_extra.mjs`、`?? tasks/orchestrator/_g1g7_rollback.mjs`、`?? tasks/orchestrator/_g1g7_detail.mjs`。`dist/` 已本地重建（gitignore，不入库）。

---

## 8. 复现步骤（Evaluator 可独立复跑）

```bash
cd E:/DeepSeek_Harness/workspace/2026_08_21/agent-risk-guard

# 1) 全量 CI 测试集（改后应为 337/337）
node --test packages/core/test/*.test.ts packages/trash/test/*.test.ts packages/installer/test/*.test.ts \
  packages/codex/test/*.test.ts packages/dsh/test/*.test.ts packages/acs/test/*.test.ts \
  tests/e2e/*.test.ts tests/adapter/*.test.ts tests/adversarial/*.test.ts tests/product/*.test.ts \
  tests/release-hardening/*.test.ts tests/transaction/*.test.ts tests/distribution/*.test.ts \
  tests/acs/*.test.ts tests/compatibility/*.test.ts tests/conformance/*.test.ts tests/acs-schema-conformance/*.test.ts

# 2) 退出码实证（同一脚本，改前输出见 _g1g7_probe_before.txt）
node tasks/orchestrator/_g1g7_probe.mjs

# 2b) 补验 skipped / bootstrap 分支
node tasks/orchestrator/_g1g7_extra.mjs
#    install --agent codex（未检出，显式指定）→ 1
#    install（无 --agent，无目标）→ 0
#    bootstrap 全新 → 0；已装 → 0；manifest 损坏 → 1
#    uninstall --dry-run → 0

# 2c) 真回滚 → exitCode 1（+ 配置零残留、无 manifest；对照组正常安装 = 0）
node tasks/orchestrator/_g1g7_rollback.mjs

# 3) 单点手验
node bin/riskguard.mjs doctor ; echo "exit=$?"                       # 本机 1（3 PASS/1 FAIL）
node bin/riskguard.mjs frobnicate ; echo "exit=$?"                   # 2 + Unknown command
echo '{"tool_name":"Bash","tool_input":{"command":"echo hi"}}'   | node bin/riskguard.mjs ; echo "exit=$?"  # 0 allow
echo '{"tool_name":"Bash","tool_input":{"command":"git reset --hard HEAD"}}' | node bin/riskguard.mjs ; echo "exit=$?"  # 0 deny
echo '' | node bin/riskguard.mjs ; echo "exit=$?"                    # 0 fail-closed deny
node bin/riskguard.mjs doctor --json ; echo "exit=$?"                # 1 + 可解析 JSON
```
