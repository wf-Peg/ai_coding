/**
 * context-menu-registry.js - 系统右键菜单注册/注销管理器
 *
 * 职责：
 * 1. Windows: 通过写入注册表添加右键菜单项（写入 HKCU\Software\Classes，无需管理员权限）
 * 2. 双策略注册（Windows 11 兼容）：
 *    a) 经典菜单（"显示更多选项"）：注册「剪藏」SubCommands 级联菜单
 *       右键文件 → 剪藏 → 二级菜单（添加到收件箱 / AI 解析并添加 / 用编辑器打开 / PDF OCR 识别 / 设置）
 *       父项带 Advanced 值，从新版菜单隐藏，避免出现无法展开的不可用项。
 *    b) 新版刷新式菜单：静态 SubCommands 级联不支持展开（系统限制，成熟产品均用 COM DLL），
 *       因此同时注册平铺顶层命令（"剪藏：XXX"），不带 Advanced 值，新版菜单直接显示可点击。
 *       PDF OCR 平铺项注册到 SystemFileAssociations\.pdf（PDF 类型专用），
 *       确保桌面/文件夹中右键 PDF 文件时均出现该功能。
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

/** 级联菜单父项 ID（注册/注销共用） */
const MENU_ID = 'CutShelter';

/** 旧版扁平菜单项 id（早期实现残留，注销时清理） */
const LEGACY_FLAT_IDS = ['CutShelterClip', 'CutShelterAIClip', 'CutShelterOpen', 'CutShelterOCRPdf', 'CutShelterSettings'];

/** 旧版独立子命令键名（清理残留） */
const LEGACY_SUBKEYS = ['CutShelter.FileMenu', 'CutShelter.DesktopMenu'];

/**
 * 执行 reg 命令（参数数组方式，避免引号嵌套与编码问题）
 * @param {string[]} args - reg 参数
 * @param {boolean} silent - 为 true 时静默执行（用于清理不存在的键，忽略失败）
 * @returns {boolean} 是否成功（exit code 0）
 */
