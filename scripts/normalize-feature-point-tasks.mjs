/**
 * 一次性任务数据规范化脚本（产品概览「无标题假待办」修复）
 *
 * 历史做法：把 feature-points.json 里不规范的 tasks 统一为 { title, status }。
 *  - tasks 元素为字符串 → { title: 原字符串, status: 'done' }（历史口径：字符串任务为已实现项）
 *  - tasks 元素为对象且 status === 'completed' → 'done'
 *  - tasks 元素为对象且 status === 'pending'   → 'todo'
 *  - 其余不动
 *
 * 保留文件原换行风格（CRLF/LF）与缩进，仅重排 tasks 数组，不触碰其它结构。
 * 运行方式：node scripts/normalize-feature-point-tasks.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TODO_ROOT = path.resolve(__dirname, '..', 'TODO');

if (!fs.existsSync(TODO_ROOT)) {
  console.error('[normalize] TODO 目录不存在:', TODO_ROOT);
  process.exit(1);
}

const dirs = fs.readdirSync(TODO_ROOT).filter((d) => fs.statSync(path.join(TODO_ROOT, d)).isDirectory());

let stats = { file: 0, strToDone: 0, completedToDone: 0, pendingToTodo: 0, titleFromName: 0, touched: [] };

dirs.forEach((dir) => {
  const fp = path.join(TODO_ROOT, dir, 'feature-points.json');
  if (!fs.existsSync(fp)) return;
  let raw;
  try {
    raw = fs.readFileSync(fp, 'utf8');
  } catch (e) {
    console.error('[normalize] 读取失败', fp, e.message);
    return;
  }
  // 记录原换行风格（CRLF / LF）
  const hasCRLF = raw.includes('\r\n');

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error('[normalize] JSON 解析失败（跳过）', fp, e.message);
    return;
  }

  const fps = Array.isArray(data.featurePoints) ? data.featurePoints : [];
  let fileChanged = false;

  fps.forEach((fp) => {
    if (!fp || !Array.isArray(fp.tasks)) return;
    fp.tasks = fp.tasks.map((t) => {
      if (typeof t === 'string') {
        stats.strToDone++;
        fileChanged = true;
        return { title: t, status: 'done' };
      }
      if (t && typeof t === 'object') {
        if (t.status === 'completed') {
          stats.completedToDone++;
          fileChanged = true;
          return Object.assign({}, t, { status: 'done' });
        }
        if (t.status === 'pending') {
          stats.pendingToTodo++;
          fileChanged = true;
          return Object.assign({}, t, { status: 'todo' });
        }
        // 对象任务缺 title 但存在 name（历史格式）：以 name 兜底为 title，保证"无标题"清零
        if (!String(t.title || '').trim() && t.name) {
          stats.titleFromName++;
          fileChanged = true;
          return Object.assign({}, t, { title: t.name });
        }
        return t;
      }
    });
  });

  if (fileChanged) {
    const json = JSON.stringify(data, null, 2) + '\n';
    const out = hasCRLF ? json.replace(/\n/g, '\r\n') : json;
    try {
      fs.writeFileSync(fp, out, 'utf8');
      stats.file++;
      stats.touched.push(dir);
    } catch (e) {
      console.error('[normalize] 写入失败', fp, e.message);
    }
  }
});

console.log('[normalize] 完成');
console.log('  修改文件数            :', stats.file);
console.log('  字符串任务 → done     :', stats.strToDone);
console.log('  completed → done     :', stats.completedToDone);
console.log('  pending   → todo     :', stats.pendingToTodo);
console.log('  title=name 兜底      :', stats.titleFromName);
console.log('  涉及目录       :', stats.touched.join(', ') || '(无)');