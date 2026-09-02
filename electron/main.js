/**
 * CutShelter - Electron 主进程入口
 * 
 * 职责：
 * 1. 管理应用生命周期（启动、退出、托盘）
 * 2. 管理前后端服务进程（Spring Boot 后端 + 静态文件前端）
 * 3. 管理窗口（主窗口、配置窗口）、系统托盘、菜单栏
 * 4. 提供 IPC 通道供渲染进程调用
 */

const { app, BrowserWindow, ipcMain, dialog, Menu, shell, Tray, nativeImage, Notification, globalShortcut, clipboard, session, screen, desktopCapturer, systemPreferences } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { spawn, exec } = require('child_process');
const crypto = require('crypto');
const http = require('http');
const yaml = require('js-yaml');
const { EditorFileService } = require('./editor-file-service');

// SQLite 本地索引层（主进程 Node 侧，仅节 clip；失败不影响主流程）
const localIndexService = require('./sqlite/index-service');
const localSearch = require('./sqlite/search');
const localGraph = require('./sqlite/graph');
const localDb = require('./sqlite/db');
// clip-storage 实时监听句柄（will-quit 时释放）
let localIndexWatcher = null;

// 更新管理器（自动更新 + 手动检查）
const updateManager = require('./update-manager');

// 右键菜单注册管理器
const { registerContextMenu, unregisterContextMenu } = require('./context-menu-registry');
// 截图小工具（F1 截图 / F2 贴图 / OCR）
const screenshotService = require('./screenshot/screenshot-service');
// 命令行参数解析器
const { parseCommandLineArgs, dispatchActions } = require('./command-line-handler');

// 日志模块
const log = require('./logger');

/** 文本编辑器文件能力服务，只保存原生对话框授权过的路径。 */
const editorFileService = new EditorFileService();

// 懒加载的模块（避免阻塞启动）
let finalhandler, serveStatic;

// ==================== 路径解析 ====================
// 根据是否打包（isPackaged）决定资源路径：
//   - 打包后：资源在 resources/ 目录，exe 在上级目录
//   - 开发模式：资源在项目根目录

/** 是否已打包为可执行文件 */
const isPackaged = app.isPackaged;

/** Electron 资源目录（打包后为 resources/，开发模式为项目根目录） */
const resourcesPath = process.resourcesPath || app.getAppPath();

/** 
 * 应用根目录
 * - 打包后：exe 所在目录（如 C:\Program Files\Clip\）
 * - 开发模式：项目根目录
 */
const APP_DIR = isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath();

/** 日志输出目录（与应用根目录相同） */
// 固定日志目标到安装目录（exe 所在目录），避免"双击 exe 时 cwd≠安装目录"导致日志丢失；不可写时 logger 自动兜底到 userData
log.init(APP_DIR);
const LOG_DIR = log.logDir;

log.info('=== App Startup ===');
log.info('isPackaged:', isPackaged);
log.info('resourcesPath:', resourcesPath);
log.info('APP_DIR:', APP_DIR);

/**
 * AppUserModelId（AUMID）策略：
 * - 安装版（electron-builder NSIS，默认安装到 %LOCALAPPDATA%\Programs 或 Program Files）：
 *   安装器生成的快捷方式自带 AUMID = appId（com.example.clip-demo），应用必须声明相同 AUMID，
 *   否则快捷方式与运行窗口分组错乱。
 * - 免安装便携版（win-unpacked 目录直跑，或用户自移目录）：
 *   用户手动固定到任务栏的快捷方式 AUMID 为空，Windows 按 exe 路径分组；
 *   此时应用若声明固定 AUMID，运行窗口无法关联到固定图标，会分裂成独立任务栏按钮
 *   （表现为点击固定图标后应用出现在"另一个"新按钮下）。
 *   因此便携版不声明 AUMID，让 Windows 按 exe 路径与固定快捷方式归组。
 */
const APP_USER_MODEL_ID = 'com.example.clip-demo';

/** 是否安装版（NSIS 默认安装目录）；便携版目录不在这些路径下，返回 false */
function isInstalledBuild() {
  if (process.platform !== 'win32' || !isPackaged) return false;
  const exeLower = process.execPath.toLowerCase();
  const installDirs = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs').toLowerCase(),
    (process.env.ProgramFiles || 'C:\\Program Files').toLowerCase(),
    (process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)').toLowerCase()
  ];
  return installDirs.some((dir) => dir && exeLower.startsWith(dir));
}
const installedBuild = isInstalledBuild();
log.info('Installed build (AUMID enabled):', installedBuild);

if (process.platform === 'win32') {
  // 仅安装版声明固定 AUMID；便携版不声明（见上方策略说明）
  if (installedBuild) {
    app.setAppUserModelId(APP_USER_MODEL_ID);
  }

  // 自动创建 Start Menu 快捷方式：安装版附带 AUMID；便携版不附带，
  // 避免"有 AUMID 的快捷方式"与"无 AUMID 的运行窗口"再次分组错乱。
  // 使用 'replace' 每次覆盖，目录移动后目标路径自动跟随新位置。
  try {
    const shortcutDir = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'CutShelter');
    if (!fs.existsSync(shortcutDir)) {
      fs.mkdirSync(shortcutDir, { recursive: true });
    }
    const shortcutPath = path.join(shortcutDir, 'CutShelter.lnk');
    const shortcutOptions = {
      target: process.execPath,
      args: '',
      description: 'CutShelter - AI 驱动的剪藏与内容整理工具',
      icon: process.execPath,
      iconIndex: 0
    };
    if (installedBuild) {
      shortcutOptions.appUserModelId = APP_USER_MODEL_ID;
    }
    shell.writeShortcutLink(shortcutPath, 'replace', shortcutOptions);
    log.info('[Startup] Start Menu shortcut ready (AUMID:', installedBuild ? APP_USER_MODEL_ID : 'none', ')');
  } catch (e) {
    log.warn('[Startup] Failed to create Start Menu shortcut:', e.message);
  }
}

// 将 userData 目录重定向到平台标准路径
// 避免配置文件随 Windows 账户漫游，且更新应用后配置不丢失
const isWin = process.platform === 'win32';
app.setPath('userData', isWin
  ? path.join(os.homedir(), 'AppData', 'Local', 'CutShelter')
  : path.join(os.homedir(), '.cut-shelter'));
log.info('userData:', app.getPath('userData'));

// ==================== 配置管理 ====================
// 配置文件存储在 Electron 的 userData 目录下，与安装目录分离
// 这样卸载重装时不会丢失配置

/** 配置目录（系统用户数据目录下的 config 子目录） */
const CONFIG_DIR = path.join(app.getPath('userData'), 'config');

/** 配置文件路径 */
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// DSH 配套版本单一来源：devDependencies 的 @deepseek-ai/dsh 与插件 @deepseek-ai/dsh-tools 须与此保持一致。
const DSH_VERSION = '0.1.0-rc.7';

/** 默认配置（新用户首次运行时使用） */
const DEFAULT_CONFIG = {
  backendPort: 8081,           // Spring Boot 后端端口
  frontendPort: 3001,           // 前端静态服务器端口
  apiKey: '',                   // DashScope API Key
  activeProvider: 'dashscope',  // 当前 AI 提供商
  deepseekApiKey: '',           // DeepSeek API Key
  deepseekModel: 'deepseek-chat',
  dashscopeModel: 'qwen-plus',
  storagePath: APP_DIR,           // Clip_Bed 父目录，clip-storage/clip-organized/weekly-report 为固定子目录
  configured: false,            // 是否已完成首次配置
  contextMenuRegistered: false,  // 右键菜单是否已注册
  contextMenuPath: '',           // 右键菜单注册时的应用目录（用于目录移动后的路径检测）
  autoStart: false,             // 是否随系统登录自动启动
  // 启动模式：'full' = 完全启动（前后端同步），'frontend-only' = 只启动前端（默认，手动启动后端），'frontend-async-backend' = 前端快速启动，后端异步自动启动
  startupMode: 'frontend-only',
  mailEnabled: false,           // 邮件功能是否启用
  mailHost: '',
  mailPort: 465,
  mailUsername: '',
  mailPassword: '',
  customProviderName: '',        // 自定义 OpenAI 兼容提供商名称
  customBaseUrl: '',             // 自定义 OpenAI 兼容 API 地址
  customApiKey: '',              // 自定义 OpenAI 兼容 API Key
  customModel: '',               // 自定义 OpenAI 兼容模型名称
  // 截图小工具配置
  screenshotEnabled: true,        // 截图工具是否启用
  screenshotShortcut: 'F1',      // 截图快捷键（默认 F1）
  pasteShortcut: 'F2',           // 贴图快捷键（默认 F2）
  screenshotHideMain: true,      // 截图时是否收起主窗口
  screenshotSaveDir: '',         // 截图默认保存目录（空 = 弹保存对话框）
  // ===== DSH Agent 内嵌（Phase 2）=====
  dshAgentEnabled: true,        // 是否启用"AI 干活"面板（打开 Agent 视图时按需拉起 dsh web sidecar）
  dshPort: 3081,                // DSH sidecar 端口（固定 3081，避免与用户手动启动的 3080 冲突；若 3081 已有 DSH 则复用）
  dshBinPath: '',               // DSH CLI 路径（空 = 自动探测：DSH_BIN env → 内置 node_modules → npx 缓存 → npx）
  dshAgentNpxSpec: `@deepseek-ai/dsh@${DSH_VERSION}`, // dsh 安装命令的固定兜底 spec（在线同步失败时的最后手段，可被配置/环境变量覆盖）
  dshSync: { version: '', ts: 0 } // dsh 最新版本在线同步缓存（version + 时间戳，TTL=DSH_SYNC_TTL）
};

// ===== dsh 安装命令在线同步（npm 优先 + GitHub README 兜底）=====
const DEFAULT_DSH_SPEC = `@deepseek-ai/dsh@${DSH_VERSION}`; // 最后的兜底固定版本（未配置 dshAgentNpxSpec 时）
const DSH_SYNC_TTL = 6 * 3600 * 1000;                   // 在线同步缓存 TTL：6 小时
const DSH_SYNC_TIMEOUT = 8000;                          // 单次在线探测超时（ms）
let dshCmdPromise = null;                               // 并发去重：同一次解析只发一个网络请求，其余复用其结果
let dshCmdPromiseForce = false;                         // 记录当前去重任务的 force 标志，避免 force/cache 结果互相串

/**
 * 确保配置目录存在
 * 使用 { recursive: true } 自动创建所有父级目录
 */
function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/**
 * 加载配置文件
 * 如果配置文件不存在或解析失败，返回默认配置
 * 使用展开运算符合并：文件中的值覆盖默认值，缺失的字段保留默认值
 * @returns {Object} 合并后的配置对象
 */
function loadConfig() {
  ensureConfigDir();
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
      return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
    }
  } catch (e) {
    log.error('Load config failed:', e);
  }
  return { ...DEFAULT_CONFIG };
}

/**
 * 保存配置到文件
 * JSON.stringify 第三个参数 2 用于缩进格式化
 * @param {Object} config - 要保存的配置对象
 */
function saveConfig(config) {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

/** 构造跨平台登录项参数，开发模式必须显式传入应用目录。 */
function getAutoStartLoginItemSettings(enabled) {
  const loginItemSettings = {
    openAtLogin: Boolean(enabled),
    path: process.execPath,
    args: isPackaged ? [] : [app.getAppPath()]
  };
  if (process.platform === 'darwin') {
    loginItemSettings.name = 'CutShelter';
  }
  return loginItemSettings;
}

/** 应用系统登录项设置。开发模式下把当前应用路径作为启动参数传给 Electron。 */
function applyAutoStartSetting(enabled) {
  const loginItemSettings = getAutoStartLoginItemSettings(enabled);
  app.setLoginItemSettings(loginItemSettings);
  const settings = app.getLoginItemSettings();
  log.info('[AutoStart] Login item synchronized:', JSON.stringify({
    enabled: settings.openAtLogin,
    path: loginItemSettings.path,
    args: loginItemSettings.args,
    platform: process.platform,
    packaged: isPackaged
  }));
  return settings;
}

// ==================== 进程管理 ====================

/** 后端 Java 进程引用 */
let backendProcess = null;
let backendStarted = false;

/** 主窗口引用 */
let mainWindow = null;

/** 配置窗口引用（单例，同时只能打开一个） */
let configWindow = null;

/** 系统托盘引用 */
let tray = null;

/** 
 * 是否正在退出应用
 * 用于区分"正常退出"和"关闭窗口到托盘"两种场景
 * 设为 true 后，close 事件将不再拦截，允许窗口正常关闭
 */
let isQuitting = false;

/**
 * 主启动流程是否已完成（主窗口已创建、全局快捷键已注册）。
 * 用于 second-instance 竞态防护：启动期间再次唤起应用时，
 * 不重复创建窗口（避免双窗口/双任务栏图标），仅标记"启动后显示"。
 */
let appStartupComplete = false;

/** second-instance 在启动期间到达时置位，主窗口创建后自动显示 */
let pendingShowAfterStart = false;

// 主进程兜底：任何未捕获异常只记录日志，不让应用直接崩溃退出。
// 窗口隐藏/显示、快捷键等 UI 路径的偶发异常不应导致"应用被杀死"。
process.on('uncaughtException', (err) => {
  log.error('[Fatal] Uncaught exception (kept alive):', err);
  log.writeExceptionLog('electron', err.message || String(err), err.stack || '', 'ERROR');
});
process.on('unhandledRejection', (reason) => {
  log.error('[Fatal] Unhandled rejection (kept alive):', reason);
  const msg = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : '';
  log.writeExceptionLog('electron', msg, stack, 'ERROR');
});

/** 
 * 关闭窗口时的行为偏好
 * null  = 未设置，每次关闭都弹窗询问
 * true  = 用户选择了"记住：最小化到托盘"
 * false = 用户选择了"记住：退出程序"
 */
let closeToTray = null;

// 标记主窗口是否因"最小化到托盘"被主动隐藏。
// macOS 上隐藏最后一个窗口会触发应用 activate 事件，从而走 showMainWindow() 把窗口又弹出来；
// 用该标记在托盘隐藏期间屏蔽 activate 的自动唤起（托盘双击/菜单仍可恢复）。
let trayHidden = false;

/**
 * 查找可用的 Java 可执行文件路径
 * 优先级：嵌入式 JRE > 系统 Java
 * 搜索顺序：resources/jre > resources/runtime > APP_DIR/jre > APP_DIR/runtime > 系统 PATH
 * @returns {string} Java 可执行文件路径
 */
function getJavaCommand() {
  const isWin = process.platform === 'win32';
  const javaExe = isWin ? 'java.exe' : 'java';

  // 打包后的嵌入式 JRE 路径（resources 目录由 electron-builder 的 extraResources 配置）
  const embeddedPaths = [
    path.join(resourcesPath, 'jre', 'bin', javaExe),
    path.join(resourcesPath, 'runtime', 'bin', javaExe),
  ];

  // 开发模式下的本地 JRE 路径
  const localPaths = [
    path.join(APP_DIR, 'jre', 'bin', javaExe),
    path.join(APP_DIR, 'runtime', 'bin', javaExe),
  ];

  // 按优先级依次尝试：嵌入式路径优先，本地路径作为备选
  const allPaths = [...embeddedPaths, ...localPaths];

  for (const p of allPaths) {
    if (fs.existsSync(p)) {
      // 验证可执行文件格式是否匹配当前平台（避免将 Windows exe 用于 macOS）
      if (!isExecutableForCurrentPlatform(p)) {
        log.warn(`Skipping incompatible bundled Java for ${process.platform}: ${p}`);
        continue;
      }

      // macOS 打包后 JRE 会丢失可执行权限，需要修复
      if (process.platform === 'darwin') {
        try {
          // 修复 Java 二进制文件权限
          fs.chmodSync(p, 0o755);

          // 递归修复 JRE lib 目录下的 .dylib 和 .so 文件权限
          const libDir = path.dirname(path.dirname(p));
          const libPath = path.join(libDir, 'lib');
          if (fs.existsSync(libPath)) {
            fixPermissionsRecursive(libPath);
          }

          // 修复 lib/server 目录（含 jvm.cfg 等关键文件）
          const serverPath = path.join(libDir, 'lib', 'server');
          if (fs.existsSync(serverPath)) {
            fixPermissionsRecursive(serverPath);
          }
        } catch (e) {
          log.info('Failed to fix JRE permissions:', e.message);
        }
      }

      log.info('Found Java at:', p);
      return p;
    }
  }

  // 未找到嵌入式 JRE，回退到系统安装的 Java
  log.info('No embedded JRE found, using system java');
  return 'java';
}

/**
 * 验证可执行文件格式是否匹配当前操作系统平台
 * 通过读取文件头魔数（magic bytes）判断：
 *   - ELF (0x7F 'E' 'L' 'F')     → Linux
 *   - PE  (0x4D 0x5A, 'MZ')      → Windows
 *   - Mach-O (多种魔数)            → macOS
 * 
 * @param {string} filePath - 可执行文件路径
 * @returns {boolean} 是否匹配当前平台
 */
function isExecutableForCurrentPlatform(filePath) {
  try {
    // 只读取文件前 4 字节作为魔数判断
    const fd = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(4);
    fs.readSync(fd, header, 0, header.length, 0);
    fs.closeSync(fd);

    // ELF 魔数：0x7F 'E' 'L' 'F'
    const isElf = header[0] === 0x7f && header[1] === 0x45 && header[2] === 0x4c && header[3] === 0x46;

    // PE 魔数（Windows）：'MZ'
    const isWindowsExe = header[0] === 0x4d && header[1] === 0x5a;

    // Mach-O 魔数（macOS）：有多种变体，包括 32/64 位、大/小端、通用二进制
    const magic = header.readUInt32BE(0);
    const isMachO = [
      0xfeedface,  // MH_MAGIC (32-bit, big-endian)
      0xfeedfacf,  // MH_MAGIC_64 (64-bit, big-endian)
      0xcefaedfe,  // MH_CIGAM (32-bit, little-endian)
      0xcffaedfe,  // MH_CIGAM_64 (64-bit, little-endian)
      0xcafebabe,  // FAT_MAGIC (universal binary, big-endian)
      0xbebafeca   // FAT_CIGAM (universal binary, little-endian)
    ].includes(magic);

    if (process.platform === 'darwin') return isMachO;
    if (process.platform === 'win32') return isWindowsExe;
    if (process.platform === 'linux') return isElf;
  } catch (e) {
    log.warn(`Could not inspect Java executable ${filePath}: ${e.message}`);
  }
  // 无法判断时默认允许（避免误拦）
  return true;
}

/**
 * 递归修复目录下所有文件的权限（macOS 专用）
 * 针对 JRE 中的 .dylib、.so 和无扩展名文件设置可执行权限
 * 
 * @param {string} dir - 要修复的目录路径
 */
function fixPermissionsRecursive(dir) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // 递归处理子目录
        fixPermissionsRecursive(fullPath);
      } else if (entry.isFile()) {
        // 修复动态库（.dylib、.so）和无扩展名可执行文件
        if (entry.name.endsWith('.dylib') || entry.name.endsWith('.so') || !path.extname(entry.name)) {
          fs.chmodSync(fullPath, 0o755);
        }
      }
    }
  } catch (e) {
    log.info('Failed to fix permissions in', dir, ':', e.message);
  }
}

/**
 * 查找后端 JAR 包路径
 * 按优先级搜索多个可能位置（打包路径 > 开发路径）
 * @returns {string|null} JAR 文件路径，未找到返回 null
 */
function getJarPath() {
  const possiblePaths = [
    // 打包后：resources/backend/ 目录（由 extraResources 配置）
    path.join(resourcesPath, 'backend', 'clip-demo-0.0.1-SNAPSHOT.jar'),
    // 开发模式：APP_DIR 下的 backend 目录
    path.join(APP_DIR, 'backend', 'clip-demo-0.0.1-SNAPSHOT.jar'),
    // 开发模式：APP_DIR 根目录
    path.join(APP_DIR, 'clip-demo-0.0.1-SNAPSHOT.jar'),
    // 开发模式：Maven target 目录
    path.join(app.getAppPath(), 'backend', 'target', 'clip-demo-0.0.1-SNAPSHOT.jar'),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      log.info('Found JAR at:', p);
      return p;
    }
  }
  return null;
}

/**
 * 查找前端静态文件目录
 * 通过检查 index.html 是否存在来判断
 * @returns {string|null} 前端目录路径，未找到返回 null
 */
function getFrontendDir() {
  const possiblePaths = [
    // 打包后：resources/frontend/
    path.join(resourcesPath, 'frontend'),
    // 开发模式：项目根目录下的 frontend/
    path.join(app.getAppPath(), 'frontend'),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(path.join(p, 'index.html'))) {
      log.info('Found frontend at:', p);
      return p;
    }
  }
  return null;
}

/**
 * 同步 model-config.json 到应用配置目录 ~/.cut-shelter/config/
 * 确保初始化界面（config.html）保存的配置与设置页面（settings.html）数据一致
 * 
 * @param {Object} config - 用户配置对象
 */
function syncModelConfigJson(config) {
  try {
    const configDir = path.join(os.homedir(), '.cut-shelter', 'config');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    const modelConfigPath = path.join(configDir, 'model-config.json');
    const modelConfig = {
      activeProvider: config.activeProvider || 'dashscope',
      deepseekApiKey: config.deepseekApiKey || '',
      deepseekModel: config.deepseekModel || 'deepseek-chat',
      dashscopeApiKey: config.apiKey || '',
      dashscopeModel: config.dashscopeModel || 'qwen-plus',
      customProviderName: config.customProviderName || '',
      customBaseUrl: config.customBaseUrl || '',
      customApiKey: config.customApiKey || '',
      customModel: config.customModel || ''
    };
    fs.writeFileSync(modelConfigPath, JSON.stringify(modelConfig, null, 2), 'utf-8');
    log.info('[Sync] model-config.json written to:', modelConfigPath);
  } catch (e) {
    log.error('[Sync] Failed to write model-config.json:', e.message);
  }
}

/**
 * 生成 Spring Boot 的 application.yml 配置内容
 * 根据用户配置动态生成 YAML，支持 AI 提供商切换
 * 
 * @param {Object} config - 用户配置对象
 * @returns {string} YAML 格式的配置字符串
 */
function generateApplicationYml(config) {
  // 兼容旧格式：如果 storagePath 末尾已是 clip-storage，直接使用；否则拼接（新语义：storagePath 为 Clip_Bed 父目录）
  const clipStoragePath = config.storagePath.endsWith('clip-storage') || config.storagePath.endsWith('clip-storage\\')
    ? config.storagePath
    : path.join(config.storagePath, 'clip-storage');
  
  const ymlConfig = {
    spring: {
      application: { name: 'clip-demo' },
      ai: {
        // 通义千问 / DashScope 配置
        dashscope: {
          'api-key': config.apiKey,
          chat: { options: { model: config.dashscopeModel || 'qwen-plus' } }
        },
        // DeepSeek / 自定义 OpenAI 兼容配置
        openai: config.activeProvider === 'custom' ? {
          'api-key': config.customApiKey || '',
          'base-url': config.customBaseUrl || '',
          chat: { options: { model: config.customModel || '' } }
        } : {
          'api-key': config.deepseekApiKey || '',
          'base-url': 'https://api.deepseek.com',
          chat: { options: { model: config.deepseekModel || 'deepseek-chat' } }
        }
      }
    },
    server: { port: config.backendPort },
    clip: {
      storage: { path: clipStoragePath },
      'organized-storage': { path: path.join(config.storagePath, 'clip-organized') },
      'clip-weekly-report': { path: path.join(config.storagePath, 'weekly-report') }
    },
    'product-dev': {
      // 产品概览数据源：TODO/{需求名称}/feature-points.json（打包后由 extraResources 拷贝到 resources/TODO）
      'todo-dir': path.join(resourcesPath, 'TODO')
    }
  };

  return yaml.dump(ymlConfig, { lineWidth: -1, quotingType: '"' });
}

// ==================== 端口进程清理 ====================

/**
 * 强制终止占用指定端口的进程
 * 跨平台实现：
 *   - Windows: netstat 查找 PID → taskkill 强制终止
 *   - macOS/Linux: lsof 查找 PID → SIGKILL 信号终止
 * 
 * 用于启动前清理上一次运行残留的进程
 * 
 * @param {number} port - 要清理的端口号
 */
/** 以 Promise 封装 child_process.exec；命令失败/无匹配也 resolve（调用方自行解析 stdout）。 */
function execAsync(cmd, opts = {}) {
  return new Promise((resolve) => {
    exec(cmd, { encoding: 'utf-8', timeout: opts.timeout || 5000, windowsHide: true }, (err, stdout) => {
      resolve({ err, stdout: stdout || '' });
    });
  });
}

