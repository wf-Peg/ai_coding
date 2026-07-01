/**
 * update-manager.js — 桌面客户端自动更新模块
 * 
 * 职责：
 * 1. 查询 GitHub Releases API 检测最新版本
 * 2. 下载更新包（clip-update-x.x.x.zip）
 * 3. 解压并替换 resources 目录（保留配置和日志）
 * 4. 通过 IPC 事件向渲染进程推送进度
 * 5. 支持自动更新（每日/每周/每月）和手动检查
 * 
 * 更新策略：
 * - 保留用户配置（userData 目录，与安装目录分离）
 * - 保留日志文件（APP_DIR/*.log）
 * - 仅替换 resources/ 下的后端 JAR 和前端文件
 * - 更新完成后重启应用
 */

const { app, BrowserWindow } = require('electron');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

// ==================== 配置常量 ====================

/** GitHub 仓库 */
const GITHUB_REPO = 'wf-Peg/ai_coding';

/** GitHub Releases API */
const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

/** 更新检查间隔（毫秒）映射 */
const CHECK_INTERVALS = {
  daily: 24 * 60 * 60 * 1000,      // 每天
  weekly: 7 * 24 * 60 * 60 * 1000,  // 每周
  monthly: 30 * 24 * 60 * 60 * 1000 // 每月
};

/** 上次检查时间戳存储键 */
const LAST_CHECK_KEY = 'lastUpdateCheck';

/** 更新配置存储路径 */
function getUpdateConfigPath() {
  const userData = app.getPath('userData');
  return path.join(userData, 'config', 'update-config.json');
}

// ==================== 更新配置管理 ====================

/**
 * 加载更新配置。
 * 包含：自动更新开关、检查频率、上次检查时间戳。
 * 
 * @returns {Object} 更新配置对象
 */
function loadUpdateConfig() {
  try {
    const cfgPath = getUpdateConfigPath();
    if (fs.existsSync(cfgPath)) {
      return JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    }
  } catch (e) {
    console.error('[Update] Failed to load update config:', e.message);
  }
  return {
    autoUpdate: true,
    frequency: 'weekly',    // daily | weekly | monthly
    lastCheck: 0
  };
}

/**
 * 保存更新配置。
 * 
 * @param {Object} config - 更新配置对象
 */
function saveUpdateConfig(config) {
  try {
    const cfgPath = getUpdateConfigPath();
    const dir = path.dirname(cfgPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (e) {
    console.error('[Update] Failed to save update config:', e.message);
  }
}

// ==================== 版本信息 ====================

/**
 * 获取当前应用版本号。
 * 从 package.json 读取，打包后从 app.asar 中读取。
 * 
 * @returns {string} 版本号，如 "1.0.0"
 */
function getCurrentVersion() {
  try {
    const pkgPath = path.join(app.getAppPath(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg.version || '1.0.0';
  } catch (e) {
    console.error('[Update] Failed to read version:', e.message);
    return '1.0.0';
  }
}

// ==================== GitHub API 请求 ====================

/**
 * 发送 HTTPS GET 请求。
 * 
 * @param {string} url - 请求 URL
 * @param {Object} headers - 额外请求头
 * @returns {Promise<string>} 响应体字符串
 */
function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Clip-App-Update-Checker/1.0',
        'Accept': 'application/vnd.github.v3+json',
        ...headers
      },
      timeout: 15000
    };

    const req = https.request(options, (res) => {
      // 处理重定向
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpsGet(res.headers.location, headers).then(resolve).catch(reject);
        return;
      }

      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body.substring(0, 200)}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Network error: ${err.message}`));
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request to ${parsed.hostname} timed out after 15s`));
    });

    req.end();
  });
}

// ==================== 版本检查 ====================

/**
 * 从 GitHub Releases API 获取最新版本信息。
 * 使用 GH_TOKEN 环境变量认证以避免 API 速率限制。
 * 
 * @returns {Promise<Object|null>} 包含 version, notes, downloadUrl, releaseUrl 的对象，失败返回 null
 */
