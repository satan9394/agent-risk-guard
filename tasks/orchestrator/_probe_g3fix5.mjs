// 我方验证 FIX5：向上对齐(sudo/路径前缀) + 空引号收敛
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
  // §A 向上对齐：应两端 deny
  ['A sudo chmod 777 /x',        'sudo chmod 777 /x',                 'deny'],
  ['A sudo find /tmp -delete',   'sudo find /tmp -delete',            'deny'],
  ['A /usr/bin/find -delete',    '/usr/bin/find /tmp -delete',        'deny'],
  ['A sudo xargs rm',            'echo x | sudo xargs rm',            'deny'],
  ['A sudo shutdown /s',         'sudo shutdown /s',                  'deny'],
  ['A 裸 chmod 777 /x',          'chmod 777 /x',                      'deny'],
  // §B 空引号收敛：应两端 deny
  ['B g-quote-quote-it clean',   "g''it clean -f",                    'deny'],
  ['B c-quote-quote-hmod 777',   "c''hmod 777 /x",                    'deny'],
  ['B R-quote-quote-MDIR',       "R''MDIR /s /q x",                   'deny'],
  ['B git cl-quote-quote-ean',   "git cl''ean -f",                    'deny'],
  // 必须仍 allow
  ['K rm-quote --help',          "rm'' --help",                       'allow'],
  ['K git status',               'git status',                        'allow'],
  ['K cat FORMAT.txt',           'cat FORMAT.txt',                    'allow'],
  ['K grep RM file.txt',         'grep RM file.txt',                  'allow'],
  // 删除族反向守卫：应 deny
  ['G r-quote-quote-m -rf',      "r''m -rf /tmp/t",                   'deny'],
  ['G R-quote-quote-emove-Item', "R''emove-Item /tmp/t",              'deny'],
  ['G rm -rf /tmp/t',            'rm -rf /tmp/t',                     'deny'],
];

let bad = 0;
console.log('===== FIX5 验证（ps1 vs sh vs 应然）=====');
for (const [n, c, want] of cases) {
  const p = ps1(J(c)), s = sh(J(c));
  const ok = (p === s) && (p === want);
  if (!ok) bad++;
  console.log(`${ok ? '  OK  ' : '>>FAIL'} ${n.padEnd(28)} 应然=${want.padEnd(6)} ps1=${p.padEnd(6)} sh=${s}`);
}
console.log(`\nFAIL 数 = ${bad} / ${cases.length}`);
