# IMPLEMENTATION_BRIEF — G1+G7：CLI 失败传播与错误语义

- 生成：2026-09-11 · Orchestrator Round 18（切片 #2）
- 来源：PRODUCT_GAP_MAP G1（P0）+ G7（P1）；审计 A-F1 / A-F3
- 编排器实证（已亲自复跑确认，非引用审计结论）：
  - `node bin/riskguard.mjs doctor` → 输出 `Summary: 3 PASS / 0 WARN / 1 FAIL / 7 SKIP`，**退出码 0**
  - `node bin/riskguard.mjs frobnicate` → 输出 `{"decision":"deny",...,"reason":"empty input (fail-closed)"}`，**退出码 0**

## 目标
让 CLI 的退出码与错误语义可信：失败必须可见可检测（脚本/CI 能据退出码判断），未知命令必须给出用法提示而非静默落入 hook 运行时。**同时不得破坏 hook 运行时的既有契约**（decision JSON + exit 0）。

## 用户场景
1. 新用户跑 `doctor` 看到 `1 FAIL`（说明本机 Claude Code 防护未生效），想知道"我该做什么"——现在既没有非零退出码（脚本/CI 察觉不到），FAIL 行也没有修复指引。
2. 用户手误 `riskguard doctorr`，得到一段与意图无关的 deny JSON，以为"RiskGuard 拒绝了什么"。
3. CI/监控脚本用 `riskguard doctor` 做健康检查，被 exit 0 骗过。

## 当前问题（证据）
- `packages/cli/src/index.ts:111`：子命令一律 `process.exit(0)`；L118/L126/L130 hook 运行时亦 exit 0。
- `packages/cli/src/index.ts:46-47`：`known` 集合之外的子命令 → `return { opts: {} }`（无 cmd）→ 落入 hook 运行时 → 空 stdin → fail-closed deny JSON。
- `packages/cli/src/commands.ts:566-610` `cmdDoctor()` 返回字符串（含 Summary 计数），**无任何失败信号返回给调用方**；`counts.fail > 0` 时不体现。
- 其它子命令（install/uninstall/bootstrap）失败时同样 exit 0（install 失败虽有 "rolled back" 文案，但退出码不体现）。

## 理想行为
1. `doctor`：`FAIL` 计数 > 0 → **退出码 1**（WARN>0 且 FAIL=0 → 退出码 0，但保留可见 WARN）。FAIL 行尾部追加可执行的修复提示（如 `→ 重跑: node bin/riskguard.mjs install --agent claude-code`）。
2. 未知子命令：输出 `Unknown command: <x>` + `Run 'node bin/riskguard.mjs help'` → **退出码 2**。
3. 其它子命令失败（install 回滚 / uninstall 失败等）→ **非零退出码**（各自语义化，如 1）。
4. **hook 运行时路径保持原样**：无子命令 + stdin JSON → 输出 decision JSON + **exit 0**（deny 是正常决策，不是错误）。空输入/坏 JSON 的 fail-closed deny 亦保持 exit 0。
5. `--json` 模式下，退出码语义与人类模式一致（便于 CI）。

## 涉及模块
- `packages/cli/src/index.ts`（exit code 传播、未知子命令判定）
- `packages/cli/src/commands.ts`（`cmdDoctor` 需要能回传失败信号——建议改为返回 `{ text, exitCode }` 或额外导出计数；并给 FAIL 行加修复提示）
- 若需要，`packages/cli/src/cli.ts`（帮助文本可提到退出码约定）
- 测试：`tests/e2e/cli.e2e.test.ts`、`packages/installer/test/installer.test.ts` 等现有套件

## 不能破坏什么
1. **hook 运行时契约**（最高优先级）：`echo '<json>' | node bin/riskguard.mjs` 必须仍然输出 decision JSON 且 **exit 0**；CC/Codex 集成依赖此行为。空输入/坏 JSON 的 fail-closed 行为不变。
2. 现有测试全绿：`node --test tests/e2e/*.test.ts`、`packages/installer/test/*.test.ts`、`tests/product/*.test.ts` 等。
3. `doctor` 的人类可读输出格式（含 Summary 行）——只追加，不重排既有行；`--json` 输出结构若存在需保持兼容。
4. `acs-evaluate` 的 stdin→stdout 契约（其退出码语义需单独确认，默认保持 0 除非确认应传播）。
5. 不得改变 doctor 的**判定逻辑**（runtime-probe 已实现实弹自检，本轮只做退出码与提示，不动探测能力）。

## 验收标准
1. `doctor` 出现 FAIL 时退出码为 1；全部 PASS/无 FAIL 时退出码 0。（用真实调用验证，非单测断言字符串）
2. 未知子命令退出码为 2，且输出含 `Unknown command` 与 help 提示；**不再**输出 deny JSON。
3. `echo '{"tool_name":"Bash","tool_input":{"command":"echo hi"}}' | node bin/riskguard.mjs` → exit 0（hook 契约未破坏）；危险 payload 亦 exit 0 + deny JSON。
4. install/uninstall 的失败路径有非零退出码（至少 install 回滚场景）。
5. 现有测试套件全绿（给出前后数字）。
6. FAIL 行含可执行的修复提示。

## 错误场景
- 未知命令（含拼写错误、空参数）：exit 2 + 提示。
- `doctor` 无 agent 安装（全 SKIP、无 FAIL）：exit 0（不是失败）。
- hook 运行时收到空 stdin / 坏 JSON：保持 fail-closed deny + exit 0（**不得**改成非零，否则 CC/Codex 集成可能误判为 hook 故障）。
- `--json` + FAIL：exit 1 且 JSON 可解析。

## 测试要求
- 新增/扩展 e2e 测试覆盖：doctor FAIL→1、doctor 全 PASS→0、未知命令→2、hook 运行时→0（allow 与 deny 各一）。
- 测试须**真实 spawn CLI 进程**并断言退出码（`spawnSync` 的 `status`），不能只断言输出字符串。
- 回归：跑全量 CLI/installer 测试并记录前后数字。

## 交付物
`IMPLEMENTATION_RESULT_G1G7.md`：改动摘要 + 退出码对照表（命令/场景/前/后）+ 测试数字 + 未解决问题。
