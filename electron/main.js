const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const http = require('http');
const yaml = require('js-yaml');

// ==================== Path Resolution ====================
const isPackaged = app.isPackaged;
const resourcesPath = process.resourcesPath || app.getAppPath();
const APP_DIR = isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath();
const LOG_DIR = APP_DIR;

console.log('=== App Startup ===');
console.log('isPackaged:', isPackaged);
console.log('resourcesPath:', resourcesPath);
console.log('APP_DIR:', APP_DIR);

// ==================== Config Management ====================

const CONFIG_DIR = path.join(app.getPath('userData'), 'config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG = {
  backendPort: 8080,
  frontendPort: 3000,
  apiKey: '',
  activeProvider: 'dashscope',
  deepseekApiKey: '',
  deepseekModel: 'deepseek-chat',
  dashscopeModel: 'qwen-plus',
  storagePath: path.join(APP_DIR, 'clip-storage'),
  organizedPath: path.join(APP_DIR, 'clip-organized'),
  weeklyReportPath: path.join(APP_DIR, 'weeklyReport'),
  configured: false,
  mailEnabled: false,
  mailHost: '',
  mailPort: 465,
  mailUsername: '',
  mailPassword: ''
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
    console.error('Load config failed:', e);
  }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(config) {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

// ==================== Process Management ====================

let backendProcess = null;
let mainWindow = null;
let configWindow = null;
let isQuitting = false;

function getJavaCommand() {
  const isWin = process.platform === 'win32';
  const javaExe = isWin ? 'java.exe' : 'java';
  const embeddedPaths = [
    path.join(resourcesPath, 'jre', 'bin', javaExe),
    path.join(resourcesPath, 'runtime', 'bin', javaExe),
  ];
  const localPaths = [
    path.join(APP_DIR, 'jre', 'bin', javaExe),
    path.join(APP_DIR, 'runtime', 'bin', javaExe),
  ];
  const allPaths = [...embeddedPaths, ...localPaths];
  for (const p of allPaths) {
    if (fs.existsSync(p)) {
      if (!isExecutableForCurrentPlatform(p)) {
        console.warn(`Skipping incompatible bundled Java for ${process.platform}: ${p}`);
        continue;
      }
      // Fix permissions on macOS: ensure Java binary is executable
      // The bundled JRE loses executable permissions during packaging
      if (process.platform === 'darwin') {
        try {
          fs.chmodSync(p, 0o755);
          // Also fix dylib files in the JRE lib directory
          const libDir = path.dirname(path.dirname(p));
          const libPath = path.join(libDir, 'lib');
          if (fs.existsSync(libPath)) {
            fixPermissionsRecursive(libPath);
          }
          // Fix lib/server directory for jvm.cfg etc.
          const serverPath = path.join(libDir, 'lib', 'server');
          if (fs.existsSync(serverPath)) {
            fixPermissionsRecursive(serverPath);
          }
        } catch (e) {
          console.log('Failed to fix JRE permissions:', e.message);
        }
      }
      console.log('Found Java at:', p);
      return p;
    }
  }
  console.log('No embedded JRE found, using system java');
  return 'java';
}

function isExecutableForCurrentPlatform(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(4);
    fs.readSync(fd, header, 0, header.length, 0);
    fs.closeSync(fd);

    const isElf = header[0] === 0x7f && header[1] === 0x45 && header[2] === 0x4c && header[3] === 0x46;
    const isWindowsExe = header[0] === 0x4d && header[1] === 0x5a;
    const magic = header.readUInt32BE(0);
    const isMachO = [
      0xfeedface,
      0xfeedfacf,
      0xcefaedfe,
      0xcffaedfe,
      0xcafebabe,
      0xbebafeca
    ].includes(magic);

    if (process.platform === 'darwin') return isMachO;
    if (process.platform === 'win32') return isWindowsExe;
    if (process.platform === 'linux') return isElf;
  } catch (e) {
    console.warn(`Could not inspect Java executable ${filePath}: ${e.message}`);
  }
  return true;
}

function fixPermissionsRecursive(dir) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        fixPermissionsRecursive(fullPath);
      } else if (entry.isFile()) {
        // Make all .dylib, .so, and executable files executable
        if (entry.name.endsWith('.dylib') || entry.name.endsWith('.so') || !path.extname(entry.name)) {
          fs.chmodSync(fullPath, 0o755);
        }
      }
    }
  } catch (e) {
    console.log('Failed to fix permissions in', dir, ':', e.message);
  }
}

