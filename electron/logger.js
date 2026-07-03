/**
 * Electron 主进程日志模块
 *
 * 同时输出到控制台和文件，日志文件写入 C:\Users\{用户名}\AppData\Local\CutShelter\logs\
 * 按天滚动，保留 30 天。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const LOG_DIR = path.join(os.homedir(), 'AppData', 'Local', 'CutShelter', 'logs');
const MAX_DAYS = 30;

// 确保日志目录存在
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function getLogFileName() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `electron.${y}-${m}-${d}.log`;
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
    fs.appendFileSync(path.join(LOG_DIR, getLogFileName()), line, 'utf-8');
  } catch (e) {
    console.error('Failed to write log file:', e.message);
  }
}

function cleanupOldLogs() {
  try {
    const files = fs.readdirSync(LOG_DIR);
    const cutoff = Date.now() - MAX_DAYS * 24 * 60 * 60 * 1000;
    for (const f of files) {
      if (f.startsWith('electron.') && f.endsWith('.log')) {
        const filePath = path.join(LOG_DIR, f);
        try {
          const stat = fs.statSync(filePath);
          if (stat.mtimeMs < cutoff) {
            fs.unlinkSync(filePath);
          }
        } catch (e) { /* 文件可能已被删除 */ }
      }
    }
  } catch (e) { /* 目录可能不存在 */ }
}

module.exports = {
  info: (...args) => writeLog('INFO', ...args),
  warn: (...args) => writeLog('WARN', ...args),
  error: (...args) => writeLog('ERROR', ...args),
  cleanupOldLogs,
  LOG_DIR
};