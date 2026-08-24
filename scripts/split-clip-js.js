// clip.html 内联 JS 拆分脚本（行为零变化）+ 完整性验证
// 策略：按行号区间切分 + 共享状态前置到 clip-shared.js 并转 var
// 验证：拆分后所有非状态行按顺序拼接，必须与原文件非状态行逐字节一致
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2];
const OUT_DIR = process.argv[3] || 'frontend/js';
const js = fs.readFileSync(SRC, 'utf8');
const lines = js.split('\n'); // 0-based

// ── 共享状态行（1-based inclusive）──
const STATE_RANGES = [
  [2, 3], [7, 9], [25, 25], [30, 44], [85, 86], [89, 91],
  [579, 585], [627, 628], [695, 704], [955, 955], [1031, 1031],
  [1066, 1069], [1836, 1836], [1864, 1925], [2595, 2595]
];

const SECTIONS = [
  { name: 'clip-shared', start: 1, end: 586 },
  { name: 'clip-form',   start: 587, end: 943 },
  { name: 'clip-list',   start: 944, end: 1668 },
  { name: 'clip-actions',start: 1669, end: 2333 },
  { name: 'clip-sync',   start: 2334, end: lines.length }
];

function isStateLine(n) {
  return STATE_RANGES.some(([s, e]) => n >= s && n <= e);
}

// 提取状态文本（转 var）
const stateText = [];
for (let n = 1; n <= lines.length; n++) {
  if (isStateLine(n)) stateText.push(toVar(lines[n - 1]));
}

function toVar(line) {
  return line.replace(/^(\s*)(const|let)\s+/, '$1var ');
}

// 按区间切分（跳过状态行）
const files = {};
for (const sec of SECTIONS) {
  const body = [];
  for (let n = sec.start; n <= sec.end; n++) {
    if (isStateLine(n)) continue;
    body.push(lines[n - 1]);
  }
  files[sec.name] = body;
}

// ── 完整性验证：非状态行顺序拼接 = 原文件非状态行 ──
const origNonState = [];
for (let n = 1; n <= lines.length; n++) {
  if (!isStateLine(n)) origNonState.push(lines[n - 1]);
}
const concatNonState = [];
for (const sec of SECTIONS) concatNonState.push(...files[sec.name]);

let mismatch = 0;
const maxCmp = Math.max(origNonState.length, concatNonState.length);
for (let i = 0; i < maxCmp; i++) {
  if (origNonState[i] !== concatNonState[i]) {
    if (mismatch < 10) {
      console.log('MISMATCH @' + i + ':\n  原: ' + JSON.stringify(origNonState[i]) + '\n  拆: ' + JSON.stringify(concatNonState[i]));
    }
    mismatch++;
  }
}
console.log('非状态行: 原=' + origNonState.length + ' 拆=' + concatNonState.length + ' 不一致=' + mismatch);
if (mismatch > 0) { console.error('✗ 拆分不一致，中止写入'); process.exit(1); }
console.log('✓ 非状态行顺序与内容完全一致');

// ── 写出文件 ──
const header = (name) => `// ============================================================
// CutShelter clip 页面模块: ${name}
// 由 clip.html 内联脚本按功能拆分生成（经典 script 顺序加载）
// ============================================================
`;

const sharedBody = files['clip-shared'];
const sharedWithState = [
  header('clip-shared（共享状态/主题/图片/初始化）'),
  '',
  '// ── 共享状态（原顶层 const/let 转 var，跨文件全局可见）──',
  ...stateText,
  '',
  ...sharedBody
];

fs.writeFileSync(path.join(OUT_DIR, 'clip-shared.js'), sharedWithState.join('\n'), 'utf8');
for (const sec of SECTIONS.slice(1)) {
  fs.writeFileSync(path.join(OUT_DIR, sec.name + '.js'), [header(sec.name), ...files[sec.name]].join('\n'), 'utf8');
}

// 统计
for (const sec of SECTIONS) {
  const sz = fs.statSync(path.join(OUT_DIR, sec.name + '.js')).size;
  console.log(sec.name + '.js: ' + files[sec.name].length + ' 行, ' + (sz / 1024).toFixed(1) + ' KB');
}
console.log('✓ 拆分完成: ' + OUT_DIR);