function getJarPath() {
  const possiblePaths = [
    path.join(resourcesPath, 'backend', 'clip-demo-0.0.1-SNAPSHOT.jar'),
    path.join(APP_DIR, 'backend', 'clip-demo-0.0.1-SNAPSHOT.jar'),
    path.join(APP_DIR, 'clip-demo-0.0.1-SNAPSHOT.jar'),
    path.join(app.getAppPath(), 'backend', 'target', 'clip-demo-0.0.1-SNAPSHOT.jar'),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      console.log('Found JAR at:', p);
      return p;
    }
  }
  return null;
}

function getFrontendDir() {
  const possiblePaths = [
    path.join(resourcesPath, 'frontend'),
    path.join(app.getAppPath(), 'frontend'),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(path.join(p, 'index.html'))) {
      console.log('Found frontend at:', p);
      return p;
    }
  }
  return null;
}

function generateApplicationYml(config) {
  const ymlConfig = {
    spring: {
      application: { name: 'clip-demo' },
      ai: {
        dashscope: {
          'api-key': config.apiKey,
          chat: { options: { model: config.dashscopeModel || 'qwen-plus' } }
        },
        openai: {
          'api-key': config.deepseekApiKey || '',
          'base-url': 'https://api.deepseek.com',
          chat: { options: { model: config.deepseekModel || 'deepseek-chat' } }
        }
      }
    },
    server: { port: config.backendPort },
    clip: {
      storage: { path: config.storagePath },
      'organized-storage': { path: config.organizedPath },
      'clip-weekly-report': { path: config.weeklyReportPath }
    }
  };

  // Add mail config if enabled
  if (config.mailEnabled && config.mailHost) {
    ymlConfig.spring.mail = {
      host: config.mailHost,
      port: config.mailPort || 465,
      username: config.mailUsername,
      password: config.mailPassword,
      properties: {
        'mail.smtp.ssl.enable': true,
        'mail.smtp.auth': true,
        'mail.smtp.socketFactory.class': 'javax.net.ssl.SSLSocketFactory'
      }
    };
  }

  return yaml.dump(ymlConfig, { lineWidth: -1, quotingType: '"' });
}

// ==================== Kill Port Process ====================

function killPortProcess(port) {
  const isWin = process.platform === 'win32';
  try {
    if (isWin) {
      // Windows: netstat find PID then taskkill
      const result = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf-8', timeout: 5000 });
      const lines = result.trim().split('\n');
      const pids = new Set();
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && /^\d+$/.test(pid) && pid !== '0') {
          pids.add(pid);
        }
      }
      for (const pid of pids) {
        try {
          execSync(`taskkill /F /PID ${pid}`, { encoding: 'utf-8', timeout: 5000 });
          console.log(`Killed process ${pid} on port ${port}`);
        } catch (e) {
          console.log(`Failed to kill PID ${pid}: ${e.message}`);
        }
      }
    } else {
      // macOS/Linux: lsof find PID then kill
      try {
        const result = execSync(`lsof -ti :${port}`, { encoding: 'utf-8', timeout: 5000 });
        const pids = result.trim().split('\n').filter(p => p);
        for (const pid of pids) {
          try {
            process.kill(parseInt(pid), 'SIGKILL');
            console.log(`Killed process ${pid} on port ${port}`);
          } catch (e) {
            console.log(`Failed to kill PID ${pid}: ${e.message}`);
          }
        }
      } catch (e) {
        // lsof returns non-zero if no process found, that's fine
      }
    }
  } catch (e) {
    // netstat/lsof returns non-zero if no process found, that's fine
    console.log(`No process found on port ${port}`);
  }
}

// ==================== Backend Process ====================

