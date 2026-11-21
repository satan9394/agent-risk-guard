import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Devin (ex-Windsurf) hooks: PreToolUse + matcher "exec", snake_case payload.
// Block is exit 2 or {"decision":"block","reason":...}; allow is exit 0 + {}.
// No real session yet (Devin auth is required), so this is D2 evidence only.
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const adapter = join(root, "assets", "hooks", "devin-riskguard-adapter.ps1");
const engine = join(root, "assets", "hooks", "dangerous-commands.ps1");
const windowsOnly = process.platform !== "win32";

function run(payload: unknown) {
  return spawnSync(
    "pwsh",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", adapter, "-Engine", engine],
    {
      input: typeof payload === "string" ? payload : JSON.stringify(payload),
      encoding: "utf8",
      timeout: 30000,
      windowsHide: true,
    },
  );
}

test("devin adapter blocks a dangerous exec command", { skip: windowsOnly }, () => {
  const r = run({ hook_event_name: "PreToolUse", tool_name: "exec", tool_input: { command: "git reset --hard HEAD" } });
  assert.equal(r.status, 2, `stderr=${r.stderr}`);
  assert.equal(JSON.parse(r.stdout).decision, "block");
});

test("devin adapter allows a safe exec command", { skip: windowsOnly }, () => {
  const r = run({ hook_event_name: "PreToolUse", tool_name: "exec", tool_input: { command: "git status --short" } });
  assert.equal(r.status, 0, `stderr=${r.stderr}`);
  assert.equal(r.stdout.trim(), "{}");
});

test("devin adapter fails closed on empty input", { skip: windowsOnly }, () => {
  const r = run("");
  assert.equal(r.status, 2, `stderr=${r.stderr}`);
});
