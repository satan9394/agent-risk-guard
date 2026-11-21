import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Grok Build's PreToolUse payload is camelCase (toolName / toolInput) and its
// deny is {"decision":"deny","reason":...} + exit 2. The adapter must translate
// the shared engine's decision without swallowing stdin (the old `$input` bug).
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const adapter = join(root, "assets", "hooks", "grok-riskguard-adapter.ps1");
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

test("grok adapter denies a dangerous terminal command", { skip: windowsOnly }, () => {
  const r = run({ toolName: "run_terminal_command", toolInput: { command: "git reset --hard HEAD" } });
  assert.equal(r.status, 2, `stderr=${r.stderr}`);
  assert.equal(JSON.parse(r.stdout).decision, "deny");
});

test("grok adapter allows a safe terminal command", { skip: windowsOnly }, () => {
  const r = run({ toolName: "run_terminal_command", toolInput: { command: "git status --short" } });
  assert.equal(r.status, 0, `stderr=${r.stderr}`);
  assert.equal(r.stdout.trim(), "{}");
});

test("grok adapter fails closed on empty input", { skip: windowsOnly }, () => {
  const r = run("");
  assert.equal(r.status, 2, `stderr=${r.stderr}`);
  assert.equal(JSON.parse(r.stdout).decision, "deny");
});
