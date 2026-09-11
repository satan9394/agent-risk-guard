# SUBAGENT-C — agent-risk-guard 架构/DX 审计报告

- 审计人：Subagent-C（只读，未改任何代码）
- 时间：2026-08-21（会话内 40 分钟限时）
- 范围：packages/ 模块边界、installer detect/deploy/doctor、单一规则源纪律（ps1/sh/opencode/dsh patch/deploy.ts 多副本 + M7）、CLI DX、技术债（重复实现/副本漂移/dist 快照）、跨平台系统级问题
- 方法：读 PROJECT_BRIEF → 全仓文件枚举 → 关键文件精读 → SHA256 副本比对 → git 追踪状态核查 → CI 覆盖核查；审计期间一次探测命令被本机 RiskGuard deny-risk-commands 门禁拦截（dogfood 事故，佐证 F2 的 fail-open/fail-closed 议题真实存在）

---

## 总览（10 条，按优先级）

| # | 优先级 | 一句话 |
|---|--------|--------|
| F1 | P0 | 同一规则集存在 5+ 种独立实现（YAML/TS/ps1×3/sh/opencode TS），M7 只锁 2 处 |
| F2 | P0 | sh hook 无 python3 时 fail-open（静默放行）+ grep 引号截断已知 bug |
| F3 | P1 | doctor 只查「在场」不查「新鲜度」，stale 状态是死代码 → 陈旧防护报 ok |
| F4 | P1 | ps1 防线（用户主力平台 Windows）零 CI 覆盖；跨平台 CI 只有 macOS+ubuntu |
| F5 | P1 | 维护/测试代码写死本机绝对路径（wiring-check、opencode-extract、rule-alignment） |
| F6 | P1 | "packages" 是名义分包：跨包相对路径 import 裸 .ts，无依赖声明，版本号撒谎 |
| F7 | P2 | 三套 ps1 规则引擎并存 + 头注释自指混乱，universal 不在任何对齐检测内 |
| F8 | P2 | hook 性能：sh 每调用 3× python3 spawn + ~25× grep（Git Bash 4-5s vs WSL 0.2s） |
| F9 | P2 | CLI 口径不一致：detect 12 家 / install 只 3 家 / doctor 4 项，agy 注入无检查 |
| F10 | P3 | dist/ 4 版快照 + 4 tarball ≈1.6MB 常驻，无清理策略 |

---

## F1（P0）规则集多副本是 5 种独立实现，M7 只锁 2 处，漂移无检测

**问题**：同一条安全规则（如 R4 反引号插词 rm、Clear-RecycleBin）以 5 种不同方言独立维护，对齐测试只覆盖其中 2 处；其余副本的漂移静默发生，直到下次对抗审计才被发现。

**证据**：
- 规则实现副本清单（SHA256 比对 + 内容探针）：
  - `assets/dsh/deny-risk-commands.patch.yml`（YAML `re:` 字符串；23 处 R4/2026-09-10/recycle 标记）
  - `packages/installer/src/deploy.ts:26-97` `defaultDenyRules()`（TS 正则数组；注释自称「对齐 patch R4 段，M7 单一事实源防漂移」）
  - `skills/agent-risk-guard/scripts/dangerous-commands.ps1` 与 `assets/hooks/dangerous-commands.ps1`（SHA256 一致 = 同一份；ps1 `-match '(?i)...'` 方言）
  - `skills/agent-risk-guard/scripts/dangerous-commands.sh`（`grep -qE` 方言，32 条独立正则）
  - `assets/opencode/agent-risk-guard.ts`（JS 正则方言；与 skill 侧 `scripts/opencode/destructive-operation-guard.ts` diff 95 行，579 vs 520 行，是两份不同文件）
  - `packages/codex/src/rules-compiler.ts:11`（从 `core/default-policy.ts` 编译自然语言 — 这是第四套来源）
  - `skills/agent-risk-guard/sync-prod.ps1:18-24` 内联硬编码 5 条 R2 正则追加生产 patch
- M7 对齐测试仅一处：`tests/adversarial/rule-alignment.test.ts:26-40`，只比较 **patch.yml ↔ deploy.ts** 两条（逐条 set 比对）。全仓无任何测试比对 ps1/sh/opencode/rules-compiler 与这两条的一致性（grep `dangerous-commands.ps1|assets.hooks` 于 tests/ 零命中）。
- `scripts/riskguard-wiring-check.ps1:35-37` 的「字节一致单源」只覆盖 ps1/opencode/dsh 三项资产，且只查生产端 vs 仓库，不查 skill 侧副本。

