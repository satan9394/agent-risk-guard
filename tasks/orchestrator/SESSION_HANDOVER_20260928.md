# 会话交接 · 2026-09-28

> **用途**：上一段对话（2026-09-27 起，@opencode）在防误删门禁项目 `satan9394/agent-risk-guard` 上做了
> 四条 PR 的改造，之后清理上下文。本文件是**给下一个会话（或清理上下文后的自己）的交接单**：
> 先读这里 → 再按「权威记录指针」查细节 → 按「未闭环事项」逐条复核。
> **它不是产品文档**，进 `tasks/`（与 `PRODUCT_STATE.md` / `DSH_RECOVERY_*.md` 同类）；被取代后可移除。

---

## 1. 项目当前状态（2026-09-28 核对）

| 项 | 值 |
|---|---|
| 仓库 | `E:\DeepSeek_Harness\workspace\2026_08_21\agent-risk-guard`（remote `satan9394/agent-risk-guard`） |
| 分支 / HEAD | `main` = **`af57517`**（与 `origin/main` 一致） |
| 版本 / Release | 产品版本 `0.3.2`；**最新 Release 仍是 `v0.3.2`（2026-09-19）**——本次所有改动**未发版、未打 tag**（按用户要求） |
| 本机接线 | 五个 Agent 安装副本**已同步到单源**：`riskguard-wiring-check.ps1`（只读）**exit 0**；已安装 skill 副本 **40 文件**一致 |
| 未提交改动 | 仅 `scripts/riskguard-wiring-check.ps1`（**用户的**改动，mtime 2026-09-24，非本次会话产物）+ 未跟踪的 `pnpm-lock.yaml`。**不要顺手提交或回滚它** |
| 本次会话的临时产物 | `tasks/.tmp/`（被 `.gitignore` 的 `tasks/**/*.tmp` 覆盖）——见 §6 |

**支持面（`packages/installer/compatibility.json` 为准）**：`claude-code` / `opencode` / `codex` / `dsh` / `cursor` /
`windsurf` / `copilot` / `agy` / `grok` / `pi` / **`workbuddy`（本次新增）**。
D 级只在 Windows 有实测的地方给高值；**`workbuddy` 报 windows `D2`、macos/linux `D0`，且**明确不宣称 D3**。

---

## 2. 本次会话做了什么（四条 PR，全部已合并）

| PR | squash commit | 一句话 | 触发原因 |
|---|---|---|---|
| **#30** | `c807d2e` | **R18：五端同源拦「动态调用/间接构造」** | 用户实测：门禁只挡**字面**命令，`$v='Remove-Item'; & $v` 与 `python getattr(...)` 零拦截且**真删盘**（不经回收站） |
| **#31** | `a536d94` | **WorkBuddy 升为一等支持面**（可安装 / 可检测 / 有文档 + D2 证据） | 用户问「朋友用 WorkBuddy 能不能装这个拦截」→ 查明此前「能拦但**装不了**」（`packages/` 零引用，只在维护脚本与注释里） |
| **#32** | `0df141d` | docs：`adding-an-agent.md §2.4`「**同一协议 ≠ 同一种接线**」 | #31 的副产品教训固化，docs-only |
| **#33** | `af57517` | **跨端闸门改为「CI 真跑 + 未执行必须可见」** | #30 复盘发现：`decision-parity` 在 Linux CI 上**永远 SKIP**，而 SKIP 与 PASS 同色 → 跨端从未被验证 |

### #30 的要点（规则面）

