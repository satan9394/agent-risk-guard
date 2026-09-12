// 确认 Evaluator 报的 G3 新缺陷：R2(数组含对象→fail-open) / R1(非rm族空引号新分歧) / R3(引号内文本被-i点着)
import { spawnSync } from 'node:child_process';
const ROOT = 'E:/DeepSeek_Harness/workspace/2026_08_21';
const PS1 = `${ROOT}/agent-risk-guard-audit/scripts/dangerous-commands.ps1`;
const SH = `${ROOT}/agent-risk-guard-audit/scripts/dangerous-commands.sh`;
const toWsl = (p) => p.replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`).replace(/\\/g, '/');
const run = (bin, args, input) => {
  const r = spawnSync(bin, args, { input, encoding: 'utf8', timeout: 60000 });
  const s = (r.stdout ?? '').trim();
  if (!s) return 'allow(EMPTY)';
  try { const j = JSON.parse(s); return j.hookSpecificOutput?.permissionDecision ?? 'NODECISION'; } catch { return 'INVALID-JSON'; }
};
const ps1 = (i) => run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS1], i);
const sh = (i) => run('wsl.exe', ['-e', 'bash', toWsl(SH)], i);
const J = (c) => JSON.stringify({ tool_name: 'Bash', tool_input: { command: c } });

const cases = [
  ['R2 数组含对象(应deny)',        JSON.stringify({ tool_name: 'Bash', tool_input: { command: [{ cmd: 'rm -rf /tmp/t' }] } })],
  ['R2b 双对象数组',               JSON.stringify({ tool_name: 'Bash', tool_input: { command: [{ a: 1 }, { b: 2 }] } })],
  ['R1 g\\\'\\\'it clean -f',      J("g''it clean -f")],
  ['R1 r\\\'\\\'mdir /s',          J("r''mdir /s")],
  ['R1 s\\\'\\\'hutdown /s',       J("s''hutdown /s")],
  ['R3 commit msg 含 shutdown',    J('git commit -m "remove SHUTDOWN path"')],
  ['R3b commit msg 含 chmod',      J('git commit -m "fix CHMOD docs"')],
  ['对照 rm-quote --help(应allow)', J("rm'' --help")],
  ['对照 git status(应allow)',     J('git status')],
];
console.log('===== G3 新缺陷：我方独立确认 =====');
let bad = 0;
for (const [n, i] of cases) {
  const p = ps1(i), s = sh(i);
  const same = p === s;
  if (!same) bad++;
  console.log(`${same ? '  same' : '>>DIFF'}  ${n.padEnd(30)} ps1=${String(p).padEnd(14)} sh=${s}`);
}
console.log(`\n分歧数 = ${bad}`);