**影响**：给 patch.yml 加一条规则而忘记同步 ps1 → Windows 用户（主力平台）防护缺一条；由于 M7 只看 YAML↔TS，这不会在任何 CI 报错。规则越加越多（60+），人工多副本同步的出错率线性上升。这是本项目「单一规则源」纪律的最大缺口。

**建议**：把规则集收敛为单一机器可读源（如 `assets/rules/deny-list.json` 或保留 patch.yml 为唯一源），ps1/sh/opencode TS/YAML 全部改为**生成器产物**（生成脚本 + 提交产物），M7 升级为「对全部生成副本做逐条 + 计数断言」。至少先把 ps1 与 sh 的规则计数/关键词对齐纳入 `rule-alignment.test.ts`。

**成本**：先做「把 ps1/sh 纳入对齐断言」半天-1 天；做生成器重构 1-2 天。

---

## F2（P0）sh hook 无 python3 时 fail-open（静默放行）+ grep 回退引号截断

**问题**：Linux/macOS 无 python3 的环境（或 python3 解析失败）下，hook 会静默放行；带转义引号的命令用 grep 回退会截断危险段，造成绕过。护栏产品 fail-open = 形同虚设。

**证据**：`skills/agent-risk-guard/scripts/dangerous-commands.sh`
- :15 `set -euo pipefail`；:54-69 注释自述修复史：「python3 缺失时命令替换失败会直接中止脚本（exit 127、无决策输出 → 静默放行）…改用显式 || 回退」——即当前是**显式 fail-open**；
- :67-68 回退 `grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"'` 遇到命令内 `\"` 截断（:28/:41 注释自认「已实测 bug」）；
- :10 头部注释：「无 python3 时回退 grep（引号截断有 bug）」「fail-open 语义需文档明确」；
- :70 `if [ -z "$cmd" ]; then exit 0; fi` — 提取失败 → 放行。

**影响**：`rm -rf` 这类命令即使被拦截，只要提取器不可用/解析失败就放行。macOS 自带 python3 通常无事，但精简容器、CI 镜像、WSL 最小发行版都可能缺 python3；且 CI `sh-hook` job（`ci.yml:63` os: macos/ubuntu）恰好都在有 python3 的环境跑，**覆盖不到无 python3 路径**。审计期间本会话一条含反引号 rm 的探测命令被本机门禁拦截（dogfood 事故），证明这类绕过向量是实战致盲点。

**建议**：提取失败默认 `deny`（带 `degraded: true` + reason），仅在 JSON 明确可解析时进入判定——把「不可判定」从放行改为拒绝；或将 grep 回退改为单次 python3 调用（顺带解决性能，见 F8）后删除回退路径；补一个无 python3 的 CI 场景（`PATH` 剔除 python3 跑套件）。

**成本**：0.5-1 天（改语义 + 加测试）。

---

## F3（P1）doctor 只验「在场」不验「新鲜度」，stale 状态是死代码

**问题**：`riskguard doctor` 的 ok 判定只要配置里出现过字符串即可，不校验安装副本是否等于仓库单源；类型里声明的 `stale` 状态全仓没有任何一个检查会产出。

**证据**：
- `packages/installer/src/doctor.ts:25-30` `hasRiskGuardHook` 对 settings.json/hooks.json 原文做子串匹配（`_riskguard` / `dangerous-commands`），无结构化解析；
- :58 `checkDshPatch` 只查 `raw.includes('deny-risk-commands')`——一个月前的旧 patch 内容也报 ok；
- :14-15 声明 `'ok' | 'missing' | 'stale' | 'absent-agent'`，但 grep 全文件 `stale` 仅出现在类型/注释，无任何 return 'stale'；
- 对比：`scripts/riskguard-wiring-check.ps1:63` 起做 SHA256 字节一致校验（这正是 doctor 该做而没做的）——两套巡检口径不一致，用户跑 `riskguard doctor` 得到 4 PASS，跑 wiring-check 才发现漂移。

**影响**：防护内容是陈旧副本（例如 R4 规则未同步到已安装 ps1）时 doctor 依旧报 ok，给用户虚假安全感——对安全护栏产品是直接的信誉与有效性风险。

**建议**：doctor 增加「已安装副本 vs 仓库单源」SHA256 比对（复用 wiring-check 逻辑/TODO 或直接调用其函数化版本），产出真实 `stale`；对 dsh patch 解析出规则数做计数比对；把 doctor 与 wiring-check 收敛为一个实现。

**成本**：0.5-1 天。

---

## F4（P1）ps1 防线零 CI 覆盖；「跨平台三环境」在 CI 实际只有 macOS+ubuntu

