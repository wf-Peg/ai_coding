'use strict';

const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { EditorFileService } = require('./editor-file-service');

const DEFAULT_AI_CONFIG = {
  activeProvider: 'deepseek',
  deepseekApiKey: '',
  deepseekModel: 'deepseek-chat',
  dashscopeApiKey: '',
  dashscopeModel: 'qwen-plus'
};

let mainWindow = null;
let tray = null;
let fileService = null;
let isQuitting = false;

const configDir = () => path.join(app.getPath('userData'), 'lite-config');
const configPath = () => path.join(configDir(), 'lite-config.json');
const notesDir = () => path.join(app.getPath('userData'), 'notes');

let cachedConfig = {
  fullVersionPath: '',
  aiConfig: { ...DEFAULT_AI_CONFIG }
};

function ensureDirs() {
  try {
    fs.mkdirSync(configDir(), { recursive: true });
    fs.mkdirSync(notesDir(), { recursive: true });
  } catch (_) {}
}

function loadConfig() {
  try {
    if (fs.existsSync(configPath())) {
      const raw = JSON.parse(fs.readFileSync(configPath(), 'utf-8'));
      cachedConfig = {
        fullVersionPath: typeof raw.fullVersionPath === 'string' ? raw.fullVersionPath : '',
        aiConfig: { ...DEFAULT_AI_CONFIG, ...(raw.aiConfig || {}) }
      };
    }
  } catch (_) {
    cachedConfig = {
      fullVersionPath: '',
      aiConfig: { ...DEFAULT_AI_CONFIG }
    };
  }
}

function saveConfig(next) {
  ensureDirs();
  cachedConfig = {
    fullVersionPath: typeof next?.fullVersionPath === 'string' ? next.fullVersionPath : cachedConfig.fullVersionPath,
    aiConfig: { ...DEFAULT_AI_CONFIG, ...(next?.aiConfig || cachedConfig.aiConfig) }
  };
  fs.writeFileSync(configPath(), JSON.stringify(cachedConfig, null, 2), 'utf-8');
  return cachedConfig;
}

function detectDevModePath() {
  if (app.isPackaged) return null;
  const parent = path.resolve(__dirname, '..');
  const electronMain = path.join(parent, 'electron', 'main.js');
  const pkgPath = path.join(parent, 'package.json');
  if (!fs.existsSync(electronMain) || !fs.existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    if (pkg.name !== 'clip-demo') return null;
  } catch (_) {
    return null;
  }
  return { command: process.execPath, args: [parent], displayPath: parent };
}

function detectPackagedPath() {
  const candidates = [];
  if (process.platform === 'win32') {
    const localApp = process.env.LOCALAPPDATA || '';
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    candidates.push(path.join(localApp, 'CutShelter', 'CutShelter.exe'));
    candidates.push(path.join(programFiles, 'CutShelter', 'CutShelter.exe'));
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/CutShelter.app');
  } else {
    candidates.push('/opt/CutShelter/CutShelter');
    candidates.push(path.join(app.getPath('home'), 'CutShelter', 'CutShelter'));
  }
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return { command: candidate, args: [], displayPath: candidate };
    } catch (_) {}
  }
  return null;
}

async function launchFullVersion() {
  let target = null;
  if (cachedConfig.fullVersionPath && fs.existsSync(cachedConfig.fullVersionPath)) {
    target = { command: cachedConfig.fullVersionPath, args: [], displayPath: cachedConfig.fullVersionPath };
  }
  if (!target) target = detectDevModePath();
  if (!target) target = detectPackagedPath();
  if (!target) {
    const result = await dialog.showOpenDialog(mainWindow || undefined, {
      title: '选择完整版 CutShelter 可执行文件',
      properties: ['openFile'],
      filters: process.platform === 'darwin'
        ? [{ name: 'App', extensions: ['app'] }]
        : [{ name: '可执行文件', extensions: ['exe', 'AppImage', ''] }]
    });
    if (result.canceled || !result.filePaths[0]) {
      return { ok: false, reason: 'user_canceled' };
    }
    target = { command: result.filePaths[0], args: [], displayPath: result.filePaths[0] };
    cachedConfig.fullVersionPath = result.filePaths[0];
    saveConfig(cachedConfig);
  }
  try {
    const child = spawn(target.command, target.args, {
      detached: true,
      stdio: 'ignore',
      shell: false
    });
    child.on('error', (err) => {
      sendToast('启动完整版失败：' + err.message);
    });
    child.unref();
    return { ok: true, path: target.displayPath };
  } catch (err) {
    return { ok: false, reason: 'spawn_failed', message: err.message };
  }
}

function sendToast(message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('lite:toast', { message });
  }
}

