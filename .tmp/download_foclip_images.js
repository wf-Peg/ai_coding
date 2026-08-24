// 从帖子 169896 提取全部图片 URL 并下载到临时目录
const https = require('https');
const fs = require('fs');
const path = require('path');

function get(url) {
  return new Promise((res, rej) => {
    const r = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 30000 }, resp => {
      let d = [];
      resp.on('data', c => d.push(c));
      resp.on('end', () => res({ status: resp.statusCode, body: Buffer.concat(d) }));
    });
    r.on('error', rej);
  });
}

(async () => {
  const r = await get('https://forum.trae.cn/t/169896.json');
  const j = JSON.parse(r.body);
  const urls = [];
  for (const p of j.post_stream.posts) {
    const hrefs = p.cooked.match(/src="([^"]+)"/g) || [];
    for (const h of hrefs) {
      const u = h.slice(5, -1);
      if (u.startsWith('http') && !urls.includes(u)) urls.push(u);
    }
  }
  console.log('TOTAL IMAGES:', urls.length);
  const DEST = path.join(process.env.TEMP, 'foclip_images');
  fs.mkdirSync(DEST, { recursive: true });
  let i = 0;
  for (const u of urls) {
    i++;
    const ext = path.extname(u.split('?')[0]) || '.img';
    const file = path.join(DEST, `img_${String(i).padStart(2, '0')}${ext}`);
    const d = await get(u);
    if (d.status === 200) {
      fs.writeFileSync(file, d.body);
      console.log('OK', file, d.body.length, u.slice(-60));
    } else {
      console.log('FAIL', u, d.status);
    }
    await new Promise(r => setTimeout(r, 200));
  }
  console.log('DEST:', DEST);
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
