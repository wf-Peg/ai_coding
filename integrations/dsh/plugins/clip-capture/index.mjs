/**
 * clip-capture — DSH plugin（会话成果自动归档产品概览）
 *
 * 1) 显式路径：注册 `clip_session` 工具，Agent 干完活主动调用，把本轮成果
 *    的四字段（干了什么 / 解决什么问题 / 如何解决 / 大白话产出）归档进
 *    工作台产品概览的迭代记录（source=dsh-agent）。
 * 2) 自动路径：监听会话事件 `session/event` 的 `turn/end`（reason=completed），
 *    本轮存在"产出信号"（调用过工具，或 AI 输出足够长）且未显式归档过时，
 *    自动聚合本轮会话文本 POST 给后端 `/api/workspace/feature-points/iterations/ai-session`，
 *    由后端 AI 提炼四字段落库（source=dsh-session）。
 *
 * 加载方式（cordis.yml / --patch）：
 *   - id: clip-capture
 *     name: '<本文件绝对路径>'
 *     config:
 *       baseUrl: http://127.0.0.1:8081
 *       autoArchive: true   # 可选，默认开启自动归档，false 关闭
 *
 * 依赖：@deepseek-ai/dsh-tools（0.1.0-rc.7，需与本机 dsh 版本匹配），npm install 后生效。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'clip-capture';
export const inject = ['tools'];

/** 聚合文本上限，防止超长会话撑爆请求体 */
const MAX_CONVERSATION_CHARS = 12000;
/** 纯文本产出的最小长度阈值（无工具调用时以此判断"有没有干活"） */
const MIN_PLAIN_OUTPUT_CHARS = 500;

/**
 * 纯操作/运维类工具：这类调用本身不构成"干活"（如 pwsh 跑 git 提交推送、
 * 任务/进程管理），单独出现时不触发自动归档，避免"提交推送"这种例行动作也被落成卡片。
 */
const OPERATIONAL_TOOLS = new Set(['pwsh', 'job_kill', 'job_list', 'job_output']);

