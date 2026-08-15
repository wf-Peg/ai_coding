// 批量抓取 TRAE 论坛候选帖详情，输出汇总 JSON 到 .tmp/trae_topic_summary.json
const https = require('https');
const fs = require('fs');
const path = require('path');

const CATS = {
  4: '官方公告', 5: '新手入门', 6: '官方活动', 7: '帮助与支持', 8: '产品建议',
  9: '技巧分享', 10: '案例与作品', 11: '互动交流', 29: '福利活动', 30: '企业版专区',
  31: '本周精选', 33: '社区伙伴', 35: 'SOLO挑战赛专区', 36: 'AI充电站',
  37: 'SOLO技能创作赛', 38: 'TRAE AI 创造力大赛', 39: '大赛-学习工作赛道',
  40: '大赛-学习工作赛道(展示)', 41: '大赛-社会服务赛道', 42: '大赛-生活娱乐赛道',
  43: 'TraeWork 专区', 22: '帮助-功能问题', 23: '帮助-操作问题', 24: '帮助-计费问题',
  25: '案例-开源作品', 26: '案例-作品展示'
};

// 候选帖 id
const IDS = [
  // 剪藏/知识采集
  149867, 169896, 73279, 13715, 113150, 164903, 174639, 172109,
  // 笔记/知识库
  14192, 11275, 69906, 51147, 34102, 172002, 172296, 174398,
  // 财务/会计
  174431, 96129, 167378, 39134, 67935, 30381, 95936, 74615,
  // 效率/待办/日报周报
  173858, 147411, 116191, 49823, 149204, 47028, 33890,
  // 编程/工具
  176105, 39753, 19712, 116533
];

function get(url) {
  return new Promise((res, rej) => {
    const r = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 30000 }, resp => {
      let d = '';
      resp.on('data', c => d += c);
      resp.on('end', () => res({ status: resp.statusCode, body: d }));
    });
    r.on('error', rej);
  });
}

function htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|blockquote|tr|pre)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

(async () => {
  const out = [];
  for (const id of IDS) {
    try {
      const r = await get('https://forum.trae.cn/t/' + id + '.json');
      if (r.status !== 200) { console.log('SKIP', id, 'status', r.status); continue; }
      const j = JSON.parse(r.body);
      const p0 = (j.post_stream && j.post_stream.posts && j.post_stream.posts[0]) || {};
      const item = {
        id: j.id,
        title: j.title,
        slug: j.slug,
        category_id: j.category_id,
        category: CATS[j.category_id] || String(j.category_id),
        tags: (j.tags || []).join('、'),
        created_at: j.created_at,
        views: j.views,
        like_count: j.like_count,
        posts_count: j.posts_count,
        excerpt: (j.excerpt || '').slice(0, 300),
        first_post_text: htmlToText(p0.cooked).slice(0, 4000)
      };
      out.push(item);
      console.log('OK', id, '|', item.title.slice(0, 60), '| cat:', item.category, '| views:', item.views, '| likes:', item.like_count);
    } catch (e) {
      console.log('ERR', id, e.message);
    }
    await new Promise(r => setTimeout(r, 250));
  }
  fs.writeFileSync(path.join(__dirname, 'trae_topic_summary.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('DONE total:', out.length);
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });
