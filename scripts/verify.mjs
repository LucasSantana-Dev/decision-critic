#!/usr/bin/env node
/**
 * Repo self-check: the spec is well-formed and the Claude Code adapter is deterministic
 * and policy-conformant. No external/private dependencies; runs anywhere.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
let failures = 0;
const ok  = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.error(`  ✗ ${m}`); failures++; };

const policy = JSON.parse(readFileSync(join(ROOT, 'spec/tool-policy.json'), 'utf8'));
const schema = JSON.parse(readFileSync(join(ROOT, 'spec/output.schema.json'), 'utf8'));
ok('spec/tool-policy.json + spec/output.schema.json are valid JSON');

// policy contract: empty allow-list, L2 preferred, L1 minimum
(policy.toolAccess?.mode === 'allowlist' && Array.isArray(policy.toolAccess.allow) && policy.toolAccess.allow.length === 0)
  ? ok('tool policy is an empty allow-list') : bad('tool policy is NOT an empty allow-list');
(policy.enforcement?.preferredLevel === 'L2' && policy.enforcement?.minimumLevel === 'L1')
  ? ok('enforcement preferred=L2 minimum=L1') : bad('enforcement levels wrong');
['L0', 'L1', 'L2'].every((l) => policy.enforcement?.levels?.[l]?.guarantee)
  ? ok('L0/L1/L2 each define a guarantee') : bad('a conformance level is missing its guarantee');

// output schema makes the safety handoff machine-readable + non-ignorable
(schema.required?.includes('claimsToVerify') && schema.properties?.claimsToVerify?.type === 'array')
  ? ok('output schema requires claimsToVerify[]') : bad('claimsToVerify not required/array');
(schema.required?.includes('verdictIsConditional'))
  ? ok('output schema requires verdictIsConditional (verdict cannot silently ignore open claims)')
  : bad('verdictIsConditional not required');

// adapter is deterministic (idempotent transpile)
const a = execFileSync('node', [join(ROOT, 'adapters/claude-code.mjs')], { encoding: 'utf8' });
const b = execFileSync('node', [join(ROOT, 'adapters/claude-code.mjs')], { encoding: 'utf8' });
(a === b) ? ok('adapter output is deterministic') : bad('adapter output is non-deterministic');

// committed example matches a fresh transpile (regenerate-in-place is a no-op)
const example = readFileSync(join(ROOT, 'examples/claude-code/decision-critic.md'), 'utf8');
(a === example) ? ok('examples/claude-code/decision-critic.md is up to date')
                : bad('example is STALE: run npm run build:claude-code');

// generated frontmatter enforces the policy (L2 guard + L1 hedge)
const fm = a.slice(0, a.indexOf('\n---', 4) + 4);
/^tools:\s*\[\]\s*$/m.test(fm) ? ok('emits L2 guard `tools: []`') : bad('missing `tools: []`');
const denyLine = (fm.match(/^disallowedTools:\s*(.+)$/m) || [])[1] || '';
const denyset = new Set(denyLine.split(',').map((s) => s.trim()).filter(Boolean));

// every nameable deny-category (all but 'mcp', which is covered by L2 and the ToolSearch deny, not by an `mcp__*` token) maps to >=1 tool
const classes = Array.isArray(policy.denyCategories) ? policy.denyCategories : (policy.denyCategories?.classes ?? []);
const nameable = classes.filter((c) => c !== 'mcp');
// the adapter owns the map; re-derive expected coverage by importing nothing; assert the denylist
// is non-trivial AND covers the high-value escape vectors the threat review flagged.
const mustDeny = ['Bash', 'Read', 'Write', 'Edit', 'Skill', 'EnterWorktree', 'ExitWorktree'];
const missing = mustDeny.filter((t) => !denyset.has(t));
(denyset.size >= nameable.length && missing.length === 0)
  ? ok(`L1 hedge denies ${denyset.size} tools incl. all escape vectors (${mustDeny.join(', ')})`)
  : bad(`L1 denylist missing escape vectors: ${missing.join(', ') || '(size too small)'}`);

console.log(failures === 0 ? '\nVERIFY: PASS' : `\nVERIFY: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
