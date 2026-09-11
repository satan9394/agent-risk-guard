# SUBAGENT-B — 独立竞品研究 · CAPABILITY_MATRIX（agent-risk-guard）

> 生成：2026-09-11（Product Evolution Orchestrator Round 1 / Subagent-B，限时 40 分钟任务）
> 范围：独立联网竞品研究，未修改任何代码。与既有 `docs/ecosystem-benchmark.md`（R3，2026-08-29，已记录 allowlister / CC Safety Net / claude-guardrails / agent-safety-pack / Relay / SecureVector 六家 + 融合决策）互补：本文件聚焦**官方平台机制**（Claude Code / Codex / OpenCode）、**新生 OSS 护栏项目**、**业界对抗研究与基准**、**标准与治理**（OWASP ACS）四个新维度，并把 RiskGuard 的能力按「行业基础 / 常见 / 差异化 / 缺失 / 不适合」五层归类。
> 方法：内置 `web_search` 因 DeepSeek search endpoint 401 失效，按全局规则回退 `curl.exe` + 本机代理 `127.0.0.1:7897` 直连官方文档 / arXiv API / GitHub API / 搜索引擎 HTML。数据截至 2026-09-11；star 数为当日近似值；官方文档以页面文本为准，未做真机执行验证。

## 1. 类别判断

AI coding agent 安全 / 权限控制生态，可按四个子轴切分，RiskGuard 落在它们的交叉区：

- A 轴 · 平台官方权限与钩子机制：Claude Code（permissions + hooks + Bash 沙箱）、Codex（sandbox + approval + exec-policy 规则 + auto-review）、OpenCode（allow/ask/deny 权限引擎）。
- B 轴 · 第三方护栏 / 危险命令拦截：shellfirm（932★，人机两用）、OWASP ACS Guardian 模式、各类小型 CC/Codex hook 项目。
- C 轴 · 对抗研究与基准：AgentDojo、CyberSecEval 3、QueryIPI、CodeSentinel、CapScope 等（攻击面 = prompt injection + 破坏性命令执行）。
- D 轴 · 标准与治理：OWASP Agentic AI – Threats and Mitigations（2025-02）、OWASP Agent Control Standard（ACS，2026 活跃）、Microsoft Agent Governance Toolkit（AGT）。

关键趋势判断：官方平台在快速收紧（2025-2026：Claude Code 上线 Bash 沙箱与 Protect credentials、Codex 上线 OS 沙箱 + exec-policy + 自动审批审查、OpenCode 上线 deny 规则），「agent 裸奔」的基线正在消失；同时对抗研究（C 轴）显示攻击已从「危险命令」升级到 query-agnostic 间接注入（QueryIPI）与工具输出/仓库内容携带指令。RiskGuard 的定位窗口从「有没有护栏」转向「跨 agent 一致性 + Windows 原生 + 确定性 fail-closed + 可恢复删除」。

## 2. 竞品表