function setupWorkspaceIpc() {
  ipcMain.handle('workspace:get', () => {
    return { dir: notesDir() };
  });
}

function setupFileIpc() {
  ipcMain.handle('file:openDialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow || undefined, {
      title: '打开文件',
      properties: ['openFile'],
      filters: [
        { name: '文本', extensions: ['txt', 'md', 'json', 'xml', 'sql', 'csv', 'log', 'yaml', 'yml', 'ini', 'conf'] },
        { name: '全部', extensions: ['*'] }
      ]
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    try {
      return fileService.openPath(result.filePaths[0]);
    } catch (err) {
      return { canceled: false, error: err.message };
    }
  });

  ipcMain.handle('file:openPath', async (_event, filePath) => {
    if (!filePath || typeof filePath !== 'string') return { canceled: false, error: '路径无效' };
    try {
      return fileService.openPath(filePath);
    } catch (err) {
      return { canceled: false, error: err.message };
    }
  });

  ipcMain.handle('file:save', async (_event, fileToken, payload) => {
    try {
      return fileService.save(fileToken, payload);
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('file:saveAsDialog', async (_event, payload) => {
    const result = await dialog.showSaveDialog(mainWindow || undefined, {
      title: '另存为',
      defaultPath: payload?.defaultPath || 'untitled.txt',
      filters: [
        { name: '文本', extensions: ['txt', 'md', 'json', 'xml', 'sql', 'csv', 'log', 'yaml', 'yml', 'ini', 'conf'] },
        { name: '全部', extensions: ['*'] }
      ]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    try {
      return fileService.saveAs(result.filePath, payload);
    } catch (err) {
      return { canceled: false, error: err.message };
    }
  });

  ipcMain.handle('file:reopen', async (_event, fileToken, encoding) => {
    try {
      return fileService.reopen(fileToken, encoding);
    } catch (err) {
      return { error: err.message };
    }
  });
}

function setupAiConfigIpc() {
  ipcMain.handle('ai:getConfig', () => {
    return { ...cachedConfig.aiConfig };
  });
  ipcMain.handle('ai:saveConfig', (_event, next) => {
    if (!next || typeof next !== 'object') return { ok: false, error: '参数无效' };
    cachedConfig.aiConfig = { ...DEFAULT_AI_CONFIG, ...cachedConfig.aiConfig, ...next };
    saveConfig(cachedConfig);
    return { ok: true, aiConfig: { ...cachedConfig.aiConfig } };
  });
}

function setupLaunchFullIpc() {
  ipcMain.handle('launch:full', async () => {
    return await launchFullVersion();
  });

  ipcMain.handle('launch:resetFullPath', async () => {
    cachedConfig.fullVersionPath = '';
    saveConfig(cachedConfig);
    return { ok: true };
  });
}

function setupWindowIpc() {
  ipcMain.handle('window:hide', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
    return { ok: true };
  });
  ipcMain.handle('window:show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
    return { ok: true };
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 640,
    minWidth: 600,
    minHeight: 400,
    title: 'CutShelter Lite',
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, 'frontend', 'editor.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.minimize();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  try {
    const trayIconPath = path.join(__dirname, 'tray-icon.png');
    const iconPath = fs.existsSync(trayIconPath) ? trayIconPath : undefined;
    tray = new Tray(iconPath || nativeImage.createEmpty());
  } catch (_) {
    return;
  }
  const contextMenu = Menu.buildFromTemplate([
    { label: '显示窗口', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { label: '启动完整版', click: async () => { await launchFullVersion(); } },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } }
  ]);
  tray.setToolTip('CutShelter Lite');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) mainWindow.hide();
    else { mainWindow.show(); mainWindow.focus(); }
  });
}

function registerGlobalShortcuts() {
  try {
    const ok = globalShortcut.register('Alt+X', () => {
      if (!mainWindow) return;
      if (mainWindow.isVisible() && mainWindow.isFocused()) mainWindow.hide();
      else {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    });
    if (!ok) {
      console.warn('Failed to register Alt+X global shortcut');
    }
  } catch (err) {
    console.warn('Global shortcut error:', err.message);
  }
}

const { nativeImage } = require('electron');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    ensureDirs();
    loadConfig();
    fileService = new EditorFileService();
    setupWorkspaceIpc();
    setupFileIpc();
    setupAiConfigIpc();
    setupLaunchFullIpc();
    setupWindowIpc();
    createWindow();
    createTray();
    registerGlobalShortcuts();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else if (mainWindow) mainWindow.show();
    });
  });

  app.on('before-quit', () => {
    isQuitting = true;
  });

  app.on('will-quit', () => {
    try { globalShortcut.unregisterAll(); } catch (_) {}
  });
}
