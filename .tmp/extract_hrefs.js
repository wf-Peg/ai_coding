// 从 cooked HTML 中提取所有 href 链接
const https = require('https');

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

(async () => {
  for (const id of [31753, 163530, 169896]) {
    const r = await get('https://forum.trae.cn/t/' + id + '.json');
    const j = JSON.parse(r.body);
    console.log('===== TOPIC', id, '=====');
    const seen = new Set();
    for (const p of j.post_stream.posts) {
      const hrefs = p.cooked.match(/href="([^"]+)"/g) || [];
      for (const h of hrefs) {
        const url = h.slice(6, -1);
        if (url.startsWith('http') && !seen.has(url)) {
          seen.add(url);
          console.log('LINK:', url.slice(0, 200));
        }
      }
      // 也找裸文本里的 github 形式
      const raw = p.cooked.replace(/<[^>]+>/g, ' ');
      const ghm = raw.match(/(?:github\.com|gitee\.com)[^\s<"']{0,120}/gi) || [];
      ghm.forEach(m => { if (!seen.has(m)) { seen.add(m); console.log('REPO-TEXT:', m); } });
    }
    await new Promise(r => setTimeout(r, 300));
  }
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
