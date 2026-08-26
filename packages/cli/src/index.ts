/**
 * index.ts — riskguard CLI 可执行入口
 *
 * 用法：
 *   echo '<json>' | node packages/cli/src/index.ts
 *
 * 输出 Decision JSON 到 stdout；解析失败 fail-closed（deny + degraded）。
 */

import { run } from './cli.ts';
import type { CliInput } from './cli.ts';

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(''));
  });
}

async function main(): Promise<void> {
  const raw = await readStdin();
  if (!raw.trim()) {
    // 无输入：fail-closed（hook 故障场景，拒绝保守处理）
    process.stdout.write(JSON.stringify({ decision: 'deny', degraded: true, reason: 'empty input (fail-closed)', ruleId: 'RG-CLI-000' }));
    process.exit(0);
  }

  let input: CliInput;
  try {
    input = JSON.parse(raw) as CliInput;
  } catch {
    process.stdout.write(JSON.stringify({ decision: 'deny', degraded: true, reason: 'invalid json input (fail-closed)', ruleId: 'RG-CLI-000' }));
    process.exit(0);
  }

  process.stdout.write(run(input));
  process.exit(0);
}

void main();