async function killPortProcess(port) {
  const isWin = process.platform === 'win32';
  try {
    if (isWin) {
      // Windows: netstat -ano 输出最后列为 PID
      const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
      const lines = stdout.trim().split('\n');

      // 使用 Set 去重（同一端口可能有多条记录，PID 相同）
      const pids = new Set();
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1]; // netstat 输出最后一列是 PID
        // 排除 PID 0（系统空闲进程）和非数字字符串
        if (pid && /^\d+$/.test(pid) && pid !== '0') {
          pids.add(pid);
        }
      }

      // 逐个终止进程
      for (const pid of pids) {
        await execAsync(`taskkill /F /PID ${pid}`).then(({ err }) => {
          if (err) log.info(`Failed to kill PID ${pid}: ${err.message}`);
          else log.info(`Killed process ${pid} on port ${port}`);
        });
      }
    } else {
      // macOS/Linux: lsof -ti 列出占用端口的 PID（-t 仅输出 PID，-i 按端口过滤）
      const { stdout } = await execAsync(`lsof -ti :${port}`);
      const pids = stdout.trim().split('\n').filter(p => p);
      for (const pid of pids) {
        try {
          // SIGKILL (9) 强制终止，进程无法捕获或忽略
          process.kill(parseInt(pid), 'SIGKILL');
          log.info(`Killed process ${pid} on port ${port}`);
        } catch (e) {
          log.info(`Failed to kill PID ${pid}: ${e.message}`);
        }
      }
    }
  } catch (e) {
    // netstat/findstr/lsof 在无匹配时也会返回非零退出码，正常情况
    log.info(`No process found on port ${port}`);
  }
}

// ==================== 后端进程管理 ====================

/**
 * 启动 Spring Boot 后端进程
 * 流程：
 * 1. 查找 JAR 包和 Java 可执行文件
 * 2. 确保存储目录存在
 * 3. 生成 application.yml 配置文件
 * 4. 以子进程方式启动 Java
 * 5. 轮询端口直到后端就绪（最多等待 120 秒）
 * 
 * @param {Object} config - 用户配置
 * @returns {Promise<boolean>} 启动成功时 resolve
 */
function startBackend(config) {
  return new Promise((resolve, reject) => {
    const jarPath = getJarPath();
    if (!jarPath) {
      reject(new Error('Cannot find backend JAR. Searched:\n- resources/backend/\n- app directory'));
      return;
    }
    const javaCmd = getJavaCommand();

    // 确保 Clip_Bed 父目录及三个固定子目录存在
    if (!fs.existsSync(config.storagePath)) {
      fs.mkdirSync(config.storagePath, { recursive: true });
    }
    const subDirs = ['clip-storage', 'clip-organized', 'weekly-report'];
    subDirs.forEach(sub => {
      const subPath = path.join(config.storagePath, sub);
      if (!fs.existsSync(subPath)) {
        fs.mkdirSync(subPath, { recursive: true });
      }
    });

    // 在 JAR 包同级目录生成 application.yml（Spring Boot 自动读取）
    const jarDir = path.dirname(jarPath);
    const ymlPath = path.join(jarDir, 'application.yml');
    fs.writeFileSync(ymlPath, generateApplicationYml(config), 'utf-8');

    // 后端日志写入文件（追加模式），便于排查问题
    const logFile = path.join(LOG_DIR, 'backend.log');
    const logStream = fs.openSync(logFile, 'a');

    log.info(`Starting backend: ${javaCmd} -jar ${jarPath}`);
    log.info(`Working dir: ${jarDir}`);
    log.info(`Log file: ${logFile}`);

    // 启动 Java 子进程
    // stdio: ['pipe', logStream, logStream] 表示 stdin 管道，stdout/stderr 重定向到日志文件
    // windowsHide: true 避免 Windows 上弹出命令行窗口
    // -Xms64m -Xmx256m: 限制堆内存，减少内存占用
    // -XX:+UseG1GC: 使用 G1 垃圾回收器，启动更快
    backendProcess = spawn(javaCmd, [
      '-Xms64m', '-Xmx256m',
      '-XX:+UseG1GC',
      '-jar', jarPath
    ], {
      cwd: jarDir,
      stdio: ['pipe', logStream, logStream],
      env: { ...process.env },
      windowsHide: true
    });

    let resolved = false;

    // 轮询检测后端端口是否就绪（比解析 stdout 更可靠）
    const startTime = Date.now();
    const pollInterval = setInterval(() => {
      if (resolved) { clearInterval(pollInterval); return; }
      checkPort(config.backendPort).then((open) => {
        if (!resolved && open) {
          resolved = true;
          clearInterval(pollInterval);
          log.info(`Backend started successfully on port ${config.backendPort}`);
          resolve(true);
        } else if (!resolved) {
          // 推送启动进度到渲染进程
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('backend-progress', {
              message: `正在启动后端服务... (${elapsed}秒)`,
              elapsed
            });
          } else if (configWindow && !configWindow.isDestroyed()) {
            configWindow.webContents.send('startup-progress', `正在启动后端服务... (${elapsed}秒)`);
          }
        }
      });
    }, 2000); // 每 2 秒检测一次

    // 超时处理：120 秒（预留 Windows 防火墙弹窗等待时间）
    setTimeout(() => {
      if (!resolved) {
        clearInterval(pollInterval);
        resolved = true;
        reject(new Error('Backend startup timeout (120s). If Windows firewall dialog appeared, please allow access and restart the app.'));
      }
    }, 120000);

    // 监听子进程退出事件（非正常退出时记录日志）
    backendProcess.on('close', (code) => {
      log.info(`Backend exited with code: ${code}`);
      backendProcess = null;
    });

    // 监听子进程启动错误（如找不到 Java、权限不足等）
    backendProcess.on('error', (err) => {
      log.error(`Backend start error: ${err.message}`);
      if (!resolved) {
        resolved = true;
        clearInterval(pollInterval);
        reject(new Error(`Backend failed to start: ${err.message}\n\nJava: ${javaCmd}\nJAR: ${jarPath}\nLog: ${logFile}`));
      }
    });
  });
}

/**
 * 停止后端进程
 * 采用优雅关闭 + 强制终止 + 端口清理的三级策略：
 * 1. 先发送 SIGTERM 请求优雅关闭
 * 2. 3 秒后若未退出则 SIGKILL 强制终止
 * 3. 最后通过端口清理兜底（防止僵尸进程）
 */
function stopBackend() {
  // 预加载配置，避免重复调用 loadConfig
  const config = loadConfig();

  if (backendProcess) {
    log.info('Stopping backend...');

    // 第一步：发送 SIGTERM（优雅关闭，Spring Boot 会执行 shutdown hook）
    try {
      backendProcess.kill('SIGTERM');
    } catch (e) {
      // 进程可能已经退出，忽略错误
    }

    // 第二步：3 秒后强制 SIGKILL（防止进程卡住不退出）
    setTimeout(() => {
      if (backendProcess) {
        try {
          backendProcess.kill('SIGKILL');
        } catch (e) {
          // ignore
        }
        backendProcess = null;
      }
    }, 3000);

    // 1 秒后也通过端口清理兜底
    if (config && config.backendPort) {
      setTimeout(() => killPortProcess(config.backendPort), 1000);
    }
  }

  // 无论 backendProcess 是否存在，都执行端口清理以防僵尸进程
  if (config) {
    killPortProcess(config.backendPort);
    killPortProcess(config.frontendPort);
  }
}

// ==================== DSH Agent sidecar（Phase 2：剪藏内嵌 DSH「Agent 模式」）====================
// 说明：
//   - 固定使用 3081 端口（dshPort），避免与用户手动启动的 DSH（默认 3080）冲突；
//   - 若 3081 已有 DSH 实例在响应，直接复用（不重复拉起，退出时也不杀用户进程）；
//   - 按需启动：前端打开"AI 干活"视图时通过 IPC 'dsh-agent:ensure' 触发；
//   - patch 由本进程运行时生成（指向实际的桥/插件/后端地址），兼容开发与打包两种形态。

let dshAgentProcess = null;
let dshAgentOwned = false;   // true = 进程是本应用拉起的，退出需关闭；false = 复用了已有实例
let dshManagedPort = null;   // 由本应用亲自拉起的 DSH 端口（跨 launcher 退出保留，用于按端口强杀守护进程）
let dshVersionState = { version: null, source: null, at: 0 }; // 最近一次探测到的宿主 DSH 版本与来源（内存态，不持久化）

/** 探测本地端口是否返回 HTTP 200（判断 DSH Web 是否就绪） */
function checkHttpPort(port, pathname = '/') {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: '127.0.0.1', port: port, path: pathname, method: 'GET', timeout: 2500
    }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

/** 探测可用的 Node.js 可执行文件（用于运行 MCP 桥与 DSH；打包应用无独立 node 时回退 PATH） */
function findNodeExe() {
  if (process.env.NODE_EXE && fs.existsSync(process.env.NODE_EXE)) return process.env.NODE_EXE;
  const known = [
    'C:/nvm4w/nodejs/node.exe',
    'C:/Program Files/nodejs/node.exe',
    path.join(os.homedir(), 'scoop', 'apps', 'nodejs', 'current', 'node.exe'),
    // macOS homebrew（Apple Silicon 与 Intel）常见安装位置
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
  ];
  for (const p of known) {
    if (fs.existsSync(p)) return p;
  }
  return 'node';   // PATH 兜底
}

/** 解析出系统 node 所在目录（用于补充 spawn 的 PATH），找不到则返回空字符串。 */
function findNodeDir() {
  const nodeExe = findNodeExe();
  const dir = path.dirname(nodeExe);
  return (nodeExe === 'node' || !fs.existsSync(nodeExe) || dir === '.') ? '' : dir;
}

/**
 * 解析 DSH 数据根目录（DSH_HOME）。回归官方默认语义：
 *   - DSH_HOME 指向数据根，per-profile 子目录 `$DSH_HOME/profiles/<name>`（含 workspace + node_modules）在下；
 *   - 官方默认根为 `~/.dsh`，`dsh web` ≡ `--profile web`；
 *   - 应用拉起（3081）与手动启动（3080）共用同一 DSH_HOME → 共享同一 profile，
 *     插件 / 技能 / 插件市场天然互通（同步由 DSH_HOME 决定，与端口无关）。
 * 可被环境变量 DSH_HOME 显式覆盖。该函数是唯一权威定义，sidecar 启动、技能安装/查询
 * 必须共用它，避免目录不一致导致"装了不生效"。
 */
function resolveDshHome(config) {
  if (process.env.DSH_HOME) return process.env.DSH_HOME;
  void config; // 兼容旧签名；官方默认根与 storagePath 无关
  return path.join(os.homedir(), '.dsh');
}

/** 定位 integrations/dsh 资源目录（含 MCP 桥与插件）：env → 打包资源 → 开发目录 */
function resolveDshPatchDir() {
  const candidates = [
    process.env.DSH_PATCH_DIR || '',
    path.join(process.resourcesPath, 'integrations', 'dsh'),   // 打包形态（extraResources）
    path.join(APP_DIR, 'integrations', 'dsh'),                 // 开发形态
  ];
  for (const dir of candidates) {
    if (dir && fs.existsSync(path.join(dir, 'mcp-server', 'server.mjs'))) return dir;
  }
  return null;
}

/**
 * 运行时如何设置 DSH 端口：自研剪藏集成（mcp 桥 + clip-capture）已 profile 化，
 * 由 ensureCutshelterPlugins 写入 `~/.dsh/profiles/web/cordis.patch.yml`（手动 3080 与
 * 应用 3081 共享）。web 端口不再用 `--patch` 注入 `- id: webserver` —— 那会与 profile
 * 内置 `id: webserver`（dsh-host-webserver）重复注册导致启动失败
 * （duplicate loader entry id）。改为 `dsh web --port <n>` 直接指定，见 startDshAgent。
 */

/**
 * 带超时的 GET 请求（https 走全局 fetch，比 httpGet 支持 TLS；失败返回 null，不抛出）。
 * @param {string} url
 * @returns {Promise<string|null>}
 */
async function fetchTextSafe(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DSH_SYNC_TIMEOUT);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.text();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 从 npm registry 获取 @deepseek-ai/dsh 的 latest 版本号（在线同步首选）。
 * @returns {Promise<string|null>}
 */
async function fetchLatestDshVersionFromNpm() {
  const body = await fetchTextSafe('https://registry.npmjs.org/@deepseek-ai/dsh/latest');
  if (!body) return null;
  try {
    const data = JSON.parse(body);
    const v = data && data.version;
    return (typeof v === 'string' && v.trim()) ? v.trim() : null;
  } catch (e) {
    return null;
  }
}

/**
 * 从 GitHub 官方 README 提取 dsh 启动命令/版本（npm 失败时兜底）。
 * 命中形如 `dsh[@x.y.z] web` 的命令行，返回 { version? , command }；失败返回 null。
 * @returns {Promise<{version?: string, command?: string}|null>}
 */
async function fetchDshHintFromReadme() {
  const body = await fetchTextSafe(
    'https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/main/README.md');
  if (!body) return null;
  const m = body.match(/@deepseek-ai\/dsh(?:@([\w.\-]+))?\s+web/);
  if (!m) {
    // 退而求其次：只要确认官方推荐 npx 免版本命令即可
    if (/@deepseek-ai\/dsh/.test(body)) return { command: 'npx @deepseek-ai/dsh web' };
    return null;
  }
  return {
    version: m[1] || '',
    command: m[1] ? `npx @deepseek-ai/dsh@${m[1]} web` : 'npx @deepseek-ai/dsh web'
  };
}

/** 读取配置里的 dsh 在线同步缓存；TTL 内有效则返回 version，否则返回 null */
function getCachedDshVersion(config) {
  const sync = config && config.dshSync;
  if (!sync || !sync.version) return null;
  if ((Date.now() - (sync.ts || 0)) > DSH_SYNC_TTL) return null;
  return sync.version;
}

/** 把在线解析结果写入配置缓存（成功才写） */
function cacheDshVersion(config, version) {
  if (!version) return;
  try {
    saveConfig({ ...config, dshSync: { version, ts: Date.now() } });
  } catch (e) { /* 缓存失败不影响主流程 */ }
}

/**
 * 装配展示给用户的 dsh 安装命令（在线同步 + 缓存降级）。
 * 优先级：DSH_NPX_SPEC 环境变量 → 配置缓存（TTL 内且非 force）→ npm registry latest
 *          → GitHub README 兜底 → dshAgentNpxSpec/默认固定版本兜底。
 * 全程失败非致命，永不 throw。
 * @param {boolean} [force] 强制联网刷新（「检测/重试」按钮传入 true）
 * @returns {Promise<{command: string, source: string, version?: string}>}
 */
async function getDshInstallCommand(force = false) {
  // 1) 环境变量覆盖（最高优先，研发/调试用）
  const envSpec = process.env.DSH_NPX_SPEC;
  if (envSpec) return { command: `npx -y ${envSpec} web`, source: 'env', version: '' };

  const config = loadConfig();

  // 2) TTL 内缓存命中（非 force 直接复用）
  if (!force) {
    const cached = getCachedDshVersion(config);
    if (cached) return { command: `npx @deepseek-ai/dsh@${cached} web`, source: 'cache', version: cached };
  }

  // 3) 联网解析：并发去重（同参数复用同一个 Promise）
  if (!force && dshCmdPromise) return dshCmdPromise;
  dshCmdPromise = (async () => {
    // npm registry latest 优先
    const v = await fetchLatestDshVersionFromNpm();
    if (v) {
      cacheDshVersion(config, v);
      return { command: `npx @deepseek-ai/dsh@${v} web`, source: 'npm', version: v };
    }
    // GitHub README 兜底
    const r = await fetchDshHintFromReadme();
    if (r && r.version) {
      cacheDshVersion(config, r.version);
      return { command: r.command, source: 'readme', version: r.version };
    }
    // 全部失败 → 配置/默认兜底
    const spec = (config && config.dshAgentNpxSpec) || DEFAULT_DSH_SPEC;
    return { command: `npx ${spec} web`, source: 'default', version: spec.split('@').pop() || '' };
  })().finally(() => { dshCmdPromise = null; dshCmdPromiseForce = false; });
  return dshCmdPromise;
}

// 动态解析真实的 npm 缓存目录（`npm config get cache`），npx 的包缓存位于 `<cache>/_npx`。
// 修复：用户自定义 Node 安装/缓存路径时（如 D:\develop\...\node_cache），
// 原硬编码 %LOCALAPPDATA%\npm-cache 扫不到 npx 缓存里的 dsh，导致误报"未安装"。
let npmCacheDirPromise = null;
function resolveNpmCacheDir() {
  if (npmCacheDirPromise) return npmCacheDirPromise;
  npmCacheDirPromise = new Promise((resolve) => {
    // npm 会给子进程注入 npm_config_cache，优先直接使用，避免 spawn 开销
    if (process.env.npm_config_cache && process.env.npm_config_cache.trim()) {
      resolve(process.env.npm_config_cache.trim());
      return;
    }
    const nodeDir = findNodeDir();
    const npmBin = nodeDir ? path.join(nodeDir, process.platform === 'win32' ? 'npm.cmd' : 'npm') : 'npm';
    execAsync(`"${npmBin}" config get cache`, { timeout: 5000 }).then(({ stdout }) => {
      resolve(String(stdout || '').trim());
    });
  });
  return npmCacheDirPromise;
}

/** 汇总所有可能的 npx 缓存根目录（硬编码兜底 + 动态解析的真实 cache 目录） */
async function resolveNpxRoots() {
  const roots = new Set([
    path.join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx'),
    path.join(os.homedir(), 'AppData', 'Local', 'npm-cache', '_npx'),
    path.join(os.homedir(), '.npm', '_npx'),
    path.join(process.env.APPDATA || '', 'npm-cache', '_npx'),
  ]);
  const cache = await resolveNpmCacheDir();
  if (cache) roots.add(path.join(cache, '_npx'));
  return [...roots];
}

/**
 * 解析 dsh CLI 入口。
 * 返回 { mode: 'node', node, script }（node 运行 dsh bin.js）或 { mode: 'missing', file: 'npx' }。
 * 优先级：配置 dshBinPath（目录或 bin.js）→ 环境变量 DSH_BIN → 内置 node_modules → npx 缓存。
 */
async function resolveDshBin(config) {
  const tryNodeScript = (p) => (p && fs.existsSync(p)) ? { mode: 'node', node: findNodeExe(), script: p } : null;
  // 历史版本 persistDshBinIfNpx 会把 npx 缓存路径固化进 config.dshBinPath（见 isNpxResidue）。
  // 该路径指向固定版本缓存，升级会产生更高版本缓存但旧路径仍存在 → 一直锁旧版。
  // 识别残留后跳过，让 npx 扫描按版本选最高。
  const c0 = (config && config.dshBinPath && !isNpxResidue(config.dshBinPath)) ? config.dshBinPath : '';
  const candidates = [
    c0,
    process.env.DSH_BIN || '',
    path.join(APP_DIR, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    path.join(process.resourcesPath, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    path.join(process.resourcesPath, 'dsh-offline', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  ];
  for (const c of candidates) {
    const hit = tryNodeScript(c);
    if (hit) return hit;
  }
  // npx 缓存扫描（用户可能通过 npx @deepseek-ai/dsh web 运行过，缓存里已有 dsh）
  // 多版本残留时按版本排序取最高，不再"取到哪个算哪个"（旧版本残留会拖住高版本）。
  const npxRoots = await resolveNpxRoots();
  let best = null; // { script, version }
  for (const root of npxRoots) {
    if (!fs.existsSync(root)) continue;
    let dirs = [];
    try { dirs = fs.readdirSync(root); } catch (e) { continue; }
    for (const d of dirs) {
      const p = path.join(root, d, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
      if (!fs.existsSync(p)) continue;
      let v = '0.0.0';
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(p), '..', 'package.json'), 'utf-8'));
        if (pkg && pkg.version) v = pkg.version;
      } catch (e) { /* 读不到版本当 0.0.0 处理，仍可作为候选 */ }
      if (!best || compareVersions(v, best.version) > 0) best = { script: p, version: v };
    }
  }
  if (best) return { mode: 'npx', node: findNodeExe(), script: best.script };
  return { mode: 'missing', file: 'npx' };
}

/**
 * 向渲染进程广播 DSH Agent 启动进度（面板展示"检测/安装/启动/就绪/失败"）。
 * @param {string} state  detecting | installing | starting | ready | failed
 * @param {string} message 面向用户的文案
 * @param {Object} [extra] 附加字段（elapsed 等）
 */
function broadcastDshProgress(state, message, extra = {}) {
  const payload = { state, message, ...extra };
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('dsh-agent-progress', payload);
    }
  } catch (e) { /* ignore */ }
}

/** 清洗子进程输出：去 ANSI 控制符、压缩空白、限长（防止下载进度刷屏/乱码） */
function sanitizeLogLine(raw) {
  return String(raw)
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

/**
 * 识别「profile bundle 缺失」类错误：DSH 内核在但 web 等 UI 组件包未安装/丢失导致秒退。
 * 匹配官方报错 `cannot resolve profile bundle "@pkg" ... run 'dsh plugin --profile <p> install'`
 * @param {string[]} tailLines 完整行（未截断）
 * @returns {{pkg:string, profile:string}|null}
 */
function extractPluginInstallHint(tailLines) {
  for (const line of tailLines || []) {
    const m = line.match(/cannot resolve profile bundle "([^"]+)".*?dsh plugin --profile\s+([A-Za-z0-9_-]+)\s+install/i)
      || line.match(/cannot resolve profile bundle "([^"]+)"/i);
    if (m) return { pkg: m[1], profile: m[2] || 'web' };
  }
  return null;
}

/**
 * 从子进程输出尾段提炼关键报错，并附加可操作的自愈指引。
 * 问题 1 修复：把真实 ERR_MODULE_NOT_FOUND 等透传给面板，而不是让用户干等。
 * @param {string[]} recentTail 最近几行子进程输出（已去 ANSI/空白）
 * @param {{binScript?:string}} opts 可选的 bin.js 绝对路径，用于为 bundle 缺失定制补装命令
 * @returns {string} 面向面板的失败文案
 */
function buildDshFailMessage(recentTail, opts = {}) {
  const hint = extractPluginInstallHint(opts && opts.recentTailFull);
  if (hint) {
    const script = (opts && opts.binScript) || 'dsh';
    // 注意：必须用 `add <pkg>` 而非 `install`。DSH 的 `plugin install` 只走 pnpm 装
    // package.json 的 dependencies；而 bundle 声明在 dsh.profile.bundles 里，install 不处理，
    // 只有 `add` 才会把 bundle 实际装进 profile 的 node_modules（否则照旧秒退）。
    const cmd = `node "${script}" plugin --profile ${hint.profile} add ${hint.pkg}`;
    return `安装/启动 DeepSeek Harness 失败：检测到组件 "${hint.pkg}" 未安装或已丢失（DSH 内核在，但 UI 组件缺失导致秒退）。` +
      `请在项目根目录执行以下命令补装后重试：\n${cmd}\n` +
      `（该命令需联网下载该组件，程序不会替您自动执行）`;
  }
  const keys = ['MODULE_NOT_FOUND', 'ERR_', 'Cannot find module', 'npm error', 'Error:'];
  const hit = [];
  for (const line of recentTail || []) {
    if (keys.some((k) => line.includes(k))) { hit.push(line); if (hit.length >= 3) break; }
  }
  const tail = hit.length ? hit.join(' ｜ ') : ((recentTail || []).slice(-2).join(' ｜ ') || '未知错误');
  return '安装/启动 DeepSeek Harness 失败：' + tail +
    '。可尝试：① 在项目根目录执行 npm i --save-dev @deepseek-ai/dsh 后重试；' +
    '② 清除 npx 缓存 npm cache clean --force 后重试；③ 在设置页配置 DSH CLI 路径（DSH_BIN）后重试。';
}

/** 简易版本比较：数字段逐段比较，预发布（rc/x）视为低于正式版。用于 npx 缓存多版本选最高。 */
function compareVersions(a, b) {
  const A = String(a || '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.]+))?$/);
  const B = String(b || '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.]+))?$/);
  if (!A || !B) return 0;
  for (let i = 1; i <= 3; i++) {
    const na = +A[i], nb = +B[i];
    if (na !== nb) return na > nb ? 1 : -1;
  }
  const pa = A[4], pb = B[4];
  if (!pa && !pb) return 0;
  if (!pa) return 1;
  if (!pb) return -1;
  const ta = +(pa.split('.').pop() || 0), tb = +(pb.split('.').pop() || 0);
  return ta === tb ? 0 : (ta > tb ? 1 : -1);
}

/**
 * 判定 config.dshBinPath 是否为 npx 缓存残留路径（历史版本 persistDshBinIfNpx 固化进去）。
 * 这类残留指向固定版本缓存，升级后旧路径仍存在会锁旧版，且不应视为"用户手动指定"。识别 `_npx` 特征。
 * @param {string} p
 * @returns {boolean}
 */
function isNpxResidue(p) {
  return typeof p === 'string' && p.includes('_npx');
}

/**
 * 探测宿主 DSH 版本（唯一事实来源）。纯 fs 读取 bin.js 所在包的 package.json，零 spawn。
 * @param {Object} bin `resolveDshBin()` 的返回（{ mode, script }）
 * @param {Object} config 应用配置（用于来源标记 config/builtin）
 * @returns {{version: string|null, source: string|null}} source ∈ npx/config/builtin
 */
function detectDshVersion(bin, config) {
  let version = null;
  if (bin && bin.script) {
    try {
      // bin.script 形如 …/node_modules/@deepseek-ai/dsh/lib/bin.js → 上一级即包根
      const pkgPath = path.join(path.dirname(bin.script), '..', 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg && typeof pkg.version === 'string' && pkg.version) version = pkg.version;
      }
    } catch (e) {
      log.warn(`[DSH Agent] detect dsh version failed: ${e.message}`);
    }
  }
  let source = null;
  if (bin && bin.mode === 'npx') source = 'npx';
  // bin 来自内置(node_modules)时 config.dshBinPath 只是残留(_npx)，不视为"用户手动指定"
  else if (config && config.dshBinPath && !isNpxResidue(config.dshBinPath)) source = 'config';
  else source = 'builtin';
  return { version, source };
}

/**
 * 复用运行中 DSH 实例时，从实例 HTTP 尽力读取版本（best-effort，拿不到返回 ok:false）。
 * 兼容纯文本版本号与 {"version":"x"} 两种响应形态。
 */
function fetchRuntimeDshVersion(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/version', timeout: 1500 }, (res) => {
      let buf = '';
      res.setEncoding('utf-8');
      res.on('data', (d) => { buf += d; });
      res.on('end', () => {
        const txt = (buf || '').trim();
        let v = null;
        if (txt.startsWith('{')) {
          try { v = JSON.parse(txt).version || null; } catch (e) { v = null; }
        } else if (txt) {
          v = txt;
        }
        resolve(v ? { version: String(v), ok: true } : { version: null, ok: false });
      });
    });
    req.on('error', () => resolve({ version: null, ok: false }));
    req.on('timeout', () => { req.destroy(); resolve({ version: null, ok: false }); });
  });
}

