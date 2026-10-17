#!/usr/bin/env node
/**
 * Runtime probe: what tools does Claude Code ACTUALLY resolve for the generated agent?
 *
 * verify.mjs checks the generated file statically. This checks the host. It starts the
 * `claude` CLI three times and reads the tool list from the stream-json `init` event, then
 * kills the process before any model call (no tokens spent):
 *
 *   baseline  no agent                                  -> everything your session has
 *   L1        disallowedTools only (the adapter's hedge) -> what a denylist leaves behind
 *   L2        tools: [] + disallowedTools (as generated) -> must be 0
 *
 * Prints counts only (your MCP tool names stay private). --names lists the tools L1 leaks.
 * Exit 1 if L2 resolves to more than zero tools.
 *
 *   node scripts/probe-claude-code.mjs [--names]
 */
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOW_NAMES = process.argv.includes('--names');
const SHELL_HINTS = ['bash', 'shell', 'exec', 'process', 'terminal', 'command'];

const generated = readFileSync(join(ROOT, 'examples/claude-code/decision-critic.md'), 'utf8');
const fm = generated.slice(0, generated.indexOf('\n---', 4) + 4);
const deny = ((fm.match(/^disallowedTools:\s*(.+)$/m) || [])[1] || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
if (!/^tools:\s*\[\]\s*$/m.test(fm) || deny.length === 0) {
  console.error('generated agent is missing `tools: []` or disallowedTools; run npm run build:claude-code');
  process.exit(2);
}

const agents = {
  'dc-probe-l1': { description: 'L1 probe', prompt: 'Reply ok.', disallowedTools: deny },
  'dc-probe-l2': { description: 'L2 probe', prompt: 'Reply ok.', tools: [], disallowedTools: deny },
};

function resolveTools(agent) {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--max-turns', '1'];
  if (agent) args.push('--agents', JSON.stringify(agents), '--agent', agent);
  args.push('ok');
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let buf = '';
    let done = false;
    const timer = setTimeout(() => { child.kill(); if (!done) reject(new Error('timeout waiting for init event')); }, 60_000);
    child.on('error', (e) => { clearTimeout(timer); reject(e.code === 'ENOENT' ? new Error('`claude` CLI not found on PATH') : e); });
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'system' && ev.subtype === 'init') {
          done = true;
          clearTimeout(timer);
          child.kill();
          resolve(ev.tools || []);
          return;
        }
      }
    });
    child.on('close', () => { clearTimeout(timer); if (!done) reject(new Error('claude exited before the init event')); });
  });
}

const summarize = (tools) => {
  const mcp = tools.filter((t) => t.startsWith('mcp__'));
  const shell = tools.filter((t) => SHELL_HINTS.some((h) => t.toLowerCase().includes(h)));
  return { total: tools.length, mcp: mcp.length, shell };
};

const rows = [];
for (const [label, agent] of [['baseline (no agent)', null], ['L1 denylist only', 'dc-probe-l1'], ['L2 tools: [] (generated)', 'dc-probe-l2']]) {
  try {
    rows.push({ label, ...summarize(await resolveTools(agent)) });
  } catch (e) {
    console.error(`probe failed for ${label}: ${e.message}`);
    process.exit(2);
  }
}

console.log('\n  config                      tools   mcp   shell-capable');
for (const r of rows) {
  console.log(`  ${r.label.padEnd(26)} ${String(r.total).padStart(5)} ${String(r.mcp).padStart(5)}   ${r.shell.length}`);
}
const l1 = rows[1];
if (SHOW_NAMES && l1.shell.length) console.log(`\n  shell-capable tools left by L1: ${l1.shell.join(', ')}`);

const l2 = rows[2];
console.log(l2.total === 0 ? '\nPROBE: PASS (L2 resolves to zero tools)' : `\nPROBE: FAIL (L2 resolves to ${l2.total} tools)`);
process.exit(l2.total === 0 ? 0 : 1);
