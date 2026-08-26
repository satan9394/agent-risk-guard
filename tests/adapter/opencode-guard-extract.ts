/**
 * opencode-guard-extract.ts — 从插件源码提取纯检测核心（临时 TS 模块，Node 原生 type-stripping 执行）
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface PureCore {
  analyzeCommand: (cmd: string) => { blocked: boolean; policy?: string; reason?: string; command?: string };
  expandSegments: (cmd: string) => string[];
  extractSubshells: (s: string) => string[];
  detectPOSIX: (s: string) => { policy: string; reason: string } | null;
  detectPipe: (s: string) => { policy: string; reason: string } | null;
  detectGit: (s: string) => { policy: string; reason: string } | null;
}

export async function extractPureCore(): Promise<PureCore> {
  const src = readFileSync(
    'E:/DeepSeek_Harness/workspace/2026_08_21/agent-risk-guard-audit/scripts/opencode/destructive-operation-guard.ts',
    'utf8',
  );
  const start = src.indexOf('const HOME_RAW');
  const endMark = src.indexOf('// --- Trash tool');
  if (start === -1 || endMark === -1) throw new Error('extract: 切割标记未找到');
  // 从段尾往前找最近的文件头（含 import 行），从文件头整体取到 Trash tool 前
  // 更稳妥：取整个文件到 Trash tool 前，但移除 openode/polyfill 值导入
  let body = src.slice(0, endMark);
  // 移除 @opencode-ai/plugin 值导入（type-only 保留无碍）
  body = body
    .replace(/^import\s*\{\s*tool\s*\}\s*from\s*"@opencode-ai\/plugin"\s*$/gm, '')
    .replace(/^import\s+type\s+\{.*\}\s*from\s*"@opencode-ai\/plugin"\s*$/gm, '');
  // execSync 在段内无调用（仅 Trash tool 用）但保留 import 安全
  const tmp = mkdtempSync(join(tmpdir(), 'rg-opencode-'));
  const modPath = join(tmp, 'core.ts');
  writeFileSync(modPath, `${body}\n\nexport { analyzeCommand, expandSegments, detectPOSIX, detectPipe, detectGit, unwrapWrapper, splitStmts, extractSubshells, P };\n`);
  // 调试：打印 expandSegments 是否含 extractSubshells 调用
  const dbg = readFileSync(modPath, 'utf8');
  if (!dbg.includes('extractSubshells(inner)')) console.warn('EXTRACT-WARN: expandSegments 缺 extractSubshells 调用');
  try {
    const mod = await import(pathToFileURL(modPath).href);
    const core: PureCore = {
      analyzeCommand: mod.analyzeCommand,
      expandSegments: mod.expandSegments,
      extractSubshells: mod.extractSubshells,
      detectPOSIX: mod.detectPOSIX,
      detectPipe: mod.detectPipe,
      detectGit: mod.detectGit,
    };
    if (typeof core.analyzeCommand !== 'function') throw new Error('extract: analyzeCommand 未导出');
    return core;
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* 清理失败无碍 */ }
  }
}