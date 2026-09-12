# FIX_BRIEF G15b-FIX2 —— 修复 G15b-FIX 独立复验打回的 3 项（Round 215）

## 0. 先说清楚：**不是 D1 没修好**

上轮修复（F1–F5）的**两个 P0 已被独立复验确认修好**，本轮**不得回退**：

- **D1 ✅**：sh/ps1 生产出口真实 spawn + 进程 stdin，四类残留 4/4 脱敏；`redact_cmd()` = `tr → redact_text → JSON 转义`，旧 2 条 sed 与 GNU `I` 已删。
- **D2 ✅**：独立变异证明闸门钉住生产出口——**M2-sh（只把 `redact_cmd` 改直通）→ PART A 绿 / PART B 红（21 处）exit=1**；M2-ps1 → A 红 + B 红。
- **副本 ✅**：ps1 6/6 `EA253D108F`/31538 B/BOM=True；sh 3/3 `7C379CB56A`/22096 B/无 BOM；distinct=1。
- **判定零改动 ✅**：56 条跨两代 `CHANGED=0`。
- **回归 ✅**：node 373/373；ps1 37/8/20/59/97；sh 67/40/192。

**本轮 REJECT 依据：修复过程新引入的缺陷 + 一处报告失实。** 全部须修。

---

## 1. 必修项（逐条，均有复验证据）

### R1（P0）F3 引入明文泄漏回归——`curl -u alice:123456` 现为明文

**事实**：G15b 时该命令**是脱敏的**（旧规则 `-u\s+[^\s]+:[^\s]+`，**无**"密码须含非数字"限制）。本轮为防 `docker run --user 1000:1000` 误伤，把"密码含至少一个非数字字符"的守卫加到了 **`-u|--user` 共用的分支**上，导致 `-u` 的全数字密码不再脱敏。

**证据链**：G15b 报告 §3.2 逐字记录旧规则；本轮报告 §4 自述"密码部分含至少一个非数字字符"是**本轮新增**；复验者按旧规则重建 G15b-sim 实测该命令原为 `curl [REDACTED]`。

**修法**：**`-u` 与 `--user` 拆成两条规则**——
- `cli-basic-auth-u`（`curl -u`）：恢复**旧写法**，**不加**非数字限制 → `curl -u alice:123456` 必须脱敏
- `cli-basic-auth-user`（`--user`）：保留守卫，避免 `docker run --user 1000:1000` / `chown user:group` 误伤

**三端同步**：core `redact.ts`、ps1、sh 都要拆。

### R2（P0）新增过度脱敏 + 跨行误伤——F4 上下文判定过宽

**事实**（复验者自造载荷实测）：
| 载荷 | 现输出 | 应为 |
|---|---|---|
| `ssh mysql -p2222 host` | `ssh mysql [REDACTED] host` | **逐字不变**（`-p2222` 是 ssh 端口） |
| `psql -h mysql -p5432 -U postgres` | 端口被脱敏 | **逐字不变** |
| `docker run --user nginx:nginx nginx` | 整段被抹 | **逐字不变**（非认证用法） |
| `npm install --user alice:hunter2` | 还**吞掉结尾 `;`** | 不得吞分隔符 |

**根因**：F4 只要求"**同一段内出现过 `mysql` 这个词**"，未约束 `-p` 属于 **mysql 本次调用**。

**更严重**：`redact_cmd` 先 `tr '\n' ' '` 折叠换行，使 F4 的 `[^;&|\n]*` **在生产中失效** → **跨行命中别的命令的端口**（`echo mysql` + 换行 + `psql -p5432` 在 sh 被脱敏、ps1 不被脱敏 → **两端发散**），而现有语料**全是单行**，无人守。

