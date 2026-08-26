/**
 * normalize.ts — Vendor Payload → RiskEvent 归一化（Adapter Contract v1）
 *
 * 原则（文档 §15）：Adapter 不允许自己重新定义安全规则，只能做
 *   Vendor Payload → Normalized Event → Decision → Vendor-specific Deny
 *
 * 本文件提供跨 Agent 的通用归一化基元，各家 Adapter（packages/adapters/*）负责
 * 把自家 payload 形状映射进来。正常化失败时返回 null，由调用方决定 fail-closed。
 */

import { createEvent, type RiskEvent, type EventTarget } from './event.ts';
import { resolvePath, type PathAnalysis } from './path-resolver.ts';
import { isDestructiveAction } from './risk-taxonomy.ts';
import type { Domain, Action } from './risk-taxonomy.ts';

/** 归一化失败的上下文（供 fail-closed 决策） */
export interface NormalizeFailure {
  ok: false;
  reason: string;
  raw?: unknown;
}

export interface NormalizeResult {
  ok: true;
  event: RiskEvent;
}

export type NormalizeOutcome = NormalizeResult | NormalizeFailure;

/** 全角字符规范化（P0-27 修复：ｒｍ　－ｒｆ　／ 全角 → ASCII，防 Unicode 绕过） */
export function normalizeFullWidth(cmd: string): string {
  return cmd
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' '); // 全角空格 → ASCII 空格
}

/** 判断命令是否为明确只读/无害的开发命令（白名单初筛，非能力边界） */
export function isReadOnlyCommand(cmd: string): boolean {
  const c = normalizeFullWidth(cmd).toLowerCase().trim();
  // 恶意/破坏性模式优先排除（避免只读前缀+破坏后缀绕过）
  if (classifyShellCommand(c) !== null) return false;
  // 只读/无害家族
  // rm 仅 help/version 形式无害（P1-1 回归：rm --help / rm 无参不是删除）
  if (/^rm(\s+(--?h(?:elp)?|--version|-h|-V))?\s*$/.test(c)) return true;
  // git：push/branch 白名单必须排除危险标志（P0-6：--force/-D 曾被放行）
  return (
    /^(git\s+(status|diff|log|show|remote|fetch|pull)\b|ls\b|cat\b|head\b|tail\b|pwd\b|echo\b|grep\b|date\b|whoami\b|mkdir\b|touch\b|find\s+.+)(\s|$)/.test(c) ||
    /^git\s+push\s+(?!.*(--force|-f\b))/.test(c) ||
    /^git\s+branch\s*(?!.*\s-[dDmMcC])/.test(c) ||
    /^git\s+branch\s+-[aA]\b/.test(c) ||
    /^(npm|npx|pnpm|yarn|bun|uv|deno|cargo)\s+(test|run|build|lint|format|check|install|add|ci|exec|pub)\b/.test(c) ||
    /^npx\s+\S+/.test(c) ||
    /^node\s+(-e|-v|--version|-p)\b/.test(c)
  );
}

/** Command → domain/action 分类（shell 字符串启发式，fast-path 检测） */
export interface ShellClassified {
  domain: Domain;
  action: Action;
  confidence: number; // 0..1
  destructive?: boolean; // 显式标记破坏性（如远程管道执行）
}

