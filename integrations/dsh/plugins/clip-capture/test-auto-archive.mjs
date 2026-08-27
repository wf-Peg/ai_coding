/**
 * 插件自动归档触发逻辑测试（clip-capture，Phase 1：会话成果自动归档产品概览）
 *
 * 不依赖真实 DSH / 后端，也不走真实事件总线：用 fake ctx 捕获 apply() 里注册的
 * `session/event` 监听器，直接喂入构造好形状的 (subject, event)，并 stub 全局
 * fetch 以拦截自动归档的 POST 请求。验证自动路径的完整触发与抑制逻辑。
 *
 * Run (无需后端，命令见文件末注释)：
 *   node test-auto-archive.mjs
 *
 * 覆盖：
 *  1) turn/end reason=completed 且有工具产出 → 触发 POST /ai-session
 *  2) reason=blocked（非 completed）→ 不触发
 *  3) 闲聊轮（无工具 + 短文本 <500）→ 不触发
 *  4) 显式调用 clip_session → 抑制自动归档，不发 /ai-session
 *  5) 同 turn 幂等：重复触发同 (sessionId, turn) → 只发一次
 */
import assert from 'node:assert/strict';
import { apply } from './index.mjs';

// ── stub 全局 fetch：拦截 POST，绝不真正联网 ──
let posts = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (opts?.method === 'POST') posts.push({ url: String(url), body: opts.body });
  return new Response('{"id":"stub"}', { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const BASE = 'http://127.0.0.1:1';

/** 建一个独立 harness（独立闭包状态），返回可触发 session/event 监听器的工具。 */
function makeHarness() {
  const listeners = [];
  const ctx = {
    tools: { register: () => {} },
    on: (event, handler) => listeners.push({ event, handler }),
  };
  apply(ctx, { baseUrl: BASE, autoArchive: true });
  const listener = listeners.find((l) => l.event === 'session/event');
  assert.ok(listener, 'should register a session/event listener');
  return {
    fire: (subject, event) => listener.handler(subject, event),
  };
}

/** 构造一轮（turn）会话的 subject（events 形状照抄 DSH agent-loop 广播内容）。 */
function turnSubject(id, { tool = null, assistantLen = 0, endKind = 'completed' } = {}) {
  const events = [{ type: 'turn/start', data: { turn: 1 } }];
  events.push({ type: 'user/message', data: { content: [{ type: 'text', text: '请帮我处理这个需求' }] } });
  if (tool) events.push({ type: 'tool/call', data: { turn: 1, step: 1, name: tool } });
  events.push({
    type: 'assistant/message',
    data: { turn: 1, step: 2, message: { content: [{ type: 'text', text: 'x'.repeat(assistantLen) }] } },
  });
  events.push({ type: 'turn/end', data: { turn: 1, reason: { kind: endKind } } });
  return { id, events };
}

const endEvent = () => ({ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
function sleep(ms = 30) { return new Promise((r) => setTimeout(r, ms)); }

let failures = 0;
function case_ok(name, cond, extra = '') {
  if (cond) console.log(`  ✔ ${name}`);
  else { failures += 1; console.log(`  ✘ ${name} ${extra}`); }
}

// ── 1. completed + 有工具产出 → 触发 POST /ai-session ──
{
  posts = [];
  const h = makeHarness();
  h.fire(turnSubject('s-tool', { tool: 'clip_search', assistantLen: 60 }), endEvent());
  await sleep();
  const hit = posts.find((p) => p.url.endsWith('/iterations/ai-session'));
  case_ok('completed+工具产出 → 触发自动归档 POST /ai-session', Boolean(hit));
  case_ok('POST 是 JSON 且 conversation 聚合了本轮（含工具名）',
    hit && JSON.parse(hit.body).conversation.includes('clip_search')
      && JSON.parse(hit.body).conversation.includes('请帮我处理这个需求'),
    hit && hit.body);
}

// ── 2. reason=blocked → 不触发 ──
{
  posts = [];
  const h = makeHarness();
  h.fire(turnSubject('s-blocked', { tool: 'clip_search', endKind: 'blocked' }),
    { ...endEvent(), data: { turn: 1, reason: { kind: 'blocked' } } });
  await sleep();
  const hit = posts.find((p) => p.url.endsWith('/ai-session'));
  case_ok('非 completed（blocked）→ 不触发自动归档', !hit);
}

// ── 3. 闲聊轮（无工具 + 短文本 <500）→ 不触发 ──
{
  posts = [];
  const h = makeHarness();
  h.fire(turnSubject('s-chat', { assistantLen: 100 }), endEvent());
  await sleep();
  const hit = posts.find((p) => p.url.endsWith('/ai-session'));
  case_ok('闲聊轮（无工具、文本短）→ 不触发自动归档', !hit);
}

// ── 4. 显式调用 clip_session → 抑制自动归档 ──
{
  posts = [];
  const h = makeHarness();
  h.fire(turnSubject('s-explicit', { tool: 'tools_hub__clip_session', assistantLen: 80 }), endEvent());
  await sleep();
  const hit = posts.find((p) => p.url.endsWith('/ai-session'));
  case_ok('显式 clip_session（含命名空间前缀）→ 抑制自动归档，不发 /ai-session', !hit);
}

// ── 5. 同 (sessionId, turn) 幂等去重：只发一次 ──
{
  posts = [];
  const h = makeHarness();
  h.fire(turnSubject('s-dedup', { tool: 'clip_add', assistantLen: 60 }), endEvent());
  h.fire(turnSubject('s-dedup', { tool: 'clip_add', assistantLen: 60 }), endEvent());
  await sleep();
  const hits = posts.filter((p) => p.url.endsWith('/ai-session'));
  case_ok('同 (sessionId, turn) 重复触发 → 只 POST 一次', hits.length === 1, `count=${hits.length}`);
}

// ── 6. 多轮不污染：只聚合本 turn（turn=2），历史轮 user/message 不混入 ──
{
  posts = [];
  const h = makeHarness();
  const evs2 = [
    { type: 'turn/start', data: { turn: 2 } },
    { type: 'user/message', data: { content: [{ type: 'text', text: '这是本轮用户诉求' }] } },
    { type: 'assistant/message', data: { turn: 2, step: 1, message: { content: [{ type: 'text', text: 'y'.repeat(600) }] } } },
    { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } },
  ];
  const subject = { id: 's-multiturn', events: evs2 };
  h.fire(subject, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } });
  await sleep();
  const hit = posts.find((p) => p.url.endsWith('/ai-session'));
  const body = hit && JSON.parse(hit.body).conversation;
  case_ok('多轮聚合只含本 turn：含本轮用户诉求', Boolean(body) && body.includes('这是本轮用户诉求'));
}

globalThis.fetch = originalFetch;

console.log(failures === 0 ? '\nRESULT: all auto-archive cases passed' : `\nRESULT: ${failures} failed`);
process.exitCode = failures > 0 ? 1 : 0;