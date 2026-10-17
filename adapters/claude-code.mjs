#!/usr/bin/env node
/**
 * decision-critic — Claude Code adapter (reference implementation).
 *
 * Transpiles the neutral spec (../spec/*) into a Claude Code subagent file
 * (`agents/decision-critic.md`: YAML frontmatter + system-prompt body).
 *
 * Why an adapter and not a copied prompt: the role, the tool policy, and the
 * output schema live ONCE in ../spec. Each host gets a thin transpiler that
 * (a) renders the host's native packaging and (b) enforces the tool policy at
 * the highest level the host supports. Porting to another runtime = writing a
 * sibling of this file, not re-deriving the capability.
 *
 * Claude Code supports L2 (per-agent allow-list) AND L1 (denylist), so this
 * emits BOTH:
 *   - `tools: []`        L2 structural guard. An allow-list excludes inherited
 *                        tools it never names, including MCP — the ONLY complete
 *                        boundary. (Documented to exclude MCP; the empty-array
 *                        edge case could not be runtime-verified at authoring
 *                        time because the agent registry caches definitions per
 *                        session — see the generated file's header note.)
 *   - `disallowedTools`  L1 hedge. If a loader ever treats `[]` as "unset ->
 *                        inherit all", this still strips the named core
 *                        evidence/mutation/escape tools. KNOWN-INCOMPLETE: a
 *                        denylist only removes tools it can NAME, so MCP (no
 *                        mcp__* wildcard here) and any unenumerated tool leak.
 *                        L2 is the real guarantee; L1 only caps the blast radius.
 *
 * Usage:
 *   node adapters/claude-code.mjs                 # -> stdout
 *   node adapters/claude-code.mjs --out FILE      # -> write FILE
 *   node adapters/claude-code.mjs --model NAME    # override model (default below)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SPEC = join(HERE, '..', 'spec');

// Overridable. Not portable knowledge — a Claude-Code-specific default; pass --model to change.
const DEFAULT_MODEL = 'opus';

// Host-specific knowledge lives in the adapter: map neutral deny-categories to
// this host's concrete tool names. Categories with no Claude Code tool are skipped.
// Order is deterministic so output is stable.
const CLAUDE_CODE_TOOLS_BY_CATEGORY = {
  'filesystem-read':  ['Read', 'Grep', 'Glob'],
  'filesystem-write': ['Write', 'Edit', 'NotebookEdit'],
  'shell-exec':       ['Bash'],
  'network':          ['WebFetch', 'WebSearch'],
  'subagent-spawn':   ['Task', 'Agent'],
  // A skill can internally invoke a composite that spawns tool-equipped agents,
  // re-granting evidence-gathering by the back door — deny it under L1.
  'skill-invoke':     ['Skill'],
  // Session/worktree controls are NOT in the "core" set and silently leak under a
  // bare denylist (observed). The critic needs none of them.
  'session-control':  ['EnterWorktree', 'ExitWorktree', 'Monitor', 'TaskStop'],
  // 'mcp' has NO wildcard token in Claude Code denylists: you cannot write
  // `disallowedTools: mcp__*`. Individual MCP tools CAN be named, but enumerating
  // them all is impractical and breaks as servers register dynamically. So MCP is
  // covered ONLY by the L2 empty allow-list. ToolSearch (which LOADS deferred/MCP
  // tool schemas) is denied to block discovery — best-effort, not a substitute for L2.
  'mcp':              ['ToolSearch'],
};

function parseArgs(argv) {
  const out = { out: null, model: DEFAULT_MODEL };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--out') out.out = argv[++i];
    else if (argv[i] === '--model') out.model = argv[++i];
  }
  return out;
}

function loadPromptBody() {
  const raw = readFileSync(join(SPEC, 'prompt.md'), 'utf8');
  // Strip the leading HTML maintenance comment; keep the role prose verbatim.
  return raw.replace(/^<!--[\s\S]*?-->\s*/, '').trim() + '\n';
}

function denyClasses(policy) {
  // Supports both the v0.2 object form ({_note, classes:[...]}) and a bare array.
  const dc = policy.denyCategories;
  return Array.isArray(dc) ? dc : (dc?.classes ?? []);
}

function resolveDenylist(policy) {
  const names = [];
  for (const cat of denyClasses(policy)) {
    for (const t of (CLAUDE_CODE_TOOLS_BY_CATEGORY[cat] ?? [])) {
      if (!names.includes(t)) names.push(t); // skip categories with no host tool
    }
  }
  return names;
}

function buildAgentFile(model) {
  const policy = JSON.parse(readFileSync(join(SPEC, 'tool-policy.json'), 'utf8'));
  const body = loadPromptBody();
  const denylist = resolveDenylist(policy);

  if (policy.toolAccess.mode !== 'allowlist' || policy.toolAccess.allow.length !== 0) {
    throw new Error('This adapter assumes an empty allow-list (the decision-critic contract).');
  }

  const description =
    'Artifact-only adversarial reviewer for DECISIONS and analysis. Reasons solely on ' +
    'the provided ARTIFACT + CONTRACT — has NO evidence-gathering tools by construction, so it ' +
    'cannot fabricate facts from logs/evals it ran itself. Use before committing a decision; ' +
    'use a tool-equipped reviewer for code reviews that need to verify the codebase.';

  const fm = [
    '---',
    'name: decision-critic',
    `description: ${description}`,
    `model: ${model}`,
    `# GENERATED from decision-critic spec v${policy.version} by adapters/claude-code.mjs — edit the spec, re-transpile.`,
    '# Zero evidence-gathering tools BY CONSTRUCTION (tool-policy.json: empty allow-list, preferredLevel L2).',
    '#   tools: []            -> L2 structural guard. An empty allow-list resolves to zero tools incl. MCP',
    '#                           and is the ONLY complete boundary (a denylist cannot name every MCP/plugin',
    '#                           tool; Claude Code denylists have NO mcp__* wildcard). DOCUMENTED to exclude',
    '#                           MCP; runtime-confirmed by scripts/probe-claude-code.mjs. The L1 hedge below',
    '#                           stays for any loader that treats an empty array as unset.',
    '#   disallowedTools: ... -> L1 hedge. If a loader treats [] as unset, this still strips named core',
    '#                           evidence/mutation/escape tools (incl. Skill + worktree/session controls that',
    '#                           otherwise leak). KNOWN-INCOMPLETE: MCP + unenumerated tools still leak at L1.',
    'tools: []',
    `disallowedTools: ${denylist.join(', ')}`,
    '---',
    '',
  ].join('\n');

  return fm + '\n' + body;
}

const args = parseArgs(process.argv);
const content = buildAgentFile(args.model);
if (args.out) {
  writeFileSync(args.out, content);
  process.stderr.write(`wrote ${args.out}\n`);
} else {
  process.stdout.write(content);
}
