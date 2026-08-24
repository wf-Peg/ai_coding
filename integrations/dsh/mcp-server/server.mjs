/**
 * CutShelter MCP Bridge — stdio MCP server that proxies the CutShelter REST API.
 *
 * Runs as a child process spawned by DSH's @deepseek-ai/dsh-mcp-client (transport: stdio),
 * or standalone via `node server.mjs`. Tools appear in the agent as
 * `mcp__cut_shelter__<toolName>`.
 *
 * Env:
 *   CUTSHELTER_BASE_URL  Backend base URL (default http://127.0.0.1:8081)
 *   CUTSHELTER_TIMEOUT_MS Per-request timeout (default 60000)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE_URL = (process.env.CUTSHELTER_BASE_URL || 'http://127.0.0.1:8081').replace(/\/+$/, '');
const TIMEOUT_MS = Number(process.env.CUTSHELTER_TIMEOUT_MS || 60000);

const server = new McpServer({
  name: 'cut-shelter-bridge',
  version: '0.1.0',
});

/** Minimal JSON shape of a clip, to keep tool output compact. */
function clipToView(c) {
  return {
    id: c.id,
    title: c.title,
    summary: c.summary,
    category: c.category,
    tags: c.tags,
    type: c.type,
    source: c.source,
    sourceUrl: c.sourceUrl,
    workflowStatus: c.workflowStatus,
    analysisStatus: c.analysisStatus,
    createdAt: c.createdAt,
    contentPreview: c.content ? String(c.content).slice(0, 200) : '',
  };
}

