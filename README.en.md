# Agent Risk Guard

**Deterministic safety guardrails for AI coding agents.**

**[English](README.en.md) | [中文](README.md)**

**Cross-agent runtime security enforcement with experimental OWASP ACS v0.1.0 schema alignment.**

Deterministically intercept file deletion, shell commands, and destructive Git operations before an AI agent actually executes them — turning "permanent delete" into "recycle bin" and stopping destructive operations before they run.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node >= 22.18](https://img.shields.io/badge/Node-%3E%3D%2022.18-green.svg)](#)
[![CI](https://github.com/satan9394/agent-risk-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/satan9394/agent-risk-guard/actions/workflows/ci.yml)

> **Status: `v0.3.0 Developer Preview`.** The deterministic policy engine, transactional CLI installer, DSH plugin and per-agent adapters are implemented and covered by automated tests.
> Production wiring is verified on the author's Windows machine (Claude Code / OpenCode / Codex / DSH / AGY); macOS / Linux are not yet verified in a real environment (see [Support Matrix](#support-matrix) and [Security Model](#security-model)).
> v0.2.0 added the **experimental OWASP ACS v0.1 gateway** (`riskguard acs evaluate`), **Compatibility Schema v2** (real execution boundaries), a **capability taxonomy** and the **Agent Security Conformance Framework** (C1–C10). v0.2.1 added **Wire Schema Conformance**: the official OWASP ACS v0.1.0 JSON Schema (pinned snapshot) became the final compatibility criterion, plus `acs evaluate --wire` (official JSON-RPC Request/Response Envelope). v0.2.2 froze the ACS protocol layer with an **ACS version gate** (the official wire gateway rejects unsupported versions with `-32001` instead of mis-treating them as 0.1.0) and a **release workflow** (GitHub Releases now carry verifiable `tar.gz` + `SHA256SUMS.txt` assets). **v0.3.0 Real Agent Conformance** shifts from building infrastructure to real-session verification — **all 5 agents now have real-session hard-block evidence (D3)**: OpenCode / Claude Code / DSH / AGY are verified through real RiskGuard hook/plugin sessions; Codex has dual evidence (app `approval_policy=never` + `sandbox=unelevated` policy/sandbox layer, plus a **Codex CLI 0.153.4 hook real-session test on 2026-09-07**). v0.3.0 also includes a **GAN adversarial audit** (17 findings — P0×10/P1×6/P2×1 — all fixed) and **installer UX** (full-registry `detect` including AGY, interactive `install` selection).

---

## Why RiskGuard?

AGENTS.md, CLAUDE.md, system prompts and an agent's built-in permissions are all part of a security posture — but **they rely on the model following rules**. Models can be tricked, forget, or misjudge under pressure. You should not treat "the model will behave" as your final security boundary.

RiskGuard adds **a deterministic pre-execution gate** before an agent calls a genuinely dangerous tool (decided by a policy engine, not by whether the model "remembers" the rules):

```text
Agent tries to run  rm -rf important-project/
        ↓
     RiskGuard
        ↓
      DENY
        ↓
     the command never runs
```

This is the core concept of the project: **soft rule constraints** (written into rule files, enforced by the model obeying them) and **pre-execution hard blocking** (hook / plugin / pre-execute gates, decided and enforced by the machine) are two very different levels of security.

## What it protects

Five categories (the full rule list lives in `packages/core/src/rules/default-policy.ts`; detailed vectors in `docs/`):

### Permanent deletion

Blocks permanent deletion that bypasses the recycle bin: `rm -rf`, `Remove-Item -Recurse -Force`, `del /f`, `shutil.rmtree`, `fs.rmSync`, etc. Always DENY and suggest the recycle bin (trash) instead.

### Destructive Git operations

`git reset --hard`, `git clean -f`, `git checkout -- / restore`, `git push --force`, `git branch -D`, `git stash drop/clear`, `git worktree remove --force`, `git gc --prune`, and other irreversible operations.

### System destructive commands

Disk formatting (`Format-Volume` / `mkfs` / `wipefs`), writing block devices (`dd if=… of=/dev/…`), registry deletion (`reg delete`), destructive `wmic` operations, etc.

### Credential & sensitive path protection

Read-only gating on `.ssh` / `.env` / `.aws` / `.kube` / `.npmrc` / `.git-credentials` / private keys / `.pem`. Audit and block messages automatically redact tokens / API keys / passwords at the boundary.

### Obfuscated execution (partial detection)

Detects **some** common bypasses: full-width character variants, quote insertion, `$()`/backtick substitution, base64 pipes, interpreter one-liners (`python -c`, `node -e`, `perl -e`), recursive shell-wrapper unwrapping (`bash -c` / `cmd /c` / `pwsh -Command`), and junction/symlink escapes. "Some" is stressed deliberately — it cannot recognize every obfuscation (see [Security Model](#security-model)).

## How it works

```text
AI Coding Agent
      ↓
 Agent Adapter   (per-agent Hook / Plugin / pre-execute / tool.before / command gate)
      ↓
 RiskGuard Core  (unified RiskEvent → Policy Engine, pure functions, fail-closed)
      ↓
   ALLOW / DENY / TRASH
      ↓
  Operating System
```

Different agents use different interception points (hook / plugin / pre-execute / tool.before / command gate), but everything is normalized into a single `RiskEvent` and judged by the **same policy core**, so behavior is consistent across agents from a single source of truth. Policy decisions are pure functions and can run and be tested independently of any agent.

Core invariants (in `packages/core/src`, all locked by tests):

| Invariant | Meaning |
|---|---|
| RG-I01 | Permanent deletion is DENY by default; recycle bin suggested |
| RG-I02 | RiskGuard itself / protected resources cannot be modified (monotonic deny) |
| RG-I03 | If any layer denies, the result is deny (guard monotonicity) |
| RG-I04 | Parse failure / unknown mutation → fail-closed deny, never allow |
| RG-I05 | Regex is not a capability boundary (Pattern Policy ≠ Capability Policy) |

Architecture contract details: [docs/adapter-contract.md](docs/adapter-contract.md).

## Support Matrix

> **✅ Verified** = verified in a real agent environment; **🟢 Implemented** = implemented with tests but lacking full real-world re-check; **🟡 Experimental** = experimental; **⚪ Unsupported** = not implemented.
> Distinguish "soft rule constraints" (written into AGENTS.md / CLAUDE.md, enforced by the model) from "pre-execution hard blocking" (hook / plugin / pre-execute machine gates).
> The machine-generated **real execution boundary matrix** (Compatibility Schema v2: surfaces / fail mode / policy scope / bypass / boundary layers / per-capability) is produced by [docs/generated/agent-security-matrix.md](docs/generated/agent-security-matrix.md) (`node scripts/generate-agent-security-matrix.ts`, CI drift-checked). This section keeps the human-readable summary.

| Agent | Integration | Pre-execution hard block | Verification level | Status |
|---|---|---|---|---|
| **DeepSeek Harness (DSH)** | `pre-execute` cascade + monotonic `guard()` invariant | ✅ Yes | Windows D3 (real-session interception records); macOS/Linux D1 | ✅ Verified |
| **Claude Code** | `PreToolUse` hook + CLAUDE.md rules | ✅ Yes (machine-level gate; still blocks under bypassPermissions) | Windows D3 (real-session permission-rule block); macOS/Linux D1 | ✅ Verified (local Windows) |
| **Codex** | rules-compiler → AGENTS.md + production PreToolUse hook (app/CLI share `~/.codex/`, dual registration) | ✅ Yes (hook wired; DENY/ALLOW tested) | Windows D3 (app `approval_policy=never` + `sandbox=unelevated` policy layer, real-session manual test 2026-09-06; **CLI 0.153.4 hook real-session test 2026-09-07**); macOS/Linux D1 | ✅ Verified (local Windows) |
| **OpenCode** | `tool.execute.before` TS plugin + AGENTS.md | ✅ Yes (production plugin registered; still blocks with bash allow) | Windows D3 (real session `BLOCKED_BY_GLOBAL_SAFETY_GUARD`); macOS/Linux D1 | ✅ Verified (local Windows) |
| **Antigravity CLI (AGY)** | `PreToolUse` hook (matcher `run_command`) at `~/.gemini/config/hooks.json` | ✅ Yes (adapter `agy-dangerous-commands.ps1`, fail-closed, BOM) | Windows D3 (real session 2026-09-06: git hard reset denied, uncommitted changes preserved); macOS/Linux D1 | ✅ Verified (local Windows) |
| **Cursor** | `preToolUse` adapter | 🟡 Adapter implemented | D1 docs + unit tests; no real agent session yet | 🟡 Implemented / awaiting real-world verification |
| **Windsurf** | `pre_run_command` adapter | 🟡 Adapter implemented | D1 docs + unit tests; no real agent session yet | 🟡 Implemented / awaiting real-world verification |
| **Grok** | `PreToolUse` adapter | 🟡 Weak (Grok hooks default to fail-open) | D1 + unit tests; boundary depends on Rules/Sandbox | 🟡 Experimental (soft constraints mostly) |
| **Pi** | — | ❌ None | — | ⚪ Unsupported |

The single source of truth for verification levels is `packages/installer/compatibility.json`: **D0** = Unsupported; **D1** = Implementation exists; **D2** = Automated test verified; **D3** = Real agent execution verified; **D4** = Repeated / production verified. D3/D4 are product capability levels — they do not mean a given machine is currently `ACTIVE` (machine state comes from `riskguard status` → Runtime). The levels above come from that file (CI runs `check-compatibility-docs` to prevent drift).

> Honest note: the early interception for Claude Code and OpenCode in the [3-agent deletion test](docs/d3-deletion-test-3agents.md) largely came from **model-level rules** (CLAUDE.md / AGENTS.md) and the plugin-injected trash tool. Since v0.1.0 the **machine-level hard gates** have been re-verified with real D3 sessions (see [docs/deployment-status.md](docs/deployment-status.md)): in real `claude -p --permission-mode bypassPermissions` and `opencode run` sessions, `git reset --hard` was rejected by the RiskGuard hook/plugin before the tool ran (Claude Code `permission-rule`, OpenCode `BLOCKED_BY_GLOBAL_SAFETY_GUARD`), and uncommitted changes survived. DSH keeps machine-level `pre-execute` gate evidence. AGY (Antigravity CLI 1.1.27) was verified through `~/.gemini/config/hooks.json` PreToolUse in a real session. Codex (app form: VS Code extension + codex.exe) is blocked by the app policy/sandbox layer (`approval_policy=never` + `sandbox=unelevated`, user-verified manually on 2026-09-06 with "blocked by policy"), and a **Codex CLI 0.153.4 real-session re-test (2026-09-07)** confirmed the RiskGuard PreToolUse hook also blocks at the tool layer (hook log deny timestamps match; uncommitted changes preserved). Cursor / Windsurf / Grok machine-level hard blocking still await real-session verification. All blocking has been audited by the [GAN adversarial review](docs/GAN-AUDIT-5AGENTS.md) (17 findings, all fixed).

## OS support

| Platform | Status |
|---|---|
| **Windows** | ✅ Verified (recycle-bin trash tested, DSH/Codex hooks and D3 sessions on local Windows) |
| **macOS** | 🟡 Implemented, **not yet tested in a real environment** (trash `macos.ts` is D1) |
| **Linux** | 🟡 Implemented, **not yet tested in a real environment** (CI runs platform-independent tests on Ubuntu; trash `linux.ts` is D1) |

## Quick start (Developer Preview)

RiskGuard ships a **zero-dependency, zero-build** user-level CLI (`riskguard`) covering install / status / doctor / uninstall. Requires Node >= 22.18. Unified in-repo entry: `node bin/riskguard.mjs` (equivalent to `node packages/cli/src/index.ts`, so you never face internal source paths).

```bash
cd agent-risk-guard
# Show CLI usage
node bin/riskguard.mjs help
```

**0. (Recommended) Install the portable runtime** — copies the minimal runtime file set into `~/.riskguard/runtime/<version>/`; agent hooks then point at the runtime instead of the git clone. RiskGuard keeps working after the source repo is deleted or moved:

```bash
node bin/riskguard.mjs bootstrap          # first-time runtime install
node bin/riskguard.mjs bootstrap --force  # repair reinstall if runtime is corrupt
```

> Distribution/self-contained mode: `node scripts/build-release.ts` produces `dist/agent-risk-guard-v<version>/` (with a `bin/riskguard.mjs` launcher, `runtime-manifest.json`, `SHA256SUMS.txt`). The artifact can run detect / install / doctor / uninstall in a fake HOME without the source repo.

**1. First, detect installed agents read-only** (touches nothing):

```bash
node bin/riskguard.mjs detect          # human-readable (full registry incl. AGY)
node bin/riskguard.mjs detect --json   # full boolean map
```

**2. Inspect each agent's Runtime state and product capability level:**

```bash
node bin/riskguard.mjs status
```

`status` distinguishes two concepts: **Capability** (D0–D4 support for that agent, from the single source of truth `compatibility.json`) and **Runtime** (what is actually happening on this machine). Runtime values: `NOT_DETECTED` / `DETECTED` / `INSTALLED` / `ACTIVE` (full runtime self-test passed, really blocking) / `BROKEN` (manifest present but wiring missing/corrupt). It also shows **Verification** mode: `dynamic` (Claude Code / Codex — real interception runtime self-test) vs `static` (OpenCode / DSH — wiring + artifact + integrity), never conflated.

**3. Health check** (PASS / WARN / FAIL / SKIP; uninstalled agents count as SKIP, not FAIL):

```bash
node bin/riskguard.mjs doctor
```

**4. Install / repair** (transactional: typed read → backup → merge → manifest → runtime self-test → commit; `--dry-run` previews; `--agent` alias supported):

```bash
node bin/riskguard.mjs install --dry-run            # show what would change, write nothing
node bin/riskguard.mjs install                      # interactive: list detected agents, pick by number; non-TTY/pipe auto-installs all
node bin/riskguard.mjs install --all --dry-run      # skip interaction, install all detected
node bin/riskguard.mjs install --agent claude       # install one only (cc/claude/claude-code equivalent; oc=opencode)
```

Since v0.3.0, `riskguard detect` scans the full known registry (Claude Code / Codex / OpenCode / DSH / Hermes / AGY / Cursor / Windsurf / Grok / Copilot CLI / Cline / Aider / Goose); `install` without `--agent` interactively lists detected agents (enter numbers, e.g. `1,3` / `all` / Enter for all; non-interactive environments auto-install all without hanging), and `--all`/`--yes` skips interaction. When wiring is broken (BROKEN), install detects it as **repair** (prints `repaired successfully`) and returns to ACTIVE; only "no changes + healthy ACTIVE" reports `already installed`. Install is **non-destructive**: merges preserve user fields; corrupt JSON / no permission / IO errors abort with zero writes; an OpenCode plugin at the target path with same name but different content (SHA256 mismatch) is refused; any failure rolls back to the pre-install state (including restoring the old manifest), leaving no half-done state.

**5. Uninstall** (precise inverse: removes only RiskGuard-injected entries, keeps user changes made after install):

```bash
node bin/riskguard.mjs uninstall --dry-run
node bin/riskguard.mjs uninstall
```

Uninstall removes exactly what the manifest tracks; RiskGuard files modified by the user are not auto-deleted; with no manifest it reports "nothing to do" and never deletes by mistake.

**6. (v0.2.0/v0.2.1) OWASP ACS boundary-protocol Gateway** — feeds an ACS ToolCallRequest losslessly into the RiskGuard policy engine and emits a valid ACS Result (fail-closed; see [docs/acs-alignment.md](docs/acs-alignment.md)):

```bash
cat tests/fixtures/acs-v0.1/git-reset-hard.json | node bin/riskguard.mjs acs evaluate
cat tests/fixtures/acs-v0.1/shell-safe.json     | node bin/riskguard.mjs acs evaluate --audit
cat request.json | node bin/riskguard.mjs acs evaluate --profile strict
cat envelope.json | node bin/riskguard.mjs acs evaluate --wire   # official ACS v0.1.0 JSON-RPC wire mode
```

- `acs evaluate` = **payload compatibility mode** (RiskGuard convenience interface); `acs evaluate --wire` = **official ACS v0.1.0 schema-conformant wire mode** (Request Envelope → Response Envelope).
- Invalid input never throws a stack trace: payload mode prints `{ "decision": "deny", "reasoning": "Invalid ACS ToolCallRequest: …" }` with `extensions.riskguard.degraded = true` (fail-closed); wire mode returns JSON-RPC errors (-32700/-32600/-32602).
- The official OWASP ACS v0.1.0 JSON Schema is pinned in `tests/vendor/owasp-acs-v0.1.0/` (read-only; upstream commit recorded in the README) and is the Release Gate since v0.2.1.

> Windows PowerShell: `Get-Content … -Raw | node packages/cli/src/index.ts` remains usable as the low-level stdin-JSON → Decision-JSON entry; advanced agent wiring lives in `packages/adapters/<agent>/src` and `docs/deployment-status.md`.

### Example output

A real (unedited) CLI response to a "delete an important directory" request:

```text
Agent attempts:  remove-item C:\proj\important -Recurse -Force

RiskGuard CLI output:
{
  "decision": "deny",
  "ruleId": "RG-FS-001",
  "reason": "永久删除禁止，请使用回收站",
  "safeAlternative": { "operation": "trash", "description": "使用统一 trash 能力（Windows Recycle Bin / macOS Trash / freedesktop Trash）" }
}
```

In other words:

```text
Agent tries permanent delete  →  RiskGuard →  DENY  →  the command never runs (recycle bin suggested)
```

## Features

- **Hard blocking before execution** — decided and blocked by a deterministic policy engine before execution, not by whether the model "remembers" the rules.
- **Trash-first deletion policy** — permanent deletion is always DENY with a recycle-bin (trash) suggestion; recoverability first.
- **Cross-agent policy core** — one policy core drives multiple agents from a single source of truth; consistent behavior.
- **Fail-closed decisions** — parse failure and unknown operations are always rejected (better to over-block and let a human allow, than to under-block).
- **Sensitive resource protection** — read-only gating on `.ssh` / `.env` / private keys etc.
- **Obfuscation resistance** — recognizes common obfuscations and shell-wrapping bypasses (partially).
- **Secret-safe audit logging** — audit and block messages auto-redact tokens / API keys / passwords.
- **Self-protection** — RiskGuard's own configuration cannot be deleted or tampered with.

## Security Model

RiskGuard is **one layer of defense-in-depth, not an absolute security boundary**. Please understand these limits:

- RiskGuard does **not** guarantee blocking every unknown attack; regex/parser detection has inherent limits.
- It should **not** replace OS-level sandboxing (Seatbelt / bubblewrap / restricted accounts / containers).
- It should **not** replace least-privilege accounts.
- It should **not** replace backups, nor your Git/filesystem recovery strategy.
- If you find a new bypass vector, report it through the private channel in [SECURITY.md](SECURITY.md) — **do not** publish a public exploit demonstration.

## Documentation

- [docs/acs-alignment.md](docs/acs-alignment.md) — OWASP ACS v0.1 alignment boundaries (inbound/outbound mapping, Compatibility v2, Conformance C1–C10, audit format)
- [docs/generated/agent-security-matrix.md](docs/generated/agent-security-matrix.md) — Agent security execution-boundary matrix (auto-generated from compatibility.json)
- [docs/adapter-contract.md](docs/adapter-contract.md) — adapter contract (Vendor Payload → RiskEvent → Decision) and verification levels D0–D4 (single source: compatibility.json)
- [docs/deployment-status.md](docs/deployment-status.md) — local production wiring status and sync checklist
- [docs/d3-deletion-test-3agents.md](docs/d3-deletion-test-3agents.md) — real-session deletion test across three agents
- [docs/GAN-AUDIT-5AGENTS.md](docs/GAN-AUDIT-5AGENTS.md) — 5-agent adversarial audit (17 findings, all fixed)
- [docs/real-agent-conformance-final-report.md](docs/real-agent-conformance-final-report.md) — v0.3.0 final acceptance report (A/B comparison, per-agent D-levels)
- [docs/ecosystem-benchmark.md](docs/ecosystem-benchmark.md) — ecosystem benchmark (allowlister / CC Safety Net etc.) and roadmap
- [docs/dsh-api-evidence-d2.md](docs/dsh-api-evidence-d2.md) — DSH `pre-execute` + `guard()` source-level evidence
- [docs/dsh-live-wiring-guide.md](docs/dsh-live-wiring-guide.md) — DSH plugin live wiring guide
- [docs/devlog-2026-09-04-v0.1.2.md](docs/devlog-2026-09-04-v0.1.2.md) — devlog v0.1.0 → v0.1.2 (installer finalization + portable runtime)
- [docs/devlog-2026-09-05-v0.2.0.md](docs/devlog-2026-09-05-v0.2.0.md) — devlog v0.2.0 (ACS Alignment Foundation)
- [docs/devlog-2026-09-05-v0.2.1.md](docs/devlog-2026-09-05-v0.2.1.md) — devlog v0.2.1 (Wire Schema Conformance)
- [docs/devlog-2026-09-05-v0.2.2.md](docs/devlog-2026-09-05-v0.2.2.md) — devlog v0.2.2 (ACS Protocol Finalization)
- [docs/devlog-2026-09-07-v0.3.0.md](docs/devlog-2026-09-07-v0.3.0.md) — devlog v0.3.0 (Real Agent Conformance)
- [docs/TODO.md](docs/TODO.md) — TODO list (incl. pending production-sync items)

## Development & security verification

- **GAN-style adversarial review (maker-checker)**: during development the project uses "generator/discriminator" adversarial review with repeated **independent discriminator audits** (core / installer / opencode / adapter / hook), with fix maps kept on record. For v0.3.0 the 5 production agent gates were fully audited (workflow fan-out independent discriminators), producing 17 findings (P0×10/P1×6/P2×1) — case variants, fail-open, download-then-execute chains, quote/backtick insertion, `bash -xec` unwrapping, the `arm` false-exclusion, the `os.system` regex bug, `-EncodedCommand` base64, xargs/-execdir, git single-file restore, and more — **all fixed and re-verified** (see [docs/GAN-AUDIT-5AGENTS.md](docs/GAN-AUDIT-5AGENTS.md)). Note this is a **development/review methodology** — RiskGuard's runtime does **not** depend on any GAN / neural-network model. See [docs/gan-audit-fix-map.md](docs/gan-audit-fix-map.md).
- Tests: `tests/` covers policy / adapter / acs / acs-schema-conformance / compatibility / conformance / e2e / adversarial (corpus + rule self-tests) — **312/312 passing** (local, platform-independent suite; includes real Windows trash / junction execution; CI runs the platform-independent suite on Ubuntu, while the local `test-all.ps1` additionally runs D3 hook pipelines and the WSL sh suite).

## Community & license

- **License**: [MIT](LICENSE) — Copyright (c) 2026 satan9394
- **Code of conduct**: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- **Contributing**: [CONTRIBUTING.md](CONTRIBUTING.md)
- **Security**: [SECURITY.md](SECURITY.md)
- **Changelog**: [CHANGELOG.md](CHANGELOG.md)

> **Version note**: current unified product version is **`v0.3.0 Developer Preview`** (`package.json` = `0.3.0`; single version source in `packages/core/src/version.ts`).
> The historical Git tag `v1.0.0` is kept and not deleted (it marks an earlier release, not the current stable claim); `v0.1.0` / `v0.1.2` / `v0.2.0` / `v0.2.1` / `v0.2.2` are published Developer Preview (Pre-release) releases. Some platforms/agents still lack real-environment verification (macOS / Linux; real D3 for Copilot CLI / Windsurf / Cursor), so no `1.0 Stable` claim is made. See `docs/TODO.md` and `CHANGELOG.md`.
