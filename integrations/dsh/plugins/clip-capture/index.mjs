/**
 * clip-capture — DSH plugin（Phase 1：DSH 工作自动落库）
 *
 * 注册 `clip_session` 工具：把当前会话的成果摘要保存到剪藏知识库（CutShelter）。
 * Agent 在完成一段有保留价值的工作后调用本工具，成果自动成为一条剪藏（source=dsh）。
 *
 * 加载方式（cordis.yml / --patch）：
 *   - id: clip-capture
 *     name: '<本文件绝对路径>'
 *     config:
 *       baseUrl: http://127.0.0.1:8081
 *
 * 依赖：@deepseek-ai/dsh-tools（0.1.0-rc.7，需与本机 dsh 版本匹配），npm install 后生效。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'clip-capture';
export const inject = ['tools'];

export function apply(ctx, config) {
  const baseUrl = (config?.baseUrl
    || process.env.CUTSHELTER_BASE_URL
    || 'http://127.0.0.1:8081').replace(/\/+$/, '');

  ctx.tools.register(defineTool({
    name: 'clip_session',
    description:
      '把当前会话的成果摘要保存到剪藏知识库（CutShelter，本地个人知识库）。'
      + '在完成一段有保留价值的工作后调用，成果自动落库为一条剪藏（source=dsh）。'
      + 'title 为简短标题，summary 为 Markdown 格式的成果概括（应是对工作的提炼而非原文粘贴）。',
    parameters: {
      title: { type: 'string', required: true, description: '剪藏标题（如会话主题）' },
      summary: { type: 'string', required: true, description: '会话成果摘要（Markdown，概括而非原文）' },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: '标签列表（可选）',
      },
      category: { type: 'string', description: '分类（可选；可先查 mcp__cut_shelter__clip_categories 获取可选值）' },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          id: { type: 'number', required: true },
          status: { type: 'string', required: true },
        },
        additionalProperties: false,
      },
      render: (_args, value) => [
        { type: 'text', text: `已保存到剪藏知识库：id=${value.id}（${value.status}）` },
      ],
    },
    async execute(args, exec) {
      const ctrl = new AbortController();
      exec.signal.addEventListener('abort', () => ctrl.abort(), { once: true });
      const res = await fetch(`${baseUrl}/api/clip/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: args.summary,
          title: args.title,
          summary: args.summary,
          tags: args.tags || [],
          category: args.category,
          source: 'dsh',
          type: 'text',
          useAiTags: false,
        }),
        signal: ctrl.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`CutShelter /api/clip/add -> HTTP ${res.status}: ${text.slice(0, 300)}`);
      }
      const data = JSON.parse(text);
      return { id: data.id, status: data.status };
    },
  }));
}
