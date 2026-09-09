/**
 * End-to-end smoke test for the CutShelter MCP bridge, focused on wiki_ask.
 *
 * This is the "口子" (entry) for an external agent / human to verify the whole
 * cut-shelter MCP server actually works: it spawns the real server over stdio
 * (the exact path DSH's mcp-client uses), then runs initialize → tools/list →
 * one real wiki_ask query against the live backend and prints the answer.
 *
 * Requires the CutShelter backend running on http://127.0.0.1:8081 (override
 * with CUTSHELTER_BASE_URL). A real question touches the LLM pipeline, so it
 * can take from seconds to a couple of minutes (override CUTSHELTER_TIMEOUT_MS).
 *
 * Usage:
 *   node smoke-ask.mjs                                  # default broad question
 *   node smoke-ask.mjs --question="谁是 xxx"
 *   node smoke-ask.mjs --question="..." --include-clips
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const serverScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'server.mjs');
const baseUrl = process.env.CUTSHELTER_BASE_URL || 'http://127.0.0.1:8081';
const timeoutMs = Number(process.env.CUTSHELTER_TIMEOUT_MS || 120000);

function argValue(name, def) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.slice(`--${name}=`.length) : def;
}

const question = argValue('question', '知识库里主要沉淀了哪些方面的内容？');
const includeClips = process.argv.includes('--include-clips');

const client = new Client({ name: 'cut-shelter-ask-smoke', version: '0.0.1' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverScript],
  env: { ...process.env, CUTSHELTER_BASE_URL: baseUrl },
});

function textOf(res) {
  return (res.content || [])
    .map((b) => (typeof b === 'object' && b !== null && 'text' in b ? b.text : String(b)))
    .join('\n');
}

try {
  await client.connect(transport);
  console.log(`connected → CutShelter MCP (${baseUrl}) ✔`);

  const { tools } = await client.listTools();
  const wiki = tools.filter((t) => t.name.includes('wiki')).map((t) => t.name);
  console.log(`wiki tools: ${wiki.join(', ') || '(none)'}`);

  console.log(`\nwiki_ask(query=${JSON.stringify(question)} includeKnowledge=true${includeClips ? ' includeClips=true' : ''})`);
  console.log('…（正在跑「编译检索→读全文→LLM综合」，可能数秒到数十秒）\n');

  const res = await Promise.race([
    client.callTool({
      name: 'wiki_ask',
      arguments: { question, includeClips, includeKnowledge: true },
    }),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout after ${timeoutMs}ms（可用 CUTSHELTER_TIMEOUT_MS 调大）`)), timeoutMs)),
  ]);

  console.log('────── 答案 ──────\n' + textOf(res) + '\n──────────────────');
  console.log('\nOK：MCP wiki_ask 端到端可用');
} catch (err) {
  console.error('SMOKE FAILED:', err.message);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}