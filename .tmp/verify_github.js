// 验证 GitHub 可见性：作者账号仓库 + 精确搜索
const https = require('https');

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
  const u = await get('https://api.github.com/users/derek2000139/repos?per_page=100');
  console.log('=== USER derek2000139 REPOS status:', u.status, '===');
  if (u.status === 200) {
    const repos = JSON.parse(u.body);
    for (const r of repos) {
      console.log('repo:', r.full_name, '| stars:', r.stargazers_count, '| desc:', (r.description || '').slice(0, 80), '| pushed:', r.pushed_at);
    }
  } else {
    console.log('USER REPOS ERR:', u.body.slice(0, 300));
  }
  await new Promise(r => setTimeout(r, 2000));
  // 精确搜索 repo 限定
  const s1 = await get('https://api.github.com/search/repositories?q=' + encodeURIComponent('repo:derek2000139/ClipFlow'));
  console.log('=== SEARCH repo:derek2000139/ClipFlow total:', JSON.parse(s1.body).total_count, '===');
  await new Promise(r => setTimeout(r, 2000));
  // 关键词 ClipFlow 前 100 里是否存在该仓库（按 star 排序找）
  const s2 = await get('https://api.github.com/search/repositories?q=ClipFlow+in:name&sort=stars&order=desc&per_page=50');
  const j2 = JSON.parse(s2.body);
  console.log('=== SEARCH "ClipFlow in:name" total:', j2.total_count, '===');
  const hit = (j2.items || []).filter(i => i.full_name.toLowerCase().includes('derek'));
  console.log('derek repo in top50 by name:', hit.length ? hit[0].full_name : 'NOT FOUND');
  // 按更新时间排序搜（新仓库更新排序）
  const s3 = await get('https://api.github.com/search/repositories?q=ClipFlow&sort=updated&order=desc&per_page=50');
  const j3 = JSON.parse(s3.body);
  const hit3 = (j3.items || []).filter(i => i.full_name.toLowerCase().includes('derek'));
  console.log('=== SEARCH "ClipFlow" sort=updated derek hit:', hit3.length ? hit3[0].full_name + ' stars:' + hit3[0].stargazers_count : 'NOT FOUND in top50 updated');
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