| 竞品 | 类型 | 定位 / 关键机制 | 与 RiskGuard 的关系 | 来源 |
|---|---|---|---|---|
| Claude Code（官方） | A 轴 平台基线 | 权限系统（manual/acceptEdits/plan + 规则 specifiers、Bash compound/包装器规则）+ PreToolUse/PermissionRequest/PostToolUse 等 hooks（exit code 2 拦截、permissionDecision deny）+ Bash 沙箱（macOS Seatbelt / Linux-WSL2 bubblewrap+socat；**原生 Windows 不支持**）+ Protect credentials（凭据遮蔽） | 直接的上游平台；hook 是 RiskGuard CC 适配层的地基；其「无原生 Windows 沙箱」是 RiskGuard ps1 方案的机会点 | code.claude.com/docs/en/hooks、/permissions、/sandboxing |
| Codex（官方） | A 轴 平台基线 | OS 沙箱（macOS Seatbelt、Linux bwrap+seccomp、Windows 原生 unelevated/elevated、WSL2）+ approval policy（on-request / never / granular + auto-review 审查代理，解析失败 fail-closed）+ exec-policy `.rules`（Starlark prefix_rule：forbidden/prompt/allow，tree-sitter 拆分 `bash -lc "a && b"`，规则内嵌 match/not_match 自测）+ network_proxy 域名 allowlist（防 DNS rebinding）+ 受保护路径（.git/.agents/.codex 只读）+ OTel 审计 | 与 RiskGuard 交集最大：其 exec-policy 已实现「规则语言 + 自测 + 包装器拆解」三步；但它是单 agent 官方实现，不做跨 agent 同源与 Windows hook 层回收站语义 | developers.openai.com/codex/agent-approvals-security、/exec-policy；github.com/openai/codex SECURITY.md |
| OpenCode（官方，开源） | A 轴 平台基线 | opencode.json `permission`：allow/ask/deny 三态 + 对象语法按工具输入匹配（`bash`：「\*」ask、「rm \*」deny）、external_directory、--auto 自动放行但显式 deny 仍强制 | RiskGuard 的 OpenCode TS 插件（detectors 链 + fail-closed）叠加在原生权限引擎之上；官方 deny 规则已是平台能力，插件需提供原生缺失的确定性拦截与审计 | opencode.ai/docs/permissions |
| OWASP Agent Control Standard（ACS）+ Microsoft AGT | D+B 轴 标准/参考实现 | ACS 是 wire 规范：独立 Guardian Agent 在动作执行前 permit/deny/modify（认证通道 + envelope 审计）；参考实现用 Microsoft AGT 危险模式规则，带 Claude Code / OpenCode host shim；**默认 failure posture = proceed（fail-open）**；拒绝带 reason code（如 destructive_shell_command_blocked） | RiskGuard 已有 packages/acs 对齐；ACS 提供了「Guardian 外部化 + 结构化决策 + 审计可重建」的行业模型，但其 fail-open 默认值与 RG-I04 冲突，对接时必须显式 posture=deny | github.com/GenAI-Security-Project/agent-control-standard；github.com/microsoft/agent-governance-toolkit |
| shellfirm（kaplanelad/shellfirm，932★） | B 轴 OSS | 危险命令拦截（人机两用）：100+ 模式 × 9 生态、8 种 shell（含 PowerShell）、上下文感知升级（SSH/root/受保护 git 分支/生产 k8s 更严）、severity 分级、替代命令建议（push --force → --force-with-lease）、`.shellfirm.yaml` 团队策略（only-additive）、JSONL 审计、MCP server + `connect claude-code`（hooks） | 定位最接近的商业化 OSS 竞品：同样「拦截危险命令 + 审计 + 多 shell」，但其主战场是 shell 层（人 + agent），非 PreToolUse 工具调用层；无跨 agent 规则同源对齐，无回收站删除语义，无混淆绕过专项 | github.com/kaplanelad/shellfirm（README，Apache-2.0） |
| 对抗研究与基准（AgentDojo / CyberSecEval 3 / QueryIPI / CodeSentinel / CapScope 等） | C 轴 | AgentDojo：动态环境评测工具类 agent 的注入攻击与防御；CyberSecEval 3（Meta）：8 类风险含 agent prompt injection；QueryIPI：query-agnostic 间接注入（2025-10）；CodeSentinel：Tree-sitter + Min-K% 三层注入检测（2026-06）；CapScope：能力域 harness 限制工具授权（2026-09） | 提供威胁模型与测评方法论：证明「模式匹配之外的诱导源」是主攻击面；RiskGuard 的命令拦截拦「行动」，注入检测拦「源头」，二者正交 | arxiv 2406.13352 / 2408.01605 / 2510.23675 / 2606.19235 / 2609.08371 |
| 小型 CC/Codex hook 生态 | B 轴 长尾 | cc-safe-setup（6★，删除类操作工具边界拦截）、claude-code-railway-guard（环境感知 PreToolUse hook，fail-closed）、bouncer（单文件 door-guard，permissionDecision deny）、tool-gates（AST shell 门控，CC/Codex/Antigravity）、claude-code-safety-hooks、claude-god-mode、Runward、ai-agent-secure（Windows）等 | 市场需求被反复验证（大量小项目做同一件事），但均 1-2 人维护、无对齐测试、无跨 agent 同源；RiskGuard 的工程纵深（299 sh 套件 + GAN 审计 + 巡检脚本）是显著差距 | GitHub search（2026-09-11 检索结果） |
| （既有对标，未重查）allowlister / copilot-safety-net / claude-guardrails / agent-safety-pack / Relay / SecureVector | B 轴 | 见 docs/ecosystem-benchmark.md R3 记录 | 融合点已落地（解释器 one-liner、wrapper 解包、secret redaction、敏感路径、git 清单、自带测试） | docs/ecosystem-benchmark.md |