- **根因**：单一事实源 `defaultDenyRules()` 的 R4 段**本就有** `& $x` / 拼接命令名两条规则，是 **OpenCode 插件的检测集没跟上**（手写的一套 detector）；另三种（`iex (Get-Content x)`、`[scriptblock]::Create`、Python `getattr`）才是五端共缺。
- **修法**：插件新增 `detectDynamicExec()`，且**必须在完整命令上判定**——`splitStmts` 会把「赋值」与「调用」拆进不同段、`unwrapWrapper` 会吃掉 `iex` 前缀，**按段检测必漏**。core / ps1（段 37）/ sh（段 19）/ DSH patch（R18 段）同源补 5 条；命令位锚定以免误伤 `grep -i iex`。
- **明确保留的残余风险（勿"顺手补齐"）**：`-join` 拼接（`@('Remo','ve-Item') -join ''`）与逐字符构造**不拦**——拦它必须误伤 `@('a','b')` 数组字面量。规则是 **Pattern Policy 不是 Capability Policy**。
- 同轮**顺带修了两个既存发散**：sh 端拼接检测 `tr` 未去换行（`remo\nve-item`）；**sh 端 F18 回收站规则完全缺失**（`Clear-RecycleBin` ps1 deny / sh allow）——此前后者无人发现，因为**语料里根本没有回收站用例**。两处连同 R18 共 **+11 条**进入 `decision-parity` 语料。

### #31 的要点（支持面）

- 按 `docs/adding-an-agent.md` 契约补齐**五件**：注册表（home 相对探针，保证 `--home` 密闭）/ `compatibility.json` / CLI 安装器（`buildInjection` 新增 `home` 参数写绝对落点、`copyArtifacts` 落 ps1 单源）/ runtime-probe+doctor+status / `references/workbuddy.md` + README 中英 + 机制矩阵。
- **关键语义**：WorkBuddy 自带 safe-delete shim，注册命令**必须**带 `RG_ALLOW_DELETE=1`（把删除**委派**给平台），否则「hook 拦下 → 命令不执行 → shim 没机会改道」死锁。委派后**仍拦**不可逆操作（`rm -rf /`、系统目录、`shred`、`wmic shadowcopy`、回收站清空族）。
- **端到端冒烟抓出真 bug**：`installOne` 的 artifact 逻辑**硬编码 `inst.id === 'opencode'`** → 任何其它带 `copyArtifacts` 的 installer 都会「写了 config、artifact 没落盘」。改为按**能力**分派。

### #33 的要点（闸门可见性）

- 两端**平台化解析**：ps1 端**只在 Windows**（`powershell.exe` → `pwsh`；POSIX 默认不跑，需 `RG_PARITY_ALLOW_POSIX_PS1=1`）；sh 端 `wsl.exe` → **Git Bash（显式绝对路径**，PATH 里的 `bash` 是 WSL 的 stub）→ `bash`。诊断写明用的哪两端。
- 解析不到 → 打印 **`CROSS-END GATE NOT RUN（…）`** 并 skip（不再与 PASS 同色）。
- 在 CI 的 `ps1-hook`(windows-latest) 作业**真跑**（补 `actions/setup-node`），**条件触发**：只在引擎文件变更时跑。
- **被 CI 打回一次**：第一版让 POSIX 也解析 `pwsh`，而 **ubuntu runner 预装 pwsh** → Linux 作业真跑全量语料（**6m03s**）并因**环境差异**变红 → 已改为 ps1 端 Windows-only（修后 Linux 作业 25s/23s）。

---

## 3. 验证数字（本次会话产出，均可复现）

| 项 | 结果 |
|---|---|
| 插件纯核离线（R18） | 24 例：**12 拦 / 12 放** |
| ps1 六套（`hook-rules-test` / `hook-fp-regression` / `hook-bypass-regression` / `hook-audit-reregress` / `hook-redact-test` / `agy-hook-test`） | 49/49 · 12/12 · 20/20 · 59/59 · 119/119 · 24/24 |
| sh 四套（WSL） | 70/70 · 40/40 · **208/208** · 34/34 |
| WorkBuddy 专项（`tests/adapter/workbuddy-injection.test.ts`） | **3/3**（含真 spawn 委派矩阵：无害=allow、`Remove-Item`=allow（已委派）、`git reset --hard`=deny、`rm -rf /`=deny） |
| 合并前受影响的测试面 | transaction / release-hardening / e2e / product / compatibility / adapter / installer **109/109** |
| 跨端闸门 · 本机 Git Bash 组合 | 301/301 零分歧（`pass 2 / fail 0`），**42.5 分钟** |
| 跨端闸门 · 本机 WSL 组合 | 301/301 零分歧（`pass 2 / fail 0`），**10.4 分钟** |
| 跨端闸门 · **CI（windows-latest）** | `ps1-hook` **23.2 分钟**（跨端步骤约 **19 分钟**）；`Detect engine changes` 与 `Cross-end parity gate` **均 success** |
| 端到端冒烟（假 home） | `install --agent workbuddy` → *installed 1 artifact(s); runtime self-test PASS*；`doctor` → **PASS workbuddy**；重装幂等；`uninstall` 只摘我方条目 |
| 文档闸门 | `generate-agent-security-matrix --check` / `check-compatibility-docs` / `check-decisions-log` 全过 |
| 巡线 | `riskguard-wiring-check.ps1`（只读）**exit 0** |

