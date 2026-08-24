const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../frontend/js/editor-ai-chat-core.js');

test('builds the exact selected-text search prompt', () => {
  assert.equal(core.buildSearchPrompt('  Dijkstra  '), '一句话描述这个词：Dijkstra');
  assert.equal(core.buildSearchPrompt('   '), '');
});

test('truncates selected text by Unicode characters', () => {
  assert.equal(Array.from(core.normalizeSelectedText('😀'.repeat(2100))).length, 2000);
});

test('reduces a streamed assistant response', () => {
  let state = core.createState();
  state = core.reduce(state, {
    type: 'start', requestId: 'r1', userId: 'u1', assistantId: 'a1', content: 'hello'
  });
  state = core.reduce(state, { type: 'delta', assistantId: 'a1', content: 'world' });
  state = core.reduce(state, { type: 'done', assistantId: 'a1' });

  assert.equal(state.messages[1].content, 'world');
  assert.equal(state.messages[1].streaming, false);
  assert.equal(state.status, 'idle');
});

test('ignores a second request while streaming', () => {
  let state = core.reduce(core.createState(), {
    type: 'start', requestId: 'r1', userId: 'u1', assistantId: 'a1', content: 'one'
  });
  state = core.reduce(state, {
    type: 'start', requestId: 'r2', userId: 'u2', assistantId: 'a2', content: 'two'
  });
  assert.equal(state.messages.length, 2);
});

test('limits the API context to the most recent messages', () => {
  const state = {
    messages: Array.from({ length: 24 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user', content: String(index)
    }))
  };
  const messages = core.toApiMessages(state);
  assert.equal(messages.length, 20);
  assert.equal(messages[0].content, '4');
  assert.equal(messages[19].content, '23');
});

test('parses SSE events split across chunks', () => {
  const events = [];
  const parser = new core.SseParser(event => events.push(event));
  parser.push('event: delta\ndata: {"content":"你"}\n\nev');
  parser.push('ent: done\ndata: {"requestId":"r1"}\n\n');
  parser.finish();

  assert.equal(events.length, 2);
  assert.deepEqual(events[0].data, { content: '你' });
  assert.equal(events[1].event, 'done');
});
