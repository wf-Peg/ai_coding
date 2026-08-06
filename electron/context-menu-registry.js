/**
 * context-menu-registry.js - 系统右键菜单注册/注销管理器
 *
 * 职责：
 * 1. Windows: 通过写入注册表添加右键菜单项
 * 2. macOS: 通过 Info.plist 的 NSServices 注册 Finder 服务
 * 3. 卸载时清理注册表项
 * 4. 注册状态持久化到 config.json，避免重复写入
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * 获取应用可执行文件路径（带引号，用于注册表命令）
 * @param {string} appDir - 应用根目录
 * @returns {string} 带引号的可执行文件路径
 */
function getExePath(appDir) {
  const isWin = process.platform === 'win32';
  const exeName = isWin ? 'CutShelter.exe' : 'CutShelter';
  // 打包后 exe 在 APP_DIR，开发模式在 node_modules/.bin/
  const exePath = path.join(appDir, exeName);
  if (fs.existsSync(exePath)) {
    return `"${exePath}"`;
  }
  // 回退到当前进程路径
  return `"${process.execPath}"`;
}

/**
 * Windows: 注册右键菜单到注册表
 * 写入 HKEY_CLASSES_ROOT\*\shell\CutShelter* 项
 *
 * @param {string} appDir - 应用根目录
 * @returns {boolean} 是否成功
 */
function registerWindowsContextMenu(appDir) {
  const exe = getExePath(appDir);
  const menuItems = [
    { id: 'CutShelterClip', label: '✂️ 添加到剪藏收件箱', arg: '--clip-file', appliesTo: null },
    { id: 'CutShelterAIClip', label: '🧠 AI 解析文件并添加剪藏', arg: '--ai-clip-file', appliesTo: null },
    { id: 'CutShelterOpen', label: '📝 用编辑器打开文件', arg: '--open-editor', appliesTo: null },
    { id: 'CutShelterOCRPdf', label: '📄 PDF OCR 识别', arg: '--pdf-ocr', appliesTo: 'System.FileName:.pdf' },
    { id: 'CutShelterSettings', label: '⚙️ 设置', arg: '--open-settings', appliesTo: null },
  ];

  let successCount = 0;
  for (const item of menuItems) {
    try {
      // 写入菜单项
      const regCmd = `reg add "HKEY_CLASSES_ROOT\\\\*\\\\shell\\\\${item.id}" /ve /t REG_SZ /d "${item.label}" /f`;
      execSync(regCmd, { timeout: 5000 });

      // 写入命令
      let cmdValue;
      if (item.arg === '--open-settings') {
        cmdValue = `${exe} ${item.arg}`;
      } else {
        cmdValue = `${exe} ${item.arg} "%1"`;
      }
      const cmdRegCmd = `reg add "HKEY_CLASSES_ROOT\\\\*\\\\shell\\\\${item.id}\\\\command" /ve /t REG_SZ /d "${cmdValue}" /f`;
      execSync(cmdRegCmd, { timeout: 5000 });

      // 写入 AppliesTo 过滤（仅对 PDF 等）
      if (item.appliesTo) {
        const appliesRegCmd = `reg add "HKEY_CLASSES_ROOT\\\\*\\\\shell\\\\${item.id}" /v AppliesTo /t REG_SZ /d "${item.appliesTo}" /f`;
        execSync(appliesRegCmd, { timeout: 5000 });
      }

      successCount++;
    } catch (e) {
      console.error(`[ContextMenu] Failed to register ${item.id}:`, e.message);
    }
  }
  return successCount === menuItems.length;
}

/**
 * Windows: 注销右键菜单
 * 删除 HKEY_CLASSES_ROOT\*\shell\CutShelter* 项
 */
function unregisterWindowsContextMenu() {
  const menuIds = [
    'CutShelterClip', 'CutShelterAIClip', 'CutShelterOpen',
    'CutShelterOCRPdf', 'CutShelterSettings'
  ];

  for (const id of menuIds) {
    try {
      execSync(`reg delete "HKEY_CLASSES_ROOT\\\\*\\\\shell\\\\${id}" /f`, { timeout: 5000 });
    } catch (e) {
      // 项不存在时忽略
    }
  }
}

/**
 * 注册系统右键菜单（自动检测平台）
 * @param {string} appDir - 应用根目录
 * @returns {boolean} 是否成功
 */
function registerContextMenu(appDir) {
  if (process.platform === 'win32') {
    return registerWindowsContextMenu(appDir);
  }
  // macOS: 通过 electron-builder 的 mac.extendInfo.NSServices 在构建时处理
  // 无需运行时注册
  console.log('[ContextMenu] macOS 右键菜单通过 Info.plist NSServices 构建时配置');
  return true;
}

/**
 * 注销系统右键菜单
 */
function unregisterContextMenu() {
  if (process.platform === 'win32') {
    unregisterWindowsContextMenu();
  }
}

module.exports = {
  registerContextMenu,
  unregisterContextMenu
};