function runReg(args, silent) {
  const result = spawnSync('reg', args, { encoding: 'utf-8', timeout: 5000, windowsHide: true });
  if (result.error) {
    if (!silent) console.error('[ContextMenu] reg exec error:', result.error.message);
    return false;
  }
  if (result.status !== 0) {
    if (!silent) console.error('[ContextMenu] reg exit', result.status, ':', (result.stderr || '').trim());
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
 * 注册"打开方式"支持（Windows）
 * 注册 HKCU\Software\Classes\Applications\CutShelter.exe\shell\open\command，
 * 使本应用出现在系统"打开方式"对话框中。
 * 用户将大文本类型文件（.txt/.md/.log 等）的默认打开方式设为本应用后，
 * 双击文件会以 <exe> "<filePath>" 形式调用应用（argv 携带裸路径），
 * 由 command-line-handler 识别为"用编辑器打开"。
 *
 * @param {string} exe - 命令前缀（含引号）
 * @returns {boolean} 是否成功
 */
function registerOpenWith(exe) {
  const appKey = `${USER_CLASSES_ROOT}\\Applications\\CutShelter.exe`;
  let ok = true;
  // FriendlyAppName：打开方式对话框中的显示名
  if (!runReg(['add', appKey, '/v', 'FriendlyAppName', '/t', 'REG_SZ', '/d', 'CutShelter 剪藏', '/f'])) ok = false;
  // shell\open\command：双击文件（默认打开方式）时执行的命令
  if (!runReg(['add', `${appKey}\\shell\\open\\command`, '/ve', '/t', 'REG_SZ', '/d', `${exe} "%1"`, '/f'])) ok = false;
  if (ok) console.log('[ContextMenu] "打开方式"注册成功（Applications\\CutShelter.exe）');
  return ok;
}

/**
 * 注销"打开方式"支持
 */
function unregisterOpenWith() {
  runReg(['delete', `${USER_CLASSES_ROOT}\\Applications\\CutShelter.exe`, '/f'], true);
}

/**
 * 注册级联菜单父项
 * 结构：
 *   {root}\shell\{menuId}
 *       (Default) = 显示名
 *       MUIVerb = 显示名（Win11/资源管理器优先读取）
 *       SubCommands = "verb1;verb2;..."
 *       Advanced = command（隐藏于 Win11 新版菜单，仅经典菜单显示级联）
 *       Icon = "exe,0"
 *       Position = Top
 *
 * 注意：静态 SubCommands 级联在新版刷新式菜单无法展开，若不加 Advanced 值，
 * 新版菜单会显示一个不可用的父项（有箭头但点不开），因此必须隐藏。
 *
 * @param {string} root - 注册表根（如 * 或 Directory\Background）
 * @param {string} exe - 命令前缀（用于 Icon）
 * @param {string} label - 父菜单显示名
 * @param {string[]} verbs - 子命令名列表（分号分隔写入 SubCommands）
 * @returns {boolean} 是否成功
 */
function registerParentItem(root, exe, label, verbs) {
  const itemPath = `${USER_CLASSES_ROOT}\\${root}\\shell\\${MENU_ID}`;

  // 显示名（(Default) + MUIVerb 双保险）
  if (!runReg(['add', itemPath, '/ve', '/t', 'REG_SZ', '/d', label, '/f'])) return false;
  if (!runReg(['add', itemPath, '/v', 'MUIVerb', '/t', 'REG_SZ', '/d', label, '/f'])) return false;

  // Advanced：标记为高级命令，从 Win11 新版菜单隐藏，仅经典菜单（"显示更多选项"）显示
  if (!runReg(['add', itemPath, '/v', 'Advanced', '/t', 'REG_SZ', '/d', 'command', '/f'])) return false;

  // SubCommands：分号分隔的子命令列表
  if (!runReg(['add', itemPath, '/v', 'SubCommands', '/t', 'REG_SZ', '/d', verbs.join(';'), '/f'])) return false;

  // 图标
  const exeToken = exe.match(/^(".*?"|\S+)/);
  const iconPath = exeToken ? exeToken[1] : exe;
  if (!runReg(['add', itemPath, '/v', 'Icon', '/t', 'REG_SZ', '/d', `${iconPath},0`, '/f'])) return false;

  // 置顶显示
  runReg(['add', itemPath, '/v', 'Position', '/t', 'REG_SZ', '/d', 'Top', '/f']);
  return true;
}

/**
 * 注册级联菜单的子命令（二级菜单项）
 * 结构（定义在父项键的 shell 子键下，与 SubCommands 中的动词名对应）：
 *   {root}\shell\{menuId}\shell\{verb}
 *       (Default) = 子项显示名
 *       Icon = "exe,0"
 *       AppliesTo = ...（可选过滤）
 *   {root}\shell\{menuId}\shell\{verb}\command
 *       (Default) = 命令
 *
 * @param {string} root - 注册表根（如 * 或 Directory\Background）
 * @param {string} exe - 命令前缀
 * @param {Object} item - 子命令配置 { verb, label, arg, appliesTo, hasPath }
 * @returns {boolean} 是否成功
 */
function registerSubItem(root, exe, item) {
  const itemPath = `${USER_CLASSES_ROOT}\\${root}\\shell\\${MENU_ID}\\shell\\${item.verb}`;

  // 显示名
  if (!runReg(['add', itemPath, '/ve', '/t', 'REG_SZ', '/d', item.label, '/f'])) return false;

  // 图标
  const exeToken = exe.match(/^(".*?"|\S+)/);
  const iconPath = exeToken ? exeToken[1] : exe;
  if (!runReg(['add', itemPath, '/v', 'Icon', '/t', 'REG_SZ', '/d', `${iconPath},0`, '/f'])) return false;

  // 命令（hasPath 为 false 的项不追加 "%1"）
  const cmdValue = item.hasPath ? `${exe} ${item.arg} "%1"` : `${exe} ${item.arg}`;
  if (!runReg(['add', `${itemPath}\\command`, '/ve', '/t', 'REG_SZ', '/d', cmdValue, '/f'])) return false;

  // AppliesTo 过滤（仅对 PDF 等）
  if (item.appliesTo) {
    if (!runReg(['add', itemPath, '/v', 'AppliesTo', '/t', 'REG_SZ', '/d', item.appliesTo, '/f'])) return false;
  }

  return true;
}

/**
 * 注册平铺菜单项（Windows 11 新版菜单顶层命令）
 * 新版刷新式菜单不支持静态 SubCommands 级联，但支持普通平铺命令。
 * 为每个功能注册独立的顶层 verb（不带 Advanced 值），使其在新版菜单直接显示可点击；
 * 经典菜单仍由「剪藏」级联父项提供二级菜单。
 * 结构：
 *   {root}\shell\{verb}
 *       (Default) = 显示名
 *       MUIVerb = 显示名
 *       Icon = "exe,0"
 *       AppliesTo = ...（可选过滤）
 *   {root}\shell\{verb}\command
 *       (Default) = 命令
 *
 * @param {string} root - 注册表根（如 * 或 Directory\Background）
 * @param {string} exe - 命令前缀
 * @param {Object} item - 平铺项配置 { verb, label, arg, appliesTo, hasPath }
 * @returns {boolean} 是否成功
 */
function registerFlatItem(root, exe, item) {
  const itemPath = `${USER_CLASSES_ROOT}\\${root}\\shell\\${item.verb}`;

  // 显示名（(Default) + MUIVerb 双保险）
  if (!runReg(['add', itemPath, '/ve', '/t', 'REG_SZ', '/d', item.label, '/f'])) return false;
  if (!runReg(['add', itemPath, '/v', 'MUIVerb', '/t', 'REG_SZ', '/d', item.label, '/f'])) return false;

  // 图标
  const exeToken = exe.match(/^(".*?"|\S+)/);
  const iconPath = exeToken ? exeToken[1] : exe;
  if (!runReg(['add', itemPath, '/v', 'Icon', '/t', 'REG_SZ', '/d', `${iconPath},0`, '/f'])) return false;

  // 命令（hasPath 为 false 的项不追加 "%1"）
  const cmdValue = item.hasPath ? `${exe} ${item.arg} "%1"` : `${exe} ${item.arg}`;
  if (!runReg(['add', `${itemPath}\\command`, '/ve', '/t', 'REG_SZ', '/d', cmdValue, '/f'])) return false;

  // AppliesTo 过滤（仅对 PDF 等）
  if (item.appliesTo) {
    if (!runReg(['add', itemPath, '/v', 'AppliesTo', '/t', 'REG_SZ', '/d', item.appliesTo, '/f'])) return false;
  }

  return true;
}

/**
 * Windows: 注册右键菜单到注册表（新版平铺 + 经典级联双策略）
 * 1. 文件右键:
 *    - 经典菜单级联: HKCU\Software\Classes\*\shell\CutShelter（Advanced 隐藏于新版）+ 5 个子命令
 *    - 新版菜单平铺: HKCU\Software\Classes\*\shell\CutShelterClip 等 5 个独立顶层命令
 * 2. 桌面/文件夹背景右键:
 *    - 经典菜单级联: HKCU\Software\Classes\Directory\Background\shell\CutShelter（仅设置子命令）
 *    - 新版菜单平铺: HKCU\Software\Classes\Directory\Background\shell\CutShelterSettings
 *
 * @param {string} appDir - 应用根目录
 * @returns {boolean} 是否成功
 */
function registerWindowsContextMenu(appDir) {
  // 先清理旧版/残留菜单项（扁平项、旧级联结构），再注册新的双策略菜单
  unregisterWindowsContextMenu();

  const exe = getExeCommand(appDir);

  // 文件右键子命令（动词名需与 SubCommands 列表一致）
  const fileVerbs = [
    { verb: 'CutShelterClip', label: '添加到收件箱', arg: '--clip-file', appliesTo: null, hasPath: true },
    { verb: 'CutShelterAIClip', label: 'AI 解析并添加', arg: '--ai-clip-file', appliesTo: null, hasPath: true },
    { verb: 'CutShelterOpen', label: '用编辑器打开', arg: '--open-editor', appliesTo: null, hasPath: true },
    { verb: 'CutShelterOCRPdf', label: 'PDF OCR 识别', arg: '--pdf-ocr', appliesTo: 'System.FileName:.pdf', hasPath: true },
    { verb: 'CutShelterSettings', label: '设置', arg: '--open-settings', appliesTo: null, hasPath: false },
  ];

  // 新版菜单平铺项：标签加「剪藏：」前缀以标识归属。
  // 注意：PDF OCR 平铺项不注册在 * 下（避免对所有文件类型显示），
  // 而是注册到 SystemFileAssociations\.pdf（见下方第 5 步），确保桌面/文件夹的 PDF 文件右键均显示。
  const flatFileVerbs = fileVerbs
    .filter(v => v.verb !== 'CutShelterOCRPdf')
    .map(v => ({ ...v, label: `剪藏：${v.label}` }));

  // PDF 类型专用平铺项（新版菜单：PDF 文件右键显示，无需 AppliesTo 过滤）
  const pdfVerbs = [
    { verb: 'CutShelterOCRPdf', label: '剪藏：PDF OCR 识别', arg: '--pdf-ocr', appliesTo: null, hasPath: true },
  ];

  // 桌面背景子命令（无文件路径，仅设置可用）
  const bgVerbs = [
    { verb: 'CutShelterSettings', label: '设置', arg: '--open-settings', appliesTo: null, hasPath: false },
  ];

  const flatBgVerbs = bgVerbs.map(v => ({ ...v, label: `剪藏：${v.label}` }));

  let allOk = true;

  // 1. 文件右键经典级联菜单（Advanced 隐藏于新版菜单，仅经典菜单显示）
  if (!registerParentItem('*', exe, '剪藏', fileVerbs.map(v => v.verb))) {
    console.error('[ContextMenu] Failed to register parent item for files');
    allOk = false;
  }
  for (const item of fileVerbs) {
    if (!registerSubItem('*', exe, item)) {
      console.error(`[ContextMenu] Failed to register sub item ${item.verb}`);
      allOk = false;
    }
  }

  // 2. 文件右键新版平铺项（新版菜单直接显示）
  for (const item of flatFileVerbs) {
    if (!registerFlatItem('*', exe, item)) {
      console.error(`[ContextMenu] Failed to register flat item ${item.verb}`);
      allOk = false;
    }
  }

  // 3. 桌面/文件夹背景右键经典级联菜单
  if (!registerParentItem('Directory\\Background', exe, '剪藏', bgVerbs.map(v => v.verb))) {
    console.error('[ContextMenu] Failed to register parent item for desktop bg');
    allOk = false;
  }
  for (const item of bgVerbs) {
    if (!registerSubItem('Directory\\Background', exe, item)) {
      console.error(`[ContextMenu] Failed to register desktop sub item ${item.verb}`);
      allOk = false;
    }
  }

  // 4. 桌面/文件夹背景右键新版平铺项
  for (const item of flatBgVerbs) {
    if (!registerFlatItem('Directory\\Background', exe, item)) {
      console.error(`[ContextMenu] Failed to register desktop flat item ${item.verb}`);
      allOk = false;
    }
  }

  // 5. PDF 类型专用右键项（新版菜单：桌面/文件夹中 PDF 文件右键均显示该功能）
  for (const item of pdfVerbs) {
    if (!registerFlatItem('SystemFileAssociations\\.pdf', exe, item)) {
      console.error(`[ContextMenu] Failed to register pdf flat item ${item.verb}`);
      allOk = false;
    }
  }

  // 6. "打开方式"支持（默认打开方式双击文本文件 → 用编辑器打开）
  if (!registerOpenWith(exe)) {
    console.error('[ContextMenu] Failed to register open-with support');
    allOk = false;
  }

  if (allOk) {
    console.log('[ContextMenu] 系统右键菜单注册成功（新版平铺 + 经典级联 + 打开方式）');
  }
  return allOk;
}

/**
 * Windows: 注销右键菜单
 * 删除级联菜单父键（含所有子命令）、旧版扁平项、旧版独立子命令键，以及 HKLM 版 HKCR 残留项
 */
function unregisterWindowsContextMenu() {
  const roots = ['*', 'Directory\\Background', 'SystemFileAssociations\\.pdf'];

  // 0. 注销"打开方式"支持
  unregisterOpenWith();

  // 1. 删除级联父键（reg delete 递归删除所有子键）
  for (const root of roots) {
    runReg(['delete', `${USER_CLASSES_ROOT}\\${root}\\shell\\${MENU_ID}`, '/f'], true);
  }

  // 2. 删除旧版扁平独立菜单项（早期实现残留）
  for (const root of roots) {
    for (const id of LEGACY_FLAT_IDS) {
      runReg(['delete', `${USER_CLASSES_ROOT}\\${root}\\shell\\${id}`, '/f'], true);
    }
  }

  // 3. 删除旧版独立子命令键（更早期级联实现残留）
  for (const subKey of LEGACY_SUBKEYS) {
    runReg(['delete', `${USER_CLASSES_ROOT}\\${subKey}`, '/f'], true);
  }

  // 4. 兼容清理：旧版本写入的 HKLM 版 HKCR 项（若之前以管理员权限注册过）
  const legacyRoots = ['HKEY_CLASSES_ROOT', 'HKEY_LOCAL_MACHINE\\Software\\Classes'];
  for (const root of legacyRoots) {
    for (const scope of roots) {
      runReg(['delete', `${root}\\${scope}\\shell\\${MENU_ID}`, '/f'], true);
      for (const id of LEGACY_FLAT_IDS) {
        runReg(['delete', `${root}\\${scope}\\shell\\${id}`, '/f'], true);
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
