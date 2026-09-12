// 编排者验证 FIX3：多行多种形态（含缩进/分号续行）在 sh vs ps1 生产出口是否一致且不泄漏
import { spawnSync } from 'node:child_process';
const ROOT = 'E:/DeepSeek_Harness/workspace/2026_08_21';
const PS1 = `${ROOT}/agent-risk-guard-audit/scripts/dangerous-commands.ps1`;
const SH = `${ROOT}/agent-risk-guard-audit/scripts/dangerous-commands.sh`;
const toWsl = (p) => p.replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`).replace(/\\/g, '/');
const inp = (c) => JSON.stringify({ tool_name: 'Bash', tool_input: { command: c } });
const run = (bin, args, c) => { const r = spawnSync(bin, args, { input: inp(c), encoding: 'utf8', timeout: 120000 }); try { return String(JSON.parse((r.stdout ?? '').trim()).systemMessage ?? ''); } catch { return `ERR exit=${r.status} ${String(r.stderr).slice(0,80)}`; } };
const exPs1 = (m) => { const x = /\n命令：([\s\S]*?)\n如确需执行/.exec(m); return x ? x[1] : null; };
const exSh = (m) => { const x = /Command: ([\s\S]*?)\nUse trash\/recycle bin/.exec(m); return x ? x[1] : null; };

const D = 'rm -rf /tmp/t';
const cases = [
  ['L2 mysql 全数字',        `echo start\nmysql -p12345678 -e "select 1"\n${D}`, '12345678'],
  ['L2 curl --user',         `echo start\ncurl --user alice:hunter2 https://x\n${D}`, 'hunter2'],
  ['L2 缩进 mysql',          `echo start\n   mysql -p12345678 -e "select 1"\n${D}`, '12345678'],
  ['分号+缩进续行 mysql',    `echo start;\n   mysql -p12345678 -e "select 1"\n${D}`, '12345678'],
  ['L3 mariadb',             `echo a\nfoo\nmariadb -p12345678\n${D}`, '12345678'],
  ['L1 对照',                `mysql -p12345678 -e "select 1"\n${D}`, '12345678'],
  ['L2 keep 邻居（不该红）', `echo start\nssh mysql -p2222 host\n${D}`, null],
];
let fail = 0;
console.log('===== sh vs ps1 生产出口（多行各形态）=====');
for (const [n, c, secret] of cases) {
  const s = exSh(run('wsl.exe', ['-e', 'bash', toWsl(SH)], c));
  const p = exPs1(run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS1], c));
  const same = s === p;
  let verdict;
  if (secret === null) { verdict = (s && s.includes('ssh mysql -p2222 host') && p && p.includes('ssh mysql -p2222 host')) ? 'OK' : 'FAIL'; }
  else { const sLeak = s?.includes(secret), pLeak = p?.includes(secret); verdict = (same && !sLeak && !pLeak) ? 'OK' : 'FAIL'; }
  if (verdict === 'FAIL') fail++;
  console.log(`\n[${verdict}] ${n}   一致=${same}`);
  console.log(`  sh  = ${JSON.stringify(s)}`);
  console.log(`  ps1 = ${JSON.stringify(p)}`);
}
console.log(`\nTOTAL-FAIL = ${fail}`);