async function fetchLatestRelease() {
  let lastError = null;
  
  // 尝试带 Token 请求（避免速率限制）
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

  try {
    const body = await httpsGet(GITHUB_API, headers);
    const release = JSON.parse(body);

    // 提取版本号（去掉 "v" 前缀）
    const tagName = release.tag_name || '';
    const version = tagName.replace(/^[vV]/, '');

    // 查找更新包下载地址（文件名包含 "clip-update"）
    let downloadUrl = null;
    const assets = release.assets || [];
    for (const asset of assets) {
      if (asset.name && asset.name.includes('clip-update') && asset.name.endsWith('.zip')) {
        downloadUrl = asset.browser_download_url;
        break;
      }
    }

    return {
      version,
      tagName,
      notes: release.body || '',
      releaseUrl: release.html_url || '',
      downloadUrl,
      publishedAt: release.published_at || ''
    };
  } catch (e) {
    lastError = e.message;
    console.error('[Update] Failed to fetch latest release:', lastError);
  }

  // Token 请求失败，尝试无 Token 请求（如果之前用了 Token）
  if (token) {
    try {
      console.log('[Update] Retrying without token...');
      const body = await httpsGet(GITHUB_API, {});
      const release = JSON.parse(body);
      const tagName = release.tag_name || '';
      const version = tagName.replace(/^[vV]/, '');
      let downloadUrl = null;
      const assets = release.assets || [];
      for (const asset of assets) {
        if (asset.name && asset.name.includes('clip-update') && asset.name.endsWith('.zip')) {
          downloadUrl = asset.browser_download_url;
          break;
        }
      }
      return {
        version,
        tagName,
        notes: release.body || '',
        releaseUrl: release.html_url || '',
        downloadUrl,
        publishedAt: release.published_at || ''
      };
    } catch (e2) {
      lastError = e2.message;
      console.error('[Update] Retry without token also failed:', lastError);
    }
  }

  console.error(`[Update] All attempts failed. Last error: ${lastError}`);
  return null;
}

/**
 * 比较两个语义化版本号。
 * 
 * @param {string} v1 - 版本号 1
 * @param {string} v2 - 版本号 2
 * @returns {number} 正数:v1>v2, 0:相等, 负数:v1<v2
 */
function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  const len = Math.max(parts1.length, parts2.length);
  for (let i = 0; i < len; i++) {
    const n1 = parts1[i] || 0;
    const n2 = parts2[i] || 0;
    if (n1 !== n2) return n1 - n2;
  }
  return 0;
}

// ==================== 下载更新包 ====================

/**
 * 下载更新包到临时目录，并通过回调报告进度。
 * 
 * 支持 HTTP 重定向（GitHub 下载链接通常需要重定向到 S3/CDN）。
 * 下载过程中每收到数据块就调用 onProgress 回调。
 * 
 * @param {string} downloadUrl - 更新包下载 URL
 * @param {Function} onProgress - 进度回调 (receivedBytes, totalBytes, percent)
 * @returns {Promise<string>} 下载文件路径
 */
function downloadUpdate(downloadUrl, onProgress) {
  return new Promise((resolve, reject) => {
    const tempDir = path.join(app.getPath('temp'), 'clip-update');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const destPath = path.join(tempDir, 'update.zip');

    const parsed = new URL(downloadUrl);
    const isHttps = parsed.protocol === 'https:';
    const transport = isHttps ? https : http;

    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Clip-App-Update-Downloader/1.0',
        'Accept': 'application/octet-stream'
      },
      timeout: 300000 // 5 分钟超时
    };

    const req = transport.request(options, (res) => {
      // 处理重定向
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadUpdate(res.headers.location, onProgress).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        return;
      }

      const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
      let receivedBytes = 0;
      const fileStream = fs.createWriteStream(destPath);

      res.on('data', (chunk) => {
        receivedBytes += chunk.length;
        const percent = totalBytes > 0 ? Math.round((receivedBytes / totalBytes) * 100) : -1;
        if (onProgress) {
          onProgress(receivedBytes, totalBytes, percent);
        }
      });

      res.on('end', () => {
        fileStream.end();
      });

      res.on('error', (err) => {
        fileStream.destroy();
        reject(err);
      });

      fileStream.on('finish', () => {
        resolve(destPath);
      });

      fileStream.on('error', (err) => {
        reject(err);
      });

      res.pipe(fileStream);
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Download timeout'));
    });

    req.end();
  });
}

// ==================== 应用更新 ====================

/**
 * 应用更新包。
 * 
 * 流程：
 * 1. 解压更新包到临时目录
 * 2. 停止后端服务
 * 3. 备份旧 resources 目录（保留配置和日志）
 * 4. 替换 resources 目录内容
 * 5. 通知渲染进程更新完成
 * 6. 重启应用
 * 
 * 保留策略：
 * - 配置目录（userData）不触碰
 * - *.log 文件不删除
 * - 仅替换 resources/ 下的文件
 * 
 * @param {string} zipPath - 更新包路径
 * @param {Function} sendProgress - 发送进度到渲染进程的函数
 * @returns {Promise<void>}
 */
