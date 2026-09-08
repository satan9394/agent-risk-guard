/**
 * installer/deploy.ts — M6 部署规划器（生成各 Agent 的拦截配置）
 *
 * 职责分离：本模块只「生成配置文本 + 规划写入点」，不直接落盘。
 * 落盘由 deployTo(paths) 执行，且必须先过 backupPaths()（铁律）。
 * mode: 'plan'（只输出计划，默认安全）| 'apply'（备份后写入）。
 *
 * 覆盖目标（文档 §10 优先级）：
 *   - claude-code：PreToolUse hook（filter 黑名单）+ settings.json sandbox tokens
 *   - codex：AGENTS.md 规则 + config.toml sandbox
 *   - dsh：cordis.patch.yml insert（deny-risk-commands 插件）⚠️ 文档 §22「插入点已由用户全局配置」——本模块生成 fragment，不直接改用户 profile
 */

export interface DeployPlan {
  agent: string;
  target: string;        // 建议写入路径
  intent: string;        // 为何写、写什么
  content: string;       // 生成的配置片段
  mode: 'plan' | 'apply';
  backup?: string;       // apply 时先备份到的目录
}

export type GuardRules = string[]; // 正则黑名单（DenyList）

/** 通用黑名单：永久删除 + 高危（对齐 deny-risk-commands 既有规则集） */
export function defaultDenyRules(): GuardRules {
  return [
    '\\bRemove-Item\\b', '\\brm\\s+-rf\\b', '\\bdel\\s+/[fqs]\\b',
    '\\bFormat-(Volume|Partition|Drive)\\b', '\\bri\\s+', '\\berase\\b',
    '\\brmdir\\s+/s\\b', '\\brd\\s+/s\\b', '\\[System\\.IO\\.(File|Directory)\\]::Delete',
    '\\bdiskpart\\b', '\\bClear-Disk\\b', '\\bshutil\\.rmtree\\b',
    '\\bos\\.(remove|unlink|rmdir)\\b', '\\bpathlib\\b.*\\.(unlink|rmdir)\\b',
    '\\bfs\\.(rmSync|unlinkSync|rmdirSync)\\b', '\\brimraf\\b',
    '(^|[;&|])\\s*rm\\s+', '\\bdel\\s+', '\\b(unlink|shred)\\s+',
    '\\brmdir\\s+', '\\brd\\s+', '\\bos\\.removedirs\\b',
    '\\bfs\\.(rm|unlink|rmdir)\\s*\\(', '\\bfs\\.remove\\w*\\s*\\(',
    '\\.Delete\\s*\\(', '\\bClear-Content\\b',
    '\\bfind\\b[^|;&\\n]*\\s-delete\\b', '\\bfind\\s+[^|;&]*\\s-exec\\b[^|;&]*\\brm\\b',
    '\\bgit\\s+clean\\b', '\\bgit\\s+reset\\b.*--hard',
    // R2 新向量（ADVERSARIAL-AUDIT-ROUND2.md 新-1~新-5）
    '\\breg\\s+delete\\b', '\\bcertutil\\b[^|;&\\n]*(-urlcache|-decode)',
    '\\bdocker\\s+(run|exec)\\b', '\\bgit\\s+gc\\b.*--prune', '\\bgit\\s+reflog\\s+expire\\b',
    // R3 生态融合（对标 CC Safety Net 完整 git 破坏清单，补齐 rules-compiler 已声明但 deny 缺失项）
    '\\bgit\\s+push\\b[^|;&\\n]*\\s(?:--force(?!-)|-[f]\\b)',
    '\\bgit\\s+branch\\s+-[dD]\\b',
    '\\bgit\\s+checkout\\s+--',
    '\\bgit\\s+restore\\b',
    '\\bgit\\s+stash\\s+(drop|clear)\\b',
    '\\bgit\\s+switch\\s+[^|;&\\n]*--discard-changes',
    '\\bgit\\s+worktree\\s+remove\\s+--force',
    // R3 生态融合：解释器 one-liner 内嵌删除（对标 CC Safety Net python -c 'os.system("rm -rf /")' 检测）
    '\\bpython(?:3(?:\\.\\d+)?)?\\s+-c\\s+[\'\"][\\s\\S]*?\\b(?:os\\.system|os\\.remove|os\\.unlink|shutil\\.rmtree)\\b',
    '\\bnode\\s+-e\\s+[\'\"][\\s\\S]*?\\b(?:(?:fs|require\\([\'\"]fs[\'\"]\\))\\.(?:rmSync|rm|unlinkSync|unlink|rmdirSync|rmdir))\\b',
    '\\bperl\\s+-e\\s+[\'\"][\\s\\S]*?\\b(?:unlink|rmdir)\\b',
    // R3 生态融合：Windows wrapper 内嵌删除（对标 CC Safety Net shell wrapper 检测的 Windows 版）
    '\\bcmd(?:\\.exe)?\\s+\\/c\\b[^|;&]*\\b(del\\s|rmdir\\b|rd\\s|erase\\b)',
    '\\b(pwsh|powershell)\\s+-(?:command|c)\\b[^|;&]*[\'\"][\\s\\S]*?\\b(?:remove-item|rm\\s+-rf|del\\s|rmdir\\s*\\/s)\\b',
    // R4 GAN 修复（对齐 assets/dsh/deny-risk-commands.patch.yml R4 段，M7 单一事实源防漂移）
    // [P0] 反引号/反斜杠插字拆拼命令名：r`m / r\m / R`emove-Item / d`el / rmd`ir
    '\\bR[`\\\\]?e[`\\\\]?m[`\\\\]?o[`\\\\]?v[`\\\\]?e[`\\\\]?-[`\\\\]?I[`\\\\]?t[`\\\\]?e[`\\\\]?m\\b',
    '\\br[`\\\\]?m\\b',
    '\\bd[`\\\\]?e[`\\\\]?l\\b',
    '\\br[`\\\\]?m[`\\\\]?d[`\\\\]?i[`\\\\]?r\\b',
    // [P0] base64 解码后管道投递解释器（echo ... | base64 -d | sh/bash）
    '\\|\\s*base64\\s+-[dD]\\b[^|;&\\n]*\\|\\s*(?:sh|bash|zsh|fish)\\b',
    // [P0] iex / Invoke-Expression 内联拼接删除命令
    '\\b(?:iex|invoke-expression)\\b[^|;&\\n]*(?:remove-item|rmdir|shred|erase|delete|\\brm\\b)',
    // [P0] 变量字符串拼接组装命令名后 & 调用（$c='Remo'+'ve-Item'; & $c）
    '\\$[A-Za-z_]\\w*\\s*=\\s*[\'"][^\'"\\r\\n]*[\'"]\\s*\\+\\s*[\'"][^\'"\\r\\n]*[\'"]\\s*;?\\s*&\\s*\\$',
    // [P0] 变量直接持有删除命令名后 & 调用（$x='rm'; & $x）
    '\\$[A-Za-z_]\\w*\\s*=\\s*[\'"]\\s*(?:remove-item|rmdir|shred|erase|delete|\\brm\\b)\\s*[\'"]\\s*;?\\s*&\\s*\\$',
    // [P0] xargs 投递删除（find | xargs rm / xargs -0 rm）
    '\\bxargs\\b[^|;&\\n]*\\b(?:rm|rmdir|shred|unlink|dd|mkfs|mv)\\b',
    // [P0] find -execdir/-okdir 删除（补 -exec 之外的词边界变体）
    '\\bfind\\s+[^|;&]*\\s-(?:execdir|ok|okdir)\\b[^|;&]*\\b(?:rm|rmdir|shred|unlink|mv)\\b',
    // [P1] 工具名盲区：git rm / git update-ref / filter-branch
    '\\bgit\\s+rm\\b',
    '\\bgit\\s+(?:update-ref|filter-branch)\\b',
    // [P1] 磁盘低层写操作 dd/mkfs/fdisk/parted/format
    '\\b(?:dd|mkfs(?:\\.\\w+)?|fdisk|parted|format)\\s',
    // [P1] Node fs.promises 删除（fs.promises.rm/unlink/rmdir）
    '\\bfs\\.promises\\.(?:rm(?:Sync)?|unlink(?:Sync)?|rmdir(?:Sync)?)\\s*\\(',
    // [P1] [IO.File]::Delete / [IO.Directory]::Delete（无需 System.IO. 前缀）
    '\\[\\s*IO\\.(?:File|Directory)\\s*\\]::Delete',
    // [P1] docker compose run/exec（现有 docker run/exec 规则之外）
    '\\bdocker\\s+compose\\s+(?:run|exec)\\b',
    // T11/Finding 18（用户实测）：回收站清空绕过缺口——Clear-RecycleBin / cleanmgr / $Recycle.Bin 直删
    // 拦的是 Agent 的工具调用；用户手动清空回收站是正常操作，不受影响。
    '\\bClear-RecycleBin\\b',
    '\\bcleanmgr(?:\\.exe)?\\b',
    '\\b(?:remove-item|del|erase|rd|rmdir|rm|unlink|shred|rimraf|ri)\\b[^|;&\\r\\n]{0,120}\\$recycle\\.bin',
    '\\$recycle\\.bin[^|;&\\r\\n]{0,120}\\b(?:remove-item|del|erase|rd|rmdir|rm|unlink|shred|rimraf|ri)\\b',
  ];
}

