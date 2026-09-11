# EVALUATOR_BRIEF — G15b 独立验收（第七阶段）

- 生成：2026-09-11 · Orchestrator Round 26
- 用途：交给**独立 Evaluator Agent**（不继承 Implementer 上下文）
- 预设立场：**「实现可能存在错误。」**

## 验收对象
- 任务卡：`tasks/orchestrator/IMPLEMENTATION_BRIEF_G15b.md`
- 实现结果：`tasks/orchestrator/IMPLEMENTATION_RESULT_G15b.md`
- 被改代码：`packages/core/src/redact.ts`（canonical）、`dangerous-commands.ps1`（`RedactPatterns`）、`dangerous-commands.sh`（`redact_cmd`，POSIX ERE）+ parity 测试

## 必查项（逐条 PASS/FAIL + 你自己跑出的证据）

### 1. 四类残留是否真的补齐（**在 ps1 与 sh 两端**）
用**你自己构造**的载荷（不要复用实现者的语料）：
- [ ] `aws configure set aws_secret_access_key wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`（**空格分隔**形态）
- [ ] `--password="correct horse battery staple"`（**引号内含空格**）
- [ ] `mysql -pSup3rS3cret -e "select 1"`（短参）
- [ ] `curl -u alice:hunter2 https://example.com`（基本认证）
判定要求：ps1（真实 spawn 子进程喂 stdin）与 sh（bash/WSL）的**日志/回显**中均出现 `[REDACTED]` 且**无明文**。
**注意**：ps1 hook 用 `[Console]::In.ReadToEnd()` 读**进程 stdin**——同进程管道探测会得假阳性"全 deny"，必须真实 spawn。

### 2. parity 测试的真实性（**决定性**）
- [ ] 该测试是否**真实执行三端**（ps1 spawn / sh 真实跑 / core import），而非只比字符串常量？
- [ ] **变异验证**：自己从**任一端**删掉一条模式 → parity 测试**必须变红**；还原后变绿。做不到就写"未独立验证"，不要假装。
- [ ] 语料是否 ≥12 条且含 ≥5 条**无误伤对照**？

### 3. 三端语义集合是否真的一致
- [ ] 逐条比对 core / ps1 / sh 的模式集合（列出差异表）；允许平台语法差异，但**语义集合必须一致**。
- [ ] 若实现者声明了"无法跨端对齐的形态豁免"，逐条复核其理由是否成立（**不得以移植性为借口漏掉形态**）。

### 4. 无倒退（回归）
- [ ] G15 已覆盖的 10 类**不得回退**（复用 G15 语料抽查）
- [ ] **判定逻辑零改动**：抽样 before/after（改前快照可用 `git show HEAD:<path>` 取）判定 CHANGED=0
- [ ] 无误伤：`echo hello` / `git status` / `ls -la` / 普通路径逐字不变
- [ ] ps1 五套（37/20/8/59 + 60）、sh 三套（67/40/192）、`node --test` 全量（基线 **360+**）自跑记数字

### 5. 架构一致性
- [ ] ps1 **六副本** SHA256 全同 + BOM（前 3 字节 EF BB BF）
- [ ] sh **三副本** 一致（audit / skills / audit-xhs-publish）
- [ ] sh 模式符合 **POSIX ERE**（BSD/macOS 兼容）——检查是否引入 GNU 专属写法（`\b`/`\s`/lookaround 等）

## 输出要求
`tasks/orchestrator/EVALUATION_RESULT_G15b.md`：
- 结论：**ACCEPT** 或 **REJECT**（明确二选一）
- 逐项检查表（PASS/FAIL + 你自跑的真实输出）
- 若 REJECT：具体缺陷 + 复现步骤 + 修复建议
- 特别标注：是否存在**仍未脱敏的形态**、**判定回归**、**parity 测试形同虚设**

## 纪律
只读 + 必要的临时实验（**逐字节还原**；临时 home/TEMP 实验后清理）；不改实现逻辑；**不要清理真实日志**。
DSH 门禁会拦命令行危险词——脚本用 write 工具写成文件再执行。
