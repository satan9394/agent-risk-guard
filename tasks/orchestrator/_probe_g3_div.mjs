// G3 证据：跨端 decision 分歧清单（ps1 vs sh，真实 spawn + 进程 stdin）
import { spawnSync } from 'node:child_process';
const ROOT = 'E:/DeepSeek_Harness/workspace/2026_08_21';
const PS1 = `${ROOT}/agent-risk-guard-audit/scripts/dangerous-commands.ps1`;
const SH = `${ROOT}/agent-risk-guard-audit/scripts/dangerous-commands.sh`;
const toWsl = (p) => p.replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`).replace(/\\/g, '/');
const run = (bin, args, input) => {
  const r = spawnSync(bin, args, { input, encoding: 'utf8', timeout: 60000 });
  const s = (r.stdout ?? '').trim();
  if (!s) return `EMPTY(exit=${r.status})`;
  try { const j = JSON.parse(s); return j.hookSpecificOutput?.permissionDecision ?? j.permissionDecision ?? 'NODECISION'; }
  catch { return 'INVALID-JSON'; }
};
const ps1 = (i) => run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS1], i);
const sh = (i) => run('wsl.exe', ['-e', 'bash', toWsl(SH)], i);
const J = (cmd) => JSON.stringify({ tool_name: 'Bash', tool_input: { command: cmd } });

const cases = [
  ['T1 变量+反斜杠混淆',      J('$x="r\\m"; $x -rf /tmp/t')],
  ['T2 变量+大写',            J('$X=RM; $X -RF /tmp/t')],
  ['T3 rm空引号+--help',      J("rm'' --help")],
  ['T4 反斜杠插字',           J('r\\m -rf /tmp/t')],
  ['T5 全大写 RM',            J('RM -RF /tmp/t')],
  ['T6 尾随LF（裸控制字符）', J('git status\n')],
  ['T7 尾随TAB',              J('git status\tx')],
  ['T8 命令中间TAB',          J('git\tstatus')],
  ['T9 command:null',         JSON.stringify({ tool_name: 'Bash', tool_input: { command: null } })],
  ['T10 command:数组',        JSON.stringify({ tool_name: 'Bash', tool_input: { command: ['rm', '-rf', '/tmp/t'] } })],
  ['T11 首行#注释+危险',      J('# note\nrm -rf /tmp/t')],
  ['T12 危险+次行#注释',      J('rm -rf /tmp/t\n# note')],
  ['T13 空 command',          J('')],
  ['T14 非Bash工具',          JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '/etc/passwd' } })],
  ['T15 对照：危险命令',      J('rm -rf /tmp/t')],
  ['T16 对照：安全命令',      J('git status')],
  ['T17 前导空白+危险',       J('   rm -rf /tmp/t')],
  ['T18 分号串联',            J('echo a; rm -rf /tmp/t')],
  ['T19 管道串联',            J('echo a | rm -rf /tmp/t')],
  ['T20 换行串联',            J('echo a\nrm -rf /tmp/t')],
];

console.log('===== G3 跨端 decision 分歧清单 =====');
let div = 0;
for (const [n, i] of cases) {
  const p = ps1(i), s = sh(i);
  const same = p === s;
  if (!same) div++;
  console.log(`${same ? '  same' : '>>DIFF'}  ${n.padEnd(24)} ps1=${String(p).padEnd(12)} sh=${s}`);
}
console.log(`\n分歧数 = ${div} / ${cases.length}`);
