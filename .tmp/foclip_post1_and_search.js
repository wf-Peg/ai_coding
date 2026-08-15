// 提取 Foclip 首帖完整文本 + 论坛搜索 ClipFlow + GitHub 搜索
const https = require('https');
const fs = require('fs');

function get(url) {
  return new Promise((res, rej) => {
    const r = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/vnd.github+json' }, timeout: 30000 }, resp => {
      let d = '';
      resp.on('data', c => d += c);
      resp.on('end', () => res({ status: resp.statusCode, body: d }));
    });
    r.on('error', rej);
  });
}

(async () => {
  const j = JSON.parse(fs.readFileSync('.tmp/foclip_full.json', 'utf8'));
  const post1 = j.posts[0].text;
  fs.writeFileSync('.tmp/foclip_post1.txt', post1, 'utf8');
  console.log('=== POST1 FULL TEXT SAVED, LEN:', post1.length, '===');

  // 论坛搜索 ClipFlow
  const s = await get('https://forum.trae.cn/search.json?q=' + encodeURIComponent('ClipFlow'));
  const sj = JSON.parse(s.body);
  console.log('=== FORUM SEARCH "ClipFlow" results:', (sj.topics || []).length, '===');
  for (const t of sj.topics || []) {
    console.log('id:', t.id, '|', t.title.slice(0, 90), '| cat:', t.category_id, '| views:', t.views);
  }

  // GitHub 搜索 Foclip
  for (const q of ['Foclip', 'ClipFlow', 'foclip', 'clipflow']) {
    try {
      const g = await get('https://api.github.com/search/repositories?q=' + encodeURIComponent(q) + '&per_page=10');
      const gj = JSON.parse(g.body);
      console.log('=== GITHUB SEARCH "' + q + '" total:', gj.total_count, '===');
      for (const item of (gj.items || []).slice(0, 10)) {
        console.log('repo:', item.full_name, '| stars:', item.stargazers_count, '| desc:', (item.description || '').slice(0, 100), '| lang:', item.language);
      }
    } catch (e) {
      console.log('GH ERR', q, e.message);
    }
    await new Promise(r => setTimeout(r, 2000));
  }
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
