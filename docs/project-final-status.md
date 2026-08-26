# Universal Agent Risk Guard — 项目最终状态（2026-08-24）

> 汇总 monorepo + skill 发布包 + 生产部署现状，作为项目导读。
> 深度细节：`Universal Agent Risk Guard.md`（架构）、`HANDOFF.md`（进度）、
> `docs/deployment-status.md`（生产接线）、`docs/gan-audit-fix-map.md`（审查修复映射）。

## 一、里程碑完成度

| Milestone | 内容 | 状态 |
|-----------|------|------|
| M0 | 架构冻结（v3 文档 2306 行，30 节） | ✅ |
| M1 | Core（normalize/policy-engine/path-resolver/taxonomy/audit） | ✅ 29 测试 |
| M2 | CLI + DSH Adapter（D2 实证）+ @riskguard/dsh 插件 | ✅ 插件 6+3 测试 |
| M3 | Hook Family（claude/cursor/grok/windsurf） | ✅ 13 测试 |
| M4 | Plugin Family（opencode） | ✅ 4 测试 |
| M5 | Codex rules-compiler（AGENTS.md 单一事实源） | ✅ 3 测试 |
| M6 | Installer（discovery/deploy/backup/rollback/doctor） | ✅ 5 测试，本机 14 类 agent 只读实测 |
| M7 | D4 对抗语料 + 行为级加固 | ✅ 语料 70+ 条，19 组全绿 |

## 二、测试体系（test-all.ps1，19 组全绿）

core/policy 13 + normalize 19 + junction 1 + fuzz 3 + e2e 7 + adapters M3 13 + M4 6 +
trash 2 + corpus 5 + alignment 1 + installer 5 + codex 3 + dsh plugin 6 + guard 3 +
hook pipeline 16 + bypass 16 + FP 5 + audit-reregress 41 + hook sh 56。

## 三、GAN 对抗审查轨迹（独立判别器，maker-checker 铁律）

| 对象 | 轮次 | 评分轨迹 | 关键修复 |
|------|------|---------|---------|
| monorepo classify/policy | 2 轮 | 4/10 → 7.5/10 | 完整路径/包裹/编码/动态执行/git 破坏/磁盘全 P0 |
| hook 脚本（真实生产门禁） | 4 轮 | 4/10 → 7/10 → 8/10 | git 整类/管道/子展开/IEX/subprocess/wmic/truncate/docker；echo/print 误伤 |
| 报告 | — | 3 份 | REPORT / ROUND3 / ROUND4（skill tests/ 下） |

修复后独立复评验证全部落地；剩余为诚实声明的正则局限（变量展开/npm cache/rm 独参/python print 需 AST 或沙箱）。

## 四、生产部署现状（2026-08-24 实测）

| Agent | hook 状态 | 证据 |
|-------|----------|------|
| Codex | ✅ PreToolUse 已注册且**真实生效** | hook-calls.log 2026-08-23 deny rm -rf |
| Claude Code | ⚠️ 仅 Setup hooks，**无删除拦截**，bypassPermissions | settings.json 实测（真实敞口） |
| DSH | ✅ pre-execute 门禁（35 条 patch，热加载） | deny-risk-commands 插件（30→35 条） |
| OpenCode | ✅ tool.before 插件（440 行） | 2026-08 实测 |

生产 hook 脚本（codex/CC 两处）为 08-23 版，落后工作区单源（R2~R4 + BOM + 误伤修复），待用户确认同步。

## 五、代码资产

- monorepo：`agent-risk-guard/`（67 文件，packages/core|cli|adapters|trash|installer|dsh|codex + tests + docs）
- skill 发布包：`agent-risk-guard-audit/`（25 文件 + zip 59589B；工作区副本 = 待同步单源）
- 交付目录：`E:\Code_file\Claude_code\2026\08\22\agent-risk-guard-audit-skill\`
- 关键文档：`docs/dsh-api-evidence-d2.md`（DSH 契约实证）、`docs/gan-audit-fix-map.md`（修复映射）、`docs/deployment-status.md`（同步清单）

## 六、遗留（按优先级）

1. ~~生产同步~~ → ✅ 已完成（2026-08-25，用户确认）：DSH patch 35 条、codex/CC hook 覆盖、CC PreToolUse 接线、opencode 插件注册、skill 生产目录、skill_routes 补录
2. ~~真实会话 D3 收尾~~ → ✅ CC/OC/DSH 三 Agent 删除测试实证完成（`docs/d3-deletion-test-3agents.md`）；codex 会话待额度恢复
3. **可选**：skillhub 发布（skillhub.cn）、macOS/Linux trash 实测（跨平台）、tavily/exa MCP 三 Agent 配置（oc/cc 完成、dsh 待重启 web 生效）

## 七、验证等级汇总

- D2 实证：DSH API（pre-execute/guard，源码级）
- D3 实测：trash Windows 回收站、junction 逃逸、hook 管线、codex hook 真实 deny 记录、**三 Agent 删除测试（CC/OC/DSH，模型层+机器层拒绝永久删除，`docs/d3-deletion-test-3agents.md`）**
- D4 加固：70+ 条对抗语料 + 4 轮 GAN 审查闭环