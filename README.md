# decision-critic

> A portable, **tool-less adversarial decision reviewer** — defined once as a neutral spec,
> transpiled into any agent host. It makes *external evidence fabrication* structurally
> impossible instead of merely discouraged by prose.

**Status:** working · single-author personal tooling, published for the *pattern*. One adapter
(Claude Code) is built and self-checked; the other hosts below are **untested sketches**. The
useful part isn't the prompt — it's applying **default-deny tool access to the *reviewer role***
so it structurally can't fabricate the evidence it reviews. (The underlying "allow-list is
complete, deny-list leaks" principle is classic default-deny security — see [Prior art](#prior-art--honest-novelty);
what's less common is naming it as a reviewer-role contract and making it portable.)

---

## Why this exists

Give a reviewer agent tools and ask it to "verify the claims," and one day it will: run an
evaluation itself, misread the output, and assert a fabricated fact as a CRITICAL finding —
inverting a verdict on something that never happened. Self-gathered, misattributed evidence is
**worse than no evidence**: it carries false authority, and it happened here three times in one
session before the cause was clear.

The fix is not a better prompt. A prompt that says *"do not fabricate"* is advice the model can
ignore. The fix is **removing the capability**: a reviewer that has no tools *cannot gather
external evidence*, so it cannot run-then-misattribute it. It reasons only on the artifact in
front of it and hands back a **Claims-To-Verify** list for the orchestrator (which has the tools
and the context) to check.

### What this does and does not guarantee

- **Prevented (structurally, at L2):** *external* evidence-gathering — running evals, reading
  logs, grepping the repo, calling MCP tools. With zero tools this is impossible, not just
  discouraged.
- **NOT prevented:** *inline hallucination* — the model stating a false fact about the artifact
  without any tool call. No tool policy can stop that. It is mitigated behaviorally by the
  prompt's hard constraints (claim vs. inference vs. unsupported; quote-don't-extrapolate) and,
  crucially, by the **Claims-To-Verify** handoff: the orchestrator re-checks anything the verdict
  leans on. *A verdict resting on an unverified claim is a hypothesis, not a finding.*

This repo packages that role so it runs on more than one agent runtime.

## The three things this ships

1. **A neutral spec** (`spec/`) — the role, the tool policy, and the output schema, host-agnostic
   and authored once.
2. **A tool-enforcement conformance model** (L0 → L1 → L2) — *not a new idea*; it applies the
   classic default-deny (allow-list-complete / deny-list-incomplete) principle to per-host agent
   tooling and names *how strongly* a given host can guarantee "no tools," and what leaks if it
   can't. The contribution is the explicit, portable articulation, not the underlying security insight.
3. **A reference adapter** (`adapters/claude-code.mjs`) — a thin transpiler that renders the spec
   into a Claude Code subagent at the strongest level that host supports. Porting to another
   runtime = writing a sibling adapter, not re-deriving the capability.

## Enforcement conformance levels

The portable lesson. "No tools" is only as strong as the host can enforce it:

| Level | Mechanism | Guarantee | Leak |
|---|---|---|---|
| **L0** | prompt-only | **behavioral only** — no structural enforcement; the model *may* comply but nothing forces it | everything, if the calling context grants tools |
| **L1** | per-agent **denylist** | named evidence/mutation tools removed; blocks the *primary* fabrication path (run-eval, read-log, write-file) | **known-incomplete by design** — anything the denylist can't *name*: MCP/plugin tools (no wildcard), newly-added tools, or skills that internally spawn tool-equipped agents |
| **L2** | per-agent **empty allow-list** | resolves to **zero** tools, core and MCP; external evidence-gathering structurally impossible | none — the only *complete* boundary |

> **Real-world trap this encodes:** Claude Code denylists have **no `mcp__*` wildcard** — you
> can name individual MCP tools but not block them as a class — so a `disallowedTools`-only agent
> silently inherits every MCP tool, including a shell-equivalent. Only an **allow-list** (L2)
> drops MCP. The Claude Code adapter therefore emits `tools: []` (L2) with a `disallowedTools`
> hedge (L1) beneath it.
>
> **Honesty about L2 on Claude Code:** the docs state an allow-list excludes MCP tools; the
> specific empty-array case (`tools: []`) was not runtime-confirmable at authoring time because
> the agent registry caches definitions per session. That is *why* the L1 hedge exists. Confirm
> in a fresh session: dispatch `decision-critic` and check it reports zero tools.