function startBackend(config) {
  return new Promise((resolve, reject) => {
    const jarPath = getJarPath();
    if (!jarPath) {
      reject(new Error('Cannot find backend JAR. Searched:\n- resources/backend/\n- app directory'));
      return;
    }
    const javaCmd = getJavaCommand();

    if (!fs.existsSync(config.storagePath)) {
      fs.mkdirSync(config.storagePath, { recursive: true });
    }
    if (!fs.existsSync(config.organizedPath)) {
      fs.mkdirSync(config.organizedPath, { recursive: true });
    }
    if (!fs.existsSync(config.weeklyReportPath)) {
      fs.mkdirSync(config.weeklyReportPath, { recursive: true });
    }

    // Write application.yml next to jar
    const jarDir = path.dirname(jarPath);
    const ymlPath = path.join(jarDir, 'application.yml');
    fs.writeFileSync(ymlPath, generateApplicationYml(config), 'utf-8');

    // Log file path
    const logFile = path.join(LOG_DIR, 'backend.log');
    const logStream = fs.openSync(logFile, 'a');

    console.log(`Starting backend: ${javaCmd} -jar ${jarPath}`);
    console.log(`Working dir: ${jarDir}`);
    console.log(`Log file: ${logFile}`);

    backendProcess = spawn(javaCmd, ['-jar', jarPath], {
      cwd: jarDir,
      stdio: ['pipe', logStream, logStream],
      env: { ...process.env },
      windowsHide: true
    });

    let resolved = false;

    // Poll port to detect backend readiness (more reliable than stdout parsing)
    const pollInterval = setInterval(() => {
      if (resolved) { clearInterval(pollInterval); return; }
      checkPort(config.backendPort).then((open) => {
        if (!resolved && open) {
          resolved = true;
          clearInterval(pollInterval);
          console.log(`Backend started successfully on port ${config.backendPort}`);
          resolve(true);
        }
      });
    }, 2000);

    // Timeout: 120 seconds (wait for Windows firewall dialog)
    setTimeout(() => {
      if (!resolved) {
        clearInterval(pollInterval);
        resolved = true;
        reject(new Error('Backend startup timeout (120s). If Windows firewall dialog appeared, please allow access and restart the app.'));
      }
    }, 120000);

    backendProcess.on('close', (code) => {
      console.log(`Backend exited with code: ${code}`);
      backendProcess = null;
    });

    backendProcess.on('error', (err) => {
      console.error(`Backend start error: ${err.message}`);
      if (!resolved) {
        resolved = true;
        clearInterval(pollInterval);
        reject(new Error(`Backend failed to start: ${err.message}\n\nJava: ${javaCmd}\nJAR: ${jarPath}\nLog: ${logFile}`));
      }
    });
  });
}

function stopBackend() {
  if (backendProcess) {
    console.log('Stopping backend...');
    const config = loadConfig();
    try {
      backendProcess.kill('SIGTERM');
    } catch (e) {
      // ignore
    }
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
    // Also kill port processes as fallback
    if (config && config.backendPort) {
      setTimeout(() => killPortProcess(config.backendPort), 1000);
    }
  }
  // Always kill port processes on configured ports
  const config = loadConfig();
  if (config) {
    killPortProcess(config.backendPort);
    killPortProcess(config.frontendPort);
  }
}

function checkPort(port) {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: '127.0.0.1', port: port,
      path: '/api/clip/list', method: 'GET', timeout: 3000
    }, (res) => {
      // Only resolve true if we get a valid HTTP response (not blocked by firewall)
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve(res.statusCode === 200);
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

function requestBackend(config, method, endpoint, payload) {
  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port: config.backendPort,
      path: endpoint,
      method,
      timeout: 5000,
      headers: body ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      } : {}
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let parsed = null;
        if (raw) {
          try {
            parsed = JSON.parse(raw);
          } catch (error) {
            parsed = raw;
          }
        }

        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(parsed);
          return;
        }

        reject(new Error(typeof parsed === 'string' ? parsed : JSON.stringify(parsed || { status: res.statusCode })));
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('backend request timeout'));
    });
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

// ==================== Frontend Static Server ====================

let frontendServer = null;

