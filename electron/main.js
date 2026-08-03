/**
 * CutShelter - Electron 主进程入口
 * 
 * 职责：
 * 1. 管理应用生命周期（启动、退出、托盘）
 * 2. 管理前后端服务进程（Spring Boot 后端 + 静态文件前端）
 * 3. 管理窗口（主窗口、配置窗口）、系统托盘、菜单栏
 * 4. 提供 IPC 通道供渲染进程调用
 */

const { app, BrowserWindow, ipcMain, dialog, Menu, shell, Tray, nativeImage, Notification, globalShortcut, clipboard, session, screen } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const crypto = require('crypto');
const http = require('http');
const yaml = require('js-yaml');
const { EditorFileService } = require('./editor-file-service');

// 更新管理器（自动更新 + 手动检查）
const updateManager = require('./update-manager');

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
const LOG_DIR = APP_DIR;

log.info('=== App Startup ===');
log.info('isPackaged:', isPackaged);
log.info('resourcesPath:', resourcesPath);
log.info('APP_DIR:', APP_DIR);

// Windows 通知要求：必须设置 AppUserModelId 且有 Start Menu 快捷方式
if (process.platform === 'win32') {
  app.setAppUserModelId(process.execPath);

  // 自动创建 Start Menu 快捷方式（通知系统要求，否则通知不会弹出）
  try {
    const shortcutDir = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'CutShelter');
    if (!fs.existsSync(shortcutDir)) {
      fs.mkdirSync(shortcutDir, { recursive: true });
    }
    const shortcutPath = path.join(shortcutDir, 'CutShelter.lnk');
    if (!fs.existsSync(shortcutPath)) {
      shell.writeShortcutLink(shortcutPath, 'create', {
        target: process.execPath,
        args: '',
        description: 'CutShelter - AI 驱动的剪藏与内容整理工具',
        icon: process.execPath,
        iconIndex: 0
      });
      log.info('[Startup] Created Start Menu shortcut for notifications');
    }
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
  autoStart: false,             // 是否随系统登录自动启动
  mailEnabled: false,           // 邮件功能是否启用
  mailHost: '',
  mailPort: 465,
  mailUsername: '',
  mailPassword: '',
  customProviderName: '',        // 自定义 OpenAI 兼容提供商名称
  customBaseUrl: '',             // 自定义 OpenAI 兼容 API 地址
  customApiKey: '',              // 自定义 OpenAI 兼容 API Key
  customModel: ''                // 自定义 OpenAI 兼容模型名称
};

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
 * 关闭窗口时的行为偏好
 * null  = 未设置，每次关闭都弹窗询问
 * true  = 用户选择了"记住：最小化到托盘"
 * false = 用户选择了"记住：退出程序"
 */