---

## 4. 本机接线状态（要复核时看这些地方）

- **Claude Code**：`~/.claude/hooks/dangerous-commands.ps1` + `~/.claude/settings.json` 的 `hooks.PreToolUse`
- **Codex**：`~/.codex/hooks/dangerous-commands.ps1` + `~/.codex/hooks.json` + `~/.codex/config.toml [hooks]`
- **agy**：`~/.gemini/config/hooks/dangerous-commands.ps1` + `agy-dangerous-commands.ps1` + `hooks.json`（**引擎按优先级探测**）
- **WorkBuddy**：`~/.workbuddy/hooks/dangerous-commands.ps1` + `~/.workbuddy/settings.json`（注册命令**必须**含 `RG_ALLOW_DELETE=1`）
- **OpenCode**：`~/.config/opencode/plugins/agent-risk-guard.ts`（V1+V2 双入口；**与单源逐字节相同**）
- **DSH**：`~/.dsh/profiles/{headless,web}/cordis.patch.yml`（均 **74 条**与单源一致）
- **已安装 skill 副本**：`~/.claude/skills/custom/agent-risk-guard-audit`（40 文件；由巡线逐文件比对并回灌）

> ⚠️ **单源改动会在约 5 分钟内被计划任务 `RiskGuard_WiringCheck` 自动推上生产** —— 改这个仓库要按「每次编辑都算发布」来做。
> ⚠️ 巡线的 `-Fix` 会**从单源覆盖**安装副本并备份到 `~/.risk-guard-backup/`。

---

## 5. 未闭环事项（复核从这里开始）

1. **跨端闸门的 CI 时长观察**：每次「碰引擎」的 PR 都会多约 **19 分钟**（windows 作业）。
   若嫌长，可选优化是「**一次 bash 会话批量喂载荷**」——但那会**换掉闸门"逐条真实 spawn"的设计前提**，
   属**独立决策**，不要顺手改。（已记入 `docs/decisions.md` 的 R18/跨端行与归档 `DECISIONS.md` D-0054。）
2. **WorkBuddy 的 D3 未取**：需要一个**真实 WorkBuddy 会话**（一条危险命令被拒 + 一条安全命令放行，附原始输出）。
   ⚠️ 2026-09-21 那次真实会话**早于 R18**，**不能**当依据（已在 `compatibility.json` / CHANGELOG / `references/workbuddy.md` 三处写明）。
3. **用户那份未提交的 `scripts/riskguard-wiring-check.ps1`**（mtime 2026-09-24）：本次全程**未动、未提交**。
   它是本机巡检/自愈的增强（YAML 校验 + N3 恢复）。是否合并由用户定。
4. **`~/.config/opencode/AGENTS.md` 与其余四份规则文件不再逐字同步**（新增 OpenCode 专属 MCP 小节所致，属**有意例外**，见归档 `DECISIONS.md` D-0053）。
5. **归档仓库侧**（`E:\Code_file\Claude_code`）：本次会话的日记与决策已写入 `Notes/2026/09/NOTES_20260927.md`
   与 `Notes/DECISIONS.md`（**D-0050** R18 / **D-0051** WorkBuddy 委派 / **D-0054** 跨端闸门）。

