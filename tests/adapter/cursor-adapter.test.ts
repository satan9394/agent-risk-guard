import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Cursor's preToolUse speaks its own protocol. The adapter must:
// - deny the native Delete tool (it cannot reach the recycle bin),
// - translate the shared engine's deny for Shell,
// - fail closed on unreadable input,
// - let safe shell commands through.
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const adapter = join(root, "assets", "hooks", "cursor-riskguard-adapter.ps1");
const engine = join(root, "assets", "hooks", "dangerous-commands.ps1");
const windowsOnly = process.platform !== "win32";

function run(payload: unknown) {
  return spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", adapter, "-Engine", engine],
    {
      input: typeof payload === "string" ? payload : JSON.stringify(payload),
      encoding: "utf8",
      timeout: 30000,
      windowsHide: true,
    },
  );
}

function denied(r: ReturnType<typeof run>) {
  if (r.status !== 0 || !r.stdout.trim()) return false;
  try {
    return JSON.parse(r.stdout).permission === "deny";
  } catch {
    return false;
  }
}

test("cursor adapter denies the native Delete tool", { skip: windowsOnly }, () => {
  const r = run({ tool_name: "Delete", tool_input: { file_path: "C:\\repo\\x.txt" } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(denied(r), true, `stdout=${r.stdout}`);
});

test("cursor adapter denies dangerous shell commands", { skip: windowsOnly }, () => {
  const r = run({ tool_name: "Shell", tool_input: { command: "git reset --hard HEAD" } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(denied(r), true, `stdout=${r.stdout}`);
});

test("cursor adapter allows safe shell commands", { skip: windowsOnly }, () => {
  const r = run({ tool_name: "Shell", tool_input: { command: "git status --short" } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(denied(r), false, `stdout=${r.stdout}`);
});

test("cursor adapter fails closed on malformed input", { skip: windowsOnly }, () => {
  const r = run("{not-json");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(denied(r), true, `stdout=${r.stdout}`);
});