/** Call the CutShelter backend; returns parsed JSON body. */
async function callApi(path, { method = 'GET', params, body, timeoutMs = TIMEOUT_MS } = {}) {
  const url = new URL(BASE_URL + path);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }
    if (!res.ok) {
      throw new Error(`CutShelter API ${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function textResult(plain, json) {
  const pretty = json === undefined ? '' : '\n' + JSON.stringify(json, null, 2).slice(0, 20000);
  return { content: [{ type: 'text', text: plain + pretty }] };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

server.registerTool('clip_search', {
  description:
    '语义搜索剪藏知识库（标题/摘要/正文/标签）。用于在个人知识库中查找与关键词相关的剪藏内容。'
    + '返回按相关度排序的剪藏列表（每条含 id/title/summary/category/tags/内容预览）。',
  inputSchema: {
    query: z.string().describe('搜索关键词'),
    topK: z.number().int().min(1).max(20).optional().describe('返回条数，默认 5'),
  },
}, async ({ query, topK }) => {
  const list = await callApi('/api/clip/search', { params: { query, topK: topK ?? 5 } });
  const views = (list || []).map(clipToView);
  return textResult(`找到 ${views.length} 条剪藏结果。`, views);
});

server.registerTool('clip_list', {
  description: '列出剪藏内容，可按关键词/工作流状态筛选。返回剪藏列表（含 id/title/category/tags）。',
  inputSchema: {
    keyword: z.string().optional().describe('按关键词模糊匹配标题/摘要/正文/来源/标签'),
    workflowStatus: z.string().optional().describe('工作流状态过滤，如 inbox/archived/organized'),
    limit: z.number().int().min(1).max(100).optional().describe('返回条数上限，默认 20'),
  },
}, async ({ keyword, workflowStatus, limit }) => {
  const list = await callApi('/api/clip/list', { params: { keyword, workflowStatus } });
  const views = (list || []).slice(0, limit ?? 20).map(clipToView);
  return textResult(`共 ${(list || []).length} 条剪藏，返回 ${views.length} 条。`, views);
});

server.registerTool('clip_add', {
  description:
    '新增一条剪藏到知识库。content 为必填正文；建议同时提供 title 与 summary。'
    + '默认 useAiTags=false（不触发 AI 生成标签，省 token）。保存后异步触发 AI 分析。',
  inputSchema: {
    content: z.string().describe('剪藏正文内容（必填）'),
    title: z.string().optional().describe('标题'),
    summary: z.string().optional().describe('一句话摘要（应为概括而非原文）'),
    category: z.string().optional().describe('分类，可先查 clip_categories 获取可选值'),
    tags: z.array(z.string()).optional().describe('标签列表'),
    source: z.string().optional().describe('来源，如 system/manual/browser'),
    sourceUrl: z.string().optional().describe('来源 URL'),
    type: z.string().optional().describe('剪藏类型，如 text/store-only'),
    useAiTags: z.boolean().optional().describe('是否让后端 AI 生成标签（默认 false，省 token）'),
    target: z.string().optional().describe('剪藏目标，如 inbox'),
    workspaceId: z.string().optional().describe('关联工作台 ID（可选）'),
  },
}, async (args) => {
  const body = {
    content: args.content,
    title: args.title,
    summary: args.summary,
    category: args.category,
    tags: args.tags,
    source: args.source || 'system',
    sourceUrl: args.sourceUrl,
    type: args.type,
    useAiTags: args.useAiTags ?? false,
    target: args.target,
    workspaceId: args.workspaceId,
  };
  const resp = await callApi('/api/clip/add', { method: 'POST', body });
  return textResult(`剪藏已提交，id=${resp.id}（${resp.status === 'duplicate' ? '检测到重复，返回已有记录' : 'success'}）。`, resp);
});

server.registerTool('clip_delete', {
  description: '按 id 删除一条剪藏（不可恢复）。',
  inputSchema: {
    id: z.number().describe('剪藏 ID'),
  },
}, async ({ id }) => {
  await callApi(`/api/clip/${id}`, { method: 'DELETE' });
  return textResult(`已删除剪藏 ${id}。`);
});

server.registerTool('clip_categories', {
  description: '获取剪藏分类树（label/value/children），用于 clip_add 选择 category。',
  inputSchema: {},
}, async () => {
  const categories = await callApi('/api/clip/categories');
  return textResult('剪藏分类：', categories);
});

server.registerTool('todo_list', {
  description: '列出所有待办事项（含完成状态、截止日期）。',
  inputSchema: {},
}, async () => {
  const list = await callApi('/api/todo/list');
  return textResult(`共 ${(list || []).length} 条待办。`, list);
});

server.registerTool('todo_add', {
  description: '新增一条待办事项。title 必填；completed 默认 false。',
  inputSchema: {
    title: z.string().describe('待办标题（必填）'),
    priority: z.string().optional().describe('优先级'),
    deadline: z.string().optional().describe('截止日期，如 2026-08-31'),
    deadlineTime: z.string().optional().describe('截止时间 HH:mm，可选'),
    category: z.string().optional().describe('分类'),
    completed: z.boolean().optional().describe('是否已完成，默认 false'),
    reminderEnabled: z.boolean().optional().describe('是否启用提醒'),
    reminderMinutes: z.number().int().optional().describe('提前提醒分钟数'),
    sourceUrl: z.string().optional().describe('来源 URL'),
  },
}, async (args) => {
  const body = {
    title: args.title,
    priority: args.priority,
    deadline: args.deadline,
    deadlineTime: args.deadlineTime,
    category: args.category,
    completed: args.completed ?? false,
    reminderEnabled: args.reminderEnabled,
    reminderMinutes: args.reminderMinutes,
    sourceUrl: args.sourceUrl,
  };
  const resp = await callApi('/api/todo/add', { method: 'POST', body });
  return textResult(`待办已创建，id=${resp.id}。`, resp);
});

server.registerTool('todo_set_status', {
  description: '更新待办完成状态（完成/未完成）。',
  inputSchema: {
    id: z.number().describe('待办 ID'),
    completed: z.boolean().describe('true=已完成，false=未完成'),
  },
}, async ({ id, completed }) => {
  const resp = await callApi(`/api/todo/${id}/status`, { method: 'PUT', params: { completed } });
  return textResult(`待办 ${id} 状态已更新为 ${completed ? '已完成' : '未完成'}。`, resp);
});

server.registerTool('learning_plan_list', {
  description: '列出学习计划（AI 生成的路线图，含阶段、资源、掌握度）。',
  inputSchema: {},
}, async () => {
  const list = await callApi('/api/learning-plan');
  return textResult(`共 ${(list || []).length} 个学习计划。`, list);
});

server.registerTool('wiki_index', {
  description: '获取知识库 Wiki 索引（Markdown，含页面统计与实体/概念列表）。',
  inputSchema: {},
}, async () => {
  const data = await callApi('/api/wiki/index');
  const content = typeof data === 'object' && data !== null ? (data.content ?? JSON.stringify(data)) : String(data);
  return textResult('Wiki 索引：', content);
});

server.registerTool('weekly_report_status', {
  description: '查询周报生成状态与存储路径（不触发生成）。',
  inputSchema: {},
}, async () => {
  const data = await callApi('/api/weekly-report/status');
  return textResult('周报状态：', data);
});

// ---- Phase 3：Tools Hub 互通（剪藏的 HTML 小工具注册表）----

server.registerTool('tools_hub_list', {
  description:
    '列出剪藏工具中心（Tools Hub）的小工具注册表（id/名称/分类/描述/启用状态）。'
    + 'Tools Hub 是自包含 HTML 小工具，与 Agent 工具是两种概念；本工具用于了解剪藏已有哪些工具。',
  inputSchema: {},
}, async () => {
  const data = await callApi('/api/tools');
  const tools = (data && Array.isArray(data.tools) ? data.tools : []);
  const views = tools.map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category,
    description: t.description,
    enabled: t.enabled,
  }));
  return textResult(`Tools Hub 共 ${views.length} 个工具：`, views);
});

server.registerTool('tools_hub_page', {
  description: '读取 Tools Hub 小工具的 HTML 页面源码（自包含单 HTML 前 3000 字符），用于了解或复用其实现。',
  inputSchema: {
    id: z.string().describe('工具 id（先用 tools_hub_list 获取，如 pdf-toolbox）'),
  },
}, async ({ id }) => {
  const html = await callApi(`/api/tools/${encodeURIComponent(id)}/page`, {});
  const text = typeof html === 'string' ? html : String(html);
  return textResult(`工具 ${id} 页面（HTML，前 3000 字符）：`, text.slice(0, 3000));
});

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
