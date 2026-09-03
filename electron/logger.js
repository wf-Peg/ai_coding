/**
 * Electron 主进程日志模块
 *
 * 同时输出到控制台和文件，日志文件写入当前项目/应用工作目录下的 app.log。
 * 异常日志额外写入 {clip.storage.path}/tmp/exception-logs/ 目录，与后端统一格式。
 */
const fs = require('fs');
const path = require('path');
// 日志目录：打包后写 exe 同目录（保证便携版双击启动时一定可落盘、可复盘），
// 开发模式用进程工作目录。不再依赖 process.cwd() —— 便携版经资源管理器双击时 cwd 不稳定。
let LOG_DIR = process.cwd();
try {
  const { app } = require('electron');
  if (app && app.isPackaged && app.getPath) {
    LOG_DIR = path.dirname(app.getPath('exe'));
  }
} catch (e) { /* 非 Electron 主进程环境则沿用 cwd */ }
const LOG_FILE = path.join(LOG_DIR, 'app.log');

// 确保日志目录存在
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
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
  // 文件写入
  try {
    fs.appendFileSync(LOG_FILE, line, 'utf-8');
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
  cleanupOldLogs,
  initExceptionLogger,
  writeExceptionLog,
  LOG_DIR,
  LOG_FILE
};
