/**
 * Standalone test for the clip-capture plugin (Phase 1：会话成果归档产品概览).
 *
 * Loads the plugin's apply() with a fake ctx and verifies:
 *   1) clip_session 工具已注册：四字段参数（title/outcome 必填）+ 输出 schema
 *   2) 自动归档监听器已注册在 `session/event`（autoArchive 默认开）
 *   3) execute() 端到端落库：POST /api/workspace/feature-points/iterations
 *      → 产品概览迭代记录出现 source=dsh-agent 且四字段完整 → 清理删除
 *
 * Run (requires backend on http://127.0.0.1:8081):
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
const listeners = [];
const fakeCtx = {
  tools: { register: (t) => tools.push(t) },
  on: (event, handler) => listeners.push({ event, handler }),
};
apply(fakeCtx, { baseUrl: BASE_URL, autoArchive: true });

check('plugin registers exactly one tool', tools.length === 1, `got ${tools.length}`);
const tool = tools[0] || {};
check('tool name is clip_session', tool.name === 'clip_session', tool.name);
const required = Array.isArray(tool.parameters?.required)
  ? tool.parameters.required
  : [];
check('tool requires title & outcome',
  required.includes('title') && required.includes('outcome'),
  `required=${JSON.stringify(required)}`);
check('tool has output schema', tool.output?.schema?.type === 'object');
check('execute is a function', typeof tool.execute === 'function');
check('auto-archive listener registered on session/event',
  listeners.some((l) => l.event === 'session/event' && typeof l.handler === 'function'),
  `listeners: ${listeners.map((l) => l.event).join(',')}`);

// 2) Run execute() end-to-end（显式归档：四字段 → 迭代记录，source=dsh-agent）
const ts = Date.now();
const title = `DSH显式归档测试-${ts}`;
const result = await tool.execute(
  {
    project: 'DSH（DeepSeek Harness）集成',
    title,
    problem: `验证插件测试-${ts}：确认显式归档通路`,
    solution: 'test-plugin 直接调用插件工具 execute()',
    outcome: '会话成果应落库为产品概览迭代记录',
    tags: ['dsh-plugin-test'],
  },
  { signal: new AbortController().signal },
);
check('execute returns {id, source=dsh-agent}',
  result && typeof result.id === 'string' && result.source === 'dsh-agent',
  JSON.stringify(result));

// 3) Verify the iteration record exists in the backend
let found = null;
const iterations = await api('/api/workspace/feature-points/iterations');
for (const it of iterations || []) {
  if (it.id === result.id) { found = it; break; }
}
check('iteration persisted with source=dsh-agent',
  Boolean(found) && found.source === 'dsh-agent' && found.title === title,
  JSON.stringify(found));
check('iteration four fields persisted',
  Boolean(found)
    && typeof found.problem === 'string'
    && typeof found.solution === 'string'
    && typeof found.outcome === 'string'
    && found.tags?.includes('AI会话') === true);

// 4) Cleanup: delete the test record
await api(`/api/workspace/feature-points/iterations/${result.id}`, { method: 'DELETE' });
const after = await api('/api/workspace/feature-points/iterations');
check('iteration deleted after cleanup', !(after || []).some((it) => it.id === result.id));

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;