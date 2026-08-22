/**
 * command-line-handler.js - 命令行参数解析器
 *
 * 解析系统右键菜单传递的 CLI 参数，通过 IPC 发送到渲染进程。
 * 支持的参数：
 *   --clip-file "path"     → 添加到剪藏收件箱
 *   --ai-clip-file "path"  → AI 解析文件并添加剪藏
 *   --open-editor "path"   → 用编辑器打开文件
 *   --pdf-ocr "path"       → PDF OCR 识别
 *   --open-settings        → 打开设置页面
 *   裸文本文件路径          → 默认打开方式双击文件（等价于"用编辑器打开"）
 */

const path = require('path');
const fs = require('fs');

/** 大文本类型扩展名：设为默认打开方式时，双击文件按"用编辑器打开"处理 */
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.log', '.json', '.xml', '.sql',
  '.csv', '.yaml', '.yml', '.ini', '.conf',
  '.js', '.ts', '.tsx', '.py', '.java', '.c', '.cpp', '.h', '.go', '.rs',
  '.html', '.htm', '.css', '.scss', '.less', '.sh', '.bat', '.ps1'
]);

/**
 * 判断候选参数是否为已存在的大文本文件
 * @param {string} candidate - 待判断路径
 * @returns {boolean}
 */
function isTextFileLike(candidate) {
  try {
    const ext = path.extname(candidate).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) return false;
    return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * 解析命令行参数，返回动作列表
 * @param {string[]} argv - process.argv 或 second-instance 的 commandLine
 * @param {string} appDir - 应用根目录（用于跳过开发模式下被 Electron 重组的路径参数）
 * @returns {Array<{action: string, path: string|null}>}
 */
function parseCommandLineArgs(argv, appDir) {
  const actions = [];
  const argMap = {
    '--clip-file': 'clip-file',
    '--ai-clip-file': 'ai-clip-file',
    '--open-editor': 'open-editor',
    '--pdf-ocr': 'pdf-ocr',
    '--open-settings': 'open-settings'
  };

  console.log('[Parse] Raw argv:', JSON.stringify(argv));

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (argMap[arg]) {
      if (arg === '--open-settings') {
        actions.push({ action: 'open-settings', path: null });
      } else {
        // Windows 上 Electron 会把 Chromium 注入开关（如 --allow-file-access-from-files）
        // 插入用户参数之间并重排位置，导致 argv[i+1] 不是真实路径。
        // 向后搜索第一个非开关、非 exe、非 appDir 的参数作为真实路径。
        let filePath = null;
        for (let j = i + 1; j < argv.length; j++) {
          const v = argv[j];
          if (v.startsWith('--')) continue;
          if (v === process.execPath) continue;
          if (appDir && v === appDir) continue;
          filePath = v;
          break;
        }
        actions.push({ action: argMap[arg], path: filePath });
      }
    } else if (!arg.startsWith('-') && arg !== process.execPath && arg !== appDir && isTextFileLike(arg)) {
      // 默认打开方式双击文件：argv 直接携带裸文本文件路径，
      // 等价于右键菜单的"用编辑器打开"（--open-editor）。
      console.log('[Parse] Bare text file path detected:', arg);
      actions.push({ action: 'open-editor', path: arg });
    }
  }
  // 去重：同一 open-editor 文件可能同时以 --open-editor 标志与裸路径两种形态
  // 出现在 argv（Electron 会重组命令行），避免对同一文件分发两次导致前端开两个画布。
  const seenOpenEditor = new Set();
  return actions.filter(a => {
    if (a.action !== 'open-editor' || !a.path) return true;
    if (seenOpenEditor.has(a.path)) return false;
    seenOpenEditor.add(a.path);
    return true;
  });
}

/**
 * 处理命令行参数，通过 IPC 发送到渲染进程
 * @param {Array<{action: string, path: string|null}>} actions
 * @param {BrowserWindow} mainWindow
 */
function dispatchActions(actions, mainWindow) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  for (const { action, path } of actions) {
    console.log(`[Dispatch] Sending action=${action} path=${path} to renderer`);
    switch (action) {
      case 'clip-file':
        mainWindow.webContents.send('clip-file', path);
        break;
      case 'ai-clip-file':
        mainWindow.webContents.send('ai-clip-file', path);
        break;
      case 'open-editor':
        mainWindow.webContents.send('open-file-request', path);
        break;
      case 'pdf-ocr':
        mainWindow.webContents.send('pdf-ocr', path);
        break;
      case 'open-settings':
        mainWindow.webContents.send('open-settings');
        break;
    }
  }
}

module.exports = { parseCommandLineArgs, dispatchActions };
