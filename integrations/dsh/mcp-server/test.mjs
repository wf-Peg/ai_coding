/**
 * Standalone test for the CutShelter MCP bridge.
 *
 * Spawns the real server over stdio (the same path DSH's mcp-client uses),
 * then runs: initialize → tools/list → a few tools/call against the live
 * CutShelter backend (requires it running on http://127.0.0.1:8081).
 *
 * Run:  npm install && node test.mjs
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const serverScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'server.mjs');
const baseUrl = process.env.CUTSHELTER_BASE_URL || 'http://127.0.0.1:8081';

const client = new Client({ name: 'cut-shelter-bridge-test', version: '0.0.1' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverScript],
  env: { ...process.env, CUTSHELTER_BASE_URL: baseUrl },
});

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; console.log(`  ✘ ${name} ${extra}`); }
}

try {
  await client.connect(transport);
  console.log('connected ✔');

  // tools/list
  const { tools } = await client.listTools();
  console.log(`tools/list: ${tools.length} tools`);
  const names = tools.map((t) => t.name);
  const expected = [
    'clip_search', 'clip_list', 'clip_add', 'clip_delete', 'clip_categories',
    'todo_list', 'todo_add', 'todo_set_status', 'learning_plan_list',
    'wiki_index', 'weekly_report_status', 'tools_hub_list', 'tools_hub_page',
  ];
  for (const n of expected) check(`tool ${n}`, names.includes(n));

  // tools/call — read-only probes against the live backend
  const cat = await client.callTool({ name: 'clip_categories', arguments: {} });
  check('clip_categories returns text content', cat.content && cat.content.length > 0);

  const list = await client.callTool({ name: 'clip_list', arguments: { limit: 5 } });
  check('clip_list returns text content', list.content && list.content.length > 0);

  const todos = await client.callTool({ name: 'todo_list', arguments: {} });
  check('todo_list returns text content', todos.content && todos.content.length > 0);

  const idx = await client.callTool({ name: 'wiki_index', arguments: {} });
  check('wiki_index returns text content', idx.content && idx.content.length > 0);

  const wr = await client.callTool({ name: 'weekly_report_status', arguments: {} });
  check('weekly_report_status returns text content', wr.content && wr.content.length > 0);

  // write round-trip (clearly labeled; cleaned up afterwards)
  const ts = Date.now();
  const added = await client.callTool({
    name: 'clip_add',
    arguments: {
      content: `【DSH桥接测试-${ts}】这是一条由 MCP 桥自动化测试创建的剪藏，验证后将被删除。`,
      title: `DSH桥接测试-${ts}`,
      summary: 'MCP 桥自动化测试条目',
      tags: ['dsh-bridge-test'],
      useAiTags: false,
    },
  });
  const addText = (added.content || [])
    .map((b) => (typeof b === 'object' && b !== null && 'text' in b ? b.text : String(b)))
    .join('\n');
  const idMatch = addText.match(/id=(\d+)/) || addText.match(/"id"\s*:\s*"?(\d+)"?/);
  check('clip_add returns an id', !!idMatch, addText.slice(0, 200));
  if (idMatch) {
    const id = Number(idMatch[1]);
    // clip_add 会异步触发 AI 分析，分析完成时会保存剪藏——若在分析期间删除，
    // 分析结束后会把剪藏写回（后端行为，非桥问题）。因此：
    // 1) 先轮询等待 analysisStatus=ready（分析落盘完成，最长 90s）；
    // 2) 再删除并轮询确认，必要时重试删除。
    let ready = false;
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline && !ready) {
      const after = await client.callTool({ name: 'clip_list', arguments: {} });
      const afterText = (after.content || [])
        .map((b) => (typeof b === 'object' && b !== null && 'text' in b ? b.text : String(b)))
        .join('\n');
      ready = afterText.includes(`"id": ${id}`) && /"analysisStatus"\s*:\s*"ready"/.test(afterText);
      if (!ready) await new Promise((r) => setTimeout(r, 3000));
    }
    console.log(`  (analysis ready after ${ready ? 'wait' : 'timeout'}, id=${id})`);

    let gone = false;
    for (let attempt = 0; attempt < 3 && !gone; attempt++) {
      await client.callTool({ name: 'clip_delete', arguments: { id } });
      await new Promise((r) => setTimeout(r, 2500));
      const after = await client.callTool({ name: 'clip_list', arguments: {} });
      const afterText = (after.content || [])
        .map((b) => (typeof b === 'object' && b !== null && 'text' in b ? b.text : String(b)))
        .join('\n');
      gone = !new RegExp(`"id"\\s*:\\s*${id}(\\s|,|\\})`).test(afterText) && !afterText.includes(`id=${id}`);
    }
    check('clip_delete actually removes the clip', gone);
  }

  // search probe
  const search = await client.callTool({ name: 'clip_search', arguments: { query: 'DSH桥接测试', topK: 3 } });
  check('clip_search returns text content', search.content && search.content.length > 0);

  console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
} catch (err) {
  console.error('TEST FAILED:', err.message);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
