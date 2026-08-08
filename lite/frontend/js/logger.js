/**
 * 前端日志工具
 * 同时输出到浏览器控制台和 Electron 主进程日志文件（通过 IPC）
 * 在非 Electron 环境下（普通浏览器）仅输出到控制台。
 * error 级别还会通过 HTTP 上报到后端异常日志系统。
 */
const FrontendLogger = {
  _log(level, ...args) {
    const message = args.map(a => {
      if (a instanceof Error) return a.stack || a.message;
      if (typeof a === 'object') {
        try { return JSON.stringify(a); } catch (e) { return String(a); }
      }
      return String(a);
    }).join(' ');

    // 控制台输出
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    fn(...args);

    // 通过 IPC 写入文件（仅 Electron 环境）
    if (window.electronAPI && typeof window.electronAPI.logToFile === 'function') {
      window.electronAPI.logToFile(level, message).catch(() => {});
    }

    // error 级别通过 HTTP 上报到后端异常日志系统
    if (level === 'error') {
      this._reportException(message, args);
    }
  },

  /**
   * 将异常上报到后端异常日志系统
   */
  _reportException(message, originalArgs) {
    try {
      const errorObj = originalArgs.find(a => a instanceof Error);
      const stackTrace = errorObj ? errorObj.stack : '';
      const sourceDetail = errorObj && errorObj.stack ? errorObj.stack.split('\n')[1]?.trim() || '' : '';

      fetch('/api/data/exception-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'frontend',
          sourceDetail: sourceDetail,
          message: message,
          stackTrace: stackTrace,
          level: 'ERROR',
          thread: 'renderer',
          requestUri: window.location.href
        })
      }).catch(() => {});
    } catch (e) {
      // 静默处理
    }
  },

  info(...args) { this._log('info', ...args); },
  warn(...args) { this._log('warn', ...args); },
  error(...args) { this._log('error', ...args); }
};

// 全局未捕获异常捕获
window.addEventListener('error', (event) => {
  FrontendLogger.error('Uncaught error:', event.error || event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  FrontendLogger.error('Unhandled rejection:', event.reason);
});