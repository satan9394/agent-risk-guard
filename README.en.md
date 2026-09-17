# Agent Risk Guard

**Deterministic safety guardrails for AI coding agents.**

**[English](README.en.md) | [中文](README.md)**

**Cross-agent runtime security enforcement with experimental OWASP ACS v0.1.0 schema alignment.**

Deterministically intercept file deletion, shell commands, and destructive Git operations before an AI agent actually executes them — turning "permanent delete" into "recycle bin" and stopping destructive operations before they run.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node >= 22.18](https://img.shields.io/badge/Node-%3E%3D%2022.18-green.svg)](#)
[![CI](https://github.com/satan9394/agent-risk-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/satan9394/agent-risk-guard/actions/workflows/ci.yml)

A real, unedited interception output:

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

> **Status: `v0.3.1 Developer Preview`** (pre-release). The deterministic policy engine, the transactional CLI
> installer and the per-agent adapters are implemented and covered by automated tests. **Verified in real agent
> sessions** — Claude Code, OpenCode and Antigravity CLI — where dangerous commands were refused before execution
> and uncommitted changes survived. **macOS / Linux are implemented but not verified in a real environment.**
>
> For how far each agent is actually covered — including the two easy-to-misread points, that Codex is blocked by
> its **own** policy/sandbox layer and that DSH runs on the rule patch rather than the plugin — see the
> [Support Matrix](#support-matrix) and [Security Model](#security-model). For **what problem each version solved
> and what changed**, see [Releases](https://github.com/satan9394/agent-risk-guard/releases) and
> [docs/release-notes/](docs/release-notes/); full history in [CHANGELOG.md](CHANGELOG.md).

---

## Why RiskGuard?

AGENTS.md, CLAUDE.md, system prompts and an agent's built-in permissions are all part of a security posture — but **they rely on the model following rules**. Models can be tricked, forget, or misjudge under pressure. You should not treat "the model will behave" as your final security boundary.

RiskGuard adds **a deterministic pre-execution gate** before an agent calls a genuinely dangerous tool (decided by a policy engine, not by whether the model "remembers" the rules).

This is the core concept of the project: **soft rule constraints** (written into rule files, enforced by the model obeying them) and **pre-execution hard blocking** (hook / plugin / pre-execute gates, decided and enforced by the machine) are two very different levels of security.

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

`status` distinguishes two concepts: **Capability** (the product's D0–D4 support for that agent, from `compatibility.json`) and **Runtime** (what is actually happening on this machine: `NOT_DETECTED` / `DETECTED` / `INSTALLED` / `ACTIVE` / `BROKEN` — `ACTIVE` means the full runtime self-test passed).

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

`detect` scans Claude Code / Codex / OpenCode / DSH / Hermes / AGY / Cursor / Windsurf / Grok / Copilot CLI / Cline / Aider / Goose. `install` without `--agent` lists detected agents for interactive selection (`1,3` / `all` / Enter), and non-interactive environments auto-install all without hanging. Install is **non-destructive**: merges preserve user fields, corrupt config / missing permission / IO errors abort with zero writes, and any failure rolls back to the pre-install state; when wiring is broken (`BROKEN`) install treats it as a **repair**.

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

**7. Exit codes** (contract for scripts / CI; also listed by `riskguard help`):

| Exit code | Meaning |
| --- | --- |
| `0` | Success. Includes doctor with WARN but no FAIL, idempotent install (`already installed`), and uninstalling an agent that was never installed. **The hook runtime (no command: stdin JSON → decision JSON) ALWAYS exits 0** — allow and deny are both normal decisions, and a fail-closed deny for empty/invalid input is not an error (Claude Code / Codex integration depends on this). |
| `1` | Failed. doctor has ≥1 FAIL (the FAIL line carries an executable fix hint); install was aborted (corrupt config / foreign plugin file), rolled back or failed its runtime self-test, or an explicitly requested agent was not installed; uninstall was refused or failed; bootstrap failed. |
| `2` | Usage error. Unknown command (typo, empty argument) — prints `Unknown command: …` plus a help hint instead of silently falling through to the hook runtime; install / uninstall was given an unknown or unsupported agent. |

Example: `node bin/riskguard.mjs doctor || echo "RiskGuard is not active"`; CI health checks can use the exit code directly and pair it with `doctor --json` for the machine-readable `{pass,warn,fail,skip,exitCode,checks}`.

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
| **DeepSeek Harness (DSH)** | What actually runs is the **`deny-risk-commands` rule patch** injected into the profile (regex matching). The `@riskguard/dsh` plugin (`pre-execute` cascade + monotonic `guard()` invariant) **is implemented and tested but is not wired into any profile** | ✅ Yes (**at the rule-patch layer**) | Windows D3 (real-session interception records); macOS/Linux D1 | ✅ Verified (**protection comes from the rule patch, not the plugin**) |
| **Claude Code** | `PreToolUse` hook + CLAUDE.md rules | ✅ Yes (machine-level gate; still blocks under bypassPermissions) | Windows D3 (real-session permission-rule block); macOS/Linux D1 | ✅ Verified (local Windows) |
| **Codex** | rules-compiler → AGENTS.md + production PreToolUse hook (app/CLI share `~/.codex/`, dual registration) | ✅ Yes (hook wired; DENY/ALLOW tested) | Windows D3 (app `approval_policy=never` + `sandbox=unelevated` policy layer, real-session manual test 2026-09-06; **CLI 0.153.4 hook real-session test 2026-09-07**); macOS/Linux D1 | ✅ Verified (local Windows) |
| **OpenCode** | `tool.execute.before` TS plugin + AGENTS.md | ✅ Yes (production plugin registered; still blocks with bash allow) | Windows D3 (real session `BLOCKED_BY_GLOBAL_SAFETY_GUARD`); macOS/Linux D1 | ✅ Verified (local Windows) |
| **Antigravity CLI (AGY)** | `PreToolUse` hook (matcher `run_command`) at `~/.gemini/config/hooks.json` | ✅ Yes (adapter `agy-dangerous-commands.ps1`, fail-closed, BOM) | Windows D3 (real session 2026-09-06: git hard reset denied, uncommitted changes preserved); macOS/Linux D1 | ✅ Verified (local Windows) |
| **Cursor** | `preToolUse` adapter | 🟡 Adapter implemented | D1 docs + unit tests; no real agent session yet | 🟡 Implemented / awaiting real-world verification |
| **Windsurf** | `pre_run_command` adapter | 🟡 Adapter implemented | D1 docs + unit tests; no real agent session yet | 🟡 Implemented / awaiting real-world verification |
| **Grok** | `PreToolUse` adapter | 🟡 Weak (Grok hooks default to fail-open) | D1 + unit tests; boundary depends on Rules/Sandbox | 🟡 Experimental (soft constraints mostly) |
| **Pi** | — | ❌ None | — | ⚪ Unsupported |

The single source of truth for verification levels is `packages/installer/compatibility.json`: **D0** = Unsupported; **D1** = Implementation exists; **D2** = Automated test verified; **D3** = Real agent execution verified; **D4** = Repeated / production verified. D3/D4 are product capability levels — they do not mean a given machine is currently `ACTIVE` (machine state comes from `riskguard status` → Runtime). The levels above come from that file (CI runs `check-compatibility-docs` to prevent drift).

> On "early interception": the Claude Code and OpenCode blocks in the [3-agent deletion test](docs/d3-deletion-test-3agents.md) came largely from **model-level rules** and the plugin-injected trash tool; the **machine-level hard gates** were only re-verified from v0.1.0 onward. The evidence and source behind every row above is recorded in [docs/deployment-status.md](docs/deployment-status.md) and [docs/real-agent-conformance-final-report.md](docs/real-agent-conformance-final-report.md), and all blocking has been audited by the [GAN adversarial review](docs/GAN-AUDIT-5AGENTS.md) (17 findings, all fixed).
>
> ⚠️ When debugging wiring: for the Claude Code row, what is actually registered on this machine is a `PreToolUse` entry (matcher `Bash` → `dangerous-commands.ps1`), while the id the installer writes is `riskguard-pre-tool-hook` — same hook, but **the same name does not imply the same origin**, so read the config file itself.

## Community & contributing

This project is **open source, and open to use, questions and issues**. Coverage is still narrow — only a handful of agents have been verified in real sessions — and new AI coding agents appear almost every month. **If the agent you use is not in the matrix above, that is exactly what we want to hear about.**

Two entry points (the issue templates are ready):

- **[New agent support request](https://github.com/satan9394/agent-risk-guard/issues/new?template=new_agent_request.yml)** — we mainly want three things: does it have a **pre-execution interception point**, the **JSON shape** of the tool call, and **one piece of real blocking evidence**.
- **[Agent security mechanism / environment report](https://github.com/satan9394/agent-risk-guard/issues/new?template=agent_security_report.yml)** — use this if you already run RiskGuard on that agent and found a rule too strict or too weak, or found that the agent's own sandbox already covers part of it.

Before writing code, read **[Adding a new agent](docs/adding-an-agent.md)**: it lists everything needed to wire an agent up, where the code goes, how to test it yourself, and the hard constraints we hold to. A suggestion without code is very welcome too — **a screenshot of that agent's hook/plugin documentation is usually enough for us to say whether a hard gate is possible**, and "this agent can only support soft constraints" is itself a useful result.

**Three kinds of information we especially want**: ① an agent's hook/plugin contract (config path + event shape + denial shape); ② whether that hook is **fail-open or fail-closed** when it fails (empty stdin tests this); ③ a real-session record of a block **or a miss**, with version and date.

> ⚠️ **Security vulnerabilities do not go in public issues**: a rule bypass, or any way to actually get a dangerous command executed, goes through [SECURITY.md](SECURITY.md).

## OS support

| Platform | Status |
|---|---|
| **Windows** | ✅ Verified (recycle-bin trash tested, DSH/Codex hooks and D3 sessions on local Windows) |
| **macOS** | 🟡 Implemented, **not yet tested in a real environment** (trash `macos.ts` is D1) |
| **Linux** | 🟡 Implemented, **not yet tested in a real environment** (CI runs platform-independent tests on Ubuntu; trash `linux.ts` is D1) |

## Agent Skill (canonical)

This repository is also the **canonical source of an Agent Skill** (`skills/agent-risk-guard/`, with SKILL.md + blocking scripts + config templates, following the open `SKILL.md` standard). Any Agent Skills runtime (Claude Code / Codex / Gemini CLI / OpenCode / Antigravity, etc.) can install it directly:

```bash
# via the Vercel skills ecosystem
npx skills add satan9394/agent-risk-guard            # install all
npx skills add satan9394/agent-risk-guard --skill agent-risk-guard
```

After install, follow the "Quick setup" flow in `skills/agent-risk-guard/SKILL.md` to land machine-level gates (hooks / plugins / pre-execute) for each agent on the machine.

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
- **Devlogs**: [v0.1.0 → v0.1.2](docs/devlog-2026-09-04-v0.1.2.md) · [v0.2.0](docs/devlog-2026-09-05-v0.2.0.md) · [v0.2.1](docs/devlog-2026-09-05-v0.2.1.md) · [v0.2.2](docs/devlog-2026-09-05-v0.2.2.md) · [v0.3.0](docs/devlog-2026-09-07-v0.3.0.md)
- [docs/TODO.md](docs/TODO.md) — TODO list (incl. pending production-sync items)

## Development & security verification

- **Independent discriminator review (maker-checker)**: every slice is reviewed by a discriminator that did **not** write it, under the rule that "reverting the fix must turn some test red" — so gates cannot become self-fulfilling. For v0.3.0 the five production agent gates were fully audited, producing 17 findings (P0×10 / P1×6 / P2×1), **all fixed and re-verified** — see [docs/GAN-AUDIT-5AGENTS.md](docs/GAN-AUDIT-5AGENTS.md) and [docs/gan-audit-fix-map.md](docs/gan-audit-fix-map.md). This is a **development methodology**; the runtime does **not** depend on any model.
- Tests: `tests/` covers policy / adapter / acs / acs-schema-conformance / compatibility / conformance / e2e / adversarial (corpus + rule self-tests) — **380/380 passing**; CI runs the platform-independent suite on Ubuntu, while the local `test-all.ps1` additionally runs D3 hook pipelines and the WSL sh suite.

## Wiring check (ongoing hygiene)

After installing, it is worth periodically confirming that the wiring is **still in place** and that the scripts
still match the single rule source — Claude Code's `PreToolUse` entry was once **silently reverted by an external
tool**, while the hook file was present, its hash was correct and every suite was green.

```powershell
# read-only inspection (non-zero exit when something is missing or drifted; prints [OK]/[!!] per item)
pwsh scripts/riskguard-wiring-check.ps1

# inspect and self-heal from the in-repo single source (backs up to ~/.risk-guard-backup/ first)
pwsh scripts/riskguard-wiring-check.ps1 -Fix
```

It checks the three ps1 production wirings against the in-repo source, the OpenCode plugin, the DSH patch, and
whether the entries in `settings.json` / `hooks.json` / `config.toml` are actually registered.

## Community & license

- **License**: [MIT](LICENSE) — Copyright (c) 2026 satan9394
- **Code of conduct**: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- **Contributing**: [CONTRIBUTING.md](CONTRIBUTING.md)
- **Security**: [SECURITY.md](SECURITY.md)
- **Changelog**: [CHANGELOG.md](CHANGELOG.md)
- **Release notes** (the problem + what changed, for every version, bilingual): [docs/release-notes/](docs/release-notes/)

> The historical Git tag `v1.0.0` is kept and not deleted: it marks an earlier release and **is not a current stability claim**. For why no `1.0 Stable` claim is made, see [OS support](#os-support) and the [Support Matrix](#support-matrix).
