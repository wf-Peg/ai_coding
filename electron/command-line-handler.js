/**
 * command-line-handler.js - 命令行参数解析器
 *
 * 解析系统右键菜单传递的 CLI 参数，通过 IPC 发送到渲染进程。
 * 支持的参数：
 *   --context-menu ["path"] → 弹出原生菜单供用户选择具体功能
 *   --clip-file "path"     → 添加到剪藏收件箱
 *   --ai-clip-file "path"  → AI 解析文件并添加剪藏
 *   --open-editor "path"   → 用编辑器打开文件
 *   --pdf-ocr "path"       → PDF OCR 识别
 *   --open-settings        → 打开设置页面
 */

/**
 * 解析命令行参数，返回动作列表
 * @param {string[]} argv - process.argv
 * @returns {Array<{action: string, path: string|null}>}
 */
function parseCommandLineArgs(argv) {
  const actions = [];
  const argMap = {
    '--clip-file': 'clip-file',
    '--ai-clip-file': 'ai-clip-file',
    '--open-editor': 'open-editor',
    '--pdf-ocr': 'pdf-ocr',
    '--open-settings': 'open-settings'
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--context-menu') {
      // --context-menu 可带可选文件路径参数
      const filePath = (i + 1 < argv.length && !argv[i + 1].startsWith('-'))
        ? argv[i + 1] : null;
      actions.push({ action: 'context-menu', path: filePath });
      if (filePath) i++;
    } else if (argMap[arg]) {
      if (arg === '--open-settings') {
        actions.push({ action: 'open-settings', path: null });
      } else if (i + 1 < argv.length) {
        actions.push({ action: argMap[arg], path: argv[i + 1] });
        i++; // 跳过路径参数
      }
    }
  }
  return actions;
}

/**
 * 处理命令行参数，通过 IPC 发送到渲染进程
 * @param {Array<{action: string, path: string|null}>} actions
 * @param {BrowserWindow} mainWindow
 */
function dispatchActions(actions, mainWindow) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  for (const { action, path } of actions) {
    switch (action) {
      case 'context-menu':
        // 由主进程弹出原生菜单，不直接发送到渲染进程
        // main.js 中的 showContextMenuPopup 函数会处理此动作
        mainWindow.webContents.send('context-menu', path);
        break;
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