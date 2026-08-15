const fs = require('fs');
const path = require('path');

// 使用 Electron 实际加载的配置
const config = require('C:/Users/pengwenfeng/AppData/Local/CutShelter/config/config.json');

function resolveVaultRoot(cfg) {
  const candidates = [];
  if (cfg.organizedPath) candidates.push(cfg.organizedPath);
  if (cfg.storagePath) {
    candidates.push(path.join(cfg.storagePath, 'clip-organized'));
    candidates.push(cfg.storagePath);
  }
  for (const c of candidates) {
    if (c && fs.existsSync(c) && fs.statSync(c).isDirectory()) return c;
  }
  return candidates[0] || path.join(cfg.storagePath || '.', 'clip-organized');
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const vaultRoot = resolveVaultRoot(config);
console.log('vaultRoot =', vaultRoot);
console.log('exists =', fs.existsSync(vaultRoot));

// 1) list-wikilink-targets 逻辑
const targets = [];
if (fs.existsSync(vaultRoot)) {
  const walk = (dir, relPrefix) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const abs = path.join(dir, entry.name);
      const rel = relPrefix ? path.join(relPrefix, entry.name) : entry.name;
      if (entry.isDirectory()) walk(abs, rel);
      else if (entry.isFile() && /\.md$/i.test(entry.name)) {
        targets.push({
          basename: path.basename(entry.name, path.extname(entry.name)),
          fileName: entry.name,
          relativePath: rel.split(path.sep).join('/'),
          absolutePath: abs
        });
      }
    }
  };
  walk(vaultRoot, '');
}
console.log('\n[targets] count =', targets.length);

// 找到真实存在反链的目标：优先找被 [[xxx]] 引用的 basename
function findRealLinkedTarget() {
  const files = [];
  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(abs); continue; }
      if (!entry.isFile() || !/\.md$/i.test(entry.name)) continue;
      const content = fs.readFileSync(abs, 'utf-8');
      const m = content.match(/\[\[([^\]|#]+)/);
      if (m) files.push({ file: abs, name: entry.name, link: m[1].trim() });
    }
  };
  walk(vaultRoot);
  return files;
}
const realLinks = findRealLinkedTarget();

// 2) find-backlinks 逻辑：对真实链接目标测试反链
let testBasename = null;
if (realLinks.length > 0) {
  testBasename = realLinks[0].link;
  console.log('\n[backlinks] FOUND real link:', testBasename, 'in', realLinks[0].name);
} else {
  testBasename = targets.length ? targets[0].basename : 'default_260418';
  console.log('\n[backlinks] no real links found, testing basename =', testBasename);
}

const backlinks = [];
if (fs.existsSync(vaultRoot)) {
  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(abs); continue; }
      if (!entry.isFile() || !/\.md$/i.test(entry.name)) continue;
      const content = fs.readFileSync(abs, 'utf-8');
      const pattern = new RegExp(`\\[\\[${escapeRegex(testBasename)}(?:\\||\\]\\])`, 'i');
      const lines = content.split('\n');
      const matches = [];
      lines.forEach((line, idx) => {
        if (pattern.test(line)) matches.push({ lineNumber: idx + 1, text: line.trim().substring(0, 120) });
      });
      if (matches.length > 0) {
        backlinks.push({
          fileName: entry.name,
          basename: path.basename(entry.name, '.md'),
          relativePath: path.relative(vaultRoot, abs).split(path.sep).join('/'),
          matches
        });
      }
    }
  };
  walk(vaultRoot);
}
console.log('[backlinks] files =', backlinks.length);
backlinks.slice(0, 5).forEach(b => {
  console.log('  -', b.basename, '|', b.relativePath, '| matches:', b.matches.length);
});

// 3) save-to-vault 逻辑
const notesDir = path.join(vaultRoot, 'notes');
console.log('\n[save-to-vault] notesDir =', notesDir, 'exists =', fs.existsSync(notesDir));