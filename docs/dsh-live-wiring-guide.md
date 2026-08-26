# DSH 插件真实接入指南（@riskguard/dsh → web profile）

基于 Round 4/5 的 D2 实证（`docs/dsh-api-evidence-d2.md`）本接线已完全确定。
本指南用于把 `packages/dsh` 插件真实装进 DSH web profile 做 D3 会话验证。

## 前置确认（本机 2026-08-24 实测）

- DSH CLI：`D:\Technology_application\NVM_Windows\nodejs\dsh.cmd`（v0.1.1-rc.1）
- profile：`--profile web`，patch 文件 `~/.dsh/profiles/web/cordis.patch.yml`
- 现有门禁：`deny-risk-commands`（30 条正则，pre-execute 瀑布最前段）
- 关键事实：**pre-execute 瀑布先到先得**——deny-risk-commands 返回 deny 后
  RiskGuard 的 pre-execute 不会再看到该调用；但 **guard 段与瀑布独立**，
  allow 会被 guard 最终拒绝（RG-I03）。因此两者职责：
  - deny-risk-commands：纯正则快速拦截（保留，用户既有配置）
  - riskguard-dsh：策略引擎（RichEvent）+ guard 不变量 + junction 逃逸防护

## 接线步骤

### 1. 复制插件包到 profile 依赖

`packages/dsh` 依赖 `../core` 与 `../adapters/dsh` 的相对路径 import，
真实 cordis 环境需要把三者都装进 profile 的 node_modules（或用 pnpm workspace）。

推荐（保持 monorepo 同步开发）：
```powershell
# 在 monorepo 根（有 pnpm 时）
pnpm --dir E:\DeepSeek_Harness\workspace\2026_08_21\agent-risk-guard install --no-frozen-lockfile
# 然后把 packages/{dsh,adapters/dsh,core} 通过 file: 协议加入 profile package.json
```

### 2. cordis.patch.yml insert

在 `cordis.patch.yml` 的 insert 数组追加（与 deny-risk-commands 同级）：

```yaml
- insert:
    - id: riskguard-dsh
      name: '@riskguard/dsh'
      config:
        # 可选覆盖：
        # policy: (默认 defaultPolicy)
        invariants:
          permanentDelete: true
          guardSelfProtect: true
        denyPrefix: 'RiskGuard'
```

> ⚠️ patch 顺序：把 riskguard-dsh 的 insert **放在 deny-risk-commands 之后**——
> 两者都在 pre-execute 瀑布，先注册的先评估；RiskGuard 只需兜住正则漏网
> （结构等价绕过）+ guard 不变量 + junction 逃逸，不必抢在正则前。

### 3. 重启并验证

```powershell
dsh --profile web --dump-config   # 确认 riskguard-dsh 在插件树且非 disabled
# 或直接重启 web：
dsh --profile web
```

### 4. D3 会话验证清单

在 web 会话里按顺序试验（预期行为）：
1. `rm -rf <workspace>/test-x` → 应被 deny-risk-commands 或 riskguard deny，模型收到 `Error: ...`
2. PowerShell `Remove-Item -Recurse -Force` → deny
3. `shutil.rmtree('...')` → deny
4. 普通 `git status` / `ls` → allow（read 白名单）
5. **junction 逃逸**：`New-Item -ItemType Junction $ws\link C:\outside` 后 `rm -rf $ws\link\x` → riskguard-dsh 的 realpath 检查触发「逃逸防护」deny
6. `printf 'x' > ~/.riskguard/policy.yml` 或删除 .riskguard 下文件 → guard 自保护 deny

## 回滚

```powershell
# patch 里删掉 riskguard-dsh 的 insert 段 → 重启即失效（无残余）
# 若已写入配置并要恢复：rollbackAgent('dsh', [...]) 或直接编辑 patch
```

## 状态

- [ ] Step 1-3 执行（需用户确认接入生产 profile；铁律：开发产物在工作区）
- [ ] Step 4 真实会话验证（D3）