const fs = require('fs');
const files = ['frontend/clip.html', 'frontend/workspace.html', 'frontend/index.html', 'browser-extension/clip.html', 'browser-extension/popup.html'];
for (const f of files) {
  const html = fs.readFileSync(f, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  let ok = true;
  for (let i = 0; i < scripts.length; i++) {
    try { new Function(scripts[i]); } catch (e) { ok = false; console.log(f + ' script#' + i + ': ERROR ' + e.message); }
  }
  console.log(f + ': ' + (ok ? 'OK (' + scripts.length + ' inline scripts)' : 'FAILED'));
}