**修法**：F4 改为**命令词锚定**——只在该 `-p` **紧跟 mysql 调用**时触发，例如锚定
`(^|[;&|]\s*|sudo\s+|env\s+|command\s+)(mysql|mariadb)\b … -p<数字>`
（具体写法自定，但必须同时满足：① `docker run --name mysql -p 3306:3306 mysql` 逐字不变；② 跨行时不得命中他命令；③ `mysql -p12345678` 仍脱敏）。

### R3 报告失实与陈旧注释（上轮 REJECT 的同类问题，不得再犯）

1. **报告 §7 称 ps1 行尾 CRLF → 实测 `CR=0 / LF=526`，纯 LF**。修正为 LF。
2. **报告 §3.1 的 M1 结论过宽**：删 sh 的 `github-pat` 时**闸门仍绿**（该 token 恰好 40 字符，被 `long-random` 同样脱敏，三端输出仍逐字一致）。修正表述。
3. **ps1 L62 注释**仍写 sh「用贪婪 `.»`」——陈旧，一并更正。

### R4 语料补强（把上面的行为**钉进测试**）

- **必须脱敏**：`curl -u alice:123456`
- **必须逐字不变**：`ssh mysql -p2222 host`；`psql -h mysql -p5432 -U postgres`；`docker run --user nginx:nginx nginx`
- **PART B 增 1 条多行语料**（守护 R2 的跨行场景，两端必须一致）

---

## 2. 不能破坏什么（回归红线，逐项自测并存证）

1. **F1/F2 不得回退**：生产出口四类残留仍全脱敏；**M2 变异仍必须变红**（自己复跑一次 M2-sh 证明）。
2. **副本一致**：ps1 6 份、sh 3 份 **distinct=1**；ps1 BOM=True / sh 无 BOM；行尾 ps1 与 sh 各自一致（**实测后如实写**）。
3. **判定零改动**：`CHANGED=0`（命令集可自定，须含上轮 69 条 + 本轮新增）。
4. **九套回归全绿**：node（含新增）、ps1 37/8/20/59/97、sh 67/40/192。
5. **既有 no-fp 不得误伤**：`ssh -p2222 host`、`docker run -p 8080:80 nginx`、`npm run build --prefix packages/core`、`mkdir -p /tmp/x`、`sudo -u root whoami`、`docker run --user 1000:1000 nginx`、`ssh -i /home/u/.ssh/id_rsa host`（A1 裁定：故意不脱敏）、`docker run --name mysql -p 3306:3306 mysql`（**有空格**）。

## 3. 流程纪律（硬要求）

- **每条改动声明必须能指到代码行**（上上轮教训）。
- **报告每个数字必须是你真跑出来的**；写进报告的行尾/BOM/字节数必须**逐字节实测**（R3 教训）。
- **凡声称"新回归"或"已修复"，必须给出基线对照**（`git show` 或历史副本的 before/after 并列输出）。
- 新增/改匹配规则时，**必须为新规则构造邻居载荷**并钉进测试（D7）。
- 交付顺序：**改 → 测 → 同步副本 → 复核 distinct/BOM/行尾 → 最后更新报告**；同步后**不得再改主源**，若改了必须**重新同步**（上上轮教训）。
- 隔离 TEMP 实验，事后还原；不改被审文件以外的东西。

## 4. 交付物

- 代码改动（三端 + 测试）
- `IMPLEMENTATION_RESULT_G15b-FIX2.md`：§改动逐条对照 → §R1/R2/R3/R4 各自的 before/after 实证 → §九套回归数字 → §副本表（含行尾实测）→ §判定零改动 → §未解决问题 → §本轮实际改了什么（逐条可指代码行）
- 证据工件落在 `tasks/orchestrator/_g15bfix2_*`

## 5. 验收标准（供独立 Evaluator）

R1 的 `curl -u alice:123456` 脱敏；R2 的四条误伤消除且跨行不命中；R3 三处更正；R4 语料钉住；F1/F2 不回退（M2 仍红）；副本一致；CHANGED=0；九套回归全绿；报告与产物逐字节相符。
