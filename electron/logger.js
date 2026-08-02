/**
 * Electron 主进程日志模块
 *
 * 同时输出到控制台和文件，日志文件写入当前项目/应用工作目录下的 app.log。
 */
const fs = require('fs');
const path = require('path');
const LOG_DIR = process.cwd();
const LOG_FILE = path.join(LOG_DIR, 'app.log');

// 确保日志目录存在
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

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
}

function cleanupOldLogs() {
  // app.log 持续保留，不做自动清理。
}

module.exports = {
  info: (...args) => writeLog('INFO', ...args),
  warn: (...args) => writeLog('WARN', ...args),
  error: (...args) => writeLog('ERROR', ...args),
  cleanupOldLogs,
  LOG_DIR,
  LOG_FILE
};
