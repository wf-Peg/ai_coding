/**
 * update-manager.js — 桌面客户端自动更新模块
 * 
 * 职责：
 * 1. 下载更新包（clip-update-x.x.x.zip），支持 GitHub 直连与 gh-proxy 镜像多源回退
 * 2. 下载后校验 SHA-256 完整性
 * 3. 解压并替换 resources 目录（保留配置、日志与 jre）
 * 4. 通过 IPC 事件向渲染进程推送进度
 * 5. 支持自动更新（每日/每周/每月）和手动检查
 * 6. 提供最小直连 GitHub 检查（后端不可达时的降级路径）
 * 
 * 更新策略：
 * - 保留用户配置（userData 目录，与安装目录分离）
 * - 保留日志文件（APP_DIR/*.log）与 jre/（版本间不变，不随更新包下发）
 * - 仅替换更新包内存在的 resources/ 顶层条目（后端 JAR、前端文件、TODO 概览等）
 * - 更新完成后重启应用
 */

const { app, net } = require('electron');
const https = require('https');
const http = require('http');
const tls = require('tls');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

// ==================== 配置常量 ====================

/** GitHub 仓库 */
const GITHUB_REPO = 'wf-Peg/ai_coding';

/** GitHub Releases API */
const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

/**
 * gh-proxy 类镜像前缀（国内下载加速兜底）。
 * 按序拼接在 GitHub 下载 URL 之前；实例可能变更，可通过
 * update-config.json 的 mirrorUrls 数组覆盖/扩展（默认前置使用）。
 */
const DEFAULT_MIRROR_PREFIXES = [
  'https://ghproxy.com/',
  'https://mirror.ghproxy.com/',
  'https://ghfast.top/'
];

/** 更新检查间隔（毫秒）映射 */
const CHECK_INTERVALS = {
  daily: 24 * 60 * 60 * 1000,      // 每天
  weekly: 7 * 24 * 60 * 60 * 1000,  // 每周
  monthly: 30 * 24 * 60 * 60 * 1000 // 每月
};

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
 * 与现有配置合并写入，避免覆盖 lastCheck / mirrorUrls 等字段
 * （前端只传 { autoUpdate, frequency }，整体覆写会丢数据）。
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
    let merged = config;
    try {
      if (fs.existsSync(cfgPath)) {
        const existing = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
        merged = { ...existing, ...config };
      }
    } catch (e) {
      // 现有配置损坏时直接用新配置
    }
    fs.writeFileSync(cfgPath, JSON.stringify(merged, null, 2), 'utf-8');
  } catch (e) {
    console.error('[Update] Failed to save update config:', e.message);
  }
}

// ==================== 版本缓存 ====================

// 注：版本检查统一由后端 /api/update/check 完成（带 10 分钟进程内缓存），
// 此处不再维护本地版本缓存。仅保留最小直连 GitHub 检查作为后端不可达时的降级路径。

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

// ==================== 代理检测 ====================

/**
 * 检测系统代理 URL。
 * 优先级：HTTPS_PROXY > https_proxy > HTTP_PROXY > http_proxy > Windows 系统代理
 * Clash 等代理工具会自动设置系统代理，Electron 的 net 模块会自动跟随，
 * 但 Node.js 原生 https 模块不会，所以需要手动检测作为回退。
 * 
 * @returns {string|null} 代理 URL，如 "http://127.0.0.1:7890"，无代理返回 null
 */
function detectProxyUrl() {
  const envVars = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'];
  for (const v of envVars) {
    const val = process.env[v];
    if (val) {
      console.log(`[Update] Detected proxy from env ${v}: ${val}`);
      return val;
    }
  }

  // 尝试读取 Windows 系统代理设置
  if (process.platform === 'win32') {
    try {
      const { execSync } = require('child_process');
      const result = execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer 2>nul', { encoding: 'utf-8', timeout: 3000 });
      const match = result.match(/ProxyServer\s+REG_SZ\s+(.+)/);
      if (match && match[1].trim()) {
        const proxy = match[1].trim();
        const url = proxy.startsWith('http') ? proxy : `http://${proxy}`;
        console.log(`[Update] Detected proxy from Windows settings: ${url}`);
        return url;
      }
    } catch (e) {
      // 忽略错误
    }
  }

  return null;
}

/**
 * 创建通过 HTTP 代理隧道的 HTTPS Agent。
 * 与 Electron net 模块互补：net 模块为异步 fetch 走代理，此 Agent 为同步流式下载走代理。
 * 
 * @param {string} proxyUrl - 代理 URL（如 http://127.0.0.1:7890）
 * @returns {https.Agent}
 */
