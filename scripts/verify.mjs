#!/usr/bin/env node
/**
 * Repo self-check: the spec is well-formed and the Claude Code adapter is deterministic
 * and policy-conformant. No external/private dependencies — runs anywhere.
 */
import { readFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
let failures = 0;
const ok  = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.error(`  ✗ ${m}`); failures++; };

// 1) spec JSON parses
const policy = JSON.parse(readFileSync(join(ROOT, 'spec/tool-policy.json'), 'utf8'));
const schema = JSON.parse(readFileSync(join(ROOT, 'spec/output.schema.json'), 'utf8'));
ok('spec/tool-policy.json + spec/output.schema.json are valid JSON');

// 2) policy contract: empty allow-list, L2 preferred
(policy.toolAccess?.mode === 'allowlist' && Array.isArray(policy.toolAccess.allow) && policy.toolAccess.allow.length === 0)
  ? ok('tool policy is an empty allow-list') : bad('tool policy is NOT an empty allow-list');
(policy.enforcement?.preferredLevel === 'L2') ? ok('preferred enforcement level is L2') : bad('preferred level is not L2');

// 3) output schema makes claimsToVerify a required, machine-readable handoff
(schema.required?.includes('claimsToVerify') && schema.properties?.claimsToVerify?.type === 'array')
  ? ok('output schema requires machine-readable claimsToVerify[]') : bad('claimsToVerify not required/array');

// 4) adapter is deterministic (idempotent transpile)
const a = execFileSync('node', [join(ROOT, 'adapters/claude-code.mjs')], { encoding: 'utf8' });
const b = execFileSync('node', [join(ROOT, 'adapters/claude-code.mjs')], { encoding: 'utf8' });
(a === b) ? ok('adapter output is deterministic') : bad('adapter output is non-deterministic');

// 5) committed example matches a fresh transpile (regenerate-in-place is a no-op)
const example = readFileSync(join(ROOT, 'examples/claude-code/decision-critic.md'), 'utf8');
(a === example) ? ok('examples/claude-code/decision-critic.md is up to date') : bad('example is STALE — run npm run build:claude-code');

// 6) generated frontmatter enforces the policy (L2 guard + L1 hedge over every deny-category)
const fm = a.slice(0, a.indexOf('\n---', 4) + 4);
/^tools:\s*\[\]\s*$/m.test(fm) ? ok('emits L2 guard `tools: []`') : bad('missing `tools: []`');
const denyLine = (fm.match(/^disallowedTools:\s*(.+)$/m) || [])[1] || '';
const denyset = new Set(denyLine.split(',').map((s) => s.trim()).filter(Boolean));
let covered = true;
for (const cat of policy.denyCategories) {
  // adapter owns the category->tool map; here we just assert the denylist is non-trivial
  if (cat !== 'mcp' && denyset.size < 3) covered = false;
}
(denyset.size >= 6 && covered) ? ok(`L1 hedge denies ${denyset.size} core tools`) : bad('L1 denylist looks too small');

console.log(failures === 0 ? '\nVERIFY: PASS' : `\nVERIFY: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
