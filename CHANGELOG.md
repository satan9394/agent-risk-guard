# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [SemVer](https://semver.org/lang/zh-CN/)。所有日期均为 UTC。

## 版本语义说明

当前统一产品版本为 **`v0.2.2 Developer Preview`**（`package.json` = `0.2.2`；单一版本源 `packages/core/src/version.ts`）。

- `v0.1.0` / `v0.1.1`（2026-09-04）与 `v0.1.2` 已发布为 GitHub Pre-release；历史 Git tag `v1.0.0`（2026-08-26）保留不动，作为发布标记；**不是**当前产品稳定版声明。
- 之所以仍不宣称 `1.0.0 Stable`：macOS / Linux 回收站与若干 Agent 的真实环境验证尚未完成，Codex 的 D3 真实会话待补。详见 `docs/TODO.md`。
- 历史 `[1.0.0]` / `[0.1.0]` / `[0.1.1]` / `[0.1.2]` / `[0.2.0]` 条目保留为历史记录，不删除、不重写历史。

## [Unreleased] - v0.2.2 ACS Protocol Finalization

> 定位：**ACS 协议层冻结**。Phase A 只解决两件事：① ACS version gate——official wire gateway
> 精确拒绝不支持版本（schema-valid ≠ supported，未知版本返回 ACS application error `-32001`，
> 绝不误当作 0.1.0 处理、绝不返回 security policy DENY）；② Release assets 真正上传——
> GitHub Release 不再只有 Source Code，而是包含可校验的 `tar.gz` + `SHA256SUMS.txt`。
> 完成后 ACS 协议层冻结（§十三），核心转向 v0.3.0 Real Agent Conformance。

### Added

- **ACS version gate**（§一~§六）：`SUPPORTED_ACS_SPEC_VERSIONS = ['0.1.0']`、`isSupportedAcsVersion()`、
  `getSupportedAcsVersions()`（精确 pin，禁止 0.1.x / 0.x / latest / semver range / negotiation）。
- **Unsupported version 错误语义**（§四）：wire 模式 `params.acs_version != 0.1.0`（且 schema-valid）→
  ACS application error `-32001 Unsupported ACS version: <v>. Supported: 0.1.0`；不进 RiskEvent / Policy Engine；
  与 schema-invalid（`-32602`）、policy deny 三者严格区分。
- **`.github/workflows/release.yml`**（§七/§九/§十）：tag `v*` 触发，双 Node (22/24) 全量验证
  （tests + schema conformance + artifact hash）全 PASS 后才 `gh release create`（Pre-release）上传
  `agent-risk-guard-v*.tar.gz` + 根目录 `SHA256SUMS.txt`。

### Changed

- `ACS_JSONRPC_CODES` 增加 `UNSUPPORTED_ACS_VERSION: -32001`（ACS application error 区间 -32000 ~ -32099）。
- `package.json` / `compatibility.json` productVersion → `0.2.2`。

### Security

- **Protocol version mismatch must fail explicitly**：未知 ACS 版本绝不 fallback 到 0.1.0 逻辑继续处理。
- 协议能力不匹配（-32001）与危险操作判断（policy DENY）彻底分离，避免“协议错误被当成安全拦截成功”的假象。

## [0.2.1] - 2026-09-05（v0.2.1 ACS Schema Conformance Patch，已发布）

> 定位：**Experimental OWASP ACS v0.1.0 schema-conformant wire gateway**（§五十七），
> 仍不宣称 compliant / certified。官方 JSON Schema 自本轮起是 Release Gate（§五十三）。
> 核心目标：RiskGuard 的 ACS 输入/输出必须能通过 **OWASP ACS v0.1.0 官方 JSON Schema** 验证，
> 而不是只通过 RiskGuard 自己的简化校验。

### Added

- **官方 ACS v0.1.0 schema 快照**（§二十四/§二十五）：`tests/vendor/owasp-acs-v0.1.0/`
  （request-envelope / response-envelope / hooks/tool-call-request / modifications / ask-details / defer-details / provenance），
  pinned 到 upstream commit `f46d260d22fe6d6ad71e4d979be7e25d063c468e`（GenAI-Security-Project/agent-control-standard，Apache-2.0）。
- **JSON Schema 校验（Layer 2）**（§二十八/§二十九）：`ajv`（Draft 2020-12）+ `ajv-formats`（devDependencies），
  官方 schema 是最终 conformance 判据；本地 validator（Layer 1）保留（快速、友好、fail-closed）。
- **JSON-RPC Request/Response Envelope**（§七/§十/§十二）：`AcsRequestEnvelope` / `AcsRequestParams` /
  `AcsRequestMetadata` / `AcsResponseEnvelope` 类型 + `packages/acs/src/envelope.ts`。