---

## 6. 本次会话的临时产物（`tasks/.tmp/`，可复用；被 gitignore）

| 文件 | 用途 |
|---|---|
| `probe-dyndel.mjs` | 把待测命令喂给 OpenCode 插件**纯检测核心**做离线判定（24 例，不执行任何命令） |
| `rg-parity-r18.mjs` | **定向**跨端比对（20 例 R18/F18，ps1 vs WSL，约 1 分钟）——就是它抓到了 sh 端两处发散 |
| `rg-verify.ps1` | 单源同步 + 全部套件 + 巡线的一键复验 |
| `rg-payload-verify.ps1` | 给**已安装**的 hook 副本喂载荷（claude-code / codex / workbuddy 各 10/10） |
| `rg-append-dsh-r18.ps1` | 把单源 R18 规则追加进 DSH headless profile（先备份；**必须在 `pwsh` 下跑**，PS 5.1 读不了 UTF-8 无 BOM 脚本） |
| `gitbash-probe.sh` / `gitbash-nopython-probe.sh` | 预验 Git Bash 能否跑 sh 引擎（含 `python3` 缺失时的 grep 兜底） |
| `dp-*.log` | 各次跨端跑批输出（含 CI 组合 42.5 min 与 WSL 10.4 min 两次） |

---

## 7. 权威记录指针（细节以这些为准，本文件只是索引）

- `docs/decisions.md` B 表末四行（R18 / WorkBuddy / 跨端闸门 / 更早的 skill 镜像）
- `CHANGELOG.md` `[Unreleased]`（含逐套测试数字与「未取 D3」的说明）
- `docs/adding-an-agent.md` **§2.4**（同协议 ≠ 同接线；含 `installOne` artifact 那条坑）
- `skills/agent-risk-guard/references/workbuddy.md`（接线示例 + 委派语义 + 陷阱）
- `packages/installer/compatibility.json`（D 级单一事实源）· `docs/generated/agent-security-matrix.md`（自动生成）
- 归档侧：`E:\Code_file\Claude_code\Notes\2026\09\NOTES_20260927.md`（含 5 条教训）与 `Notes/DECISIONS.md` D-0050/0051/0054

---

## 8. 复核清单（建议按序执行）

```powershell
cd E:\DeepSeek_Harness\workspace\2026_08_21\agent-risk-guard

# 0) 现状
git log --oneline -4 ; git status --short

# 1) 巡线（只读）：五端 + skill 副本是否仍与单源一致
& powershell -NoProfile -ExecutionPolicy Bypass -File scripts\riskguard-wiring-check.ps1   # 期望 exit 0

# 2) 定向跨端（约 1 分钟；比全量快，抓单端漂移够用）
node tasks/.tmp/rg-parity-r18.mjs                                                          # 期望 ALL PASS (20)

# 3) 插件纯核离线
node tasks/.tmp/probe-dyndel.mjs                                                           # 期望 ALL PASS (24)

# 4) WorkBuddy 专项 + 端到端冒烟（假 home，不动真实配置）
node --test tests/adapter/workbuddy-injection.test.ts

# 5) 文档闸门
node scripts/generate-agent-security-matrix.ts --check
node scripts/check-compatibility-docs.ts
node scripts/check-decisions-log.ts

# 6) 全量跨端（可选，约 10 分钟走 WSL / 约 42 分钟走 Git Bash）
node --test packages/core/test/decision-parity.test.ts
```

**判读要点**：
- 第 2/6 步输出里的 `ends: ps1 via … + sh via …` 会告明用的哪两端；若出现 `CROSS-END GATE NOT RUN` 说明**这条红线没跑**（不是通过）。
- 改过引擎文件后，**必须**在能同时跑两端的环境复跑第 2/6 步；只看 CI 的 Linux 作业绿**不算**。
- 若第 1 步报漂移，用 `-Fix`（会备份到 `~/.risk-guard-backup/`）后再复核一次。
