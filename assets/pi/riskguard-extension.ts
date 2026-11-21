import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

// RiskGuard gate for Pi and omp (both expose the same pi.on("tool_call") API).
// Rules live in ~/.risk-guard/dangerous-commands.ps1 (or .sh); this file only
// ships the command to the shared bridge and turns a deny into a block.
const BRIDGE = join(homedir(), ".risk-guard", "riskguard-bridge.mjs");
const SHELL_TOOL = /bash|shell|terminal|command|exec/i;

function check(command: string): string | null {
  const r = spawnSync(process.execPath, [BRIDGE], {
    env: { ...process.env, RG_CMD: command },
    encoding: "utf8",
    timeout: 20000,
    windowsHide: true,
  });
  if (r.status === 2) return (r.stderr || "blocked by RiskGuard").trim();
  if (r.status !== 0) {
    return `RiskGuard 规则引擎异常（exit=${r.status ?? "null"}），按 fail-closed 拒绝执行`;
  }
  return null;
}

export default function riskguard(pi: any) {
  pi.on("tool_call", async (event: any) => {
    const tool = String(event?.toolName ?? event?.tool ?? "");
    if (!SHELL_TOOL.test(tool)) return;
    const command = event?.input?.command ?? event?.input?.cmd ?? event?.input?.script;
    if (typeof command !== "string" || !command.trim()) return;
    const reason = check(command);
    if (reason) return { block: true, reason };
  });
}
