// 编排者确认 Evaluator 发现的「多行第2行起漏脱敏」缺陷
import { spawnSync } from 'node:child_process';
const ROOT = 'E:/DeepSeek_Harness/workspace/2026_08_21';
const PS1 = `${ROOT}/agent-risk-guard-audit/scripts/dangerous-commands.ps1`;
const SH = `${ROOT}/agent-risk-guard-audit/scripts/dangerous-commands.sh`;
const toWsl = (p) => p.replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`).replace(/\\/g, '/');
const inp = (cmd) => JSON.stringify({ tool_name: 'Bash', tool_input: { command: cmd } });
const run = (bin, args, cmd) => {
  const r = spawnSync(bin, args, { input: inp(cmd), encoding: 'utf8', timeout: 120000 });
  try { return String(JSON.parse((r.stdout ?? '').trim()).systemMessage ?? ''); } catch { return `ERR exit=${r.status}`; }
};
const exPs1 = (m) => { const x = /\n命令：([\s\S]*?)\n如确需执行/.exec(m); return x ? x[1] : null; };
const exSh = (m) => { const x = /Command: ([\s\S]*?)\nUse trash\/recycle bin/.exec(m); return x ? x[1] : null; };

const cases = [
  ['第2行 mysql -p<数字>', 'echo start\nmysql -p12345678 -e "select 1"\nrm -rf /tmp/t', '12345678'],
  ['第2行 curl --user', 'echo start\ncurl --user alice:hunter2 https://x\nrm -rf /tmp/t', 'hunter2'],
  ['第1行 mysql -p<数字>（对照）', 'mysql -p12345678 -e "select 1"\nrm -rf /tmp/t', '12345678'],
];
console.log('===== 多行第2行起是否漏脱敏（core/ps1 明文 vs sh 脱敏）=====');
for (const [n, cmd, secret] of cases) {
  const s = exSh(run('wsl.exe', ['-e', 'bash', toWsl(SH)], cmd));
  const p = exPs1(run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS1], cmd));
  const sLeak = s !== null && s.includes(secret), pLeak = p !== null && p.includes(secret);
  console.log(`\n[${n}]`);
  console.log(`  sh  = ${JSON.stringify(s)}`);
  console.log(`  ps1 = ${JSON.stringify(p)}`);
  console.log(`  sh 明文泄漏=${sLeak}   ps1明文泄漏=${pLeak}   一致=${s === p}${sLeak !== pLeak ? '  <<< 跨端发散' : ''}`);
}
