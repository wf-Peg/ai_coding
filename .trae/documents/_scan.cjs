const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
function walk(dir, out) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (d.name === 'node_modules' || d.name === 'target' || d.name === 'dist-electron' || d.name === 'dist-dsh-offline' || d.name.indexOf('dist') === 0) continue;
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p, out);
    else if (/\.(js|html|mjs|md|json|java)$/.test(d.name)) out.push(p);
  }
}
const out = [];
walk('.', out);
const kw = '皮肤';
for (const f of out) {
  try {
    const s = fs.readFileSync(f, 'utf8');
    let i = s.indexOf(kw);
    let n = 0;
    while (i !== -1) { n++; i = s.indexOf(kw, i + kw.length); }
    if (n > 0) console.log(n + '\t' + f);
  } catch (e) {}
}