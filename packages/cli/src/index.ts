/**
 * index.ts — RiskGuard CLI 统一入口（bin）
 *
 * 用户级子命令：detect / install / status / doctor / uninstall / version / help
 *   node packages/cli/src/index.ts <cmd> [选项]
 * 无子命令时，退化为原有 hook 运行时：
 *   echo '<json>' | node packages/cli/src/index.ts   （stdin JSON → Decision JSON）
 *
 * UX：子命令错误输出可读信息，不抛 stack trace。
 *
 * 退出码契约（G1 退出码可信 / G7 错误语义；详见 commands.ts 顶部注释）：
 *   0  成功（含 hook 运行时的 allow / deny —— deny 是正常决策不是错误）
 *   1  操作失败（doctor 有 FAIL；install 中止/回滚；uninstall 失败；bootstrap 失败）
 *   2  用法错误（未知子命令；未知 agent）
 *   hook 运行时（无子命令）恒为 0，CC/Codex 集成依赖此行为。
 */

import { run } from './cli.ts';
import type { CliInput } from './cli.ts';
import {
  cmdDetect, cmdInstallResult, cmdStatus, cmdDoctor, cmdUninstall, cmdBootstrap,
  cmdVersion, cmdHelp, cmdAcsEvaluate,
} from './commands.ts';

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(''));
  });
}

/** 已知子命令（含两词子命令 acs evaluate 的规范化名） */
const KNOWN_COMMANDS = new Set(['detect', 'install', 'status', 'doctor', 'uninstall', 'bootstrap', 'version', 'help', 'acs-evaluate']);

interface ParsedArgs {
  cmd?: string;
  opts: Record<string, string | boolean>;
  /** 非空 = 首参数不是已知子命令 → 用法错误（exit 2），不再落入 hook 运行时 */
  unknownCommand?: string;
}

/** 解析 argv：提取子命令 + --key value / --flag（支持两词子命令 acs evaluate） */
function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  // 无参数 → hook 运行时（stdin JSON → Decision JSON）
  if (!args.length) return { opts: {} };
  const first = args[0];
  // 两词子命令：acs evaluate（v0.2.0 §十七）
  if (first === 'acs' && args[1] === 'evaluate') {
    const cmd = 'acs-evaluate';
    const opts: Record<string, string | boolean> = {};
    for (let i = 2; i < args.length; i++) {
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
  // 首参数不是已知子命令 → 未知命令（G7：给出用法提示，绝不静默落入 hook 运行时）
  if (!KNOWN_COMMANDS.has(first)) return { opts: {}, unknownCommand: first };
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

/**
 * 执行子命令。
 * 返回退出码；返回 null = 「没有子命令」→ 调用方走 hook 运行时（stdin → decision JSON）。
 */
async function runSubcommand(): Promise<number | null> {
  const { cmd, opts, unknownCommand } = parseArgs(process.argv);
  if (unknownCommand !== undefined) {
    const label = unknownCommand === '' ? '(empty argument)' : unknownCommand;
    process.stdout.write(`Unknown command: ${label}\n\nRun 'node bin/riskguard.mjs help' for usage.\n`);
    return 2;
  }
  const json = opts['json'] === true;
  const dryRun = opts['dry-run'] === true;
  const verbose = opts['verbose'] === true;
  const only = typeof opts['agent'] === 'string' ? opts['agent'] : undefined;
  const home = typeof opts['home'] === 'string' ? opts['home'] : undefined;

  switch (cmd) {
    case 'detect':
      process.stdout.write(cmdDetect({ json, home }) + '\n');
      return 0;
    case 'install': {
      const r = await cmdInstallResult({ dryRun, verbose, only, home, yes: opts['yes'] === true, all: opts['all'] === true });
      process.stdout.write(r.text + '\n');
      return r.exitCode;
    }
    case 'status':
      process.stdout.write(await cmdStatus({ home }) + '\n');
      return 0;
    case 'doctor': {
      const r = await cmdDoctor({ verbose, home, json });
      process.stdout.write(r.text + '\n');
      return r.exitCode;
    }
    case 'uninstall': {
      const r = await cmdUninstall({ only, dryRun, home });
      process.stdout.write(r.text + '\n');
      return r.exitCode;
    }
    case 'bootstrap': {
      const r = await cmdBootstrap({ home, force: opts['force'] === true });
      process.stdout.write(r.text + '\n');
      return r.exitCode;
    }
    case 'acs-evaluate': {
      // §十七/§四十七：stdin ToolCallRequest JSON → stdout Result JSON；--wire = official Envelope → Envelope
      const raw = await readStdin();
      const profile = opts['profile'] === 'strict' ? ('strict' as const) : undefined;
      const audit = opts['audit'] === true;
      const wire = opts['wire'] === true;
      process.stdout.write(cmdAcsEvaluate(raw, { profile, audit, wire }) + '\n');
      return 0;
    }
    case 'version':
      process.stdout.write(cmdVersion() + '\n');
      return 0;
    case 'help':
      process.stdout.write(cmdHelp() + '\n');
      return 0;
    default:
      return null; // 无子命令 → hook 运行时
  }
}

async function main(): Promise<void> {
  // 子命令优先
  let code: number | null = null;
  try {
    code = await runSubcommand();
  } catch (e) {
    // 子命令内部异常：不给用户 stack trace，但失败必须可见（非零退出码）
    process.stderr.write(`RiskGuard: ${(e as Error)?.message ?? String(e)}\n`);
    process.exit(1);
    return;
  }
  if (code !== null) { process.exit(code); return; }

  // 否则：hook 运行时（stdin JSON → Decision JSON）——恒 exit 0（CC/Codex 集成契约）
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

  // Agent hook 原始形状归一化（Claude Code / Codex PreToolUse：{ tool_name, tool_input: { command } }）：
  // 只补 commandRaw，判定仍完全由 core 策略引擎决定（真实 CC 接线走 pre-tool-hook.ts，本入口是通用运行时）。
  const toolInput = (input as CliInput & { tool_input?: { command?: unknown } }).tool_input;
  if (!input.commandRaw && toolInput && typeof toolInput.command === 'string') input.commandRaw = toolInput.command;

  process.stdout.write(run(input));
  process.exit(0);
}

void main();
