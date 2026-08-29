# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [SemVer](https://semver.org/lang/zh-CN/)。所有日期均为 UTC。

## [Unreleased] - R3 生态融合

对标 GitHub 同类项目（allowlister / CC Safety Net / claude-guardrails / agent-safety-pack / Relay / SecureVector）后的经验融合，详见 `docs/ecosystem-benchmark.md`。

### Added

- **解释器 one-liner 检测**：`python -c 'os.system("rm -rf /")'`、`node -e fs.rmSync`（含 `require("fs")` 形态）、`perl -e unlink`、`ruby -e File.delete` 内嵌删除识别（core `classifyShellCommand` + 规则集）
- **shell wrapper 递归解包**：`unwrapShellWrapper()`（bash/sh/zsh/dash/pwsh/powershell `-c`、`cmd /c`、`pwsh -Command`，深度上限 5）；`bash -c 'git reset --hard'` 等包裹形式不再漏拦，安全包裹（`bash -c 'echo hi'`）不误伤
- **Secret Redaction**：`redact.ts`（`redactSecrets` / `redactJsonValue`），审计序列化 `auditToJson` 出口自动脱敏 token/API key/私钥/口令
- **敏感路径分类**：`classifySensitivePath()`（.ssh / .env / .aws / .kube / .npmrc / .git-credentials / 私钥 / .pem / credentials），供 read/write 门控
- **规则集 35 → 47 条**：补全 git 破坏命令清单（`push --force`（`(?!-)` 排除 `--force-with-lease` 误伤）、`branch -D`、`checkout --`、`restore`、`stash drop/clear`、`switch --discard-changes`、`worktree remove --force`）+ 解释器 one-liner + Windows wrapper（`cmd /c`、`pwsh -Command`）规则
- **规则自带测试用例**：`tests/adversarial/rule-self-test.test.ts`（每条 R3 新增规则 positive/negative 样例 + classifyShellCommand 联动断言）
- **核心单元测试**：`packages/core/test/ecosystem-fusion.test.ts`（redact / sensitive-path / unwrap）

### Security

- 规则 patch 与 `defaultDenyRules()` 单一事实源同步（rule-alignment 动态计数，YAML `''` 转义提取支持）
- 全量测试 18 文件 134/134 通过（本机；Windows trash/junction 真实执行 0 skipped）

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
