#!/usr/bin/env node
// RiskGuard bridge: agent hook payload -> shared rules engine -> block decision.
// Rules live only in assets/hooks/dangerous-commands.ps1 (Windows) or
// skills/agent-risk-guard/scripts/dangerous-commands.sh (POSIX). This file
// only translates payloads and exit codes; it never embeds a rule.
//
// Exit 0 = allow, 2 = deny (reason on stderr), 1 = bridge failure (agents that
// are fail-open will allow; callers that can fail-closed must treat 1 as deny).

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE_PS1 = process.env.RG_ENGINE_PS1 || join(HERE, "dangerous-commands.ps1");
const ENGINE_SH = process.env.RG_ENGINE_SH || join(HERE, "dangerous-commands.sh");
const LOG = join(tmpdir(), "riskguard-bridge.log");

function log(line) {
  try {
    appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`, "utf8");
  } catch {}
}

function readStdin(idleMs = 1500) {
  return new Promise((resolve) => {
    let buf = "";
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve(buf);
    };
    const timer = setTimeout(finish, idleMs);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buf += chunk;
      clearTimeout(timer);
      setTimeout(finish, 120);
    });
    process.stdin.on("end", finish);
    process.stdin.on("error", finish);
  });
}

function commandOf(payload) {
  if (!payload || typeof payload !== "object") return "";
  const tool = String(payload.tool_name ?? payload.toolName ?? payload.tool ?? "");
  const input = payload.tool_input ?? payload.input ?? payload.arguments ?? {};
  const cmd = input && typeof input === "object" ? input.command ?? input.cmd ?? input.script : "";
  if (typeof cmd !== "string") return "";
  if (tool && !/bash|shell|terminal|command|exec/i.test(tool)) return "";
  return cmd;
}

function runEngine(cmd) {
  const env = { ...process.env, RG_CMD: cmd };
  const psCandidates = [
    "powershell.exe",
    join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell"),
  ];
  const powershell = process.platform === "win32" ? psCandidates.find((p) => p === "powershell.exe" || existsSync(p)) : "";
  const args =
    process.platform === "win32"
      ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ENGINE_PS1]
      : [ENGINE_SH];
  const bin = process.platform === "win32" ? powershell : "bash";
  if (process.platform === "win32" && !bin) {
    log("no powershell executable found");
    return { error: new Error("powershell not found"), status: null };
  }
  // Both engines read the Claude-shaped payload from stdin; spawnSync closes
  // the pipe, so engines that wait for EOF can never hang here.
  const input = JSON.stringify({ tool_name: "Bash", tool_input: { command: cmd } });
  return spawnSync(bin, args, {
    input,
    env,
    encoding: "utf8",
    timeout: 15000,
    windowsHide: true,
  });
}

function decision(out, status) {
  if (status === 2) return { deny: true, reason: out.stderr.trim() || "blocked by RiskGuard" };
  const text = `${out.stdout ?? ""}`.trim();
  if (!text) return { deny: false };
  try {
    const j = JSON.parse(text);
    const d = j?.hookSpecificOutput?.permissionDecision ?? j?.permissionDecision;
    if (d === "deny") {
      return { deny: true, reason: j?.hookSpecificOutput?.permissionDecisionReason ?? j?.permissionDecisionReason ?? "blocked by RiskGuard" };
    }
  } catch {}
  return { deny: false };
}

const envCmd = process.env.RG_CMD;
let payloadText = "";
let payload = null;
let cmd = typeof envCmd === "string" ? envCmd : "";

if (!cmd) {
  payloadText = await readStdin();
  try {
    payload = payloadText.trim() ? JSON.parse(payloadText) : null;
  } catch {
    log(`payload parse failed len=${payloadText.length} text=${JSON.stringify(payloadText.slice(0, 2000))}`);
    process.stderr.write("RiskGuard: hook payload was not valid JSON; refusing to guess.\n");
    process.exit(1);
  }
  cmd = commandOf(payload);
}

if (!cmd) {
  log(`no command tool=${payload?.tool_name ?? payload?.toolName ?? "?"}`);
  process.exit(0);
}

const out = runEngine(cmd);
if (out.error || out.status === null) {
  log(`engine failed cmd=${JSON.stringify(cmd)} err=${out.error?.message ?? "no exit status"} stderr=${JSON.stringify((out.stderr ?? "").slice(0, 500))}`);
  process.stderr.write(`RiskGuard: rules engine failed (${out.error?.message ?? "no exit status"}).\n`);
  process.exit(1);
}
const verdict = decision(out, out.status);
if (verdict.deny) {
  process.stderr.write(verdict.reason + "\n");
  process.exit(2);
}
process.exit(0);
