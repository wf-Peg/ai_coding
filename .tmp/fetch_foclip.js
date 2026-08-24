// 抓取 Foclip 帖子 169896 完整线程
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
  const r = await get('https://forum.trae.cn/t/169896.json');
  const j = JSON.parse(r.body);
  const out = {
    id: j.id, title: j.title, slug: j.slug, category_id: j.category_id,
    tags: j.tags, created_at: j.created_at, views: j.views,
    like_count: j.like_count, posts_count: j.posts_count, posts: []
  };
  for (const p of j.post_stream.posts) {
    out.posts.push({
      post_number: p.post_number, username: p.username, created_at: p.created_at,
      cooked_len: p.cooked.length, text: htmlToText(p.cooked)
    });
  }
  fs.writeFileSync('.tmp/foclip_full.json', JSON.stringify(out, null, 1), 'utf8');
  console.log('TITLE:', j.title);
  console.log('TAGS:', (j.tags || []).join(','));
  console.log('VIEWS:', j.views, 'LIKES:', j.like_count, 'POSTS:', j.posts_count);
  console.log('=== POSTS SUMMARY ===');
  for (const p of out.posts) {
    console.log('post#' + p.post_number, '| user:', p.username, '| chars:', p.text.length, '|', p.created_at);
  }
  const all = j.post_stream.posts.map(p => htmlToText(p.cooked)).join('\n');
  const gh = all.match(/github[^\s")\]]{0,140}/gi) || [];
  console.log('=== GITHUB MENTIONS ===');
  gh.slice(0, 30).forEach(m => console.log(m));
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
