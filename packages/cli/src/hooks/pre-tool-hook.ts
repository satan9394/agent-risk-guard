/**
 * pre-tool-hook.ts — PreToolUse hooks 的真实硬拦截入口（Claude Code / Codex）
 *
 * 使用方式（由 installer 注入到 settings.json / hooks.json 的 hook command）：
 *   node <repo>/packages/cli/src/hooks/pre-tool-hook.ts --agent claude
 *   node <repo>/packages/cli/src/hooks/pre-tool-hook.ts --agent codex
 *
 * 该脚本从 stdin 读取 Agent 传入的 PreToolUse JSON（tool_name + tool_input.command），
 * 走 RiskGuard adapter → core 判定，输出 Agent 识别的 DENY 形状。
 * 这是机器层执行前硬拦截：即使 Agent 处于 bypassPermissions / bash allow，钩子仍会执行。
 *
 * 输入失败 → fail-closed deny（RG-I04）。
 * 不依赖任何模型遵守规则：命不命中由策略引擎决定。
 */

import { readFileSync } from 'node:fs';
import { parseClaudePayload, renderClaudeDecision, type ClaudePayload } from '../../../adapters/claude/src/index.ts';
import { selectPolicy } from '../cli.ts';
import { evaluate } from '../../../core/src/policy-engine.ts';
import { failClosed, type Decision } from '../../../core/src/decision.ts';
import type { RiskEvent } from '../../../core/src/event.ts';

interface Payload {
  tool_name?: string;
  tool_input?: Record<string, unknown> & { command?: string; file_path?: string; filePath?: string };
  cwd?: string;
  workspace_roots?: string[];
}

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main(): number {
  const args = process.argv.slice(2);
  const agentIdx = args.indexOf('--agent');
  const agent = (agentIdx !== -1 && args[agentIdx + 1]) || 'claude';

  const raw = readStdin().trim();
  // 空输入 → fail-closed deny（hook 故障时的保守处理）
  if (!raw) {
    if (agent === 'codex') {
      process.stdout.write(JSON.stringify({ decision: 'deny', reason: 'RiskGuard: empty hook input (fail-closed)' }));
      return 2;
    }
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'RiskGuard: empty hook input (fail-closed)' },
      systemMessage: 'RiskGuard: hook 输入为空，fail-closed 拒绝',
    }));
    return 0;
  }

  let payload: Payload;
  try {
    payload = JSON.parse(raw) as Payload;
  } catch {
    if (agent === 'codex') {
      process.stdout.write(JSON.stringify({ decision: 'deny', reason: 'RiskGuard: invalid JSON (fail-closed)' }));
      return 2;
    }
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'RiskGuard: invalid JSON (fail-closed)' },
      systemMessage: 'RiskGuard: payload JSON 无效，fail-closed 拒绝',
    }));
    return 0;
  }

  const policy = selectPolicy(undefined); // 默认策略（autonomy-safe）
  const decide = (e: RiskEvent) => evaluate(e, policy);

  // Claude adapter 覆盖 Bash/PowerShell/Write/Edit；Codex 的 PreToolUse 输入形状与其一致
  const rendered = renderClaudeDecision(decideFromPayload({ ...payload }, decide));
  if (agent === 'codex') {
    // Codex deny 信号：退出码 2 + JSON（若 deny）
    if (rendered !== '{}') {
      process.stdout.write(JSON.stringify({ decision: 'deny', reason: 'RiskGuard: dangerous command blocked' }) + '\n');
      return 2;
    }
    process.stdout.write('{}');
    return 0;
  }
  process.stdout.write(rendered);
  return 0;
}

function decideFromPayload(payload: ClaudePayload, decide: (e: RiskEvent) => Decision): Decision {
  const out = parseClaudePayload(payload);
  if (!out.ok) return failClosed('RG-PARSE-000', `RiskGuard parse failure (fail-closed): ${out.reason}`);
  return decide(out.event);
}

process.exit(main());