**问题**：项目主打 Windows 用户，但 Windows 侧的 ps1 钩子没有任何 CI；brief 宣称的 WSL/Git Bash/macOS 三环境 sh 验证，CI 只固化了两环境，WSL/Git Bash 全部靠本机手工跑。

**证据**：
- `ci.yml:54` 自述：「ps1 / sh hook 与回收站 D3 实测仅 Windows + 本机环境可跑，保持本地 test-all.ps1」；
- `ci.yml:58-97` `sh-hook` job `os: [macos-latest, ubuntu-latest]`，跑 3 个 sh 套件（sh-hook-test/sh-audit-edge/sh-audit-bypass）——**没有任何 ps1 套件**（`hook-rules-test.ps1/hook-bypass-regression.ps1/hook-fp-regression.ps1/hook-audit-reregress.ps1` 共 4 套 116 断言只在本地跑）；
- `git log` 近 8 条一半是 WSL/Git Bash 测试后的紧急修复 commit（`d18cb35 close cross-platform gaps found by WSL/Git Bash testing` 等）——证明回归频率高、且依赖人工环境。

**影响**：规则任一改动都可能打破 Windows 防护而不自知（跨平台回归全靠人肉）；新增贡献者无环境即无验证路径；ps1 是 5 agent 生产接线的实际主力（CC/Codex/AGY 都调 ps1）。

**建议**：CI 加 `windows-latest` job 跑 `hook-rules-test.ps1` 等 ps1 套件（pwsh 直接可跑，项目已在本机验证过用例）；Git Bash（msys）环境用 `actions/setup-msys2` 或 gitbash 容器跑 sh 套件，把「Git Bash 主力平台」纳入回归。

**成本**：0.5-1 天（CI yml + 少量脚本适配）。

---

## F5（P1）维护/测试代码写死本机绝对路径，仓库一挪就坏

**问题**：三个关键脚本把 `E:\DeepSeek_Harness\workspace\2026_08_21\agent-risk-guard` / `agent-risk-guard-audit` 绝对路径硬编码，跨机即失效；且硬编码的 audit 副本路径与 skill 实际副本路径/文件名不一致，导致 skill 副本永远进不了对齐测试。

**证据**：
- `scripts/riskguard-wiring-check.ps1:23` `$repo = 'E:\DeepSeek_Harness\workspace\2026_08_21\agent-risk-guard'`——「-Fix 从仓库单源恢复」的自愈能力绑死这台机器，换机 exit 2；
- `tests/adapter/opencode-guard-extract.ts:22` `SKILL_PLUGIN = 'E:/DeepSeek_Harness/workspace/2026_08_21/agent-risk-guard-audit/scripts/opencode/agent-risk-guard.ts'`——但本仓 skill 实际副本是 `skills/agent-risk-guard/scripts/opencode/destructive-operation-guard.ts`（不同路径、不同文件名）；
- `tests/adversarial/rule-alignment.test.ts:18` `SKILL_PATCH = .../agent-risk-guard-audit/assets/dsh/...`——且 :19 用 `existsSync(REPO_PATCH) ? REPO_PATCH : SKILL_PATCH` 优先取仓库副本，导致 skill 真身几乎永远不被校验。

**影响**：自愈脚本跨机不可用；skill 侧 opencode 副本（名称都不一样）永久脱管——F1 的漂移风险在 skill 分发形态上被放大（skillhub 发布还没做，将来一发就是带漂移的副本）。

**建议**：仓库根一律 `git rev-parse --show-toplevel` 或环境变量解析，找不到时该检查降级为 skip 并报 warning；SKILL_PATCH/SKILL_PLUGIN 指向 `skills/agent-risk-guard/<对应文件>` 真名，两个副本都断言。

**成本**：半天。

---

## F6（P1）"packages" 是名义分包：跨包相对路径 import 裸 .ts，无依赖声明，版本号撒谎

**问题**：monorepo 不是 npm workspace，8 个 package 互不声明依赖、互相以 `../../xxx/src/*.ts` 相对路径导入源码，靠 Node ≥22.18 的 type-stripping 才能跑；各 package.json 的版本/描述与产品事实不符。

