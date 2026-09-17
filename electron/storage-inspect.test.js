/**
 * storage-inspect.test.js - 只读目录规范体检单元测试
 *
 * 覆盖：空根 / P02 双知识目录 / P03 周报双写法 / P07 内容重复（保留最新）/
 * P04 排除目录内含 md / P06 命名风格，以及「体检全程零写盘」只读断言。
 * 运行：npm run test:storage
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { inspectStorage } = require('./storage-inspect');

let root;

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-inspect-'));
});

after(() => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) {}
});

/** 递归收集 { 绝对路径 -> { mtimeMs, size } } 快照，用于只读断言。 */
function snapshotTree(dir) {
  const snap = {};
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, ent.name);
      const st = fs.statSync(full);
      snap[full] = { mtimeMs: st.mtimeMs, size: st.size };
      if (ent.isDirectory()) walk(full);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return snap;
}

function hasCode(issues, code) {
  return issues.some((i) => i.code === code);
}

function codes(report) {
  return report.issues.map((i) => i.code);
}

test('空根目录：无问题、rootCount=0', () => {
  const r = inspectStorage(root);
  assert.deepEqual(codes(r), []);
  assert.equal(r.stats.rootCount, 0);
  assert.equal(r.stats.mdFileCount, 0);
});

test('knowledge 与 knowledge-base 并存 → P02', () => {
  const k = path.join(root, 'clip-storage', 'knowledge');
  const kb = path.join(root, 'clip-storage', 'knowledge-base');
  fs.mkdirSync(k, { recursive: true });
  fs.mkdirSync(kb, { recursive: true });
  fs.writeFileSync(path.join(k, 'a.json'), '{}', 'utf-8');
  fs.writeFileSync(path.join(kb, 'b.json'), '{}', 'utf-8');

  const r = inspectStorage(root);
  assert.ok(hasCode(r.issues, 'P02'), `应命中 P02，实际 ${codes(r)}`);
  const sug = r.suggestions.find((s) => s.code === 'P02');
  assert.equal(sug.action, 'merge');
  assert.ok(sug.to.endsWith('knowledge-base'));
});

test('weeklyReport 与 weekly-report 并存 → P03', () => {
  const a = path.join(root, 'weeklyReport');
  const b = path.join(root, 'weekly-report');
  fs.mkdirSync(a, { recursive: true });
  fs.mkdirSync(b, { recursive: true });
  fs.writeFileSync(path.join(a, 'w.md'), 'x', 'utf-8');
  fs.writeFileSync(path.join(b, 'w.md'), 'x', 'utf-8');

  const r = inspectStorage(root);
  assert.ok(hasCode(r.issues, 'P03'), `应命中 P03，实际 ${codes(r)}`);
  const sug = r.suggestions.find((s) => s.code === 'P03');
  assert.equal(sug.action, 'merge');
  assert.ok(sug.to.endsWith('weekly-report'));
});

test('内容重复 md → P07，保留 mtime 最新，建议移入 .trash', () => {
  const dir = path.join(root, 'dup-kb');
  fs.mkdirSync(dir, { recursive: true });
  const oldFile = path.join(dir, 'a.md');
  const newFile = path.join(dir, 'b.md');
  fs.writeFileSync(oldFile, '完全相同的正文内容', 'utf-8');
  fs.writeFileSync(newFile, '完全相同的正文内容', 'utf-8');
  const oldT = Date.now() - 3600 * 1000;
  const newT = Date.now();
  fs.utimesSync(oldFile, new Date(oldT), new Date(oldT));
  fs.utimesSync(newFile, new Date(newT), new Date(newT));

  const r = inspectStorage(root);
  assert.ok(hasCode(r.issues, 'P07'), `应命中 P07，实际 ${codes(r)}`);
  assert.ok(r.stats.duplicateGroupCount >= 1);
  assert.ok(r.stats.duplicateFileCount >= 1);
  const issue = r.issues.find((i) => i.code === 'P07');
  assert.equal(issue.suggestion.action, 'trash');
  // suggestion.from 指向较旧文件（a.md）
  assert.ok(issue.suggestion.from.includes('a.md'), `应指向较旧文件，实际 ${issue.suggestion.from}`);
  assert.ok(issue.suggestion.to.endsWith('.trash'));
});

test('排除目录（docs）内含 md → P04', () => {
  const dir = path.join(root, 'docs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'readme.md'), '# docs 里的 md', 'utf-8');

  const r = inspectStorage(root);
  assert.ok(hasCode(r.issues, 'P04'), `应命中 P04，实际 ${codes(r)}`);
  const sug = r.suggestions.find((s) => s.code === 'P04');
  assert.equal(sug.action, 'rename');
});

test('系统固定目录（clip-storage）内含 md → P04B（提示移出，不误报改名）', () => {
  const dir = path.join(root, 'clip-storage', 'kb');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'x.md'), '# 误拷进 clip-storage 的知识库', 'utf-8');

  const r = inspectStorage(root);
  assert.ok(hasCode(r.issues, 'P04B'), `应命中 P04B，实际 ${codes(r)}`);
  // 不得针对 clip-storage 误报 P04（系统目录不可改名）
  const clipP04 = r.issues.find((i) => i.code === 'P04' && i.paths && i.paths[0].includes(path.sep + 'clip-storage'));
  assert.ok(!clipP04, '不应针对 clip-storage 误报 P04（系统目录不可改名）');
  const sug = r.suggestions.find((s) => s.code === 'P04B');
  assert.equal(sug.action, 'move');
});

test('命名风格（空格/全角）→ P06', () => {
  const dir = path.join(root, 'My Notes 中文');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'x.md'), 'ok', 'utf-8');

  const r = inspectStorage(root);
  assert.ok(hasCode(r.issues, 'P06'), `应命中 P06，实际 ${codes(r)}`);
  const issue = r.issues.find((i) => i.code === 'P06');
  assert.ok(issue.suggestion.action === 'rename');
  assert.ok(!/\s/.test(path.basename(issue.suggestion.to)), '建议名应不含空格');
});

test('严格只读：体检前后整棵树快照一致（无任何写盘/移动/改名）', () => {
  // 构造混合场景
  const kb = path.join(root, 'kb');
  fs.mkdirSync(kb, { recursive: true });
  fs.writeFileSync(path.join(kb, 'note.md'), '# note\ncontent', 'utf-8');
  const nested = path.join(root, 'kb', 'a', 'b', 'c');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, 'deep.md'), 'deep', 'utf-8');
  const badName = path.join(root, 'UPPER 全角');
  fs.mkdirSync(badName, { recursive: true });
  fs.writeFileSync(path.join(badName, 'y.md'), 'y', 'utf-8');

  const beforeSnap = snapshotTree(root);
  const r = inspectStorage(root);
  const afterSnap = snapshotTree(root);

  assert.deepEqual(afterSnap, beforeSnap, '体检不得修改任何文件/目录（路径、mtime、size 全量一致）');
  assert.ok(r.issues.length > 0, '混合场景应至少产出 1 条问题');
});
