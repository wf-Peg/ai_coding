// 下载原图版本并输出尺寸，定位架构图
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
      if (u.startsWith('http') && u.includes('trae-forum-cdn') && !urls.includes(u)) urls.push(u);
    }
  }
  const DEST = path.join(process.env.TEMP, 'foclip_originals');
  fs.mkdirSync(DEST, { recursive: true });
  let i = 0;
  for (const u of urls) {
    i++;
    // 从 optimized 反推 original（去掉 _2_WxH 后缀）
    const m = u.match(/optimized\/3X\/(\w)\/(\w+)\/([a-f0-9]+)_2_\d+x\d+\.(\w+)/);
    let orig;
    if (m) {
      orig = `https://trae-forum-cdn.trae.com.cn/prod/original/3X/${m[1]}/${m[2]}/${m[3]}.${m[4]}`;
    } else {
      orig = u; // 已是 original
    }
    const ext = path.extname(orig.split('?')[0]) || '.img';
    const file = path.join(DEST, `orig_${String(i).padStart(2, '0')}${ext}`);
    const d = await get(orig);
    if (d.status === 200) {
      fs.writeFileSync(file, d.body);
      console.log('OK', file, d.body.length, '<=', orig.slice(-70));
    } else {
      console.log('FAIL', orig, d.status);
    }
    await new Promise(r => setTimeout(r, 200));
  }
  console.log('DEST:', DEST);
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
