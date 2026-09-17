# CLI Reference — `riskguard`

> README 只保留最短上手路径（`bootstrap` → `install` → `doctor`）。本文件是完整命令手册：
> 全部子命令、选项、退出码契约，以及事务式安装器的语义。

## 运行方式

要求 **Node >= 22.18**，零依赖、零构建。仓库内统一入口：

```bash
node bin/riskguard.mjs <command> [options]
```

等价于 `node packages/cli/src/index.ts`（用户不需要面对内部源码路径）。子命令一览用
`node bin/riskguard.mjs help` 查看。

---

## 0. `bootstrap` — 安装可移植运行时（推荐先做）

把运行所需的最小文件集装进 `~/.riskguard/runtime/<version>/`，此后 Agent 的 hook/插件指向 runtime，
**而不是 git clone 路径**——删除或移动源码仓库后 RiskGuard 仍然工作。

```bash
node bin/riskguard.mjs bootstrap          # 首次安装 portable runtime
node bin/riskguard.mjs bootstrap --force  # runtime 损坏时修复重装
```

> 分发/自包含模式：`node scripts/build-release.ts` 产出 `dist/agent-risk-guard-v<version>/`
> （含 `bin/riskguard.mjs` launcher、`runtime-manifest.json`、`SHA256SUMS.txt`）。
> 该 artifact 可在 fake HOME 中独立完成 detect / install / doctor / uninstall，不依赖源码仓库。

## 1. `detect` — 只读检测本机装了哪些 Agent

不改动任何配置。

```bash
node bin/riskguard.mjs detect          # 人类可读
node bin/riskguard.mjs detect --json   # 完整布尔表
```

覆盖 Claude Code / Codex / OpenCode / DSH / Hermes / AGY / Cursor / Windsurf / Grok /
Copilot CLI / Cline / Aider / Goose。

## 2. `status` — Runtime 状态与产品能力等级

```bash
node bin/riskguard.mjs status
```

区分两个概念：

- **Capability** —— 产品对该 Agent 支持到 D0–D4，来自单一事实源 `packages/installer/compatibility.json`。
- **Runtime** —— 这台机器的实际状态：`NOT_DETECTED` / `DETECTED` / `INSTALLED` / `ACTIVE` / `BROKEN`。
  **`ACTIVE` 表示完整 runtime self-test 通过**（真实 spawn hook：无害载荷 allow、危险载荷 deny），
  而不是"配置里有一段字符串"。

## 3. `doctor` — 健康检查

PASS / WARN / FAIL / SKIP。**未安装的 Agent 计 SKIP、不算 FAIL**；FAIL 行尾附带可直接执行的修复提示。

```bash
node bin/riskguard.mjs doctor
node bin/riskguard.mjs doctor --json   # {pass,warn,fail,skip,exitCode,checks}
```

doctor 不只查"存在"，还查**新鲜度**：比对规则条数与 hook 脚本 SHA256 是否与单一规则源一致，
不一致报 WARN。

## 4. `install` — 安装 / 修复（事务式、非破坏性）

```bash
node bin/riskguard.mjs install --dry-run            # 只显示将改什么，不落盘
node bin/riskguard.mjs install                      # 交互式：列出已检测 Agent 供编号勾选
node bin/riskguard.mjs install --all                # 跳过交互，全装已检测到的
node bin/riskguard.mjs install --agent claude       # 只装一个（cc / claude / claude-code 等价；oc = opencode）
```

**事务流程**：类型化读取 → backup → merge → manifest → runtime self-test → commit，
任一步失败**回滚到安装前**（含旧 manifest 恢复），不留半成品。

**非破坏性保证**：

- merge 只"加入"，保留用户已有字段（不 replace）；
- 配置损坏 / 无权限 / IO 错误 → 立即终止且**零写入**，绝不覆盖无法确认内容的用户配置；
- OpenCode 插件目标同名但内容非我方（SHA256 不符）→ 拒绝安装、零覆盖。

**repair 语义**：manifest 存在但 wiring 损坏（`BROKEN`）时，install 会识别为 **repair**
（输出 `repaired successfully`）并恢复到 `ACTIVE`；仅"无改动 + 健康 ACTIVE"才报 `already installed`。

