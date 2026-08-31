/**
 * Electron 主进程日志模块
 *
 * 同时输出到控制台和文件，日志文件写入 app.log。
 * 日志目录默认取 process.cwd()；建议在启动早期调用 init(dir) 固定为安装目录，
 * 避免"双击 exe 时 cwd 不等于安装目录"导致日志丢失。
 * 目录不可写时会自动兜底到系统用户数据目录（%LOCALAPPDATA%/CutShelter/logs），保证异常也能留痕。
 * 异常日志额外写入 {clip.storage.path}/tmp/exception-logs/ 目录，与后端统一格式。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

// 主日志目标：默认 cwd，可由 init(dir) 覆盖为安装目录
let logDir = process.cwd();
let logFile = path.join(logDir, 'app.log');

// 兜底目标：主目录不可写时切换
let fallbackDir = null;

// 确保日志目录存在（出现异常时不能让它成为主进程的崩溃点，故 try/catch）
function ensureDir(dir) {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return true;
  } catch (e) {
    console.error('Failed to create log dir:', dir, e.message);
    return false;
  }
}

try {
  ensureDir(logDir);
} catch (e) {
  // 顶层初始化容错，避免 require 阶段抛异常阻断主进程
}

/** 兜底日志目录：系统用户数据下的 CutShelter/logs（跨平台） */
function resolveFallbackDir() {
  if (fallbackDir) return fallbackDir;
  let base;
  if (process.platform === 'win32') {
    base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  } else {
    base = path.join(os.homedir(), '.cut-shelter');
  }
  fallbackDir = path.join(base, 'CutShelter', 'logs');
  return fallbackDir;
}

/**
 * 固定日志目录（一般传安装目录 APP_DIR）。
 * 主目录不可写时自动切换并落盘到兜底目录，保证始终有日志。
 * @param {string} dir 目标日志目录
 * @returns {string} 实际生效的日志文件路径
 */
function init(dir) {
  if (!dir) return logFile;
  logDir = dir;
  logFile = path.join(logDir, 'app.log');
  if (ensureDir(logDir)) {
    try {
      // 试写验证写权限
      fs.appendFileSync(logFile, '', 'utf-8');
      return logFile;
    } catch (e) {
      console.error('[Logger] primary log dir not writable, fallback:', e.message);
    }
  }
  // 主目录不可写 → 切到兜底目录
  const fbDir = resolveFallbackDir();
  if (ensureDir(fbDir)) {
    const fb = path.join(fbDir, 'app.log');
    try {
      fs.appendFileSync(fb, '', 'utf-8');
      logFile = fb;
      console.error(`[Logger] using fallback log: ${fb}`);
    } catch (e2) {
      console.error('Failed to init fallback log:', e2.message);
    }
  }
  return logFile;
}

// ===== 异常日志写入（统一格式） =====
let exceptionLogBaseDir = null;
let exceptionIdCounter = 0;
let exceptionCurrentDate = null;

/**
 * 初始化异常日志目录（在知道 storagePath 后调用）
 * @param {string} storagePath - clip-storage 目录路径
 */
function initExceptionLogger(storagePath) {
  exceptionLogBaseDir = path.join(storagePath, 'tmp', 'exception-logs');
  try {
    fs.mkdirSync(exceptionLogBaseDir, { recursive: true });
  } catch (e) {
    console.error('Failed to create exception log dir:', e.message);
  }
}

function getExceptionLogFile() {
  if (!exceptionLogBaseDir) return null;
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;
  const monthDir = `${yyyy}-${mm}`;
  const dir = path.join(exceptionLogBaseDir, monthDir);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    return null;
  }
  return path.join(dir, `exception-${dateStr}.jsonl`);
}

function writeExceptionLog(source, message, stackTrace, level) {
  if (!exceptionLogBaseDir) return;
  try {
    const file = getExceptionLogFile();
    if (!file) return;
    const now = new Date();
    const ts = now.toISOString().replace('T', ' ').substring(0, 23);
    const dateKey = ts.substring(0, 10);
    const seq = ++exceptionIdCounter;
    const entry = {
      id: `err_${dateKey.replace(/-/g, '')}_${String(seq).padStart(4, '0')}`,
      timestamp: ts,
      level: level || 'ERROR',
      source: 'electron',
      sourceDetail: '',
      message: message || '',
      stackTrace: stackTrace || '',
      thread: 'main'
    };
    fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf-8');
  } catch (e) {
    console.error('Failed to write exception log:', e.message);
  }
}

// ===== 常规日志 =====

function formatLog(level, ...args) {
  const now = new Date();
  const ts = now.toISOString().replace('T', ' ').substring(0, 23);
  const msg = args.map(a => {
    if (a instanceof Error) return a.stack || a.message;
    if (typeof a === 'object') {
      try { return JSON.stringify(a); } catch (e) { return String(a); }
    }
    return String(a);
  }).join(' ');
  return `${ts} [${level}] ${msg}\n`;
}

function writeLog(level, ...args) {
  const line = formatLog(level, ...args);
  // 控制台输出
  const consoleFn = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log;
  consoleFn(...args);
  // 文件写入（主目录失败时兜底写入用户数据目录）
  try {
    fs.appendFileSync(logFile, line, 'utf-8');
  } catch (e) {
    console.error('Failed to write log file:', e.message);
  }
  // ERROR 级别额外写入异常日志文件
  if (level === 'ERROR' && exceptionLogBaseDir) {
    const errorMsg = args.map(a => {
      if (a instanceof Error) return a.message || String(a);
      return String(a);
    }).join(' ');
    const errorStack = args.find(a => a instanceof Error)
      ? (args.find(a => a instanceof Error).stack || '')
      : '';
    writeExceptionLog('electron', errorMsg, errorStack, 'ERROR');
  }
}

function cleanupOldLogs() {
  // app.log 持续保留，不做自动清理。
}

module.exports = {
  info: (...args) => writeLog('INFO', ...args),
  warn: (...args) => writeLog('WARN', ...args),
  error: (...args) => writeLog('ERROR', ...args),
  init,
  cleanupOldLogs,
  initExceptionLogger,
  writeExceptionLog,
  get logDir() { return logDir; },
  get logFile() { return logFile; },
  get LOG_DIR() { return logDir; },
  get LOG_FILE() { return logFile; }
};