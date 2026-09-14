# Adding a new agent / 新增一个 Agent

> 中文要点：这份文档是给**仓库外的人**看的。它只回答一件事——**要让我们把某个 Agent 接进来，你需要提供什么。**
> 我们不承诺"支持所有 Agent"；我们承诺的是：**每一个写进支持矩阵的 Agent，背后都有可复现的真实证据。**

RiskGuard is not a smarter regex list. It is a **pre-execution gate**: something must be able to stop a tool call
*before* the agent runs it. So the first question is never "does this agent exist" — it is:

> **Does this agent expose a point where we can intercept a tool call and refuse it?**

If the answer is no, we can still document the agent (a `references/` page and guidance), but we will **not** put it
in the support matrix as if it were protected.

---

## 1. What an integration actually consists of

| Piece | What it is | Where it lives today |
|---|---|---|
| **Adapter** | Translates the vendor's event into the shared `RiskEvent` shape. It never defines safety rules. | `packages/adapters/<agent>/src/index.ts` |
| **Wire-up asset** | The hook / plugin / rule file that the agent itself loads. | `assets/hooks/*.ps1`, `assets/opencode/agent-risk-guard.ts`, `assets/dsh/deny-risk-commands.patch.yml`, or a `skills/agent-risk-guard/assets/<agent>/` template |
| **Tests** | Unit tests over the adapter plus a real-payload regression. | `tests/adapter/*.test.ts` |
| **Compatibility entry** | The D-level and the matrix row's facts. This file is the single source of truth. | `packages/installer/compatibility.json` |
| **Docs** | A per-agent page (what it protects natively, where its config lives, what we tested). | `skills/agent-risk-guard/references/<agent>.md` |

The contract the adapter must satisfy is in **[adapter-contract.md](adapter-contract.md)** — read that first.
中文要点：**适配器只做形状转换，不定义安全规则**；规则的唯一来源是 core 的策略层。

---

## 2. The three things we need from you

### 2.1 The payload shape (this is the whole game)

Paste the **exact JSON** the agent hands to its hook/plugin, and the **exact shape** it expects back for a refusal.
Guesswork here costs a full round-trip; raw bytes cost nothing.

```text
config file:   ~/.someagent/hooks.json          # and which key actually changes execution
event:         PreToolUse, matcher "Bash"       # how the agent names the interception point
stdin:         {"tool_name":"Bash","tool_input":{"command":"rm -rf /tmp/x"}}
deny  =        stdout {"permissionDecision":"deny"}  and exit 0
allow =        empty stdout and exit 0
```

Two things that have burned us before, so please state them explicitly:

- **Is the hook's failure mode fail-open or fail-closed?** If a malformed input makes the hook exit non-zero,
  does the agent block the call or ignore the hook? (Test it: send empty stdin.)
- **How is a decision returned?** stdout JSON vs exit code vs a written file — and whether a non-zero exit is
  interpreted as "denied" or as "hook crashed, carry on".

### 2.2 A real block, not a description

The bar for `D3` ("Real agent execution verified") is a **real session**: one dangerous command that was refused,
and one safe command that went through. Raw output beats prose:

```text
agent:    SomeAgent 1.2.3
date:     2026-09-13
command:  git reset --hard HEAD
observed: hook refused, working tree preserved, log line at 03:48:46
command:  git status
observed: allowed, empty hook output
```

If you have not tested it yet, say **"not tested"**. An honest gap is worth far more to us than an optimistic claim —
the entire point of this project is to not create false confidence. 中文要点：**没测就写"没测"，不要推测。**

### 2.3 What the agent already protects

Some agents already have a sandbox or an approval policy. Knowing this tells us whether RiskGuard is the right
layer or a redundant one. Use the *Agent security mechanism / environment report* issue template for this part.

---

## 3. Checklist: from zero to a merged adapter

1. **Read** [`docs/adapter-contract.md`](adapter-contract.md) (payload → `RiskEvent` → `Decision`).
2. **Look at a neighbour.** `packages/adapters/` already has `claude`, `codex`, `copilot`, `cursor`, `grok`,
   `opencode`, `agy`, `dsh`, `pi`, `windsurf`. Pick the closest one and copy its structure.
3. **Implement** `packages/adapters/<agent>/src/index.ts`: vendor payload in, `RiskEvent` out; `Decision` in,
   vendor denial shape out. Resolve paths (realpath / symlink) **in the adapter** — the core stays pure.
4. **Do not add rules.** If your agent needs a new dangerous-command pattern, that is a separate change to the
   single rule source; `tests/adversarial/rule-alignment.test.ts` will fail if a per-agent rule set drifts from it.
5. **Add tests** in `tests/adapter/`. Minimum: one deny payload, one allow payload, one malformed payload
   (must be fail-closed, not fail-open).
6. **Record the D-level** in `packages/installer/compatibility.json`, and update the matrix row if you change
   what is claimed. `scripts/check-compatibility-docs.ts` runs in CI and fails on drift.
7. **Write the reference page** `skills/agent-risk-guard/references/<agent>.md`: native protections, config
   locations, what you measured, what you did not.
8. **Run the suites** (below) and paste the result into your PR.

中文要点：**新增规则要走单一规则源**，不要在某个 Agent 的适配器里另起一套；CI 有 `rule-alignment` 与
`check-compatibility-docs` 两处防漂移。

---

## 4. Running the tests before you open a PR

```powershell
# everything (Node >= 22.18; no build step — native TS type-stripping)
& .\test-all.ps1

# just the adapter + gate tests
node --test tests/adapter/*.test.ts
node --test packages/core/test/decision-parity.test.ts
```

If you touch a shell hook, the hook suites live in `skills/agent-risk-guard/tests/` and CI runs them too:
five PowerShell suites (under both Windows PowerShell 5.1 and `pwsh`) and four `sh` suites. 中文要点：
**套件全绿 ≠ 判据有效** —— 改了规则或 hook，请同时证明"回退你的修复会让某个套件变红"，否则那条测试拦不住回归。

---

## 5. Rules we will not bend

- **No "convenient permanent delete".** Deletion goes to the trash; we never add a shortcut around it.
- **Fail-closed on malformed input.** An unparseable payload must deny, not allow.
- **No per-agent rule forks.** One rule source; adapters only translate.
- **No `D3` without a real session**, and no matrix row that implies a wiring we cannot demonstrate.
- **Security bypasses are not issues** — they go through [SECURITY.md](../SECURITY.md).

中文要点：以上五条是硬约束，PR 里违反任一条都会被要求修改。

---

## 6. Not sure it is worth it?

Open an issue first — use **New agent support request**. A screenshot of the agent's hook/plugin docs is often
enough for us to tell you within one round whether a hard gate is possible on that agent, or whether only a
documented soft constraint is realistic. Knowing which of the two it is, is itself a useful result.
