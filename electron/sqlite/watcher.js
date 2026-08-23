/**
 * watcher.js - clip-storage 实时监听（FSEvents / fs.watch 递归）
 *
 * 新增/修改/删除 JSON 文件时，防抖后触发 handler 做一次「重扫增量」（rescan）。
 * 不解析具体事件类型：文件为真、库为缓存，重扫按 file_path + mtime 幂等增删，
 * 因此事件合并/顺序无关紧要，天然可靠。
 */

const fs = require('fs');
const scanner = require('./scanner');

const DEBOUNCE_MS = 800; // 编辑器连续保存会高频触发事件，合并为一次重扫

/**
 * 启动对 clip-storage 的递归监听。
 * @param {string} storagePath config.storagePath（Clip_Bed 父目录）
 * @param {(event:string, filename:string|null)=>void} onChange 防抖后的回调
 * @returns {{started:boolean, stop?:Function, reason?:string}}
 */
function startWatching(storagePath, onChange) {
  const clipRoot = scanner.resolveClipStoragePath(storagePath);
  if (!fs.existsSync(clipRoot)) {
    return { started: false, reason: 'clip-storage 目录不存在: ' + clipRoot };
  }

  let watcher;
  try {
    // macOS 下 recursive 由 FSEvents 提供；少数平台/目录不支持时抛错，走降级
    watcher = fs.watch(clipRoot, { recursive: true }, onEvent);
  } catch (e) {
    try {
      watcher = fs.watch(clipRoot, onEvent);
    } catch (e2) {
      return { started: false, reason: e2.message };
    }
  }

  let timer = null;
  function onEvent(evt, filename) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      try {
        onChange(evt, filename);
      } catch (e) {
        // 回调异常不应中断监听
        console.error('[local-index watcher] onChange error:', e && e.message);
      }
    }, DEBOUNCE_MS);
  }

  return {
    started: true,
    stop() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (watcher) { try { watcher.close(); } catch (e) {} }
    }
  };
}

module.exports = { startWatching, DEBOUNCE_MS };