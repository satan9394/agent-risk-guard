# DeepSeek Harness：pre-execute 门禁插件

机制：`~/.dsh/profiles/*/cordis.patch.yml` 挂载自定义插件，`tools/pre-execute` 门禁在 pwsh/bash 工具派发前按正则黑名单拒绝命令。对全局所有会话/agent 生效。

## 配置文件

`~/.dsh/profiles/web/cordis.patch.yml`（以 web profile 为例；其他 profile 同理）。插件在 `insert` 段挂载：

```yaml
- insert:
    - id: deny-risk-commands
      name: 'deny-risk-commands'
      config:
        rules:
          - { re: '\bRemove-Item\b', reason: '全局铁律：删除必须进回收站，禁止 Remove-Item' }
          - { re: '(^|[;&|])\s*rm\s+', reason: '全局铁律：禁止 rm 永久删除' }
          - { re: '\bdel\s+', reason: '全局铁律：禁止 del 永久删除' }
          # ... 完整规则见下
```

## 完整规则清单（**条数以单源为准** —— `assets/dsh/deny-risk-commands.patch.yml` 即真相源，与 monorepo `defaultDenyRules()` 的逐条一致由 `rule-alignment` 测试守住；`riskguard-wiring-check.ps1` 每次巡检打印实际条数。2026-08 实测 + R2 扩充 + R3 生态融合 + R18 动态调用）

```text
删除类（铁律：必须进回收站）：
Remove-Item | rm -rf | del /[fqs] | ri | erase | rmdir(/s 与任意) | rd(/s 与任意) |
rm(命令位) | del(任意) | unlink | shred | [System.IO.(File|Directory)]::Delete |
.NET 实例 .Delete( | Clear-Content | find -delete | find -exec rm
Python：shutil.rmtree | os.remove/unlink/rmdir/removedirs | pathlib.*.unlink/rmdir
Node：fs.rm/rmSync | fs.unlink/unlinkSync | fs.rmdir/rmdirSync | fs-extra remove | rimraf
git：git clean | git reset --hard
磁盘：diskpart | Clear-Disk | Format-Volume/Partition/Drive
R2 新增（2026-08-24 GAN 审查后）：
certutil(-urlcache/-decode 下载执行) | docker run/exec(容器内删/逃逸面) |
git gc --prune | git reflog expire | reg delete(任意键)
R3 生态融合（2026-08-29 对标 CC Safety Net 等）：
git push --force(排除 --force-with-lease) | git branch -D | git checkout -- |
git restore | git stash drop/clear | git switch --discard-changes |
git worktree remove --force |
python -c/node -e/perl -e 解释器 one-liner 内嵌删除 |
cmd /c | pwsh/powershell -Command 内嵌删除
```

正则细节（实测踩坑）：
- `rm` 单命令用 `(^|[;&|])\s*rm\s+`（命令位置），避免误伤 `$rm` 变量
- `find -delete` 用 `\bfind\b[^|;&\n]*\s-delete\b`（`\bfind\s+.*\s-delete\b` 在 find 与 -delete 紧邻时漏网）
- `fs` 异步用 `\bfs\.(rm|unlink|rmdir)\s*\(`（与 `*Sync` 版规则互补）

## 生效与验证

- **热加载**：改 `cordis.patch.yml` 即生效，无需重启（2026-08 实测）。
- **整段缺失会静默裸奔（2026-11-02 实测）**：`~/.dsh/profiles/desktop/cordis.patch.yml` 在 0.2.1-rc.5 期间
  只剩 `llm-pi-ai` + `agent-default-model`，**deny-risk-commands 整段没了**，而旧巡检只报 `[!!]`、`-Fix` 也修不动。
  现在 `riskguard-wiring-check.ps1 -Fix` 会把单源里的 `- insert:` 段追加到文件末尾（保留原内容、写完做 YAML 复验），
  并有密封用例 T8 锁住这条路径。**判断方法**：`Select-String -Path <profile>/cordis.patch.yml -Pattern 'deny-risk-commands'` 必须有命中。
- **探测验证**：发一条无害命令，命令文本含黑名单词，被拦即规则生效：
  ```powershell
  Write-Output 'probe shutil.rmtree text'   # 应返回"全局铁律：禁止 Python 永久删除..."
  Write-Output 'probe git status'            # 正常输出
  ```
- **注意**：探测命令文本里的黑名单词会被门禁拦（连测试命令都拦）——这是特性；测试黑名单用这种探测，测白名单用正常命令。

## 0.2.1-rc.5 适配要点（2026-11-02）

- **headless 不再需要 `--patch` overlay**：`~/.dsh/profiles/headless/cordis.patch.yml` 已自带 `llm-pi-ai`（magpie provider）
  且 `agent-default-model` 指向 `magpie / commandcode/deepseek/deepseek-v4.1-flash`。`dsh --profile headless --dump-config`
  可直接核对这两项；真实会话 `dsh headless "<prompt>"` 即可取证，不用再拼 overlay。
- **`desktop` profile 由 Electron 应用独占**：CLI 会拒绝 `dsh --profile desktop --dump-config`
  （`error: profile "desktop" is managed exclusively by the Electron application`），CLI 的 `dsh plugin` 也不接它。
  对桌面端的接线核验只能看该 profile 的 `cordis.patch.yml` 本身，或用 Desktop 自带的命令运行时。
- 三个 profile（desktop / headless / web）的规则条数以巡检输出为准，别在文档里写死。

## DSH 其他安全层（与门禁的关系）

- 沙箱模式：`read-only` / `workspace-write` / `danger-full-access`（只约束**文件效果**；网络/进程可见性不在词汇内）
- 审批策略：`ask`（默认，弹给用户）/ `never`（确定性拒绝，headless 用）；fail-closed（只有 allowed-once 放行）
- 权限预设：`workspace-write+ask`（默认）、`danger-full-access+never`
- 已知漏洞 [discussion #250](https://github.com/deepseek-ai/deepseek-harness/discussions/250)：沙箱内模型可通过 Web approval 回环通道自批准 `danger-full-access` 升权——在修复前，升权请求保持人工确认，不在不可信内容下跑 Web 会话
- **门禁是唯一机器级硬拦截**：danger-full-access + never 时沙箱和审批都不拦，全靠 pre-execute 黑名单

## 参考文档

- <https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sandbox/sandbox-policy/README.zh.md>
- <https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/approval.md>
- <https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/permission-presets.md>

## 进阶：策略引擎插件 @riskguard/dsh（已实证，2026-08-24）

deny-risk-commands 是纯正则门禁（RG-I05 印证：正则 ≠ 能力边界）。结构化的
RiskGuard 策略引擎已做成 DSH 插件（`agent-risk-guard/packages/dsh`）：

- `ctx.on('tools/pre-execute', (exec, next) => PreToolDecision)`：动态策略（allow→ask→deny）
- `ctx.tools.guard(fn)`：单调最终拒绝（"no guard can force-allow a call another guard denied" = RG-I03 实现载体）
- 拒绝呈现给模型的错误：`Error: <reason>`
- 接线与验证清单见 `agent-risk-guard/docs/dsh-live-wiring-guide.md`