async function applyUpdate(zipPath, sendProgress) {
  sendProgress('正在解压更新包...', 70);

  // 1. 解压到临时目录
  const extractDir = path.join(app.getPath('temp'), 'clip-update-extracted');
  if (fs.existsSync(extractDir)) {
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
  fs.mkdirSync(extractDir, { recursive: true });

  await extractZip(zipPath, extractDir);

  sendProgress('正在准备更新...', 80);

  // 2. 确定资源目录
  const isPackaged = app.isPackaged;
  const resourcesPath = isPackaged ? process.resourcesPath : app.getAppPath();
  const appDir = isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath();

  sendProgress('正在备份旧文件...', 85);

  // 3. 备份旧 resources 目录
  const backupDir = path.join(app.getPath('temp'), 'clip-backup');
  if (fs.existsSync(backupDir)) {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }

  if (isPackaged) {
    // 打包模式：复制 resources 目录做备份
    copyDir(resourcesPath, backupDir);
  }

  sendProgress('正在替换文件...', 90);

  try {
    if (isPackaged) {
      // 4. 替换 resources 目录内容
      // 更新包内结构：resources/backend/..., resources/frontend/..., resources/app.asar
      const srcResources = path.join(extractDir, 'resources');

      if (fs.existsSync(srcResources)) {
        // 删除旧文件（保留日志）
        const entries = fs.readdirSync(resourcesPath);
        for (const entry of entries) {
          const fullPath = path.join(resourcesPath, entry);
          // 保留日志文件
          if (entry.endsWith('.log')) continue;
          try {
            fs.rmSync(fullPath, { recursive: true, force: true });
          } catch (e) {
            console.error(`[Update] Failed to remove ${entry}:`, e.message);
          }
        }

        // 复制新文件
        copyDir(srcResources, resourcesPath);
      }
    } else {
      // 开发模式：仅更新 frontend 和 backend 文件
      const srcBackend = path.join(extractDir, 'resources', 'backend');
      const srcFrontend = path.join(extractDir, 'resources', 'frontend');

      if (fs.existsSync(srcBackend)) {
        copyDir(srcBackend, path.join(appDir, 'backend'));
      }
      if (fs.existsSync(srcFrontend)) {
        copyDir(srcFrontend, path.join(appDir, 'frontend'));
      }
    }
    sendProgress('更新完成，即将重启...', 100);
  } catch (e) {
    // 更新失败，恢复备份
    console.error('[Update] Apply failed, restoring backup:', e.message);
    if (fs.existsSync(backupDir)) {
      copyDir(backupDir, resourcesPath);
    }
    throw e;
  }
}

/**
 * 解压 ZIP 文件。
 * 使用系统自带命令（Windows: PowerShell, macOS/Linux: unzip）。
 * 
 * @param {string} zipPath - ZIP 文件路径
 * @param {string} destDir - 解压目标目录
 * @returns {Promise<void>}
 */
function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    let cmd, args;
    if (process.platform === 'win32') {
      cmd = 'powershell';
      args = ['-Command', `Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force`];
    } else {
      cmd = 'unzip';
      args = ['-o', zipPath, '-d', destDir];
    }

    const child = spawn(cmd, args, { stdio: 'pipe' });
    let stderr = '';

    child.stderr.on('data', (data) => { stderr += data.toString(); });
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Extract failed (code ${code}): ${stderr}`));
      }
    });
    child.on('error', reject);
  });
}

/**
 * 递归复制目录。
 * 
 * @param {string} src - 源目录
 * @param {string} dest - 目标目录
 */
function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;

  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ==================== 定时检查 ====================

/** 定时器 ID */
let checkTimer = null;

/**
 * 启动自动更新检查定时器。
 * 根据配置的频率定期检查更新。
 * 
 * @param {Function} checkFn - 检查回调函数
 */
function startAutoCheck(checkFn) {
  stopAutoCheck();

  const config = loadUpdateConfig();
  if (!config.autoUpdate) return;

  const interval = CHECK_INTERVALS[config.frequency] || CHECK_INTERVALS.weekly;

  // 首次启动时立即检查一次
  const lastCheck = config.lastCheck || 0;
  const now = Date.now();

  if (now - lastCheck >= interval) {
    // 延迟 5 秒启动，避免影响应用启动速度
    setTimeout(() => {
      checkFn().catch(e => console.error('[Update] Auto-check failed:', e.message));
    }, 5000);
  }

  // 设置定时器
  checkTimer = setInterval(() => {
    const cfg = loadUpdateConfig();
    if (cfg.autoUpdate) {
      checkFn().catch(e => console.error('[Update] Auto-check failed:', e.message));
    }
  }, interval);
}

/**
 * 停止自动更新检查定时器。
 */
function stopAutoCheck() {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
}

/**
 * 记录本次检查时间。
 */
function recordCheckTime() {
  const config = loadUpdateConfig();
  config.lastCheck = Date.now();
  saveUpdateConfig(config);
}

// ==================== 导出 ====================

module.exports = {
  getCurrentVersion,
  fetchLatestRelease,
  compareVersions,
  downloadUpdate,
  applyUpdate,
  startAutoCheck,
  stopAutoCheck,
  recordCheckTime,
  loadUpdateConfig,
  saveUpdateConfig
};