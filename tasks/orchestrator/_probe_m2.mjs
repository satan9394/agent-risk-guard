// F2 闸门灵敏度：把 sh 的 redact_cmd 改成直通，parity PART B 必须变红
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = 'E:/DeepSeek_Harness/workspace/2026_08_21';
const SH = `${ROOT}/agent-risk-guard-audit/scripts/dangerous-commands.sh`;
const toWsl = (p) => p.replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`).replace(/\\/g, '/');

const src = readFileSync(SH, 'utf8');
const i = src.indexOf('redact_cmd()');
console.log('redact_cmd 定义位置 =', i);
if (i < 0) { console.log('MUTATION-FAILED: 找不到 redact_cmd()'); process.exit(1); }
// 在函数体开头插入直通返回
const brace = src.indexOf('{', i);
const mutant = src.slice(0, brace + 1) + `\n  printf '%s' "$1"; return 0\n` + src.slice(brace + 1);

const dir = mkdtempSync(join(tmpdir(), 'rgm2-'));
const mfile = join(dir, 'mutant.sh');
writeFileSync(mfile, mutant, 'utf8');
console.log('mutant =', mfile);

const r = spawnSync('node', ['--test', 'test/redact-parity.test.ts'], {
  cwd: `${ROOT}/agent-risk-guard/packages/core`,
  encoding: 'utf8',
  timeout: 400000,
  env: { ...process.env, RG_PARITY_SH: toWsl(mfile) },
});
const out = (r.stdout ?? '') + (r.stderr ?? '');
const line = out.split(/\r?\n/).filter((l) => /^ℹ (tests|pass|fail)/.test(l)).join('  ');
const aRed = /✖ redact parity A/.test(out) ? 'A=RED' : 'A=green';
const bRed = /✖ redact parity B/.test(out) ? 'B=RED' : 'B=green';
console.log(`M2 变异（sh redact_cmd 直通）: exit=${r.status}  ${aRed}  ${bRed}  ${line}`);
console.log(bRed === 'B=RED' ? '=> F2 成立：闸门捕获生产路径失效 ✅' : '=> F2 不成立：闸门未捕获 ❌（应 REJECT）');
