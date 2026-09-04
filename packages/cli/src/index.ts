/**
 * index.ts — RiskGuard CLI 统一入口（bin）
 *
 * 用户级子命令：detect / install / status / doctor / uninstall / version / help
 *   node packages/cli/src/index.ts <cmd> [选项]
 * 无子命令时，退化为原有 hook 运行时：
 *   echo '<json>' | node packages/cli/src/index.ts   （stdin JSON → Decision JSON）
 *
 * UX：子命令错误输出可读信息，不抛 stack trace。
 */

import { run } from './cli.ts';
import type { CliInput } from './cli.ts';
import { cmdDetect, cmdInstall, cmdStatus, cmdDoctor, cmdUninstall, cmdVersion, cmdHelp } from './commands.ts';

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(''));
  });
}

/** 解析 argv：提取子命令 + --key value / --flag */
function parseArgs(argv: string[]): { cmd?: string; opts: Record<string, string | boolean> } {
  const args = argv.slice(2);
  if (!args.length) return { opts: {} };
  const first = args[0];
  const known = new Set(['detect', 'install', 'status', 'doctor', 'uninstall', 'version', 'help']);
  if (!known.has(first)) return { opts: {} }; // 非子命令 → hook 运行时
  const cmd = first;
  const opts: Record<string, string | boolean> = {};
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) { opts[key] = next; i++; }
      else opts[key] = true;
    }
  }
  return { cmd, opts };
}

async function runSubcommand(): Promise<boolean> {
  const { cmd, opts } = parseArgs(process.argv);
  const json = opts['json'] === true;
  const dryRun = opts['dry-run'] === true;
  const verbose = opts['verbose'] === true;
  const only = typeof opts['agent'] === 'string' ? opts['agent'] : undefined;
  const home = typeof opts['home'] === 'string' ? opts['home'] : undefined;

  switch (cmd) {
    case 'detect':
      process.stdout.write(cmdDetect({ json, home }) + '\n');
      return true;
    case 'install':
      process.stdout.write(await cmdInstall({ dryRun, verbose, only, home }) + '\n');
      return true;
    case 'status':
      process.stdout.write(await cmdStatus({ home }) + '\n');
      return true;
    case 'doctor':
      process.stdout.write(await cmdDoctor({ verbose, home }) + '\n');
      return true;
    case 'uninstall':
      process.stdout.write(await cmdUninstall({ only, dryRun, home }) + '\n');
      return true;
    case 'version':
      process.stdout.write(cmdVersion() + '\n');
      return true;
    case 'help':
      process.stdout.write(cmdHelp() + '\n');
      return true;
    default:
      return false;
  }
}

async function main(): Promise<void> {
  // 子命令优先
  if (await runSubcommand()) { process.exit(0); return; }

  // 否则：hook 运行时（stdin JSON → Decision JSON）
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