## 3. 能力矩阵

分层口径：行业基础 = 竞品普遍具备、缺失即出局；常见 = 多数头部竞品具备；差异化 = RiskGuard 领先或独有；缺失 = 竞争性空白（第 4 节逐项解释为什么值得做）；不适合 = 有意不采用（第 5 节）。

| 能力维度 | 分层 | RiskGuard 现状（v0.3.0） | 竞品参照 |
|---|---|---|---|
| pre-execution 硬拦截点（工具调用层） | 行业基础 | CC/Codex PreToolUse、OpenCode detectors、DSH pre-execute、AGY hook | CC 官方 hooks、Codex 审批+规则、OpenCode permission、ACS Guardian |
| allow/ask/deny 三态策略 | 行业基础 | ask/deny（拦截+人工放行）；JIT 放行未做 | CC specifiers、Codex forbidden/prompt/allow、OpenCode 三态 |
| 危险命令模式库（rm、git 破坏、系统破坏） | 行业基础 | 47 条 deny 规则 + ps1/sh 双单源 | CC/Codex 官方 deny、shellfirm 100+、AGT stock |
| 删除可恢复语义（进回收站） | 差异化 | 核心卖点：删除类操作拦截→回收站，而非仅阻止 | 无竞品对标；Claude/Codex 沙箱内直接删；shellfirm 无 |
| 混淆绕过检测（NFKC 全角 / base64 管道 / 变量拼接 / 引号插词） | 差异化 | GAN 审计 17/17 修复覆盖 | CC Safety Net 部分（拼接类）；shellfirm 无专项 |
| 跨 agent 单一规则源 + 防漂移对齐测试（M7） | 差异化 | ps1/sh/opencode/deploy 四套同源 + M7 对齐 4 测试 + rule-alignment 动态计数 | 仅 allowlister 思想接近（一配置多 agent），无对齐测试工程 |
| Windows 原生覆盖（ps1 hook） | 差异化 | 4 套 ps1 回归（37+8+18+53）；Git Bash 4-5s 性能问题已知 | Claude 沙箱不支持原生 Windows；shellfirm 支持 pwsh 但非 PreToolUse 层 |
| 确定性 fail-closed（RG-I04，解析失败不放行） | 差异化 | 恒 fail-closed；grep 回退 bug 需文档化 | 与 ACS 默认 proceed、allowlister fail-open 相反；与 Codex auto-review 解析失败 fail-closed 一致 |
| 解释器 one-liner 检测（python -c / node -e…） | 常见 | 已融合（normalize.ts classifyShellCommand） | CC Safety Net；Codex 视作普通命令 |
| shell wrapper 递归解包（bash -c '…'） | 常见 | 已融合（unwrapShellWrapper，深度 5） | CC Safety Net；Codex tree-sitter 拆分（更强，见 M1） |
| git 破坏命令完整清单 | 常见 | 47 条含 push --force（防误伤 --force-with-lease）等 | CC Safety Net；Codex 执行规则间接覆盖 |
| 审计日志 + secret redaction | 常见 | 已融合（redact.ts） | shellfirm JSONL、CC Safety Net、SecureVector、Codex OTel、ACS envelope |
| 规则自带测试（positive/negative） | 常见 | rule-self-test 已融合 | CC Safety Net rule test；Codex match/not_match 内联自测 |
| 敏感路径防护（read/write 门控） | 常见 | 已融合（classifySensitivePath） | agent-safety-pack；CC Protect credentials（遮蔽变体） |
| 多层模式（strict/paranoid） | 常见 | 恒 fail-closed（无档位，属于刻意取舍） | CC Safety Net strict/paranoid、shellfirm severity |
| bash AST 角色解析（管道/子 shell 角色感知） | 缺失 | roadmap #1 未做；词级+正则匹配 | allowlister 角色四态；Codex tree-sitter；CodeSentinel Tree-sitter |
| 环境/上下文感知风险升级 | 缺失 | 无（不区分 SSH/root/生产分支） | shellfirm 上下文升级、railway-guard 环境感知 fail-closed |
| JIT 限时放行（15min/session 到期失效） | 缺失 | roadmap #3 未做 | SecureVector；Codex granular approval |
| 入站 secret 扫描（UserPromptSubmit + commit 时） | 缺失 | roadmap #2 未做 | claude-guardrails；CC Protect credentials |
| 安全替代建议 + 拒绝理由结构化回传 | 缺失 | 拦截消息无替代建议 | shellfirm suggestions；yyy900 结构化理由 |
| hash-chain 审计账本（防篡改） | 缺失 | roadmap #4 未做 | SecureVector；ACS envelope 可重建 |
| prompt injection / 间接注入确定性检测 | 缺失 | 拦截工具输出与仓库内容源未做 | AgentDojo 基准、CodeSentinel、QueryIPI（攻击面证据） |
| 网络出口策略（egress allowlist / 域名代理） | 缺失 | 未覆盖（命令拦截不拦外发） | Codex network_proxy + DNS rebinding 防护；CC 网络隔离 |
| 标准/生态接口（ACS 线协议、MCP 工具门控） | 缺失 | packages/acs 对齐存在；MCP 工具面门控未做 | ACS + AGT shim；allowlister 参数感知门控 |
| 团队策略分发（additive-only 共享 yaml） | 缺失 | managed settings 未做；skillhub 分发未做 | shellfirm .shellfirm.yaml；CC managed settings |
| OS 级沙箱自研 | 不适合 | 有意不做（指引列入 roadmap #6） | CC Seatbelt/bubblewrap、Codex bwrap/Windows 沙箱 |
| LLM/ML 概率分类拦截 | 不适合 | 与确定性使命冲突 | Codex auto-review（模型审查，fail-closed）、SecureVector ML 兜底 |
| 云端/远程 Guardian 依赖 | 不适合 | 本机重度离线场景保底优先 | ACS 本地进程可离线；云服务引入网络/隐私依赖 |
| 数学挑战式人机确认 | 不适合 | agent 自动化场景会卡死流水线 | shellfirm challenge（面向人类终端） |
| fail-open 故障姿态 | 不适合 | 违反 RG-I04 | ACS 默认 proceed、allowlister fail-open |