- **wire 模式 Gateway**（§八/§九）：`evaluateAcsEnvelope()`——Request Envelope → Gateway → Response Envelope
  是唯一官方 conformance 对象；`response.id` 回显 `request.id`（§三十八）、`result.request_id` 回显
  `params.request_id`（§三十七）。
- **错误语义分离**（§三十九/§四十/§四十一）：invalid JSON → `-32700`（id null）；invalid envelope → `-32600`；
  invalid params/payload → `-32602`；valid request 但安全映射失败 → **ACS deny + degraded=true**（policy 层，非协议错误）。
- **capability 推导**（§三十一/§三十二）：官方 capability 可选；缺失时从 tool/operation/raw_command/arguments 推导
  （例：tool=shell + `git reset --hard` → git.destructive），推导不确定 → fail-closed deny。
- **arguments value-wrapper 解析**（§三十三~§三十五）：`unwrapAcsArguments()`（wrapper → 普通值，保留
  argument-level provenance + `argumentPath=/arguments/<key>`）；envelope metadata → `context.metadata.acs`（§三十六）。
- **CLI `acs evaluate --wire`**（§四十七/§四十八）：stdin 官方 Request Envelope → stdout 官方 Response Envelope；
  默认保持 payload mode；help 明确两种模式。
- **Schema 完整性**（§五十四/§五十六）：`SCHEMA_SHA256SUMS` + `scripts/verify-acs-schema-snapshot.ts`（CI 校验）；
  `scripts/check-acs-upstream.ts`（informational drift check，不阻塞 CI，§二十七）。
- **官方 fixtures**（§四十五/§四十六）：`tests/fixtures/acs-v0.1.0/{payload,envelope}/`（官方 shape、合法 UUID、wrapper arguments）。
- **Conformance 测试套件**（§五十一/§六十）：`tests/acs-schema-conformance/`——official envelope/payload PASS、
  capability omitted PASS、arguments missing / wrapper shape / acs_version=0.1 / type missing /
  description-only modification FAIL、allow/deny/modify/ask/defer 响应 PASS、request_id/id 回显、协议错误码。

### Changed

- `ACS_VERSION` → `0.1.0`；新增 `ACS_SPEC_VERSION = '0.1.0'`（完整 SemVer，§三）；`ACS_PROFILE` 保持 `experimental-0.1`。
- **ToolCallRequest 对齐官方 required**（§四）：`tool` + `arguments` 必填；`capability` 可选；
  非官方顶层字段（environment / provenance[] / requestId / tool.protocol）移出官方 payload 类型（§六）。
- **AcsResult 官方必填**（§十三/§十四/§十五/§十六）：`type="final"` / `acs_version`（SemVer）/ `request_id`（UUID）/
  `decision`；`request_id` 不再放 extensions。
- **modifications 官方结构**（§十七~§二十一）：object（`parameter_overrides` / `modified_content` / `redactions`），
  不再是 `[{tool,capability,description}]` 数组；safeAlternative → modify 仅在 arguments 能安全表达
  operation/path/mode 时输出；否则 deny（`Safe replacement is available conceptually but cannot be represented safely in this ACS payload.`）。
- **ask_details / defer_details 官方 schema**（§二十二/§二十三）：approver+question+timeout_seconds /
  reason+resolution_method+resolution_timeout_ms。
- `compatibility.json`：`acsProfile` → `experimental-0.1.0`，productVersion → `0.2.1`（§五十）。
- 遗留 fixture `tests/fixtures/acs-v0.1/filesystem-delete.json`：`_expected` `modify` → `deny`（§二十 行为变更；官方可表达版本见 acs-v0.1.0 fixtures）。

### Security

- 协议错误与 policy deny 严格区分：wire 模式不把 invalid JSON-RPC 伪装成 deny result（§四十）。
- 显式未知 capability 绝不静默 reinterpret（fail-closed，§三十二）。
- vendor schema 只读 + hash 完整性校验，防止“为了让测试通过而改官方 schema”（§五十四/§五十五）。

## [0.2.0] - 2026-09-05（v0.2.0 ACS Alignment Foundation，已发布）

> 定位：**OWASP ACS v0.1 aligned（experimental）**，不宣称 compliant / certified（ACS 仍 Public Preview，无官方 conformance 标准）。
> 原则：ACS 是 Boundary Protocol，不是 Core Domain Model —— RiskEvent / Policy Engine 保持标准无关，Core 不依赖 ACS。

### Added