/**
 * 按需启动（或复用）DSH Web sidecar，供"AI 干活"面板 iframe 内嵌。
 * 若本机没有 dsh CLI（无缓存/无内置），自动为用户执行 npx 安装（联网下载），
 * 并通过 broadcastDshProgress 实时反馈"检测 → 安装 → 启动 → 就绪/失败"。
 * @param {Object} config 应用配置
 * @returns {Promise<{success: boolean, reused: boolean, port: number, message?: string}>}
 */
async function startDshAgent(config) {
  const primaryPort = (config && config.dshPort) || 3081;
  // 单实例复用优先：共享同一 profile 后，同 profile 双开会并发写 cordis.patch.yml / pnpm 锁。
  // 因而先检测官方默认端口 3080（用户手动启动的实例）与主端口 3081，任一在响应即复用打开，不再双开。
  const probePorts = [3080, primaryPort].filter((p, i, a) => p && a.indexOf(p) === i);
  let reused = null;
  for (const p of probePorts) {
    broadcastDshProgress('detecting', `检查 127.0.0.1:${p}…`);
    if (await checkHttpPort(p)) { reused = { port: p }; break; }
  }
  if (reused) {
    dshAgentOwned = false;
    const port = reused.port;
    log.info(`[DSH Agent] Reusing existing DSH instance on port ${port}`);
    // 复用运行中实例：dock 版本 ≠ 磁盘版本，尽力从实例 HTTP 读版本（best-effort，拿不到标"运行中（版本未知）"）。
    const rt = await fetchRuntimeDshVersion(port);
    // runtime HTTP 读不到时，回退到本地磁盘解析版本（best-effort，消除「已复用…（版本未知）」）。
    // 磁盘版本用于 3081（应用内置/npx 缓存）场景是准确的；3080 手动实例场景仅作参考。
    let ver = rt.ok ? rt.version : null;
    let src = rt.ok ? 'runtime' : null;
    if (!ver) {
      try {
        const disk = detectDshVersion(await resolveDshBin(config), config);
        if (disk && disk.version) { ver = disk.version; src = disk.source; }
      } catch (e) { /* 磁盘解析失败则保持未知 */ }
    }
    dshVersionState = { version: ver, source: src, at: Date.now() };
    const mismatch = (ver && ver !== DSH_VERSION) ? { host: ver, builtin: DSH_VERSION } : null;
    if (ver) {
      log.info(`[DSH Agent] DSH 复用实例版本: v${ver}（来源 ${src}）`);
      if (mismatch) log.warn(`[DSH Agent] 复用实例 v${ver} ≠ 内置支持版本 v${DSH_VERSION}（仅提示，不阻断）`);
    }
    broadcastDshProgress('ready',
      `已复用现有 DSH 实例（端口 ${port}）${ver ? ' · v' + ver : '（版本未知）'}`,
      { dshVersion: ver, dshMismatch: mismatch });
    // 复用手动实例时，同样收紧自研集成（profile 化），保证共享 profile 具备剪藏工具。
    try {
      const reusedPatchDir = resolveDshPatchDir();
      if (reusedPatchDir) ensureCutshelterPlugins(reusedPatchDir);
    } catch (e) { log.warn(`[DSH Agent] profile 化自研集成失败(复用): ${e.message}`); }
    return { success: true, reused: true, port, version: ver, source: src };
  }

  // 2) 定位 integrations/dsh 资源目录，并生成运行时 patch
  const patchDir = resolveDshPatchDir();
  if (!patchDir) {
    broadcastDshProgress('failed', 'integrations/dsh 资源未找到（开发需在仓库根目录，打包需 extraResources 内置）');
    return { success: false, message: 'integrations/dsh 资源未找到（开发需在仓库根目录，打包需 extraResources 内置）' };
  }

  // 3) 解析 dsh CLI：未安装本地 dsh 时不再自动联网安装，改为提示用户自助安装并检测解锁
  const bin = await resolveDshBin(config);
  log.info(`[DSH Agent] resolved dsh bin: mode=${bin.mode}${bin.script ? ' script=' + bin.script : ''}`);
  // 仅 mode:missing（无任何本地/缓存 dsh）才提示自助安装；npx 缓存命中（mode:npx）视为已安装，直接启动
  if (bin.mode === 'missing') {
    const { command: DSH_INSTALL_CMD } = await getDshInstallCommand(false);
    broadcastDshProgress('need-install',
      '未检测到 DeepSeek Harness，请先自行安装后再重试。安装命令：' + DSH_INSTALL_CMD);
    return {
      success: false, needInstall: true, installed: false, port: primaryPort,
      command: DSH_INSTALL_CMD,
      message: '未检测到 DeepSeek Harness（DSH）。请按说明自助安装后重试。'
    };
  }
  broadcastDshProgress('starting',
    `正在启动 DeepSeek Harness（${path.basename(bin.script)}）…`, { elapsed: 0 });

  // npxMode 恒为 false：首次安装已改为「提示用户自助安装」（need-install 状态），不再代为联网下载。
  // 此标志及其下方 npxMode 分支是旧自动安装路径的残留，保留以维持可读性与可回退性（勿当 bug 删除）。
  const npxMode = false;
  // 用 web 的 --port 设置端口，避免 patch 注入 `- id: webserver` 与 profile 内置
  // id: webserver（dsh-host-webserver）重复导致 duplicate loader entry 崩溃。
  // DSH ≥ 0.1.1 的 `dsh web` 默认会拉起系统默认浏览器（openBrowser 默认 true）；CutShelter
  // 用 iframe 内嵌面板，无需该动作，按版本条件传 --no-open（0.1.0-rc.x 无此 flag，硬传会报 unknown option）。
  let supportsNoOpen = false;
  try {
    const det = detectDshVersion(bin, config);
    supportsNoOpen = !!det.version && compareVersions(det.version, '0.1.0') > 0;
  } catch (e) { /* 版本探测失败时保守不加 --no-open，避免老版本报 unknown option */ }
  const args = ['web', ...(supportsNoOpen ? ['--no-open'] : []), '--port', String(primaryPort)];
  const spawnCmd = bin.node;
  log.info(`[DSH Agent] Starting: ${spawnCmd} ${bin.script} ${args.join(' ')}`);

  // DSH_HOME 回归官方默认根（~/.dsh），与应用/手动启动共享同一 profile（插件/技能/市场互通）。
  // 与其他 DSH 相关入口共享 resolveDshHome()，保证技能安装/查询与运行时目录一致。
  const dshHome = resolveDshHome(config);
  try { fs.mkdirSync(dshHome, { recursive: true }); } catch (e) { /* 忽略，兜底让 DSH 走默认 ~/.dsh */ }

  dshAgentProcess = spawn(spawnCmd, npxMode ? args : [bin.script, ...args], {
    shell: npxMode,
    cwd: APP_DIR,
    env: {
      ...process.env,
      // 将系统 node 所在目录补进 PATH，保证打包 GUI 应用（PATH 不含 /opt/homebrew/bin 等）
      // 内部再 spawn 的 node / npx / MCP 桥可被找到。
      PATH: [findNodeDir(), process.env.PATH, '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin']
        .filter(Boolean).join(path.delimiter),
      DSH_HOME: dshHome,
      CUTSHELTER_BASE_URL: `http://127.0.0.1:${(config && config.backendPort) || 8081}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // 子进程输出 → 日志 + 节流转发给面板（安装/启动期展示真实进度）
  let lastFwdAt = 0;
  let processExited = false;        // 子进程已退出/启动失败 → 用于立即中止就绪轮询（修复无限"正在安装"）
  let exitCode = null;              // 子进程退出码，失败时纳入文案便于定位
  const recentTail = [];            // 最近输出尾段，供失败时按关键字提炼真实报错
  const recentTailFull = [];        // 完整行（不做 140 字符截断），供「profile bundle 缺失」等长错误精确识别
  const TAIL_LIMIT = 30;
  const forward = (kind) => (d) => {
    const line = sanitizeLogLine(d);
    if (!line) return;
    recentTail.push(line);                       // 记录尾段（含下载进度等噪音，失败时再提炼）
    if (recentTail.length > TAIL_LIMIT) recentTail.shift();
    const full = String(d).replace(/\u001b\[[0-9;]*m/g, '').replace(/[\r\n]+/g, ' ').trim();
    if (full) { recentTailFull.push(full); if (recentTailFull.length > TAIL_LIMIT) recentTailFull.shift(); }
    if (kind === 'stdout') log.info(`[DSH Agent] ${line}`); else log.warn(`[DSH Agent] ${line}`);
    const now = Date.now();
    if (now - lastFwdAt > 2500) {
      lastFwdAt = now;
      broadcastDshProgress(npxMode ? 'installing' : 'starting',
        (npxMode ? '正在安装：' : '正在启动：') + line,
        { elapsed: Math.round((now - startTime) / 1000) });
    }
  };
  const startTime = Date.now();
  dshAgentProcess.stdout.on('data', forward('stdout'));
  dshAgentProcess.stderr.on('data', forward('stderr'));
  // 子进程退出/启动失败仅标记，不在此 broadcast —— 下方就绪轮询会立刻感知并透传真实报错
  dshAgentProcess.on('close', (code) => {
    log.info(`[DSH Agent] exited with code ${code}`);
    processExited = true;
    exitCode = code;
    if (dshAgentProcess) { dshAgentProcess = null; dshAgentOwned = false; }
  });
  dshAgentProcess.on('error', (err) => {
    log.error(`[DSH Agent] start error: ${err.message}`);
    processExited = true;
    recentTail.push('start error: ' + err.message);
    if (dshAgentProcess) { dshAgentProcess = null; dshAgentOwned = false; }
  });
  dshAgentOwned = true;
  dshManagedPort = primaryPort;

  // 4) 轮询等待就绪（npx 安装路径给更宽裕的超时；每 5 秒刷新等待文案）
  const timeoutMs = npxMode ? 300000 : 90000;
  const deadline = Date.now() + timeoutMs;
  let lastTickAt = 0;
  // 统一失败出口：日志 + 透传真实报错 + 回收进程（防重复广播）
  let failOnce = false;
  const failNow = (message) => {
    if (failOnce) return;
    failOnce = true;
    log.error(`[DSH Agent] ${message}`);
    broadcastDshProgress('failed', message);
    if (dshAgentProcess && dshAgentOwned) {
      try { dshAgentProcess.kill('SIGKILL'); } catch (e) { /* ignore */ }
    }
    dshAgentProcess = null;
    dshAgentOwned = false;
    dshManagedPort = null;
  };
  while (Date.now() < deadline) {
    // 子进程已退出：端口未就绪 → 立即失败并透传真实报错（不再空转到超时）；
    // 若已就绪（如父进程退出但守护子进程驻留）则回落就绪分支。
    if (processExited && !(await checkHttpPort(primaryPort))) {
      const msg = buildDshFailMessage(recentTail, { binScript: bin.script, recentTailFull }) + (exitCode != null ? `（退出码 ${exitCode}）` : '');
      log.warn(`[DSH Agent] tail: ${recentTail.slice(-15).join(' ｜ ')}`);
      failNow(msg);
      return { success: false, message: msg };
    }
    if (await checkHttpPort(primaryPort)) {
      log.info(`[DSH Agent] ready at http://127.0.0.1:${primaryPort}`);
      // 就绪即探测并落内存态版本，作为「下次启动自动对齐」的事实来源。
      const det = detectDshVersion(bin, config);
      const prev = dshVersionState.version;
      dshVersionState = { version: det.version, source: det.source, at: Date.now() };
      const mismatch = (det.version && det.version !== DSH_VERSION) ? { host: det.version, builtin: DSH_VERSION } : null;
      if (det.version) {
        if (prev && prev !== det.version) log.info(`[DSH Agent] 宿主 DSH 版本对齐: ${prev} → ${det.version}（来源 ${det.source}）`);
        else log.info(`[DSH Agent] 宿主 DSH 版本: v${det.version}（来源 ${det.source}）`);
        if (mismatch) log.warn(`[DSH Agent] 宿主 v${det.version} ≠ 内置支持版本 v${DSH_VERSION}（仅提示，不阻断）`);
      }
      const readyText = `DeepSeek Harness 已就绪（端口 ${primaryPort}）${det.version ? ' · v' + det.version : ''}`;
      broadcastDshProgress('ready', readyText, { dshVersion: det.version, dshMismatch: mismatch });
      // 就绪后异步收紧：自研集成 profile 化（copy）+ 预装 dshmarket。两者均不阻塞 ready 返回，
      // 失败只记录日志/广播 warning（不阻断 DSH 使用）。
      try {
        ensureCutshelterPlugins(patchDir);
      } catch (e) { log.warn(`[DSH Agent] profile 化自研集成失败: ${e.message}`); }
      if (npxMode) {
        // npx 内存实例结束即失效，跳过 market 预装
        log.info('[DSH Agent] skip ensureDshMarket (npx 临时实例)');
      } else {
        ensureDshMarket(bin)
          .then((r) => log.info(`[DSH Agent] ensureDshMarket: installed=${r.installed}${r.err ? ' err=' + r.err : ''}`))
          .catch((e) => log.warn(`[DSH Agent] ensureDshMarket error: ${e.message}`));
      }
      return { success: true, reused: false, port: primaryPort, version: det.version, source: det.source };
    }
    const now = Date.now();
    if (now - lastTickAt > 5000) {
      lastTickAt = now;
      const elapsed = Math.round((now - startTime) / 1000);
      broadcastDshProgress(npxMode ? 'installing' : 'starting',
        npxMode
          ? `正在安装 DeepSeek Harness… 已等待 ${elapsed} 秒（首次下载约 1–5 分钟）`
          : `正在启动 DeepSeek Harness… 已等待 ${elapsed} 秒`,
        { elapsed });
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  failNow(buildDshFailMessage(recentTail) + `（启动超时 ${Math.round(timeoutMs / 1000)} 秒）`);
  return { success: false, message: `DSH 启动超时（${Math.round(timeoutMs / 1000)} 秒）：${buildDshFailMessage(recentTail)}` };
}

/**
 * 取消正在进行的 DSH 安装/启动（仅本应用拉起的进程）。
 */
function cancelDshAgent() {
  if (dshAgentProcess && dshAgentOwned) {
    log.info('[DSH Agent] cancelled by user');
    try { dshAgentProcess.kill('SIGTERM'); } catch (e) { /* ignore */ }
    setTimeout(() => {
      if (dshAgentProcess) {
        try { dshAgentProcess.kill('SIGKILL'); } catch (e) { /* ignore */ }
        dshAgentProcess = null;
        dshAgentOwned = false;
      }
    }, 2000);
    broadcastDshProgress('failed', '已取消');
    return true;
  }
  return false;
}

/**
 * 解析 DSH 指定 profile 的目录（`$DSH_HOME/profiles/<name>`）。
 * profile 是 DSH 插件/技能/配置的隔离单元；统一 `~/.dsh` 后，web profile 为两侧共享。
 * @param {string} [profile] profile 名，默认 'web'
 * @returns {string} profile 绝对路径（可能尚不存在，需调用方 mkdir）
 */
function getDshProfileDir(profile = 'web') {
  return path.join(resolveDshHome(), 'profiles', profile);
}

/**
 * 通用插件确保底座：幂等地在指定 profile 中启用一个 npm 插件，并为后续扩展复用。
 * 判定依据：读取 profile 的 `dsh.profile.bundles`（cordis 插件清单）是否已包含目标 spec 的包名。
 * 未安装才执行 `dsh plugin --profile <name> add <spec>`。
 * @param {Object} bin  resolveDshBin() 返回的可执行入口（{node, script}）
 * @param {string} spec npm 插件包名或 file 路径
 * @param {Object} [opts] { profile?: string, timeout?: number }
 * @returns {Promise<{installed: boolean, existing: boolean, spec: string, err?: string}>}
 */
async function ensureDshPlugin(bin, spec, opts = {}) {
  const profile = opts.profile || 'web';
  const dshHome = resolveDshHome();
  const result = { installed: false, existing: false, spec };
  try {
    // 1) 已安装判定：profile 的 package.json 中 dsh.profile.bundles 是否含同名插件
    const pkgFile = path.join(getDshProfileDir(profile), 'package.json');
    const pkgName = /^(@?[^@]+)@/.test(spec)
      ? spec.match(/^(@?[^@]+)@/)[1]
      : (spec.startsWith('file:')
        ? path.basename(spec).replace(/\.m?js$/, '')
        : spec.split('@').pop() || spec);
    if (fs.existsSync(pkgFile)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf-8'));
        const bundles = (pkg && pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles) || [];
        if (bundles.some((b) => String(b).includes(pkgName))) {
          result.existing = true;
          result.installed = true;
          return result;
        }
      } catch (e) { /* 解析失败按未安装处理 */ }
    }
    // 2) 未安装 → 执行安装（走官方 `dsh plugin add` 通道，与市场安装同源）
    const cmd = [
      '"' + (bin.script || bin.file || 'dsh') + '"',
      'plugin', '--profile', profile, 'add', spec,
    ].join(' ');
    log.info(`[DSH] ensureDshPlugin: ${cmd}`);
    const { err, stdout } = await execAsync(cmd, { timeout: opts.timeout || 120000 });
    const out = sanitizeLogLine(stdout);
    if (err) {
      log.warn(`[DSH] ensureDshPlugin failed: ${err.message} ${out ? '(' + out + ')' : ''}`);
      result.err = (err.message || '') + (out ? ' ' + out : '');
    } else {
      result.installed = true;
      log.info(`[DSH] ensureDshPlugin installed: ${spec}`);
    }
  } catch (e) {
    log.warn(`[DSH] ensureDshPlugin error: ${e.message}`);
    result.err = e.message;
  }
  return result;
}

/**
 * 预装 dsh-market 插件市场应用（激活即止，不硬编码/不依赖其内部路由 UI）。
 * 幂等：已含 dshmarket 则跳过；失败仅记录日志并广播 warning，不阻断 DSH 启动。
 * @returns {Promise<{installed: boolean, err?: string}>}
 */
async function ensureDshMarket(bin) {
  const res = await ensureDshPlugin(bin, 'dshmarket', { profile: 'web', timeout: 180000 });
  if (res.existing) log.info('[DSH] dshmarket already installed.');
  if (!res.installed) {
    broadcastDshProgress('warning', '插市场（dshmarket）预装失败，可在 DSH 的 Settings → Plugin Market 手动安装');
  }
  return { installed: res.installed, err: res.err };
}

/**
 * 递归拷贝目录到目标。
 * 会完整拷贝（含 node_modules），但用「已访问 realpath」集合防止目录循环（源 node_modules 深层
 * 嵌套/自引用时，fs.cpSync 会触发本机栈溢出 0xC0000409，Windows 实测；故手写递归 + 防循环）。
 * 符号链接拷贝链接本身（不跟随目标），避免跟随引出的循环。
 * @param {string} srcDir 源目录
 * @param {string} destDir 目标目录
 * @param {Set<string>} [visited] 已访问的真实目录路径集合（防循环）
 */
function copyDir(srcDir, destDir, visited) {
  if (!fs.existsSync(srcDir)) return;
  visited = visited || new Set();
  let real;
  try { real = fs.realpathSync(srcDir); } catch (e) { return; }
  if (visited.has(real)) return; // 循环防护
  visited.add(real);
  fs.mkdirSync(destDir, { recursive: true });
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, ent.name);
    const d = path.join(destDir, ent.name);
    if (ent.isSymbolicLink()) {
      try { fs.symlinkSync(fs.readlinkSync(s), d); } catch (e) { /* 忽略单个链接失败 */ }
      continue;
    }
    if (ent.isDirectory()) copyDir(s, d, visited);
    else {
      try { fs.copyFileSync(s, d); } catch (e) { /* 忽略单个文件失败 */ }
    }
  }
}

/**
 * 自研剪藏集成 profile 化：把 MCP 桥 + clip-capture 插件拷贝到 `~/.dsh/plugins/cutshelter/` 稳定路径，
 * 并写进 profile patch（cordis.patch.yml）。使手动启动的 3080 实例同样具备剪藏工具，两入口等价。
 * 幂等 copy：以 `$target/.cutshelter-version` 标记比对源版本，源变化才重拷，避免每次启动全量复制。
 * @param {string} patchDir integrations/dsh 资源目录（env → resourcesPath → 开发目录）
 */
