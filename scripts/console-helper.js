/**
 * console-helper.js — 批处理交互辅助（规避 chcp 65001 下 set /p、pause 的不可靠）
 *
 * 背景：批处理在 chcp 65001（UTF-8 控制台）下，set /p 在控制台/管道输入时可能
 * 读到空值或立即返回，pause 也可能不等待，导致脚本"闪退"。node readline 对
 * 控制台、管道、文件输入均稳定，因此所有交互输入与等待统一走本脚本。
 *
 * 用法：
 *   node scripts/console-helper.js ask "<问题文本>" [outFile]
 *       - 打印问题并读取一行输入；写入 outFile（默认输出到 stdout）
 *       - bat 侧用 `set /p VAR=<outFile` 读取（set /p <file 在 chcp 65001 下正常）
 *   node scripts/console-helper.js waitkey "<提示文本>"
 *       - 打印提示并等待回车（等效 pause，但对控制台输入更可靠）
 *
 * 退出码：0 成功；1 参数错误或写入失败
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const mode = process.argv[2];
const text = process.argv[3] || '';
const outFile = process.argv[4];

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

if (mode === 'waitkey') {
  rl.question(`${text}\n按回车键继续...`, () => {
    rl.close();
  });
} else if (mode === 'ask') {
  rl.question(`${text}: `, (ans) => {
    // trim：去掉管道/echo 输入可能带的尾随空格，保证 "y" 比较可靠
    const trimmed = ans.trim();
    if (outFile) {
      try {
        fs.mkdirSync(path.dirname(outFile), { recursive: true });
        fs.writeFileSync(outFile, trimmed, 'utf-8');
      } catch (e) {
        console.error(`[console-helper] 写入结果失败: ${e.message}`);
        process.exit(1);
      }
    } else {
      process.stdout.write(trimmed);
    }
    rl.close();
  });
} else {
  console.error('用法: node scripts/console-helper.js <ask|waitkey> [text] [outFile]');
  process.exit(1);
}