## 4. 缺失项详解（为什么值得做）

按价值排序（对应 brief 的 roadmap 已有优先级，此处补充竞争依据与验收思路）：

1. **bash AST 角色解析（管道/子 shell 角色感知）**。理由：词级 + 正则匹配同时产生误伤（`head` 从管道读被拦、`dd` 带 `-Format` 等已知误伤面）与漏拦（变量拼接、重定向链）。allowlister 用角色四态（standalone/pipe_source/pipe_filter/subshell/substitution）证明可行；Codex 已用 tree-sitter 把 `bash -lc "a && b"` 拆成独立命令逐条判定（高级特性则不拆、按单条保守处理）——这条主线与我们 unwrapShellWrapper 同源但更强。值得做：引入轻量 shell 解析（tree-sitter bash grammar 已有可复用），把「角色」作为规则匹配上下文，能同时收窄误伤面与扩大拦截面，是当前 47 条规则之后收益最大的单点工程。

2. **环境/上下文感知风险升级**。理由：`rm -rf` 在本地实验目录与 SSH 到生产（或受保护 git 分支、k8s 生产环境）风险量级完全不同；无差别拦截会让护栏「狼来了」失去信任，无差别放行又危险。shellfirm 已实现上下文升级（更严 challenge）、railway-guard 演示了按环境 hard-deny 的 niche。值得做：hook 输入里已有 cwd/session 信息，加环境探测（git branch/remotes、SSH 会话、容器）把 risk score 喂给规则，几乎零成本提升可用性。

3. **JIT 限时放行**。理由：误拦是护栏弃用的第一原因；被拦合法操作若只能永久放行（或反复人工确认）体验差。SecureVector 的 15min/1h/session 到期自动失效已被验证；从审计上看，「带有效期授权」比「白名单永久豁免」可审计性强得多。值得做：放行记录进审计，到期强制回退，天然与 RG-I04 不冲突（放行是显式人工决策而非默认）。

4. **入站 secret 扫描（UserPromptSubmit + commit 时 staged diff）**。理由：命令拦截管执行，不管「凭据已被喂进模型/会话记录」；claude-guardrails 与 CC 官方 Protect credentials 都证明这是独立攻击面。值得做：hook 输入已含 UserPromptSubmit 事件；先做确定性规则集（活凭据形状：token/密码/API key 模式）拦截或遮蔽，成本低、与现有 redact.ts 复用度高。

