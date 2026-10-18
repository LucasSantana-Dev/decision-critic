# decision-critic

A reviewer agent that has no tools, on purpose. It reads the decision you hand it, argues against it, and returns a list of claims you still need to check. It can't run anything, so it can't invent evidence by running something and misreading the output.

The role is written once as a neutral spec and transpiled into each agent host. Claude Code is the only adapter built so far.

## Measured

`npm run probe` starts the Claude Code CLI once per config and reads the tool list the host actually resolves. It stops the CLI before the first model call, so it costs no tokens.

![npm run probe: 122 tools, then 108 with a denylist, then 0 with tools: []](docs/probe.gif)

Claude Code 2.1.292, two runs: one with 7 MCP servers connected (13 configured), one with `--no-mcp`:

| Config | Tools (7 MCP servers) | MCP tools | Exec-style* | Tools (no MCP) |
|---|---:|---:|---:|---:|
| No agent | 122 | 91 | 3 | 28 |
| L1: denylist of 17 core tools, inline | 108 | 91 | 2 | 14 |
| L2: `tools: []`, inline | **0** | **0** | **0** | **0** |
| L2: the generated `.md`, loaded from `.claude/agents/` | **0** | **0** | **0** | **0** |

\* Matched by name (`bash`, `shell`, `exec`, `process`, `terminal`, `command`).

The denylist removed the 14 named tools that exist in this version (`Grep`, `Glob` and `Agent` are not separate tools here). It left all 91 MCP tools in place, including one that runs arbitrary shell commands. Even with no MCP servers it left 14 core tools, such as `Workflow`, `SendMessage` and `RemoteTrigger`. The empty allow-list removed everything.

The last row copies the generated file into a temp project and selects it with `--agent`, so Claude Code's own loader parses the frontmatter. The init event has no agent field, so the probe confirms the file was applied through the model it pins (`opus`). With `--agent` the reviewer runs as the main-thread agent. The init event does not list a Task subagent's tools, so that path is not measured.

Your numbers depend on your setup. Both L2 rows should always be 0, and the script exits 1 if either isn't.

## Why

I had a reviewer agent with tools and asked it to verify claims. It ran an eval itself, misread the result, and reported a made-up fact as a critical finding. That flipped the verdict on something that never happened. It did this three times in one session before I found the cause.

Telling the model "do not fabricate" in the prompt didn't fix it. Removing the tools did. A reviewer with no tools reasons only on the artifact and hands back `claimsToVerify[]` for the caller, which has the tools, to check.

What this does and doesn't cover:

- Prevented: gathering outside evidence (running evals, reading logs, grepping, calling MCP tools). With zero tools it can't happen.
- Not prevented: the model stating something false about the artifact with no tool call at all. The prompt asks it to separate claims from inferences, and the caller should re-check anything the verdict depends on before acting on it.

## Enforcement levels

"No tools" is only as strong as the host can enforce it.

| Level | Mechanism | What it guarantees | What leaks |
|---|---|---|---|
| L0 | Prompt only | Nothing structural | Everything the caller grants |
| L1 | Per-agent denylist | Named tools are gone | Anything you can't name: MCP tools (no `mcp__*` wildcard), new tools, plugins |
| L2 | Per-agent empty allow-list | Zero tools, core and MCP | Nothing |

The Claude Code adapter emits `tools: []` (L2) and keeps a `disallowedTools` list (L1) underneath, in case some loader or future version treats an empty array as unset.

## Use it

```bash
node adapters/claude-code.mjs --out ~/.claude/agents/decision-critic.md
npm run verify   # static check of the spec and the generated file
npm run probe    # runtime check against your installed claude CLI
```

Edit `spec/`, never the generated file. Re-run the adapter and `npm run verify` after any change.

## What it returns

A `verdict` (REJECT, NEEDS_REVISION or SOUND), a `verdictIsConditional` flag, the strongest objection with the excerpt it rests on, rated assumptions, a pre-mortem, the cheapest evidence that would flip the verdict, and `claimsToVerify[]`. When `verdictIsConditional` is true, the verdict depends on open claims, so check those first. Schema: `spec/output.schema.json`.

## Layout

```
spec/prompt.md                 host-agnostic system prompt (source of truth)
spec/tool-policy.json          empty allow-list + L0/L1/L2 model
spec/output.schema.json        output contract
adapters/claude-code.mjs       spec -> Claude Code subagent
adapters/README.md             how to port to another host
scripts/verify.mjs             static self-check
scripts/probe-claude-code.mjs  runtime tool check
```

## Prior art

Default-deny (allow-lists are complete, denylists leak) is an old security principle, and general tool-governance toolkits already exist, such as Microsoft's Agent Governance Toolkit. If you need runtime policy across many agents, use one of those. This repo is narrower: it treats "the reviewer has no tools" as a role contract set when the agent is defined, and keeps it portable across hosts.

## Next

- A second adapter to show the spec generalizes. OpenAI's Responses API is the likely one, since tools are passed per request and sending none gives L2 directly.
- `spec/input.schema.json` to mark the artifact as untrusted input.

## Author

I'm Lucas Santana, a senior engineer in Brazil (UTC-3) building AI agent tooling and eval gates on Node/TS backends. I'm open to remote Senior+ roles: [LinkedIn](https://www.linkedin.com/in/devlucassantana).

## License

MIT © 2026 Lucas Santana
