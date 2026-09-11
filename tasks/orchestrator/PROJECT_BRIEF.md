# PROJECT_BRIEF — agent-risk-guard (RiskGuard)

- 生成：2026-09-10（Product Evolution Orchestrator Round 1）

## 产品是什么
跨 AI coding agent 的确定性运行时安全护栏（deterministic safety guardrails for AI coding agents）。
在所有受支持的 coding agent 执行 shell 命令前拦截：永久删除（rm/Remove-Item/Python/Node 等）、
破坏性 Git 操作（reset --hard/checkout --/restore/clean/branch -D/push --force 等）、
系统破坏命令（磁盘格式化/分区/关机/wmic shadowcopy 等）、混淆绕过（引号插词/全角 NFKC/base64 管道/变量拼接等）。

## 用户是谁
重度使用多家 AI coding agent 的开发者（本机同时跑 Claude Code / Codex / OpenCode / DeepSeek Harness / Antigravity）。
核心诉求：即使 agent 被诱导或误判，也不能造成永久删除或不可逆破坏；删除必须进回收站。

## 核心任务
在 agent 的工具调用层做**确定性**（非概率）pre-execution 硬拦截：
- Claude Code / Codex：PreToolUse hook（ps1 for Windows / sh for Linux-macOS）
- OpenCode：TS 插件（detectors 链 + fail-closed 信号）
- DSH：pre-execute 门禁插件（cordis.patch.yml 规则）
- Antigravity（agy）：hook 适配器复用共享规则
- 单一规则源纪律：ps1/sh/opencode/deploy 规则集跨 agent 同步，M7 对齐测试防漂移

## 当前成熟阶段
- v0.3.0 Developer Preview（package.json = 0.3.0；单一版本源 packages/core/src/version.ts）
- 5 agent 生产接线在位（CC/Codex/OpenCode/DSH/AGY），doctor 巡检 4 PASS
- 跨平台验证已闭环：WSL Ubuntu + Git Bash + macOS（GitHub Actions CI）三环境 sh 套件 299/299
- 3 套 sh 回归（67+40+192）+ 4 套 ps1 回归（37+8+18+53）+ opencode 33 测试 + M7 对齐 4 测试全绿
- GAN 对抗审查 17/17 findings 修复（v0.3.0）
- 生产接线巡检自愈脚本 scripts/riskguard-wiring-check.ps1（-Fix 从仓库单源恢复）

## 已知约束
- macOS 真机 trash 命令实测待补（WSL/Git Bash/macOS CI 规则集已过，D1→待提级）
- Copilot CLI / Windsurf / Cursor 真机 D3 待补（仓库 adapter 已实现，单测覆盖）
- Git Bash 性能：单次 hook 4-5s vs WSL 0.2s（慢 20-28 倍），hook 内多次 python3 spawn，性能优化未做
- DSH deny-risk-commands 门禁规则存在误伤面（如 -Format 参数，9/10 已修订 dd/format 但词级匹配仍可能误伤）
- 无 python3 时 grep 回退有引号截断已知 bug（fail-open 语义需文档明确）
- 分发形态：skill 包（skills/agent-risk-guard）+ monorepo；skillhub 发布未做
- 长期 roadmap：JIT 限时放行 / bash AST 角色解析 / 入站 secret 扫描 / hash-chain 审计账本 / prompt injection 检测 / OS 级沙箱指引

## 代码库路径
- 主仓：E:\DeepSeek_Harness\workspace\2026_08_21\agent-risk-guard（git, GitHub satan9394/agent-risk-guard）
- 审计工作区副本：E:\DeepSeek_Harness\workspace\2026_08_21\agent-risk-guard-audit
- packages：core（策略引擎）/ installer（detect+deploy+doctor）/ adapters（各 agent）/ trash / codex / dsh / acs
- assets：hooks（ps1/sh 单源）、opencode、dsh、agy
- 测试：tests/（adversarial、adapter、conformance、e2e、product、release-hardening、acs...）+ skills/agent-risk-guard/tests/（sh/ps1 套件）