/**
 * Standalone test for the clip-capture plugin (Phase 1).
 *
 * Loads the plugin's apply() with a fake ctx, verifies the registered tool's
 * shape, then runs its execute() against a live CutShelter backend:
 *   clip_session → /api/clip/add → clip appears → analysis settles → deleted.
 *
 * Run (requires backend on http://127.0.0.1:8081 and `npm install` done):
 *   node test-plugin.mjs
 */
import assert from 'node:assert/strict';
import { apply } from './index.mjs';

const BASE_URL = process.env.CUTSHELTER_BASE_URL || 'http://127.0.0.1:8081';
let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; console.log(`  ✘ ${name} ${extra}`); }
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(BASE_URL + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

// 1) Load plugin with a fake ctx (config is passed as the 2nd apply argument, per Cordis)
const tools = [];
const fakeCtx = {
  tools: { register: (t) => tools.push(t) },
};
apply(fakeCtx, { baseUrl: BASE_URL });

check('plugin registers exactly one tool', tools.length === 1, `got ${tools.length}`);
const tool = tools[0] || {};
check('tool name is clip_session', tool.name === 'clip_session', tool.name);
check('tool has required parameters title/summary',
  Array.isArray(tool.parameters?.required)
  && tool.parameters.required.includes('title')
  && tool.parameters.required.includes('summary'));
check('tool has output schema', tool.output?.schema?.type === 'object');
check('execute is a function', typeof tool.execute === 'function');

// 2) Run execute() end-to-end
const ts = Date.now();
const title = `DSH会话落库测试-${ts}`;
const result = await tool.execute(
  { title, summary: `【DSH桥接测试-${ts}】这是一条由 clip_session 插件测试创建的剪藏，验证后将被删除。`, tags: ['dsh-plugin-test'] },
  { signal: new AbortController().signal },
);
check('execute returns {id, status}', result && typeof result.id === 'number' && result.status === 'success', JSON.stringify(result));

// 3) Verify the clip exists in the backend
let found = false;
const clips = await api('/api/clip/list');
for (const c of clips || []) {
  if (c.id === result.id && c.title === title) found = true;
}
check('clip persisted with correct title', found);

// 4) Wait for async AI analysis to settle, then delete (avoids analysis re-save)
let ready = false;
const deadline = Date.now() + 120_000;
while (Date.now() < deadline && !ready) {
  const list = await api('/api/clip/list');
  const item = (list || []).find((c) => c.id === result.id);
  ready = item ? item.analysisStatus === 'ready' : false;
  if (!ready) await new Promise((r) => setTimeout(r, 3000));
}
console.log(`  (analysis ready after ${ready ? 'wait' : 'timeout'}, id=${result.id})`);

await api(`/api/clip/${result.id}`, { method: 'DELETE' });
await new Promise((r) => setTimeout(r, 2000));
const after = await api('/api/clip/list');
check('clip deleted after cleanup', !(after || []).some((c) => c.id === result.id));

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