function ensureCutshelterPlugins(patchDir) {
  const dshHome = resolveDshHome();
  const psDir = path.join(dshHome, 'plugins', 'cutshelter');
  const vFile = path.join(psDir, '.cutshelter-version');
  const src = (srcPath) => path.join(patchDir, srcPath);
  try {
    // 源的 mcp 桥与插件目录
    const mcpSrc = src('mcp-server');
    const clipSrc = path.join(patchDir, 'plugins', 'clip-capture');
    const haveSrc = fs.existsSync(mcpSrc) && fs.existsSync(clipSrc);
    // 版本标记需同时覆盖 mcp 桥与 clip-capture：此前仅用 mcp-server/package.json，
    // 当只更新 clip-capture（如 fp012 增加 turn/end 自动归档）时标记不变 → 跳过重拷，
    // 导致 ~/.dsh/plugins/cutshelter/clip-capture 残留旧版、自动归档失效。现把 index.mjs 一并纳入。
    const clipIndexPath = path.join(clipSrc, 'index.mjs');
    let marker = haveSrc ? fs.readFileSync(path.join(mcpSrc, 'package.json'), 'utf-8') : '';
    if (haveSrc && fs.existsSync(clipIndexPath)) {
      marker += '\n##clip-capture##\n' + fs.readFileSync(clipIndexPath, 'utf-8');
    }
    // 如果需要重拷（标记缺失/不匹配/源改动）
    let needsCopy = true;
    if (haveSrc && fs.existsSync(vFile)) {
      try { needsCopy = fs.readFileSync(vFile, 'utf-8') !== marker; } catch (e) { needsCopy = true; }
    }
    if (haveSrc && needsCopy) {
      fs.rmSync(psDir, { recursive: true, force: true });
      fs.mkdirSync(psDir, { recursive: true });
      copyDir(mcpSrc, path.join(psDir, 'mcp-server'));
      copyDir(clipSrc, path.join(psDir, 'clip-capture'));
      fs.writeFileSync(vFile, marker, 'utf-8');
      log.info(`[DSH] cutshelter plugins synced to ${psDir}`);
    }
    // 写 profile patch（upsert 一条含 mcp 桥 + clip-capture 的 insert 数组项，以 id 为键幂等）。
    // 关键：cordis.patch.yml 是「顶级 YAML 数组」——初始为 `[]`。若为空数组需「替换」而非 append，
    // 否则会得到 `[]` 后跟新数组项的双根非法 YAML。
    const profileDir = getDshProfileDir('web');
    fs.mkdirSync(profileDir, { recursive: true });
    const patchFile = path.join(profileDir, 'cordis.patch.yml');
    let text = '';
    if (fs.existsSync(patchFile)) text = fs.readFileSync(patchFile, 'utf-8');
    const nodeExe = findNodeExe().replace(/\\/g, '/');
    const bridge = path.join(psDir, 'mcp-server', 'server.mjs').replace(/\\/g, '/');
    const backend = `http://127.0.0.1:${(loadConfig().backendPort) || 8081}`;
    const pluginUrl = pathToFileURL(path.join(psDir, 'clip-capture', 'index.mjs')).href;
    const cutBlock = [
      '# --- managed by CutShelter (auto) — do not edit ---',
      '- insert:',
      '    - id: mcp-cut-shelter',
      "      name: '@deepseek-ai/dsh-mcp-client'",
      '      config:',
      '        serverName: cut_shelter',
      '        transport: stdio',
      `        command: '${nodeExe}'`,
      '        args:',
      `          - '${bridge}'`,
      '        env:',
      `          CUTSHELTER_BASE_URL: ${backend}`,
      "          CUTSHELTER_TIMEOUT_MS: '60000'",
      '    - id: clip-capture',
      `      name: '${pluginUrl}'`,
      '      config:',
      `        baseUrl: ${backend}`,
      '# --- /managed by CutShelter ---',
      '',
    ].join('\n');
    if (!text.includes('managed by CutShelter (auto)')) {
      // 空数组（默认 `[]` 或其带注释形式）→ 整体替换；否则在末尾追加数组项
      const isEmptyArr = /^\s*(#.*\n)*\s*\[\s*\]\s*$/.test(text);
      fs.writeFileSync(patchFile, isEmptyArr ? cutBlock : text + '\n' + cutBlock, 'utf-8');
      log.info(`[DSH] profile patch updated: ${patchFile} (${isEmptyArr ? 'replaced empty' : 'appended'})`);
    }
  } catch (e) {
    log.warn(`[DSH] ensureCutshelterPlugins failed: ${e.message}`);
  } finally {
    fs.mkdirSync(psDir, { recursive: true }); // 保证目录存在
  }
}

/** 停止本应用拉起的 DSH sidecar（复用实例不杀） */
function stopDshAgent() {
  const config = loadConfig();
  const port = (config && config.dshPort) || 3081;

  // 1) 若持有直接子进程句柄，先尝试终止（DSH 为单进程运行时的兜底）
  if (dshAgentProcess) {
    log.info('[DSH Agent] stopping child process...');
    try { dshAgentProcess.kill('SIGTERM'); } catch (e) { /* ignore */ }
    try {
      const p = dshAgentProcess;
      setTimeout(() => { try { p && p.kill('SIGKILL'); } catch (e2) { /* ignore */ } }, 2000);
    } catch (e) { /* ignore */ }
  }

  // 2) 仅当端口是本应用亲自拉起的实例，才按端口强杀实际占用进程。
  //    DSH web 常派生子进程/守护进程驻留（launcher 退出后仍在监听），仅杀父进程无法释放端口。
  //    跨平台 killPortProcess 用 lsof/netstat 定位监听进程，可靠释放端口。
  const isManaged = dshManagedPort != null && dshManagedPort === port;
  if (isManaged) {
    log.info(`[DSH Agent] stopping managed DSH on port ${port}`);
    killPortProcess(port);
    broadcastDshProgress('stopped', `已停止 DSH（端口 ${port}）`);
  }

  dshManagedPort = null;
  dshAgentProcess = null;
  dshAgentOwned = false;
}

/**
 * 检测指定端口是否可访问（HTTP 200 响应）
 * 向后端 API 发送 GET 请求，根据响应状态码判断服务是否就绪
 * 
 * @param {number} port - 要检测的端口号
 * @returns {Promise<boolean>} 端口是否可访问
 */
function checkPort(port) {
  return new Promise((resolve) => {
    // 先尝试 HTTP GET /health（Spring Boot 完全就绪后返回 200）
    const req = http.request({
      hostname: '127.0.0.1', port: port,
      path: '/health', method: 'GET', timeout: 3000
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(true);
          return;
        }
        // HTTP 返回了非 200（如 404），说明端口已监听但 /health 可能不存在
        // 回退到 TCP 连接检测：只要端口能通就算就绪
        log.info(`[Startup] /health returned ${res.statusCode}, falling back to TCP check`);
        resolve(true);  // 端口已监听 = 服务已启动
      });
    });
    req.on('error', (err) => {
      // 连接被拒绝或超时：尝试 TCP socket 直连
      const net = require('net');
      const sock = new net.Socket();
      sock.setTimeout(2000);
      sock.on('connect', () => {
        sock.destroy();
        log.info(`[Startup] TCP port ${port} is open (server starting)`);
        resolve(true);
      });
      sock.on('error', () => resolve(false));
      sock.on('timeout', () => { sock.destroy(); resolve(false); });
      sock.connect(port, '127.0.0.1');
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

/**
 * 向后端 API 发送 HTTP 请求
 * 统一的请求封装，自动处理 JSON 序列化/反序列化
 * 
 * @param {Object} config - 用户配置（含后端端口）
 * @param {string} method - HTTP 方法（GET/POST/PUT/DELETE）
 * @param {string} endpoint - API 路径（如 /api/clip/list）
 * @param {Object} [payload] - 请求体（POST 时使用，自动 JSON 序列化）
 * @returns {Promise<Object>} 响应数据（JSON 解析后或原始文本）
 */
function requestBackend(config, method, endpoint, payload) {
  return new Promise((resolve, reject) => {
    // 请求体序列化（仅当有 payload 时）
    const body = payload ? JSON.stringify(payload) : null;

    const req = http.request({
      hostname: '127.0.0.1',
      port: config.backendPort,
      path: endpoint,
      method,
      timeout: 5000,
      // 有 body 时设置 Content-Type 和 Content-Length 头
      headers: body ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      } : {}
    }, (res) => {
      // 收集响应体（分块接收）
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        // 尝试 JSON 解析，失败则保留原始文本
        let parsed = null;
        if (raw) {
          try {
            parsed = JSON.parse(raw);
          } catch (error) {
            parsed = raw;
          }
        }

        // 2xx 状态码视为成功
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(parsed);
          return;
        }

        // 非 2xx 状态码：构造错误信息
        reject(new Error(typeof parsed === 'string' ? parsed : JSON.stringify(parsed || { status: res.statusCode })));
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('backend request timeout'));
    });

    // 写入请求体（如果有）
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

// ==================== 前端静态服务器 ====================

/** 前端 HTTP 服务器实例 */
let frontendServer = null;

/**
 * 启动前端静态文件服务器
 * 使用 serve-static 托管前端构建产物，同时支持 SPA 路由回退
 * 
 * @param {Object} config - 用户配置（含前端端口）
 * @returns {Promise<boolean>} 启动成功时 resolve
 */
function startFrontendServer(config) {
  return new Promise((resolve, reject) => {
    const frontendDir = getFrontendDir();
    if (!frontendDir) {
      reject(new Error('Cannot find frontend files (index.html). Searched:\n- resources/frontend/\n- app directory'));
      return;
    }

    // 懒加载依赖模块（仅在首次启动时 require）
    if (!finalhandler) finalhandler = require('finalhandler');
    if (!serveStatic) serveStatic = require('serve-static');

    // 创建静态文件服务中间件
    // fallthrough: false 表示文件不存在时触发 onerror 回调（而非交给 next）
    const serve = serveStatic(frontendDir, {
      index: ['index.html'],
      fallthrough: false,
      // HTML 入口禁用缓存，保证 web 端（外部浏览器）刷新即拿到最新前端；
      // 静态资源（js/css/img）仍由协商缓存控制，避免每次全量重拉
      setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
      }
    });

    const server = http.createServer((req, res) => {
      // 代理 /api/* 请求到后端
      const urlPath = req.url || '';
      if (urlPath.startsWith('/api/')) {
        const isAiStream = urlPath.startsWith('/api/ai/chat/stream');
        const isWikiQuery = urlPath.startsWith('/api/wiki/query');
        const isWikiLint = urlPath.startsWith('/api/wiki/lint');
        const noTimeout = isAiStream || isWikiQuery || isWikiLint;
        const proxyReq = http.request({
          hostname: '127.0.0.1',
          port: config.backendPort,
          path: urlPath,
          method: req.method,
          headers: req.headers,
          timeout: noTimeout ? 0 : 30000
        }, (proxyRes) => {
          const responseHeaders = { ...proxyRes.headers };
          if (isAiStream) {
            responseHeaders['cache-control'] = 'no-cache, no-transform';
            responseHeaders.connection = 'keep-alive';
          }
          res.writeHead(proxyRes.statusCode, responseHeaders);
          proxyRes.pipe(res);
        });
        proxyReq.on('error', (e) => {
          console.error('[Frontend] Proxy error:', e.message);
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Backend service unavailable' }));
          }
        });
        proxyReq.on('timeout', () => {
          proxyReq.destroy();
          if (!res.headersSent) {
            res.writeHead(504, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Backend request timeout' }));
          }
        });
        req.pipe(proxyReq);
        return;
      }

      // ── SPA 路由回退：先检查文件是否存在，不存在则直接返回 index.html ──
      // 避免 serve-static 内部对 /topic /vault /settings 等 SPA 路由路径
      // 执行 fs.stat 抛出 ENOENT 导致刷新报错
      const reqPath = new URL(req.url, `http://127.0.0.1:${config.frontendPort}`).pathname;
      const filePath = path.join(frontendDir, reqPath);

      try {
        if (fs.existsSync(filePath) && !fs.statSync(filePath).isDirectory()) {
          // 文件存在 → 用 serve-static 正常托管
          return serve(req, res, finalhandler(req, res));
        }
      } catch (_) {
        // stat 异常 → 视为文件不存在，走 SPA 回退
      }

      // 文件不存在或为目录 → SPA 前端路由回退，返回 index.html
      fs.readFile(path.join(frontendDir, 'index.html'), (e, d) => {
        if (res.headersSent) return;
        if (e) { res.writeHead(500); res.end('Internal Server Error'); return; }
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        });
        res.end(d);
      });
    });

    // 绑定到 127.0.0.1 仅监听本地回环，不对外暴露
    server.listen(config.frontendPort, '127.0.0.1', () => {
      frontendServer = server;
      log.info(`Frontend server: http://127.0.0.1:${config.frontendPort}`);
      resolve(true);
    });

    // 端口被占用时给出明确错误提示
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${config.frontendPort} is already in use`));
      } else {
        reject(err);
      }
    });
  });
}

/**
 * 停止前端静态文件服务器
 */
function stopFrontendServer() {
  if (frontendServer) {
    frontendServer.close();
    frontendServer = null;
  }
}

// ==================== 系统托盘 ====================

/**
 * 显示并聚焦主窗口（统一入口）
 * 窗口最小化时先还原，再显示聚焦；隐藏时直接显示。
 * 供托盘菜单、全局快捷键、second-instance、activate 等场景复用，
 * 保证所有"唤起窗口"路径行为一致（符合常规任务栏交互）。
 */
function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  trayHidden = false; // 由托盘/快捷键等主动唤起后解除托盘隐藏态，恢复 activate 自动唤起
}

/**
 * 创建系统托盘图标
 * 托盘右键菜单提供"显示主窗口"和"退出"选项
 * 双击托盘图标可快速恢复窗口
 */
function createTray() {
  // 托盘图标路径：优先使用新设计的 tray-icon.png，回退到旧 icon.png
  const trayIconPath = path.join(__dirname, 'tray-icon.png');
  const fallbackIconPath = path.join(__dirname, 'icon.png');
  const iconPath = fs.existsSync(trayIconPath) ? trayIconPath : fallbackIconPath;
  let trayIcon;

  if (fs.existsSync(iconPath)) {
    // macOS: 缩放避免被放大。createFromPath 对无 @2x/@3x 后缀的图按 1x=pt 渲染，
    // 64px 源图会被当作 64pt，约为菜单栏标准(22pt)的 3 倍，需缩放到安全尺寸。
    // Windows/Linux: 缩放到 16x16 适应托盘标准尺寸
    if (process.platform === 'darwin') {
      const size = nativeImage.createFromPath(iconPath).getSize();
      // 菜单栏标准高度 22pt，取 18 留出上下留白；Retina 会自动平滑
      const target = size.width > 24 ? 18 : size.width;
      trayIcon = nativeImage.createFromPath(iconPath).resize({ width: target, height: target });
      // Template 图标：macOS 自动转为单色适配菜单栏明暗模式
      trayIcon.setTemplateImage(true);
    } else {
      trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    }
  } else {
    // 图标缺失时创建空图标（托盘仍然可用，但不显示图标）
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('CutShelter');

  // 右键菜单
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          // 窗口已存在（隐藏或最小化状态）：还原并聚焦
          showMainWindow();
        } else {
          // 窗口已被销毁：重新创建
          const config = loadConfig();
          createMainWindow(config);
        }
      }
    },
    { type: 'separator' },
    {
      label: '剪藏收件箱',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          showMainWindow();
          mainWindow.webContents.executeJavaScript(
            "window.history.pushState({view:'clip'}, '', '/clip'); window.dispatchEvent(new PopStateEvent('popstate'));"
          ).catch(err => log.warn('[Tray] navigate to clip failed:', err));
        } else {
          const config = loadConfig();
          createMainWindow(config);
        }
      }
    },
    {
      label: '密码管理',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          showMainWindow();
          // 通过 URL hash 触发前端跳转到 vault 视图
          mainWindow.webContents.executeJavaScript(
            "if (window.location.hash !== '#/vault') { window.history.pushState({view:'vault'}, '', '/vault'); window.dispatchEvent(new PopStateEvent('popstate')); }"
          ).catch(err => log.warn('[Tray] navigate to vault failed:', err));
        } else {
          const config = loadConfig();
          createMainWindow(config);
        }
      }
    },
    { type: 'separator' },
    {
      label: '⚙️ 设置',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          showMainWindow();
          mainWindow.webContents.executeJavaScript(
            "window.history.pushState({view:'settings'}, '', '/settings'); window.dispatchEvent(new PopStateEvent('popstate'));"
          ).catch(err => log.warn('[Tray] navigate to settings failed:', err));
        } else {
          const config = loadConfig();
          createMainWindow(config);
        }
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;   // 标记为正常退出，跳过 close 事件拦截
        quitApp();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  // 双击托盘图标：快速恢复窗口
  tray.on('double-click', () => {
    showMainWindow();
  });
}

/**
 * 显示关闭方式选择对话框
 * 用户关闭窗口时弹出，提供"最小化到托盘"和"退出程序"两个选项
 * 支持"记住我的选择"功能，勾选后下次不再询问
 * 
 * @param {BrowserWindow} win - 触发关闭的窗口实例
 */
async function showCloseDialog(win) {
  const parent = win || BrowserWindow.getFocusedWindow();
  if (!parent) return;

  // 从父窗口读取实际生效主题：index.html 的 applyTheme 已将 appearance 归一化为
  // document.documentElement 的 data-theme（regular/dark/notion），直接读取最可靠，
  // 避免 localStorage 键读取失败时误用深色样式。
  let appearance = 'notion'; // 读取失败时默认浅色，避免关闭提示错配为深色
  try {
    const dataTheme = await parent.webContents.executeJavaScript(
      'document.documentElement.getAttribute("data-theme") || "notion"'
    );
    appearance = (dataTheme === 'regular' || dataTheme === 'dark' || dataTheme === 'notion')
      ? dataTheme
      : 'notion';
  } catch (err) {
    // 读取失败时使用默认浅色（notion）
  }

  // 根据外观值计算颜色方案
  const isDark = appearance === 'dark';
  // 弹窗卡片背景色：与页面底色形成微妙区分
  //   regular → 页面 #f9fafb, 弹窗 #f3f4f6 (乳白色)
  //   notion  → 页面 #f7f7f5, 弹窗 #ffffff (白色)
  //   dark    → 页面 #1e1e1e, 弹窗 #2d2d2d (黑灰色)
  const cardBg = appearance === 'regular' ? '#f3f4f6'
    : appearance === 'notion' ? '#ffffff'
    : '#2d2d2d';

  const dialogWidth = 400;
  const dialogHeight = 210;
  const parentBounds = parent.getBounds();
  const x = parentBounds.x + Math.round((parentBounds.width - dialogWidth) / 2);
  const y = parentBounds.y + Math.round((parentBounds.height - dialogHeight) / 2);

  const closeDialog = new BrowserWindow({
    width: dialogWidth,
    height: dialogHeight,
    x, y,
    parent,
    modal: true,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    transparent: true,
    webPreferences: {
      nodeIntegration: false,   // 安全：禁用 Node.js 集成
      contextIsolation: true,   // 安全：启用上下文隔离
      preload: path.join(__dirname, 'close-dialog-preload.js')
    }
  });

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; user-select: none; }
  body {
    background: transparent; height: 100vh; overflow: hidden;
    font-family: "IBM Plex Sans", "Noto Sans SC", "Microsoft YaHei", sans-serif;
    display: flex; align-items: center; justify-content: center;
  }
  .card {
    width: 100%; height: 100%;
    background: var(--card-bg);
    border-radius: 12px;
    border: none;
    box-shadow: 0 0 0 1px rgba(255,255,255,0.06), 0 16px 48px rgba(0,0,0,0.5);
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  .card.light {
    box-shadow: 0 0 0 1px rgba(0,0,0,0.06), 0 16px 48px rgba(0,0,0,0.12);
  }
  .header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 20px 6px;
    -webkit-app-region: drag;
  }
  .title {
    font-size: 14px; font-weight: 600; color: var(--fg);
    display: flex; align-items: center; gap: 8px;
    letter-spacing: -0.01em;
  }
  .title svg { width: 18px; height: 18px; stroke: var(--accent); }
  .close-btn {
    width: 28px; height: 28px; border-radius: 8px; border: none;
    background: transparent; cursor: pointer; color: var(--fg-muted);
    display: flex; align-items: center; justify-content: center;
    -webkit-app-region: no-drag; transition: all 0.15s;
  }
  .close-btn:hover { background: var(--hover-bg); color: var(--fg); }
  .close-btn svg { width: 14px; height: 14px; }
  .body {
    padding: 6px 20px 14px; flex: 1;
    display: flex; flex-direction: column; justify-content: center;
  }
  .body p {
    font-size: 13px; color: var(--fg-secondary); line-height: 1.6;
    margin-bottom: 0;
  }
  .body p strong { color: var(--fg); font-weight: 600; }
  .footer {
    padding: 0 20px 14px; display: flex; gap: 8px; justify-content: flex-end;
  }
  .btn {
    font-size: 13px; padding: 7px 16px; border-radius: 8px; border: 1px solid transparent;
    cursor: pointer; font-family: inherit; transition: all 0.15s; font-weight: 500;
    letter-spacing: 0.01em;
  }
  .btn-cancel {
    background: var(--btn-secondary-bg); border-color: var(--btn-secondary-border); color: var(--fg);
  }
  .btn-cancel:hover { background: var(--btn-secondary-hover); }
  .btn-danger {
    background: var(--btn-danger-bg); border-color: var(--btn-danger-border); color: var(--danger);
  }
  .btn-danger:hover { background: var(--btn-danger-hover); border-color: var(--danger); }
  .checkbox-row {
    display: flex; align-items: center; gap: 8px; margin-top: 12px;
  }
  .checkbox-row input {
    width: 14px; height: 14px; cursor: pointer;
    accent-color: var(--accent); flex-shrink: 0;
  }
  .checkbox-row label {
    font-size: 12.5px; color: var(--fg-muted); cursor: pointer;
    line-height: 1.4;
  }
</style></head>
<body>
<div class="card${isDark ? '' : ' light'}">
  <div class="header">
    <div class="title">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      关闭 CutShelter
    </div>
    <button class="close-btn" onclick="window.close()" title="取消">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
        <line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>
      </svg>
    </button>
  </div>
  <div class="body">
    <p>是否<strong>退出</strong> CutShelter，还是<strong>最小化</strong>到系统托盘继续在后台运行？</p>
    <div class="checkbox-row">
      <input type="checkbox" id="remember">
      <label for="remember">记住我的选择，下次不再询问</label>
    </div>
  </div>
  <div class="footer">
    <button class="btn btn-cancel" onclick="choose('tray')">最小化到托盘</button>
    <button class="btn btn-danger" onclick="choose('quit')">退出程序</button>
  </div>
</div>
<script>
  function choose(action) {
    window.dialogApi.choose(action, document.getElementById('remember').checked);
    window.close();
  }
</script>
</body></html>`;

  // Inject CSS variables matching the app theme (matching theme-notion.css)
  const cssVars = `
    :root {
      --card-bg: ${cardBg};
      --fg: ${isDark ? '#d4d4d4' : '#1f2937'};
      --fg-secondary: ${isDark ? '#9a9a9a' : '#6b7280'};
      --fg-muted: ${isDark ? '#6a6a6a' : '#9ca3af'};
      --accent: #569cff;
      --danger: ${isDark ? '#e06060' : '#ef4444'};
      --hover-bg: ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'};
      --btn-secondary-bg: ${isDark ? 'transparent' : (appearance === 'notion' ? '#f7f7f5' : '#ffffff')};
      --btn-secondary-border: ${isDark ? '#3e3e3e' : (appearance === 'notion' ? '#dcdcd8' : '#e5e7eb')};
      --btn-secondary-hover: ${isDark ? '#3a3a3a' : (appearance === 'notion' ? '#efefed' : '#f3f4f6')};
      --btn-danger-bg: ${isDark ? 'transparent' : 'transparent'};
      --btn-danger-border: ${isDark ? 'rgba(224,96,96,0.3)' : 'rgba(239,68,68,0.3)'};
      --btn-danger-hover: ${isDark ? 'rgba(224,96,96,0.1)' : 'rgba(239,68,68,0.06)'};
    }
  `;
  const fullHtml = html.replace('</style>', cssVars + '</style>');

  let dialogResult = null;

  closeDialog.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(fullHtml));

  closeDialog.once('ready-to-show', () => closeDialog.show());

  // Capture result via IPC before window closes
  closeDialog.webContents.on('ipc-message', (event, channel, ...args) => {
    if (channel === 'close-dialog-result') {
      dialogResult = args[0];
    }
  });

  closeDialog.on('closed', () => {
    try {
      if (dialogResult) {
        if (dialogResult.remember) {
          closeToTray = dialogResult.action === 'tray';
        }
        if (dialogResult.action === 'tray') {
          // macOS 上模态弹窗关闭后 minimize() 不生效（窗口仍可见），改用 hide() 真正收入托盘
          trayHidden = true;
          if (parent) parent.hide();
        } else {
          isQuitting = true;
          quitApp();
        }
      }
      // dialogResult is null → dismissed via X (cancel) — do nothing
    } catch (e) {
      // safety
    }
  });
}

// ==================== 窗口管理 ====================

/**
 * 创建主窗口
 * 系统原生标题栏（macOS hiddenInset / Windows hidden + titleBarOverlay），前端仅作为拖拽区
 * 注册 close 和 minimize 事件处理以实现托盘功能
 * 
 * @param {Object} config - 用户配置
 */
function createMainWindow(config) {
  const appIconPath = path.join(__dirname, 'app-icon.png');
  const isMac = process.platform === 'darwin';
  const isWin = process.platform === 'win32';
  mainWindow = new BrowserWindow({
    width: 1200, height: 800,
    minWidth: 900, minHeight: 600,
    title: 'Clip',
    // macOS：系统原生标题栏，红黄绿交通灯以 hiddenInset 内嵌于左上，前端作为拖拽区。
    // Windows：隐藏标题栏 + 系统 Overlay 按钮（最小化/最大化/关闭），前端作拖拽区（Aero Snap 由系统接管）。
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    // Windows 原生 Overlay 按钮默认暗色；亮/蓝主题由 window-set-overlay IPC 实时同步（见下）
    ...(isWin ? { titleBarOverlay: { color: '#2d2d2d', symbolColor: '#d4d4d4', height: 38 } } : {}),
    icon: appIconPath,
    webPreferences: {
      nodeIntegration: false,          // 安全：禁用 Node.js 集成
      contextIsolation: true,          // 安全：启用上下文隔离
      nodeIntegrationInSubFrames: true, // 允许工具 iframe 内运行 preload（批量重命名等需要 IPC）
      preload: path.join(__dirname, 'preload.js')  // 预加载脚本暴露安全 API
    }
  });

  // 加载前端页面（带自动重试）
  function loadWithRetry(attempts) {
    if (attempts <= 0) {
      // 最后一次尝试：不捕获错误，让异常自然抛出
      mainWindow.loadURL(`http://127.0.0.1:${config.frontendPort}`);
      return;
    }
    // 加载失败后等待 2 秒重试，最多重试 attempts 次
    mainWindow.loadURL(`http://127.0.0.1:${config.frontendPort}`).catch(() => {
      setTimeout(() => loadWithRetry(attempts - 1), 2000);
    });
  }

  // 拦截新窗口打开：外部链接用系统默认浏览器打开，其余拒绝
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // 监听页面加载失败事件（如连接被拒绝 ERR_CONNECTION_REFUSED: -102）
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    // 始终记录失败详情，便于内网环境定位"窗口在但页面空白/转圈"类问题
    log.warn(`[Window] did-fail-load code=${errorCode} desc=${errorDescription || ''} url=${validatedURL || ''}`);
    if (errorCode === -102 || errorCode === -3) {
      // -102: ERR_CONNECTION_REFUSED（后端未就绪）
      // -3:  ERR_ABORTED（加载被中断）
      setTimeout(() => {
        mainWindow.loadURL(`http://127.0.0.1:${config.frontendPort}`);
      }, 2000);
    }
  });

  // 渲染进程崩溃/被系统强杀（如 GPU 进程异常、内存不足、电源管理），
  // 记录到主进程日志，供"窗口没弹出来/刚打开就闪退"定位
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    log.error(`[Window] render-process-gone reason=${details.reason} exitCode=${details.exitCode} cwd=${details.cwd ? '' : 'n/a'}`);
  });

  // 页面长时间无响应（事件循环被占）或恢复响应，辅助判断是否出现卡死
  mainWindow.webContents.on('unresponsive', () => {
    log.error('[Window] renderer unresponsive (页面无响应)');
  });
  mainWindow.webContents.on('responsive', () => {
    log.info('[Window] renderer responsive again');
  });

  // 页面加载完成时（含 Ctrl+R 刷新），若后端已启动则重新发送就绪事件
  mainWindow.webContents.on('did-finish-load', () => {
    if (backendStarted && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('backend-ready');
      mainWindow.webContents.send('load-config', config);
    }
  });

  // 开始加载页面，最多重试 5 次（共 10 秒）
  loadWithRetry(5);

  // 窗口销毁时清理引用
  mainWindow.on('closed', () => { mainWindow = null; });

  // 应用主动退出时，忽略渲染进程 beforeunload 的阻止（如编辑器未保存标签的取消卸载）
  // 否则子 iframe 的 beforeunload 会阻断 app.quit()，导致 Cmd+Q / 扩展坞 / 右上角关闭均无效。
  // 仅退出时绕过；正常刷新/导航仍保留 beforeunload 的未保存提示。
  mainWindow.webContents.on('will-prevent-unload', (event) => {
    if (isQuitting) {
      event.preventDefault();
    }
  });

  // ===== 关闭窗口拦截 =====
  // 当用户点击关闭按钮时，行为取决于 closeToTray 状态：
  //   null  → 弹出对话框询问
  //   true  → 最小化到任务栏（与 Alt+X 一致，按钮与运行横线保留）
  //   false → 直接退出程序
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();  // 阻止默认关闭行为
      if (closeToTray === true) {
        // 最小化到托盘：hide() 真正将窗口收入托盘（macOS 上 minimize() 仍会残留/被激活弹回）
        trayHidden = true;
        mainWindow.hide();
      } else if (closeToTray === false) {
        isQuitting = true;
        quitApp();
      } else {
        showCloseDialog(mainWindow);
      }
    }
  });

  // ===== 最小化 =====
  // 遵循标准窗口行为：最小化到任务栏（任务栏图标常驻，点击可恢复），
  // 与 Chrome/微信等常规应用一致。关闭按钮仍走"关闭到托盘"逻辑（见 close 拦截）。

  // 最大化/还原状态变化时通知渲染进程（用于更新标题栏按钮图标）
  mainWindow.on('maximize', () => mainWindow.webContents.send('window-maximized', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window-maximized', false));

  // ===== 应用菜单栏 =====
  const menuTemplate = [
    {
      label: 'Clip', submenu: [
        { label: 'Global Search', accelerator: 'CmdOrCtrl+K', click: () => focusGlobalSearch() },
        { type: 'separator' },
        { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => showConfigWindow(config) },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit', submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
      ]
    },
    {
      label: 'View', submenu: [
        { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help', submenu: [
        {
          label: 'View Log', click: () => {
            const logFile = path.join(LOG_DIR, 'backend.log');
            if (fs.existsSync(logFile)) {
              shell.openPath(logFile);  // 用系统默认程序打开日志文件
            } else {
              dialog.showMessageBox(mainWindow, {
                type: 'info', title: 'Log',
                message: 'Log file not found',
                detail: `Expected at: ${logFile}`
              });
            }
          }
        },
        { type: 'separator' },
        {
          label: 'About', click: () => {
            const ver = updateManager.getCurrentVersion();
            dialog.showMessageBox(mainWindow, {
              type: 'info', title: 'About',
              message: 'CutShelter - Information Retrieval System',
              detail: `Version: ${ver}\nSpring Boot + Electron\nDashScope AI`
            });
          }
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
}

// 聚焦全局搜索框（⌘/Ctrl+K 菜单加速键触发；若焦点在 iframe 内，页面 keydown 收不到，必须走主进程）
function focusGlobalSearch() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('focus-global-search');
}

/**
 * 显示配置窗口（单例模式）
 * 如果已存在则聚焦，否则创建新窗口
 * 
 * @param {Object} config - 当前配置（传递给配置页面）
 */
function showConfigWindow(config) {
  if (configWindow) { configWindow.focus(); return; }

  configWindow = new BrowserWindow({
    width: 560, height: 700,
    resizable: false,
    frame: false,
    title: 'Clip - Settings',
    icon: path.join(__dirname, 'app-icon.png'),
    parent: mainWindow,      // 设置父窗口，随父窗口一起关闭
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // 加载独立的配置页面（非 SPA 路由）
  configWindow.loadFile(path.join(__dirname, 'config.html'));

  // 页面加载完成后发送当前配置
  configWindow.webContents.on('did-finish-load', () => {
    configWindow.webContents.send('load-config', config);
  });

  configWindow.on('closed', () => { configWindow = null; });
}

// ==================== 退出应用 ====================

/**
 * 确保系统右键菜单已注册且指向当前应用路径。
 *
 * 免安装/便携版可能从任意目录启动（win-unpacked、便携盘、安装版等），
 * 目录移动或历史残留会导致注册表命令指向已失效的路径。
 * 因此每次启动都执行一次覆盖式注册，确保右键菜单始终指向当前运行的 exe 位置，
 * 从源头避免"config 记录与注册表实际内容不一致"。
 *
 * @param {Object} config - 配置对象（注册成功后原地更新并保存）
 * @returns {boolean} 是否已注册成功
 */
function ensureContextMenuRegistered(config) {
  try {
    const registered = registerContextMenu(APP_DIR);
    if (registered) {
      config.contextMenuRegistered = true;
      config.contextMenuPath = APP_DIR;
      saveConfig(config);
      log.info(`[ContextMenu] 系统右键菜单已注册（路径：${APP_DIR}）`);
      return true;
    }
    log.warn('[ContextMenu] 注册未完成，将在下次启动重试');
    return false;
  } catch (e) {
    log.warn('[ContextMenu] 注册失败:', e.message);
    return false;
  }
}

/**
 * 完整退出应用
 * 按顺序执行：销毁托盘 → 停止后端 → 停止前端 → 退出 Electron
 */
function quitApp() {
  isQuitting = true;

  // 停止更新检查定时器
  updateManager.stopAutoCheck();

  // 停止提醒调度器
  stopReminderScheduler();

  // 清理系统右键菜单注册表
  try {
    unregisterContextMenu();
  } catch (e) {
    log.warn('[ContextMenu] 注销失败:', e.message);
  }

  // 销毁系统托盘图标，防止退出后托盘残留
  if (tray) {
    tray.destroy();
    tray = null;
  }

  stopBackend();
  stopFrontendServer();
  stopDshAgent();

  // 强制销毁临时工具窗口（截图覆盖层/贴图等 fullscreen alwaysOnTop 窗口），
  // 防止其渲染进程繁忙时 close 阻塞 app.quit()（"无法退出"）。
  try { screenshotService.cleanupOnQuit(); } catch (e) { log.warn('[Quit] screenshot cleanup:', e.message); }
  try { destroyTransientToasts(); } catch (e) { log.warn('[Quit] toast cleanup:', e.message); }

  app.quit();
}

// ==================== IPC 通信 ====================

/**
 * 注册所有 IPC 处理器
 * 渲染进程通过 window.electronAPI 调用这些方法
 * 使用 ipcMain.handle 支持异步返回（Promise）
 */
function setupIPC() {
  // 保存配置
  ipcMain.handle('save-config', async (event, newConfig) => {
    try {
      const nextConfig = { ...loadConfig(), ...newConfig };
      saveConfig(nextConfig);
      applyAutoStartSetting(nextConfig.autoStart);
      // 同步 model-config.json 到 ~/.cut-shelter/config/，确保后端 AppConfigService 迁移时能读到 API Key
      syncModelConfigJson(nextConfig);
      // 同步更新 application.yml，确保重启后 storagePath 等配置生效
      const jarPath = getJarPath();
      if (jarPath) {
        const ymlPath = path.join(path.dirname(jarPath), 'application.yml');
        fs.writeFileSync(ymlPath, generateApplicationYml(nextConfig), 'utf-8');
        log.info('application.yml updated via save-config');
      }
      return { success: true, message: 'Config saved.' };
    } catch (e) {
      return { success: false, message: `Save failed: ${e.message}` };
    }
  });

  /**
   * 手动启动后端（由 frontend-only 模式下的按钮触发）
   */
  ipcMain.handle('start-backend', async () => {
    if (backendStarted) {
      return { success: true, message: '后端服务已在运行中' };
    }
    const config = loadConfig();
    try {
      await startBackend(config);
      backendStarted = true;
      const clipStoragePath = config.storagePath.endsWith('clip-storage') || config.storagePath.endsWith('clip-storage\\')
        ? config.storagePath
        : path.join(config.storagePath, 'clip-storage');
      log.initExceptionLogger(clipStoragePath);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('backend-ready');
      }
      startReminderScheduler();
      return { success: true, message: '后端服务启动成功' };
    } catch (e) {
      log.error('Manual backend start failed:', e);
      return { success: false, message: e.message };
    }
  });

  /**
   * 检查后端是否在运行
   */
  ipcMain.handle('is-backend-running', () => {
    return backendStarted;
  });

  /**
   * DSH Agent sidecar 状态（Phase 2）
   */
  ipcMain.handle('dsh-agent:status', async () => {
    const config = loadConfig();
    const primary = config.dshPort || 3081;
    // 探测实际运行端口：优先已复用的手动实例端口(3080)，其次主端口(3081)，
    // 让前端据真实端口加载面板，避免复用场景仍连固定 3081 白屏。
    const probe = [3080, primary].filter((p, i, a) => p && a.indexOf(p) === i);
    for (const p of probe) {
      if (await checkHttpPort(p)) return { running: true, owned: dshAgentOwned, port: p };
    }
    return { running: false, owned: dshAgentOwned, port: primary };
  });

  /**
   * 检查 dsh 是否已安装/运行（供「工具 → AI干活」卡片前置检测激活）。
   * 返回安装状态与自助安装命令，未装则仅提示，不代联网安装。
   */
  ipcMain.handle('dsh-agent:check-install', async (ev, args) => {
    const config = loadConfig();
    const port = config.dshPort || 3081;
    const installed = await checkHttpPort(port);
    const { command, source, version } = await getDshInstallCommand(!!(args && args.force));
    return {
      installed,
      port,
      command,
      source,
      version,
      hint: installed
        ? `DeepSeek Harness 已就绪（端口 ${port}），可直接使用`
        : `未检测到 DeepSeek Harness，请自行安装后再激活。命令：${command}`
    };
  });

  /**
   * 按需启动（或复用）DSH Agent sidecar
   */
  ipcMain.handle('dsh-agent:ensure', async () => {
    const config = loadConfig();
    if (!config.dshAgentEnabled) {
      return { success: false, message: 'DSH Agent 已在设置中禁用（dshAgentEnabled=false）' };
    }
    try {
      return await startDshAgent(config);
    } catch (e) {
      log.error('dsh-agent:ensure failed:', e);
      return { success: false, message: e.message };
    }
  });

  /**
   * 停止本应用拉起的 DSH Agent sidecar（复用实例不受影响）
   */
  ipcMain.handle('dsh-agent:stop', async () => {
    stopDshAgent();
    return { success: true };
  });

  /**
   * 实时探测宿主 DSH 版本（版本对齐的事实来源，设置页每次打开/手动刷新时调用）。
   * 优先返回最近一次探测的内存态；无运行态时再解析磁盘 bin 读取。
   */
  ipcMain.handle('dsh-agent:detect-version', async () => {
    const config = loadConfig();
    // 诊断：记录判定关键输入，便于定位「来源为何显示用户指定(config)」
    log.info(`[dsh detect-version] cfg.dshBinPath="${config && config.dshBinPath}", DSH_BIN="${process.env.DSH_BIN}", memState=${JSON.stringify(dshVersionState)}`);
    // 防御：config.dshBinPath 若为 npx 缓存残留(_npx)，即使内存态残留也强制重新解析，
    // 交给 resolveDshBin 跳过残留路径、按 npx 缓存选最高版本。
    const hasNpxResidue = typeof (config && config.dshBinPath) === 'string' && config.dshBinPath.includes('_npx');
    // 版本漂移：宿主 DSH 版本 ≠ 应用适配版本（DSH_VERSION）时，随返回值上抛，供设置页告警。
    const withMismatch = (version) => ({
      version,
      supported: DSH_VERSION,
      mismatch: (version && version !== DSH_VERSION) ? { host: version, supported: DSH_VERSION } : null,
    });
    if (dshVersionState && dshVersionState.version && !hasNpxResidue) {
      log.info(`[dsh detect-version] → 返回内存态 source=${dshVersionState.source} version=${dshVersionState.version}`);
      const m = withMismatch(dshVersionState.version);
      if (m.mismatch) log.warn(`[dsh detect-version] 宿主 v${dshVersionState.version} ≠ 内置支持 v${DSH_VERSION}（已上报前端告警）`);
      return { ...m, source: dshVersionState.source };
    }
    const bin = await resolveDshBin(config);
    const det = detectDshVersion(bin, config);
    log.info(`[dsh detect-version] → resolveDshBin mode=${bin.mode} script=${bin.script} → source=${det.source} version=${det.version}`);
    const m = withMismatch(det.version);
    if (m.mismatch) log.warn(`[dsh detect-version] 宿主 v${det.version} ≠ 内置支持 v${DSH_VERSION}（已上报前端告警）`);
    return { ...m, source: det.source };
  });

  /**
   * 查询 npm 上 DSH 最新版本（「检测升级」按钮调用，只查不下装）。
   */
  ipcMain.handle('dsh-agent:latest-version', async () => {
    let latest = null;
    try { latest = await fetchLatestDshVersionFromNpm(); } catch (e) { log.warn(`[DSH Agent] latest-version failed: ${e.message}`); }
    return { latest: latest || null };
  });

  /**
   * 取消正在进行的 DSH 安装/启动
   */
  ipcMain.handle('dsh-agent:cancel', async () => {
    return { cancelled: cancelDshAgent() };
  });

  /**
   * 一键安装 CutShelter 技能包到 DSH 技能目录（~/.dsh/skills/cut-shelter）
   */
  ipcMain.handle('dsh-agent:install-skill', async () => {
    let srcDir = null;
    const patchDir = resolveDshPatchDir();
    if (patchDir) {
      const s = path.join(patchDir, 'skills', 'cut-shelter');
      if (fs.existsSync(s)) srcDir = s;
    }
    if (!srcDir) {
      const repo = path.join(APP_DIR, 'integrations', 'dsh', 'skills', 'cut-shelter');
      if (fs.existsSync(repo)) srcDir = repo;
    }
    if (!srcDir) return { success: false, message: '技能包源目录未找到（integrations/dsh/skills/cut-shelter）' };
    const dshHome = resolveDshHome(loadConfig());
    const destDir = path.join(dshHome, 'skills', 'cut-shelter');
    try {
      fs.rmSync(destDir, { recursive: true, force: true });
      fs.cpSync(srcDir, destDir, { recursive: true });
      log.info(`[DSH Skill] installed cut-shelter skill -> ${destDir}`);
      return { success: true, target: destDir };
    } catch (e) {
      log.error(`[DSH Skill] install failed: ${e.message}`);
      return { success: false, message: e.message };
    }
  });

  /**
   * 查询 CutShelter 技能包是否已安装到 DSH 技能目录
   */
  ipcMain.handle('dsh-agent:skill-status', async () => {
    const dshHome = resolveDshHome(loadConfig());
    const dest = path.join(dshHome, 'skills', 'cut-shelter', 'SKILL.md');
    const result = { installed: fs.existsSync(dest), target: path.dirname(dest) };
    // 附带工具清单漂移校验：对比 server.mjs + plugins 实际注册的工具与 SKILL.md 登记条目
    try {
      const repoDir = path.join(APP_DIR, 'integrations', 'dsh', 'verify-skill-table.mjs');
      if (fs.existsSync(repoDir)) {
        const { verifySkillTable } = await import(pathToFileURL(repoDir).href);
        if (typeof verifySkillTable === 'function') {
          result.drift = verifySkillTable(path.join(APP_DIR, 'integrations', 'dsh'));
        }
      }
    } catch (e) {
      result.drift = null;
      log.warn('[DSH Skill] verify-skill-table unavailable:', e.message);
    }
    return result;
  });

  /** 查询 dshmarket 插件市场应用是否已预装（配合前端「插件市场」入口显示状态） */
  ipcMain.handle('dsh-agent:market-status', async () => {
    const config = loadConfig();
    const port = (config && config.dshPort) || 3081;
    const pkgFile = path.join(getDshProfileDir('web'), 'package.json');
    let installed = false;
    if (fs.existsSync(pkgFile)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf-8'));
        const bundles = (pkg && pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles) || [];
        installed = bundles.some((b) => String(b).includes('dshmarket'));
      } catch (e) { installed = false; }
    }
    return { installed, port, running: await checkHttpPort(port) };
  });

  // ===================== SQLite 本地索引层（仅 clip，主进程 Node 侧） =============
  const localIndexGuard = (fn) => async (ev, args) => {
    try { return await fn(ev, args); }
    catch (e) { log.error('[local-index] error:', e); return { success: false, message: e.message }; }
  };

  /** 本地索引状态（就绪/世代号/条目数） */
  ipcMain.handle('local-index:status', () => {
    return { ...localIndexService.status(), success: true };
  });

  /** 初始化 + 全量重建本地索引 */
  ipcMain.handle('local-index:rebuild', localIndexGuard(async () => {
    const config = loadConfig();
    const res = localIndexService.rebuild(config.storagePath);
    return { ...res, success: true };
  }));

  /** 全文搜索（对齐 /api/clip/search） */
  ipcMain.handle('local-index:search', localIndexGuard(async (ev, args) => {
    const { query, topK, category } = args || {};
    const list = category
      ? localSearch.searchByCategory(query, category, topK)
      : localSearch.search(query, topK);
    return { success: true, results: list };
  }));

  /** 全库统一搜索（M4）：跨 clip / knowledge / learning-plan，返回统一类型化命中 */
  ipcMain.handle('local-index:search-all', localIndexGuard(async (ev, args) => {
    const { query, topK, type } = args || {};
    const hits = localSearch.searchAll(query, { topK, type });
    return { success: true, results: hits };
  }));

  /** 按类型快速列表 clip */
  ipcMain.handle('local-index:list-by-type', localIndexGuard(async (ev, args) => {
    const { type, limit } = args || {};
    return { success: true, results: localIndexService.listByType(type, limit) };
  }));

  /** 图谱数据（对齐 GET /api/graph）：includeTypes 逗号分隔，空=全部 */
  ipcMain.handle('local-index:graph', localIndexGuard(async (_ev, args) => {
    const includeTypes = (args && args.includeTypes)
      ? new Set(String(args.includeTypes).split(',').map((s) => s.trim()).filter(Boolean))
      : null;
    const graph = localGraph.getGraph(localDb.getDatabase(), includeTypes);
    return { success: true, nodes: graph.nodes, links: graph.links };
  }));

  /** 查询某节点的关系（出链 + 反链），供反链面板复用 */
  ipcMain.handle('local-index:relations', localIndexGuard(async (_ev, args) => {
    const { id } = args || {};
    if (!id) return { success: false, message: 'id is required' };
    return { success: true, relations: localGraph.relationsFor(localDb.getDatabase(), id) };
  }));

  /**
   * 获取当前启动模式
   */
  ipcMain.handle('get-startup-mode', () => {
    const config = loadConfig();
    return config.startupMode || 'frontend-only';
  });

  ipcMain.handle('get-auto-start', () => {
    return app.getLoginItemSettings().openAtLogin;
  });

  ipcMain.handle('set-auto-start', (event, enabled) => {
    try {
      const nextConfig = { ...loadConfig(), autoStart: Boolean(enabled) };
      saveConfig(nextConfig);
      const settings = applyAutoStartSetting(nextConfig.autoStart);
      return { success: true, enabled: settings.openAtLogin };
    } catch (e) {
      log.error('[AutoStart] Failed to update login item:', e.message);
      return { success: false, message: e.message };
    }
  });

  // 打开系统目录选择对话框
  ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Directory'
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // ===== 工具模块：批量重命名 =====
  // 选择目录（或传入已有目录）并列出其下文件
  ipcMain.handle('tools:select-rename-directory', async (event, dirPath) => {
    let target = dirPath;
    if (!target) {
      const pick = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
        title: 'Select Directory to Rename'
      });
      if (pick.canceled || pick.filePaths.length === 0) return null;
      target = pick.filePaths[0];
    }
    try {
      const entries = fs.readdirSync(target, { withFileTypes: true });
      const files = entries
        .filter(e => e.isFile())
        .map(e => ({ name: e.name, path: path.join(target, e.name) }));
      return { dirPath: target, files };
    } catch (e) {
      return { dirPath: target, files: [], error: e.message };
    }
  });

  // 执行批量重命名
  ipcMain.handle('tools:apply-renames', async (event, payload) => {
    const { dirPath, renames } = payload || {};
    if (!dirPath || !Array.isArray(renames)) {
      return { success: false, error: '参数错误' };
    }
    let renamed = 0;
    const errors = [];
    for (const r of renames) {
      try {
        const src = path.join(dirPath, r.oldName);
        const dst = path.join(dirPath, r.newName);
        if (src === dst) { renamed++; continue; }
        if (!fs.existsSync(src)) { errors.push(`文件不存在: ${r.oldName}`); continue; }
        if (fs.existsSync(dst)) { errors.push(`目标已存在: ${r.newName}`); continue; }
        fs.renameSync(src, dst);
        renamed++;
      } catch (e) {
        errors.push(`${r.oldName}: ${e.message}`);
      }
    }
    return { success: true, renamed, errors };
  });

  // ===== 轻量文本编辑器文件能力 =====
  function getEditorDefaultDirectory() {
    const config = loadConfig();
    const rootPath = config.storagePath || APP_DIR;
    const defaultDirectory = path.join(rootPath, 'tmp');
    fs.mkdirSync(defaultDirectory, { recursive: true });
    return defaultDirectory;
  }

  function getEditorExtension(language) {
    return ({ json: 'json', xml: 'xml', sql: 'sql', text: 'txt' })[language] || 'txt';
  }

  function buildEditorFileName(fileName, language) {
    const extension = getEditorExtension(language);
    const baseName = path.basename(fileName || 'untitled');
    const knownExtension = /\.(json|xml|sql|txt|md|csv|log|yaml|yml|ini|conf)$/i;
    return `${baseName.replace(knownExtension, '') || 'untitled'}.${extension}`;
  }

  function getEditorFilters(language) {
    const extension = getEditorExtension(language);
    const label = extension.toUpperCase();
    return [
      { name: label, extensions: [extension] },
      { name: '文本与代码', extensions: ['txt', 'md', 'json', 'xml', 'sql', 'csv', 'log', 'yaml', 'yml', 'ini', 'conf'] },
      { name: '所有文件', extensions: ['*'] }
    ];
  }

  // ===== 学习计划 Markdown 导出 =====
  ipcMain.handle('learning-plan-save-markdown', async (event, payload) => {
    const defaultDirectory = getEditorDefaultDirectory();
    const suggestedName = (payload?.suggestedName || '学习计划').replace(/[\\/:*?"<>|]/g, '_') + '.md';
    const options = {
      title: '导出为 Markdown',
      defaultPath: path.join(defaultDirectory, suggestedName),
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: '文本文件', extensions: ['txt'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    };
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { canceled: true };
    try {
      fs.mkdirSync(path.dirname(result.filePath), { recursive: true });
      fs.writeFileSync(result.filePath, payload?.text || '', 'utf-8');
      log.info('[LearningPlan] markdown saved to', result.filePath);
      return { canceled: false, filePath: result.filePath };
    } catch (e) {
      log.error('[LearningPlan] save markdown failed:', e.message);
      return { canceled: true, error: e.message };
    }
  });

  ipcMain.handle('editor-open-text-file', async () => {
    const defaultDirectory = getEditorDefaultDirectory();
    const options = {
      title: '打开文本文件',
      defaultPath: defaultDirectory,
      properties: ['openFile'],
      filters: [
        { name: '文本与代码', extensions: ['txt', 'md', 'json', 'xml', 'sql', 'csv', 'log', 'yaml', 'yml', 'ini', 'conf'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    const opened = editorFileService.openPath(result.filePaths[0]);
    log.info('[EditorFile] opened', opened.fileName, opened.size, opened.encoding);
    return opened;
  });

  ipcMain.handle('editor-reopen-text-file', async (event, fileToken, encoding) => {
    const reopened = editorFileService.reopen(fileToken, encoding);
    log.info('[EditorFile] reopened', reopened.fileName, reopened.encoding);
    return reopened;
  });

  ipcMain.handle('editor-save-text-file', async (event, payload) => {
    const saved = editorFileService.save(payload?.fileToken, payload || {});
    if (!saved.conflict) log.info('[EditorFile] saved', saved.fileName, saved.size, saved.encoding);
    return saved;
  });

  ipcMain.handle('editor-save-text-file-as', async (event, payload) => {
    const language = payload?.language || 'text';
    const defaultDirectory = getEditorDefaultDirectory();
    const suggestedName = buildEditorFileName(payload?.suggestedName, language);
    const options = {
      title: '保存文本文件',
      defaultPath: path.join(defaultDirectory, suggestedName),
      filters: getEditorFilters(language)
    };
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { canceled: true };
    const saved = editorFileService.saveAs(result.filePath, payload || {});
    log.info('[EditorFile] saved as', saved.fileName, saved.size, saved.encoding);
    return saved;
  });

  ipcMain.handle('editor-get-file-md5', async (event, fileToken) => {
    try {
      const filePath = editorFileService.resolveToken(fileToken);
      const bytes = fs.readFileSync(filePath);
      const hash = crypto.createHash('md5').update(bytes).digest('hex');
      const stat = fs.statSync(filePath);
      return { hash, fileName: path.basename(filePath), size: stat.size };
    } catch (error) {
      log.error('[EditorFile] get-file-md5 error', error.message);
      return { error: error.message };
    }
  });

  // ===== 编辑器缓存 =====
  // 缓存目录：{storagePath}/.tmp/editor/cache.json
  // 保存所有标签状态，用于用户未保存关闭后恢复

  ipcMain.handle('editor-save-cache', async (event, cacheData) => {
    try {
      const config = loadConfig();
      const rootPath = config.storagePath || APP_DIR;
      const cacheDir = path.join(rootPath, '.tmp', 'editor');
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }
      fs.writeFileSync(path.join(cacheDir, 'cache.json'), JSON.stringify(cacheData, null, 2), 'utf-8');
      return { success: true };
    } catch (err) {
      log.error('[EditorCache] save failed:', err.message);
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('editor-load-cache', async () => {
    try {
      const config = loadConfig();
      const rootPath = config.storagePath || APP_DIR;
      const cacheFile = path.join(rootPath, '.tmp', 'editor', 'cache.json');
      if (!fs.existsSync(cacheFile)) return { exists: false };
      const data = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));

      // 主进程重启后内存令牌表已清空，缓存的 fileToken 全部失效。
      // 若原文件仍存在则重新授权并返回新令牌；否则清空令牌，
      // 避免自动保存/保存时触发"文件访问令牌无效或已过期"。
      if (data && Array.isArray(data.tabs)) {
        data.tabs.forEach(tab => {
          if (!tab || !tab.fileToken) return;
          try {
            if (tab.displayPath && fs.existsSync(tab.displayPath)) {
              const opened = editorFileService.openPath(tab.displayPath);
              tab.fileToken = opened.fileToken;
              tab.expectedMtimeMs = opened.mtimeMs;
            } else {
              tab.fileToken = null;
              tab.expectedMtimeMs = null;
            }
          } catch (err) {
            log.warn('[EditorCache] re-auth failed, clearing token:', tab.displayPath, err.message);
            tab.fileToken = null;
            tab.expectedMtimeMs = null;
          }
        });
      }
      return { exists: true, data };
    } catch (err) {
      log.error('[EditorCache] load failed:', err.message);
      return { exists: false, message: err.message };
    }
  });

  ipcMain.handle('editor-clear-cache', async () => {
    try {
      const config = loadConfig();
      const rootPath = config.storagePath || APP_DIR;
      const cacheFile = path.join(rootPath, '.tmp', 'editor', 'cache.json');
      if (fs.existsSync(cacheFile)) {
        fs.unlinkSync(cacheFile);
      }
      return { success: true };
    } catch (err) {
      log.error('[EditorCache] clear failed:', err.message);
      return { success: false, message: err.message };
    }
  });

  // ===== 编辑器文件树 =====
  // 列出指定目录的内容
  ipcMain.handle('editor-list-directory', async (event, dirPath) => {
    try {
      if (!dirPath || !fs.existsSync(dirPath)) {
        return { exists: false, files: [] };
      }
      const stat = fs.statSync(dirPath);
      if (!stat.isDirectory()) {
        return { exists: false, files: [] };
      }
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const files = entries
        .filter(entry => !entry.name.startsWith('.')) // 忽略隐藏文件
        .map(entry => ({
          name: entry.name,
          path: path.join(dirPath, entry.name),
          isDirectory: entry.isDirectory(),
          size: entry.isFile() ? fs.statSync(path.join(dirPath, entry.name)).size : 0,
          mtimeMs: entry.isFile() ? fs.statSync(path.join(dirPath, entry.name)).mtimeMs : 0
        }));
      // 排序：文件夹在前，文件在后，按名称字母序
      files.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });
      return { exists: true, files };
    } catch (err) {
      log.error('[EditorFileTree] list failed:', err.message);
      return { exists: false, files: [], message: err.message };
    }
  });

  // 根据文件令牌获取所在目录路径
  ipcMain.handle('editor-get-file-directory', async (event, fileToken) => {
    try {
      const filePath = editorFileService.resolveToken(fileToken);
      const dirPath = path.dirname(filePath);
      if (fs.existsSync(dirPath)) {
        return { exists: true, dirPath };
      }
      return { exists: false, dirPath: null };
    } catch (err) {
      log.error('[EditorFileTree] get directory failed:', err.message);
      return { exists: false, dirPath: null, message: err.message };
    }
  });

  // 唤起系统终端，定位到当前文件目录；无则回退知识库根目录（跨平台）
  ipcMain.handle('editor-open-terminal', async (event, payload) => {
    try {
      const config = loadConfig();
      // 1) 优先使用当前打开文件所在目录
      let cwd = null;
      const fileToken = payload && payload.fileToken;
      if (fileToken) {
        try {
          const fp = editorFileService.resolveToken(fileToken);
          const dir = path.dirname(fp);
          if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) cwd = dir;
        } catch (e) { /* 忽略，回退 */ }
      }
      // 2) 无有效文件目录 → 回退知识库根目录（系统设置中的存储路径）
      if (!cwd) cwd = resolveVaultRoot(config);
      if (!cwd || !fs.existsSync(cwd)) {
        return { success: false, message: '无法确定有效目录' };
      }

      // 3) 跨平台唤起系统终端
      if (process.platform === 'darwin') {
        // macOS：open -a Terminal <dir> 以该目录为工作目录打开新窗口
        spawn('open', ['-a', 'Terminal', cwd], { detached: true, stdio: 'ignore' })
          .unref();
      } else if (process.platform === 'win32') {
        // Windows：优先 Windows Terminal，失败回退 cmd.exe
        try {
          spawn('wt.exe', ['-d', cwd], { detached: true, stdio: 'ignore' }).unref();
        } catch (e) {
          spawn('cmd.exe', ['/k', 'cd', '/d', cwd], { detached: true, stdio: 'ignore' }).unref();
        }
      } else {
        // Linux/其它：x-terminal-emulator（多发行版通用），以 cwd 为工作目录
        spawn('x-terminal-emulator', [], { detached: true, stdio: 'ignore', cwd }).unref();
      }
      log.info('[EditorTerminal] opened terminal at', cwd);
      return { success: true, cwd };
    } catch (err) {
      log.error('[EditorTerminal] open failed:', err.message);
      return { success: false, message: err.message };
    }
  });

  // 通过文件路径打开文件
  ipcMain.handle('editor-open-file-by-path', async (event, filePath) => {
    try {
      if (!filePath || !fs.existsSync(filePath)) {
        return { canceled: true, message: '文件不存在' };
      }
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        return { canceled: true, message: '无法打开目录' };
      }
      const opened = editorFileService.openPath(filePath);
      log.info('[EditorFileTree] opened', opened.fileName, opened.size);
      return opened;
    } catch (err) {
      log.error('[EditorFileTree] open by path failed:', err.message);
      return { canceled: true, message: err.message };
    }
  });

  // ===== 编辑器双链（wikilink）目标索引 =====
  // 扫描知识根目录（vault root）下所有 .md，返回 basename + 相对路径 + 绝对路径，
  // 供前端双链补全、反链与跳转使用。
  // 解析知识根目录（vault root）：兼容 config.organizedPath（旧格式显式指定）与
  // config.storagePath（Clip_Bed 父目录，clip-organized 为固定子目录，新格式）。
  function resolveVaultRoot(config) {
    const candidates = [];
    if (config.organizedPath) candidates.push(config.organizedPath);
    if (config.storagePath) {
      candidates.push(path.join(config.storagePath, 'clip-organized'));
      candidates.push(config.storagePath); // 兼容 storagePath 直接指向 clip-organized
    }
    for (const c of candidates) {
      if (c && fs.existsSync(c) && fs.statSync(c).isDirectory()) return c;
    }
    return candidates[0] || path.join(config.storagePath || APP_DIR, 'clip-organized');
  }

  // Obsidian Vault 根路径：对齐后端 WikiConfig 默认 vault-path=./obsidian-vault 的解析语义
  // （相对路径以 Clip_Bed 父目录为基准）。config.storagePath 存 Clip_Bed 父目录，
  // 兼容其直接指向 clip-storage 的旧写法。
  function resolveObsidianVaultRoot(config) {
    const sp = config.storagePath || APP_DIR;
    const base = (sp.endsWith('clip-storage') || sp.endsWith('clip-storage\\'))
      ? path.dirname(sp)
      : sp;
    return path.join(base, 'obsidian-vault');
  }

  // 多模块 + 多类型索引：以 config.storagePath 为父目录，自动发现其下所有含
  // 「可链接文本文件」的一级子目录作为独立模块（clip-organized / clip-weekly-report /
  // obsidian-vault / tmp 等），每个模块各自维护「目标列表 + 反链反向索引」，
  // 通过 fs.watch 监听变化自动失效重建；watch 不可用时以 TTL 兜底，
  // 避免每次反链刷新/补全请求都全量读盘，显著降低反链同步延迟。
  // 可链接类型：md + 编辑器可打开的文本类型（txt/sql/json/xml/csv/log/yaml 等）。
  const LINKABLE_EXT_RE = /\.(md|mdown|markdown|txt|sql|json|xml|csv|log|yaml|yml|ini|conf)$/i;
  // 排除模块：原始存档目录 + 运行时/构建/依赖等重目录，避免补全被海量非内容文件污染、拖慢唤醒扫描。
  const EXCLUDED_MODULE_DIRS = [
    'clip-storage',
    '.dsh', 'node_modules', 'jre', 'jre-slim',
    'dist-electron', 'dist-dsh-offline', 'dist', 'build', 'out',
    'backend', 'frontend', 'electron', 'scripts', 'test', 'docs',
    'tmp', 'integrations', 'browser-extension', 'TODO', 'jlink-target'
  ];
  const LINK_INDEX_TTL = 3000;            // 模块 watch 不可用时的 TTL 兜底（毫秒）
  const LINK_INDEX_SCAN_MAX_BYTES = 10 * 1024 * 1024; // 反链扫描大小守卫（>10MB 只作目标）

  let wikilinkModules = {};               // id -> { id, name, root, targets, reverse, builtAt, watcher, watchTimer }
  let wikilinkModulesParent = null;       // 当前发现所用的父目录
  let wikilinkModulesDiscoveredAt = 0;    // 最近一次模块发现时间
  let wikilinkModulesWatcher = null;      // 父目录监听（模块新增/删除）
  let wikilinkModulesTimer = null;

  /** 递归判断目录下是否存在 ≥1 个可链接文本文件 */
  function dirHasLinkableFile(dir) {
    let found = false;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        if (entry.isDirectory()) {
          if (dirHasLinkableFile(path.join(dir, entry.name))) { found = true; break; }
        } else if (entry.isFile() && LINKABLE_EXT_RE.test(entry.name)) {
          found = true; break;
        }
      }
    } catch (e) { /* ignore */ }
    return found;
  }

  /** 关闭单个模块的 watcher 与计时器 */
  function closeModuleWatcher(mod) {
    if (!mod) return;
    if (mod.watchTimer) { clearTimeout(mod.watchTimer); mod.watchTimer = null; }
    if (mod.watcher) { try { mod.watcher.close(); } catch (e) { /* ignore */ } mod.watcher = null; }
  }

  /** 为单个模块构建「目标列表 + 反向索引」（所有可链接文本文件都解析 [[...]]，真正双向） */
  function buildModuleIndex(mod) {
    const targets = [];
    const reverse = Object.create(null);
    const linkRe = /\[\[([^\[\]\n]+)\]\]/g;
    if (fs.existsSync(mod.root)) {
      const walk = (dir, relPrefix) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          const abs = path.join(dir, entry.name);
          const rel = relPrefix ? path.join(relPrefix, entry.name) : entry.name;
          if (entry.isDirectory()) { walk(abs, rel); continue; }
          if (!entry.isFile() || !LINKABLE_EXT_RE.test(entry.name)) continue;
          const basename = path.basename(entry.name, path.extname(entry.name));
          const fileName = entry.name;
          const relativePath = rel.split(path.sep).join('/');
          targets.push({ moduleId: mod.id, moduleName: mod.name, basename, fileName, relativePath, absolutePath: abs });
          // 反链扫描：大小守卫 + 解析该文件内所有 [[链接]]，按链接 basename 建立反向索引
          let stat;
          try { stat = fs.statSync(abs); } catch (e) { continue; }
          if (stat.size > LINK_INDEX_SCAN_MAX_BYTES) continue;
          let content;
          try { content = fs.readFileSync(abs, 'utf-8'); } catch (e) { continue; }
          const lines = content.split('\n');
          lines.forEach((line, idx) => {
            linkRe.lastIndex = 0;
            let m;
            while ((m = linkRe.exec(line)) !== null) {
              const raw = String(m[1]).trim();
              if (!raw) continue;
              const t = raw.split('|')[0].split('#')[0].trim(); // 去别名与锚点
              if (!t) continue;
              const key = t.split('/').pop().toLowerCase(); // 取 basename（含扩展名形式）
              if (!key) continue;
              const text = line.replace(/\t/g, '    ').trim();
              const match = { lineNumber: idx + 1, text: text.length > 240 ? text.substring(0, 240) + '…' : text };
              if (!reverse[key]) reverse[key] = [];
              const arr = reverse[key];
              // 同一文件的多行匹配合并到一个 backlink 条目
              const last = arr[arr.length - 1];
              if (last && last.absolutePath === abs) {
                last.matches.push(match);
              } else {
                arr.push({
                  moduleId: mod.id,
                  moduleName: mod.name,
                  fileName,
                  basename,
                  absolutePath: abs,
                  relativePath,
                  matches: [match]
                });
              }
            }
          });
        }
      };
      walk(mod.root, '');
    }
    mod.targets = targets;
    mod.reverse = reverse;
    mod.builtAt = Date.now();
  }

  /** 为单个模块建立递归 watcher（不可用则走 TTL 兜底） */
  function setupModuleWatcher(mod) {
    closeModuleWatcher(mod);
    try {
      mod.watcher = fs.watch(mod.root, { recursive: true }, () => {
        if (mod.watchTimer) clearTimeout(mod.watchTimer);
        mod.watchTimer = setTimeout(() => {
          mod.watchTimer = null;
          buildModuleIndex(mod);
        }, 500);
      });
    } catch (e) {
      log.warn('[EditorWikilink] recursive watch unavailable for module', mod.id, ':', e.message);
    }
  }

  /** 发现模块清单并与 wikilinkModules 同步（新增构建、删除关闭、变更重建） */
  function discoverAndSyncModules(config, parentDir) {
    const discovered = [];
    if (parentDir && fs.existsSync(parentDir)) {
      const entries = fs.readdirSync(parentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        if (EXCLUDED_MODULE_DIRS.indexOf(entry.name) !== -1) continue;
        const root = path.join(parentDir, entry.name);
        if (!dirHasLinkableFile(root)) continue;
        discovered.push({ id: entry.name, name: entry.name, root });
      }
    }
    // 显式纳入 Obsidian Vault（Web Clipper sources 源文件所在），
    // 即使 vault 未落在 storagePath 一级子目录也能进入双向链接/快速打开索引。
    const vaultRoot = resolveObsidianVaultRoot(config);
    if (vaultRoot && !discovered.some(m => path.normalize(m.root) === path.normalize(vaultRoot))) {
      if (dirHasLinkableFile(vaultRoot)) {
        discovered.push({ id: 'obsidian-vault', name: 'obsidian-vault', root: vaultRoot });
      }
    }
    // 兜底：无任何模块 → 回退 resolveVaultRoot 单一模块，保证兼容
    if (discovered.length === 0) {
      const root = resolveVaultRoot(config);
      if (root) discovered.push({ id: 'default', name: '默认', root });
    }
    // 关闭已消失模块的 watcher
    for (const id of Object.keys(wikilinkModules)) {
      if (!discovered.some(m => m.id === id)) closeModuleWatcher(wikilinkModules[id]);
    }
    // 同步模块表（根变化才重建索引）
    const next = {};
    for (const d of discovered) {
      let mod = wikilinkModules[d.id];
      if (!mod || mod.root !== d.root) {
        if (mod) closeModuleWatcher(mod);
        mod = { id: d.id, name: d.name, root: d.root, targets: [], reverse: Object.create(null), builtAt: 0, watcher: null, watchTimer: null };
      } else {
        mod.name = d.name;
      }
      if (!mod.builtAt) {
        buildModuleIndex(mod);
        setupModuleWatcher(mod);
      }
      next[d.id] = mod;
    }
    wikilinkModules = next;
    wikilinkModulesParent = parentDir;
    wikilinkModulesDiscoveredAt = Date.now();
  }

  /** 监听父目录：模块新增/删除时防抖重新发现 */
  function setupModulesWatcher(parentDir) {
    if (wikilinkModulesWatcher) {
      try { wikilinkModulesWatcher.close(); } catch (e) { /* ignore */ }
      wikilinkModulesWatcher = null;
    }
    if (!parentDir || !fs.existsSync(parentDir)) return;
    try {
      wikilinkModulesWatcher = fs.watch(parentDir, () => {
        if (wikilinkModulesTimer) clearTimeout(wikilinkModulesTimer);
        wikilinkModulesTimer = setTimeout(() => {
          wikilinkModulesTimer = null;
          const config = loadConfig();
          discoverAndSyncModules(config, config.storagePath || APP_DIR);
        }, 500);
      });
    } catch (e) { /* ignore */ }
  }

  /** 确保索引就绪：发现模块 + 构建缺失模块 + TTL 兜底，返回聚合 targets 与模块列表 */
  function ensureWikilinkIndex() {
    const config = loadConfig();
    const parentDir = config.storagePath || APP_DIR;
    const needsDiscovery = wikilinkModulesParent !== parentDir
      || Object.keys(wikilinkModules).length === 0
      || Date.now() - wikilinkModulesDiscoveredAt > 5000;
    if (needsDiscovery) {
      discoverAndSyncModules(config, parentDir);
      setupModulesWatcher(parentDir);
    }
    // watch 不可用模块的 TTL 兜底刷新：改为异步（不阻塞本次唤醒返回），
    // 避免唤醒时同步全量递归扫盘导致卡顿。返回前先用内存中的旧索引兜底。
    scheduleStaleWikilinkRebuilds();
    return { targets: aggregateTargets(), modules: getModuleList() };
  }

  /** 对无 watch 且已过 TTL 的模块做防抖异步重建；同一模块仅排队一次。 */
  function scheduleStaleWikilinkRebuilds() {
    const now = Date.now();
    for (const id of Object.keys(wikilinkModules)) {
      const mod = wikilinkModules[id];
      if (!mod.watcher && now - mod.builtAt > LINK_INDEX_TTL && !mod.rebuildTimer) {
        mod.rebuildTimer = setTimeout(() => {
          mod.rebuildTimer = null;
          buildModuleIndex(mod);
          setupModuleWatcher(mod);
        }, 0);
      }
    }
  }

  /** 聚合所有模块的 targets */
  function aggregateTargets() {
    const out = [];
    for (const id of Object.keys(wikilinkModules)) {
      out.push.apply(out, wikilinkModules[id].targets);
    }
    return out;
  }

  /** 模块清单 [{id,name,root}] */
  function getModuleList() {
    return Object.keys(wikilinkModules).map(id => ({ id, name: wikilinkModules[id].name, root: wikilinkModules[id].root }));
  }

  /** 由绝对路径判断其所属模块（路径前缀最长匹配），未纳管返回 null */
  function getModuleIdByAbsPath(currentPath) {
    if (!currentPath) return null;
    const norm = path.normalize(currentPath);
    let best = null;
    let bestLen = -1;
    for (const id of Object.keys(wikilinkModules)) {
      const root = wikilinkModules[id].root;
      if (root && norm.indexOf(path.normalize(root) + path.sep) === 0 && root.length > bestLen) {
        best = id;
        bestLen = root.length;
      }
    }
    return best;
  }

  /** 聚合反链：同时按 basename 与 fileName（含扩展名）查各模块 reverse，去重/去自引用/就近排序 */
  function aggregateBacklinks(currentPath) {
    const fileName = currentPath ? path.basename(currentPath) : '';
    const basename = fileName.replace(/\.[^.]+$/, '');
    const keys = [];
    if (basename) keys.push(basename.toLowerCase());
    if (fileName && fileName.toLowerCase() !== basename.toLowerCase()) keys.push(fileName.toLowerCase());
    const seen = Object.create(null);
    const out = [];
    for (const id of Object.keys(wikilinkModules)) {
      const reverse = wikilinkModules[id].reverse || Object.create(null);
      for (const key of keys) {
        const arr = reverse[key];
        if (!arr) continue;
        for (const item of arr) {
          if (currentPath && path.normalize(item.absolutePath) === path.normalize(currentPath)) continue; // 自引用
          if (seen[item.absolutePath]) continue;
          seen[item.absolutePath] = true;
          out.push(item);
        }
      }
    }
    const currentModuleId = getModuleIdByAbsPath(currentPath);
    out.sort((a, b) => {
      const am = a.moduleId === currentModuleId ? 0 : 1;
      const bm = b.moduleId === currentModuleId ? 0 : 1;
      if (am !== bm) return am - bm;
      return a.relativePath.length - b.relativePath.length;
    });
    return out;
  }

  /** 解析链接目标（出链用）：相对路径精确 → fileName 精确 → basename 就近优先；无命中返回 null */
  function resolveTargetForLink(linkText, currentPath) {
    const t = String(linkText || '').trim();
    if (!t) return null;
    const all = aggregateTargets();
    if (t.indexOf('/') !== -1) {
      const rel = all.filter(x => x.relativePath === t);
      if (rel.length) return rel.length === 1 ? rel[0] : null;
    }
    const byFile = all.filter(x => x.fileName === t);
    if (byFile.length) return byFile.length === 1 ? byFile[0] : null;
    const byBase = all.filter(x => x.basename === t);
    if (byBase.length === 0) return null;
    if (byBase.length === 1) return byBase[0];
    const currentModuleId = getModuleIdByAbsPath(currentPath);
    byBase.sort((a, b) => {
      const am = a.moduleId === currentModuleId ? 0 : 1;
      const bm = b.moduleId === currentModuleId ? 0 : 1;
      if (am !== bm) return am - bm;
      return a.relativePath.length - b.relativePath.length;
    });
    return byBase[0];
  }

  ipcMain.handle('editor-list-wikilink-targets', async () => {
    try {
      const index = ensureWikilinkIndex();
      return { targets: index.targets, modules: index.modules };
    } catch (err) {
      log.error('[EditorWikilink] list targets failed:', err.message);
      return { targets: [], modules: [], message: err.message };
    }
  });

  // ===== 编辑器保存到知识库（clip-organized/notes/{basename}.md）=====
  // 让编辑器文件的可解析 basename 全局进入 Obsidian 生态。
  ipcMain.handle('editor-save-to-vault', async (event, payload) => {
    try {
      const config = loadConfig();
      // 优先使用发现的 clip-organized 模块根；未发现则回退 resolveVaultRoot
      let vaultRoot = wikilinkModules['clip-organized'] ? wikilinkModules['clip-organized'].root : null;
      if (!vaultRoot) vaultRoot = resolveVaultRoot(config);
      const notesDir = path.join(vaultRoot, 'notes');
      if (!fs.existsSync(notesDir)) fs.mkdirSync(notesDir, { recursive: true });
      const text = payload?.text || '';
      const base = (payload?.basename || '未命名').replace(/[\\/:*?"<>|]/g, '_').trim() || '未命名';
      const filePath = path.join(notesDir, base + '.md');
      fs.writeFileSync(filePath, text, 'utf-8');
      log.info('[EditorWikilink] saved to vault', filePath);
      return { success: true, filePath };
    } catch (err) {
      log.error('[EditorWikilink] save to vault failed:', err.message);
      return { success: false, message: err.message };
    }
  });

  // ===== 编辑器模板系统（templates 目录，跟随知识库根）=====
  function resolveTemplatesDir() {
    const config = loadConfig();
    let vaultRoot = wikilinkModules['clip-organized'] ? wikilinkModules['clip-organized'].root : null;
    if (!vaultRoot) vaultRoot = resolveVaultRoot(config);
    const dir = path.join(vaultRoot, 'templates');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  // 列出模板（*.md / *.txt）
  ipcMain.handle('editor-list-templates', async () => {
    try {
      const dir = resolveTemplatesDir();
      const names = fs.readdirSync(dir)
        .filter(f => /\.(md|txt)$/i.test(f))
        .sort();
      return { success: true, dir, templates: names.map(n => ({ name: n, path: path.join(dir, n) })) };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  // 读取单个模板内容
  ipcMain.handle('editor-read-template', async (event, name) => {
    try {
      const dir = resolveTemplatesDir();
      const safe = String(name || '').replace(/[\\/:*?"<>|]/g, '_');
      if (!safe) throw new Error('模板名无效');
      const filePath = path.join(dir, safe);
      if (!filePath.startsWith(dir) || !fs.existsSync(filePath)) throw new Error('模板不存在：' + name);
      const content = fs.readFileSync(filePath, 'utf-8');
      return { success: true, content };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  // 保存模板（覆盖同名文件）
  ipcMain.handle('editor-save-template', async (event, payload) => {
    try {
      const name = String(payload?.name || '').replace(/[\\/:*?"<>|]/g, '_');
      if (!name) throw new Error('模板名无效');
      if (!/\.(md|txt)$/i.test(name)) throw new Error('模板仅支持 .md / .txt');
      const dir = resolveTemplatesDir();
      const filePath = path.join(dir, name);
      if (!filePath.startsWith(dir)) throw new Error('模板路径非法');
      fs.writeFileSync(filePath, payload?.content || '', 'utf-8');
      log.info('[EditorTemplate] saved', filePath);
      return { success: true, filePath };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  // ===== 编辑器双链反链搜索 =====
  // 基于 currentPath 推导 basename 与 fileName 双键查询，聚合各模块反向索引，
  // 过滤自引用并按就近优先排序，无需全量扫描。
  ipcMain.handle('editor-find-backlinks', async (event, currentPath) => {
    try {
      ensureWikilinkIndex();
      const backlinks = aggregateBacklinks(currentPath);
      log.info('[EditorWikilink] find backlinks for', currentPath, '| count=', backlinks.length);
      return { backlinks };
    } catch (err) {
      log.error('[EditorWikilink] find backlinks failed:', err.message);
      return { backlinks: [], message: err.message };
    }
  });

  // ===== 编辑器出链扫描 =====
  // 读取当前文件内容，解析其 [[链接]]，逐个解析到多模块目标（就近优先），
  // 返回目标解析结果与断链标记，供出链面板展示。
  ipcMain.handle('editor-find-outgoing', async (event, currentPath) => {
    try {
      if (!currentPath || !fs.existsSync(currentPath)) {
        return { outgoing: [], message: '当前文档尚未保存，无法扫描出链' };
      }
      const content = fs.readFileSync(currentPath, 'utf-8');
      const linkRe = /\[\[([^\[\]\n]+)\]\]/g;
      const seen = Object.create(null);
      const outgoing = [];
      let m;
      while ((m = linkRe.exec(content)) !== null) {
        const raw = String(m[1]).trim();
        if (!raw) continue;
        const t = raw.split('|')[0].split('#')[0].trim(); // 去别名与锚点
        if (!t) continue;
        if (seen[t]) continue;
        seen[t] = true;
        const resolved = resolveTargetForLink(t, currentPath);
        outgoing.push({
          target: t,
          resolved: resolved ? { moduleId: resolved.moduleId, moduleName: resolved.moduleName, basename: resolved.basename, fileName: resolved.fileName, relativePath: resolved.relativePath, absolutePath: resolved.absolutePath } : null,
          missing: !resolved
        });
      }
      return { outgoing };
    } catch (err) {
      log.error('[EditorWikilink] find outgoing failed:', err.message);
      return { outgoing: [], message: err.message };
    }
  });

  // ===== 编辑器自动保存 =====
  ipcMain.handle('editor-autosave-file', async (event, payload) => {
    try {
      const { fileToken, text, encoding, lineEnding } = payload || {};
      if (!fileToken) {
        return { error: 'No file token provided' };
      }
      const saved = editorFileService.save(fileToken, {
        text,
        encoding: encoding || 'UTF-8',
        lineEnding: lineEnding || 'LF'
      });
      if (saved.conflict) {
        log.warn('[EditorAutosave] conflict detected for', saved.fileName);
        return { error: 'File conflict detected' };
      }
      log.info('[EditorAutosave] saved', saved.fileName, saved.size);
      return { success: true, mtimeMs: saved.mtimeMs };
    } catch (err) {
      log.error('[EditorAutosave] failed:', err.message);
      return { error: err.message };
    }
  });
  // 将上传的图标保存到本地文件系统，覆盖原预设图标文件
  ipcMain.handle('save-mascot-image', async (event, { characterId, action, dataUrl }) => {
    try {
      if (!characterId || !action || !dataUrl) {
        return { success: false, message: '参数不完整' };
      }
      // 解码 base64 数据 URL（格式: data:image/png;base64,xxxx）
      const matches = dataUrl.match(/^data:image\/\w+;base64,(.+)$/);
      if (!matches) {
        return { success: false, message: '无效的图片数据格式' };
      }
      const buffer = Buffer.from(matches[1], 'base64');
      const mascotDir = path.join(APP_DIR, 'frontend', 'assets', 'mascot', characterId);
      if (!fs.existsSync(mascotDir)) {
        fs.mkdirSync(mascotDir, { recursive: true });
      }
      const filePath = path.join(mascotDir, action + '.png');
      fs.writeFileSync(filePath, buffer);
      log.info('[Mascot] saved mascot image:', filePath, `(${buffer.length} bytes)`);
      return { success: true, filePath };
    } catch (err) {
      log.error('[Mascot] save mascot image failed:', err.message);
      return { success: false, message: err.message };
    }
  });

  // 获取当前配置
  ipcMain.handle('get-config', async () => loadConfig());

  // 获取 Electron 配置文件信息（config.json 所在目录与完整路径）
  ipcMain.handle('get-config-path', async () => {
    ensureConfigDir();
    return {
      success: true,
      configDir: CONFIG_DIR,
      configPath: CONFIG_FILE,
      exists: fs.existsSync(CONFIG_FILE)
    };
  });

  // 打开 Electron 配置文件所在目录（供设置页面确认配置使用）
  ipcMain.handle('open-config-folder', async () => {
    try {
      ensureConfigDir();
      const error = await shell.openPath(CONFIG_DIR);
      if (error) {
        return { success: false, message: `打开目录失败: ${error}` };
      }
      return { success: true, configDir: CONFIG_DIR, configPath: CONFIG_FILE };
    } catch (e) {
      return { success: false, message: e.message };
    }
  });

  // 检查后端是否可用
  ipcMain.handle('check-backend', async (event, port) => await checkPort(port));

  // 剪藏转为待办事项
  ipcMain.handle('clip-to-todo', async (event, payload) => {
    try {
      const config = loadConfig();
      const result = await requestBackend(config, 'POST', '/api/clip/to-todo', payload || {});
      return { success: true, data: result };
    } catch (e) {
      return { success: false, message: `clip to todo failed: ${e.message}` };
    }
  });

  // 从剪藏派生知识
  ipcMain.handle('derive-knowledge', async (event, clipId, asyncMode = false) => {
    try {
      if (!clipId) {
        return { success: false, message: 'clipId is required' };
      }
      const config = loadConfig();
      // asyncMode 为 true 时添加 ?async=true 查询参数，后端异步处理
      const endpoint = `/api/knowledge/derive/${clipId}${asyncMode ? '?async=true' : ''}`;
      const result = await requestBackend(config, 'POST', endpoint);
      return { success: true, data: result };
    } catch (e) {
      return { success: false, message: `derive knowledge failed: ${e.message}` };
    }
  });

  // 重启后端服务（用于配置变更后重新加载）
  ipcMain.handle('restart-backend', async (event, config) => {
    // 保存新配置并标记为已配置
    const nextConfig = { ...config, configured: true };
    saveConfig(nextConfig);
    applyAutoStartSetting(nextConfig.autoStart);

    // 同步 model-config.json 到 storagePath
    syncModelConfigJson(config);

    // 停止旧服务
    stopBackend();
    stopFrontendServer();

    // 等待 3 秒确保旧进程完全退出
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 重新启动前端服务
    try {
      await startFrontendServer(config);
    } catch (e) {
      return { success: false, message: `Frontend restart failed: ${e.message}` };
    }

    // 重新启动后端服务
    try {
      await startBackend(config);
    } catch (e) {
      return { success: false, message: `Backend restart failed: ${e.message}` };
    }

    // 等待 Spring Boot 完全初始化（3 秒）
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 重新加载页面
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(`http://127.0.0.1:${config.frontendPort}`);
    } else {
      createMainWindow(config);
    }

    return { success: true, message: 'Services restarted' };
  });

  // 退出应用（从配置窗口调用）
  ipcMain.handle('quit-app', async () => {
    quitApp();
  });

  // ===== 无边框窗口控制 =====
  // 这些 IPC 由前端标题栏的按钮触发

  // 最小化窗口 → 最小化到任务栏（与 Alt+X 行为一致，任务栏按钮常驻、运行横线保留）
  ipcMain.handle('window-minimize', () => { mainWindow?.minimize(); });

  // 最大化/还原窗口切换
  ipcMain.handle('window-maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  // 关闭窗口 → 触发 close 事件 → 根据 closeToTray 决定行为
  ipcMain.handle('window-close', () => { mainWindow?.close(); });

  // 查询当前窗口是否最大化（前端用于显示对应图标）
  ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized() ?? false);

  // 全屏模式切换（编辑器 F11 全屏）
  ipcMain.handle('set-fullscreen', (event, enabled) => {
    if (mainWindow) {
      mainWindow.setFullScreen(enabled);
      return { success: true };
    }
    return { success: false, message: 'Main window not found' };
  });

  // ===== 原生标题栏 Overlay 主题同步 =====
  // 主窗口使用系统原生标题栏（macOS hiddenInset / Windows hidden + titleBarOverlay）。
  // Windows 的 titleBarOverlay 按钮（最小化/最大化/关闭）底色与符号色需跟随前端当前主题，
  // 由渲染进程在加载完成与每次主题切换时通过本 IPC 同步；macOS 无 Overlay，此处为 no-op。
  ipcMain.on('window-set-overlay', (event, overlay) => {
    if (process.platform === 'win32' && mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.setTitleBarOverlay({
          color: overlay.color, symbolColor: overlay.symbolColor, height: 38
        });
      } catch (e) { /* Overlay 同步失败静默忽略 */ }
    }
  });

  // 清除浏览器缓存（设置页「清除缓存」按钮调用）
  ipcMain.handle('clear-cache', async () => {
    try {
      await session.defaultSession.clearCache();
      // 同时清除 localStorage 和 sessionStorage
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.session.clearStorageData({
          storages: ['localstorage', 'sessionstorage', 'caches', 'indexdb', 'serviceworkers']
        });
      }
      log.info('[Cache] Browser cache cleared');
      // 联动清理未被引用的临时图片（media 孤儿：上传但未提交剪藏的图片），
      // 避免临时上传文件在 media/ 中永久残留。
      let cleanedCount = 0;
      try {
        const res = await fetch('http://127.0.0.1:' + (config.backendPort || 8081) + '/api/media/cleanup-orphans', { method: 'POST' });
        if (res.ok) {
          const data = await res.json();
          cleanedCount = (data && data.cleanedCount) || 0;
        }
        log.info('[Cache] Orphan media cleaned: ' + cleanedCount);
      } catch (err) {
        log.warn('[Cache] Orphan media cleanup failed: ' + err.message);
      }
      return { success: true, cleanedCount: cleanedCount };
    } catch (e) {
      log.error('[Cache] Clear failed:', e.message);
      return { success: false, message: e.message };
    }
  });

  // 强制刷新页面（忽略缓存，Ctrl+Shift+R 触发）
  ipcMain.handle('force-reload', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.reloadIgnoringCache();
    }
  });

  // ===== 日志 =====
  ipcMain.handle('log-to-file', async (event, payload) => {
    const { level, message } = payload;
    if (level === 'error') log.error('[Frontend]', message);
    else if (level === 'warn') log.warn('[Frontend]', message);
    else log.info('[Frontend]', message);
  });

  // ===== 更新管理 =====

  // 获取当前版本号
  ipcMain.handle('get-version', async () => updateManager.getCurrentVersion());

  // 获取更新配置
  ipcMain.handle('get-update-config', async () => updateManager.loadUpdateConfig());

  // 保存更新配置
  ipcMain.handle('save-update-config', async (event, config) => {
    updateManager.saveUpdateConfig(config);
    // 重启定时器以应用新频率
    updateManager.stopAutoCheck();
    updateManager.startAutoCheck(async () => {
      await checkForUpdates(true);
    });
    return { success: true };
  });

  // 手动检查更新
  ipcMain.handle('check-for-update', async () => {
    try {
      return await checkForUpdates(false);
    } catch (e) {
      return { hasUpdate: false, message: '检查失败: ' + e.message };
    }
  });

  // 开始下载并应用更新
  ipcMain.handle('download-and-apply-update', async (event, payload) => {
    // payload: { downloadUrl, sha256 } 或兼容旧的字符串 downloadUrl
    const downloadUrl = typeof payload === 'string' ? payload : (payload && payload.downloadUrl);
    const expectedSha256 = typeof payload === 'object' && payload ? (payload.sha256 || null) : null;

    if (!downloadUrl) {
      return { success: false, message: '更新失败: 缺少下载地址' };
    }

    try {
      // 通过 IPC 事件向渲染进程发送进度
      const sendProgress = (msg, percent) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('update-progress', { message: msg, percent });
        }
      };

      // 候选下载地址：GitHub 原地址 + gh-proxy 镜像兜底
      const candidates = updateManager.buildDownloadCandidates(downloadUrl);

      const isExe = downloadUrl.toLowerCase().endsWith('.exe');

      if (isExe) {
        // EXE 安装包：下载后打开，提示用户手动安装
        log.info('[Update] Downloading EXE installer:', downloadUrl);
        sendProgress('正在下载安装包...', 0);
        const exePath = await updateManager.downloadUpdateWithFallback(candidates, (received, total, percent, source) => {
          const sizeMB = (received / 1024 / 1024).toFixed(1);
          const totalMB = total > 0 ? (total / 1024 / 1024).toFixed(1) : '?';
          const prefix = percent === 0 && received === 0 ? `正在从 ${source} 下载安装包...` : `正在从 ${source} 下载安装包... ${sizeMB}MB / ${totalMB}MB`;
          sendProgress(prefix, Math.min(percent, 90));
        }, expectedSha256);
        sendProgress('下载完成，即将打开安装包...', 100);
        updateManager.recordCheckTime();
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-complete');
          }
          shell.openPath(exePath);
        }, 1000);
        return { success: true };
      }

      // ZIP 更新包：下载后解压替换 resources
      sendProgress('正在下载更新...', 0);

      const zipPath = await updateManager.downloadUpdateWithFallback(candidates, (received, total, percent, source) => {
        if (percent === 0 && received === 0) {
          sendProgress(`正在从 ${source} 下载更新...`, 0);
          return;
        }
        const sizeMB = (received / 1024 / 1024).toFixed(1);
        const totalMB = total > 0 ? (total / 1024 / 1024).toFixed(1) : '?';
        sendProgress(`正在从 ${source} 下载更新... ${sizeMB}MB / ${totalMB}MB`, Math.min(percent, 65));
      }, expectedSha256);

      sendProgress('正在应用更新...', 70);

      await updateManager.applyUpdate(zipPath, sendProgress);

      updateManager.recordCheckTime();

      sendProgress('更新完成，即将重启...', 100);

      // 延迟 1.5 秒后重启
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('update-complete');
        }
        // 重启应用
        app.relaunch();
        app.exit(0);
      }, 1500);

      return { success: true };
    } catch (e) {
      log.error('[Update] Download and apply failed:', e.message);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-error', e.message);
      }
      return { success: false, message: '更新失败: ' + e.message };
    }
  });
}

// ==================== 剪贴板 & 全局快捷键 ====================

// 全局快捷键状态
let shortcutAccelerator = 'Alt+X';
let shortcutEnabled = true;

/** 注册全局快捷键 */
function registerGlobalShortcut() {
  if (!shortcutEnabled) return;
  globalShortcut.unregisterAll();
  try {
    const ret = globalShortcut.register(shortcutAccelerator, () => {
      // 窗口异常不存在时（应用未退出但主窗口被销毁）：重建/复用同一应用窗口，
      // 保证快捷键始终作用于"同一个任务栏应用"，不产生第二个图标。
      if (!mainWindow || mainWindow.isDestroyed()) {
        log.warn('[Shortcut] mainWindow missing, recreating (same app instance)');
        const config = loadConfig();
        createMainWindow(config);
        return;
      }
      // Alt+X 为"切换最小化/唤醒"：可见时最小化到任务栏（按钮与运行横线保留），
      // 最小化或隐藏时唤醒。不用 hide()，避免任务栏按钮和横线消失造成"应用被杀"错觉。
      if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
        log.info('[Shortcut] Minimize to taskbar:', shortcutAccelerator);
        mainWindow.minimize();
      } else {
        log.info('[Shortcut] Show window:', shortcutAccelerator);
        showMainWindow();
      }
    });
    if (!ret) log.warn('[Shortcut] Registration failed:', shortcutAccelerator);
  } catch (e) { log.warn('[Shortcut] Error:', e.message); }
  // 联动注册截图小工具快捷键（F1/F2），避免 unregisterAll 清掉后丢失
  try { screenshotService.refreshShortcuts(); } catch (e) { log.warn('[Shortcut] screenshot shortcuts:', e.message); }
}

/** 注销全局快捷键 */
function unregisterGlobalShortcut() {
  globalShortcut.unregisterAll();
}

/** 从 config.json 加载快捷键配置 */
function loadShortcutFromConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      if (config.shortcut) {
        shortcutEnabled = config.shortcut.enabled !== false;
        shortcutAccelerator = config.shortcut.accelerator || 'CommandOrControl+Shift+Z';
      }
    }
  } catch (e) { log.warn('[Shortcut] Failed to load config:', e.message); }
}

