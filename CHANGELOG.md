# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [SemVer](https://semver.org/lang/zh-CN/)。所有日期均为 UTC。

## 版本语义说明

当前统一产品版本为 **`v0.1.2 Developer Preview`**（`package.json` = `0.1.2`；单一版本源 `packages/core/src/version.ts`）。

- `v0.1.0` / `v0.1.1`（2026-09-04）已发布为 GitHub Pre-release；历史 Git tag `v1.0.0`（2026-08-26）保留不动，作为发布标记；**不是**当前产品稳定版声明。
- 之所以仍不宣称 `1.0.0 Stable`：macOS / Linux 回收站与若干 Agent 的真实环境验证尚未完成，Codex 的 D3 真实会话待补。详见 `docs/TODO.md`。
- 历史 `[1.0.0]` / `[0.1.0]` / `[0.1.1]` 条目保留为历史记录，不删除、不重写历史。

## [Unreleased] - v0.1.2 Installer Finalization + Portable Runtime

### Added（Phase A：installer 收尾）

- **Manifest 纳入 transaction snapshot**：manifest 与 config/artifact 统一为 `TransactionTarget`，不再特殊处理 provisional manifest——安装前旧 manifest 存在则 backup exact（rollback restore 并 sha256 校验）；不存在则 existedBefore=false（rollback 移除新建的）。repair-install 失败也能完整恢复到 repair 前。
- **repair-install 识别**：manifest 存在但 wiring 损坏（BROKEN/INSTALLED）→ install 是 repair（成功报 `repaired successfully`），不再误报 `already installed`；仅「无改动 + 健康 ACTIVE」才 already。
- **verificationMode**：RuntimeProbeResult 增加 `dynamic`（Claude Code/Codex：真实执行 interception runtime self-test）/ `static`（OpenCode/DSH：wiring + artifact + integrity）/ `none`；status 与 doctor 如实展示，不再把所有 ACTIVE 都写成一视同仁。
- `package.json` description 去掉版本号（`Deterministic safety guardrails for AI coding agents`），后续升版不再需要同步改 description。

### Changed

- `package.json` version → `0.1.2`。

## [0.1.1] - 2026-09-04（v0.1.1 Release Hardening，已发布）

把安装/回滚/健康检查/状态判定做成真正闭环，消除「表面成功但实际残留或失效」。

### Added

- **真事务安装**（`packages/installer/src/transaction.ts`）：`InstallTransaction` 状态机 PRECHECK → SNAPSHOT/BACKUP → WRITE → VERIFY → COMMIT；每个目标记录 `TransactionTarget{path, existedBefore, backupPath, createdByTransaction}`。
- **Backup 失败即 ABORT**：任一「已存在」目标备份失败 → 立即终止零写入（`backupPaths()` 返回 `ok:false`，禁止 best-effort）；rollback 只使用本轮事务产生的精确备份，**禁止扫描历史 backup 目录**。
- **Created-file rollback**：原文件不存在 → rollback 用 trash 移除本轮创建文件；原文件存在 → restore 精确备份。rollback 后自验证（sha256 比对 / 目标不存在），不满足报 `ROLLBACK_INCOMPLETE`，绝不谎报成功。
- **Install 后 runtime self-test**（VERIFY）：provisional manifest → 调用统一 `probeAgentRuntime(deep:true)` 真实 spawn hook（无害 payload→ALLOW、危险 payload→DENY）→ PASS 才 finalize manifest + COMMIT；FAIL 自动 rollback。
- **统一 runtime probe**（`packages/installer/src/runtime-probe.ts`）：status / doctor / install-verification 共用同一判定；**ACTIVE = 完整 runtime self-test 通过**；hook 目标缺失 / OpenCode artifact hash 改变 / node 不可用 → BROKEN。
- **Manifest schemaVersion 2**：`transactionId`、`artifacts[].createdByInstall`、`runtimeVerification{verifiedAt, result}`；manifest 与配置写入均原子化（write temp → rename）。
- **故障注入测试** `tests/transaction/`（8 cases）：manifest 保存失败、created-file verify 失败、backup 失败、config-write 失败、artifact 失败、hook target 丢失、artifact hash 改变、runtime 不可用。
- **D0–D4 单一事实源防护**：`scripts/check-compatibility-docs.ts`（CI 跑）扫描 README/docs/CHANGELOG 防旧定义漂移；`docs/adapter-contract.md` 的历史等级命名已全部清除并改为引用 `compatibility.json` 的权威定义。
- **版本单一源**：`packages/core/src/version.ts` 从 `package.json` 读取；CLI/manifest 不再各自硬编码 `0.1.1`。
- GitHub `v0.1.0` Release 标记为 **Pre-release**（历史 tag 保留）。

