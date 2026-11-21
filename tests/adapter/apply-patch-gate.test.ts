import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Codex 0.167.1 exposes apply_patch as a hook subject (tool_input.command is the
// patch text). The shared engine must deny Delete File / Move to, and allow an
// ordinary Update File. This runs the Windows engine directly.
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const engine = join(root, "assets", "hooks", "dangerous-commands.ps1");
const windowsOnly = process.platform !== "win32";

function run(command: string) {
  return spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", engine],
    {
      input: JSON.stringify({ tool_name: "apply_patch", tool_input: { command } }),
      encoding: "utf8",
      timeout: 30000,
      windowsHide: true,
    },
  );
}

function denied(r: ReturnType<typeof run>) {
  try {
    return JSON.parse(r.stdout).hookSpecificOutput.permissionDecision === "deny";
  } catch {
    return false;
  }
}

test("apply_patch Delete File is denied", { skip: windowsOnly }, () => {
  const r = run("*** Begin Patch\n*** Delete File: tracked.txt\n*** End Patch");
  assert.equal(denied(r), true, `stdout=${r.stdout}`);
});

test("apply_patch Move to is denied", { skip: windowsOnly }, () => {
  const r = run("*** Begin Patch\n*** Move to: other.txt\n*** End Patch");
  assert.equal(denied(r), true, `stdout=${r.stdout}`);
});

test("apply_patch Update File is allowed", { skip: windowsOnly }, () => {
  const r = run("*** Begin Patch\n*** Update File: tracked.txt\n@@\n-a\n+b\n*** End Patch");
  assert.equal(denied(r), false, `stdout=${r.stdout}`);
});

test("apply_patch delete hidden inside a Bash command is denied", { skip: windowsOnly }, () => {
  const r = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", engine],
    {
      input: JSON.stringify({
        tool_name: "Bash",
        tool_input: { command: "apply_patch <<EOF\n*** Begin Patch\n*** Delete File: tracked.txt\n*** End Patch\nEOF" },
      }),
      encoding: "utf8",
      timeout: 30000,
      windowsHide: true,
    },
  );
  assert.equal(denied(r), true, `stdout=${r.stdout}`);
});
