#!/usr/bin/env node
/**
 * Runtime probe: what tools does Claude Code ACTUALLY resolve for the generated agent?
 *
 * verify.mjs checks the generated file statically. This checks the host. It starts the
 * `claude` CLI once per config and reads the tool list from the stream-json `init` event, then
 * kills the process before any model call (no tokens spent):
 *
 *   baseline   no agent                                       -> everything your session has
 *   L1         disallowedTools only, inline --agents          -> what a denylist leaves behind
 *   L2 inline  tools: [] + disallowedTools, inline --agents   -> must be 0
 *   L2 file    the generated .md, loaded from .claude/agents  -> must be 0
 *   L1 + mcp   the L1 denylist plus `mcp__*`, inline --agents -> MCP gone, unnamed core tools stay
 *   mcp only   disallowedTools: ['mcp__*'], inline --agents   -> MCP gone, nearly all core tools stay
 *
 * "L2 file" copies examples/claude-code/decision-critic.md into a temp project's .claude/agents/
 * (renamed so it cannot collide with an installed decision-critic) and selects it with --agent,
 * so Claude Code's own file loader parses the frontmatter. The init event has no agent field, so
 * the probe confirms the file was loaded through the model it pins (an unknown --agent exits
 * before init). Every config runs in that temp project. --agent makes it the main-thread agent;
 * the init event does not list a Task subagent's tools, so that path is not measured here.
 *
 * Prints counts only (your MCP tool names stay private). --names lists the tools L1 leaks.
 * --no-mcp runs every config with an empty, strict MCP config (zero MCP servers).
 * Exit 1 if either L2 row (rows 2 and 3) resolves to more than zero tools. The two `mcp__*`
 * rows are informational and never affect the exit code.
 *
 *   node scripts/probe-claude-code.mjs [--names] [--no-mcp]
 */
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOW_NAMES = process.argv.includes('--names');
const NO_MCP = process.argv.includes('--no-mcp');
const SHELL_HINTS = ['bash', 'shell', 'exec', 'process', 'terminal', 'command'];
const FILE_AGENT = 'dc-probe-file';

const generated = readFileSync(join(ROOT, 'examples/claude-code/decision-critic.md'), 'utf8');
const fm = generated.slice(0, generated.indexOf('\n---', 4) + 4);
const deny = ((fm.match(/^disallowedTools:\s*(.+)$/m) || [])[1] || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
const pinnedModel = (fm.match(/^model:\s*(\S+)/m) || [])[1];
if (!/^tools:\s*\[\]\s*$/m.test(fm) || deny.length === 0 || !/^name:\s*\S+/m.test(fm)) {
  console.error('generated agent is missing `name`, `tools: []` or disallowedTools; run npm run build:claude-code');
  process.exit(2);
}

const project = mkdtempSync(join(tmpdir(), 'dc-probe-'));
mkdirSync(join(project, '.claude', 'agents'), { recursive: true });
writeFileSync(join(project, '.claude', 'agents', `${FILE_AGENT}.md`), generated.replace(/^name:\s*\S+/m, `name: ${FILE_AGENT}`));

const agents = {
  'dc-probe-l1': { description: 'L1 probe', prompt: 'Reply ok.', disallowedTools: deny },
  'dc-probe-l2': { description: 'L2 probe', prompt: 'Reply ok.', tools: [], disallowedTools: deny },
  'dc-probe-l1-mcp': { description: 'L1 + mcp probe', prompt: 'Reply ok.', disallowedTools: [...deny, 'mcp__*'] },
  'dc-probe-mcp-only': { description: 'mcp only probe', prompt: 'Reply ok.', disallowedTools: ['mcp__*'] },
};

function resolveTools(mode) {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--max-turns', '1'];
  // --mcp-config is variadic, so --strict-mcp-config must follow it or it swallows the prompt.
  if (NO_MCP) args.push('--mcp-config', '{"mcpServers":{}}', '--strict-mcp-config');
  if (mode === 'file') args.push('--agent', FILE_AGENT);
  else if (mode) args.push('--agents', JSON.stringify(agents), '--agent', mode);
  args.push('ok');
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, { cwd: project, stdio: ['ignore', 'pipe', 'ignore'] });
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
          resolve({
            tools: ev.tools || [],
            model: ev.model || '',
            configured: (ev.mcp_servers || []).length,
            connected: (ev.mcp_servers || []).filter((s) => s.status === 'connected').length,
          });
          return;
        }
      }
    });
    child.on('close', () => { clearTimeout(timer); if (!done) reject(new Error('claude exited before the init event')); });
  });
}

const summarize = ({ tools, ...rest }) => {
  const mcp = tools.filter((t) => t.startsWith('mcp__'));
  const shell = tools.filter((t) => SHELL_HINTS.some((h) => t.toLowerCase().includes(h)));
  return { total: tools.length, mcp: mcp.length, shell, ...rest };
};

const rows = [];
let failure = null;
try {
  for (const [label, mode] of [
    ['baseline (no agent)', null],
    ['L1 denylist only', 'dc-probe-l1'],
    ['L2 tools: [] (inline)', 'dc-probe-l2'],
    ['L2 tools: [] (.md file)', 'file'],
    ['L1 deny + mcp__*', 'dc-probe-l1-mcp'],
    ['deny mcp__* only', 'dc-probe-mcp-only'],
  ]) {
    const row = { label, ...summarize(await resolveTools(mode)) };
    if (mode === 'file' && pinnedModel && pinnedModel !== 'inherit' && !row.model.includes(pinnedModel)) {
      throw new Error(`file agent not applied: expected model ${pinnedModel}, init reports ${row.model}`);
    }
    rows.push(row);
  }
} catch (e) {
  failure = e;
} finally {
  rmSync(project, { recursive: true, force: true });
}
if (failure) {
  console.error(`probe failed after ${rows.length} rows: ${failure.message}`);
  process.exit(2);
}

const base = rows[0];
console.log(`\n  MCP servers: ${base.connected} connected of ${base.configured} configured${NO_MCP ? ' (--no-mcp)' : ''}`);
console.log('\n  config                      tools   mcp   shell-capable');
for (const r of rows) {
  console.log(`  ${r.label.padEnd(26)} ${String(r.total).padStart(5)} ${String(r.mcp).padStart(5)}   ${r.shell.length}`);
}
if (pinnedModel && pinnedModel !== 'inherit') console.log(`\n  .md file loaded: init model ${rows[3].model} (frontmatter model: ${pinnedModel})`);
const l1 = rows[1];
if (SHOW_NAMES && l1.shell.length) console.log(`\n  shell-capable tools left by L1: ${l1.shell.join(', ')}`);

const L2_ROWS = [rows[2], rows[3]];
const failed = L2_ROWS.filter((r) => r.total !== 0);
console.log(failed.length === 0
  ? '\nPROBE: PASS (both L2 rows resolve to zero tools)'
  : `\nPROBE: FAIL (${failed.map((r) => `${r.label}: ${r.total} tools`).join('; ')})`);
process.exit(failed.length === 0 ? 0 : 1);