function extractText(message) {
  if (!message || !Array.isArray(message.content)) return '';
  return message.content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

function turnToolNames(session, turn) {
  const names = [];
  for (const ev of session.events || []) {
    if (ev.type !== 'tool/call' || ev.data?.turn !== turn) continue;
    // DSH 0.1.0-rc.7 实测：tool/call 的 data = { turn, step, callId, name, arguments }
    const name = ev.data?.name;
    if (typeof name === 'string') names.push(name);
  }
  return names;
}

/** 聚合一轮（turn）会话为纯文本（用户消息 / AI 回复 / 工具调用名） */
function aggregateTurn(session, turn) {
  const evs = session.events || [];
  // 定位本 turn 的事件区间 [turn/start, turn/end)。user/message 事件 data 是纯
  // message 对象、不带 turn 字段（agent-loop 用 session.append("user/message", message)），
  // 因此不能靠 ev.data.turn 过滤，只能落在区间内收集，避免历史轮消息污染本轮。
  let startIdx = -1;
  let endIdx = -1;
  for (let i = 0; i < evs.length; i++) {
    if (evs[i].type === 'turn/start' && evs[i].data?.turn === turn) startIdx = i;
    if (evs[i].type === 'turn/end' && evs[i].data?.turn === turn) { endIdx = i; break; }
  }
  const from = startIdx >= 0 ? startIdx : 0;
  const to = endIdx >= 0 ? endIdx : evs.length;

  const lines = [];
  for (let i = from; i < to; i++) {
    const ev = evs[i];
    if (ev.type === 'user/message') {
      // user/message 的 data 直接是 message
      const text = extractText(ev.data);
      if (text) lines.push('用户：' + text);
    } else if (ev.type === 'assistant/message') {
      if (ev.data?.turn !== turn) continue;
      const text = extractText(ev.data?.message);
      if (text) lines.push('AI：' + text);
    } else if (ev.type === 'tool/call') {
      if (ev.data?.turn !== turn) continue;
      const name = ev.data?.name;
      if (typeof name === 'string') lines.push('[调用工具 ' + name + ']');
    }
  }
  let text = lines.join('\n');
  if (text.length > MAX_CONVERSATION_CHARS) {
    text = text.slice(0, MAX_CONVERSATION_CHARS) + '\n…(截断)';
  }
  return text;
}

export function apply(ctx, config) {
  const baseUrl = (config?.baseUrl
    || process.env.CUTSHELTER_BASE_URL
    || 'http://127.0.0.1:8081').replace(/\/+$/, '');

  // ── 显式路径：clip_session 归档工具（Agent 主动调用，自填四字段） ──
  ctx.tools.register(defineTool({
    name: 'clip_session',
    description:
      '把本轮会话的工作成果归档到工作台产品概览的迭代记录（CutShelter，本地）。'
      + '在完成一段有保留价值的工作后调用，成果会出现在产品概览的迭代记录里。'
      + '四个字段：title=这轮干了什么；problem=解决什么问题；solution=如何解决；'
      + 'outcome=最终结果的大白话描述（给非技术用户看的）。',
    parameters: {
      project: { type: 'string', description: '所属需求/项目目录名（可选，如"DSH（DeepSeek Harness）集成"）' },
      title: { type: 'string', required: true, description: '这轮干了什么（简短中文短语，<= 30 字）' },
      problem: { type: 'string', description: '解决什么问题（大白话，1-3 句）' },
      solution: { type: 'string', description: '如何解决（关键方法/技术决策，简洁）' },
      outcome: { type: 'string', required: true, description: '最终结果的大白话产出描述（1-2 句）' },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: '标签列表（可选）',
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          id: { type: 'string', required: true },
          source: { type: 'string', required: true },
        },
        additionalProperties: false,
      },
      render: (_args, value) => [
        { type: 'text', text: `已归档到产品概览迭代记录：id=${value.id}（${value.source}）` },
      ],
    },
    async execute(args, exec) {
      const ctrl = new AbortController();
      exec.signal.addEventListener('abort', () => ctrl.abort(), { once: true });
      const note = [args.title, args.problem, args.solution, args.outcome]
        .filter((s) => typeof s === 'string' && s.trim())
        .join(' | ');
      const res = await fetch(`${baseUrl}/api/workspace/feature-points/iterations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: args.project || '',
          fpId: '',
          fpName: '',
          version: 'ai',
          note: note,
          title: args.title,
          problem: args.problem || '',
          solution: args.solution || '',
          outcome: args.outcome,
          source: 'dsh-agent',
          status: 'done',
          tags: [...(args.tags || []), 'AI会话'],
        }),
        signal: ctrl.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`CutShelter 归档迭代记录 -> HTTP ${res.status}: ${text.slice(0, 300)}`);
      }
      const data = JSON.parse(text);
      return { id: data.id, source: data.source || 'dsh-agent' };
    },
  }));

  // ── 自动路径：回合结束时自动归档（后端 AI 提炼四字段） ──
  if (config?.autoArchive === false) return;

  const archivedTurns = new Map(); // sessionId -> 最近归档的 turn 号
  const seenTurns = new Set();     // 去重：每个 (sessionId, turn) 只处理一次

  ctx.on('session/event', (subject, event) => {
    if (!event || event.type !== 'turn/end') return;
    const reason = event.data?.reason;
    // DSH 0.1.0-rc.7 实测：reason.kind ∈ completed / blocked / aborted / error / max-tokens / interrupted
    // 仅 normal 收尾归档（completed）；blocked/aborted/error/max-tokens/interrupted 不归档
    if (!reason || reason.kind !== 'completed') return;
    const turn = event.data?.turn;
    if (typeof turn !== 'number' || !subject?.id) return;

    const key = subject.id + ':' + turn;
    if (seenTurns.has(key)) return;
    seenTurns.add(key);

    // 产出信号守卫：
    // 1) 本轮调用过工具（真实干活）→ 归档；但若本轮已显式调用 clip_session 归档工具 → 跳过（已归档）
    // 2) 无工具调用，但 AI 输出足够长（可能有实质分析产出）→ 也归档
    const toolNames = turnToolNames(subject, turn);
    // 容错匹配：插件工具可能带命名空间前缀（如 tools_hub__clip_session）
    if (toolNames.some((n) => n === 'clip_session' || n.endsWith('/clip_session') || n.endsWith('__clip_session'))) {
      archivedTurns.set(subject.id, turn);
      return;
    }
    const hasToolWork = toolNames.filter((n) => !OPERATIONAL_TOOLS.has(n)).length > 0;
    const plainLen = aggregateTurnPlainLen(subject, turn);
    if (!hasToolWork && plainLen < MIN_PLAIN_OUTPUT_CHARS) return; // 闲聊/纯运维轮，跳过

    const lastArchived = archivedTurns.get(subject.id) || 0;
    if (turn <= lastArchived) return;
    archivedTurns.set(subject.id, turn);

    const conversation = aggregateTurn(subject, turn);
    if (!conversation.trim()) return;

    (async () => {
      try {
        const res = await fetch(`${baseUrl}/api/workspace/feature-points/iterations/ai-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversation, project: '' }),
        });
        if (!res.ok) {
          // 归档失败绝不干扰 DSH，仅打印警告
          console.warn(`[clip-capture] 自动归档失败 -> HTTP ${res.status}`);
        } else {
          // 运行期观测：成功归档打点（便于统计归档率/排查静默失效）
          console.log(`[clip-capture] 自动归档成功 turn=${turn} conversation=${conversation.length}字 source=dsh-session`);
        }
      } catch (e) {
        console.warn('[clip-capture] 自动归档异常:', e?.message || e);
      }
    })();
  });
}

/** 仅统计 AI 纯文本输出长度（用于无工具调用时的产出判断） */
function aggregateTurnPlainLen(session, turn) {
  let len = 0;
  for (const ev of session.events || []) {
    if (ev.data?.turn !== turn) continue;
    if (ev.type === 'assistant/message') len += extractText(ev.data?.message).length;
  }
  return len;
}