/** 判断命令是否落入某个已知破坏性模式（供 fast-path/telemetry；不是能力边界） */
export function classifyShellCommand(cmd: string): ShellClassified | null {
  const c = normalizeFullWidth(cmd).toLowerCase().trim();
  // RM_SEG：命令/分隔符边界后的 rm（含 /bin/ 完整路径、换行分隔符，P0-1/P2-2）
  const RM_SEG = '(?:^|[;&|/\\n\\r])\\s*rm\\s+';
  // HELP_OK：rm --help / rm -h / rm --version → 无害，排除（P1-1）
  const RM_HELP = '(?!--?h(?:elp)?\\b|--version\\b)';

  // 永久删除家族
  // rm：需真实目标，排除 help（P1-1）；上下文含完整路径与换行（P0-1/P2-2）
  if (new RegExp(RM_SEG + RM_HELP + '(-[a-z]*r)?-?[a-z]*f?\\S').test(c)) {
    return { domain: 'filesystem', action: 'delete', confidence: 0.9 };
  }
  if (/remove-item|\bdel\s+|\berase\b|\brmdir\s+|\brd\s+/.test(c)) {
    return { domain: 'filesystem', action: 'delete', confidence: 0.9 };
  }
  // shred/unlink：任意后缀（M7 fuzz 发现：shred; 与 unlink files 均需覆盖）
  if (/\b(shred|unlink)\b\s*/.test(c)) {
    return { domain: 'filesystem', action: 'delete', confidence: 0.9 };
  }
  // Python 直删 + 动态导入（P0-7：__import__/importlib）
  if (/shutil\.rmtree|os\.remove|os\.unlink|os\.rmdir|pathlib.*\.unlink|(?:pathlib\.)?(?:pure)?path\.unlink|path\.rmdir|__import__\s*\(\s*['"]shutil['"]\s*\)\s*\.rmtree|importlib\.import_module\s*\(\s*['"]shutil['"]\s*\)\s*\.rmtree/.test(c)) {
    return { domain: 'filesystem', action: 'delete', confidence: 0.95 };
  }
  // Node fs + child_process（P0-7：execSync/promises.rm）
  if (/require\(['"]fs['"]\)\.(rmsync|rm|unlink|unlinksync|rmdir|rmdirsync)\s*\(|fs\.(rmsync|rm|unlink|unlinksync|rmdir|rmdirsync)\s*\(|\.promises\.rm\s*\(|rimraf/.test(c)) {
    return { domain: 'filesystem', action: 'delete', confidence: 0.95 };
  }
  if (/child_process[^)]*\)\s*\.\s*(execsync|exec|spawn)(\s|\()|\.execsync\s*\(['"][^'"]*rm\b/i.test(c)) {
    return { domain: 'filesystem', action: 'delete', confidence: 0.9 };
  }
  if (/\bfind\b[^|;&\n]*\s-delete/.test(c) || /\bfind\b[^|;&\n]*\s(-exec|-ok)\s+rm\b/.test(c)) {
    return { domain: 'filesystem', action: 'delete', confidence: 0.9 };
  }
  // 批量/循环删除（M7 + P0-9：xargs 任意标志）
  if (/\bxargs\b[^|;&\n]*\brm\b|\bfor\b[^;]*;\s*do[^;]*\brm\b/.test(c)) {
    return { domain: 'filesystem', action: 'delete', confidence: 0.85 };
  }
  // .NET 短名/反射删除（M7：IO.File.Del 短名绕过 System. 前缀；c 已 toLowerCase）
  if (/\[(?:system\.)?io\.(?:file|directory)\]::(?:delete|remove|move|copy)/.test(c)) {
    return { domain: 'filesystem', action: 'delete', confidence: 0.9 };
  }

  // git 破坏性（P0-6/P2-6：push --force / branch -D / restore / checkout --）
  if (/\bgit\s+clean\s+-f/.test(c) || /\bgit\s+reset\s+--hard/.test(c)) {
    return { domain: 'git', action: c.includes('clean') ? 'git_clean' : 'git_reset', confidence: 0.95 };
  }
  if (/\bgit\s+checkout\s+--\s*[^;]*(\s|$)/.test(c) || /\bgit\s+restore\b/.test(c)) {
    return { domain: 'git', action: 'git_checkout_discard', confidence: 0.9 };
  }
  if (/\bgit\s+push\s+.*(--force|-f\b)/.test(c)) {
    return { domain: 'git', action: 'git_reset', confidence: 0.85 };
  }
  if (/\bgit\s+branch\s+-[dD]/.test(c)) {
    return { domain: 'git', action: 'git_checkout_discard', confidence: 0.85 };
  }
  // R2 新向量：git gc --prune / git reflog expire（不可恢复历史清除）
  if (/\bgit\s+gc\b[^|;&\n]*--prune/.test(c) || /\bgit\s+reflog\s+expire\b/.test(c)) {
    return { domain: 'git', action: 'git_reset', confidence: 0.85 };
  }

  // cp/mv：普通复制/移动放行（P1-4 修复：不打扰、不当只读）；强制覆盖归 overwrite
  if (/\b(cp|mv|copy-item|move-item)\s+.*--?f(?:\b|$)/.test(c)) {
    return { domain: 'filesystem', action: 'overwrite', confidence: 0.8 };
  }
  if (/^cp\b|^mv\b|^copy-item\b|^move-item\b/.test(c)) {
    return { domain: 'filesystem', action: 'move', confidence: 0.7 };
  }

  // 磁盘（P0-8：mkfs / dd(任意标志序) / wipefs）
  if (/format-(volume|partition|drive)|diskpart|clear-disk|mkdirfs|\bmkfs\b|\bwipefs\b|\bdd\b[^|;&\n]*\bof=/.test(c)) {
    return { domain: 'filesystem', action: 'delete', confidence: 0.85 };
  }
  // R2 新向量：Windows 注册表删除（reg delete）
  if (/\breg\s+delete\b|\breg\s+delete\s+HK/i.test(c)) {
    return { domain: 'filesystem', action: 'delete', confidence: 0.9 };
  }
  // R2 新向量：certutil 下载/解码执行（绕过 PowerShell 策略的经典下载器）
  if (/\bcertutil\b[^|;&\n]*(-urlcache|-decode)/.test(c)) {
    return { domain: 'process', action: 'execute', confidence: 0.85, destructive: true };
  }
  // R2 新向量：docker run/exec 挂载宿主卷后容器内删除（容器逃逸等效）
  if (/\bdocker\s+(run|exec)\b[^|;&\n]*\b(rm|rmdir|remove-item|shutil|rmtree|delete)\b/.test(c)) {
    return { domain: 'process', action: 'execute', confidence: 0.9, destructive: true };
  }

  // 危险子进程执行：eval / bash -c / sh -c 包裹（P0-2）
  if (/\beval\s+.*\b(rm\b|remove-item|del\s|rmdir|shutil|fs\.rm)/.test(c) ||
      /\b(bash|sh|pwsh|powershell)\s+-c\s+['"].*\b(rm\s+-rf|remove-item|rmdir\s*\/s|shutil\.rmtree|fs\.rmSync|eval\b)/.test(c)) {
    return { domain: 'process', action: 'execute', confidence: 0.9, destructive: true };
  }
  // 两阶段写+执行（P0-4：echo ... > x.sh && bash x.sh / printf | bash）
  if (/>(?:\s*["']?)[^&|;<>]+\.(sh|bash|ps1|bat|cmd)\b.*&&\s*(bash|sh|pwsh|powershell)/.test(c) ||
      /\b(printf|echo)\s+.*['"]?(rm\b|remove-item|rmdir)[^|]*\|\s*(bash|sh)\b/.test(c)) {
    return { domain: 'process', action: 'execute', confidence: 0.9, destructive: true };
  }
  // 编码管道执行（P0-5：base64 -d|bash / xxd / printf|bash）
  if (/\b(base64|xxd|openssl|printf)\b[^|]*\|\s*(bash|sh|pwsh|powershell)/.test(c)) {
    return { domain: 'process', action: 'execute', confidence: 0.95, destructive: true };
  }
  // 远程内容管道执行（curl|bash / wget|sh 等）→ 标记为破坏性 execute（T3/T6）
  if (/(curl|wget|iwr|invoke-webrequest).{0,80}\|\s*(bash|sh|pwsh|powershell)/.test(c)) {
    return { domain: 'process', action: 'execute', confidence: 0.95, destructive: true };
  }
  // 内容不可见执行（M7：编码命令 / 变量拼接执行 / IEX 下载，P0-10）→ fail-closed 方向
  if (/powershell\s+-(enc|e|encodedcommand)|pwsh\s+-(enc|e|encodedcommand)/i.test(c)) {
    return { domain: 'process', action: 'execute', confidence: 0.9, destructive: true };
  }
  if (/\biex\s+\$|invoke-expression\s+\$/.test(c) ||
      /(iex|invoke-expression)[^|;&]*\b(new-object|webclient|downloadstring|downloadfile)/i.test(c)) {
    return { domain: 'process', action: 'execute', confidence: 0.85, destructive: true };
  }
  // Python/Node 动态执行（P0-7：subprocess.run / __import__）
  if (/\bsubprocess\.(run|call|popen|check_output)\s*\(/i.test(c)) {
    return { domain: 'process', action: 'execute', confidence: 0.8, destructive: true };
  }

  // 归档覆盖解压（P0-11：tar --overwrite / unzip -o）
  if (/\btar\b[^|;&\n]*--overwrite\b|\bunzip\b[^|;&\n]*\s-o\b/.test(c)) {
    return { domain: 'filesystem', action: 'overwrite', confidence: 0.7 };
  }

  // 危险子进程：shutdown/reboot
  if (/shutdown|reboot|invoke-expression.*(download|remove)/.test(c)) {
    return { domain: 'process', action: 'execute', confidence: 0.7 };
  }

  // 凭据导出（M7 + P2-8：任意 *_TOKEN/*_SECRET/*_PASSWORD 名 + printenv）
  if (/(echo|print|printenv|type|write-output|display)\s+(\$env:)?[a-z0-9_]*(token|secret|password|api[-_]?key|credential|aws_|azure_|github_|npm_|stripe_|twilio_)[a-z0-9_]*/i.test(c)) {
    return { domain: 'credentials', action: 'credential_export', confidence: 0.9 };
  }

  return null;
}

/** 从命令字符串提取疑似路径目标 */
export function extractTargetsFromCommand(cmd: string, cwd?: string, home?: string): EventTarget[] {
  const targets: EventTarget[] = [];
  // 常见模式：rm -rf <path> / Remove-Item <path> / del <path> / shutil.rmtree('<path>')
  const patterns = [
    // P2-32 修复：排除 - 开头的 flags 与尾随分隔符（rm -rf 不再误提取 -rf 为路径）
    /(?:rm\s+(?:-[a-z]+\s+)*|remove-item\s+(?:-[a-z]+:\s*\S+\s+)*|del\s+)(["']?)(?!-)([^\s"';|&]+)\1/gi,
    /(?:shutil\.rmtree|os\.remove|os\.unlink)\(\s*["']([^"']+)["']/gi,
    /(?:fs\.(?:rm|unlink)Sync|fs\.(?:rm|unlink))\(\s*["']([^"']+)["']/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(cmd)) !== null) {
      // 组1 = 可选引号，组2 = 实际路径（引用路径时）｜未引用时路径在组1
      const rawPath = (m[2] ?? m[1] ?? '').trim();
      if (!rawPath) continue;
      try {
        const analysis = resolvePath(rawPath, cwd, home);
        targets.push(targetFromPath(rawPath, analysis));
      } catch {
        targets.push({ kind: 'path', raw: rawPath, scope: 'unknown' });
      }
    }
  }
  return targets;
}

/** 构造路径类 EventTarget（补充 canonical + scope） */
export function targetFromPath(raw: string, analysis: PathAnalysis, workspaceRoot?: string): EventTarget {
  return {
    kind: 'path',
    raw,
    canonical: analysis.canonical,
    scope: workspaceRoot && isInside(analysis.canonical, workspaceRoot) ? 'workspace' : 'system',
    tags: [],
  };
}

function isInside(canonical: string, root: string): boolean {
  const c = canonical.toLowerCase();
  const r = root.toLowerCase().replace(/[\\/]+$/, '');
  return c === r || c.startsWith(r + '\\') || c.startsWith(r + '/');
}

/**
 * 统一入口：给一个已归一化的 vendor 事件形状（简单约定）与上下文，产出 RiskEvent。
 * 各家 Adapter 可复用此函数做跨平台归一化公共部分。
 */
export function normalizeEvent(input: {
  agent: string;
  surface: string;
  domain: Domain;
  action: Action;
  destructive?: boolean; // 显式覆盖破坏性判断（如远程管道执行）
  commandRaw?: string | null;
  targetsRaw?: string[];
  cwd?: string;
  home?: string;
  workspaceRoot?: string;
  tool?: string;
  sink?: string; // 原始 payload 摘要（供审计）
}): NormalizeOutcome {
  const { agent, surface, domain, action } = input;
  if (!agent || !surface || !domain || !action) {
    return { ok: false, reason: 'missing required fields (agent/surface/domain/action)', raw: input };
  }

  const targets: EventTarget[] = [];
  if (input.targetsRaw) {
    for (const raw of input.targetsRaw) {
      try {
        const analysis = resolvePath(raw, input.cwd, input.home);
        targets.push(targetFromPath(raw, analysis, input.workspaceRoot));
      } catch {
        targets.push({ kind: 'path', raw, scope: 'unknown' });
      }
    }
  }
  if (input.commandRaw) {
    const extracted = extractTargetsFromCommand(input.commandRaw, input.cwd, input.home);
    for (const t of extracted) {
      if (!targets.some((x) => x.raw === t.raw)) targets.push(t);
    }
  }

  const destructive = input.destructive ?? isDestructiveAction(domain, action);
  const event = createEvent({
    source: { agent, surface, tool: input.tool },
    operation: { domain, action, destructive, reversible: !destructive },
    targets,
    command: input.commandRaw ? { raw: input.commandRaw, shell: 'unknown', parseConfidence: 1.0 } : undefined,
    context: input.cwd ? { cwd: input.cwd } : undefined,
  });

  return { ok: true, event };
}