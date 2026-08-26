# 贡献指南

感谢你愿意为 **@riskguard（Universal Agent Risk Guard）** 贡献代码。这个项目拦截的是「危险命令」——这意味着我们对自己代码的要求比普通项目更严：**任何一处放行都可能是真实环境里的数据损失**。

请先读完本指南与 [SECURITY.md](SECURITY.md)，再动手。

## 项目形态速览

- 纯函数内核在 `packages/core/`（无副作用、可单测），所有 Agent 适配层只是把平台事件翻译成内核输入。
- **单一事实源**：危险规则以 `defaultDenyRules()`（core）为唯一真源，skill 侧规则、各 hook/插件规则通过 `rule-alignment` 测试锁定一致。改规则必须同步改测试。
- 运行时：Node >= 22.18（原生 TS，零构建）；Windows 为主，macOS/Linux 覆盖由 `trash` 包与 `sh` hook 承担。

## 开发环境

```powershell
# 依赖 Node >= 22.18
node --version

# 跑全量测试（22 组，含对抗语料与回归）
& .\test-all.ps1

# 单组测试
node --test packages/core/test
```

## 提交前检查清单

1. `& .\test-all.ps1` 全绿（新增行为必须有对应测试，不允许只改代码不补测试）。
2. 新规则必须同时落入：core 的 `defaultDenyRules()`、对应 hook/插件、`rule-alignment` 测试与对抗语料（`tests/adversarial/`）。
3. 核心包保持纯函数：不要引入文件系统、网络、随机等副作用。
4. 删除类行为必须走向「回收站」语义（trash），**永远不要**提供「彻底删除」的便捷路径。
5. 敏感信息（API key、token 样本）不得进入代码、文档或测试载荷；测试里的凭据一律用占位符。

## 工作流

1. 先开 issue 描述问题/提案（含复现载荷与期望行为），等维护者回应。
2. `fork` 本仓库，从 `main` 切分支，命名建议 `fix/xxx` 或 `feat/xxx`。
3. 提交信息用简洁祈使句（如 `fix(core): normalize fullwidth rm variants`），可参考 Conventional Commits。
4. 开 PR 时说明：改动动机、测试结果、以及**对既有规则的影响面**（是否可能误伤合法命令）。
5. 维护者会用对抗性视角审查（本项目有独立判别器复审传统），可能要求补充绕过向量用例——这是流程的一部分，不是刁难。

## 规则设计原则（很重要）

- **fail-closed**：解析失败、路径解析失败 → 拒绝，而不是放行。
- **不承诺正则即边界**：规则是 Pattern Policy 不是 Capability Policy；绕过向量请直接报告到 SECURITY，而不是私下修补。
- **防绕过分层**：全角字符/Unicode 变体、引号插词、`$()`/反引号、base64 管道、路径穿越（`..`、junction/symlink 逃逸）都是已知攻击面，新增规则要主动覆盖。
- 宁可多拦一次（可人工放行），不可漏拦一次（不可恢复）。

## 其他

- 行为问题/用法问题先查 `docs/`（deployment-status、adapter-contract、d3-deletion-test-3agents）。
- 安全问题**不要**走 issue，走 [SECURITY.md](SECURITY.md)。