**证据**：
- `packages/cli/src/commands.ts:17-32` 同时导入 `../../installer/src/*`、`../../acs/src/*`、`../../core/src/*` 裸 .ts；`packages/adapters/{claude,copilot,cursor,grok,opencode,windsurf}/src/index.ts` 均 import `../../../core/src/normalize.ts` 等（7 个适配器 6 个只从 core 取同一组符号）；
- 各 packages/package.json 无 `dependencies`/`workspaces` 字段；`exports` 指向 `./src/index.ts`——脱离仓库根目录被 node 直接跑会挂（普通 node 不 strip types，需引擎支持）；
- 版本撒谎：root `package.json` version 0.3.0，而 core/codex/dsh/installer/trash/acs/cli 的 package.json 全是 0.1.0（brief 宣称「单一版本源 core/version.ts」实际上 `packages/core/src/version.ts:26-29` 读的是**仓库根** package.json，各包自己的 package.json 是无人维护的假数据——任何 npm publish 都会发错误版本）；
- 布局耦合：`REPO_ROOT` 靠「目录上溯 N 层」推算在 `core/version.ts:19-22`、`cli/commands.ts:41-47`、`cli/runtime-install.ts` 等处重复出现（grep `dirname(dirname` 15 处命中）。

**影响**：模块边界无强制（任何包可 import 任何包，将来依赖环无约束）；发布/分发形态悬空（bin 指向裸 .ts）；版本审计混乱（root 0.3.0 vs 包 0.1.0）；重构目录即静默坏。长期维护成本随包数上升。

**建议**：二选一——(a) 转真 npm workspace（`"workspaces"` + tsc/tsdown build，exports 指 dist，各包声明依赖 core）成本 2-3 天；(b) 承认是单包架构：删掉/统一各 package.json 的版本与 bin 声明，收敛 REPO_ROOT 为单一工具函数（`scripts/lib/repo-root.ts`），把「裸 .ts 源码跑」写进 README 作为特性而非意外。至少先做 (b) 的版本收敛（半天）。

**成本**：(b) 半天；(a) 2-3 天。

---

## F7（P2）三套 ps1 规则引擎并存 + 头注释自指混乱，universal 副本无对齐检测

**问题**：ps1 侧存在 432 行 canonical、354 行 universal、56-73 行 agy 适配器共三套完整实现，文件头注释互相矛盾，universal 不在 wiring-check/M7 任何检测内。

**证据**：
- `assets/hooks/dangerous-commands.ps1:1` 头注释写作「dangerous-commands-universal.ps1 — 跨 7 家 Agent 通用版（规则集与 dangerous-commands.ps1 完全同步）」——一个命名为 dangerous-commands 的文件自称是 universal，且自引「与 dangerous-commands.ps1 同步」，事实它自己就是那两份之一（assets 与 skills 同 hash）；
- 另存在独立文件 `skills/agent-risk-guard/scripts/dangerous-commands-universal.ps1`（354 行 / 17739 B，与 canonical 432 行 / 24058 B **不同**）；
- `skills/agent-risk-guard/SKILL.md:74,225` 说 universal 覆盖 Cursor/Goose/Grok/Hermes/Copilot（P1 待实测）——即这份 354 行实现是给 5 家 agent 的防线，但它不进 `riskguard-wiring-check.ps1` 的检查点（:35-37 只查 3 项）；
- agy 又有两个壳：`assets/hooks/agy-dangerous-commands.ps1` 与 `skills/agent-risk-guard/scripts/agy-dangerous-commands.ps1`/`dangerous-commands-agy.ps1`（grep 适配器回路注释见 `packages/adapters/agy/src/index.ts:29-31`）。

**影响**：给 canonical 加规则，universal 漏同步 = Cursor/Goose/Grok/Hermes/Copilot 五家防线的规则静默过期；命名混乱使新人无从判断谁是谁的源。这是 F1 在 ps1 内部的重演。

**建议**：合并为单一 ps1 内核 + 参数化输出壳（agy 的差异只是 stdin/stdout JSON 形状，见 adapter 注释），删除 universal 或将其纳入 wiring-check/M7 比对；先做「把 universal 与 canonical 的规则段 diff 纳入 CI」止血（半天）。

**成本**：止血半天；合并 1-2 天。

---

## F8（P2）hook 性能：sh 每次调用 3× python3 spawn + ~25× grep spawn

**问题**：Git Bash 上单次 hook 4-5s（WSL 0.2s，慢 20-28×，brief 已知约束）的根因清晰：每调用 spawn 3 次 python3 + 25+ 次 grep，Windows 上进程创建极贵。

**证据**：`skills/agent-risk-guard/scripts/dangerous-commands.sh`
- python3 spawn #1 :31-32（extract_field）、#2 :57-58（取 command）、#3 :74-78（NFKC 归一化）；
- :86-263 约 25 个 `printf '%s' "$cmd" | grep -qE ...` 各 spawn 一个 grep；
- :22-25 注释承认「Git Bash 的 python3 常为 Windows 原生 build…reconfigure stdin/stdout 兜底」——每次 spawn 还有编码初始化开销。

