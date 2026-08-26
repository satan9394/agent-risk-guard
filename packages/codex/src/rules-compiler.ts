/**
 * codex/rules-compiler.ts — M5 Codex Rules Compiler
 *
 * 将 RiskGuard 结构化策略（defaultRules）编译为多 Agent 通用的自然语言规则：
 *   - AGENTS.md（Codex 1.1 / OpenCode / Claude Code 项目规则）
 *   - CLAUDE.md 兼容（Claude Code）
 * 生成基于默认策略的「永久删除禁止 / 高危命令 / 受保护资源」三段式，
 * 规则来源是策略引擎（单一事实源），避免手工维护漂移。
 */

import { defaultRules } from '../../core/src/rules/default-policy.ts';
import type { PolicyRule } from '../../core/src/policy-engine.ts';

export type RulesTarget = 'AGENTS.md' | 'CLAUDE.md';

export interface CompiledRules {
  target: RulesTarget;
  content: string;
  ruleCount: number;
}

const HEADER = `# RiskGuard 安全规则（自动生成 —— 请勿手改）

> 单一事实源：agent-risk-guard/packages/core/src/rules/default-policy.ts
> 生成时间：{{timestamp}}

## 铁律

1. **所有删除必须进回收站**（SendToRecycleBin / 系统回收站）。永久删除（rm -rf、
   Remove-Item -Force、del /f、rmdir /s /q、rd /s /q、shutil.rmtree、os.remove、
   pathlib.unlink、fs.rmSync/rm/unlink、rimraf、find -delete、find -exec rm、
   shred、unlink、xargs rm、for 循环 rm、引号插词变体 r'm、全角字符变体 ｒｍ、
   变量赋值执行 $x="rm..."）一律禁止；不要用 echo/cat 管道、$() 子展开、反引号
   或 eval/bash -c 包裹绕过这些规则。
2. **禁止格式化与磁盘级操作**：Format-Volume / Format-Partition / diskpart / Clear-Disk /
   mkfs / fdisk / wipefs / dd 写设备 / truncate 块设备。
3. **禁止远程内容执行**：curl|bash、wget|sh、iwr|pwsh、echo|bash、cat|bash、
   base64 -d|bash、IEX/Invoke-Expression + WebClient 下载执行、certutil 下载/解码执行、
   subprocess/child_process 动态执行。
4. **git 破坏性操作禁止**：git clean -f、git reset --hard、git checkout --/restore、
   git push --force/-f、git branch -d/-D、git stash drop、git switch -C、
   git gc --prune、git reflog expire、git worktree remove --force。
5. **docker/wmic 破坏禁止**：docker system prune、docker volume rm/prune、
   wmic delete/shadowcopy。
6. **受保护资源只读**：RiskGuard 配置目录与已标记的敏感配置不可修改。
`;

/** 从策略规则生成人读条目（每条规则 → 一行描述） */
function ruleToLine(r: PolicyRule): string | null {
  const d = r.decision;
  if (d === 'allow') return null;
  const ctx = Array.isArray(r.match.action) ? r.match.action.join('/') : r.match.action;
  const tag = d === 'deny' ? '禁止' : '需确认';
  const scope = r.match.domain ? `[${r.match.domain}/${ctx}]` : `[${ctx}]`;
  return `${r.id} ${scope} ${tag}：${r.reason ?? r.id}`;
}

/** 编译为指定目标格式 */
export function compileRules(opts: { target?: RulesTarget; timestamp?: string } = {}): CompiledRules {
  const target = opts.target ?? 'AGENTS.md';
  const rules = defaultRules();
  const lines = rules
    .map(ruleToLine)
    .filter((x): x is string => x !== null);

  const detail = lines.length
    ? `\n## 策略明细\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`
    : '';

  const content = HEADER.replace('{{timestamp}}', opts.timestamp ?? new Date().toISOString()) + detail;

  return { target, content, ruleCount: lines.length };
}

/** 写入给定路径（默认仅计划模式；实际落盘由调用方控制） */
export async function writeRulesFile(path: string, opts: { target?: RulesTarget } = {}): Promise<{ ok: boolean; path: string; bytes: number }> {
  const compiled = compileRules({ target: opts.target });
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path, compiled.content, 'utf8');
  return { ok: true, path, bytes: Buffer.byteLength(compiled.content, 'utf8') };
}