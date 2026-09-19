# EVALUATION_RESULT — R7（独立验收）

- 切片：**R7 — `git branch` 删除的长选项 `--delete` 必须与短选项 `-d`/`-D` 同等拦截**
- 被验对象：**已合并的 main**（`HEAD = 5cfa5b3`）。R7 内容落在 `1d73404`（PR #11，与本地 `7c09890` **内容逐字节相同**），决策行落在 `5cfa5b3`（PR #12，与本地 `917e36a` **内容逐字节相同**）
- 验收轮：2026-09-19 · **独立 Evaluator（隔离上下文，未参与实现，未派生任何 Subagent）**
- 约束：Evaluator **只读**产品树；全部探针、语料、旧版变异体写在 `%TEMP%\r7_eval\`；**未修改任何已跟踪产品文件**（仅新建本文件）
- 复现基线：旧版行为一律取自 `7c09890^` 的冻结 blob（未手改任何正则，见 §1/§4）

## 裁决

**FAIL** —— 「主动尝试攻破并成功」。

改动**并非**全部为收紧：在 `packages/core/src/normalize.ts`（及其下游的生产端到端入口 `node bin/riskguard.mjs`）上，观测到
**allow→deny = 30 条，deny→allow = 38 条**。其中 **24 条是真实 git 会删除分支的合并短选项形态**
（`git branch -df feature`、`-Df`、`-dd`、`-DD`、`-dff` …），在旧版被 `RG-GIT-001` **DENY**，在 R7 后变为 **ALLOW**。
放宽计数不为零 ⇒ 按验收标准自动 **FAIL**。

> 一句话根因：两条正则的**单字符选项分支**加了尾部 `\b`。
> 旧 `\bgit\s+branch\s+-[dD]` 在 `-df` 上匹配前缀 `-d`；新增 `\b` 后 `-[dD]\b` 因 `d` 后接单词字符 `f` 而失配。
> `classifyShellCommand`（L173）与 `isReadOnlyCommand` 的 allowlist（L74）**两处都**被这样改。
> 生产 CLI（`packages/cli/src/cli.ts`）只读 `classifyShellCommand`：它返回 `null` ⇒ 事件落到默认 `filesystem/write`
> ⇒ `RG-UNKNOWN-001` **allow**；adapter（opencode/dsh 等）在 classify 为 `null` 后再查 `isReadOnlyCommand`，
> 得到 `true` ⇒ 以只读事件 allow。两条链路都因这一处 `\b` 从 DENY 变 ALLOW。

---

## 1. 从 diff 自行推导的改动集

```
git -C agent-risk-guard rev-parse HEAD                     → 5cfa5b3f111811fc4c7573da145c5ef1c6cc751c
git rev-parse 7c09890^{tree} 1d73404^{tree}                → 6de267df… / 6de267df…   （同一内容）
git rev-parse 917e36a^{tree} 5cfa5b3^{tree}                → 3c60635a… / 3c60635a…   （同一内容）
git log --format='%h %p %s' -1 <c>                     → 7c09890←b150db6、917e36a←1d73404（本地修复/文档两条平行提交）
                                                           1d73404←b150db6、5cfa5b3←1d73404（远端 PR 两条，单亲线性）
