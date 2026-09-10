# 任务卡：WSL Ubuntu 跨系统命令行为测试

- **目标**：在 WSL Ubuntu（真实 Linux POSIX 环境）系统性测试 RiskGuard 的 `dangerous-commands.sh` Linux hook 规则集，验证"在其他系统中的命令"行为是否符合预期，产出测试报告。
- **验收标准**：
  1. 三套 sh 测试套件（sh-hook-test.sh / sh-audit-edge.sh / sh-audit-bypass.sh）在 WSL 全部运行完毕，记录 PASS/FAIL 计数与失败明细
  2. 补充系统性探测（至少 20 个用例）：删除类 / git 破坏类 / 解释器 one-liner / base64 管道 / 变量拼接绕过 / 正常命令误伤（False Positive）——逐条记录 命令→hook 决定（deny/allow）→exit code
  3. 对比"真实 Linux 行为"与"Windows WSL 特化行为"的差异：路径（/mnt/c vs /）、pty/非 pty、编码、权限
  4. 输出报告落盘 `E:\DeepSeek_Harness\workspace\2026_08_21\agent-risk-guard\tasks\t1-wsl-report.md`（结论+证据+失败清单+建议）
- **涉及文件**：
  - 被测对象：`E:\DeepSeek_Harness\workspace\2026_08_21\agent-risk-guard-audit\scripts\dangerous-commands.sh`
  - 测试套件：`E:\DeepSeek_Harness\workspace\2026_08_21\agent-risk-guard-audit\tests\sh-hook-test.sh`、`sh-audit-edge.sh`、`sh-audit-bypass.sh`
  - Windows 路径转 WSL：`C:\...` → `/mnt/c/...`（小写盘符）
- **依赖**：WSL Ubuntu 已确认可用（bash 5.x、git 2.43、node、python3、/tmp 可写）
- **优先级**：P1
- **执行方式**：隔离子代理，只读 + 在 /tmp 建测试目录，禁止触碰 Windows 用户目录
- **工作证明**：报告文件 + 关键命令输出摘录