## Layout

```
spec/
  prompt.md            # host-agnostic system prompt — the single source of truth
  tool-policy.json     # tool access (empty allow-list) + L0/L1/L2 conformance model
  output.schema.json   # JSON Schema: verdict + verdictIsConditional + machine-readable claimsToVerify[]
adapters/
  claude-code.mjs      # reference transpiler -> Claude Code agents/decision-critic.md  (BUILT, verified)
  README.md            # how to port to a new host
examples/
  claude-code/decision-critic.md   # generated output, checked in
scripts/
  verify.mjs           # spec well-formedness + adapter determinism/conformance self-check
```

## Tested adapters

| Adapter | Host | Status | Max level |
|---|---|---|---|
| `claude-code.mjs` | Claude Code subagents | **built + `verify.mjs` PASS** | L2 (+L1 hedge) |
| _OpenAI / LangChain / MCP_ | — | sketch only, **unbuilt + unverified** (see `adapters/README.md`) | TBD |

## Use it (Claude Code)

```bash
node adapters/claude-code.mjs --out ~/.claude/agents/decision-critic.md
# then, in Claude Code, route decision/analysis reviews to the `decision-critic` subagent
npm run verify   # spec + adapter self-check
```

Edit the **spec**, never the generated file; re-transpile and `npm run verify`.

## Reviewer contract (what it returns)

Always: a `verdict` (REJECT / NEEDS_REVISION / SOUND), a `verdictIsConditional` flag (a SOUND
verdict with open blocking claims is *not* a green light), the single strongest objection (with
the artifact excerpt it rests on), rated load-bearing assumptions, a pre-mortem, the cheapest
evidence that would flip the verdict — and, crucially, **`claimsToVerify[]`**: the facts the
decision rests on that the critic could not confirm. The orchestrator must check those before
acting.

## Prior art & honest novelty

The mechanism here rests on a **well-established** security principle, not a new one:

- **Default-deny / allow-list completeness** — "enumerate what's safe and allow only that; an
  unknown capability is denied, not exposed." Classic, and already discussed for agent tooling
  (e.g. policy-compiler / PCAS work, allow-list-vs-deny-list glossaries). The L0/L1/L2 levels here
  are a *naming* of that principle's strength per host, not a discovery.
- **Per-agent tool governance** exists and is well-resourced — e.g. Microsoft's Agent Governance
  Toolkit does general-purpose *runtime* tool-policy enforcement across languages. This project is
  **not** competing with that; it does something narrower and at a different layer.

What is **less served**, and is this repo's actual contribution:

1. Treating *"a reviewer/judge agent should be tool-less **by construction**"* as a first-class,
   reusable role contract — motivated by a concrete failure mode (a tool-equipped critic gathering
   then misattributing evidence), enforced at agent-*definition* time, not by runtime interception.
2. A **portable** reference implementation: one neutral spec, thin per-host adapters.

If you only need runtime tool governance, use an established toolkit. Reach for this when you
specifically want a *portable, structurally tool-less reviewer*.

## Roadmap (not yet built)

- A second adapter to *prove* the abstraction generalizes rather than asserting it. Strongest
  candidate: **OpenAI's Responses API** (successor to the Assistants API, deprecated, 2026-08-26
  shutdown) — there tools are *supplied per request*, so attaching none (or `tool_choice: "none"`)
  yields zero-tool **L2 naturally**, with no inheritance/MCP-leak to hedge against. Verified the
  API supports `allowed_tools` / `tool_choice`; the empty-tools path is the clean L2 boundary.
- `spec/input.schema.json` to formally mark the artifact as untrusted input (currently handled
  by prompt hardening + a delimiter convention).

## License

MIT © 2026 Lucas Santana
