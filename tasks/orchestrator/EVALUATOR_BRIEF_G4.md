# EVALUATOR_BRIEF — G4 独立验收（第七阶段）

- 生成：2026-09-11 · Orchestrator
- 用途：交给**独立 Evaluator Agent**（不继承 Implementer 推理上下文）
- 预设立场：**「实现可能存在错误。」**

## 验收对象
任务卡：`tasks/orchestrator/IMPLEMENTATION_BRIEF_G4.md`
实现结果：`tasks/orchestrator/IMPLEMENTATION_RESULT_G4.md`（Implementer 产出）
被改代码：`agent-risk-guard-audit/scripts/dangerous-commands.ps1` 规则 16d + 同步四副本 + 回归用例

## 必查项（逐条给 PASS/FAIL + 证据）

### 1. 需求是否真的满足
- [ ] 16d 四分支中 `[[:space:]]` 已全部替换为 .NET 正则有效的等价物（`\s` 或 `[ \t]`）
- [ ] 原语义保持：`$x=rm`、`$x = rm`、`$x="rm -rf ..."`、`Remove-Item` 变体、反斜杠前缀 `r\m`、前导斜杠 `/rm` 仍被拦截
- [ ] **独立复现**：自己构造探测（不要只信 Implementer 的数字），用 `-Cmd` 或 stdin JSON 喂 hook，确认上述向量真的 deny

### 2. 边界与误伤（对抗性）
- [ ] `$x=rm --help`、`$x = rm -h` 是否误伤？（设计意图：help/version 应放行；若被拦属误伤，需记录）
- [ ] 正常命令无误伤：`echo hello`、`git status`、`ls -la`
- [ ] 大小写变体：`$X=RM; $X -RF`（规则用 `(?i)` 应覆盖）
- [ ] 反斜杠/引号变体：`$x="r\m"; $x -rf`、`$x='Remove-Item'; $x`
- [ ] 空/畸形输入不崩：空 stdin、坏 JSON、缺 command

### 3. 回归
- [ ] 4 套 ps1 测试全绿且**数字有增长**（原 37/8/18/53；若新用例未进套件 → FAIL）
- [ ] sh 三套件在 WSL 不回归（67/40/192）
- [ ] 补的用例是**真用例**（不是恒真断言/被跳过）

### 4. 测试真实性（重点质疑）
- [ ] 新用例断言的是 hook 的**实际输出**（permissionDecision deny）而非仅字符串存在
- [ ] 用例能真的失败：把修复回滚（临时把 `\s` 改回 `[[:space:]]`）后，新用例必须变红——**这是测试有效性的决定性证据**
- [ ] 没有为了过测试而放宽规则

### 5. 架构一致性
- [ ] 五处 ps1 副本 SHA256 一致（主源 + assets + skills + 生产 3 处）
- [ ] **BOM 保持**（前 3 字节 EF BB BF）——无 BOM 会让 PowerShell 5.1 解析中文崩
- [ ] 语法检查通过（Parser::ParseFile 无错）
- [ ] 未越界改动（git diff 只涉及 16d 相关行 + 测试文件）

### 6. 隐藏技术债 / 未声明问题
- [ ] ps1 中是否还有其它 .NET 正则不支持的 POSIX 类（全文 grep `[[:` ）
- [ ] 是否存在其它同类死代码（例如用 `[[:space:]]` 之外的 POSIX 类）
- [ ] sh 与 ps1 对同一向量判定是否真的一致（跨端同用例）

## 输出要求
写 `tasks/orchestrator/EVALUATION_RESULT_G4.md`：
- 结论：**ACCEPT** 或 **REJECT**
- 逐项检查表（PASS/FAIL + 证据）
- 若 REJECT：列出具体缺陷与复现步骤，返回 Implementer 修复
- 独立复现命令与真实输出摘录（不要转述 Implementer 的结论）

## 纪律
只读验收（可执行无害探测，禁止真实执行危险命令）；不得修改被审代码；你的结论不依赖 Implementer 的自述。