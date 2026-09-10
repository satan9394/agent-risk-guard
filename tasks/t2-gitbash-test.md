# 任务卡：Git Bash（MINGW64）跨系统命令行为测试

- **目标**：在 Git Bash（Windows 上的 MINGW64/MSYS POSIX 模拟环境）系统性测试 RiskGuard 的 `dangerous-commands.sh` Linux hook 规则集，验证在"半 POSIX 环境"下的命令行为是否符合预期，产出测试报告。
- **验收标准**：
  1. 三套 sh 测试套件在 Git Bash 全部运行完毕（Windows 路径直接传，无需 /mnt 转换），记录 PASS/FAIL 计数与失败明细
  2. 补充系统性探测（至少 20 个用例）：删除类 / git 破坏类 / 解释器 one-liner / base64 管道 / 变量拼接绕过 / 正常命令误伤——逐条记录 命令→hook 决定→exit code
  3. 对比"Git Bash（MINGW64）"与"WSL Ubuntu（真 Linux）"的差异：路径风格（C:\ vs /c/ vs /mnt/c）、shell 行为、命令名称解析、/tmp 语义、python3 来源
  4. 输出报告落盘 `E:\DeepSeek_Harness\workspace\2026_08_21\agent-risk-guard\tasks\t2-gitbash-report.md`（结论+证据+失败清单+建议）
- **涉及文件**：
  - 被测对象：`E:\DeepSeek_Harness\workspace\2026_08_21\agent-risk-guard-audit\scripts\dangerous-commands.sh`
  - 测试套件：`E:\DeepSeek_Harness\workspace\2026_08_21\agent-risk-guard-audit\tests\sh-hook-test.sh`、`sh-audit-edge.sh`、`sh-audit-bypass.sh`
  - Git Bash 路径：`D:\Technology_application\Git\bin\bash.exe`
- **依赖**：Git Bash 已确认可用（bash 5.2.37、git、node、python3、/tmp 可写）
- **优先级**：P1
- **执行方式**：隔离子代理，只读 + 在 /tmp（MINGW 映射）建测试目录，禁止触碰 Windows 用户目录
- **工作证明**：报告文件 + 关键命令输出摘录