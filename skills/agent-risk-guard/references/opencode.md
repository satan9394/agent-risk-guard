# OpenCode：插件 tool.execute.before 拦截

机制：插件系统 + `tool.execute.before` 钩子（工具执行前可修改参数或抛错拦截）。
官方文档：<https://opencode.ai/docs/plugins/>

## 配置文件

- 全局配置：`~/.config/opencode/opencode.json`（`permission` 段 + `plugin` 段）
- 全局插件目录：`~/.config/opencode/plugins/`（JS/TS 文件自动加载）
- 项目插件目录：`.opencode/plugins/`

## 默认状态（重要）

**OpenCode 默认允许所有操作、无任何审批**（"By default, opencode allows all operations without requiring explicit approval"），且**无内建沙箱**（macOS 也不用 Seatbelt）。`permission.bash` 可配 ask/deny + glob 模式，但不配就是全开。

## 插件示例（deny-risk-commands.js）

```js
export const DenyRiskCommands = async () => {
  const re = /Remove-Item|\brm\s+-rf\b|\bdel\s+|\bshutil\.rmtree\b|\bos\.(remove|unlink|rmdir)\b|\[System\.IO\.(File|Directory)\]::Delete/i
  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool === "bash" && re.test(output.args.command)) {
        throw new Error("风险命令被拦截：删除必须进回收站")
      }
    },
  }
}
```

## 参考实现（推荐能力完整的版本）

`destructive-operation-guard.ts`（440 行，2026-08 实测可用）应包含：
- 检测器：POSIX（rm/rmdir/unlink/shred/find -delete/xargs rm）、PowerShell（Remove-Item/Clear-Content/.NET）、CMD（del/erase/rd/rmdir）、Python（os/shutil/pathlib）、Node（fs.rmSync/rimraf）、git（clean/reset --hard/checkout -- ./restore .）、磁盘（format/diskpart/Clear-Disk/mkfs/fdisk/parted/dd）
- wrapper 解包：`powershell -enc/-c`、`cmd /c`、`bash -c`、`python -c`、`node -e`、EncodedCommand 混淆检测
- 受保护路径：插件自身文件、配置目录、HOME、Windows 系统目录（防篡改 + 防重定向覆盖）
- fail-closed：检测器抛错但命令含危险信号时仍拦截
- **trash 工具**：注册回收站删除工具，拦截后引导模型用它（Windows 走 Microsoft.VisualBasic）
- 日志：拦截记录写 `~/.config/opencode/logs/destructive-operation-guard.log`
- 导出 `analyzeCommand()` 等供单测

## 验证

- 单测：`analyzeCommand('rm -rf /tmp/x')` 应返回 `{blocked: true, policy: ...}`；`analyzeCommand('git status')` 返回 `{blocked: false}`
- 真实会话：让 OpenCode 执行删除命令 → 应报 `BLOCKED_BY_GLOBAL_SAFETY_GUARD`
- 查日志：`~/.config/opencode/logs/destructive-operation-guard.log` 有 `result=BLOCKED` 记录即证明加载并工作过

## 陷阱

1. TS 插件由 Bun 直接运行，`@opencode-ai/plugin` 由 OpenCode 运行时提供；本地插件要装外部 npm 依赖需在插件目录建 `package.json`。
2. `permission` 保持 allow（用户要最高权限），拦截全靠插件。
3. 想拦"所有操作"就抛错（工具调用失败，模型会换路）；想"重定向"就改 `output.args`。
