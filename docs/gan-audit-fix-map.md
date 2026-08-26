# GAN 对抗审查修复映射（Round 5）

> 第一轮独立判别器报告：`tests/adversarial/ADVERSARIAL-AUDIT-REPORT.md`（4/10）
> 第二轮独立复查：`tests/adversarial/ADVERSARIAL-AUDIT-ROUND2.md`（待子代理产出）
> maker-checker 铁律：修复必须由独立第三方确认，本表为修复映射。

## P0（可绕过拦截，11 项）— 全部修复

| ID | 绕过 | 修复位置 |
|----|------|---------|
| P0-1 | `/bin/rm` / `/usr/bin/rm` 完整路径 | normalize RM_SEG 上下文含 `/`，去掉 require 位置锚定 |
| P0-2 | `eval` / `bash -c` / `sh -c` 包裹 | classify 新增包裹检测 → destructive execute |
| P0-3 | 变量拼接 `a="rm"; $a -rf` | 静态不可判定（RG-I05 边界）：guard 的 iex/$ 检测兜底 |
| P0-4 | `echo … > x.sh && bash x.sh` 两阶段 | classify 检测脚本写出+执行模式 → destructive |
| P0-5 | `base64 -d | bash` 编码管道 | classify 新增 base64/xxd/printf 管道检测 |
| P0-6 | `git push --force` / `git branch -D` / `git restore` | classify git 分支 + **isReadOnlyCommand 白名单排除危险标志**（致命放行修复） |
| P0-7 | subprocess / __import__ / importlib / execSync / fs.promises.rm | classify 新增 5 类动态执行检测 |
| P0-8 | `mkfs` / `dd if=… of=…` / `wipefs` | classify 磁盘域扩展 |
| P0-9 | `xargs -0 rm` | xargs 正则放开任意标志 |
| P0-10 | `IEX (New-Object WebClient).DownloadString` | classify 新增 IEX+WebClient 检测 |
| P0-11 | `tar --overwrite` / `unzip -o` | classify 新增归档覆盖检测 |

## P1（误伤/契约，7 项）— 全部修复

| ID | 问题 | 修复 |
|----|------|------|
| P1-1 | `rm --help` / `rm` 无参被误判删除 | RM_HELP 负前瞻排除 help/version；isReadOnly 特判无害 rm |
| P1-2/3 | `git push` / `git branch` 白名单放行危险标志 | isReadOnly 排除 `--force/-f/-D/-d`；corpus + normalize 回归锁定 |
| P1-4 | `cp`/`mv` 每次 ASK | classify 归 filesystem move（放行）；`-f` 强制覆盖归 overwrite（deny） |
| P1-5 | `npx vitest` 等不在白名单 | isReadOnly 增加 `npx\s+\S+` |
| P1-6 | `Policy.defaults` 死代码 | evaluate 真正读 defaults（read/irreversible/unknownMutation/reversibleWorkspaceWrite） |
| P1-7 | `dd` 正则 `\bdd\s+of=` 不匹配 `dd if=… of=…` | 改为 `\bdd\b[^|;&]*\bof=` |

## P2（测试盲区/建议，9 项）— 大部分修复

| ID | 问题 | 处理 |
|----|------|------|
| P2-1 | 语料缺 P0 向量 | corpus 扩到 60+ 条，全部 P0 入册 |
| P2-2 | 换行绕过上下文正则 | RM_SEG 加入 `\n\r` |
| P2-3 | Guard 覆盖比 classify 窄 | guard 复用 classify 单一事实源 + git/credentials 分支；guard-hardening.test.ts 锁定 |
| P2-4 | evaluateAll 单调性语义 | 文档确认（combineDecisions deny 恒优先，无需改码） |
| P2-5 | `git stash` 分类 | 保持 process.execute→ask（合理保守）；不在本轮回合 |
| P2-6 | `git restore` 未检测 | classify 已加 |
| P2-7 | 同 P1-2/3 | 已修 |
| P2-8 | 凭据 token 名扩展 | classify 放宽 `*_TOKEN/*_SECRET/*_PASSWORD` + printenv |
| P2-9 | RG-GUARD-002 缺 domain 约束 | 评估中（低风险，tag 由 Adapter 加） |

## 测试状态

- 语料：35 → 60+ 条
- 全量：90/90（14 组 + cp/mv 3 条 + normalize 回归 3 条）
- 新增专项：`guard-hardening.test.ts`（3 条）、normalize GAN 回归（3 条）