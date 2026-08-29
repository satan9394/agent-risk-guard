# 生态对标与融合（Ecosystem Benchmark & Fusion）

> 2026-08-29 更新（R3）。本文件记录对 GitHub 同类项目的调研结论、吸取的经验、
> 融合落点与有意不采用的设计，作为后续迭代的依据。对标对象均为公开仓库，信息
> 采集自各项目 README / 文档（调研日期 2026-08-29）。

## 对标项目

| 项目 | 定位 | 与我们的关系 |
|---|---|---|
| [allowlister](https://github.com/nickderobertis/allowlister) | Rust 跨 8 Agent 统一 allowlist 引擎，bash AST 角色解析 | 定位最接近：一配置多 Agent |
| [CC Safety Net / copilot-safety-net](https://github.com/kenryu42/copilot-safety-net) | Copilot/Claude 的安全网 hook，语义命令分析 | 绕过防护思路最全 |
| [claude-guardrails](https://github.com/dwarvesf/claude-guardrails) | Claude Code 硬化配置（deny 规则 + hooks + 注入防御） | 分层防御与卸载设计 |
| [agent-safety-pack](https://github.com/de-otio/agent-safety-pack) | npm 模式数据库 + 6 类检查（命令/路径/URL/密钥/注入/搜索） | 模式库组织方式 |
| [Relay](https://github.com/aniiketvarshney/Relayaisecurity) | Agent 防火墙（tool call/终端/MCP 拦截 + SDK） | 沙箱兜底思路 |
| [SecureVector](https://github.com/Secure-Vector/securevector-ai-threat-monitor) | Agent 安全与可观测性（审计 + 策略 + JIT 放行） | 审计与放行机制 |

## 核心经验提取

### allowlister（Rust 引擎）
- **角色感知**：解析 bash AST，把命令按结构角色切分（standalone / pipe_source / pipe_filter / subshell / substitution），每个片段独立判定。`head` 从管道读安全、独立读文件危险，靠角色区分而不是一刀切。
- **判定四态**：allow / deny / ask / defer。defer = 无规则命中时放行给 Agent 自身权限系统（不是默认允许）。
- **一配置所有 Agent**：规则引擎与 harness 无关，只有薄适配层不同（Claude Code PreToolUse / Cursor beforeShellExecution / Copilot preToolUse / Codex PreToolUse / OpenCode plugin shim 等）。
- **工具调用门控**：同一规则语言管 shell 之外的内置工具（read/write/edit/web fetch）与 MCP 工具，参数感知。
- **fail-open**：内部错误绝不误伤（spurious deny 比漏拦更伤信任）。注：与我们 RG-I04「解析失败禁止 Fail Open」相反——我们针对的是安全判定本身，二者语义不同，见下方决策。
- **动态审批插件协议**：静态规则后可挂外部决策源（ticket 系统 / LLM 自动审批），JSON stdin/stdout 协议，带 session_id。

### CC Safety Net（语义分析）
- **解释器 one-liner 检测**：`python -c 'os.system("rm -rf /")'`、`node -e`、`ruby -e`、`perl -e` 内嵌破坏命令。字符串通配符规则对这类完全失效。
- **shell wrapper 递归解包**：`bash -c 'git reset --hard'`、`sh -lc 'rm -rf /'` 递归分析（上限 10 层）。
- **git 破坏命令完整清单**：checkout --、restore、reset --hard、clean -f、push --force、branch -D、stash drop/clear、switch --discard-changes、worktree remove --force。
- **strict / paranoid 模式**：strict = 解析歧义时 fail-closed；paranoid = 连非 temp 的 rm -rf 也拦、解释器 one-liner 全拦。
- **Secret Redaction**：block 消息与审计日志自动脱敏 token/password/API key。
- **JSONL 审计日志**：`~/.cc-safety-net/logs/<session>.jsonl`，脱敏后落盘。
- **规则自带测试**：每条规则文件带 `tests`（command + expect: blocked/allowed），`rule test` 一键验证。

### claude-guardrails
- **分层诚实文档**：明确「模式匹配可被绕过，真正的边界是 OS 级沙箱（Seatbelt/bubblewrap），deny 规则与 hooks 只是兜底」。我们应同样诚实声明。
- **入站 secret 扫描**：UserPromptSubmit 阶段拦截粘贴的活凭据，防密钥进模型/会话记录。
- **commit 时扫描**：PreToolUse 拦截 git commit，扫 staged diff 的密钥。
- **surgical 卸载**：精确减去自己装的条目，不动用户自定义（对比我们的 backup/rollback）。
- **full / lite 变体**：按信任度提供两档配置。

### agent-safety-pack
- **六类模式库**：bash-deny(117) / secrets(76) / sensitive-paths(113) / webfetch blocklist(147) / injection(101) / search-leak(27)，编译为 RegExp 加载。
- **多检查面**：checkCommand / checkPath / checkUrl / checkContentSecrets / checkContentInjection / checkSearchQuery。
- **strict 模式**：所有 ask 变 deny（无人值守场景）。
- **三层 URL 管线**：静态 blocklist → 本地威胁源（O(1)）→ 远程 API（opt-in，fail-open）。

### Relay
- **Docker 沙箱**：`--network none` + egress allowlist，命令先过策略再进沙箱执行。策略与执行分离。

### SecureVector
- **审计账本**：SHA-256 hash-chain 日志，防篡改；blocked 动作带 per-rule evidence ledger。
- **JIT 放行**：被拦的请求可申请限时放行（15min / 1h / session），到期自动失效。
- **ML 兜底**：OWASP LLM Top 10 + 28 条 agent-attack chains + 离线 ML 抓 regex 漏网。

## 融合决策

### 已融合（R3 落地，2026-08-29）
| 经验来源 | 落点 | 说明 |
|---|---|---|
| CC Safety Net | `packages/core/src/normalize.ts` | `classifyShellCommand` 新增解释器 one-liner 检测（python/node/perl/ruby）与 Windows wrapper（cmd /c、pwsh -Command）；`unwrapShellWrapper()` 递归解包（WRAPPER_MAX_DEPTH=5） |
| CC Safety Net | `packages/core/src/redact.ts`（新）+ `audit.ts` | Secret Redaction 统一出口：`redactSecrets()` / `redactJsonValue()`，审计序列化自动脱敏 |
| agent-safety-pack | `packages/core/src/normalize.ts` | `classifySensitivePath()` + SENSITIVE_PATH_PATTERNS（.ssh/.env/.aws/.kube/.npmrc/私钥/pem/凭据），供 read/write 门控 |
| CC Safety Net | `packages/installer/src/deploy.ts` + `assets/dsh/deny-risk-commands.patch.yml` | 规则集 35 → 47 条：补全 git 破坏清单（push --force 带 `(?!-)` 防误伤 --force-with-lease、branch -D、checkout --、restore、stash drop/clear、switch --discard-changes、worktree remove --force）+ 解释器 one-liner + Windows wrapper 规则 |
| CC Safety Net | `tests/adversarial/rule-self-test.test.ts`（新） | 规则自带测试用例：每条（重点 R3 新增）规则配 positive（应命中）/ negative（不误伤）样例 + classifyShellCommand 联动断言 |
| CC Safety Net | `packages/core/test/ecosystem-fusion.test.ts`（新） | redact / sensitive-path / unwrap 单元测试 |
| 全部 | `docs/ecosystem-benchmark.md`（本文件） | 对标记录与决策留档 |

### 有意不采用（及原因）
- **fail-open（allowlister）**：我们保留 RG-I04「解析失败 fail-closed」。理由：本项目是安全门禁而非开发者工具，误拦可人工放行，漏拦不可接受；allowlister 的 fail-open 是面向"别打扰开发者"的产品取舍。
- **defer 四态（allowlister）**：现状 ask 已覆盖"需人工确认"，defer（交给 Agent 自身权限系统）在 DSH pre-execute 语境下等于放行，收益低、风险高，不引入。
- **Docker 沙箱（Relay / claude-guardrails）**：Windows 主场景无 Seatbelt/bubblewrap 等价物；OS 级沙箱是独立体系，列为 roadmap 而不是伪实现。

### Roadmap（未做，按价值排序）
1. **AST 角色解析**（allowlister）：管道/子 shell/命令替换的角色感知规则引擎——`head` 从管道读安全。需引入 shell 解析器，工作量大。
2. **入站 secret 扫描 + commit 扫描**（claude-guardrails）：UserPromptSubmit 拦截活凭据、commit 时扫 staged diff。
3. **JIT 限时放行**（SecureVector）：被拦请求申请 15min/1h/session 放行，到期自动失效。
4. **hash-chain 审计账本**（SecureVector）：审计日志防篡改链。
5. **prompt injection 检测**（agent-safety-pack / claude-guardrails）：工具输出与抓取内容扫描注入模式。
6. **OS 级沙箱指引**（claude-guardrails）：诚实声明边界在沙箱，提供 Windows 可行的指引（如受限账号 / WSL 容器）。

## 验证

- `node --test tests/adversarial/rule-alignment.test.ts tests/adversarial/rule-self-test.test.ts packages/core/test/ecosystem-fusion.test.ts` → 10/10
- CI 同款全量 18 文件 → 134/134（本机，Windows 下 trash/junction 真实执行，0 skipped）
- rule-alignment 动态计数：patch 47 条与 defaultDenyRules() 47 条逐条一致（YAML `''` 转义提取已支持）
