// G5 现状实测：fail-open / 非法 JSON / 多行放行（sh vs ps1 对照）
import { spawnSync } from 'node:child_process';
const ROOT = 'E:/DeepSeek_Harness/workspace/2026_08_21';
const PS1 = `${ROOT}/agent-risk-guard-audit/scripts/dangerous-commands.ps1`;
const SH = `${ROOT}/agent-risk-guard-audit/scripts/dangerous-commands.sh`;
const toWsl = (p) => p.replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`).replace(/\\/g, '/');

const raw = (bin, args, input) => {
  const r = spawnSync(bin, args, { input, encoding: 'utf8', timeout: 60000 });
  return { status: r.status, out: (r.stdout ?? ''), err: (r.stderr ?? '').slice(0, 120) };
};
const verdict = (o) => {
  const s = o.out.trim();
  if (s === '') return 'EMPTY(=无输出)';
  try { const j = JSON.parse(s); return 'JSON:' + (j.hookSpecificOutput?.permissionDecision ?? j.permissionDecision ?? '?'); }
  catch { return 'INVALID-JSON'; }
};

const TAB = String.fromCharCode(9);
const cases = [
  ['空 stdin',              ''],
  ['非法 JSON',             '{not json'],
  ['缺 command 字段',       JSON.stringify({ tool_name: 'Bash', tool_input: {} })],
  ['命令含 TAB',            JSON.stringify({ tool_name: 'Bash', tool_input: { command: `rm -rf /tmp/t${TAB}extra` } })],
  ['首行危险+次行#注释',    JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'rm -rf /tmp/t\n# note' } })],
  ['对照组：正常危险命令',  JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'rm -rf /tmp/t' } })],
];

console.log('===== G5 现状（sh 走 wsl.exe，ps1 走 powershell.exe）=====');
for (const [n, input] of cases) {
  const s = raw('wsl.exe', ['-e', 'bash', toWsl(SH)], input);
  const p = raw('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS1], input);
  console.log(`\n[${n}]`);
  console.log(`  sh  exit=${s.status}  ${verdict(s)}${s.err ? '  err=' + s.err.replace(/\s+/g, ' ') : ''}`);
  console.log(`  ps1 exit=${p.status}  ${verdict(p)}${p.err ? '  err=' + p.err.replace(/\s+/g, ' ') : ''}`);
}
