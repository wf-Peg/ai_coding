import { execSync } from 'child_process';
import fs from 'fs';
const LOCAL = '39aba92';
const REMOTE = 'c9f2c36';
const MERGE = 'c05301b';

function sh(c) { try { return execSync(c, { encoding: 'utf8' }); } catch (e) { return '<missing>'; } }

// 1) 两分叉间改动的全部文件
const divergent = sh('git diff --name-only ' + LOCAL + ' ' + REMOTE).trim().split(/\r?\n/).filter(Boolean);

// 2) 合并结果==远端(被覆盖) & 合并结果==本地(未并入)
const rows = [];
for (const f of divergent) {
  const m = sh('git show ' + MERGE + ':' + f);
  if (m === '<missing>') continue;
  const p1 = sh('git show ' + LOCAL + ':' + f);
  const p2 = sh('git show ' + REMOTE + ':' + f);
  // 工作区是否已接近本地(恢复到 3 段"已恢复"判定)
  let w = '<missing-disk>';
  try { w = fs.readFileSync(f, 'utf8'); } catch (e) {}
  let status;
  if (w === p1) status = '已恢复(工作区==本地)';
  else if (m === p2 && m !== p1) status = '被覆盖(合并取远端)';
  else if (m === p1 && m !== p2) status = '取本地';
  else status = '混合合并';
  rows.push(status + '\t' + f);
}
rows.sort();
fs.writeFileSync('.audit-clobber.tsv', rows.join('\n'), 'utf8');

// 汇总统计
const stat = {};
for (const r of rows) { const k = r.split('\t')[0]; stat[k] = (stat[k] || 0) + 1; }
console.log('=== 覆盖清单汇总 ===');
for (const k of Object.keys(stat)) console.log(stat[k] + '  ' + k);
console.log('total files:', rows.length);
console.log('\n清单已写入 .audit-clobber.tsv');