function createProxyAgent(proxyUrl) {
  const parsed = new URL(proxyUrl);
  const proxyHost = parsed.hostname;
  const proxyPort = parseInt(parsed.port, 10) || 8080;

  return new https.Agent({
    keepAlive: true,
    createConnection: (options, callback) => {
      const targetHost = options.hostname || options.host;
      const targetPort = options.port || 443;

      const req = http.request({
        host: proxyHost,
        port: proxyPort,
        method: 'CONNECT',
        path: `${targetHost}:${targetPort}`,
        headers: {
          'Proxy-Connection': 'Keep-Alive',
          'User-Agent': 'Clip-App-Update/1.0'
        },
        timeout: 10000
      });

      req.on('connect', (res, socket) => {
        if (res.statusCode !== 200) {
          callback(new Error(`Proxy CONNECT failed: ${res.statusCode} ${res.statusMessage}`));
          return;
        }
        const tlsSocket = tls.connect({
          socket,
          servername: targetHost,
          rejectUnauthorized: true
        }, () => {
          callback(null, tlsSocket);
        });
        tlsSocket.on('error', callback);
      });

      req.on('error', (err) => {
        callback(new Error(`Proxy connection to ${proxyHost}:${proxyPort} failed: ${err.message}`));
      });
      req.on('timeout', () => {
        req.destroy();
        callback(new Error(`Proxy CONNECT to ${targetHost}:${targetPort} via ${proxyHost}:${proxyPort} timed out`));
      });

      req.end();
    }
  });
}

// ==================== GitHub API 请求 ====================

/** 缓存的代理 URL（首次检测后缓存） */
let cachedProxyUrl = undefined;

/**
 * 获取代理 URL（带缓存，只检测一次）。
 */
function getProxyUrl() {
  if (cachedProxyUrl === undefined) {
    cachedProxyUrl = detectProxyUrl();
  }
  return cachedProxyUrl;
}

/**
 * 发送 HTTPS GET 请求。
 * 优先使用 Electron net.fetch（自动跟随系统代理），
 * 失败时回退到 Node.js https + 手动代理隧道。
 * 
 * @param {string} url - 请求 URL
 * @param {Object} headers - 额外请求头
 * @returns {Promise<string>} 响应体字符串
 */
async function httpsGet(url, headers = {}) {
  const defaultHeaders = {
    'User-Agent': 'Clip-App-Update-Checker/1.0',
    'Accept': 'application/vnd.github.v3+json',
    ...headers
  };

  // 方案 1：Electron net.fetch（自动跟随系统代理）
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const response = await net.fetch(url, {
      method: 'GET',
      headers: defaultHeaders,
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text().then(t => t.substring(0, 200))}`);
    }
    return await response.text();
  } catch (e) {
    console.log('[Update] net.fetch failed, trying manual proxy:', e.message);
  }

  // 方案 2：Node.js https + 手动代理隧道
  const proxyUrl = getProxyUrl();
  const agent = proxyUrl ? createProxyAgent(proxyUrl) : undefined;

  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: defaultHeaders,
      timeout: 15000,
      agent
    };

    const req = https.request(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // 重定向也走代理
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
      reject(new Error(`Network error: ${err.message}${proxyUrl ? ' (via proxy ' + proxyUrl + ')' : ' (direct)'}`));
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request to ${parsed.hostname} timed out after 15s${proxyUrl ? ' (via proxy ' + proxyUrl + ')' : ' (direct)'}`));
    });

    req.end();
  });
}

// ==================== 版本检查 ====================

/**
 * 从 GitHub Releases API 获取最新版本信息（后端不可达时的降级路径）。
 * 使用 GH_TOKEN 环境变量认证以避免 API 速率限制，走系统代理/手动代理。
 * 注意：正常路径由后端 /api/update/check 完成（带缓存）；本函数仅在本地后端
 * 不可达时由 main.js 调用，不维护本地版本缓存。
 * 
 * @returns {Promise<Object|null>} 包含 version, tagName, notes, downloadUrl,
 *          releaseUrl, sha256, size, publishedAt 的对象，失败返回 null
 */