// 剪贴板读取
ipcMain.handle('read-clipboard', () => clipboard.readText());

// 在文件管理器中显示
ipcMain.handle('show-item-in-folder', async (event, filePath) => {
  if (!filePath || typeof filePath !== 'string') return;
  try {
    await shell.showItemInFolder(filePath);
  } catch (e) {
    log.warn('[show-item-in-folder] Failed:', filePath, e.message);
  }
});

// 快捷键配置
ipcMain.handle('get-shortcut-config', () => {
  return { enabled: shortcutEnabled, accelerator: shortcutAccelerator };
});
ipcMain.handle('set-shortcut-config', (event, config) => {
  shortcutEnabled = config.enabled !== false;
  if (config.accelerator) shortcutAccelerator = config.accelerator;
  // 持久化到 config.json
  try {
    const existingConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    existingConfig.shortcut = { enabled: shortcutEnabled, accelerator: shortcutAccelerator };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(existingConfig, null, 2));
  } catch (e) { log.warn('[Shortcut] Failed to persist config:', e.message); }
  if (shortcutEnabled) {
    registerGlobalShortcut();
  } else {
    unregisterGlobalShortcut();
  }
  return { success: true };
});

// ==================== 更新检查逻辑 ====================

/**
 * 检查更新（自动或手动触发）。
 * 
 * 自动模式（silent=true）：仅在后台检查，有更新时通过托盘通知提示。
 * 手动模式（silent=false）：返回详细结果供前端展示。
 * 
 * @param {boolean} silent - true=自动静默检查，false=手动检查（返回详细信息）
 * @returns {Promise<Object>} 更新检查结果
 */