git status --porcelain → 仅 3 个未跟踪文件（DSH 进程产物 + 本任务 brief），无已跟踪改动
```

> 说明：本地 `7c09890`/`917e36a` 与远端/`main` 的 `1d73404`/`5cfa5b3` 是**平行提交**（不是父子链），但**两两 tree 相同**，故按内容等价处理。`git merge-base --is-ancestor 7c09890 HEAD` 返回 1 —— 它们不在 `main` 的祖先链上。

**`7c09890`（= 合并版 `1d73404`，20 files, +77/−23）**：

| 类别 | 文件 | 行 |
|---|---|---|
| 规则本体（6 处执行层） | `assets/opencode/agent-risk-guard.ts` | +4/−2 |
| | `assets/hooks/dangerous-commands.ps1` | +2/−2 |
| | `assets/dsh/deny-risk-commands.patch.yml` | +1/−1 |
| | `packages/core/src/normalize.ts` | +2/−2 |
| | `packages/installer/src/deploy.ts` | +1/−1 |
| | `skills/agent-risk-guard/scripts/dangerous-commands.sh` | +3/−2 |
| 同源副本 | `skills/.../scripts/dangerous-commands.ps1` +2/−2、`.../dangerous-commands-universal.ps1` +2/−2、`.../opencode/destructive-operation-guard.ts` +4/−2、`skills/.../assets/dsh/deny-risk-commands.patch.yml` +1/−1 | |
| 文案 | `packages/codex/src/rules-compiler.ts` +1/−1、`README.md` +1/−1、`README.en.md` +1/−1、`CHANGELOG.md` +25/−0 | |
| 测试（全为 `+N/−0`，除 rule-self-test） | `packages/core/test/normalize.test.ts` +3、`tests/adapter/opencode-guard-reregress.test.ts` +3、`tests/adversarial/adversarial-corpus.test.ts` +3、`skills/.../tests/sh-audit-bypass.sh` +3、`skills/.../tests/sh-hook-test.sh` +3、`tests/adversarial/rule-self-test.test.ts` +12/−3 | |

**`917e36a`（= 合并版 `5cfa5b3`）**：`docs/decisions.md` **+1 行，纯追加**（diff 中无任何 `-` 行）。

```
git diff --check 7c09890^ 7c09890   → exit 0
git diff --check 917e36a^ 917e36a   → exit 0
git diff --stat --ignore-all-space  → 与普通 --stat 统计完全相同（无纯空白翻动）
```

**结论**：无杂散改动、无空白 churn、无无关文件；6 处执行层 + 4 处同源副本 + 5 处文案/编译串 + 6 处测试。**改动集本身干净。**

## 2. 旧 vs 新行为矩阵（Evaluator 自建载荷，进程级真跑）

harness：`%TEMP%\r7_eval\`。
- **旧版**一律来自 `7c09890^` 冻结 blob，经 `git hash-object` 逐字节核对：`normalize.ts 02c46f0d`、`agent-risk-guard.ts 12242df9`、`deploy.ts 4140bea8`、`dangerous-commands.ps1 4f095a52`、`dangerous-commands.sh 6d4ab0b0`、`deny-risk-commands.patch.yml 41134283`，6/6 MATCH。
- 各层喂法与生产契约一致：ps1/sh 用 stdin `{"tool_name":"Bash","tool_input":{"command":"…"}}`；e2e 用 `node bin/riskguard.mjs`（无子命令，stdin JSON → decision JSON）。

**主语料（161 条）= 长选项族 + `--force` 组合 + 短选项族 + 必不回归负例 + 合并短选项族**
（负例覆盖 `git branch`、`--list`、`--all`、`-a`、`-v`、`-vv`、`-r`、`-m a b`、`--move`、`--copy`、`-c`、`-C`、`--force`、`--merged`、`--set-upstream-to`、`--contains`、`--delete-tracking`、`--deleteX`、散文/引号/注释形态等）

| 执行层 | 载荷 | allow→deny（收紧） | deny→allow（**放宽**） | 其他 |
|---|---|---|---|---|
| opencode 插件（`tests/adapter/opencode-guard-extract.ts` 同款切片） | 161 | **30** | **0** | 0 |
| core `classifyShellCommand` + `isReadOnlyCommand` | 161 | **30** | **38** | 4（ask→deny） |
| core `isReadOnlyCommand` 单独 | 161 | **30** | **38** | 0 |
| installer `defaultDenyRules()` | 161 | **30** | **0** | 0 |
| ps1 hook `assets/hooks/dangerous-commands.ps1` | 161 | **30** | **0** | 0 |
| sh hook `skills/.../scripts/dangerous-commands.sh`（WSL bash） | 161 | **32** | **0** | 0 |
| DSH patch 正则 `assets/dsh/deny-risk-commands.patch.yml` | 161 | **30** | **0** | 0 |
| **生产端到端 `node bin/riskguard.mjs`** | 161 | **30** | **38** | 0 |

负例全部保持 allow（新 ps1/sh/oc/dsh 均实测 `--list` / `--all` / `-a` / `-v` / `-m a b` / `--move` / `--copy` / 裸 `git branch` = allow）。
放宽面 38 条中，24 条为**真实 git 会删除分支**的形态（§3），其余 14 条为同族但 git 报错/缺操作数的形态，一并计入。

### 2.1 收紧面（30 条，形态一致、跨 4 端可复现）

长选项本体（`git branch --delete <name>`、`--delete --force`、`--delete -f`、引号/大小写/多空格/制表符变体、`&&`/`;` 拼接、`sudo` 前缀、`--delete-tracking`、`--delete.txt`、`--delete --help`），以及**散文/字符串内提及**（`echo '…'`、`grep -rn "…"`、`git commit -m "…"`）。ps1/sh 额外拦下更多散文变体（sh 32 条），属既存宽松度差异，非本轮引入。

### 2.2 放宽面（38 条，**全部集中在 core / e2e 一条链路上**）

`-df` 系（24 条，真实 git 删除分支；见 §3 原始证据）+ 8 条同族但真实 git 报错（`-dx`/`-Dx`/`-dm`/`-Dm`，各带/不带操作数）+ 6 条同族无操作数（`-df`/`-Df`/`-dd`/`-DD`/`-dfd`/`-dff`）。

```
NEW git branch -df feature       -> allow ruleId=RG-UNKNOWN-001 op=filesystem.write
OLD git branch -df feature       -> deny  ruleId=RG-GIT-001       op=git.git_checkout_discard