### Changed

- `package.json` version → `0.1.1`（Developer Preview 继续，release gate 未完不宣稳定）。

## [0.1.0] - 2026-09-04（v0.1.0 Developer Preview，已发布）

向「可安装、可验证、可卸载」安全产品推进：

### Added

- 统一版本体系为 `v0.1.0 Developer Preview`（package.json / README / SECURITY / CHANGELOG）。
- 用户级 RiskGuard CLI：`detect` / `install` / `status` / `doctor` / `uninstall`（`node packages/cli/src/index.ts <cmd>` 或 `npm run riskguard -- <cmd>`）。
- 非破坏性安装：写入前备份、配置 merge（而非 replace）、安装 manifest、幂等安装/卸载、`--dry-run`、`--verbose`。
- 兼容性单一事实源：`packages/installer/compatibility.json`（Agent × 集成 × 硬/软 × D0–D4 等级），README 支持矩阵以它为准。
- 真实 D3 硬阻断实测（Windows，v0.1.0）：Claude Code `--permission-mode bypassPermissions` 与 OpenCode `run` 会话中，`git reset --hard` 均在工具执行前被 RiskGuard 拒绝（Claude Code 侧 `permission-rule` / OpenCode 侧 `BLOCKED_BY_GLOBAL_SAFETY_GUARD`），未提交改动存活；`precious.txt` 与 `sentinel` 实锤未被改动。
- 兼容性等级据实测对齐（compatibility.json 为唯一事实源）：claude-code/opencode=Windows D3，codex=Windows D2（本机未装 CLI，真实会话待补），dsh=Windows D3。
- **发布前整改（v0.1.0 Release Gate）**：
  - `status` 拆分 **Capability（D0–D4）** 与 **Runtime state（NOT_DETECTED / DETECTED / INSTALLED / ACTIVE / BROKEN）**：检测到 Agent + 能力非 D0 不再误报 ACTIVE；只有 manifest + wiring 在位且 doctor 关键项健康才 ACTIVE（P0-1）。
  - 类型化配置读取 `config-read.ts`（missing / valid / invalid-json / permission-denied / io-error）：损坏/无权限/IO 错误的配置 → install 立即终止且零写入，绝不覆盖无法确认内容的用户配置（P0-2）。
  - OpenCode 插件改用 namespace 名 `agent-risk-guard.ts`（旧名 `destructive-operation-guard` 仍兼容识别）：目标同名但内容非我方文件（SHA256 不符）→ 拒绝安装、零覆盖（P0-3）。
  - 事务式安装：preflight → backup → write → manifest → doctor，任一步失败回滚到安装前，不留下半成品（P0-4）。
  - `normalizeAgentId()` 统一 alias：`claude`/`cc`/`claude-code`、`oc`/`opencode`、`codex`（P1-1）。
  - manifest 增加 `schemaVersion` 与 `artifacts[{path, sha256}]`；卸载前校验 hash，被用户改过的 RiskGuard 文件不自动删除（P1-3）。
  - 卸载改为精确逆操作（当前配置 − RiskGuard 注入条目），保留用户 install 之后新增的配置；旧 manifest 兼容（P1-4）。
  - 新增 `tests/release-hardening/`：17 项单测 + 7 项完整生命周期 E2E（fresh fake HOME → detect → install → status ACTIVE → doctor PASS → 二次 install 幂等 → 用户新增配置 → uninstall → 全部保留；invalid JSON 拒装零写入；同名异内容插件拒装；人为删 hook → BROKEN）。全量 177/177 通过。

### Fixed

- **hook 相对导入路径错误**（真实 D3 兼修的回归）：`pre-tool-hook.ts` 的 `../../adapters` 在安装路径下解析到 `packages/cli/adapters`（不存在），导致本机生产 hook 一执行即 `ERR_MODULE_NOT_FOUND` 崩溃、Claude Code 将 hook 视为非阻断错误而放行命令。修正为 `../../../adapters` 与 `../../../core`。
- **PreToolUse hook 输出缺 `hookEventName`**（Claude Code 当前 schema 要求）：hook 输出 `{hookSpecificOutput:{permissionDecision:'deny',...}}` 被 Claude Code 判为「不合法 JSON」并当非阻断错误放行。现 DENY 输出补 `hookEventName:'PreToolUse'`，真实会话验证后能以 `permission-rule` 方式硬阻断工具调用。
- **doctor 漏识我方新 hook**（对真实安装会误报 FAIL）：识别逻辑曾只认 `dangerous-commands` 旧字符串；现 `hasRiskGuardHook()` 同时识别 `_riskguard` / `riskguard-*-hook` / `pre-tool-hook.ts`，真实安装后 doctor 对齐为 4 PASS。

