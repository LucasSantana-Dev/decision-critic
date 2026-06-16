# decision-critic

> A portable, **tool-less adversarial decision reviewer** — defined once as a neutral spec,
> transpiled into any agent host. It makes evidence fabrication *structurally impossible*
> instead of merely discouraged by prose.

**Status:** working · single-author personal tooling, published for the *pattern*. The
interesting part isn't the prompt — it's the **tool-enforcement model** that stops a reviewer
agent from inventing the evidence it reviews.

---

## Why this exists

Give a reviewer agent tools and ask it to "verify the claims," and one day it will: run an
evaluation itself, misread the output, and assert a fabricated fact as a CRITICAL finding —
inverting a verdict on something that never happened. Self-gathered, misattributed evidence is
**worse than no evidence**: it carries false authority, and it happened here three times in one
session before the cause was clear.

The fix is not a better prompt. A prompt that says *"do not fabricate"* is advice the model can
ignore. The fix is **removing the capability**: a reviewer that has no tools *cannot* gather
evidence, so it cannot misattribute it. It reasons only on the artifact in front of it and
hands back a **Claims-To-Verify** list for the orchestrator (which has the tools and the
context) to check.

This repo packages that role so it runs on more than one agent runtime.

## The three things this ships

1. **A neutral spec** (`spec/`) — the role, the tool policy, and the output schema, host-agnostic
   and authored once.
2. **A tool-enforcement conformance model** (L0 → L1 → L2) — the reusable insight: *how strongly*
   a given host can guarantee "no tools," and what leaks if it can't.
3. **A reference adapter** (`adapters/claude-code.mjs`) — a thin transpiler that renders the spec
   into a Claude Code subagent at the strongest level that host supports. Porting to another
   runtime = writing a sibling adapter, not re-deriving the capability.

## Enforcement conformance levels

The portable lesson. "No tools" is only as strong as the host can enforce it:

| Level | Mechanism | Guarantee | Leak |
|---|---|---|---|
| **L0** | prompt-only | none — the contract is advice the model may violate | everything, if tools are granted |
| **L1** | per-agent **denylist** | named evidence/mutation tools removed; blocks the primary fabrication path (run-eval, read-log, write-file) | any tool the denylist can't *name* — e.g. dynamically-registered MCP/plugin tools when there's no wildcard |
| **L2** | per-agent **empty allow-list** | resolves to **zero** tools, core and MCP; fabrication structurally impossible | none |

> Real-world trap this encodes: Claude Code denylists have **no `mcp__*` wildcard**, so an
> `disallowedTools` agent silently inherits every MCP tool — including a shell-equivalent. Only
> an **allow-list** (L2) drops MCP. The Claude Code adapter therefore emits `tools: []` (L2) with
> a `disallowedTools` hedge (L1) beneath it: structural guard first, belt-and-suspenders fallback
> in case a loader ever treats an empty array as "unset."

## Layout

```
spec/
  prompt.md            # host-agnostic system prompt — the single source of truth
  tool-policy.json     # tool access (empty allow-list) + L0/L1/L2 conformance model
  output.schema.json   # JSON Schema: verdict + machine-readable claimsToVerify[]
adapters/
  claude-code.mjs      # reference transpiler -> Claude Code agents/decision-critic.md
  README.md            # how to port to a new host
examples/
  claude-code/decision-critic.md   # generated output, checked in
scripts/
  verify.mjs           # spec well-formedness + adapter determinism/conformance self-check
```

## Use it (Claude Code)

```bash
node adapters/claude-code.mjs --out ~/.claude/agents/decision-critic.md
# then, in Claude Code, route decision/analysis reviews to the `decision-critic` subagent
```

Edit the **spec**, never the generated file; re-transpile and `npm run verify`.

## Reviewer contract (what it returns)

Always: a `VERDICT` (REJECT / NEEDS_REVISION / SOUND), the single strongest objection (with the
artifact excerpt it rests on), rated load-bearing assumptions, a pre-mortem, the cheapest
evidence that would flip the verdict — and, crucially, **`claimsToVerify[]`**: the facts the
decision rests on that the critic could not confirm. The orchestrator must check those before
acting. *A verdict resting on an unverified claim is a hypothesis, not a finding.*

## License

MIT © 2026 Lucas Santana