**影响**：agent 高频工具调用时每次等待 4-5s 的用户可见延迟（Git Bash 用户是重度使用场景）；量级不优化的话 D3 实测/发布物体验差。

**建议**：改为单次 python3 一次读 stdin、完成取数+NFKC+全部规则匹配输出决策（顺带删除 grep 回退路径，直接解决 F2）；或预编译规则存单一匹配器文件。目标 Git Bash 单次 <1s。

**成本**：1 天（含回归）。

---

## F9（P2）CLI 口径不一致：detect 12 家 / install 只 3 家 / doctor 4 项，agy 注入无检查

**问题**：`riskguard detect` 列 12 家 agent，`install` 只支持 3 家且排除 dsh，`doctor` 只做 4 项注入检查，agy（5 生产接线之一）没有任何注入位检查——用户无法从 CLI 一站式确认「我到底受没受保护」。

**证据**：
- `packages/cli/src/commands.ts:70` `CANONICAL_AGENTS = ['claude-code','opencode','codex','dsh']`；:87-92 `installerKey` 注释「仅 claude-code/codex/opencode 可安装」，dsh → null（dsh patch 只能靠 skill 手工）；
- `packages/installer/src/doctor.ts:116-124` 兜底循环把「mechanisms 含 hooks 的其它 agent」排除出注入检查（:119 条件 `includes('hooks') === false`）——agy 的 mechanisms 正是 hooks，所以 agy 永远只报「installed: true」而**从不检查 ~/.gemini/config/hooks.json 的 PreToolUse 是否在位**；
- `doctor.ts:126` `ok = checks.every(state==='ok' || 'absent-agent')`——未安装＝通过，口径宽容；
- agy 适配器注释 `packages/adapters/agy/src/index.ts:23` 明示接线在 `~/.gemini/config/hooks.json → agy-dangerous-commands.ps1`。

**影响**：护栏产品核心价值是「可验证的确定性保护」，CLI 却给不出每家的真实注入状态；agy 生产接线若被外部还原（同 brief 里 claude settings.json 曾多次被还原的教训），doctor 无感。

**建议**：用 discovery 注册表驱动 install/doctor 同一 capability 表（detect→plan→doctor 同源）；doctor 增加 agy hooks.json PreToolUse 检查；把「absent-agent 算 pass」改为输出单独状态避免混淆。

**成本**：1 天。

---

## F10（P3）dist/ 快照常驻 1.6MB+，无清理策略

**问题**：工作区 `dist/` 常驻 4 版快照目录 + 4 个 tarball（合计约 1.6MB），build-release 只删最新版目录，旧版持续累积。

**证据**：
- `dist/agent-risk-guard-v{0.2.0,0.2.1,0.2.2,0.3.0}/` + 同名 `.tar.gz`（v0.2.0 目录 290KB … v0.3.0 353KB）；
- `scripts/build-release.ts:31` `if (existsSync(ART_DIR)) await rm(ART_DIR,...)` 只重置当前版本目录，老版本目录与 tarball 无人清理；
- `.gitignore:3` 排除 dist/（不入库），但工作区常驻；裸库 clone 后需自行 build。

**影响**：本地累积旧快照（含旧版代码）容易被误当当前版引用；无 clean 命令。属卫生问题，风险低。

**建议**：`package.json` 加 `clean` script（删除 dist/ 或只留最新 N 版）；tarball 仅 CI release 产出保留。

**成本**：30 分钟。

---

## 附：验证方法（可复跑）

1. 副本漂移：`Get-FileHash assets/hooks/dangerous-commands.ps1, skills/agent-risk-guard/scripts/dangerous-commands.ps1, skills/agent-risk-guard/scripts/dangerous-commands-universal.ps1, assets/opencode/agent-risk-guard.ts, skills/agent-risk-guard/scripts/opencode/destructive-operation-guard.ts, assets/dsh/deny-risk-commands.patch.yml, skills/agent-risk-guard/assets/dsh/deny-risk-commands.patch.yml`
2. M7 覆盖缺口：`node --test tests/adversarial/rule-alignment.test.ts` 后向 ps1 里加一条假规则重跑——不报错即证明缺口。
3. doctor stale 死代码：`Select-String packages/installer/src/doctor.ts -Pattern "stale"` 仅类型/注释命中。
4. CI 覆盖：读 `.github/workflows/ci.yml` 确认无 windows/ps1 job。
5. 硬编码路径：`Select-String -Path scripts/*.ps1, tests/**/*.ts -Pattern "E:\\|E:/"`。