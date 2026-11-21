import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// The bridge is the only new code path between an agent hook and the shared
// rules engine. These tests pin its translation contract: deny -> exit 2,
// allow -> exit 0, non-shell tools ignored, malformed payload -> exit 1
// (callers that can fail closed treat 1 as deny).
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const bridge = join(root, "assets", "shared", "riskguard-bridge.mjs");
const enginePs1 = join(root, "assets", "hooks", "dangerous-commands.ps1");
const engineSh = join(root, "skills", "agent-risk-guard", "scripts", "dangerous-commands.sh");

function run(payload: unknown) {
  return spawnSync(process.execPath, [bridge], {
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    env: { ...process.env, RG_ENGINE_PS1: enginePs1, RG_ENGINE_SH: engineSh },
    encoding: "utf8",
    timeout: 30000,
    windowsHide: true,
  });
}

test("bridge denies git reset --hard with exit 2 and a reason", () => {
  const r = run({ tool_name: "bash", tool_input: { command: "git reset --hard HEAD" } });
  assert.equal(r.status, 2, `stderr=${r.stderr}`);
  assert.match(r.stderr, /HOOK|危险|deny|RiskGuard/i);
});

test("bridge denies git global-option forms (git -C / --git-dir) that bypass the plain rules", () => {
  for (const command of [
    'git -C "C:/repo" reset --hard HEAD',
    "git -C /tmp/repo clean -fdx",
    "git --git-dir=C:/repo/.git reset --hard",
  ]) {
    const r = run({ tool_name: "bash", tool_input: { command } });
    assert.equal(r.status, 2, `${command} should be denied; stderr=${r.stderr}`);
  }
});

test("bridge denies Remove-Item (permanent delete) with exit 2", () => {
  const r = run({ tool_name: "bash", tool_input: { command: "Remove-Item -Force -Recurse C:\\tmp\\x" } });
  assert.equal(r.status, 2, `stderr=${r.stderr}`);
});

test("bridge allows a safe shell command", () => {
  const r = run({ tool_name: "bash", tool_input: { command: "git status --short" } });
  assert.equal(r.status, 0, `stderr=${r.stderr}`);
});

test("bridge ignores tools that are not shell commands", () => {
  const r = run({ tool_name: "read", tool_input: { file_path: "README.md" } });
  assert.equal(r.status, 0);
});

test("bridge fails closed on a malformed payload", () => {
  const r = run("{not-json");
  assert.equal(r.status, 1);
});

test("bridge accepts the Pi/omp event shape (toolName/input)", () => {
  const r = run({ toolName: "bash", input: { command: "git reset --hard HEAD" } });
  assert.equal(r.status, 2, `stderr=${r.stderr}`);
});
