'use strict';

(function (global) {
  const PROVIDER_ENDPOINTS = {
    deepseek: 'https://api.deepseek.com/v1/chat/completions',
    dashscope: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
  };

  const DEFAULT_MODELS = {
    deepseek: 'deepseek-chat',
    dashscope: 'qwen-plus'
  };

  function getApiKey(config, provider) {
    if (!config) return '';
    if (provider === 'deepseek') return config.deepseekApiKey || '';
    if (provider === 'dashscope') return config.dashscopeApiKey || '';
    return '';
  }

  function getModel(config, provider) {
    if (!config) return DEFAULT_MODELS[provider] || '';
    if (provider === 'deepseek') return config.deepseekModel || DEFAULT_MODELS.deepseek;
    if (provider === 'dashscope') return config.dashscopeModel || DEFAULT_MODELS.dashscope;
    return DEFAULT_MODELS[provider] || '';
  }

  function friendlyMessage(err) {
    const msg = (err && err.message) || '';
    if (msg.includes('Failed to fetch') || msg.includes('fetch failed') || msg.includes('NetworkError') || msg.toLowerCase().includes('network error')) {
      return '无法连接到 AI 服务，请检查网络或 API Key 是否正确';
    }
    return msg || 'AI 服务调用失败';
  }

  async function callProvider({ provider, apiKey, model, messages, signal }) {
    const endpoint = PROVIDER_ENDPOINTS[provider];
    if (!endpoint) throw new Error(`不支持的 Provider：${provider}`);
    if (!apiKey) throw new Error('API Key 未配置，请在 Lite AI 设置中填写');
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODELS[provider] || '',
        stream: true,
        messages: messages.map((m) => ({ role: m.role, content: m.content }))
      }),
      signal
    });
    if (!response.ok) {
      let text = '';
      try { text = await response.text(); } catch (_) {}
      throw new Error(`AI 服务返回 HTTP ${response.status}${text ? '：' + text.slice(0, 200) : ''}`);
    }
    if (!response.body) throw new Error('AI 服务未返回流式响应');
    return response.body.getReader();
  }

  async function streamChat({ config, messages, signal, onDelta, onDone, onError }) {
    const activeProvider = (config && config.activeProvider) || 'deepseek';
    const fallbackProvider = activeProvider === 'deepseek' ? 'dashscope' : 'deepseek';
    const ordered = [activeProvider, fallbackProvider].filter((p, idx, arr) => arr.indexOf(p) === idx);

    let emitted = false;
    let lastError = null;
    for (const provider of ordered) {
      const apiKey = getApiKey(config, provider);
      const model = getModel(config, provider);
      if (!apiKey) continue;
      const reader = await callProvider({ provider, apiKey, model, messages, signal }).catch((err) => {
        lastError = err;
        return null;
      });
      if (!reader) continue;
      const decoder = new TextDecoder();
      try {
        while (true) {
          if (signal && signal.aborted) {
            try { await reader.cancel(); } catch (_) {}
            return { ok: false, canceled: true };
          }
          const result = await reader.read();
          if (result.done) break;
          const chunk = decoder.decode(result.value, { stream: true });
          const lines = chunk.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const data = trimmed.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            try {
              const json = JSON.parse(data);
              const delta = json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content;
              if (delta) {
                emitted = true;
                if (onDelta) onDelta(delta);
              }
            } catch (_) {}
          }
        }
        if (onDone) onDone();
        return { ok: true, provider, fellBack: provider !== activeProvider };
      } catch (err) {
        lastError = err;
        if (emitted) {
          if (onError) onError(friendlyMessage(err));
          return { ok: false, error: friendlyMessage(err) };
        }
      }
    }
    if (!emitted) {
      if (onError) onError(friendlyMessage(lastError));
      return { ok: false, error: friendlyMessage(lastError) };
    }
    if (onDone) onDone();
    return { ok: true, fellBack: true };
  }

  global.LiteAI = { streamChat, friendlyMessage, DEFAULT_MODELS, PROVIDER_ENDPOINTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = { streamChat, friendlyMessage };
})(typeof window !== 'undefined' ? window : globalThis);
