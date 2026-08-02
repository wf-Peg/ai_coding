(function initializeEditorAiChatCore(global) {
  'use strict';

  const MAX_SELECTED_CHARS = 2000;
  const MAX_API_MESSAGES = 20;

  function normalizeSelectedText(value) {
    const text = String(value || '').trim();
    return Array.from(text).slice(0, MAX_SELECTED_CHARS).join('');
  }

  function buildSearchPrompt(value) {
    const selectedText = normalizeSelectedText(value);
    return selectedText ? `一句话描述这个词：${selectedText}` : '';
  }

  function createState() {
    return { messages: [], status: 'idle', activeRequestId: null };
  }

  function reduce(state, action) {
    const current = state || createState();
    const messages = current.messages.slice();
    switch (action.type) {
      case 'start':
        if (current.activeRequestId) return current;
        messages.push({ id: action.userId, role: 'user', content: action.content });
        messages.push({ id: action.assistantId, role: 'assistant', content: '', streaming: true });
        return { messages, status: 'streaming', activeRequestId: action.requestId };
      case 'delta': {
        const assistant = messages.find(message => message.id === action.assistantId);
        if (!assistant) return current;
        const nextMessages = messages.map(message => message.id === action.assistantId
          ? { ...message, content: message.content + (action.content || '') }
          : message);
        return { ...current, messages: nextMessages, status: 'streaming' };
      }
      case 'done': {
        const assistant = messages.find(message => message.id === action.assistantId);
        const nextMessages = assistant ? messages.map(message => message.id === action.assistantId
          ? { ...message, streaming: false }
          : message) : messages;
        return { messages: nextMessages, status: 'idle', activeRequestId: null };
      }
      case 'error': {
        const assistant = messages.find(message => message.id === action.assistantId);
        const nextMessages = assistant ? messages.map(message => message.id === action.assistantId
          ? { ...message, streaming: false, error: action.message || 'AI 服务调用失败' }
          : message) : messages;
        return { messages: nextMessages, status: 'error', activeRequestId: null };
      }
      case 'cancel': {
        const assistant = messages.find(message => message.id === action.assistantId);
        const nextMessages = assistant ? messages.map(message => message.id === action.assistantId
          ? { ...message, streaming: false }
          : message) : messages;
        return { messages: nextMessages, status: 'idle', activeRequestId: null };
      }
      case 'clear':
        return createState();
      default:
        return current;
    }
  }

  function toApiMessages(state) {
    return (state.messages || [])
      .filter(message => (message.role === 'user' || message.role === 'assistant') && message.content)
      .slice(-MAX_API_MESSAGES)
      .map(message => ({ role: message.role, content: message.content }));
  }

  class SseParser {
    constructor(onEvent) {
      this.buffer = '';
      this.eventName = '';
      this.dataLines = [];
      this.onEvent = onEvent;
    }

    push(chunk) {
      this.buffer += chunk || '';
      let newline;
      while ((newline = this.buffer.indexOf('\n')) >= 0) {
        let line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        this.consumeLine(line);
      }
    }

    finish() {
      if (this.buffer) this.consumeLine(this.buffer);
      this.buffer = '';
      this.dispatch();
    }

    consumeLine(line) {
      if (line === '') {
        this.dispatch();
      } else if (line.startsWith(':')) {
        return;
      } else if (line.startsWith('event:')) {
        this.eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        this.dataLines.push(line.slice(5).trimStart());
      }
    }

    dispatch() {
      if (!this.dataLines.length) return;
      const raw = this.dataLines.join('\n');
      this.dataLines = [];
      const eventName = this.eventName || (raw === '[DONE]' ? 'done' : 'message');
      this.eventName = '';
      let data = raw;
      try { data = JSON.parse(raw); } catch (_) { /* [DONE] or plain text */ }
      this.onEvent({ event: eventName, data, raw });
    }
  }

  const api = {
    MAX_SELECTED_CHARS,
    MAX_API_MESSAGES,
    buildSearchPrompt,
    createState,
    normalizeSelectedText,
    reduce,
    SseParser,
    toApiMessages
  };

  global.EditorAiChatCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
