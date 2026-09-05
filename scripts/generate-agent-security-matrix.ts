/**
 * scripts/generate-agent-security-matrix.ts — Capability Matrix 自动生成（v0.2.0 §二十四）
 *
 * 从 packages/installer/compatibility.json（单一事实源）生成：
 *   docs/generated/agent-security-matrix.md
 * README 不再手工维护复杂兼容表；此脚本保证矩阵与 source 一致。
 *
 * 用法：
 *   node scripts/generate-agent-security-matrix.ts            # 生成
 *   node scripts/generate-agent-security-matrix.ts --check    # CI：漂移即 exit 1
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCompatibility, type CompatibilitySchemaV2 } from '../packages/installer/src/compatibility.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'generated', 'agent-security-matrix.md');

function row(...cells: string[]): string {
  return `| ${cells.join(' | ')} |`;
}

function generate(c: CompatibilitySchemaV2): string {
  const lines: string[] = [];
  lines.push('# Agent Security Matrix');
  lines.push('');
  lines.push(`> 自动生成自 \`packages/installer/compatibility.json\`（schemaVersion ${c.schemaVersion}，product ${c.productVersion}，ACS profile ${c.acsProfile ?? 'n/a'}）。`);
  lines.push('> 手工修改本文件无效；运行 `node scripts/generate-agent-security-matrix.ts` 重新生成。');
  lines.push('');
  lines.push('## 验证等级（D0–D4）');
  lines.push('');
  lines.push(row('等级', '定义'));
  lines.push(row('---', '---'));
  for (const [level, def] of Object.entries(c.levels)) {
    lines.push(row(level, def));
  }
  lines.push('');
  lines.push('## 安全执行边界（Compatibility v2）');
  lines.push('');
  lines.push('| Agent | Enforcement | Fail mode | 政策范围 | 用户可关闭 | Agent 可绕过 | Hook 失败语义 | 边界层 | 条件可用性 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const [id, a] of Object.entries(c.agents)) {
    const failMode = a.hookFailureSemantics ?? a.enforcementDetail?.failMode ?? 'unknown';
    const scope = (a.policy?.policyScope ?? []).join(',') || '—';
    const userDisable = a.bypass?.userCanDisable ?? 'unknown';
    const agentBypass = a.bypass?.agentCanBypass ?? 'unknown';
    const boundaries = (a.securityBoundaries ?? []).join(',') || '—';
    const cond = (a.conditionalAvailability ?? []).map((x) => `${x.feature}:${x.state}@${x.condition}`).join('; ') || '—';
    lines.push(row(id, a.enforcement, failMode, scope, userDisable, agentBypass, a.hookFailureSemantics ?? 'unknown', boundaries, cond));
  }
  lines.push('');
  lines.push('## Capability Matrix（per-surface 证据）');
  lines.push('');
  lines.push('| Agent | Capability | Enforcement | Windows | macOS | Linux |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const [id, a] of Object.entries(c.agents)) {
    const caps = a.capabilities ?? {};
    const entries = Object.entries(caps);
    if (entries.length === 0) {
      lines.push(row(id, '—', '—', '—', '—', '—'));
      continue;
    }
    entries.forEach(([cap, entry], i) => {
      const name = i === 0 ? id : '';
      const v = entry.verification ?? {};
      lines.push(row(name, cap, entry.enforcement, v['windows'] ?? '—', v['macos'] ?? '—', v['linux'] ?? '—'));
    });
  }
  lines.push('');
  lines.push('## Surface 覆盖（EvidenceState：supported / unsupported / unknown / not-applicable）');
  lines.push('');
  lines.push('| Agent | Shell | Filesystem | Git | MCP | Network |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const [id, a] of Object.entries(c.agents)) {
    const s = a.surfaces ?? {};
    lines.push(row(id, s['shell'] ?? '—', s['filesystem'] ?? '—', s['git'] ?? '—', s['mcp'] ?? '—', s['network'] ?? '—'));
  }
  lines.push('');
  lines.push('## 说明');
  lines.push('');
  lines.push('- EvidenceState 语义：`supported` 有证据支持 / `unsupported` 有证据不支持 / `unknown` 无证据（不是不支持）/ `not-applicable` 不适用。');
  lines.push('- Fail mode 与 Hard Deny 是两回事（v0.2.0 §三十二）：hard=true 只说明 hook 支持 DENY；hook 崩溃后 Agent 是否继续由 fail mode 描述。');
  lines.push('- "Hard at this enforcement point"（§三十五）：runtime-enforced deny before tool execution，不做"AI 无论如何都绕不过"式宣传。');
  lines.push('');
  return lines.join('\n');
}

function main(): number {
  const compat = loadCompatibility();
  const content = generate(compat);
  const check = process.argv.includes('--check');
  if (check) {
    if (!existsSync(OUT)) {
      console.error(`FAIL: ${OUT} missing — run generator without --check`);
      return 1;
    }
    const existing = readFileSync(OUT, 'utf8');
    if (existing !== content) {
      console.error(`FAIL: ${OUT} drifted from compatibility.json — run 'node scripts/generate-agent-security-matrix.ts'`);
      return 1;
    }
    console.log(`OK: ${OUT} up to date`);
    return 0;
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, content, 'utf8');
  console.log(`OK: generated ${OUT}`);
  return 0;
}

process.exit(main());
