# TODO — 待办清单

> 待确认 / 待执行事项。**发布类、生产同步类动作一律等用户确认后执行**；完成后勾选。
> 对应仓库：https://github.com/satan9394/agent-risk-guard

## 待用户确认（阻塞中，2026-08-29 R3 生态融合）

- [x] **生产 skill 目录同步（R3）**：生产 `C:\Users\Satanchen\.claude\skills\custom\agent-risk-guard-audit\` 的 `assets/dsh/deny-risk-commands.patch.yml` 35 → 47 条（解释器 one-liner / git 破坏清单 / Windows wrapper），同步仓库最新 patch 与文档（2026-09-10 已同步至 69 条新版，四处副本哈希一致）
- [x] **DSH 门禁同步（R3）**：`~/.dsh/profiles/web/cordis.patch.yml` 的 deny-risk-commands 35 → 47 条，让新规则在 pre-execute 门禁真实生效（2026-09-10 已升至 69 条含 dd/format 修订，热加载生效）

## 已授权可执行（待安排）

- [x] **GitHub Release 页面**：v0.2.0（2026-08-21 补建，Pre-release）与 v0.2.1（ACS Schema Conformance Patch，Pre-release）已创建；`v1.0.0` 仍只有 git tag，无 Release 页面（建议带 CHANGELOG 摘要发布）
- [ ] **macOS / Linux trash 实测**：trash 包 macOS/Linux 分支为 D1（文档级）。**2026-09-10 WSL Ubuntu + Git Bash 双环境已实测 hook 规则集（见 tasks/t1-wsl-report.md、tasks/t2-gitbash-report.md，299/299 用例全过）**；macOS 真机 trash 命令实测仍待补。
- [x] **Codex D3 实测**：2026-09-07 CLI 真实会话 git reset 拦截 PASS；2026-09-10 用户语音会话实测 Remove-Item 永久删除被 PreToolUse hook 明确拦截（文件保留），删除类 D3 证据链闭合（已补录 compatibility.json）
- [x] **WSL + Git Bash 跨平台测试与修复（2026-09-10）**：sh Linux hook 在 WSL Ubuntu（真 Linux，299/299）与 Git Bash（MINGW64，修复后 299/299）全量验证；发现并修复 P0 全角 NFKC 编码绕过（PYTHONUTF8）、git checkout--/restore/git rm/perl-ruby 规则缺口、grep 回退死代码 fail-open；ps1/opencode 同步补齐，deploy/dsh patch 原本已覆盖；回归用例已进三套件。报告：tasks/t1-wsl-report.md、tasks/t2-gitbash-report.md（含修复记录）。
- [ ] **hook 性能优化（Git Bash 4-5s/次）**：合并 hook 内多次 python3 spawn 为单次调用（Git Bash 下实测单次 4.0-5.6s vs WSL 0.2s，慢 20-28 倍）；已文档标注延迟预算，待接入方确认是否优化。

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