5. **安全替代建议 + 拒绝理由结构化回传**。理由：拦截的「有用性」决定用户是否长期保留护栏；shellfirm 每条告警带替代命令（--force → --force-with-lease）是它获取信任的关键；yyy900 证明把拒绝理由结构化喂回 agent 能让 it 自我修正而非反复撞墙。值得做：为每个 deny 规则维护 suggested_alternative 字段，通过 hook 输出（permissionDecisionReason / detector payload）回传——纯加字段 + 规则表更新，ROI 极高。

6. **hash-chain 审计账本**。理由：防篡改审计是「删除进回收站」哲学的另一半——可恢复 + 可举证；SecureVector 已验证 per-rule evidence ledger。值得做：在既有 audit.ts 上加链式哈希（单文件即可），对外声明审计不可抵赖；安全工作流（企业采用）会把这个当入场券。

7. **prompt injection / 间接注入确定性检测**。理由：QueryIPI 证明攻击可 query-agnostic（利用系统提示与工具描述常量的注入），AgentDojo/CyberSecEval 3 把注入列为 agent 首要漏洞面，工具输出和仓库内容是指令源——这正是本产品定位「确定性拦截」可延伸的边界：「行动拦截」是下游保险，「注入源拦截」是上游止损。值得做：只做确定性子集（注释/字符串字面量中的指令披风、URL 索取命令回传、工具输出中的 `rm -rf` 类文本出现），不做 ML；与 CodeSentinel 的 Tree-sitter 提取思路同构，与现有 normalize/classify 管线可复用。

8. **网络出口策略（egress allowlist）**。理由：数据外泄是 coding agent 事故的最大类（凭据、源码外传），命令拦截不覆盖外发通道；Codex 已验证域名 allowlist + 本地/私有地址阻断 + DNS rebinding 防护的可行形态。值得做：对 DSH/CC 的 WebFetch/MCP 工具面加域名 allowlist（复用现有规则源），把「数据去哪」纳入护栏范围——但作为 hook 层能力，不追求代理级强制（那是 OS 沙箱面，见 N1）。

9. **标准/生态接口（ACS 线协议 + MCP 工具门控）**。理由：ACS 已是 OWASP 治理下的活跃线规范，参考实现（AGT + CC/OpenCode shim）把「Guardian 外部化 + 结构化决策 + envelope 审计」变成行业模型；企业想接自己的策略引擎与 SIEM 时，自造协议是阻力。RiskGuard 已有 packages/acs 对齐，值得补：MCP 工具调用参数级 deny（allowlister 已证明参数感知门控可行）——agent 泄露面正从 shell 转向 MCP/读文件工具。注意：对接 ACS 必须显式 posture=deny（见 N5）。

10. **团队策略分发（additive-only 共享配置）**。理由：个人工具进化成团队工具时，策略一致性与「只能收紧不能放宽」（shellfirm 原则）是采用前提；且 brief 已知 distribution 形态（skillhub 发布）未做，属低垂果实。

## 5. 不适合项（有意不采用）及原因

- **OS 级沙箱自研**：Claude Code 官方原生 Windows 都不支持沙箱、Codex 靠各平台系统实现（Seatbelt/bwrap/seccomp/Windows 沙箱），跨平台自研成本与维护面远超 hook 层；保留 roadmap「OS 级沙箱指引」（受限账号/WSL 容器）而非伪实现，与 ecosystem-benchmark.md 既有决策一致。
- **LLM/ML 概率分类拦截**：与「确定性（非概率）硬拦截」的立身之本冲突；模型审查有不可解释性与误判面（Codex auto-review 也只在审批面用且 fail-closed），可作为旁路建议，不可作为硬拦截。
- **云端/远程 Guardian 依赖**：目标用户本机重度多 agent 且可能离线；云服务引入网络可用性与隐私两个新面，违背「本地保底」的第一性。
- **数学挑战式人机确认**：对自动化 agent 流水线是死锁；RiskGuard 的 ask 路径应保持「人工确认」而非挑战题（那是 shellfirm 面向终端人类的产品取舍）。
- **fail-open 故障姿态**：ACS 默认 proceed / allowlister fail-open 与 RG-I04 直接冲突；无论对接什么标准，解析失败必须 deny。

