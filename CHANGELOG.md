# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [SemVer](https://semver.org/lang/zh-CN/)。所有日期均为 UTC。

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
