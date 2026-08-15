// 抓取 ClipFlow 初赛帖 31753 全文（找 GitHub 链接）+ 检查 163530
const https = require('https');
const fs = require('fs');

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
    .replace(/<\/(p|div|li|h[1-6]|blockquote|tr|pre|td|th)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

(async () => {
  for (const id of [31753, 163530]) {
    const r = await get('https://forum.trae.cn/t/' + id + '.json');
    const j = JSON.parse(r.body);
    console.log('=========== TOPIC', id, '===========');
    console.log('TITLE:', j.title);
    console.log('CAT:', j.category_id, '| TAGS:', (j.tags || []).map(t => t.name || t).join(','), '| VIEWS:', j.views, '| LIKES:', j.like_count, '| POSTS:', j.posts_count);
    const texts = j.post_stream.posts.map(p => htmlToText(p.cooked));
    const all = texts.join('\n');
    console.log('FIRST POST CHARS:', texts[0].length, '| TOTAL CHARS:', all.length);
    const urls = all.match(/https?:\/\/[^\s")\]]+/g) || [];
    console.log('=== URLS ===');
    [...new Set(urls)].forEach(u => console.log(u.slice(0, 150)));
    const gh = all.match(/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+\b/g) || [];
    fs.writeFileSync('.tmp/clipflow_' + id + '_full.json', JSON.stringify(j.post_stream.posts.map(p => ({
      post_number: p.post_number, username: p.username, text: htmlToText(p.cooked)
    })), null, 1), 'utf8');
    await new Promise(r => setTimeout(r, 300));
  }
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
