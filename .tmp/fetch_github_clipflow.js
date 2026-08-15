// 抓取 GitHub 仓库 derek2000139/ClipFlow 信息与 README
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
  const repo = await get('https://api.github.com/repos/derek2000139/ClipFlow');
  console.log('=== REPO META status:', repo.status, '===');
  if (repo.status === 200) {
    const j = JSON.parse(repo.body);
    console.log('full_name:', j.full_name);
    console.log('description:', j.description);
    console.log('stars:', j.stargazers_count, '| forks:', j.forks_count, '| watchers:', j.watchers_count);
    console.log('open_issues:', j.open_issues_count, '| language:', j.language, '| license:', (j.license || {}).spdx_id);
    console.log('created_at:', j.created_at, '| updated_at:', j.updated_at, '| pushed_at:', j.pushed_at);
    console.log('default_branch:', j.default_branch, '| size(KB):', j.size);
    console.log('homepage:', j.homepage);
    console.log('topics:', (j.topics || []).join(','));
    console.log('has_pages:', j.has_pages);
  } else {
    console.log('REPO ERR body:', repo.body.slice(0, 500));
  }
  await new Promise(r => setTimeout(r, 1500));
  const rd = await get('https://api.github.com/repos/derek2000139/ClipFlow/readme');
  console.log('=== README status:', rd.status, '===');
  if (rd.status === 200) {
    const j = JSON.parse(rd.body);
    const text = Buffer.from(j.content, 'base64').toString('utf8');
    console.log('README name:', j.name, '| size:', j.size);
    console.log('---- README CONTENT ----');
    console.log(text.slice(0, 6000));
  } else {
    console.log('README ERR body:', rd.body.slice(0, 500));
  }
  await new Promise(r => setTimeout(r, 1500));
  // 仓库分支/内容树
  const tree = await get('https://api.github.com/repos/derek2000139/ClipFlow/git/trees/HEAD?recursive=1');
  if (tree.status === 200) {
    const j = JSON.parse(tree.body);
    const paths = (j.tree || []).map(t => t.path);
    console.log('=== REPO FILE TREE (' + paths.length + ' files) ===');
    console.log(paths.slice(0, 80).join('\n'));
  } else {
    console.log('TREE ERR', tree.status);
  }
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
