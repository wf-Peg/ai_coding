const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execSync, exec } = require('child_process');
const http = require('http');
const https = require('https');
const yaml = require('js-yaml');

// ==================== 配置管理 ====================

const CONFIG_DIR = path.join(app.getPath('userData'), 'config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const APP_DIR = path.dirname(app.getPath('exe'));
// 打包后 resourcesPath 指向安装目录/resources，开发时指向项目根目录
const resourcesPath = process.resourcesPath || app.getAppPath();

// 默认配置
const DEFAULT_CONFIG = {
  backendPort: 8080,
  frontendPort: 3000,
  apiKey: '',
  storagePath: path.join(APP_DIR, 'clip-storage'),
  organizedPath: path.join(APP_DIR, 'clip-organized'),
  configured: false
};

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function loadConfig() {
  ensureConfigDir();
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
      return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
    }
  } catch (e) {
    console.error('加载配置失败:', e);
  }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(config) {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

// ==================== 后端进程管理 ====================

let backendProcess = null;
let mainWindow = null;
let configWindow = null;

function getJavaCommand() {
  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';

  // 优先查找内嵌的 JRE
  const jrePaths = [
    path.join(APP_DIR, 'jre', 'bin', isWin ? 'java.exe' : 'java'),
    path.join(APP_DIR, 'runtime', 'bin', isWin ? 'java.exe' : 'java'),
    path.join(resourcesPath, 'jre', 'bin', isWin ? 'java.exe' : 'java'),
  ];

  for (const jrePath of jrePaths) {
    if (fs.existsSync(jrePath)) {
      return jrePath;
    }
  }

  // 回退到系统 Java
  return 'java';
}

function getJarPath() {
  const possiblePaths = [
    path.join(APP_DIR, 'backend', 'clip-demo-0.0.1-SNAPSHOT.jar'),
    path.join(APP_DIR, 'clip-demo-0.0.1-SNAPSHOT.jar'),
    path.join(resourcesPath, 'backend', 'clip-demo-0.0.1-SNAPSHOT.jar'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

function generateApplicationYml(config) {
  const ymlContent = {
    spring: {
      application: {
        name: 'clip-demo'
      },
      ai: {
        dashscope: {
          'api-key': config.apiKey,
          chat: {
            options: {
              model: 'qwen-plus'
            }
          }
        }
      }
    },
    server: {
      port: config.backendPort
    },
    clip: {
      storage: {
        path: config.storagePath
      },
      'organized-storage': {
        path: config.organizedPath
      }
    }
  };

  return yaml.dump(ymlContent, { lineWidth: -1, quotingType: '"' });
}

function startBackend(config) {
  return new Promise((resolve, reject) => {
    const jarPath = getJarPath();
    if (!jarPath) {
      reject(new Error('找不到后端 JAR 包，请确保 clip-demo-0.0.1-SNAPSHOT.jar 存在'));
      return;
    }

    // 确保存储目录存在
    if (!fs.existsSync(config.storagePath)) {
      fs.mkdirSync(config.storagePath, { recursive: true });
    }
    if (!fs.existsSync(config.organizedPath)) {
      fs.mkdirSync(config.organizedPath, { recursive: true });
    }

    // 生成 application.yml 到 jar 同级目录
    const jarDir = path.dirname(jarPath);
    const ymlPath = path.join(jarDir, 'application.yml');
    fs.writeFileSync(ymlPath, generateApplicationYml(config), 'utf-8');

    const javaCmd = getJavaCommand();
    console.log(`启动后端: ${javaCmd} -jar ${jarPath}`);
    console.log(`工作目录: ${jarDir}`);
    console.log(`配置文件: ${ymlPath}`);

    backendProcess = spawn(javaCmd, ['-jar', jarPath], {
      cwd: jarDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env }
    });

    backendProcess.stdout.on('data', (data) => {
      const msg = data.toString();
      console.log(`[后端] ${msg}`);
      // 检测 Spring Boot 启动成功
      if (msg.includes('Started ClipDemoApplication') || msg.includes('JVM running for')) {
        resolve(true);
      }
    });

    backendProcess.stderr.on('data', (data) => {
      const msg = data.toString();
      console.error(`[后端错误] ${msg}`);
    });

    backendProcess.on('close', (code) => {
      console.log(`后端进程退出，代码: ${code}`);
      backendProcess = null;
    });

    backendProcess.on('error', (err) => {
      console.error(`后端启动失败: ${err.message}`);
      reject(err);
    });

    // 超时检测
    setTimeout(() => {
      // 即使没有检测到启动日志，也尝试检查端口
      checkPort(config.backendPort).then((open) => {
        if (open) resolve(true);
        else reject(new Error('后端启动超时'));
      });
    }, 30000);
  });
}

function stopBackend() {
  if (backendProcess) {
    console.log('正在停止后端进程...');
    backendProcess.kill('SIGTERM');
    setTimeout(() => {
      if (backendProcess) {
        backendProcess.kill('SIGKILL');
        backendProcess = null;
      }
    }, 5000);
  }
}

function checkPort(port) {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: port,
      path: '/api/clip/list',
      method: 'GET',
      timeout: 2000
    }, (res) => {
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

// ==================== 前端静态服务器 ====================

let frontendServer = null;

function startFrontendServer(config) {
  return new Promise((resolve, reject) => {
    const http = require('http');
    const finalhandler = require('finalhandler');
    const serveStatic = require('serve-static');

    // 前端文件目录
    const frontendDir = path.join(APP_DIR, 'frontend');
    const serve = serveStatic(frontendDir, { index: ['index.html'] });

    const server = http.createServer((req, res) => {
      serve(req, res, finalhandler(req, res));
    });

    server.listen(config.frontendPort, '127.0.0.1', () => {
      frontendServer = server;
      console.log(`前端服务器启动在 http://127.0.0.1:${config.frontendPort}`);
      resolve(true);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`端口 ${config.frontendPort} 已被占用`));
      } else {
        reject(err);
      }
    });
  });
}

function stopFrontendServer() {
  if (frontendServer) {
    frontendServer.close();
    frontendServer = null;
  }
}

// ==================== 窗口管理 ====================

function createMainWindow(config) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: '剪藏 - 信息检索与剪藏系统',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // 加载前端页面
  mainWindow.loadURL(`http://127.0.0.1:${config.frontendPort}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 创建菜单
  const menuTemplate = [
    {
      label: '剪藏',
      submenu: [
        {
          label: '设置',
          accelerator: 'CmdOrCtrl+,',
          click: () => showConfigWindow(config)
        },
        { type: 'separator' },
        { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '刷新' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '关于剪藏',
              message: '剪藏 - 信息检索与剪藏系统',
              detail: '版本: 1.0.0\n基于 Spring Boot + Electron 构建\n使用阿里云 DashScope AI'
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
}

function showConfigWindow(config) {
  if (configWindow) {
    configWindow.focus();
    return;
  }

  configWindow = new BrowserWindow({
    width: 560,
    height: 620,
    resizable: false,
    title: '剪藏 - 设置',
    modal: true,
    parent: mainWindow,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  configWindow.loadFile(path.join(__dirname, 'config.html'));

  configWindow.webContents.on('did-finish-load', () => {
    configWindow.webContents.send('load-config', config);
  });

  configWindow.on('closed', () => {
    configWindow = null;
  });
}

// ==================== IPC 通信 ====================

function setupIPC() {
  // 保存配置
  ipcMain.handle('save-config', async (event, newConfig) => {
    try {
      saveConfig(newConfig);
      return { success: true, message: '配置已保存，重启应用后生效' };
    } catch (e) {
      return { success: false, message: `保存失败: ${e.message}` };
    }
  });

  // 选择目录
  ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: '选择存储目录'
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  // 获取当前配置
  ipcMain.handle('get-config', async () => {
    return loadConfig();
  });

  // 检查后端状态
  ipcMain.handle('check-backend', async (event, port) => {
    return await checkPort(port);
  });

  // 重启后端
  ipcMain.handle('restart-backend', async (event, config) => {
    stopBackend();
    await new Promise(resolve => setTimeout(resolve, 2000));
    try {
      await startBackend(config);
      return { success: true, message: '后端重启成功' };
    } catch (e) {
      return { success: false, message: `重启失败: ${e.message}` };
    }
  });
}

// ==================== 应用生命周期 ====================

app.whenReady().then(async () => {
  setupIPC();

  const config = loadConfig();

  // 首次启动或未配置，显示配置窗口
  if (!config.configured || !config.apiKey) {
    // 创建一个临时主窗口用于配置
    mainWindow = new BrowserWindow({
      width: 560,
      height: 620,
      resizable: false,
      title: '剪藏 - 初始设置',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      }
    });

    mainWindow.loadFile(path.join(__dirname, 'config.html'));
    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow.webContents.send('load-config', config);
      mainWindow.webContents.send('first-run', true);
    });

    // 监听配置完成
    ipcMain.on('config-done', async (event, newConfig) => {
      saveConfig({ ...newConfig, configured: true });
      mainWindow.close();

      // 启动服务
      try {
        await startFrontendServer(newConfig);
        await startBackend(newConfig);
        createMainWindow(newConfig);
      } catch (e) {
        dialog.showErrorBox('启动失败', `服务启动失败: ${e.message}`);
        app.quit();
      }
    });
  } else {
    // 已配置，直接启动服务
    try {
      await startFrontendServer(config);
      await startBackend(config);
      createMainWindow(config);
    } catch (e) {
      dialog.showErrorBox('启动失败', `服务启动失败: ${e.message}\n\n请检查配置是否正确。`);
      app.quit();
    }
  }
});

app.on('window-all-closed', () => {
  stopBackend();
  stopFrontendServer();
  app.quit();
});

app.on('before-quit', () => {
  stopBackend();
  stopFrontendServer();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const config = loadConfig();
    createMainWindow(config);
  }
});
