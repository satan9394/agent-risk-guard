# Pi / Aider：无内建权限，外部隔离

这两个 Agent **没有内建权限系统/沙箱**（pi 官方 README 明示；Aider 无 sandbox），危险命令拦截必须靠外部手段。

## Pi Coding Agent（mempko/pi）

- 仓库：<https://github.com/mempko/pi>（@earendil-works/pi-coding-agent）
- **官方明示**："Pi does not include a built-in permission system for restricting filesystem, process, network, or credential access. By default, it runs with the permissions of the user and process that launched it."
- 官方给的隔离三方案（`packages/coding-agent/docs/containerization.md`）：
  1. **Gondolin 扩展**：pi 与 provider 认证留在宿主，内置工具和 `!` 命令路由进本地 Linux micro-VM
  2. **Docker**：整个 pi 进程跑在容器里
  3. **OpenShell**：整个 pi 进程跑在策略控制的沙箱里
- 注意：rulesync 矩阵显示 pi 支持 hooks/permissions（可能后续版本加入）——审计时以实际安装版本为准，查 `~/.pi/` 或包文档
- 审计：确认是否容器化；若裸跑，向用户说明任何删除命令都会以用户权限直接执行

### 加固建议（Pi）

1. **容器化**：用 Docker 跑 pi（官方推荐）
2. **OpenShell**：用策略控制的沙箱
3. **Gondolin**：micro-VM 隔离（最安全）
4. 无内建 hooks → 无法机器级拦截

---

## Aider

- 配置：`~/.aider.conf.yml`（或 `aider_conf.yml` 项目级）+ `.aiderignore`（同 .gitignore 语义）
- **无 sandbox**（llm-safe-haven 评价："No sandbox, but minimal attack surface"）
- 默认只编辑 git 仓库内的文件（工作目录边界天然较小）；`--no-auto-commits` 等 flag 影响 git 行为

### 配置文件

- 全局：`~/.aider.conf.yml`
- 项目：`aider_conf.yml`（项目级）+ `.aiderignore`

### 加固建议（Aider）

1. `.aiderignore` 覆盖敏感路径（`.env`、密钥、`~/.ssh`）
2. 提示用户用 git 提交前审查 diff
3. 重要仓库开 `--yes-always` 慎重
4. 无 hooks/permissions → 无法机器级拦截删除命令

### 验证

让 Aider 执行 `rm -rf` → 应以用户权限直接执行（无拦截）——这正是要升级到容器化的原因。

---

## 共同结论

pi / Aider 的"危险命令拦截"答案是**外部隔离**（容器/micro-VM/OpenShell）或**工作目录边界 + ignore**，而不是在 Agent 内配黑名单。审计报告要如实标注"无内建拦截，需外部方案"。

## 陷阱

- Pi 官方明示无权限系统，不要假设它有 hooks。
- Aider 的 `.aiderignore` 只是忽略文件，不是权限系统。
- 两者都是"最小攻击面"设计，但无法防御 prompt injection 诱导删除。
