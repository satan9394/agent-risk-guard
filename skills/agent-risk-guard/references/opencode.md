# OpenCode：插件 tool.execute.before 拦截（V2）

机制：插件系统 + `ctx.tool.hook("execute.before")`（工具执行前抛错即拒绝该工具调用）。
官方文档：<https://opencode.ai/docs/plugins/>（V2 服务端插件：`/build/plugins/server`）

本机实测版本：**2.2.5**（2026-11-02）。

## 配置文件

- 全局配置：`~/.config/opencode/opencode.json`（V2 用 `permissions` 数组，不再是 V1 的 `permission` 对象）
- 全局插件目录：`~/.config/opencode/plugins/`（`.ts`/`.js` 文件**自动发现**，配置里不需要登记）
- 项目插件目录：`.opencode/plugins/`
- 查询是否加载：`opencode plugin list`（应出现 `agent-risk-guard  local  …/plugins/agent-risk-guard.ts`）

## 默认状态（重要）

**OpenCode 默认允许所有操作、无任何审批**，且**无内建沙箱**。`permissions` 可配 action/resource/effect，但不配就是全开。
`opencode.json` 里那条 `{ "action": "*", "effect": "allow", "resource": "*" }` 就意味着拦截全靠插件。

## V2 插件入口（唯一推荐形态）

```ts
export default {
  id: "agent-risk-guard",
  async setup(ctx) {
    // 硬闸门：只有这个域可以 fail（Tool.Error / 抛 Error 都会拒绝该次调用）
    await ctx.tool.hook("execute.before", (event) => {
      if (event.tool === "shell" || event.tool === "bash") {
        const cmd = event.input?.command
        if (blocked(cmd)) throw new Error("BLOCKED_BY_GLOBAL_SAFETY_GUARD\n…")
      }
    })
    // 权限层：配置规则判完后、动作执行前，可把 allow/ask 改成 deny
    await ctx.permission.hook("evaluate", (event) => {
      if (event.action !== "shell") return
      if (event.resources.some(blocked)) { event.effect = "deny"; event.message = "…" }
    })
    // 回收站工具（替代永久删除）
    await ctx.tool.transform((editor) => editor.add(trashTool))
  },
  // V1 兼容入口（OpenCode 1.18.x 调 server()）；@opencode-ai/plugin 只在里面惰性 import
  async server(ctx) { … }
}
```

## 三层拦截面（实测结论，别把顺序写反）

1. **`ctx.tool.hook("execute.before")` = 唯一硬闸门。** V2 的失败通道里**只有 tool 域可以 fail**
   （源码 `packages/core/src/plugin/hooks.ts`：shell / permission / session / aisdk 全部是 `NoFailures`）。
   `tool` 域只覆盖走 `Tool.execute` 的调用，也就是 agent 的工具调用。
2. **`ctx.permission.hook("evaluate")` = 第二层。** 在配置规则判完之后运行（`allow`/`ask` 会进，显式 `deny` 不进），
   可把 effect 改成 `deny`。动作名在 V2 里是 `shell`（V1 的 `bash` 已改名；`write`/`patch` 合并成 `edit`）。
3. **`ctx.shell.hook("create.before")` = 不是闸门。** 它是 `never` 失败通道——**抛错拦不住**。
   插件里保留它只为日志分层（`tool=shell.hook` / `tool=tool.hook` 能看出哪层先命中），不要拿它当安全保证。

**残余风险（已登记）**：用户自己在 TUI 里敲 `!` 起的 shell、以及任何不经 `Tool.execute` 的 shell 端点，
不在第 1 层覆盖范围内；这类路径只能靠权限层或人工自律。别在文档里把它写成「所有 shell 都被拦」。

**Code Mode 不构成绕过**（2026-11-02 在 2.2.5 实测）：`execute` 的 `tools` 目录里没有 `shell`
（调用 `tools.shell` 抛 `Unknown tool 'shell'`），只有 MCP 工具与插件工具（如 `trash`），
所以模型无法在 JS 里间接调 shell 绕开第 1 层。

## 2.2.5 的版本变化（对本插件的影响）

- **`bash` 工具名 → 按 `shell` 执行**（2.2.5，宿主侧兼容；插件若真注册了名为 `bash` 的工具则优先）。
  插件两层都同时认 `shell` 与 `bash`，不依赖单一名字。
- **`apply_patch` 权限迁移到 `edit`**（2.2.3 起）；插件对 `edit` / `write` / `patch` / `apply_patch` 都做 guard 文件保护。
- **新增 `mcp.use` / `skill.use` / `plugin.use` 权限动作**（2.2.x）。本插件只处理 shell，其余照常交给 `permissions` 数组。
- `ctx.tool.transform` 注册的自定义工具在 Code Mode（`tools.trash`）下可调用 —— 2.2.5 实测：`junk.log` 进回收站、目录内已消失。

## 参考实现（单源）

`assets/opencode/agent-risk-guard.ts`（V1+V2 双入口；skill 内镜像逐字节一致）应包含：
- 检测器：POSIX（rm/rmdir/unlink/shred/find -delete/xargs rm）、PowerShell（Remove-Item/Clear-Content/.NET）、CMD（del/erase/rd/rmdir）、Python（os/shutil/pathlib）、Node（fs.rmSync/rimraf）、git（clean/reset --hard/checkout -- ./restore .）、磁盘（format/diskpart/Clear-Disk/mkfs/fdisk/parted/dd）
- wrapper 解包：`powershell -enc/-c`、`cmd /c`、`bash -c`、`python -c`、`node -e`、EncodedCommand 混淆检测
- 受保护路径：插件自身文件、配置目录、HOME、Windows 系统目录（防篡改 + 防重定向覆盖）
- fail-closed：检测器抛错但命令含危险信号时仍拦截
- **trash 工具**：注册回收站删除工具，拦截后引导模型用它（Windows 走 Microsoft.VisualBasic）
- 日志：拦截记录写 `~/.config/opencode/logs/agent-risk-guard.log`（`tool=` 字段区分 `tool.hook` / `shell.hook` / `permission`）
- 导出 `analyzeCommand()` 等供单测

## 验证

- 单测：`analyzeCommand('rm -rf /tmp/x')` 应返回 `{blocked: true, policy: ...}`；`analyzeCommand('git status')` 返回 `{blocked: false}`
- 真实会话（2.2.5 用的手法）：
  `opencode run --standalone --auto "Run this exact shell command now: git reset --hard HEAD"`
  → 期望 `BLOCKED_BY_GLOBAL_SAFETY_GUARD` + `Policy: GIT_RESET_HARD`，脏改动存活；随后同会话 `git status --short` 放行。
- 查日志：`~/.config/opencode/logs/agent-risk-guard.log` 里 `result=BLOCKED` 且 `tool=tool.hook` 即证明命中硬闸门。

## 陷阱

1. 插件由宿主用自带运行时加载；本地插件要装外部 npm 依赖需在插件目录建 `package.json`。
   本插件**不得有顶层 `@opencode-ai/plugin` 导入**——那次导入失败会变成「加载失败 = 无拦截」。
2. `permission`/`permissions` 保持 allow（用户要最高权限），拦截全靠插件；但别因此把权限层删掉，它是第二层。
3. 想拦「工具调用」就抛错（模型会看到工具失败）；想「重定向」就改 `event.input`。
4. 取证别用「把文件永久删掉」这类提示词：模型会在规则层直接拒绝、零工具调用，那是 soft 遵循，不构成硬拦截证据。
