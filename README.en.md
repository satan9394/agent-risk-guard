# Agent Risk Guard

**English** ｜ [中文](README.md)

**Deterministic runtime guardrails for AI coding agents.**

Agent Risk Guard checks shell, filesystem and Git operations **before** an AI agent actually runs them. It does
not rely on the model "remembering the safety rules" — it inserts an independent execution gate between the
agent and the operating system.

```text
AI Coding Agent
      ↓
 Agent Adapter        (each vendor's hook / plugin / pre-execute / tool.before)
      ↓
 Agent Risk Guard     (unified RiskEvent → Policy Engine, pure functions, fail-closed)
      ↓
 ALLOW / DENY / SAFE ALTERNATIVE
      ↓
 Operating System
```

A real, unedited interception output:

```text
Agent attempts:  remove-item C:\proj\important -Recurse -Force

{
  "decision": "deny",
  "ruleId": "RG-FS-001",
  "reason": "permanent deletion is blocked, use the trash instead",
  "safeAlternative": { "operation": "trash" }
}
```

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node >= 22.18](https://img.shields.io/badge/Node-%3E%3D%2022.18-green.svg)](#)
[![CI](https://github.com/satan9394/agent-risk-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/satan9394/agent-risk-guard/actions/workflows/ci.yml)

> **Status: `v0.3.1 Developer Preview`** (pre-release).
> **Pre-execution blocking is verified in real agent sessions** for Claude Code / OpenCode / Antigravity CLI.
> macOS / Linux are implemented but not yet tested in a real environment.
>
> ⚠️ Agent Risk Guard is **not** an OS sandbox and **not** a complete endpoint security product. It is one layer
> of defence in depth — see [Limitations](#limitations).

## Why Agent Risk Guard?

AGENTS.md, CLAUDE.md, system prompts and an agent's built-in permissions can all tell a model "do not run
dangerous operations" — but as long as **the model decides whether to comply**, that is a **soft constraint**: it
can be talked around, forgotten, or lost in a long context or under pressure.

Agent Risk Guard adds the other layer: the model may *request* an operation, **but the model does not get to
decide its own permission boundary**.

```text
Prompt / Rules  →  model decides whether to comply  →  Agent Risk Guard  →  machine re-checks deterministically  →  real execution
```

## What it blocks

| Risk | Examples | Default behaviour |
|---|---|---|
| **Permanent deletion** | `rm -rf`, `Remove-Item -Recurse -Force`, `del /f`, `shutil.rmtree`, `fs.rmSync` | DENY, suggest the recycle bin |
| **Destructive Git** | `git reset --hard`, `git clean -f`, `git restore`, `push --force`, `branch -D`, `stash drop/clear`, `gc --prune` | DENY |
| **System destructive** | `mkfs` / `wipefs` / `Format-Volume`, block-device writes, `reg delete` | DENY |
| **Sensitive resources** | `.ssh` / `.env` / `.aws` / `.kube` / `.npmrc` / private keys / `.pem` | read-only gating; tokens / API keys / passwords are redacted on the audit and block-message exits |
| **Some obfuscated execution** | full-width variants, quote insertion, `$()`/backticks, base64 pipes, interpreter one-liners, shell-wrapper unwrapping, junction/symlink escapes | unwrapped and re-checked (**partial only** — see [Limitations](#limitations)) |

Full rule list: `packages/core/src/rules/default-policy.ts`.

## Quick Start

Requires **Node >= 22.18**; zero dependencies, zero build.

```bash
git clone https://github.com/satan9394/agent-risk-guard.git
cd agent-risk-guard

node bin/riskguard.mjs bootstrap   # installs ~/.riskguard/runtime/, so hooks stop depending on the git clone
node bin/riskguard.mjs install     # interactively pick which agents to harden (non-interactive auto-installs all)
node bin/riskguard.mjs doctor      # health check
```

Inspect the current state, and preview before writing anything:

```bash
node bin/riskguard.mjs status
node bin/riskguard.mjs install --dry-run
```

After `bootstrap`, agent hooks/plugins point at `~/.riskguard/runtime/<version>/` rather than the git clone — so
RiskGuard keeps working after the source repo is deleted or moved.

All commands, options, the **exit-code contract** and the transactional installer semantics live in
**[docs/cli.md](docs/cli.md)**.

> It can also be installed as an **Agent Skill** (this repo is its canonical source):
> `npx skills add satan9394/agent-risk-guard` — any Agent Skills runtime can install it directly.

## Agent support

| Agent | Integration | Enforcement layer | Status |
|---|---|---|---|
| **Claude Code** | `PreToolUse` hook | machine hard gate | ✅ verified in a real session |
| **OpenCode** | `tool.execute.before` plugin | machine hard gate | ✅ verified in a real session |
| **Antigravity CLI** | `PreToolUse` hook | machine hard gate | ✅ verified in a real session |
| **Codex** | hook + app policy/sandbox layer | **mixed** — in its app form the block comes from Codex's own policy layer; the CLI-side hook was tested separately | 🟡 partial |
| **DeepSeek Harness** | rule patch injected into the profile | **rule (regex) layer** — the `@riskguard/dsh` plugin is implemented and tested but **not wired into any profile** | 🟡 verified (not the plugin) |
| **Cursor / Windsurf / Grok** | adapter | no real-session verification | ⚪ implemented only |
| **Pi and others** | — | — | ⚪ not covered |

> **"Supported" does not mean the same security level.** The table deliberately distinguishes *who* blocks: for
> Codex it is Codex's own policy layer, and for DSH it is the rule patch rather than the plugin — the two easiest
> rows to misread. Levels (D0–D4), per-item evidence and the real execution boundary live in the single source of
> truth `packages/installer/compatibility.json` and the generated
> [Agent Security Matrix](docs/generated/agent-security-matrix.md).
> Want to add an agent? See [what it takes to add one](docs/adding-an-agent.md).

## Security Model

Agents use different interception points, but every event is normalized into one `RiskEvent` and judged by the
**same policy core** — consistent across agents, single source of truth, and the engine is pure functions that
can be tested independently of any agent.

Core invariants (in `packages/core/src`, all locked by tests):

- **RG-I01** permanent deletion defaults to deny, with a trash suggestion
- **RG-I02** RiskGuard itself and protected resources cannot be modified (monotonic deny)
- **RG-I03** if any layer denies, the result is deny (guard monotonicity)
- **RG-I04** parse failure / unknown mutation → **fail-closed deny**, never allow
- **RG-I05** regex is not a capability boundary (Pattern Policy ≠ Capability Policy)

Architecture contract: [docs/adapter-contract.md](docs/adapter-contract.md).

## Standards & Interoperability

An **experimental** **OWASP ACS v0.1.0** alignment layer: it turns an ACS `ToolCallRequest` into an internal
`RiskEvent` without loss, and returns a Result that validates against the official JSON Schema
(`riskguard acs evaluate`, wire mode `--wire`).

This is an **interoperability layer, not the core security boundary** — it does not change the policy engine or
the invariants above. See [docs/acs-alignment.md](docs/acs-alignment.md).

## Limitations

Agent Risk Guard is **one layer of defence in depth**, not a complete host-security product. Today it:

- is **not** an OS sandbox, and **not** EDR / antivirus
- **cannot** recognize every command obfuscation (only the vectors that have been modelled)
- **cannot** stop anything that bypasses the agent adapter and calls the OS directly
- should **not** be your only security boundary
- is implemented for macOS / Linux but **lacks real-environment verification** there
- is still a **Developer Preview**; no 1.0 Stable claim is made

These limits are stated plainly because a security tool that claims protection it does not have is **worse than
no protection at all**.

## Contributing

Use it, ask questions, open issues. **If the agent you use is not in the table above, that is exactly what we
want to hear about** — a copy of that agent's hook/plugin documentation (config path + event shape + denial
shape) is usually enough to tell whether a hard gate is possible.

- [Request support for a new agent](https://github.com/satan9394/agent-risk-guard/issues/new?template=new_agent_request.yml)
- [Report an agent's security mechanism / environment](https://github.com/satan9394/agent-risk-guard/issues/new?template=agent_security_report.yml)
- Want to write code: see [docs/adding-an-agent.md](docs/adding-an-agent.md)
- ⚠️ **Security vulnerabilities do not go in public issues**: use [SECURITY.md](SECURITY.md)

## Documentation

| Document | Contents |
|---|---|
| [docs/cli.md](docs/cli.md) | **CLI reference**: all commands, options, exit-code contract, transactional installer semantics, wiring check |
| [docs/adapter-contract.md](docs/adapter-contract.md) | Adapter contract: vendor payload → RiskEvent → Decision |
| [docs/acs-alignment.md](docs/acs-alignment.md) | OWASP ACS v0.1 alignment boundary and wire mode |
| [docs/adding-an-agent.md](docs/adding-an-agent.md) | What it takes to add an agent |
| [docs/generated/agent-security-matrix.md](docs/generated/agent-security-matrix.md) | Generated per-agent real-execution-boundary matrix |
| [docs/GAN-AUDIT-5AGENTS.md](docs/GAN-AUDIT-5AGENTS.md) | Independent discriminator adversarial review (17 findings, all fixed) |
| [docs/release-notes/](docs/release-notes/) | **The problem each version solved and what changed** (bilingual) |
| [CHANGELOG.md](CHANGELOG.md) · [CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) | History, contribution guide, security policy |

> Devlogs: [v0.1.0→v0.1.2](docs/devlog-2026-09-04-v0.1.2.md) · [v0.2.0](docs/devlog-2026-09-05-v0.2.0.md) ·
> [v0.2.1](docs/devlog-2026-09-05-v0.2.1.md) · [v0.2.2](docs/devlog-2026-09-05-v0.2.2.md) · [v0.3.0](docs/devlog-2026-09-07-v0.3.0.md)

> The historical Git tag `v1.0.0` is kept and not deleted: it marks an earlier release and **is not a current
> stability claim**.

## License

[MIT](LICENSE) — Copyright (c) 2026 satan9394