async function checkForUpdates(silent = true) {
  const currentVersion = updateManager.getCurrentVersion();
  log.info(`[Update] Checking for updates (current: ${currentVersion}, silent: ${silent})`);

  let result = null;

  // 方案 1：后端 /api/update/check（带 10 分钟缓存，正常路径）
  try {
    const config = loadConfig();
    const url = `http://127.0.0.1:${config.backendPort}/api/update/check?currentVersion=${encodeURIComponent(currentVersion)}`;
    const body = await httpGet(url);
    result = JSON.parse(body);
  } catch (e) {
    log.error('[Update] Backend check failed, falling back to direct GitHub:', e.message);
    // 方案 2：后端不可达时直连 GitHub Releases API（代理 + token，无本地缓存）
    try {
      const release = await updateManager.checkLatestRelease();
      if (release && release.version) {
        const hasUpdate = updateManager.compareVersions(release.version, currentVersion) > 0;
        result = {
          hasUpdate,
          latestVersion: release.version,
          currentVersion,
          releaseNotes: release.notes,
          releaseUrl: release.releaseUrl,
          downloadUrl: release.downloadUrl,
          sha256: release.sha256 || null,
          size: release.size || 0,
          message: hasUpdate ? `发现新版本 v${release.version}` : '已是最新版本'
        };
      }
    } catch (e2) {
      log.error('[Update] Direct GitHub check failed:', e2.message);
    }
  }

  if (!result) {
    if (!silent) {
      return { hasUpdate: false, currentVersion, message: '无法连接到更新服务，请检查网络后重试' };
    }
    return { hasUpdate: false };
  }

  if (result.hasUpdate) {
    updateManager.recordCheckTime();
    log.info(`[Update] New version available: ${result.latestVersion}`);
    // 自动检查（silent）时：发送事件 + 系统通知（用户可能不在设置页）
    if (silent) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-available', {
          version: result.latestVersion,
          currentVersion,
          notes: result.releaseNotes,
          releaseUrl: result.releaseUrl,
          downloadUrl: result.downloadUrl,
          sha256: result.sha256
        });
      }
      // 系统通知，确保用户看到新版本提示
      showNotification('发现新版本', `CutShelter v${result.latestVersion} 已可用，请到「设置 → 软件更新」查看并更新`);
    }
    return {
      hasUpdate: true,
      version: result.latestVersion,
      latestVersion: result.latestVersion,
      currentVersion,
      releaseNotes: result.releaseNotes,
      releaseUrl: result.releaseUrl,
      downloadUrl: result.downloadUrl,
      sha256: result.sha256 || null,
      size: result.size || 0,
      message: `发现新版本 v${result.latestVersion}`
    };
  }

  updateManager.recordCheckTime();
  return {
    hasUpdate: false,
    currentVersion,
    latestVersion: result.latestVersion,
    message: result.message || '已是最新版本'
  };
}