## 6. 定位启示（供 orchestrator 决策）

1. 官方平台基线在收紧，RiskGuard 的差异点必须锚定在官方做不到的三件事上：**跨 agent 规则同源 + M7 防漂移**、**Windows 原生 ps1 hook（CC 官方沙箱不支持原生 Windows）**、**回收站可恢复删除语义**；官方（尤其 Codex exec-policy 已带规则自测）会持续逼近，M7 工程面是护城河。
2. 竞争性空白前三单点：AST 角色解析、替代建议 UX、确定性注入源检测——分别对应误伤收敛、护栏信任、攻击面前置。
3. 标准面：继续对齐 OWASP ACS（已有 packages/acs），但对外明确 posture 差异；企业场景把「可重建审计 + 拒绝理由结构化」当卖点。
4. 验证与引用：本文件引用的官方文档/论文均注明 URL；star 数与文档细节以 2026-09-11 快照为准，建议 orchestror 在下一轮进化前复查 Codex exec-policy 与 ACS 的版本演进（两者都是 experimental/活跃标准）。

## 7. 参考 URL 清单

官方平台机制
- https://code.claude.com/docs/en/hooks（Hook 事件/决策控制，PreToolUse exit code 语义）
- https://code.claude.com/docs/en/permissions（权限系统/Bash 复合命令/包装器规则/权限模式）
- https://code.claude.com/docs/en/sandboxing（Bash 沙箱：Seatbelt/bubblewrap+socat，原生 Windows 不支持，Protect credentials，failIfUnavailable）
- https://developers.openai.com/codex/agent-approvals-security（Codex 沙箱/审批/网络策略/auto-review/OTel；`--yolo` 危险放行；受保护路径 .git/.codex）
- https://developers.openai.com/codex/exec-policy（Codex .rules Starlark prefix_rule，forbidden/prompt/allow，tree-sitter 拆分，match/not_match 自测）
- https://github.com/openai/codex/blob/main/SECURITY.md（Codex 安全边界指引）
- https://opencode.ai/docs/permissions（OpenCode allow/ask/deny、对象语法、external_directory、--auto）

标准与治理
- https://github.com/GenAI-Security-Project/agent-control-standard（OWASP Agent Control Standard：Guardian wire 规范、envelope 审计、默认 failure posture=proceed、reason code 示例）
- https://github.com/microsoft/agent-governance-toolkit（ACS 参考实现背后的 Microsoft AGT）
- https://genai.owasp.org/resource/agentic-ai-threats-and-mitigations/（OWASP Agentic AI – Threats and Mitigations，2025-02；另有 Agent Control Standard(2026-08)、GenAI LLM Top 10 2026、Agentic Security 专委会）

对抗研究与基准
- https://arxiv.org/abs/2406.13352（AgentDojo：agent prompt injection 动态评测）
- https://arxiv.org/abs/2408.01605（CyberSecEval 3：LLM 网络安全风险评测，含 agent prompt injection）
- https://arxiv.org/abs/2510.23675（QueryIPI：query-agnostic 间接注入，攻击利用系统提示/工具描述常量）
- https://arxiv.org/abs/2606.19235（CodeSentinel：Tree-sitter+Min-K% 三层注入检测）
- https://arxiv.org/abs/2609.08371（Authority Is Not a String / CapScope：能力域 harness 限制工具授权，2026-09-08）
- https://arxiv.org/abs/2510.26328（Agent Skills 诱导的新一类注入）

OSS 竞品
- https://github.com/kaplanelad/shellfirm（932★：危险命令拦截人机两用、上下文升级、替代建议、MCP、团队策略）
- GitHub search（2026-09-11）：yurukusa/cc-safe-setup、JackMBurch/claude-code-railway-guard、karanb192/bouncer、camjac251/tool-gates、alexknowshtml/claude-code-safety-hooks、Itachi-1824/claude-god-mode、alvi-uiu/Runward、joelaniol/ai-agent-secure、Miguel249/claude-guardrails-lite

既有内部基准（未重查）
- docs/ecosystem-benchmark.md（allowlister / copilot-safety-net / claude-guardrails / agent-safety-pack / Relay / SecureVector，R3 融合决策）