### Added（R3 生态融合，前一轮未发布内容）

- **解释器 one-liner 检测**：`python -c 'os.system("rm -rf /")'`、`node -e fs.rmSync`（含 `require("fs")` 形态）、`perl -e unlink`、`ruby -e File.delete` 内嵌删除识别（core `classifyShellCommand` + 规则集）
- **shell wrapper 递归解包**：`unwrapShellWrapper()`（bash/sh/zsh/dash/pwsh/powershell `-c`、`cmd /c`、`pwsh -Command`，深度上限 5）；`bash -c 'git reset --hard'` 等包裹形式不再漏拦，安全包裹（`bash -c 'echo hi'`）不误伤
- **Secret Redaction**：`redact.ts`（`redactSecrets` / `redactJsonValue`），审计序列化 `auditToJson` 出口自动脱敏 token/API key/私钥/口令
- **敏感路径分类**：`classifySensitivePath()`（.ssh / .env / .aws / .kube / .npmrc / .git-credentials / 私钥 / .pem / credentials），供 read/write 门控
- **规则集 35 → 47 条**：补全 git 破坏命令清单（`push --force`（`(?!-)` 排除 `--force-with-lease` 误伤）、`branch -D`、`checkout --`、`restore`、`stash drop/clear`、`switch --discard-changes`、`worktree remove --force`）+ 解释器 one-liner + Windows wrapper（`cmd /c`、`pwsh -Command`）规则
- **规则自带测试用例**：`tests/adversarial/rule-self-test.test.ts`（每条 R3 新增规则 positive/negative 样例 + classifyShellCommand 联动断言）
- **核心单元测试**：`packages/core/test/ecosystem-fusion.test.ts`（redact / sensitive-path / unwrap）

### Security

- 规则 patch 与 `defaultDenyRules()` 单一事实源同步（rule-alignment 动态计数，YAML `''` 转义提取支持）
- 全量测试 18 文件 134/134 通过（本机；Windows trash/junction 真实执行 0 skipped）；v0.1.0 新增 `tests/product/*.test.ts`（merge/manifest/compatibility/hook schema 19 例）后共 153/153 通过。

## [1.0.0] - 2026-08-26

首个公开版本。同日完成 SkillHub 平台发布（`@user_d684b111/agent-risk-guard-audit@1.0.0`，审核通过、TRACE 评测通过）与 GitHub 开源。

### Added

- **M1 Core**：RiskEvent v1 / Decision v1 / risk taxonomy / path-resolver / normalize / policy-engine / audit（纯函数内核，无副作用）
- **M2 CLI Runtime**：stdin JSON → Decision JSON（供 command hook 使用），delete→deny+trash、write→allow、git_clean→deny、strict、fail-closed
- **M2 DSH 插件接线**：pre-execute 动态策略 + 单调 `ctx.tools.guard()` + junction 逃逸防护（`packages/dsh/` 真实 cordis 插件）
- **M3 Hook Family**：claude / cursor / grok / windsurf command hooks（Windows ps1 + macOS/Linux sh 规则同步）
- **M4 Plugin Family**：opencode `tool.before` TS 插件
- **M5 Codex**：rules-compiler 将 defaultPolicy 编译为 AGENTS.md/CLAUDE.md（单一事实源）
- **M6 Installer**：discovery / deploy / backup / rollback / uninstall / doctor
- **M7 行为级加固**：`resolveReal()`（fs.realpath）+ junction 逃逸 D3 实测；DSH pre-execute 内嵌 `checkJunctionEscape`
- **trash 包**：Windows Recycle Bin（D3 实测 2/2）、macOS Trash、freedesktop Trash
- **对抗防御**：全角字符/NFKC 归一化、引号插词、`$()`/反引号包裹、base64 管道、路径穿越、subprocess/execSync 动态执行、`reg delete`/`certutil`/`docker run|exec`/`git gc --prune`/`git reflog expire` 等 R2 新向量全覆盖
- **GAN 式独立判别器对抗审查**：core/installer/opencode/adapter/hook 五轮 maker-checker 独立评审闭环

### Security

- 本机生产部署（DSH patch 35 条、codex/CC hook、opencode 插件）已同步，D3 三 Agent 删除实测全部拒绝永久删除并走回收站
- 全量测试 22 组通过（含 70+ 条对抗语料）

## [0.1.0] - 2026-08-24

monorepo 工作区初版（内部开发基线）：M1 Core + M2 CLI 雏形 + D1 适配层骨架。

[1.0.0]: https://github.com/satan9394/agent-risk-guard/releases/tag/v1.0.0
[0.1.0]: https://github.com/satan9394/agent-risk-guard/releases/tag/v0.1.0