/**
 * 简单的 HTTP GET 请求（仅用于本地回环，无需代理）。
 * @param {string} url - 请求 URL
 * @returns {Promise<string>} 响应体
 */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      timeout: 10000
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

/**
 * 简单的 HTTP PUT 请求（仅用于本地回环，标记 reminderFired）。
 * @param {string} url - 请求 URL
 * @returns {Promise<string>} 响应体
 */
function httpPut(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: 'PUT',
      timeout: 5000
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// ==================== 提醒调度器 ====================

/** 提醒调度器定时器引用 */
let reminderTimer = null;

/** 当前存活的待办提醒 toast 窗口（alwaysOnTop + skipTaskbar 极简临时窗口）。
 *  退出时强制 destroy，防止其 renderer 繁忙时阻塞 app.quit()。 */
let toastWindows = [];

/** 强制销毁所有待办提醒 toast 窗口，@see toastWindows */
function destroyTransientToasts() {
  for (const w of toastWindows) {
    try { if (w && !w.isDestroyed()) w.destroy(); } catch (e) {}
  }
  toastWindows = [];
}

/**
 * 弹出系统原生通知（Windows 使用 node-notifier，macOS 使用 Electron Notification）。
 * @param {string} title - 通知标题
 * @param {string} body - 通知正文
 */
function showNotification(title, body) {
  return new Promise((resolve) => {
    const { screen } = require('electron');
    const display = screen.getPrimaryDisplay();
    const { width, height } = display.workAreaSize;

    const toastWidth = 380;
    const toastHeight = 160;
    const margin = 24;

    const toastWin = new BrowserWindow({
      width: toastWidth,
      height: toastHeight,
      x: width - toastWidth - margin,
      y: height - toastHeight - margin,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      transparent: true,
      focusable: false,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    const safeTitle = (title || 'Todo Reminder').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const safeBody = (body || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; user-select: none; }
  body {
    background: transparent;
    height: 100vh;
    overflow: hidden;
    font-family: 'Noto Sans SC', 'Microsoft YaHei', sans-serif;
  }
  .card {
    background: linear-gradient(135deg, rgba(28, 28, 34, 0.97), rgba(20, 20, 26, 0.97));
    backdrop-filter: blur(20px);
    border-radius: 16px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.03);
    height: 100%;
    display: flex;
    overflow: hidden;
    position: relative;
    animation: slideIn 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .accent-bar {
    width: 4px;
    background: linear-gradient(180deg, #f0a030, #ff6b3a);
    flex-shrink: 0;
  }
  .content {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 18px 20px 16px 18px;
    min-width: 0;
  }
  .header-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }
  .bell-icon {
    width: 28px; height: 28px;
    border-radius: 8px;
    background: linear-gradient(135deg, rgba(240, 160, 48, 0.25), rgba(255, 107, 58, 0.15));
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  .bell-icon svg {
    width: 16px; height: 16px;
    stroke: #f0a030;
    fill: none;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .title {
    font-size: 12px;
    font-weight: 500;
    color: #f0a030;
    letter-spacing: 0.5px;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .close-btn {
    width: 24px; height: 24px;
    border-radius: 6px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer;
    color: rgba(255, 255, 255, 0.3);
    transition: all 0.2s;
    flex-shrink: 0;
  }
  .close-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.8);
  }
  .close-btn svg { width: 12px; height: 12px; }
  .body-text {
    font-size: 14px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.95);
    line-height: 1.4;
    flex: 1;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .meta-text {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.4);
    margin-top: 6px;
  }
  @keyframes slideIn {
    from { transform: translateX(420px) scale(0.95); opacity: 0; }
    to { transform: translateX(0) scale(1); opacity: 1; }
  }
  .card.closing {
    animation: slideOut 0.3s cubic-bezier(0.4, 0, 1, 1) forwards;
  }
  @keyframes slideOut {
    to { transform: translateX(420px); opacity: 0; }
  }
</style>
</head>
<body>
  <div class="card" id="card">
    <div class="accent-bar"></div>
    <div class="content">
      <div class="header-row">
        <div class="bell-icon">
          <svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        </div>
        <div class="title">${safeTitle}</div>
        <div class="close-btn" id="closeBtn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
        </div>
      </div>
      <div class="body-text">${safeBody}</div>
      <div class="meta-text">Click the close button to dismiss</div>
    </div>
  </div>
  <script>
    document.getElementById('closeBtn').addEventListener('click', function() {
      var card = document.getElementById('card');
      card.classList.add('closing');
      setTimeout(function() { window.close(); }, 300);
    });
  </script>
</body>
</html>`;

    toastWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

    // 登记到全局存活列表，退出时统一强制销毁
    toastWindows.push(toastWin);

    toastWin.once('ready-to-show', () => {
      toastWin.show();
      log.info('[Reminder] Toast window shown');
    });

    toastWin.on('closed', () => {
      const idx = toastWindows.indexOf(toastWin);
      if (idx >= 0) toastWindows.splice(idx, 1);
      resolve();
    });
  });
}

/**
 * 启动待办提醒调度器。
 * 每 30 秒轮询后端 /api/todo/due-reminders 接口，
 * 对到期的提醒通过 Electron Notification API 弹出系统原生通知，
 * 然后标记 reminderFired=true 防止重复弹出。
 */
function startReminderScheduler() {
  log.info('[Reminder] >>> startReminderScheduler() called, reminderTimer=', !!reminderTimer);
  if (reminderTimer) {
    log.info('[Reminder] Scheduler already running, skipping');
    return;
  }

  const config = loadConfig();
  const baseUrl = `http://127.0.0.1:${config.backendPort}`;

  log.info('[Reminder] Scheduler started (interval: 30s)');

  const checkReminders = async () => {
    try {
      const url = `${baseUrl}/api/todo/due-reminders`;
      log.info('[Reminder] Polling ' + url + ' ...');
      const body = await httpGet(url);
      const reminders = JSON.parse(body);
      log.info('[Reminder] Polled ' + reminders.length + ' due reminders');

      if (!Array.isArray(reminders) || reminders.length === 0) return;

      for (const todo of reminders) {
        log.info('[Reminder] Found due: #' + todo.id + ' "' + (todo.title || '') + '" deadline=' + todo.deadline + ' ' + (todo.deadlineTime || '') + ' reminderMinutes=' + todo.reminderMinutes);
        try {
          // 先标记已触发，防止重复通知（在弹窗之前标记，避免轮询间隔内重复弹出）
          await httpPut(`${baseUrl}/api/todo/${todo.id}/reminder-fired`);
          log.info('[Reminder] Marked todo #' + todo.id + ' as fired');

          // 弹出通知（无需等待关闭即可继续下一次轮询）
          showNotification(todo.title || 'Todo Reminder', 'Deadline: ' + todo.deadline + ' ' + (todo.deadlineTime || ''));
          log.info('[Reminder] Notification sent for todo #' + todo.id + ': ' + (todo.title || ''));
        } catch (e) {
          log.error('[Reminder] Failed to send notification for todo #' + todo.id + ':', e.message);
        }
      }
    } catch (e) {
      log.error('[Reminder] Poll failed:', e.message);
    }
  };

  // 立即执行一次，然后每 30 秒轮询
  checkReminders();
  reminderTimer = setInterval(checkReminders, 30000);
}

/**
 * 停止提醒调度器
 */
function stopReminderScheduler() {
  if (reminderTimer) {
    clearInterval(reminderTimer);
    reminderTimer = null;
    log.info('[Reminder] Scheduler stopped');
  }
}

// ==================== macOS 系统事件 ====================

// macOS: 通过系统 open-file 事件接收双击文件打开
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (mainWindow && !mainWindow.isDestroyed()) {
    showMainWindow();
    mainWindow.webContents.send('open-file-request', filePath);
  }
});

// ==================== 单实例锁 ====================
// 防止用户点击任务栏图标或托盘菜单时启动第二个实例
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // app.quit() 是异步的——不会立即停止 js 执行！
  // 因此第二个实例仍会继续执行到 app.whenReady()，
  // 必须在那里也加退出检查（见下方 whenReady 入口），
  // 否则第二个实例会创建窗口，导致双任务栏图标。
  // 可见化：双击却"无反应"的最常见场景是已有实例在后台运行但窗口不可见（如云桌面会话冻结后残留）。
  log.error(
    '[Startup] Another instance is already running, quitting this one.'
    + ' If no window appears, check taskbar/notification area for a hidden CutShelter window,'
    + ' or end the leftover CutShelter.exe in Task Manager.'
  );
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // 已有实例正在运行：还原（若最小化）并聚焦主窗口
    if (mainWindow && !mainWindow.isDestroyed()) {
      log.info('[SecondInstance] Focusing existing window');
      // 加固：若旧窗口被最小化/隐藏（例如云桌面会话冻结后窗口不可见），
      // 二次启动强制还原并拉回前台，避免"双击无反应"的错觉。
      try {
        if (mainWindow.isMinimized()) mainWindow.restore();
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.focus();
      } catch (e) {
        log.warn('[SecondInstance] restore/show/focus failed:', e.message);
      }
      showMainWindow();
    } else if (!appStartupComplete) {
      // 启动流程进行中（主窗口尚未创建）：不重复创建窗口！
      // 否则会与 whenReady 流程里的 createMainWindow 各建一个窗口，
      // 产生两个任务栏图标。只标记"启动完成后自动显示"。
      log.info('[SecondInstance] Startup in progress, will show after ready');
      pendingShowAfterStart = true;
      return;
    } else {
      // 启动已完成但主窗口异常不存在：重建（应用未退出，仍是同一实例）
      log.warn('[SecondInstance] Recreating main window (same app instance)');
      const config = loadConfig();
      createMainWindow(config);
      return;
    }

    // 解析命令行参数（系统右键菜单等触发的二次启动），转发到渲染进程
    const actions = parseCommandLineArgs(commandLine, APP_DIR);
    if (actions.length > 0 && mainWindow && !mainWindow.isDestroyed()) {
      dispatchActions(actions, mainWindow);
    }
  });
}

