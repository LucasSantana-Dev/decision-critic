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
 * the highest level the host supports. Porting to another agent runtime means
 * writing a sibling of this file — not re-deriving the capability.
 *
 * Claude Code supports L2 (per-agent allow-list) AND L1 (denylist), so this
 * emits BOTH: `tools: []` is the structural guard (an allow-list excludes
 * inherited MCP tools, which a denylist cannot — Claude Code denylists have no
 * `mcp__*` wildcard); `disallowedTools` is the belt-and-suspenders fallback in
 * case a loader ever treats an empty array as "unset -> inherit all".
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

const DEFAULT_MODEL = 'claude-opus-4-6';

// Host-specific knowledge lives in the adapter: map neutral deny-categories to
// this host's concrete tool names. Order is deterministic so output is stable.
const CLAUDE_CODE_TOOLS_BY_CATEGORY = {
  'filesystem-write': ['Write', 'Edit', 'NotebookEdit'],
  'filesystem-read':  ['Read', 'Grep', 'Glob'],
  'shell-exec':       ['Bash'],
  'network':          ['WebFetch', 'WebSearch'],
  'subagent-spawn':   ['Task', 'Agent'],
  // 'mcp' has NO nameable denylist token in Claude Code (no wildcard). It is
  // covered ONLY by the L2 empty allow-list. We surface that gap in a comment.
  'mcp':              ['ToolSearch'], // ToolSearch loads deferred/MCP tool schemas -> deny it by name too
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

function resolveDenylist(policy) {
  const cats = policy.denyCategories ?? [];
  const names = [];
  for (const cat of cats) {
    for (const t of (CLAUDE_CODE_TOOLS_BY_CATEGORY[cat] ?? [])) {
      if (!names.includes(t)) names.push(t);
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
    'Artifact-only adversarial reviewer for DECISIONS and analysis (Opus). Reasons solely on ' +
    'the provided ARTIFACT + CONTRACT — has NO evidence-gathering tools by construction, so it ' +
    'cannot fabricate facts from logs/evals it ran itself. Use for research-and-decide Phase 2; ' +
    'use `critic` for code/plan reviews that need to verify the codebase.';

  const fm = [
    '---',
    'name: decision-critic',
    `description: ${description}`,
    `model: ${model}`,
    'level: 3',
    `# GENERATED from decision-critic spec v${policy.version} by adapters/claude-code.mjs — edit the spec, re-transpile.`,
    '# Zero evidence-gathering tools BY CONSTRUCTION (tool-policy.json: empty allow-list, preferredLevel L2).',
    `#   tools: []            -> L2 structural guard; an empty allow-list resolves to zero tools incl. MCP`,
    `#                           (Claude Code denylists have NO mcp__* wildcard, so only an allow-list drops MCP).`,
    `#   disallowedTools: ... -> L1 fallback; if a loader treats [] as unset, core evidence/mutation tools`,
    `#                           are still stripped, blocking the primary fabrication path (run-eval, read-log).`,
    '# NOTE: MCP tools have no nameable denylist token here — they are covered ONLY by the L2 empty allow-list.',
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
