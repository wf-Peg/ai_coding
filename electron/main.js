const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const http = require('http');
const yaml = require('js-yaml');

// ==================== Path Resolution ====================
// 打包后: exe 在安装目录, resources 在安装目录/resources
// 开发时: app.getAppPath() 返回项目根目录
const isPackaged = app.isPackaged;
const resourcesPath = process.resourcesPath || app.getAppPath();
const APP_DIR = isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath();

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
    console.error('Load config failed:', e);
  }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(config) {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

// ==================== Backend Process Management ====================

let backendProcess = null;
let mainWindow = null;
let configWindow = null;

function getJavaCommand() {
  const isWin = process.platform === 'win32';
  const javaExe = isWin ? 'java.exe' : 'java';

  // 1. Check embedded JRE in resources (packaged app)
  const embeddedPaths = [
    path.join(resourcesPath, 'jre', 'bin', javaExe),
    path.join(resourcesPath, 'runtime', 'bin', javaExe),
  ];

  // 2. Check next to exe (unpacked / portable)
  const localPaths = [
    path.join(APP_DIR, 'jre', 'bin', javaExe),
    path.join(APP_DIR, 'runtime', 'bin', javaExe),
  ];

  const allPaths = [...embeddedPaths, ...localPaths];

  for (const p of allPaths) {
    if (fs.existsSync(p)) {
      console.log('Found Java at:', p);
      return p;
    }
  }

  // 3. Fallback to system Java
  console.log('No embedded JRE found, using system java');
  return 'java';
}

function getJarPath() {
  const possiblePaths = [
    // Packaged: jar in resources/backend/
    path.join(resourcesPath, 'backend', 'clip-demo-0.0.1-SNAPSHOT.jar'),
    // Portable: jar next to exe
    path.join(APP_DIR, 'backend', 'clip-demo-0.0.1-SNAPSHOT.jar'),
    path.join(APP_DIR, 'clip-demo-0.0.1-SNAPSHOT.jar'),
    // Dev mode
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
    // Packaged: frontend in resources/
    path.join(resourcesPath, 'frontend'),
    // Dev mode
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
  return yaml.dump({
    spring: {
      application: { name: 'clip-demo' },
      ai: {
        dashscope: {
          'api-key': config.apiKey,
          chat: { options: { model: 'qwen-plus' } }
        }
      }
    },
    server: { port: config.backendPort },
    clip: {
      storage: { path: config.storagePath },
      'organized-storage': { path: config.organizedPath }
    }
  }, { lineWidth: -1, quotingType: '"' });
}

function startBackend(config) {
  return new Promise((resolve, reject) => {
    const jarPath = getJarPath();
    if (!jarPath) {
      reject(new Error('Cannot find backend JAR. Searched:\n- resources/backend/\n- app directory'));
      return;
    }

    const javaCmd = getJavaCommand();

    // Ensure storage dirs exist
    if (!fs.existsSync(config.storagePath)) {
      fs.mkdirSync(config.storagePath, { recursive: true });
    }
    if (!fs.existsSync(config.organizedPath)) {
      fs.mkdirSync(config.organizedPath, { recursive: true });
    }

    // Write application.yml next to jar
    const jarDir = path.dirname(jarPath);
    const ymlPath = path.join(jarDir, 'application.yml');
    fs.writeFileSync(ymlPath, generateApplicationYml(config), 'utf-8');

    console.log(`Starting backend: ${javaCmd} -jar ${jarPath}`);
    console.log(`Working dir: ${jarDir}`);

    backendProcess = spawn(javaCmd, ['-jar', jarPath], {
      cwd: jarDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env }
    });

    let resolved = false;

    backendProcess.stdout.on('data', (data) => {
      const msg = data.toString();
      console.log(`[Backend] ${msg}`);
      if (!resolved && (msg.includes('Started ClipDemoApplication') || msg.includes('JVM running for'))) {
        resolved = true;
        resolve(true);
      }
    });

    backendProcess.stderr.on('data', (data) => {
      const msg = data.toString();
      console.error(`[Backend ERR] ${msg}`);
    });

    backendProcess.on('close', (code) => {
      console.log(`Backend exited with code: ${code}`);
      backendProcess = null;
    });

    backendProcess.on('error', (err) => {
      console.error(`Backend start error: ${err.message}`);
      if (!resolved) {
        resolved = true;
        reject(new Error(`Backend failed to start: ${err.message}\n\nJava command: ${javaCmd}\nJAR path: ${jarPath}`));
      }
    });

    // Timeout check
    setTimeout(() => {
      if (!resolved) {
        checkPort(config.backendPort).then((open) => {
          if (!resolved) {
            resolved = true;
            if (open) resolve(true);
            else reject(new Error('Backend startup timeout (30s). Check if Java is working correctly.'));
          }
        });
      }
    }, 30000);
  });
}

function stopBackend() {
  if (backendProcess) {
    console.log('Stopping backend...');
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
      hostname: '127.0.0.1', port: port,
      path: '/api/clip/list', method: 'GET', timeout: 2000
    }, () => { resolve(true); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
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
    const serve = serveStatic(frontendDir, { index: ['index.html'] });

    const server = http.createServer((req, res) => {
      serve(req, res, finalhandler(req, res));
    });

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
    title: 'Clip',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadURL(`http://127.0.0.1:${config.frontendPort}`);

  mainWindow.on('closed', () => { mainWindow = null; });

  const menuTemplate = [
    {
      label: 'Clip',
      submenu: [
        { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => showConfigWindow(config) },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
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
    width: 560, height: 650, resizable: false,
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

// ==================== IPC ====================

function setupIPC() {
  ipcMain.handle('save-config', async (event, newConfig) => {
    try {
      saveConfig(newConfig);
      return { success: true, message: 'Config saved. Restart to apply.' };
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

  ipcMain.handle('restart-backend', async (event, config) => {
    // 1. Save config first
    saveConfig({ ...config, configured: true });

    // 2. Stop existing services
    stopBackend();
    stopFrontendServer();
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 3. Restart frontend server (port may have changed)
    try {
      await startFrontendServer(config);
    } catch (e) {
      return { success: false, message: `Frontend restart failed: ${e.message}` };
    }

    // 4. Restart backend
    try {
      await startBackend(config);
    } catch (e) {
      return { success: false, message: `Backend restart failed: ${e.message}` };
    }

    // 5. Reload main window to new frontend port
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(`http://127.0.0.1:${config.frontendPort}`);
    }

    return { success: true, message: 'Services restarted' };
  });
}

// ==================== App Lifecycle ====================

app.whenReady().then(async () => {
  setupIPC();

  const config = loadConfig();
  console.log('Config loaded:', JSON.stringify(config, null, 2));

  if (!config.configured || !config.apiKey) {
    // First run - show config window
    console.log('First run - showing config window');

    mainWindow = new BrowserWindow({
      width: 560, height: 650, resizable: false,
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

    // Listen for config done (use ipcMain.on for send, not handle)
    ipcMain.on('config-done', async (event, newConfig) => {
      console.log('Config done received:', JSON.stringify(newConfig, null, 2));
      saveConfig({ ...newConfig, configured: true });

      // Close config window
      if (mainWindow) {
        mainWindow.close();
        mainWindow = null;
      }

      // Start services
      try {
        console.log('Starting frontend server...');
        await startFrontendServer(newConfig);
        console.log('Starting backend...');
        await startBackend(newConfig);
        console.log('Creating main window...');
        createMainWindow(newConfig);
      } catch (e) {
        console.error('Startup failed:', e);
        dialog.showErrorBox('Startup Failed',
          `Failed to start: ${e.message}\n\n` +
          `Java: ${getJavaCommand()}\n` +
          `JAR: ${getJarPath()}\n` +
          `Frontend: ${getFrontendDir()}`
        );
        app.quit();
      }
    });
  } else {
    // Already configured - start directly
    try {
      console.log('Starting frontend server...');
      await startFrontendServer(config);
      console.log('Starting backend...');
      await startBackend(config);
      console.log('Creating main window...');
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
      // Show config window instead of quitting
      mainWindow = new BrowserWindow({
        width: 560, height: 650, resizable: false,
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
