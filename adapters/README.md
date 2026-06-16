# Adapters

An adapter is a thin transpiler that renders the neutral spec (`../spec/`) into one host's
native agent packaging, enforcing the tool policy at the **highest level that host supports**.

| Adapter | Host | Status | Max enforcement | Emits |
|---|---|---|---|---|
| `claude-code.mjs` | Claude Code subagents | **built + verified** | **L2** (empty allow-list) + L1 hedge | `agents/decision-critic.md` |

Everything in "Candidate hosts" below is an **unbuilt sketch** — the enforcement level is the
*question to answer*, not a verified capability. Do not cite it as fact until an adapter exists.

## Writing a new adapter

1. Read `../spec/prompt.md` (strip the leading HTML maintenance comment) — this is the system
   prompt, verbatim. Do **not** paraphrase it per host.
2. Read `../spec/tool-policy.json`. `denyCategories.classes` is a **vocabulary** of capability
   classes — a host that lacks a class (e.g. no subagent API) simply has nothing to map for it;
   skip it. Absence from your generated artifact is **not** a conformance violation.
3. Determine the highest enforcement level your host supports:
   - **L2** — host has a per-agent *allow-list* that excludes inherited tools (incl. MCP/plugins).
     Emit an empty allow-list. This is the target; prefer it whenever available. It is the only
     *complete* boundary.
   - **L1** — host has a per-agent *denylist* only. Map the applicable `denyCategories.classes`
     to your host's concrete tool names and emit them. **Warn** that any tool the denylist can't
     *name* (dynamically-registered MCP/plugin tools, skills that spawn tool-equipped agents,
     session/worktree controls) may leak. L1 caps blast radius; it does not seal the boundary.
   - **L0** — see "When conformance can't be reached" below.
4. If the host supports both an allow-list and a denylist, emit **both** (L2 guard + L1 fallback),
   as `claude-code.mjs` does.
5. If the host supports structured/tool-forced output, wire `../spec/output.schema.json` so the
   verdict is machine-readable (the orchestrator consumes `claimsToVerify` and `verdictIsConditional`).
   If the host is prose-only, your adapter SHOULD assert the labeled-prose field names from
   `prompt.md` are present in a sample output.
6. Keep all host-specific knowledge (tool-name maps, frontmatter shape) inside the adapter. The
   spec stays host-neutral.
7. Run `npm run verify` (extend it with a host-specific check if useful).

## When conformance can't be reached (L0 hosts)

Some hosts (a generic OpenAI-compatible chat endpoint, anything where the *caller* — not the
agent definition — controls tools) cannot restrict tools per agent at all. For these:

- Emit the prompt as-is and **warn loudly**, both in a comment in the generated artifact and on
  stderr: *"L0 — no structural tool enforcement. The no-tools contract is advisory; the model
  can still call any tool the calling context grants."*
- Document the **caller-side** restriction required to make it real — e.g. "when invoking this
  agent, bind zero tools / pass an empty `tools` list." Without that, the guarantee is prose only.
- L0 is below `minimumLevel` (L1). Treat shipping at L0 as a known, stated gap, not a default.

## Hosts without a pre-defined core toolset

`denyCategories` assumes a host with a catalog of built-in tools to *remove*. Hosts where every
tool is user-supplied (you add tools rather than subtract them) are naturally L2: supply none and
the agent has none. There, the denylist is moot — emit an empty allow-list (or simply attach no
tools) and skip the category mapping entirely.

## Candidate hosts (unbuilt — verify before relying)

For each, the open question is *can it express "this agent gets zero tools," and does that also
exclude any inherited/MCP tools?*

- **OpenAI — Responses API** (successor to the **Assistants API**, which is **deprecated,
  shutdown 2026-08-26**; do not target Assistants). Tools are user-supplied per request, so
  attaching none is naturally L2. Verify how it handles built-in/hosted tools before claiming a
  complete boundary.
- **MCP prompt server.** MCP exposes prompts/resources/tools; it does **not** define tool-access
  governance at the protocol level. Enforcement is entirely the **consuming client's** job (a
  Claude Code client gets Claude Code's L2/L1; another client may differ). Document the level for
  a *specific* client, not "MCP" in the abstract.
- **LangChain / LangGraph.** Binding zero tools to a node makes that node tool-less (L2 for the
  node alone). Confirm the node cannot spawn child agents / call tool-providing services that
  re-introduce tools before claiming L2.
- **Generic OpenAI-compatible chat.** Usually L0/L1 depending on whether the caller gates tool
  calls — see "When conformance can't be reached."