- **`packages/acs/` 独立边界协议包**（v0.2.0 目标 §三）：
  - `ACS_VERSION = '0.1'` 显式固定（§四）；未来 acs-v1 并存预留。
  - **Capability Taxonomy**（§八）：11 个 capability（filesystem.read/write/delete、shell.execute、git.modify/git.destructive、process.execute、network.connect、credentials.read/write、mcp.invoke）；Capability ≠ Risk（§九，RG 规则族负责风险判定）。
  - **Inbound**：`acsToolCallToRiskEvent()`（§六/§七）——tool→domain、operation→action、raw_command→command.raw（触发 classifyShellCommand 细化）、arguments→targets、intent→`context.metadata.intent`（仅 contextual evidence，绝不决定 allow）。
  - **Outbound**：`riskDecisionToAcsResult()`（§十~§十五）——allow→allow、deny→deny、deny+safeAlternative→**modify（Modification Proposal，只提议不执行）**、ask→ask、defer 仅协议支持；`buildAcsReasoning()` 保证 reasoning 含 rule ID + risk category + operation + reason。
  - **Gateway**：`evaluateAcsToolCall()`（§十六）统一管线 validate → map → evaluate → map → validate；非法输入 **fail-closed**（deny + `extensions.riskguard.degraded=true`，不抛 stack trace，§十八）。
  - **RiskGuard Extension Namespace**（§十九）：`extensions.riskguard { ruleId, degraded, verification, monotonic, acsVersion, profile }`，不往 ACS 官方 schema 顶层加字段。
  - **SecurityAuditEvent**（§三十七/§三十八）：JSONL / structured log，出口统一 `redactSecrets` 脱敏，不记录 raw_command / arguments / 凭据路径。
- **Compatibility Schema v2**（§二十~§三十六）：`compatibility.json` → `schemaVersion "2.0"`，每 Agent 增加 surfaces（EvidenceState）、enforcementDetail、sandbox、policy（`policyScope: user|machine|enterprise`，Copilot CLI 系统策略预留 §三十）、bypass、hookFailureSemantics（fail-open/fail-closed/warning-and-continue/unknown，§三十二）、conditionalAvailability（Windsurf Restricted Mode → hooks 不加载，§三十一）、securityBoundaries（L0–L5，§三十三/§三十四）、capabilities（per-capability matrix）、componentInventory（AGBoM 预留 §三十六）。**loader 兼容 v1→v2 迁移**（§四十一），v2 未声明字段一律 unknown 不伪造 false（§二十三）。
- **Agent Security Conformance Framework**（§二十五~§二十七）：`packages/acs/src/conformance.ts` + `tests/conformance/` —— C1–C10 维度（Hook Available / Pre-execution / Hard Deny / Deny survives bypass / Safe allowed / Dangerous blocked / Tool never executed / Hook failure semantics / User bypass / MCP coverage），状态 PASS / FAIL / SKIP / UNKNOWN；与 D0–D4 是另一维度，不互相替代。本轮 Framework 就绪（mock evidence 驱动 P0 四件套），真实 D3 下一阶段执行。
- **CLI `riskguard acs evaluate`**（§十七/§十八）：stdin ToolCallRequest JSON → stdout Result JSON；`--profile strict`、`--audit`（追加脱敏 JSONL）。
- **Golden Fixtures**（§四十）：`tests/fixtures/acs-v0.1/`（shell-safe / git-reset-hard / filesystem-delete / credential-read / mcp-tool-call，各带 `_expected`），gateway 全链路 + round-trip 测试。
- **Agent Security Matrix 自动生成**（§二十四）：`scripts/generate-agent-security-matrix.ts` → `docs/generated/agent-security-matrix.md`，CI `--check` 防漂移。

### Changed

- `package.json` version → `0.2.0`；`compatibility.json` productVersion → `0.2.0`。
- README 增加第二行定位：**Cross-agent runtime security enforcement with experimental OWASP ACS v0.1 alignment.**（§四十三：ACS 不占第一标题，RiskGuard 仍是独立项目）。
- `packages/core/src/event.ts`：`EventContext` 增加可选 `metadata`（非破坏式；承载 ACS intent/provenance evidence，Core 不解释其内容）。
- `packages/cli/src/runtime-install.ts`：portable runtime 文件集加入 `packages/acs`。

### Security

- 非法 ACS 输入 fail-closed（deny + degraded），绝不抛 stack trace（§十八）。
- reasoning 满足 ACS 要求（rule ID + risk category + operation + reason），禁止 "blocked / dangerous / denied" 无意义文本（§十五）。
- 审计不降低隐私保护：ACS 对齐不改变现有脱敏机制（§三十八）。

## [0.1.2] - 2026-09-04（v0.1.2 Installer Finalization + Portable Runtime，已发布）

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
