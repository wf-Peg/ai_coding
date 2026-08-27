/**
 * 运行时实证：DSH（Cordis 内核）插件能否用 ctx.on("session/event") 订阅 turn/end 事件
 *
 * 不依赖 mock：直接加载本机 DSH 0.1.0-rc.7 安装包里的真实 @deepseek-ai/cordis
 * 与 @deepseek-ai/dsh-session 代码，走真实的事件总线通路。
 *
 * 验证点：
 *  1) 插件 ctx.on("session/event") 能收到会话广播（subject=session，event=事件）
 *  2) 能收到 turn/end，data = { turn, reason: { kind } }，正常完成 kind === "completed"
 *  3) subject.events 可读、可按 ev.data.turn 聚合本轮（自动归档聚合所需的全部 API）
 */
import { Context } from 'file:///C:/Users/pengwenfeng/AppData/Local/npm-cache/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai/cordis/lib/index.js';
import { Session, SessionStore } from 'file:///C:/Users/pengwenfeng/AppData/Local/npm-cache/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai/dsh-session/lib/index.js';

let failed = 0;
function check(label, ok, detail = '') {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
}

// ── 1. 启动最小 Cordis 运行时，加载真实 dsh-session 服务 ──
const root = new Context();
await root.plugin(SessionStore);

// ── 2. 模拟插件：在 root ctx 订阅 session/event（与 clip-capture 完全同款） ──
const received = [];
root.on('session/event', (subject, event) => {
  received.push({ subject, event });
});

const store = root.sessions; // 触发懒加载解析会话存储服务

// ── 3. 创建会话进入 store（DSH 会话真实生命周期） ──
const session = Session.create('verify-' + Date.now());
const detach = store.enter(session);
store.announce(session);

// ── 4. 模拟 dsh-agent-loop 正常完成的一轮 ──
// 形状照抄 dsh-agent-loop/lib/index.js 源码：
//   #L523  session.append("turn/start", { turn })
//   #L592  session.append("turn/end",  { turn, reason: turnEnds })
//   #L544  正常完成时 turnEnds = { kind: "completed" }
session.append('turn/start', { turn: 1 });
session.append('turn/end', { turn: 1, reason: { kind: 'completed' } });

// 附加验证：assistant/message 形状是否也能被订阅到（shape 严格则忽略）
try {
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: { role: 'assistant', content: [{ type: 'text', text: '运行时实证消息' }] },
  });
} catch (error) {
  console.log('SKIP  assistant/message 形状未通过本验证脚本的宽松构造（不影响结论）:', error?.message);
}

// ── 5. 断言 ──
const types = received.map((r) => r.event?.type);
check('订阅者收到了会话广播（received > 0）', received.length > 0, `收到 ${received.length} 条`);

const turnEnd = received.find((r) => r.event?.type === 'turn/end');
check('收到 turn/end 事件', !!turnEnd);
if (turnEnd) {
  check('turn/end.data.turn === 1', turnEnd.event.data?.turn === 1, JSON.stringify(turnEnd.event.data));
  check('turn/end.data.reason.kind === "completed"', turnEnd.event.data?.reason?.kind === 'completed',
    `kind=${turnEnd.event.data?.reason?.kind}`);
  check('回调第一参数 subject 即 session（subject.id 可读）',
    typeof turnEnd.subject?.id === 'string' && turnEnd.subject.id === session.id,
    `subject.id=${turnEnd.subject?.id}`);
  check('subject.events 可读且可按 turn 聚合（自动归档所需 API）',
    Array.isArray(turnEnd.subject?.events)
      && turnEnd.subject.events.filter((ev) => ev.data?.turn === 1).length >= 2,
    `本轮事件数=${turnEnd.subject?.events.filter((ev) => ev.data?.turn === 1).length}`);
}

check('turn/start 也广播（回合生命周期完整）', types.includes('turn/start'), `types=${types.join(',')}`);

// 清理
detach();
await root.dispose?.();

console.log('\n' + (failed === 0
  ? '结论：可行性验证通过 —— DSH(Cordis) 插件用 ctx.on("session/event") 订阅 turn/end 完全可行。'
  : `结论：有 ${failed} 项失败，需调整订阅位置或事件形状假设。`));
process.exit(failed === 0 ? 0 : 1);