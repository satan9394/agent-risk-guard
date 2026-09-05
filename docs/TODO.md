# TODO — 待办清单

> 待确认 / 待执行事项。**发布类、生产同步类动作一律等用户确认后执行**；完成后勾选。
> 对应仓库：https://github.com/satan9394/agent-risk-guard

## 待用户确认（阻塞中，2026-08-29 R3 生态融合）

- [ ] **生产 skill 目录同步（R3）**：生产 `C:\Users\Satanchen\.claude\skills\custom\agent-risk-guard-audit\` 的 `assets/dsh/deny-risk-commands.patch.yml` 35 → 47 条（解释器 one-liner / git 破坏清单 / Windows wrapper），同步仓库最新 patch 与文档
- [ ] **DSH 门禁同步（R3）**：`~/.dsh/profiles/web/cordis.patch.yml` 的 deny-risk-commands 35 → 47 条，让新规则在 pre-execute 门禁真实生效（当前生产仍是旧版 35 条）

## 已授权可执行（待安排）

- [ ] **GitHub Release 页面**：`v1.0.0` 目前只有 git tag，无 Release 页面（建议带 CHANGELOG 摘要发布）；v0.2.0 tag 已推送，Release 页面待建（Pre-release）
- [ ] **macOS / Linux trash 实测**：trash 包 macOS/Linux 分支为 D1（文档级），待真实环境验证
- [ ] **Codex D3 实测**：codex 额度恢复后做真实会话删除拦截验证

## v0.2.0 遗留（下一阶段，见 docs/devlog-2026-09-05-v0.2.0.md）

- [ ] **真实 Agent D3 Conformance（P1 顺序 §二十八）**：基于统一 Conformance Framework（C1–C10）对 Cursor / Copilot CLI / Windsurf 做真实会话执行；Cursor 先做 official payload fixture → adapter contract test → conformance harness（§二十九）
- [ ] **Copilot CLI machine Policy Hook PoC**：system policy（`/etc/github-copilot/policy.d/` / `C:\ProgramData\GitHub\Copilot\policy.d\` / Registry）→ RiskGuard Machine Guard（§三十，本轮只预留 policyScope）
- [ ] **MCP canonical capability 深化**：`mcp.invoke` 从近似映射升级为一等 capability（server/tool identity，tool poisoning 门禁，P1）
- [ ] **Gemini BeforeTool adapter（D2）**：P2 顺序（§二十八）

## 长期（roadmap，见 docs/ecosystem-benchmark.md）

- bash AST 角色解析（allowlister 式：管道过滤命令按角色判定）
- 入站 secret 扫描 + commit 时 staged diff 扫描
- JIT 限时放行（被拦请求申请 15min/1h/session 放行）
- hash-chain 审计账本（防篡改日志链）
- prompt injection 检测（工具输出 / 抓取内容扫描）
- OS 级沙箱指引（Windows 可行方案：受限账号 / WSL 容器）
