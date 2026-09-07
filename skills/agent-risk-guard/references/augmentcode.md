# AugmentCode：hooks 系统

机制：CLI hooks 系统（PreToolUse/PostToolUse），支持 bash 脚本拦截。
文档：<https://docs.augmentcode.com/cli/hooks>

## 配置文件

- 全局：`~/.augment/settings.json`
- 项目：`.augment/`（规则）+ `.augment/settings.json`（项目级设置）
- Hooks：`~/.augment/hooks/` 或项目 `.augment/hooks/`

## Hooks 配置格式

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "command": "powershell -NoProfile -ExecutionPolicy Bypass -File \"$HOME/.augment/hooks/dangerous-commands.ps1\"",
        "timeout": 10
      }
    ]
  }
}
```

## Hooks 示例（官方文档）

AugmentCode 官方文档提供了多种 hooks 示例：
- PreToolUse：工具执行前拦截/修改参数
- PostToolUse：工具执行后记录/审计
- UserPromptSubmit：用户输入时过滤/验证

## 加固建议

1. **配置 PreToolUse hook**：复用 `dangerous-commands-universal.ps1`
2. `.augment/rules/` 写"删除必须进回收站"（模型级）
3. 查 auto-approve 范围，收紧 Bash 自动批准

## 验证

让 AugmentCode 执行 `Remove-Item` → 应被 hook 拒绝。
