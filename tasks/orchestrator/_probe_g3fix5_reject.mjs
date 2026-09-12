// 我方确认 FIX5 新缺陷：ps1 锚化删掉「包装词/子 shell」前缀覆盖
import { spawnSync } from 'node:child_process';
const ROOT = 'E:/DeepSeek_Harness/workspace/2026_08_21';
const PS1 = `${ROOT}/agent-risk-guard-audit/scripts/dangerous-commands.ps1`;
const SH = `${ROOT}/agent-risk-guard-audit/scripts/dangerous-commands.sh`;
const toWsl = (p) => p.replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`).replace(/\\/g, '/');
const run = (bin, args, input) => {
  const r = spawnSync(bin, args, { input, encoding: 'utf8', timeout: 60000 });
  const s = (r.stdout ?? '').trim();
  if (!s) return 'allow';
  try { const j = JSON.parse(s); return (j.hookSpecificOutput?.permissionDecision ?? '?') === 'deny' ? 'deny' : 'allow'; } catch { return 'INVALID'; }
};
const ps1 = (i) => run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS1], i);
const sh = (i) => run('wsl.exe', ['-e', 'bash', toWsl(SH)], i);
const J = (c) => JSON.stringify({ tool_name: 'Bash', tool_input: { command: c } });

const cases = [
  ['包装: time diskpart',        'time diskpart',                  'deny'],
  ['包装: nice rmdir /s /q',     'nice rmdir /s /q x',             'deny'],
  ['包装: nohup rmdir',          'nohup rmdir /s /q x',            'deny'],
  ['包装: time format C:',       'time format C: /q',              'deny'],
  ['子shell: ( rmdir )',         '(rmdir /s /q x)',                'deny'],
  ['块: { rmdir; }',             '{ rmdir /s /q x; }',             'deny'],
  ['条件: if then rmdir',        'if true; then rmdir /s /q x; fi','deny'],
  ['循环: for do del',           'for i in 1; do del x; done',     'deny'],
  ['对照 裸 rmdir',              'rmdir /s /q x',                  'deny'],
  ['对照 裸 diskpart',           'diskpart',                       'deny'],
  ['反向守卫: x diskpart 应allow','x diskpart',                    'allow'],
  ['反向守卫: sudo git status',  'sudo git status',                'allow'],
  ['反向守卫: git status',       'git status',                     'allow'],
];

let bad = 0;
console.log('===== FIX5 包装/子shell 前缀覆盖（ps1 vs sh vs 应然）=====');
for (const [n, c, want] of cases) {
  const p = ps1(J(c)), s = sh(J(c));
  const ok = p === want;   // 本卡只判 ps1 是否达到应然；sh 的既存更宽单独标注
  if (!ok) bad++;
  console.log(`${ok ? '  OK  ' : '>>FAIL'} ${n.padEnd(28)} 应然=${want.padEnd(6)} ps1=${p.padEnd(6)} sh=${s}`);
}
console.log(`\nps1 不达应然数 = ${bad} / ${cases.length}`);
