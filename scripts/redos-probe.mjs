/**
 * redos-probe.mjs — Code scanning `js/polynomial-redos` 告警的**实测**证据。
 *
 * 背景：CodeQL 在 2026-09-17 首次启用时对 `packages/core/src/normalize.ts` 报了 12 条
 * `js/polynomial-redos`（另有 `path-resolver.ts` 2 条、`packages/dsh/src/plugin.ts` 1 条）。
 * 静态形状告警不等于可利用，所以先实测再决定改不改。
 *
 * 用法：node scripts/redos-probe.mjs
 *
 * 结论（2026-09-17，node v24.14.0 / Windows）：14 个病态用例在 50 KB 输入下**全部 ≤ 1.67 ms**，
 * 5k→50k（输入 ×10）耗时增长约 6–10×，即**近似线性**，未观察到二次或指数退化。
 * 因此这些告警按「实测无可利用退化」处理，**不改动判定正则**——改它们会改变 deny 行为，
 * 而收益为零。若将来告警数或形状变化，重跑本探针即可复核。
 */
import { classifyShellCommand } from '../packages/core/src/normalize.ts';

const CASES = [
  ['斜杠长串（[\\/]+$ 形状）', (n) => 'a' + '/'.repeat(n)],
  ['反斜杠长串', (n) => 'a' + '\\'.repeat(n)],
  ['换行长串（plugin.ts:50 [;&|\\r\\n] 与 \\s* 重叠）', (n) => '\n'.repeat(n) + 'rm x'],
  ['rm 重复（exec 循环）', (n) => 'rm '.repeat(n)],
  ['-rm 重复', (n) => '-rm '.repeat(n)],
  ['git push + 无 --force', (n) => 'git push ' + 'a'.repeat(n)],
  ['cp/mv + 无 -f', (n) => 'cp ' + 'a'.repeat(n)],
  ['eval + 无 rm', (n) => 'eval ' + 'a'.repeat(n)],
  ['pwsh -c 引号未闭合', (n) => 'pwsh -c "' + 'a'.repeat(n)],
  ['printf/echo + 无管道（.* 与 [^|]* 相邻）', (n) => 'echo ' + 'a'.repeat(n)],
  ['iex + 无 new-object', (n) => 'iex ' + 'a'.repeat(n)],
  ['invoke-expression + 无 download', (n) => 'invoke-expression ' + 'a'.repeat(n)],
  ['bash -c 引号 + 空白尾巴（L97 形状）', (n) => 'bash -c "' + 'a'.repeat(n / 2) + '" ' + 'b '.repeat(n / 4)],
  ['引号与空格混合', (n) => 'bash -c "' + ' '.repeat(n)],
];

const SIZES = [1000, 5000, 20000, 50000];
const LIMIT_MS = 100; // 超过此值才视为「需要针对性改写」

console.log('用例'.padEnd(52) + SIZES.map((s) => String(s).padStart(10)).join('') + '   50k/5k');
console.log('-'.repeat(100));

const suspects = [];
for (const [label, make] of CASES) {
  const times = [];
  for (const n of SIZES) {
    const input = make(n);
    classifyShellCommand(input); // 预热，避免 JIT 干扰
    const t0 = performance.now();
    classifyShellCommand(input);
    times.push(performance.now() - t0);
  }
  const ratio = times[1] > 0 ? times[3] / times[1] : 0;
  console.log(label.padEnd(50) + times.map((t) => (t.toFixed(2) + 'ms').padStart(10)).join('') +
    ('   ' + ratio.toFixed(1) + 'x').padStart(10) + (times[3] > LIMIT_MS ? '  <<< 可疑' : ''));
  if (times[3] > LIMIT_MS) suspects.push({ label, ms: times[3], ratio });
}

console.log('');
if (suspects.length === 0) {
  console.log(`PASS: 全部用例在 ${SIZES[SIZES.length - 1] / 1000}KB 病态输入下均未超过 ${LIMIT_MS}ms；`);
  console.log('      未观察到可利用的退化 —— 相关 code scanning 告警按此证据处理。');
  process.exit(0);
}
console.log(`FAIL: ${suspects.length} 个用例出现可感知退化，需要针对性改写：`);
for (const s of suspects) console.log(`  · ${s.label} —— ${s.ms.toFixed(1)}ms（5k→50k 增长 ${s.ratio.toFixed(1)}x）`);
process.exit(1);
