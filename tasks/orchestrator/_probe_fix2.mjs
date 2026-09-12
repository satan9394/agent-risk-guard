// 编排者极速决定性验证（G15b-FIX2）——复刻 parity 测试的生产出口调用
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const ROOT = 'E:/DeepSeek_Harness/workspace/2026_08_21';
const PS1 = `${ROOT}/agent-risk-guard-audit/scripts/dangerous-commands.ps1`;
const SH = `${ROOT}/agent-risk-guard-audit/scripts/dangerous-commands.sh`;
const D = 'rm -rf /tmp/t';
const toWsl = (p) => p.replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`).replace(/\\/g, '/');

const hookInput = (cmd) => JSON.stringify({ tool_name: 'Bash', tool_input: { command: cmd } });

function ps1Msg(cmd) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS1],
    { input: hookInput(cmd), encoding: 'utf8', timeout: 120000 });
  if (r.status !== 0) return `ERR exit=${r.status} ${r.stderr}`;
  try { const j = JSON.parse((r.stdout ?? '').trim()); return String(j.systemMessage ?? ''); }
  catch { return `ERR-parse ${String(r.stdout).slice(0, 120)}`; }
}
function shMsg(cmd) {
  const r = spawnSync('wsl.exe', ['-e', 'bash', toWsl(SH)],
    { input: hookInput(cmd), encoding: 'utf8', timeout: 120000 });
  if (r.status !== 0) return `ERR exit=${r.status} ${r.stderr}`;
  try { const j = JSON.parse((r.stdout ?? '').trim()); return String(j.systemMessage ?? ''); }
  catch { return `ERR-parse ${String(r.stdout).slice(0, 120)}`; }
}

const exPs1 = (m) => { const x = /\n命令：([\s\S]*?)\n如确需执行/.exec(m); return x ? x[1] : null; };
const exSh = (m) => { const x = /Command: ([\s\S]*?)\nUse trash\/recycle bin/.exec(m); return x ? x[1] : null; };

const CASES = [
  { n: 'F1-aws-space',  e: 'redact', p: 'aws configure set aws_secret_access_key TESTFIXTUREsecretVALUE0000000000000000', t: 'TESTFIXTUREsecretVALUE' },
  { n: 'F1-mysql-p',    e: 'redact', p: 'mysql -pSup3rS3cret -e "select 1"', t: 'Sup3rS3cret' },
  { n: 'F1-curl-u',     e: 'redact', p: 'curl -u alice:hunter2 https://example.com', t: 'hunter2' },
  { n: 'R1-curl-u-num', e: 'redact', p: 'curl -u alice:123456 https://example.com', t: 'alice:123456' },
  { n: 'R2-mysql-num',  e: 'redact', p: 'mysql -p12345678 -e "select 1"', t: '12345678' },
  { n: 'R2-ssh-mysql',  e: 'keep',   p: 'ssh mysql -p2222 host' },
  { n: 'R2-psql-mysql', e: 'keep',   p: 'psql -h mysql -p5432 -U postgres' },
  { n: 'R2-docker-user',e: 'keep',   p: 'docker run --user nginx:nginx nginx' },
  { n: 'R2-npm-user',   e: 'keep',   p: 'npm install --user alice:hunter2' },
  { n: 'K-ssh-port',    e: 'keep',   p: 'ssh -p2222 host' },
  { n: 'K-docker-p',    e: 'keep',   p: 'docker run -p 8080:80 nginx' },
];

console.log('ps1 exists =', existsSync(PS1), ' sh exists =', existsSync(SH));
let fail = 0;
for (const [end, get, ex] of [['sh', shMsg, exSh], ['ps1', ps1Msg, exPs1]]) {
  console.log(`\n========== ${end} 生产出口 ==========`);
  for (const c of CASES) {
    const msg = get(`${c.p}; ${D}`);
    const seg = ex(msg);
    if (seg === null) { console.log(`  [ERR ] ${c.n.padEnd(15)} 无法抽出命令段: ${msg.slice(0, 90)}`); fail++; continue; }
    const redacted = seg.includes('[REDACTED]');
    const plain = c.t ? seg.includes(c.t) : seg.includes(c.p);
    const ok = c.e === 'redact' ? (redacted && !plain) : !redacted && seg.includes(c.p);
    if (!ok) fail++;
    console.log(`  [${ok ? 'OK  ' : 'FAIL'}] ${c.n.padEnd(15)} expect=${c.e.padEnd(6)} redacted=${String(redacted).padEnd(5)} plaintext=${plain}`);
  }
}

console.log('\n========== 多行（R2 跨行根因）==========');
const ml = `echo mysql\npsql -p5432 -U postgres\n${D}`;
const s1 = exSh(shMsg(ml)) ?? 'ERR', s2 = exPs1(ps1Msg(ml)) ?? 'ERR';
console.log('  sh  =', JSON.stringify(s1));
console.log('  ps1 =', JSON.stringify(s2));
console.log('  两端一致 =', s1 === s2, ' | sh 误红他命令端口 =', s1.includes('[REDACTED]') && s1.includes('psql'), ' | ps1 误红 =', s2.includes('[REDACTED]') && s2.includes('psql'));
console.log('\nTOTAL-FAIL =', fail);