async function checkLatestRelease() {
  let lastError = null;

  // 尝试带 Token 请求（避免速率限制）
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

  try {
    const body = await httpsGet(GITHUB_API, headers);
    return parseReleaseJson(body);
  } catch (e) {
    lastError = e.message;
    console.error('[Update] Failed to fetch latest release:', lastError);
  }

  // Token 请求失败，尝试无 Token 请求（如果之前用了 Token）
  if (token) {
    try {
      console.log('[Update] Retrying without token...');
      const body = await httpsGet(GITHUB_API, {});
      return parseReleaseJson(body);
    } catch (e2) {
      lastError = e2.message;
      console.error('[Update] Retry without token also failed:', lastError);
    }
  }

  console.error(`[Update] All attempts failed. Last error: ${lastError}`);
  return null;
}

/**
 * 解析 GitHub Releases API 响应，提取版本信息与更新包 asset。
 * 
 * @param {string} body - GitHub API 响应 JSON 字符串
 * @returns {Object} 版本信息对象
 */
function parseReleaseJson(body) {
  const release = JSON.parse(body);

  // 提取版本号（去掉 "v" 前缀）
  const tagName = release.tag_name || '';
  const version = tagName.replace(/^[vV]/, '');

  // 查找更新包下载地址（文件名包含 "clip-update"）
  let downloadUrl = null;
  let sha256 = null;
  let size = 0;
  const assets = release.assets || [];
  for (const asset of assets) {
    if (asset.name && asset.name.includes('clip-update') && asset.name.endsWith('.zip')) {
      downloadUrl = asset.browser_download_url;
      // GitHub API 的 asset.digest 形如 "sha256:xxxx"
      if (asset.digest && asset.digest.startsWith('sha256:')) {
        sha256 = asset.digest.substring('sha256:'.length);
      }
      size = asset.size || 0;
      break;
    }
  }

  return {
    version,
    tagName,
    notes: release.body || '',
    releaseUrl: release.html_url || '',
    downloadUrl,
    sha256,
    size,
    publishedAt: release.published_at || ''
  };
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
 * 构建下载候选 URL 列表（GitHub 原地址 + gh-proxy 镜像兜底）。
 * 镜像前缀可通过 update-config.json 的 mirrorUrls 数组覆盖/扩展（优先级：配置 > 默认）。
 * 
 * @param {string} downloadUrl - GitHub asset 下载 URL
 * @returns {Array<{url: string, name: string}>} 候选列表，name 用于进度文案
 */
function buildDownloadCandidates(downloadUrl) {
  if (!downloadUrl) return [];
  const candidates = [{ url: downloadUrl, name: 'GitHub' }];

  let prefixes;
  try {
    const cfg = loadUpdateConfig();
    prefixes = (Array.isArray(cfg.mirrorUrls) && cfg.mirrorUrls.length > 0)
      ? cfg.mirrorUrls
      : DEFAULT_MIRROR_PREFIXES;
  } catch (e) {
    prefixes = DEFAULT_MIRROR_PREFIXES;
  }

  for (const prefix of prefixes) {
    const normalized = prefix.endsWith('/') ? prefix : prefix + '/';
    // 已带镜像前缀的 URL 跳过，避免重复拼接
    if (downloadUrl.startsWith(normalized)) continue;
    candidates.push({ url: normalized + downloadUrl, name: new URL(normalized).hostname });
  }
  return candidates;
}

/**
 * 下载更新包到临时目录，并通过回调报告进度。
 * 
 * 支持 HTTP 重定向（GitHub 下载链接通常需要重定向到 S3/CDN）。
 * 下载过程中每收到数据块就调用 onProgress 回调。
 * 
 * @param {string} downloadUrl - 更新包下载 URL
 * @param {Function} onProgress - 进度回调 (receivedBytes, totalBytes, percent, sourceName)
 * @param {string} [expectedSha256] - 期望的 SHA-256（可选，提供则下载后校验）
 * @returns {Promise<string>} 下载文件路径
 */
function downloadUpdate(downloadUrl, onProgress, expectedSha256) {
  return new Promise((resolve, reject) => {
    const tempDir = path.join(app.getPath('temp'), 'clip-update');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const destPath = path.join(tempDir, 'update.zip');

    const parsed = new URL(downloadUrl);
    const isHttps = parsed.protocol === 'https:';
    const transport = isHttps ? https : http;

    // 下载也走代理
    const proxyUrl = getProxyUrl();
    const agent = proxyUrl ? createProxyAgent(proxyUrl) : undefined;

    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Clip-App-Update-Downloader/1.0',
        'Accept': 'application/octet-stream'
      },
      timeout: 300000, // 5 分钟超时
      agent
    };

    const req = transport.request(options, (res) => {
      // 处理重定向（透传校验参数）
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadUpdate(res.headers.location, onProgress, expectedSha256).then(resolve).catch(reject);
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
        // 下载完成：SHA-256 完整性校验
        if (expectedSha256) {
          const hash = crypto.createHash('sha256').update(fs.readFileSync(destPath)).digest('hex');
          if (hash.toLowerCase() !== expectedSha256.toLowerCase()) {
            fs.rmSync(destPath, { force: true });
            reject(new Error(`Checksum mismatch: expected ${expectedSha256.slice(0, 12)}..., got ${hash.slice(0, 12)}...`));
            return;
          }
          console.log('[Update] SHA-256 verified:', hash.slice(0, 16) + '...');
        }
        resolve(destPath);
      });

      fileStream.on('error', (err) => {
        reject(err);
      });

      res.pipe(fileStream);
    });

    req.on('error', (err) => {
      reject(new Error(`Download error: ${err.message}${proxyUrl ? ' (via proxy ' + proxyUrl + ')' : ' (direct)'}`));
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Download from ${parsed.hostname} timed out${proxyUrl ? ' (via proxy ' + proxyUrl + ')' : ' (direct)'}`));
    });

    req.end();
  });
}

/**
 * 多源回退下载：按候选列表依次尝试，全部失败才抛出最后一次错误。
 * 单个候选失败（网络错误/超时/校验失败）自动切换到下一个，并在进度回调标注当前源。
 * 
 * @param {Array<{url: string, name: string}>} candidates - buildDownloadCandidates 的结果
 * @param {Function} onProgress - 进度回调 (receivedBytes, totalBytes, percent, sourceName)
 * @param {string} [expectedSha256] - 期望的 SHA-256
 * @returns {Promise<string>} 下载文件路径
 */
async function downloadUpdateWithFallback(candidates, onProgress, expectedSha256) {
  if (!candidates || candidates.length === 0) {
    throw new Error('没有可用的下载地址');
  }

  let lastError = null;
  for (const candidate of candidates) {
    try {
      console.log(`[Update] Downloading via ${candidate.name}: ${candidate.url}`);
      if (onProgress) {
        onProgress(0, 0, 0, candidate.name); // 通知源切换
      }
      return await downloadUpdate(candidate.url, (received, total, percent) => {
        if (onProgress) onProgress(received, total, percent, candidate.name);
      }, expectedSha256);
    } catch (e) {
      lastError = e;
      console.error(`[Update] Download failed via ${candidate.name}:`, e.message);
      if (onProgress) {
        onProgress(-1, -1, -1, candidate.name); // 标记失败，前端可提示切换
      }
    }
  }
  throw lastError || new Error('下载失败');
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
      // 只替换更新包内存在的顶层条目；不在包内的目录（如 jre/）原样保留。
      const srcResources = path.join(extractDir, 'resources');

      if (fs.existsSync(srcResources)) {
        const packageEntries = fs.readdirSync(srcResources);
        const replaced = [];

        for (const entry of packageEntries) {
          const srcPath = path.join(srcResources, entry);
          const destPath = path.join(resourcesPath, entry);
          // 保留日志文件（如 backend.log）
          if (entry.endsWith('.log')) continue;
          try {
            if (fs.existsSync(destPath)) {
              fs.rmSync(destPath, { recursive: true, force: true });
            }
            if (fs.statSync(srcPath).isDirectory()) {
              copyDir(srcPath, destPath);
            } else {
              fs.mkdirSync(path.dirname(destPath), { recursive: true });
              fs.copyFileSync(srcPath, destPath);
            }
            replaced.push(entry);
          } catch (e) {
            console.error(`[Update] Failed to replace ${entry}:`, e.message);
          }
        }

        console.log(`[Update] Replaced entries: ${replaced.join(', ') || '(none)'}`);
        console.log(`[Update] Preserved entries not in package: ${fs.readdirSync(resourcesPath).filter(n => !replaced.includes(n)).join(', ') || '(none)'}`);
      } else {
        console.error('[Update] Update package has no resources/ directory, nothing to apply');
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
  checkLatestRelease,
  compareVersions,
  buildDownloadCandidates,
  downloadUpdate,
  downloadUpdateWithFallback,
  applyUpdate,
  startAutoCheck,
  stopAutoCheck,
  recordCheckTime,
  loadUpdateConfig,
  saveUpdateConfig
};