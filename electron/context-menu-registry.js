/**
 * context-menu-registry.js - 系统右键菜单注册/注销管理器
 *
 * 职责：
 * 1. Windows: 通过写入注册表添加右键菜单项（写入 HKCU\Software\Classes，无需管理员权限）
 * 2. 注册多个扁平菜单项（用「剪藏 |」前缀分组），直接可点击执行
 *    —— Windows 11 25H2 静态 SubCommands 级联已不可靠，
 *       所有成熟产品（7-Zip 等）均使用 COM DLL 方式，本项目不引入原生 DLL
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

/** 所有菜单项 id（注册/注销共用） */
const MENU_IDS = [
  'CutShelter',
  'CutShelterClip',
  'CutShelterAIClip',
  'CutShelterOpen',
  'CutShelterOCRPdf',
  'CutShelterSettings'
];

/** 旧版独立子命令键名（清理残留） */
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
 * 注册一个扁平菜单项
 * 结构：
 *   {root}\shell\{itemId}
 *       (Default) = 显示名
 *       Icon = "exe,0"
 *   {root}\shell\{itemId}\command
 *       (Default) = 命令
 *
 * @param {string} root - 注册表根（如 * 或 Directory\Background）
 * @param {string} exe - 命令前缀
 * @param {Object} item - 菜单项配置 { id, label, arg, appliesTo }
 * @param {boolean} isDesktopBg - 是否为桌面/文件夹背景右键（不需要 %1）
 * @returns {boolean} 是否成功
 */
function registerFlatItem(root, exe, item, isDesktopBg) {
  const itemPath = `${USER_CLASSES_ROOT}\\${root}\\shell\\${item.id}`;

  // 菜单显示名
  if (!runReg(['add', itemPath, '/ve', '/t', 'REG_SZ', '/d', item.label, '/f'])) return false;

  // 菜单图标
  const exeToken = exe.match(/^(".*?"|\S+)/);
  const iconPath = exeToken ? exeToken[1] : exe;
  if (!runReg(['add', itemPath, '/v', 'Icon', '/t', 'REG_SZ', '/d', `${iconPath},0`, '/f'])) return false;

  // 命令
  const cmdValue = (isDesktopBg || item.arg === '--open-settings')
    ? `${exe} ${item.arg}`
    : `${exe} ${item.arg} "%1"`;
  if (!runReg(['add', `${itemPath}\\command`, '/ve', '/t', 'REG_SZ', '/d', cmdValue, '/f'])) return false;

  // AppliesTo 过滤（仅对 PDF 等）
  if (item.appliesTo) {
    if (!runReg(['add', itemPath, '/v', 'AppliesTo', '/t', 'REG_SZ', '/d', item.appliesTo, '/f'])) return false;
  }

  return true;
}

/**
 * Windows: 注册右键菜单到注册表（扁平菜单项，用前缀分组）
 * 1. 文件右键: HKCU\Software\Classes\*\shell\CutShelter{XXX}
 * 2. 桌面/文件夹背景右键: HKCU\Software\Classes\Directory\Background\shell\CutShelterSettings
 *
 * @param {string} appDir - 应用根目录
 * @returns {boolean} 是否成功
 */
function registerWindowsContextMenu(appDir) {
  const exe = getExeCommand(appDir);

  // 文件右键菜单项（用「剪藏 |」前缀分组，在经典菜单中相邻排列）
  const menuItems = [
    { id: 'CutShelterClip', label: '✂️ 剪藏 | 添加到收件箱', arg: '--clip-file', appliesTo: null },
    { id: 'CutShelterAIClip', label: '🧠 剪藏 | AI 解析并添加', arg: '--ai-clip-file', appliesTo: null },
    { id: 'CutShelterOpen', label: '📝 剪藏 | 用编辑器打开', arg: '--open-editor', appliesTo: null },
    { id: 'CutShelterOCRPdf', label: '📄 剪藏 | PDF OCR 识别', arg: '--pdf-ocr', appliesTo: 'System.FileName:.pdf' },
    { id: 'CutShelterSettings', label: '⚙️ 剪藏 | 设置', arg: '--open-settings', appliesTo: null },
  ];

  // 桌面背景右键菜单项（仅需无文件路径的项）
  const desktopBgItems = [
    { id: 'CutShelterSettings', label: '⚙️ 剪藏 | 设置', arg: '--open-settings', appliesTo: null },
  ];

  let allOk = true;

  // 1. 文件右键菜单
  for (const item of menuItems) {
    if (!registerFlatItem('*', exe, item, false)) {
      console.error(`[ContextMenu] Failed to register ${item.id}`);
      allOk = false;
    }
  }

  // 2. 桌面/文件夹背景右键菜单
  for (const item of desktopBgItems) {
    if (!registerFlatItem('Directory\\Background', exe, item, true)) {
      console.error(`[ContextMenu] Failed to register desktop ${item.id}`);
      allOk = false;
    }
  }

  if (allOk) {
    console.log('[ContextMenu] 系统右键菜单注册成功（扁平菜单项）');
  }
  return allOk;
}

/**
 * Windows: 注销右键菜单
 * 删除 HKCU 菜单项、旧版级联结构、旧版独立子命令键，以及 HKLM 版 HKCR 残留项
 */
function unregisterWindowsContextMenu() {
  const roots = ['*', 'Directory\\Background'];

  // 1. 删除 HKCU 所有菜单项（含级联顶级键 CutShelter 和各扁平子项）
  for (const root of roots) {
    for (const id of MENU_IDS) {
      runReg(['delete', `${USER_CLASSES_ROOT}\\${root}\\shell\\${id}`, '/f']);
    }
  }

  // 2. 删除旧版独立子命令键（前期实现残留）
  for (const subKey of LEGACY_SUBKEYS) {
    runReg(['delete', `${USER_CLASSES_ROOT}\\${subKey}`, '/f']);
  }

  // 3. 兼容清理：旧版本写入的 HKLM 版 HKCR 项（若之前以管理员权限注册过）
  const legacyRoots = ['HKEY_CLASSES_ROOT', 'HKEY_LOCAL_MACHINE\\Software\\Classes'];
  for (const root of legacyRoots) {
    for (const scope of ['*', 'Directory\\Background']) {
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
