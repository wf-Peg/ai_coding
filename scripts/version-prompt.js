/**
 * version-prompt.js — 交互式版本号确认（供 build.bat / release.bat 调用）
 *
 * 行为：
 * 1. 读取 package.json 当前版本
 * 2. 询问「是否递增版本号并更新 package.json？(y/N)」
 * 3. y → 询问新版本号（回车用建议值 x.y.(z+1)），校验 x.y.z 格式后写回 package.json
 *    N → 沿用当前版本
 * 4. 把最终版本号写入 <outFile>（默认 .tmp/version-result.txt），供批处理读取
 *
 * 为什么用 node 而不是批处理 set /p：
 * - chcp 65001（UTF-8 控制台）下 set /p 在重定向/管道 stdin 场景会读到空值，
 *   交互体验不可靠；node readline 对控制台、管道、文件输入均稳定。
 * - 中文提示与编码由 node 原生处理，不依赖控制台代码页。
 *
 * 用法：
 *   node scripts/version-prompt.js [outFile]
 * 退出码：0 成功；1 版本号格式无效或读写失败
 * 交互示例（管道/CI）：
 *   echo y| node scripts/version-prompt.js      # 回车使用建议值
 *   (echo y & echo 1.0.9)| node scripts/version-prompt.js
 *   echo n| node scripts/version-prompt.js      # 沿用当前版本
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const outFile = process.argv[2] || path.join(__dirname, '..', '.tmp', 'version-result.txt');
const pkgPath = path.join(__dirname, '..', 'package.json');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function fail(msg) {
  console.error('[version-prompt] ' + msg);
  process.exit(1);
}

function writeResult(version) {
  try {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, version, 'utf-8');
  } catch (e) {
    fail('写入版本结果文件失败: ' + e.message);
  }
}

let pkg, raw;
try {
  raw = fs.readFileSync(pkgPath, 'utf-8');
  pkg = JSON.parse(raw);
} catch (e) {
  fail('无法读取 package.json: ' + e.message);
}

const current = String(pkg.version || '1.0.0');
const parts = current.split('.');
const suggest = `${parts[0] || 1}.${parts[1] || 0}.${(parseInt(parts[2], 10) || 0) + 1}`;

rl.question(`当前版本: ${current}，是否递增版本号并更新 package.json？(y/N): `, (ans) => {
  if (!/^y$/i.test(ans.trim())) {
    writeResult(current);
    console.log(`[version-prompt] 沿用当前版本 ${current}`);
    rl.close();
    return;
  }

  rl.question(`请输入新版本号（回车使用建议值 ${suggest}）: `, (nv) => {
    const version = nv.trim() || suggest;
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      fail(`版本号格式无效: ${version}（应为 x.y.z，如 1.0.8）`);
      return;
    }

    pkg.version = version;
    // 保留文件原有的换行风格
    const eol = raw.includes('\r\n') ? '\r\n' : '\n';
    try {
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + eol);
    } catch (e) {
      fail('更新 package.json 失败: ' + e.message);
      return;
    }

    writeResult(version);
    console.log(`[version-prompt] 版本号已更新为 ${version}`);
    rl.close();
  });
});