**交互与非交互**：无 `--agent` 时列出已检测 Agent 供编号选择（`1,3` / `all` / 回车默认全装）；
非 TTY / 管道 / 超时 / EOF 一律回退"默认全装"，**绝不挂起**。`--all` / `--yes` 跳过交互。

## 5. `uninstall` — 精确逆操作

```bash
node bin/riskguard.mjs uninstall --dry-run
node bin/riskguard.mjs uninstall
```

只移除 RiskGuard 注入的条目，**保留用户 install 之后新增的配置**；被用户改过的 RiskGuard 文件
不会自动删除；manifest 缺失时提示 `nothing to do`，不会误删。

## 6. `acs evaluate` — OWASP ACS 边界协议

```bash
cat tests/fixtures/acs-v0.1/git-reset-hard.json | node bin/riskguard.mjs acs evaluate
cat tests/fixtures/acs-v0.1/shell-safe.json     | node bin/riskguard.mjs acs evaluate --audit
cat request.json  | node bin/riskguard.mjs acs evaluate --profile strict
cat envelope.json | node bin/riskguard.mjs acs evaluate --wire   # 官方 ACS v0.1.0 JSON-RPC wire 模式
```

- `acs evaluate` = payload 兼容模式；`acs evaluate --wire` = 官方 ACS v0.1.0 schema 一致的 wire 模式
  （Request Envelope → Response Envelope）。
- 非法输入不抛 stack trace：payload 模式输出 `decision: deny` +
  `extensions.riskguard.degraded = true`；wire 模式输出 JSON-RPC error（`-32700` / `-32600` / `-32602`）。
- 官方 OWASP ACS v0.1.0 JSON Schema 已 pinned 于 `tests/vendor/owasp-acs-v0.1.0/`（只读），是 Release Gate。

设计边界见 [acs-alignment.md](acs-alignment.md)。

---

## 退出码契约（脚本 / CI 可依赖）

`riskguard help` 亦列出。

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功。含 doctor 有 WARN 但无 FAIL、install 幂等（`already installed`）、卸载一个「本来就没装」的 agent。**hook 运行时（无子命令：stdin JSON → decision JSON）恒为 0**——allow 与 deny 都是正常决策，空输入 / 坏 JSON 的 fail-closed deny 也不是错误（Claude Code / Codex 集成依赖此行为）。 |
| `1` | 失败。doctor 有 ≥1 个 FAIL；install 被中止（配置损坏 / 插件同名异内容）、回滚或 runtime self-test 未通过、显式指定的 agent 未安装；uninstall 被拒或失败；bootstrap 失败。 |
| `2` | 用法错误。未知子命令（输出 `Unknown command: …` + help 提示，**不再**静默落入 hook 运行时）；install / uninstall 指定了未知或本 CLI 不支持的 agent。 |

例：`node bin/riskguard.mjs doctor || echo "RiskGuard 未生效"`。

## 底层入口（stdin JSON → Decision JSON）

除 CLI 子命令外，运行时本身接受 stdin 的 JSON 并返回决策 JSON——这是各 Agent hook 实际调用的形态：

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"rm -rf /tmp/x"}}' | node bin/riskguard.mjs
```

Windows PowerShell：`Get-Content payload.json -Raw | node bin/riskguard.mjs`。

## 接线巡检（日常治理）

安装后建议定期确认"接线还在位、脚本仍与单一规则源一致"。Claude Code 的 `PreToolUse` 就曾
**被外部工具还原丢失**，而当时 hook 文件在位、哈希正确、套件全绿，防护却在静默失效。

```powershell
# 只读巡检（缺失/漂移时退出码非 0，逐项输出 [OK]/[!!]）
pwsh scripts/riskguard-wiring-check.ps1

# 巡检 + 自愈（从仓库单源恢复；恢复前自动备份到 ~/.risk-guard-backup/）
pwsh scripts/riskguard-wiring-check.ps1 -Fix
```

检查范围：三处 ps1 生产接线与仓库单源的哈希一致性、OpenCode 插件、DSH patch，
以及 `settings.json` / `hooks.json` / `config.toml` 的接线在位。