NEW git branch -Df feature       -> allow ruleId=RG-UNKNOWN-001
OLD git branch -Df feature       -> deny  ruleId=RG-GIT-001
```

直接函数级证据（`classifyShellCommand` / `isReadOnlyCommand`，无中间层）：

```
cmd                      | OLD cls / ro            | NEW cls / ro
git branch -df feature   | git/git_checkout_discard / false | null / true   <== 双翻转
git branch -Df feature   | git/git_checkout_discard / false | null / true   <== 双翻转
git branch -dd feature   | git/git_checkout_discard / false | null / true   <== 双翻转
git branch -d feature    | git/git_checkout_discard / false | git/git_checkout_discard / false  （不变）
git branch --delete feature | null / true | git/git_checkout_discard / false  <== R7 本意（收紧）
```

`isReadOnlyCommand` 单独对比同样得到 `tightening=30 relaxations=38`。**这 38 条只出现在 core**：
opencode 插件、ps1、dsh 的**旧**规则本就在 `-[dD]` 后带 `\b`（`-df` 在旧版就已 allow，新旧一致）；sh 的旧规则是
`git[[:space:]]+branch[[:space:]]+-[dD]`（无尾 `\b`，靠 `-d` 前缀匹配 `-df`），故 `-df` 在 sh 新旧都是 deny、**未放宽**。
即：R7 把 core 从「与 ps1/oc/dsh 一致的 `\b` 语义」**改成了**「与 sh 一致」失败的那种前缀语义的反面——只是 core 恰好丢了前缀匹配能力。

## 3. 决定性检查：不得放松（核心）

对 **161 条载荷**做 old-rule vs new-rule 决策差（生产端到端 `node bin/riskguard.mjs`）：

```
payloads exercised              : 161
ALLOW->DENY (tightening)        : 30
DENY->ALLOW (RELAXATION)        : 38      ← 关键：不为 0
```

38 条放宽中，**24 条被真实 git 接受为分支删除**。真实 git 语义用独立 scratch 仓库实测（`git init` 后逐形态验证分支是否消失）：

```
DELETES  -df  -Df  -fd  -fD  -dd  -DD  -dD  -Dd  -dfd  -dff  -ddd  -ddD  -ddf  -dDd  -dDD …
（36 个由 {d,D,f} 构成且 git 接受为删除的短选项组合；其中 24 个出现在我的语料里并发生了 DENY→ALLOW）
```

因此放宽**可被真实利用**：R7 之后，一个会执行 `git branch -Df <name>`（等价于 `git branch -D`）的 Agent
在 CLI/adapter 链路上不再被 `RG-GIT-001` 拦截，落到 `allow`。

补充边界（同样计入 38）：`git branch -dx feature` 等 8 条在真实 git 下 exit=129、不删除；`git branch -df` 等 6 条缺操作数。
它们仍是策略上的宽松化（旧 deny → 新 allow），但不构成删除。

**反例**（安全向）：未发现任何「因 R7 而 ps1/sh/dsh/opencode 放行、core 拒绝」的形态——四端本轮**零放宽**。

## 4. 变异证明（闸门是否自证式）

变异体：把 `7c09890^` 的 **11 个行为相关文件**逐一还原到 `%TEMP%\r7_eval\repo_old\`，其余文件保持 HEAD。
**11/11 经 `git hash-object` 核对与旧版 blob 逐字节相同**（`normalize.ts`/`agent-risk-guard.ts`/`deploy.ts`/`dangerous-commands.ps1`/`dangerous-commands.sh`/`deny-risk-commands.patch.yml` ×2/`destructive-operation-guard.ts`/`dangerous-commands-universal.ps1`/`rules-compiler.ts`）；
3 个纯文案文件（`CHANGELOG.md`/`README.md`/`README.en.md`）**未回退**（无行为影响，仅影响文档，已如实标注）。
4 个 R7 测试文件保持**新版**（未回退），确保只动产品、不动测试。

```
变体：R7 正则回退到旧形态
```

| 测试文件 | baseline（HEAD） | mutant（R7 回退） |
|---|---|---|
| `tests/adapter/opencode-guard-reregress.test.ts` | exit 0，35/35 | **exit 1，33/35** |
| `tests/adversarial/rule-self-test.test.ts` | exit 0，3/3 | **exit 1，0/3** |
| `tests/adversarial/adversarial-corpus.test.ts` | exit 0，5/5 | **exit 1，3/5** |
| `packages/core/test/normalize.test.ts` | exit 0，19/19 | **exit 1，18/19** |

**精确失败断言**（全 8 条）：

```
rule-self-test.test.ts:127  规则集中未找到包含片段: git\s+branch\s+(?:-[dD]
rule-self-test.test.ts:136  规则集中未找到包含片段: git\s+branch\s+(?:-[dD]
rule-self-test.test.ts:157  AssertionError: R7 branch --delete
adversarial-corpus.test.ts:146  R7 git branch --delete: 应被 classify 识别
adversarial-corpus.test.ts:159  R7 git branch --delete (git branch --delete feature): expect deny, got allow [rule=default]
opencode-guard-reregress.test.ts:34  B-12b2 git branch --delete
opencode-guard-reregress.test.ts:35  B-12b3 git branch --delete --force
normalize.test.ts:145  branch --delete 不是只读
```

sh 侧同样变红（旧 sh 脚本 + 新测试）：

```
sh-audit-bypass.sh : TOTAL 195  PASS 193  FAIL 2   → FAIL [git-branch-long-delete] / [git-branch-long-delete-force]，exit 1
sh-hook-test.sh    : PASS 68/70，exit 1            → FAIL <- git branch --delete main / --delete --force main
```

**闸门是真的、非自证式**：对 R7 回退全部变红，对交付版全绿。
但必须记录：**这批测试只锁定 `--delete` 正向语义，没有任何断言覆盖合并短选项 `-df`/`-Df` 的收紧语义**
——所以本轮的放宽不会被任何一套现有闸门发现（变异测试对它是绿的）。

## 5. 分发面验证（单源 vs 生产副本）

```
pwsh -NoProfile -File scripts/riskguard-wiring-check.ps1   → exit 0，14 个 [OK] 行、0 个 [!!] 行
node bin/riskguard.mjs doctor                              → Summary: 4 PASS / 0 WARN / 0 FAIL / 7 SKIP（exit 0）
```

| 面 | 单源 SHA256 | 生产副本 | 状态 |
|---|---|---|---|
| opencode 插件 | `CEFFC1258AC38CA6DC3E3BA988ACB5071177FCD4EB559D9EC24117A51F2216FE` | `C:\Users\Satanchen\.config\opencode\plugins\agent-risk-guard.ts` **同哈希**，L315 = `if (/\bgit\s+branch\s+(?:-[dD]\b\|--delete\b)/.test(lo))` | ✅ 已更新 |
| ps1 ×3 | `B4B67E586A2261E1D3CDF24565C4F2C2DD5C2ED90B3E4B9383240F3D7670ADB3` | `~/.claude/hooks`、`~/.codex/hooks`、`~/.gemini/config/hooks` **3/3 同哈希**，均含 `(?i)\bgit\s+branch\s+(?:-[dD]\b\|--delete\b)` | ✅ 已更新 |
| **DSH patch ×2** | `F18686EF1AB5E193880E138891754722BE9A389EA79A8E5A807388D8BE94528F` | `~/.dsh/profiles/web/cordis.patch.yml`、`~/.dsh/profiles/headless/cordis.patch.yml`：**仍是旧正则** `\bgit\s+branch\s+-[dD]\b` | ❌ **未更新** |
| sh hook | `599A544F7A42EC27D5A7384A5269307DC7A31DDD19B223C2133A78DF245636CF` | 仓库内源已更新；`~/.claude/skills/custom/agent-risk-guard-audit/scripts/dangerous-commands.sh` **仍是旧正则**（F80DABF0…，L559） | ⚠️ 旁路副本未更新 |

DSH 差异用规则集逐一比对（`re:` 抽取 + 归一清单）：

```
source rules    : 69
live web        : 69 规则，missing-from-live=1 → \bgit\s+branch\s+(?:-[dD]\b|--delete\b)
                          extra-in-live  =1 → \bgit\s+branch\s+-[dD]\b
live headless   : 69 规则，同上（missing 1 / extra 1）
```

**wiring-check 报 OK 是盲区**：它只校验 `deny-risk-commands` 在位 + 规则数 ≥ 单源（69 ≥ 69），
**不比对每条正则文本**。规则被等量替换（1 条旧换 1 条新）时，该检查会漏报。这与本机 DSH 生产面实际仍跑旧规则一致。

生产语义影响（本地实测，非推断）：live DSH 对 `git branch --delete feature` / `--delete --force feature` 仍 **allow**，
对 `-D` deny；单源 patch 对这两种长选项 deny。即 **DSH 生产面尚未获得 R7 的收紧**（对照单源 30 条收紧差异）。

## 6. 未过拦 / 已登记缺口

- **38 条放宽**（§3）：24 条可被真实 git 利用（`-df`/`-Df`/`-dd`/`-DD`/… 带分支名），8 条为非删除形态（`-dx`/`-Dx`/`-dm`/`-Dm`），6 条缺操作数（`git branch -df` 等）。全部落在 core/e2e。
- **`--move`/`--copy`/`--force` 白名单补全声明未生效（1 条，方向安全）**：`CHANGELOG.md` 与 `docs/decisions.md` 称「顺带把
  `isReadOnlyCommand` 的白名单补全为 `…-[dDmMcC]\b|--delete|--move|--copy|--force`（此前 `git branch --move` / `--copy` / `--force` 同样漏判）」。
  实测**规范形态**下无任何变化：

  ```
  cmd                          oldRO  newRO
  git branch --move a b        true   true
  git branch --copy a b        true   true
  git branch --force a b       true   true
  git branch -m a b            true   true
  git branch xx --move a b     true   false   ← 仅在选项前另有 token（非真实 git 调用）时才收紧
  ```

  机理：`^git\s+branch\s*` 的 `\s*` 已**吞掉** `branch` 与首个选项之间的空格，负向先行断言只在「选项前另有空格+tokens」时命中。
  故该「补全」对真实调用**未落地**。（`--delete` 之所以生效，是靠 `classifyShellCommand` 的非空返回在 `isReadOnlyCommand` 首行提前 `return false`，与该白名单无关。）
  方向安全：`--move/--copy/--force` 本非删除，不构成放宽；属文档/声明与实际不符。
- **DSH 生产面未同步**（§5）：live patch 仍旧规则，`--delete` 长选项在生产 DSH 上仍放行。
- **sh 旁路副本未同步**（§5）。

## 7. 项目自带套件（Evaluator 亲跑）

| 套件 | 结果 |
|---|---|
| 4 个 R7 相关 node 套件（HEAD） | `62/62`，exit 0 |
| `sh-audit-bypass.sh` | **195/195**，exit 0 |
| `sh-hook-test.sh` | **70/70**，exit 0 |
| 全仓 node 套件（`packages/**/test/*.test.ts` + `tests/**/*.test.ts`，382 条） | 4 次运行：`382/382`(exit 0) · `381/382`(exit 1) · `382/382`(exit 0) · `382/382`(exit 0) |

**唯一失败 `redact-parity` 的独立判定**：
`node --test packages/core/test/redact-parity.test.ts` 单独跑在 **新版与 R7 回退版上都稳定 2/3、exit 1**（失败点均为 PART B `extractPs1Command`
的 `ps1 systemMessage 结构不符`）。用 Python 以 GBK 解码同一 ps1 输出时，正则 `\n命令：([\s\S]*?)\n如确需执行` 正常命中、且**无密钥泄漏**；
以 UTF-8 解码则报 `UnicodeDecodeError`。⇒ 该失败是 **Windows 控制台代码页/子进程编码**导致的中文锚失配，
**与本轮 R7 无关**（回退后同样失败），且在全仓并发跑时**表现为偶发**（4 次全仓运行里 1 次红）。实现者「pre-existing」的声明成立。

## 8. 改动集准确性核对

- `7c09890` 与 `1d73404` **tree 相同（`6de267df…`）**：本地修复提交与 PR #11 合并提交内容一致，无「合并时被改」。
- `917e36a` 与 `5cfa5b3` **tree 相同（`3c60635a…`）**：决策行提交与 PR #12 合并提交内容一致。
- `917e36a` 的 diff **只有 1 行 `+`，0 行 `-`**：符合 `docs/decisions.md`「只追加、已接受的永不改写」。
- R7 决策行引用证据为一句话 + `7c09890`，与仓库「行内证据」惯例一致；但**未提及本轮放宽**（结论为 ✅ ACCEPT，与事实不符）。

## 结论与建议

**FAIL。** 放宽计数 **38（>0）**，其中 **24 条为真实 git 删除分支的合并短选项形态**，在生产端到端入口
`node bin/riskguard.mjs` 与全部使用 `classifyShellCommand`/`isReadOnlyCommand` 的 adapter 链路上由 **DENY 变 ALLOW**。

建议修复（超出本次审计范围，仅登记）：两条正则的选项分支去掉尾部 `\b`（或改为 `-[dDmMcC](?![A-Za-z])` 之类，
使 `-df` 仍命中），并在用户所给载荷族中**显式加入合并短选项正例**（`git branch -df`、`-Df`、`-dd`、`-DD`），
同时把 DSH 生产面与 sh 旁路副本纳入同步、把 wiring-check 的 DSH 校验从「规则数」升级为「逐条正则比对」。
