/**
 * smoke-graph-gui.js - M3.4 图谱 IPC 真实 GUI 冒烟
 *
 * 在真实 Electron 渲染进程里，经真实 preload（window.electronAPI.localIndex）发起
 * local-index:graph / local-index:relations 调用，走完整 ipcRenderer→ipcMain 往返，
 * 数据处理由主进程真实模块（localGraph/localDb/localIndexService）承担并聚焦真实数据目录。
 *
 * 运行：npx electron electron/smoke-graph-gui.js
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const localGraph = require('./sqlite/graph');
const localDb = require('./sqlite/db');
const localIndexService = require('./sqlite/index-service');

const PRELOAD = path.join(__dirname, 'preload.js');

// 读取真实配置确定数据目录（与 main.js loadConfig 同路径）
function realStoragePath() {
  const cfgPath = path.join(app.getPath('userData'), 'config', 'config.json');
  try {
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      return cfg.storagePath || null;
    }
  } catch (e) {}
  return process.env.SMOKE_STORAGE || null;
}

app.whenReady().then(() => {
  const storagePath = realStoragePath();
  if (!storagePath) {
    console.log('SMOKE_FAIL no storagePath');
    app.exit(1);
    return;
  }

  // === 与 main.js 完全一致的关系处理：本地图谱 + 反链 ===
  const guard = (fn) => async (_ev, args) => {
    try { return await fn(_ev, args); } catch (e) { return { success: false, message: e.message }; }
  };
  ipcMain.handle('local-index:graph', guard(async (_ev, args) => {
    const includeTypes = (args && args.includeTypes)
      ? new Set(String(args.includeTypes).split(',').map((s) => s.trim()).filter(Boolean))
      : null;
    const frontendGraph = localGraph.getGraph(localDb.getDatabase(), includeTypes);
    return { success: true, nodes: frontendGraph.nodes, links: frontendGraph.links };
  }));
  ipcMain.handle('local-index:relations', guard(async (_ev, args) => {
    const { id } = args || {};
    if (!id) return { success: false, message: 'id is required' };
    return { success: true, relations: localGraph.relationsFor(localDb.getDatabase(), id) };
  }));
  ipcMain.handle('local-index:status', guard(async () => ({ ...localIndexService.status(), success: true })));

  // 初始化索引（真实数据）
  try { localIndexService.initLocalIndex(storagePath); } catch (e) { console.log('SMOKE_FAIL init', e.message); app.exit(1); return; }

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: PRELOAD
    }
  });

  win.loadURL('about:blank').then(async () => {
    // 真实渲染进程经 preload 桥发起 IPC
    let out = {};
    try {
      const graph = await win.webContents.executeJavaScript(
        'window.electronAPI.localIndex.graph({})', true
      );
      out.nodes = graph.nodes.length;
      out.byType = graph.nodes.reduce((a, n) => (a[n.type] = (a[n.type] || 0) + 1, a), {});
      out.links = graph.links.length;
      out.linkByType = graph.links.reduce((a, l) => (a[l.type] = (a[l.type] || 0) + 1, a), {});
      out.sampleLinks = graph.links.slice(0, 6).map((l) => l.source + '->' + l.target);

      // 反链：取任一节点做 relations
      if (graph.nodes.length) {
        const id = graph.nodes[0].id;
        const rel = await win.webContents.executeJavaScript(
          `window.electronAPI.localIndex.relations(${JSON.stringify({ id })})`, true);
        out.relationsFor = `${id}: ${rel.relations ? rel.relations.length : 0}`;
      }
    } catch (e) {
      out.error = e && e.message;
    }
    console.log('SMOKE_RESULT ' + JSON.stringify(out));
    try { localDb.closeDatabase(); } catch (e) {}
    app.exit(0);
  });
});