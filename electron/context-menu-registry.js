/**
 * context-menu-registry.js - 系统右键菜单注册/注销管理器
 *
 * 职责：
 * 1. Windows: 通过写入注册表添加右键菜单项（写入 HKCU\Software\Classes，无需管理员权限）
 * 2. 注册单个「剪藏」菜单项，点击后由 Electron 弹出原生菜单（Menu.popup）
 *    —— 兼容 Windows 11 新右键菜单（静态 SubCommands 级联在 Win11 上不可靠）
 * 3. macOS: 通过 Info.plist 的 NSServices 注册 Finder 服务
 * 4. 卸载时清理注册表项
 *
 * 注意：必须使用 spawnSync('reg', [args...]) 参数数组方式调用 reg.exe，
 * 不要用 execSync 拼接命令字符串——命令值本身包含双引号（"exe" --clip-file "%1"），
 * 嵌套在 execSync 的 /d "..." 中会被 cmd.exe 错误解析导致 command 写入失败；
 * 且 execSync 走 cmd.exe 在中文/特殊字符路径下存在编码风险。
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * 每用户注册表根路径（HKCU\Software\Classes）
 * 与 HKLM 版 HKCR 不同，写入此路径不需要管理员权限，
 * Windows 10/11 会优先读取每用户注册的 Shell 右键菜单。
 */
const USER_CLASSES_ROOT = 'HKEY_CURRENT_USER\\Software\\Classes';

/** 顶级菜单名称（右键 → 剪藏 → 弹出子菜单） */
const PARENT_MENU_NAME = '剪藏';

/** 所有菜单项 id（注册/注销共用） */
const MENU_IDS = [
  'CutShelter',
  'CutShelterClip',
  'CutShelterAIClip',
  'CutShelterOpen',
  'CutShelterOCRPdf',
  'CutShelterSettings'
];

/** CommandStore 子命令键名（旧版残留清理） */
const LEGACY_SUBKEYS = ['CutShelter.FileMenu', 'CutShelter.DesktopMenu'];

/**
 * 执行 reg 命令（参数数组方式，避免引号嵌套与编码问题）
 * @param {string[]} args - reg 参数
 * @returns {boolean} 是否成功（exit code 0）
 */
function runReg(args) {
  const result = spawnSync('reg', args, { encoding: 'utf-8', timeout: 5000, windowsHide: true });
  if (result.error) {
    console.error('[ContextMenu] reg exec error:', result.error.message);
    return false;
  }
  if (result.status !== 0) {
    console.error('[ContextMenu] reg exit', result.status, ':', (result.stderr || '').trim());
    return false;
  }
  return true;
}

/**
 * 获取应用启动命令前缀（带引号，用于注册表命令）
 * 打包模式：CutShelter.exe 与应用目录同级，直接使用。
 * 开发模式：不存在 exe，使用当前 Electron 可执行文件并附带应用目录参数，
 * 否则右键菜单点击只会启动 Electron 默认示例窗口而不是本应用。
 * @param {string} appDir - 应用根目录
 * @returns {string} 可执行命令前缀
 */
function getExeCommand(appDir) {
  const isWin = process.platform === 'win32';
  const exeName = isWin ? 'CutShelter.exe' : 'CutShelter';
  const exePath = path.join(appDir, exeName);
  if (fs.existsSync(exePath)) {
    return `"${exePath}"`;
  }
  // 开发模式：Electron 可执行文件 + 应用目录参数
  return `"${process.execPath}" "${appDir}"`;
}

/**
 * 注册单个扁平菜单项（文件右键 / 桌面背景右键）
 * 结构：
 *   {root}\shell\CutShelter
 *       (Default) = "剪藏"
 *       Icon = "exe,0"
 *   {root}\shell\CutShelter\command
 *       (Default) = "exe" --context-menu "%1"
 *
 * 点击后由 Electron 主进程弹出原生 Menu.popup 菜单，
 * 用户选择具体功能后再分发动作。兼容 Windows 11 新右键菜单。
 *
 * @param {string} root - 注册表根（如 * 或 Directory\Background）
 * @param {string} exe - 命令前缀
 * @param {boolean} isDesktopBg - 是否为桌面/文件夹背景右键（不需要 %1）
 * @returns {boolean} 是否成功
 */
