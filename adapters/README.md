# Adapters

An adapter is a thin transpiler that renders the neutral spec (`../spec/`) into one host's
native agent packaging, enforcing the tool policy at the **highest level that host supports**.

| Adapter | Host | Max enforcement | Emits |
|---|---|---|---|
| `claude-code.mjs` | Claude Code subagents | **L2** (empty allow-list) + L1 hedge | `agents/decision-critic.md` |

## Writing a new adapter

1. Read `../spec/prompt.md` (strip the leading HTML maintenance comment) — this is the system
   prompt, verbatim. Do **not** paraphrase it per host.
2. Read `../spec/tool-policy.json`. Determine the highest enforcement level your host supports:
   - **L2** — host has a per-agent *allow-list* that excludes inherited tools (incl. MCP/plugins).
     Emit an empty allow-list. This is the target; prefer it whenever available.
   - **L1** — host has a per-agent *denylist* only. Map `denyCategories` to your host's concrete
     tool names and emit them. Warn that any tool the denylist cannot name (often dynamically
     registered ones) may leak.
   - **L0** — host cannot restrict tools per agent. Emit prompt-only and **warn loudly**: the
     no-tools contract is now advice the model can violate. This is below `minimumLevel`.
3. If the host supports both an allow-list and a denylist, emit **both** (L2 guard + L1 fallback),
   as `claude-code.mjs` does.
4. If the host supports structured/tool-forced output, wire `../spec/output.schema.json` so the
   verdict is machine-readable (the orchestrator consumes `claimsToVerify`).
5. Keep all host-specific knowledge (tool-name maps, frontmatter shape) inside the adapter. The
   spec stays host-neutral.

## Candidate hosts (not yet implemented)

- **OpenAI Assistants / Responses tools** — tool list is an allow-list (L2-capable).
- **MCP prompt server** — expose the prompt + schema as an MCP prompt; tool access governed by
  the *consuming* client, so document the required minimum level (L1).
- **LangChain / LangGraph** — bind zero tools to the node (L2 by construction).
- **Generic OpenAI-compatible chat** — L0/L1 depending on whether the caller gates tool calls.
