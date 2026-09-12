// 确认 FIX6 两处新问题：①引号内括号被判为命令位（过拦）②包装词与 command|env 不可互串（放松）
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
  // ① 过拦：引号内/散文括号 —— 应 allow
  ['O printf {diskpart}',        "printf '{ diskpart }'",                 'allow'],
  ['O echo "(diskpart)"',        'echo "(diskpart)"',                     'allow'],
  ['O echo {diskpart}',          'echo "{ diskpart }"',                   'allow'],
  ['O echo (rm -rf)',            "echo '(rm -rf)'",                       'allow'],
  ['O commit msg (rm -rf)',      'git commit -m "fix (rm -rf)"',          'allow'],
  ['O grep -r (rm -rf)',         'grep -r "(rm -rf)" .',                  'allow'],
  ['O sed s/(rm -rf)/',          "sed -n 's/(rm -rf)/x/p' f",             'allow'],
  ['O ls (rm -rf)',              'ls (rm -rf)',                           'allow'],
  // ① 但真正的子 shell/块仍应 deny
  ['P 真子shell (rmdir)',         '(rmdir /s /q x)',                       'deny'],
  ['P 真块 { rmdir; }',          '{ rmdir /s /q x; }',                    'deny'],
  // ② 互串：应 deny（pre-G3 ps1 为 deny）
  ['I command time diskpart',    'command time diskpart',                 'deny'],
  ['I env nice diskpart',        'env nice diskpart',                     'deny'],
  ['I env sudo diskpart',        'env sudo diskpart',                     'deny'],
  ['I sudo time nohup diskpart', 'sudo time nohup diskpart',              'deny'],
  ['I command cmd /c diskpart',  'command cmd /c diskpart',               'deny'],
  // 对照
  ['K x diskpart',               'x diskpart',                            'allow'],
  ['K git status',               'git status',                            'allow'],
];

let overBlock = 0, relax = 0;
console.log('===== FIX6 两处问题确认 =====');
for (const [n, c, want] of cases) {
  const p = ps1(J(c)), s = sh(J(c));
  const okP = p === want, okS = s === want;
  if (!okP || !okS) { if (want === 'allow') overBlock++; else relax++; }
  console.log(`${(okP && okS) ? '  OK  ' : '>>FAIL'} ${n.padEnd(28)} 应然=${want.padEnd(6)} ps1=${p.padEnd(6)} sh=${s}`);
}
console.log(`\n过拦(应allow却deny) = ${overBlock}   放松(应deny却allow) = ${relax}   共 ${cases.length} 条`);