function registerFlatMenuItem(root, exe, isDesktopBg) {
  const itemPath = `${USER_CLASSES_ROOT}\\${root}\\shell\\CutShelter`;

  // 菜单显示名
  if (!runReg(['add', itemPath, '/ve', '/t', 'REG_SZ', '/d', PARENT_MENU_NAME, '/f'])) return false;

  // 菜单图标
  const exeToken = exe.match(/^(".*?"|\S+)/);
  const iconPath = exeToken ? exeToken[1] : exe;
  if (!runReg(['add', itemPath, '/v', 'Icon', '/t', 'REG_SZ', '/d', `${iconPath},0`, '/f'])) return false;

  // 命令：--context-menu 触发 Electron 弹出原生菜单
  const cmdValue = isDesktopBg
    ? `${exe} --context-menu`
    : `${exe} --context-menu "%1"`;
  if (!runReg(['add', `${itemPath}\\command`, '/ve', '/t', 'REG_SZ', '/d', cmdValue, '/f'])) return false;

  return true;
}

/**
 * Windows: 注册右键菜单到注册表
 * 1. 文件右键: HKCU\Software\Classes\*\shell\CutShelter（剪藏 → 弹出菜单）
 * 2. 桌面/文件夹背景右键: HKCU\Software\Classes\Directory\Background\shell\CutShelter
 *
 * @param {string} appDir - 应用根目录
 * @returns {boolean} 是否成功
 */
function registerWindowsContextMenu(appDir) {
  const exe = getExeCommand(appDir);

  // 1. 文件右键菜单
  const fileOk = registerFlatMenuItem('*', exe, false);
  // 2. 桌面/文件夹背景右键菜单
  const desktopOk = registerFlatMenuItem('Directory\\Background', exe, true);

  if (fileOk && desktopOk) {
    console.log('[ContextMenu] 系统右键菜单注册成功（扁平菜单 + Electron 弹窗）');
  }
  return fileOk && desktopOk;
}

/**
 * Windows: 注销右键菜单
 * 删除 HKCU 级联结构、旧版平铺结构，以及 HKLM 版 HKCR 残留项
 */
function unregisterWindowsContextMenu() {
  const roots = ['*', 'Directory\\Background'];

  // 1. 删除 HKCU 菜单项（自动递归删除所有子项）
  for (const root of roots) {
    runReg(['delete', `${USER_CLASSES_ROOT}\\${root}\\shell\\CutShelter`, '/f']);
  }

  // 2. 删除旧版独立子命令键（前期实现残留）
  for (const subKey of LEGACY_SUBKEYS) {
    runReg(['delete', `${USER_CLASSES_ROOT}\\${subKey}`, '/f']);
  }

  // 3. 删除 HKCU 旧版平铺结构（单独注册的子项）
  for (const root of roots) {
    for (const id of MENU_IDS) {
      runReg(['delete', `${USER_CLASSES_ROOT}\\${root}\\shell\\${id}`, '/f']);
    }
  }

  // 4. 兼容清理：旧版本写入的 HKLM 版 HKCR 项（若之前以管理员权限注册过）
  const legacyRoots = ['HKEY_CLASSES_ROOT', 'HKEY_LOCAL_MACHINE\\Software\\Classes'];
  for (const root of legacyRoots) {
    for (const scope of ['*', 'Directory\\Background']) {
      runReg(['delete', `${root}\\${scope}\\shell\\CutShelter`, '/f']);
      for (const id of MENU_IDS) {
        runReg(['delete', `${root}\\${scope}\\shell\\${id}`, '/f']);
      }
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
