# FIX BRIEF — G15b-FIX：修复 D1（sh 生产路径未接线）等 REJECT 缺陷

- 生成：2026-09-11 · Orchestrator Round 121
- 来源：独立验收 `EVALUATION_RESULT_G15b.md`（裁决 **REJECT**，20798 B）
- 依赖：本卡完成后须由**新的独立 Evaluator** 复验（不得由本卡实现者自评）

## 背景：为什么被 REJECT（一句话）
新增的 13 条 `redact_text()`（POSIX ERE）**只有测试入口 `--redact-stdin` 调用**；sh 的生产出口 `deny_command()`(L172) 调的是 `redact_cmd()`(L161-167)，而后者**一行未改**——仍是 G15 的旧实现（**先转义后脱敏**、**仅 2 条 sed**、**含 GNU-only `I` 标志**、**无哨兵**、**无 `-p`/`-u`/空格键值/引号含空格值**）。

**实测后果**：四类残留密钥在 sh 的**真实 deny 输出**里全部**明文泄漏**；而 parity 测试只测 `redact_text`，因此**恒绿**——给出**虚假的安全保证**。

**证据质量问题**：实现者报告 §5 写「`redact_cmd()` 改为 `tr → redact_text → JSON 转义`」，**实测该集成从未发生**。修复时请如实描述。

## 必须修（REJECT 依据）

### F1（P0）把 `redact_cmd()` 真正接到 `redact_text()`
改为：`tr '\n' ' '` → **`redact_text`** → JSON 转义（先脱敏后转义）。
**顺带消除 D3**：旧 `sed -E .../I` 被删除后，生产路径不再含 GNU-only `I` 标志（BSD/macOS 可移植）。

### F2（P0）parity 闸门必须钉住**生产出口**
现状：parity 只比对 `--redact-stdin`（测试入口）→ **M2 变异（只把 `redact_cmd` 改直通）闸门仍绿**。
要求：**新增断言直接走生产出口**——给 sh hook 喂「含密钥且触发 deny」的真实 JSON（stdin），在**返回的 deny JSON** 里断言无明文。
**变异验证（必须做且必须做对攻击面）**：把 `redact_cmd` 改回直通 → **F2 断言必须变红**；还原后变绿。
（原实现者的 3/3 CAUGHT 只攻击了测试入口，属**选错攻击面**，不能作为闸门有效性的证据。）

## 应该修（便宜且理由清楚）

### F3 `--user u:p` 长参（两端）
`curl --user alice:hunter2` 目前两端均明文泄漏。补规则覆盖 `--user` 的 `user:pass` 形态（脱敏 `:pass` 或整段）。

### F4 `-p<全数字>` 用上下文限定（两端）
现状 `-p` 要求值含非数字字符（为避 `ssh -p2222`/`docker -p 8080:80` 误伤），代价是 `mysql -p12345678` 明文泄漏。
改为**命令上下文限定**：仅当同一命令段出现 `mysql`/`mariadb` 时才套用 `-p<值>` 规则（无论是否全数字）；其余场景维持现状。
**不得**因此误伤 `ssh -p2222`、`docker run -p 8080:80`、`npm run build --prefix`——这三个是既有 no-fp 用例。

### F5 parity 语料扩展
把「生产出口路径」与「多块 PEM」纳入语料；若多块 PEM 的跨端差异**本轮不修**，则必须在语料中**显式豁免并注明理由**（不得静默略过）。

## 编排者裁量（与 Evaluator 的分歧，以此为准）

### A1 `ssh -i /home/u/.ssh/id_rsa` —— **不认定为泄漏，不要脱敏**
Evaluator 将其标为 LEAK，我不采纳：`-i` 是**私钥文件路径**，不是密钥值本身。脱敏它会**过度脱敏正常路径**（违反"D3 过度脱敏不接受"的既有原则）。
→ **不修**；在报告"未解决问题"中显式记录该分歧与理由。

### A2 `-P<v>`（mysql 大写 P）—— **低优先，可只做保守处理**
mysql 的 `-P` 实为 **port**（`-P3306` 是端口，不是密码）；`-PS3cret` 属畸形用法。真实泄漏面很窄。
→ 若成本低（复用 F4 的上下文限定思路）可做；**若会增加误伤风险则不做**，并记录理由。

## 不能破坏什么（修复时勿误伤——这些已验收通过）
1. **ps1 端四类残留已真修好**（生产 `Deny-Command` L128 确实调 `Redact-Secrets`）——不要动 ps1 的脱敏逻辑。
2. **判定零改动**：独立验收已证 **68 条真实 stdin 对照 CHANGED=0**；修复后必须仍为 CHANGED=0。
3. **副本**：ps1 六副本 `EA71C7CB…`/31397 B/**BOM=True**；sh 三副本 `1D2E93F3…`/20443 B/无 BOM/LF —— 修复后各自仍须 distinct=1、BOM/LF 正确。
4. **回归**：node 368/368；ps1 37/8/20/59/89；sh 67/40/192。
5. **无误伤**：`echo hello`/`git status`/`ls -la`/`npm run build --prefix packages/core`/`ssh -p2222`/`docker run -p 8080:80` 逐字不变。
6. parity 测试确为**真实 spawn**（ps1 `-RedactFile` + sh `--redact-stdin`），保留该真实执行方式。

## 验收标准（FIX 的验收 = 新 Evaluator 的检查项）
1. **sh 生产出口**对四类残留**全部脱敏**：用真实 spawn + 进程 stdin，喂「密钥 + `rm -rf /tmp/t`」的 JSON，在 deny JSON 里搜明文子串 → **必须搜不到**。
2. **parity/回归测试能捕获生产路径失效**：把 `redact_cmd` 改直通 → 测试**变红**（给出实证）；还原 → 变绿。
3. 生产路径**不含** `\b`/`\s`/lookaround/`sed I`（POSIX ERE 合规）。
4. 判定 CHANGED=0；分支回归全绿；副本 SHA/BOM/LF 正确。
5. 报告如实：**逐条说明实际改了什么**，与代码一致（本轮 REJECT 的直接教训就是"报告与代码不符"）。

## 交付
`tasks/orchestrator/IMPLEMENTATION_RESULT_G15b-FIX.md`：改动摘要 + **生产出口四类残留的实证（前后对比）** + F2 的变异验证实证 + 回归数字 + 与 Evaluator 的分歧处置（A1/A2）。