// ==================== 应用生命周期 ====================

// 启动"阶梯(Ladder)"探针：记录每个启动阶段进入/完成时间，
// 内网/离线环境无法弹窗时，依据 app.log 里最后一条阶梯标记即可定位卡在哪一步。
const startupTimer = { t0: Date.now(), last: Date.now() };

/** 打印启动阶段标记，并在阶梯模式下保留到全局，供诊断脚本查询最后阶段 */
let startupStageReached = null;
function stepLadder(name) {
  const now = Date.now();
  startupStageReached = name;
  log.info(`[Ladder] step:${name} elapsed=${now - startupTimer.t0}ms gap=${now - startupTimer.last}ms`);
  startupTimer.last = now;
}

// 启动看门狗：若探针后长时间未创建主窗口也未见"Config loaded"，持续标记"仍无窗口"，
// 辅助区分"事件循环被同步大扫描占住"（CPU 高、标记零散）与"等待一个永不 resolve 的 Promise"。
let startupWatchdog = null;
function startStartupWatchdog() {
  if (startupWatchdog) return;
  startupWatchdog = setInterval(() => {
    const ms = Date.now() - startupTimer.t0;
    const windowCreated = !!mainWindow && !mainWindow.isDestroyed();
    const configLoaded = startupStageReached === 'config.after';
    if (windowCreated || appStartupComplete || configLoaded) {
      try { clearInterval(startupWatchdog); } catch (_) {}
      startupWatchdog = null;
      return;
    }
    log.warn(`[Ladder][STALL] no-window elapsed=${Math.round(ms / 1000)}s lastStage=${startupStageReached || 'none'}`);
  }, 10000);
}

app.whenReady().then(async () => {
  // 顶层兜底：whenReady 回调体内任何未被分段 catch 捕获的异常，都记录主进程异常日志，
  // 避免"只看到几个 Probe 日志然后静默停住"这类难以定位的情况。
  try {
  // 安全双保险：单实例锁未获取到（第二个实例），
  // app.quit() 已在上面调用但它是异步的——js 仍会继续执行到这里。
  // 必须立即 return，绝不创建任何窗口，否则第二个实例的窗口会
  // 产生双任务栏图标（即"最小化后唤醒又多出了新的任务栏图标"问题）。
  if (!gotTheLock) {
    log.info('[Startup] Second instance detected, aborting startup');
    return;
  }

  // Fix console Chinese encoding on Windows
  if (process.platform === 'win32') {
    try { require('child_process').execSync('chcp 65001', { stdio: 'ignore' }); } catch {}
  }

  // 清理 30 天前的旧日志
  log.cleanupOldLogs();

  // 启动探针：记录进入主流程，离线环境下据此定位"卡在哪一步"
  log.info('[Probe] whenReady entered; APP_DIR=' + APP_DIR + ', resourcesPath=' + resourcesPath);

  // 打包资源预检：一把列出关键资源是否存在，离线环境下据此判定"缺资源"类根因
  try {
    const res = resourcesPath;
    const probe = {
      'jre/bin/java.exe': !!fs.existsSync(path.join(res, 'jre', 'bin', 'java.exe')),
      'runtime/bin/java.exe': !!fs.existsSync(path.join(res, 'runtime', 'bin', 'java.exe')),
      'backend-jar': !!fs.existsSync(path.join(res, 'backend', 'clip-demo-0.0.1-SNAPSHOT.jar')),
      'frontend': !!fs.existsSync(path.join(res, 'frontend')),
      'integrations/dsh': !!fs.existsSync(path.join(res, 'integrations', 'dsh'))
    };
    log.info('[Probe] packaged resources:', JSON.stringify(probe));
  } catch (e) {
    log.warn('[Probe] resource check failed:', e.message);
  }
  stepLadder('probe');
  startStartupWatchdog();

  setupIPC();
  stepLadder('ipc.after');

  // 启动即清浏览器 HTTP 缓存：避免前端页面（设置页等）加载到旧版 JS/静态资源，
  // 防止「改了版本探测逻辑但界面仍走旧判断」这类缓存不一致问题。
  // 注意：clearCache 在个别内网/离线机器上会卡住或底层崩溃导致 exitCode=1，
  // 在此用超时降级（Promise.race）保护：超时/异常都只是跳过，绝不阻塞后续启动与建窗。
  stepLadder('cache.before');
  // clearTimer 需在 try/finally 外部声明，finally 才能正确引用并清理定时器
  let clearTimer = null;
  try {
    const CLEAR_CACHE_TIMEOUT_MS = 8000;
    const clearTimeoutPromise = new Promise((_, rej) => {
      clearTimer = setTimeout(() => rej(new Error('clearCache timeout exceeded')), CLEAR_CACHE_TIMEOUT_MS);
    });
    await Promise.race([session.defaultSession.clearCache(), clearTimeoutPromise]);
    clearTimeout(clearTimer);
    log.info('[Startup] Browser cache cleared on startup');
  } catch (e) {
    log.warn(`[Startup] clearCache skipped (${e.message}); continuing startup`);
  } finally {
    if (clearTimer) clearTimeout(clearTimer);
  }
  stepLadder('cache.after');

  // SQLite 本地索引层初始化（懒加载全量建索引，异步、不阻塞窗口；
  // 若 node:sqlite 在当前 Electron 不可用则降级跳过，不影响主流程）
  stepLadder('index.before');
  try {
    const _config = loadConfig();
    const _idxRes = localIndexService.initLocalIndex(_config.storagePath);
    stepLadder('index.after');
    log.info(`[local-index] initialized: count=${_idxRes.count}, generation=${_idxRes.generation}`);
    // 启动 clip-storage 实时监听：新增/修改/删除时增量重扫更新索引
    if (!localIndexWatcher) {
      localIndexWatcher = localIndexService.startWatcher(_config.storagePath, (d) => {
        log.info(
          `[local-index watcher] rescan done: added=${d.added}, updated=${d.updated}, removed=${d.removed}, count=${d.count}`
        );
      });
      if (localIndexWatcher && localIndexWatcher.started) {
        log.info('[local-index watcher] started watching clip-storage');
      } else if (localIndexWatcher) {
        log.warn('[local-index watcher] not started:', localIndexWatcher.reason);
      }
    }
    // 启动索引库周期维护（6h optimize / 24h VACUUM），退出时跟随 close 停止
    localIndexService.startMaintenance();
  } catch (e) {
    log.warn('[local-index] init skipped:', e.message);
  }
  try {
    screenshotService.initScreenshotService({
      app, BrowserWindow, globalShortcut, desktopCapturer, clipboard, nativeImage, ipcMain, screen, dialog, shell, log, systemPreferences,
      loadConfig, saveConfig,
      getMainWindow: () => mainWindow,
      showMainWindow: () => showMainWindow()
    });
  } catch (e) {
    log.error('[Screenshot] init failed:', e.message);
  }
  stepLadder('screenshot.after');

  // 预创建系统托盘图标（不等窗口创建）
  if (!tray) {
    createTray();
  }
  stepLadder('tray.after');

  // 迁移旧配置：如果旧路径存在配置但新路径不存在，自动复制
  const newConfigDir = path.join(app.getPath('userData'), 'config');

  // 旧路径 1：clip-demo → CutShelter
  const oldConfigDir1 = isWin
    ? path.join(os.homedir(), 'AppData', 'Roaming', 'clip-demo', 'config')
    : path.join(os.homedir(), '.clip-demo', 'config');
  if (fs.existsSync(oldConfigDir1) && !fs.existsSync(newConfigDir)) {
    try {
      fs.mkdirSync(newConfigDir, { recursive: true });
      for (const f of fs.readdirSync(oldConfigDir1)) {
        fs.copyFileSync(path.join(oldConfigDir1, f), path.join(newConfigDir, f));
      }
      log.info('[Config] Migrated from old location:', oldConfigDir1);
    } catch (e) {
      log.error('[Config] Migration failed:', e.message);
    }
  }

  // 旧路径 2：macOS 上之前硬编码的 Windows 风格路径 → 新路径 ~/.cut-shelter/
  if (!isWin) {
    const oldMacConfigDir = path.join(os.homedir(), 'AppData', 'Local', 'CutShelter', 'config');
    if (fs.existsSync(oldMacConfigDir) && !fs.existsSync(newConfigDir)) {
      try {
        fs.mkdirSync(newConfigDir, { recursive: true });
        for (const f of fs.readdirSync(oldMacConfigDir)) {
          fs.copyFileSync(path.join(oldMacConfigDir, f), path.join(newConfigDir, f));
        }
        log.info('[Config] Migrated from old macOS path:', oldMacConfigDir);
      } catch (e) {
        log.error('[Config] macOS migration failed:', e.message);
      }
    }
  }

  const config = loadConfig();
  stepLadder('config.after');
  log.info('Config loaded:', JSON.stringify(config, null, 2));

  // 修复旧版本可能写入的不完整 macOS 登录项（仅在用户已开启自启时校准）。
  // 否则系统可能只启动 Electron 可执行文件，落到 Electron 默认欢迎页。
  if (config.autoStart) {
    applyAutoStartSetting(true);
  }

  // 启动前清理端口上残留的旧进程（如上次崩溃未清理的）
  // 等待清理完成后再启动后端，避免端口仍在占用导致绑定失败
  await Promise.all([
    killPortProcess(config.backendPort),
    killPortProcess(config.frontendPort)
  ]);
  stepLadder('ports.after');

  if (!config.configured) {
    // ===== 首次运行：显示配置引导窗口 =====
    log.info('First run - showing config window');

    // 复用 mainWindow 变量指向配置窗口
    mainWindow = new BrowserWindow({
      width: 560, height: 700, resizable: false,
      frame: false,
      title: 'Clip - Setup',
      icon: path.join(__dirname, 'app-icon.png'),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      }
    });

    mainWindow.loadFile(path.join(__dirname, 'config.html'));
    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow.webContents.send('load-config', config);
      mainWindow.webContents.send('first-run', true);  // 通知前端进入首次运行模式
    });

    // 监听配置完成事件（由前端 config.html 发送）
    ipcMain.on('config-done', async (event, newConfig) => {
      log.info('Config done received:', JSON.stringify(newConfig, null, 2));
      const nextConfig = { ...newConfig, configured: true };
      saveConfig(nextConfig);
      applyAutoStartSetting(nextConfig.autoStart);

      // 首次运行：注册系统右键菜单（路径变化时自动重新注册）
      ensureContextMenuRegistered(nextConfig);

      // 同步 model-config.json 到 storagePath，保持与设置页面数据一致
      syncModelConfigJson(newConfig);

      // 向配置窗口发送启动进度提示
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('startup-progress', '正在启动前端服务...');
      }

      try {
        stepLadder('fe.before');
        await startFrontendServer(newConfig);
        stepLadder('fe.after');

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('startup-progress', '正在启动后端服务，请稍候...');
        }

        // 后端异步启动，不阻塞窗口创建
        stepLadder('backend.before');
        startBackend(newConfig).then(() => {
          log.info('Backend ready, closing config window');
          // 初始化异常日志模块
          const clipStoragePath = newConfig.storagePath.endsWith('clip-storage') || newConfig.storagePath.endsWith('clip-storage\\')
            ? newConfig.storagePath
            : path.join(newConfig.storagePath, 'clip-storage');
          log.initExceptionLogger(clipStoragePath);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('startup-progress', '启动成功！');
            const setupWin = mainWindow;
            setTimeout(() => {
              // 只关闭配置窗口本身；不要重置全局 mainWindow，
              // 因为下方 createMainWindow 已创建主窗口并接管该变量（防止引用丢失导致双窗口）
              if (setupWin && !setupWin.isDestroyed()) setupWin.close();
            }, 800);
          }
          // 创建主窗口
          createMainWindow(newConfig);
          stepLadder('window.after');
          // 注册全局快捷键
          loadShortcutFromConfig();
          registerGlobalShortcut();
          // 启动流程完成：处理启动期间到达的"唤起"请求
          appStartupComplete = true;
          if (pendingShowAfterStart) {
            pendingShowAfterStart = false;
            log.info('[Startup] Flushing pending show request');
            showMainWindow();
          }
          // 启动自动更新检查
          updateManager.startAutoCheck(async () => {
            await checkForUpdates(true);
          });
          // 启动提醒调度器
          startReminderScheduler();
        }).catch(e => {
          log.error('Startup failed:', e);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('startup-error', e.message);
          } else {
            dialog.showErrorBox('Startup Failed', e.message);
            app.quit();
          }
        });
      } catch (e) {
        log.error('Frontend start failed:', e);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('startup-error', e.message);
        } else {
          dialog.showErrorBox('Startup Failed', e.message);
          app.quit();
        }
      }
    });
  } else {
    // ===== 已配置完成：直接启动服务 =====
    try {
      // 启动前同步 model-config.json，确保后端 AppConfigService 迁移时能读到 API Key
      syncModelConfigJson(config);

      // 注册系统右键菜单（未注册或应用目录移动后自动重新注册，保证命令指向当前路径）
      ensureContextMenuRegistered(config);

      // 始终启动前端
      stepLadder('fe.before');
      await startFrontendServer(config);
      stepLadder('fe.after');

      // 根据启动模式决定后端行为
      if (config.startupMode === 'full') {
        // 模式1: 完全启动 — 后端同步启动，阻塞窗口创建
        log.info('[Startup] Mode: full - starting backend synchronously');
        stepLadder('backend.before');
        await startBackend(config);
        stepLadder('backend.after');
        backendStarted = true;
        const clipStoragePath = config.storagePath.endsWith('clip-storage') || config.storagePath.endsWith('clip-storage\\')
          ? config.storagePath
          : path.join(config.storagePath, 'clip-storage');
        log.initExceptionLogger(clipStoragePath);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('backend-ready');
        }
        startReminderScheduler();
      } else if (config.startupMode === 'frontend-async-backend') {
        // 模式2: 启动前端后异步启动后端，就绪后系统通知
        log.info('[Startup] Mode: frontend-async-backend - starting backend asynchronously');
        stepLadder('backend.before');
        startBackend(config).then(() => {
          stepLadder('backend.after');
          backendStarted = true;
          const clipStoragePath = config.storagePath.endsWith('clip-storage') || config.storagePath.endsWith('clip-storage\\')
            ? config.storagePath
            : path.join(config.storagePath, 'clip-storage');
          log.initExceptionLogger(clipStoragePath);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('backend-ready');
          }
          // 后端就绪后弹出系统通知
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('show-notification', {
              title: '后端服务已就绪',
              body: '所有功能现在可以使用，包括 AI 对话、剪藏、知识库等'
            });
          }
          log.info('[Reminder] Backend ready (async mode), about to start scheduler');
          startReminderScheduler();
        }).catch(e => {
          log.error('Backend async start failed:', e);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('backend-error', e.message);
            mainWindow.webContents.send('show-notification', {
              title: '后端启动失败',
              body: '请检查配置后重试，或在编辑器状态栏点击启动按钮手动启动'
            });
          }
        });
      } else {
        // 模式3: frontend-only — 只启动前端，不启动后端
        log.info('[Startup] Mode: frontend-only, backend will be started manually');
      }

      createMainWindow(config);
      stepLadder('window.after');
      // 处理命令行参数（系统右键菜单传递的文件路径）
      const actions = parseCommandLineArgs(process.argv, APP_DIR);
      if (actions.length > 0) {
        // 等待窗口就绪后分发动作
        mainWindow.webContents.on('did-finish-load', () => {
          dispatchActions(actions, mainWindow);
        }, { once: true });
      }
      // 注册全局快捷键
      loadShortcutFromConfig();
      registerGlobalShortcut();
      // 启动流程完成：处理启动期间到达的"唤起"请求
      appStartupComplete = true;
      if (pendingShowAfterStart) {
        pendingShowAfterStart = false;
        log.info('[Startup] Flushing pending show request');
        showMainWindow();
      }
      // 启动自动更新检查
      updateManager.startAutoCheck(async () => {
        await checkForUpdates(true);
      });
    } catch (e) {
      log.error('Startup failed:', e);
      dialog.showErrorBox('Startup Failed',
        `Failed to start: ${e.message}\n\n` +
        `Java: ${getJavaCommand()}\n` +
        `JAR: ${getJarPath()}\n` +
        `Frontend: ${getFrontendDir()}\n\n` +
        `Open Settings (Ctrl+,) to reconfigure.`
      );

      // 启动失败时降级到配置窗口，允许用户修改配置
      mainWindow = new BrowserWindow({
        width: 560, height: 700, resizable: false,
        title: 'Clip - Settings',
        icon: path.join(__dirname, 'app-icon.png'),
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: path.join(__dirname, 'preload.js')
        }
      });
      mainWindow.loadFile(path.join(__dirname, 'config.html'));
      mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.send('load-config', loadConfig());
      });
    }
  }
  } catch (outerErr) {
    // 顶层兜底：whenReady 流程内未被分段 catch 捕获的异常统一留下痕迹，
    // 供内网环境判断"到底是否抛了错"而非静默停住。
    log.error('[Startup] FATAL in whenReady:', outerErr);
    log.writeExceptionLog('electron', outerErr.message || String(outerErr), outerErr.stack || '', 'ERROR');
  }
});

// 所有窗口关闭时：有托盘或 macOS 时不退出应用
app.on('window-all-closed', (e) => {
  if (tray || process.platform === 'darwin') {
    // 托盘存在时保持应用运行在后台
    // macOS 惯例：关闭所有窗口后应用仍保持运行
  } else {
    quitApp();
  }
});

// 应用即将退出前：标记退出状态并清理服务
app.on('before-quit', () => {
  isQuitting = true;
  // 任何退出入口（Cmd+Q / 扩展坞 / 菜单）都强制清理临时工具窗口，确保 quit 不被阻塞
  try { screenshotService.cleanupOnQuit(); } catch (e) {}
  try { destroyTransientToasts(); } catch (e) {}
  stopReminderScheduler();
  stopBackend();
  stopFrontendServer();
  stopDshAgent();
});

// 应用退出时：确保清理所有服务进程
app.on('will-quit', () => {
  if (localIndexWatcher && typeof localIndexWatcher.stop === 'function') {
    try { localIndexWatcher.stop(); } catch (e) {}
    localIndexWatcher = null;
  }
  // 优雅关闭索引库：停维护 + closeDatabase（optimize + WAL checkpoint 落盘），避免 wal 残留
  try { localIndexService.close(); } catch (e) {}
  unregisterGlobalShortcut();
  stopBackend();
  stopFrontendServer();
  stopDshAgent();
});

// macOS Dock 图标点击或应用激活时
app.on('activate', () => {
  // 处于"最小化到托盘"隐藏态时，不响应 macOS 因窗口隐藏而自动触发的 activate，
  // 避免刚选托盘窗口又弹出来（恢复需通过托盘图标或全局快捷键）。
  if (trayHidden && mainWindow && !mainWindow.isDestroyed()) return;
  // 优先恢复隐藏/最小化的窗口（托盘场景）
  if (mainWindow && !mainWindow.isDestroyed()) {
    showMainWindow();
  } else if (BrowserWindow.getAllWindows().length === 0) {
    // 无窗口存在时创建新窗口
    const config = loadConfig();
    createMainWindow(config);
  }
});