let closeToTray = null;

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
function killPortProcess(port) {
  const isWin = process.platform === 'win32';
  try {
    if (isWin) {
      // Windows: netstat -ano 输出最后列为 PID
      const result = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf-8', timeout: 5000 });
      const lines = result.trim().split('\n');

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
        try {
          execSync(`taskkill /F /PID ${pid}`, { encoding: 'utf-8', timeout: 5000 });
          log.info(`Killed process ${pid} on port ${port}`);
        } catch (e) {
          log.info(`Failed to kill PID ${pid}: ${e.message}`);
        }
      }
    } else {
      // macOS/Linux: lsof -ti 列出占用端口的 PID（-t 仅输出 PID，-i 按端口过滤）
      try {
        const result = execSync(`lsof -ti :${port}`, { encoding: 'utf-8', timeout: 5000 });
        const pids = result.trim().split('\n').filter(p => p);
        for (const pid of pids) {
          try {
            // SIGKILL (9) 强制终止，进程无法捕获或忽略
            process.kill(parseInt(pid), 'SIGKILL');
            log.info(`Killed process ${pid} on port ${port}`);
          } catch (e) {
            log.info(`Failed to kill PID ${pid}: ${e.message}`);
          }
        }
      } catch (e) {
        // lsof 在无进程占用端口时返回非零退出码，属于正常情况
      }
    }
  } catch (e) {
    // netstat/findstr 在无匹配时也会返回非零退出码，正常情况
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
    const serve = serveStatic(frontendDir, { index: ['index.html'], fallthrough: false });

    const server = http.createServer((req, res) => {
      // 代理 /api/* 请求到后端
      const urlPath = req.url || '';
      if (urlPath.startsWith('/api/')) {
        const isAiStream = urlPath.startsWith('/api/ai/chat/stream');
        const proxyReq = http.request({
          hostname: '127.0.0.1',
          port: config.backendPort,
          path: urlPath,
          method: req.method,
          headers: req.headers,
          timeout: isAiStream ? 0 : 30000
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
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
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
    // macOS: 使用原生尺寸不缩放，保持 Retina 清晰度
    // macOS 托盘标准 22pt，@3x = 66px，64px 源图清晰度足够
    // Windows/Linux: 缩放到 16x16 适应托盘标准尺寸
    if (process.platform === 'darwin') {
      trayIcon = nativeImage.createFromPath(iconPath);
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
        if (mainWindow) {
          // 窗口已存在（隐藏状态）：直接显示并聚焦
          mainWindow.show();
          mainWindow.focus();
        } else {
          // 窗口已被销毁：重新创建
          const config = loadConfig();
          createMainWindow(config);
        }
      }
    },
    { type: 'separator' },
    {
      label: '密码管理',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
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
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
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

  // 从父窗口读取主题设置（app_appearance_v1: regular/dark/notion/system）
  let appearance = 'dark'; // 默认深色
  try {
    appearance = await parent.webContents.executeJavaScript(
      'localStorage.getItem("app_appearance_v1")'
    ) || 'dark';
    if (appearance === 'system') {
      const isSystemDark = await parent.webContents.executeJavaScript(
        'window.matchMedia("(prefers-color-scheme: dark)").matches'
      );
      appearance = isSystemDark ? 'dark' : 'regular';
    } else if (appearance === 'notion') {
      const isNotionDark = await parent.webContents.executeJavaScript(
        'document.documentElement.getAttribute("data-theme") === "dark"'
      );
      appearance = isNotionDark ? 'dark' : 'notion';
    }
  } catch (e) {
    // 读取失败时使用默认深色
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
    webPreferences: { nodeIntegration: true, contextIsolation: false }
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
  const { ipcRenderer } = require('electron');
  function choose(action) {
    ipcRenderer.send('close-dialog-result', { action: action, remember: document.getElementById('remember').checked });
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
 * 无边框窗口（frame: false），标题栏由前端渲染
 * 注册 close 和 minimize 事件处理以实现托盘功能
 * 
 * @param {Object} config - 用户配置
 */
function createMainWindow(config) {
  mainWindow = new BrowserWindow({
    width: 1200, height: 800,
    minWidth: 900, minHeight: 600,
    frame: false,          // 无边框（自定义标题栏）
    title: 'Clip',
    webPreferences: {
      nodeIntegration: false,          // 安全：禁用 Node.js 集成
      contextIsolation: true,          // 安全：启用上下文隔离
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

  // 监听页面加载失败事件（如连接被拒绝 ERR_CONNECTION_REFUSED: -102）
  mainWindow.webContents.on('did-fail-load', (event, errorCode) => {
    if (errorCode === -102 || errorCode === -3) {
      // -102: ERR_CONNECTION_REFUSED（后端未就绪）
      // -3:  ERR_ABORTED（加载被中断）
      setTimeout(() => {
        mainWindow.loadURL(`http://127.0.0.1:${config.frontendPort}`);
      }, 2000);
    }
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

  // ===== 关闭窗口拦截 =====
  // 当用户点击关闭按钮时，行为取决于 closeToTray 状态：
  //   null  → 弹出对话框询问
  //   true  → 直接隐藏到托盘
  //   false → 直接退出程序
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();  // 阻止默认关闭行为
      if (closeToTray === true) {
        mainWindow.hide();
      } else if (closeToTray === false) {
        isQuitting = true;
        quitApp();
      } else {
        showCloseDialog(mainWindow);
      }
    }
  });

  // ===== 最小化拦截 =====
  // 点击最小化按钮时，不缩小到任务栏，而是隐藏到系统托盘
  mainWindow.on('minimize', (event) => {
    event.preventDefault();
    mainWindow.hide();
  });

  // 最大化/还原状态变化时通知渲染进程（用于更新标题栏按钮图标）
  mainWindow.on('maximize', () => mainWindow.webContents.send('window-maximized', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window-maximized', false));

  // ===== 应用菜单栏 =====
  const menuTemplate = [
    {
      label: 'Clip', submenu: [
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
 * 完整退出应用
 * 按顺序执行：销毁托盘 → 停止后端 → 停止前端 → 退出 Electron
 */
function quitApp() {
  isQuitting = true;

  // 停止更新检查定时器
  updateManager.stopAutoCheck();

  // 停止提醒调度器
  stopReminderScheduler();

  // 销毁系统托盘图标，防止退出后托盘残留
  if (tray) {
    tray.destroy();
    tray = null;
  }

  stopBackend();
  stopFrontendServer();
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

  // ===== 看板娘图标上传 =====
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

  // 最小化窗口 → 触发 minimize 事件 → 隐藏到托盘
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

  // ===== 标题栏拖拽（JS 移动 + 贴边分屏） =====
  // 方案：渲染进程上报鼠标屏幕坐标 → 主进程绝对坐标定位 setBounds。
  // 关键设计：
  //   1. 拖拽中只用 setBounds 显式传递宽高，绝不改变窗口尺寸
  //   2. 分屏吸附仅在松手时判定：窗口位置贴边（<70px）才 setBounds 半屏/全屏
  //   3. 位置钳制：防止窗口拖出可视区域无法找回
  let windowDragState = null;

  // 渲染进程在标题栏空白区按下时调用，记录拖拽起点（绝对坐标定位基准）
  ipcMain.on('window-drag-start', (event, mouseX, mouseY) => {
    if (mainWindow && Number.isFinite(mouseX) && Number.isFinite(mouseY)) {
      // 如果窗口已最大化，先还原再记录尺寸，避免 setPosition 触发 unmaximize 导致尺寸变化
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      }
      const [wx, wy] = mainWindow.getPosition();
      const [ww, wh] = mainWindow.getSize();
      windowDragState = { wx, wy, mouseX, mouseY, ww, wh };
    }
  });

  // 拖拽移动：上报鼠标屏幕坐标，主进程换算绝对位置并 setBounds
  ipcMain.on('window-drag-move', (event, mouseX, mouseY) => {
    try {
      if (!mainWindow || mainWindow.isDestroyed() || !windowDragState) return;
      if (!Number.isFinite(mouseX) || !Number.isFinite(mouseY)) return;
      const { wx, wy, mouseX: startX, mouseY: startY, ww, wh } = windowDragState;
      const nx = wx + (mouseX - startX);
      const ny = wy + (mouseY - startY);
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;

      // 钳制：防止窗口拖出可视区域无法找回
      // 关键设计：
      //   1. 顶部：确保标题栏始终可见（窗口顶部最多移出屏幕 30px，标题栏~50px 高，至少 20px 可见）
      //   2. 底部：确保窗口不被任务栏遮挡，窗口底部不超出 workArea 底部
      //   3. 左/右：确保至少 60px 可见
      let cx = nx, cy = ny;
      try {
        const display = screen.getDisplayMatching({ x: Math.round(nx), y: Math.round(ny), width: Math.max(ww, 1), height: Math.max(wh, 1) });
        if (display && display.workArea) {
          const area = display.workArea;
          const MIN_VISIBLE = 60;
          const TITLEBAR_VISIBLE = 30; // 标题栏最多 30px 移出屏幕顶部
          if (cx + ww < area.x + MIN_VISIBLE) cx = area.x + MIN_VISIBLE - ww;
          if (cx > area.x + area.width - MIN_VISIBLE) cx = area.x + area.width - MIN_VISIBLE;
          if (cy < area.y - TITLEBAR_VISIBLE) cy = area.y - TITLEBAR_VISIBLE;        // 顶部：标题栏可见
          if (cy + wh > area.y + area.height) cy = area.y + area.height - wh;         // 底部：不被任务栏遮挡
        }
      } catch (err) {
        // getDisplayMatching 失败时用主显示器兜底钳制
        try {
          const primary = screen.getPrimaryDisplay();
          if (primary && primary.workArea) {
            const area = primary.workArea;
            const MIN_VISIBLE = 60;
            const TITLEBAR_VISIBLE = 30;
            if (cx + ww < area.x + MIN_VISIBLE) cx = area.x + MIN_VISIBLE - ww;
            if (cx > area.x + area.width - MIN_VISIBLE) cx = area.x + area.width - MIN_VISIBLE;
            if (cy < area.y - TITLEBAR_VISIBLE) cy = area.y - TITLEBAR_VISIBLE;
            if (cy + wh > area.y + area.height) cy = area.y + area.height - wh;
          }
        } catch (e) { /* 完全钳制失败，保留原位置 */ }
      }

      // 用 setBounds 显式指定当前尺寸，保证拖拽中绝不改变窗口大小
      mainWindow.setBounds({ x: Math.round(cx), y: Math.round(cy), width: ww, height: wh });
    } catch (err) { /* 拖拽异常静默忽略 */ }
  });

  // 松手：根据窗口位置判定贴边分屏
  ipcMain.on('window-drag-end', () => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const bounds = mainWindow.getBounds();
        const cx = Math.round(bounds.x + bounds.width / 2);
        const cy = Math.round(bounds.y + bounds.height / 2);
        if (Number.isFinite(cx) && Number.isFinite(cy)) {
          const display = screen.getDisplayMatching({ x: cx, y: cy, width: 1, height: 1 });
          if (display && display.workArea) {
            const area = display.workArea;
            // 钳制逻辑 MIN_VISIBLE=60，窗口贴边后窗口位置距边缘 ≤ 60
            // 用 70 作为阈值：窗口被钳制到边缘附近时触发分屏
            const threshold = 70;
            if (bounds.y <= area.y + threshold) {
              // 顶部：最大化
              mainWindow.setBounds({ x: area.x, y: area.y, width: area.width, height: area.height });
            } else if (bounds.x <= area.x + threshold) {
              // 左侧：左半屏
              mainWindow.setBounds({ x: area.x, y: area.y, width: Math.round(area.width / 2), height: area.height });
            } else if (bounds.x + bounds.width >= area.x + area.width - threshold) {
              // 右侧：右半屏
              mainWindow.setBounds({ x: area.x + Math.round(area.width / 2), y: area.y, width: Math.round(area.width / 2), height: area.height });
            }
          }
        }
      }
    } catch (err) { /* 分屏失败忽略 */ }
    windowDragState = null;
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
      return { success: true };
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
  ipcMain.handle('download-and-apply-update', async (event, downloadUrl) => {
    try {
      // 通过 IPC 事件向渲染进程发送进度
      const sendProgress = (msg, percent) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('update-progress', { message: msg, percent });
        }
      };

      const isExe = downloadUrl.toLowerCase().endsWith('.exe');

      if (isExe) {
        // EXE 安装包：下载后打开，提示用户手动安装
        log.info('[Update] Downloading EXE installer:', downloadUrl);
        sendProgress('正在下载安装包...', 0);
        const exePath = await updateManager.downloadUpdate(downloadUrl, (received, total, percent) => {
          const sizeMB = (received / 1024 / 1024).toFixed(1);
          const totalMB = total > 0 ? (total / 1024 / 1024).toFixed(1) : '?';
          sendProgress(`正在下载安装包... ${sizeMB}MB / ${totalMB}MB`, Math.min(percent, 90));
        });
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

      const zipPath = await updateManager.downloadUpdate(downloadUrl, (received, total, percent) => {
        const sizeMB = (received / 1024 / 1024).toFixed(1);
        const totalMB = total > 0 ? (total / 1024 / 1024).toFixed(1) : '?';
        sendProgress(`正在下载更新... ${sizeMB}MB / ${totalMB}MB`, Math.min(percent, 65));
      });

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
      if (mainWindow) {
        if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    });
    if (!ret) log.warn('[Shortcut] Registration failed:', shortcutAccelerator);
  } catch (e) { log.warn('[Shortcut] Error:', e.message); }
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
  log.info(`[Update] Checking for updates via backend (current: ${currentVersion}, silent: ${silent})`);

  try {
    const config = loadConfig();
    const url = `http://127.0.0.1:${config.backendPort}/api/update/check?currentVersion=${encodeURIComponent(currentVersion)}`;
    const body = await httpGet(url);
    const result = JSON.parse(body);

    if (result.hasUpdate) {
      updateManager.recordCheckTime();
      log.info(`[Update] New version available: ${result.latestVersion}`);
      // 自动检查（silent）时发送事件通知用户；手动检查靠返回值驱动 UI
      if (silent && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-available', {
          version: result.latestVersion,
          currentVersion,
          notes: result.releaseNotes,
          releaseUrl: result.releaseUrl,
          downloadUrl: result.downloadUrl
        });
      }
      return {
        hasUpdate: true,
        version: result.latestVersion,
        latestVersion: result.latestVersion,
        currentVersion,
        releaseNotes: result.releaseNotes,
        releaseUrl: result.releaseUrl,
        downloadUrl: result.downloadUrl,
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
  } catch (e) {
    log.error('[Update] Backend check failed:', e.message);
    if (!silent) {
      return { hasUpdate: false, currentVersion, message: '无法连接到后端服务，请确认后端已启动' };
    }
    return { hasUpdate: false };
  }
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

    toastWin.once('ready-to-show', () => {
      toastWin.show();
      log.info('[Reminder] Toast window shown');
    });

    toastWin.on('closed', () => {
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

// ==================== 应用生命周期 ====================

app.whenReady().then(async () => {
  // Fix console Chinese encoding on Windows
  if (process.platform === 'win32') {
    try { require('child_process').execSync('chcp 65001', { stdio: 'ignore' }); } catch {}
  }

  // 清理 30 天前的旧日志
  log.cleanupOldLogs();

  setupIPC();

  // 预创建系统托盘图标（不等窗口创建）
  if (!tray) {
    createTray();
  }

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
  log.info('Config loaded:', JSON.stringify(config, null, 2));

  // 修复旧版本可能写入的不完整 macOS 登录项（仅在用户已开启自启时校准）。
  // 否则系统可能只启动 Electron 可执行文件，落到 Electron 默认欢迎页。
  if (config.autoStart) {
    applyAutoStartSetting(true);
  }

  // 启动前清理端口上残留的旧进程（如上次崩溃未清理的）
  killPortProcess(config.backendPort);
  killPortProcess(config.frontendPort);

  if (!config.configured) {
    // ===== 首次运行：显示配置引导窗口 =====
    log.info('First run - showing config window');

    // 复用 mainWindow 变量指向配置窗口
    mainWindow = new BrowserWindow({
      width: 560, height: 700, resizable: false,
      frame: false,
      title: 'Clip - Setup',
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

      // 同步 model-config.json 到 storagePath，保持与设置页面数据一致
      syncModelConfigJson(newConfig);

      // 向配置窗口发送启动进度提示
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('startup-progress', '正在启动前端服务...');
      }

      try {
        await startFrontendServer(newConfig);

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('startup-progress', '正在启动后端服务，请稍候...');
        }

        // 后端异步启动，不阻塞窗口创建
        startBackend(newConfig).then(() => {
          log.info('Backend ready, closing config window');
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('startup-progress', '启动成功！');
            setTimeout(() => {
              mainWindow.close();
              mainWindow = null;
            }, 800);
          }
          // 创建主窗口
          createMainWindow(newConfig);
          // 注册全局快捷键
          loadShortcutFromConfig();
          registerGlobalShortcut();
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

      await startFrontendServer(config);

      // 后端异步启动，不阻塞窗口创建
      startBackend(config).then(() => {
        log.info('Backend ready, notifying renderer');
        backendStarted = true;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('backend-ready');
        }
        // 后端就绪后才启动提醒调度器
        log.info('[Reminder] Backend ready (configured path), about to start scheduler');
        startReminderScheduler();
      }).catch(e => {
        log.error('Backend start failed:', e);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('backend-error', e.message);
        }
      });

      createMainWindow(config);
      // 注册全局快捷键
      loadShortcutFromConfig();
      registerGlobalShortcut();
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
  stopReminderScheduler();
  stopBackend();
  stopFrontendServer();
});

// 应用退出时：确保清理所有服务进程
app.on('will-quit', () => {
  unregisterGlobalShortcut();
  stopBackend();
  stopFrontendServer();
});

// macOS Dock 图标点击或应用激活时
app.on('activate', () => {
  // 优先恢复隐藏的窗口（托盘场景）
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  } else if (BrowserWindow.getAllWindows().length === 0) {
    // 无窗口存在时创建新窗口
    const config = loadConfig();
    createMainWindow(config);
  }
});
