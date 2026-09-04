# 安全策略

**@riskguard 的本质是一个安全组件**：它拦截 AI Agent 的危险命令，防的是真实的数据损失。因此我们对待漏洞报告的态度是：任何绕过向量都是 P0 级问题，请优先通过私密渠道报告，不要公开 issue 或 PR 演示利用方式。

## 受支持的版本

| 版本 | 支持状态 |
|------|----------|
| 0.x（当前开发主线，`v0.1.2 Developer Preview`） | ✅ 积极维护，欢迎报告绕过向量 |
| 1.0.0（历史里程碑标记） | ⚠️ 仅安全修复（历史 Git tag，见 CHANGELOG 说明） |

## 报告方式（首选私密渠道）

1. **GitHub 私密漏洞报告**（推荐）：在仓库页面打开 **Security → Report a vulnerability**，填写复现载荷与影响描述。该报告对公众不可见，直达维护者。
2. 邮件：`2695194221@qq.com`（主题前缀 `[SECURITY]`）。仅在你无法使用 GitHub 时使用。

请在报告中包含：

- 受影响组件（core / cli / dsh 插件 / claude hook / codex hook / opencode 插件 / trash）
- 完整复现载荷（危险命令原文 + 平台 + 版本）
- 期望行为 vs 实际行为
- 是否已在生产环境触发（本机 DSH/CC/OC/Codex 门禁是否被绕过）

## 响应承诺

- 24 小时内确认收到报告。
- 72 小时内给出初步判定（可复现 / 需更多信息 / 非漏洞）。
- 确认后优先修复，修复完成前**不公开披露**；修复发布后再在 CHANGELOG 中致谢（若报告者同意署名）。

## 已知攻击面（报告前可自查，也欢迎补充分类）

- Unicode/全角字符变体（`ｒｍ　－ｒｆ`）
- 引号插词、`$()`/反引号/`eval`/`bash -c`/`sh -c` 包裹
- base64/编码管道、`xargs -0`、两阶段「写文件再执行」
- 路径穿越与符号链接逃逸（`..`、junction/symlink、`resolveReal` 覆盖范围）
- 进程内动态执行（`subprocess`、`__import__`、`execSync`、`child_process`）
- 磁盘破坏类（`mkfs`、`dd`、`wipefs`、`diskpart`）、注册表与证书（`reg delete`、`certutil`）、容器逃逸（`docker run|exec`）、git 历史销毁（`git gc --prune`、`reflog expire`、`push --force`）
- 非字符串/畸形 payload 对 hook 解析器的行为（应 fail-closed）

## 披露政策

- 修复发布前：仅维护者与报告者知情。
- 修复发布后：随版本发布披露摘要（向量类别、影响、修复方式），不贴完整利用链（若攻击面仍未完全封死）。
- 我们不提供漏洞赏金，但会在 CHANGELOG / README 致谢页署名（可匿名）。