const QUOTE = JSON.stringify;

/** Claude Code：PreToolUse hook JSON 片段（filter 黑名单 + 拒绝理由） */
export function planClaudeHook(rules: GuardRules): DeployPlan {
  const matchers = rules.map((re) => ({ type: 'regex', pattern: re, hide: false }));
  return {
    agent: 'claude-code', mode: 'plan',
    target: '~/.claude/settings.json → hooks.PreToolUse',
    intent: '在 Bash/PowerShell 工具调用前拦截永久删除/高危命令，命中即 deny（回收站铁律）',
    content: QUOTE({
      hooks: { PreToolUse: [{ matcher: 'Bash|PowerShell', hooks: [{ type: 'filter', matchers }] }] },
    }, null, 2),
  };
}

/** Claude Code：settings.json permissions 默认 deny 段（sandbox 兜底） */
export function planClaudePermissions(): DeployPlan {
  return {
    agent: 'claude-code', mode: 'plan',
    target: '~/.claude/settings.json → permissions',
    intent: '允许列表式授权：未显式允许的 BypassPermissions 一律 ask/deny（fail-closed 兜底）',
    content: QUOTE({
      permissions: {
        allow: [], deny: [], ask: [],
        additionalDirectories: [], defaultMode: 'default',
      },
    }, null, 2),
  };
}