function startFrontendServer(config) {
  return new Promise((resolve, reject) => {
    const frontendDir = getFrontendDir();
    if (!frontendDir) {
      reject(new Error('Cannot find frontend files (index.html). Searched:\n- resources/frontend/\n- app directory'));
      return;
    }
    const finalhandler = require('finalhandler');
    const serveStatic = require('serve-static');
    const serve = serveStatic(frontendDir, { index: ['index.html'], fallthrough: false });
    const server = http.createServer((req, res) => {
      serve(req, res, finalhandler(req, res, {
        onerror: () => {
          // SPA fallback: 非文件路径回退到 index.html
          const fs = require('fs');
          const urlPath = new URL(req.url, `http://127.0.0.1:${config.frontendPort}`).pathname;
          const fp = path.join(frontendDir, urlPath);
          if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
            fs.readFile(path.join(frontendDir, 'index.html'), (e, d) => {
              if (e) { res.writeHead(500); res.end('Error'); }
              else { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(d); }
            });
          } else { res.writeHead(500); res.end('Error'); }
        }
      }));
    server.listen(config.frontendPort, '127.0.0.1', () => {
      frontendServer = server;
      console.log(`Frontend server: http://127.0.0.1:${config.frontendPort}`);
      resolve(true);
    });
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${config.frontendPort} is already in use`));
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

// ==================== Window Management ====================

function createMainWindow(config) {
  mainWindow = new BrowserWindow({
    width: 1200, height: 800, minWidth: 900, minHeight: 600,
    frame: false,
    title: 'Clip',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Load frontend with auto-retry
  function loadWithRetry(attempts) {
    if (attempts <= 0) {
      mainWindow.loadURL(`http://127.0.0.1:${config.frontendPort}`);
      return;
    }
    mainWindow.loadURL(`http://127.0.0.1:${config.frontendPort}`).catch(() => {
      setTimeout(() => loadWithRetry(attempts - 1), 2000);
    });
  }

  mainWindow.webContents.on('did-fail-load', (event, errorCode) => {
    if (errorCode === -102 || errorCode === -3) {
      // ERR_CONNECTION_REFUSED or ERR_ABORTED, retry
      setTimeout(() => {
        mainWindow.loadURL(`http://127.0.0.1:${config.frontendPort}`);
      }, 2000);
    }
  });

  loadWithRetry(5);
  mainWindow.on('closed', () => { mainWindow = null; });

  // Notify renderer on maximize/unmaximize
  mainWindow.on('maximize', () => mainWindow.webContents.send('window-maximized', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window-maximized', false));

  const menuTemplate = [
    { label: 'Clip', submenu: [
        { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => showConfigWindow(config) },
        { type: 'separator' },
        { label: 'Exit', accelerator: 'Alt+F4', click: () => quitApp() }
    ]},
    { label: 'Edit', submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
    ]},
    { label: 'View', submenu: [
        { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
        { role: 'togglefullscreen' }
    ]},
    { label: 'Help', submenu: [
        { label: 'View Log', click: () => {
            const logFile = path.join(LOG_DIR, 'backend.log');
            if (fs.existsSync(logFile)) {
              shell.openPath(logFile);
            } else {
              dialog.showMessageBox(mainWindow, {
                type: 'info', title: 'Log',
                message: 'Log file not found',
                detail: `Expected at: ${logFile}`
              });
            }
        }},
        { type: 'separator' },
        { label: 'About', click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info', title: 'About',
              message: 'Clip - Information Retrieval System',
              detail: 'Version: 1.0.0\nSpring Boot + Electron\nDashScope AI'
            });
        }}
    ]}
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
}

function showConfigWindow(config) {
  if (configWindow) { configWindow.focus(); return; }
  configWindow = new BrowserWindow({
    width: 560, height: 700, resizable: false,
    title: 'Clip - Settings',
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
  configWindow.on('closed', () => { configWindow = null; });
}

// ==================== Quit App ====================

function quitApp() {
  isQuitting = true;
  stopBackend();
  stopFrontendServer();
  app.quit();
}

// ==================== IPC ====================

function setupIPC() {
  ipcMain.handle('save-config', async (event, newConfig) => {
    try {
      saveConfig(newConfig);
      return { success: true, message: 'Config saved.' };
    } catch (e) {
      return { success: false, message: `Save failed: ${e.message}` };
    }
  });

  ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Directory'
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('get-config', async () => loadConfig());

  ipcMain.handle('check-backend', async (event, port) => await checkPort(port));

  ipcMain.handle('clip-to-todo', async (event, payload) => {
    try {
      const config = loadConfig();
      const result = await requestBackend(config, 'POST', '/api/clip/to-todo', payload || {});
      return { success: true, data: result };
    } catch (e) {
      return { success: false, message: `clip to todo failed: ${e.message}` };
    }
  });

  ipcMain.handle('derive-knowledge', async (event, clipId, asyncMode = false) => {
    try {
      if (!clipId) {
        return { success: false, message: 'clipId is required' };
      }
      const config = loadConfig();
      const endpoint = `/api/knowledge/derive/${clipId}${asyncMode ? '?async=true' : ''}`;
      const result = await requestBackend(config, 'POST', endpoint);
      return { success: true, data: result };
    } catch (e) {
      return { success: false, message: `derive knowledge failed: ${e.message}` };
    }
  });

  ipcMain.handle('restart-backend', async (event, config) => {
    saveConfig({ ...config, configured: true });
    stopBackend();
    stopFrontendServer();
    await new Promise(resolve => setTimeout(resolve, 3000));
    try {
      await startFrontendServer(config);
    } catch (e) {
      return { success: false, message: `Frontend restart failed: ${e.message}` };
    }
    try {
      await startBackend(config);
    } catch (e) {
      return { success: false, message: `Backend restart failed: ${e.message}` };
    }
    // Wait for Spring Boot to fully initialize
    await new Promise(resolve => setTimeout(resolve, 3000));
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(`http://127.0.0.1:${config.frontendPort}`);
    } else {
      // If no main window exists, create one
      createMainWindow(config);
    }
    return { success: true, message: 'Services restarted' };
  });

  // Quit app from config window
  ipcMain.handle('quit-app', async () => {
    quitApp();
  });

  // Window controls (frameless)
  ipcMain.handle('window-minimize', () => { mainWindow?.minimize(); });
  ipcMain.handle('window-maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.handle('window-close', () => { mainWindow?.close(); });
  ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized() ?? false);
}

// ==================== App Lifecycle ====================

app.whenReady().then(async () => {
  setupIPC();
  const config = loadConfig();
  console.log('Config loaded:', JSON.stringify(config, null, 2));

  // Kill any existing processes on configured ports before starting
  killPortProcess(config.backendPort);
  killPortProcess(config.frontendPort);

  if (!config.configured || !config.apiKey) {
    // === First run: show config window ===
    console.log('First run - showing config window');
    mainWindow = new BrowserWindow({
      width: 560, height: 700, resizable: false,
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
      mainWindow.webContents.send('first-run', true);
    });

    ipcMain.on('config-done', async (event, newConfig) => {
      console.log('Config done received:', JSON.stringify(newConfig, null, 2));
      saveConfig({ ...newConfig, configured: true });

      // Send loading status to config window before closing
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('startup-progress', '正在启动前端服务...');
      }

      try {
        await startFrontendServer(newConfig);

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('startup-progress', '正在启动后端服务，请稍候...');
        }

        await startBackend(newConfig);

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('startup-progress', '启动成功！');
          await new Promise(resolve => setTimeout(resolve, 800));
          mainWindow.close();
          mainWindow = null;
        }

        createMainWindow(newConfig);
      } catch (e) {
        console.error('Startup failed:', e);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('startup-error', e.message);
        } else {
          dialog.showErrorBox('Startup Failed', e.message);
          app.quit();
        }
      }
    });
  } else {
    // === Already configured: start services ===
    try {
      await startFrontendServer(config);
      await startBackend(config);
      // Wait for Spring Boot to fully initialize
      await new Promise(resolve => setTimeout(resolve, 3000));
      createMainWindow(config);
    } catch (e) {
      console.error('Startup failed:', e);
      dialog.showErrorBox('Startup Failed',
        `Failed to start: ${e.message}\n\n` +
        `Java: ${getJavaCommand()}\n` +
        `JAR: ${getJarPath()}\n` +
        `Frontend: ${getFrontendDir()}\n\n` +
        `Open Settings (Ctrl+,) to reconfigure.`
      );
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

// Prevent default close behavior - use our quitApp instead
app.on('window-all-closed', (e) => {
  // On macOS, keep app alive; on other platforms, quit
  if (process.platform !== 'darwin') {
    quitApp();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  stopBackend();
  stopFrontendServer();
});

// Prevent windows from closing directly - ensure cleanup
app.on('will-quit', () => {
  stopBackend();
  stopFrontendServer();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const config = loadConfig();
    createMainWindow(config);
  }
});