/** Codex：AGENTS.md 规则片段（Codex 1.1 rules 语法） */
export function planCodexRules(): DeployPlan {
  const lines = [
    '# RiskGuard 安全规则（自动生成，勿手改）',
    '',
    '## 删除铁律',
    '所有删除操作必须先将目标移入回收站（SendToRecycleBin），禁止永久删除：',
    '禁止 rm -rf / Remove-Item -Force / del /f / rmdir /s /q / rd /s /q；',
    '禁止 shutil.rmtree / os.remove / os.unlink / pathlib.unlink；',
    '禁止 fs.rmSync / fs.unlinkSync / rimraf；',
    '禁止 find -delete 与 find -exec rm。',
    '',
    '## 高危命令',
    '禁止格式化磁盘（Format-Volume / diskpart / Clear-Disk）。',
    'git reset --hard 与 git clean -fdx 需人工确认。',
    '禁止从远程 URL 直接管道执行（curl|bash 等）。',
    '',
    '## 受保护资源（只读）',
    '.riskguard/ 与回收站配置目录禁止修改。',
    '',
  ].join('\n');
  return {
    agent: 'codex', mode: 'plan',
    target: 'AGENTS.md（项目根或 ~/.codex/AGENTS.md）',
    intent: '以自然语言规则约束模型行为（rules 机制），与 sandbox 配置互补',
    content: lines,
  };
}

/** DSH：cordis.patch.yml 插件 insert 片段（文档 §22 标注「按目标 DSH 版本核对」） */
export function planDshPatch(rules: GuardRules): DeployPlan {
  // P0-2/P1-1 修复（audit）：YAML 单引号字符串中反斜杠是字面量（不得转义），
  // 唯一需转义的是单引号本身（' → ''）。旧版 replace(/\\/g,'\\\\') 会让 35 条正则全部语义错误。
  const ruleLines = rules.map((re) => `          - { re: '${re.replace(/'/g, "''")}', reason: 'RiskGuard：删除必须进回收站' }`).join('\n');
  return {
    agent: 'dsh', mode: 'plan',
    target: '~/.dsh/profiles/<profile>/cordis.patch.yml → insert deny-risk-commands',
    intent: 'pre-execute 门禁：命中黑名单的 pwsh/bash 在派发前拒绝（对齐本机既有 deny-risk-commands）',
    content: `# RiskGuard 生成的 deny-risk-commands（追加到 cordis.patch.yml insert 数组）\n- insert:\n    - id: deny-risk-commands\n      name: 'deny-risk-commands'\n      config:\n        rules:\n${ruleLines}\n`,
  };
}

/** 按 agent 生成部署计划列表 */
export function planAll(): DeployPlan[] {
  const rules = defaultDenyRules();
  return [
    planClaudeHook(rules),
    planClaudePermissions(),
    planCodexRules(),
    planDshPatch(rules),
  ];
}