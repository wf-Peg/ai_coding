/**
 * smoke-graph-render.js - 知识图谱页完整渲染验证(真实 App 加载真实 HTML)
 *
 * 用真实 Electron 窗口 loadFile 加载 frontend/knowledge-graph.html，
 * 真实 preload 暴露 localIndex，页面 fetchData('all') 经本地 IPC 取数，
 * D3 完成布局渲染后统计 SVG 节点/边数量，并采集渲染期控制台错误。
 *
 * 运行：SMOKE_STORAGE=<storagePath> npx electron electron/smoke-graph-render.js
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const localGraph = require('./sqlite/graph');
const localDb = require('./sqlite/db');
const localIndexService = require('./sqlite/index-service');
const localSearch = require('./sqlite/search');

const PRELOAD = path.join(__dirname, 'preload.js');
const GRAPH_HTML = path.join(__dirname, '..', 'frontend', 'knowledge-graph.html');

const guardDelegating = (fn) => async (_ev, args) => {
  try { return await fn(_ev, args); } catch (e) { return { success: false, message: e.message }; }
};

function realStoragePath() {
  const cfg = path.join(app.getPath('userData'), 'config', 'config.json');
  try { if (fs.existsSync(cfg)) { const c = JSON.parse(fs.readFileSync(cfg, 'utf-8')); return c.storagePath || null; } } catch (e) {}
  return process.env.SMOKE_STORAGE || null;
}

app.whenReady().then(() => {
  const storagePath = realStoragePath();
  if (!storagePath) { console.log('SMOKE_FAIL no storagePath'); app.exit(1); return; }

  // 注册图谱页所需 IPC（与 main.js graph.js 一致）
  ipcMain.handle('local-index:graph', guardDelegating(async (_ev, args) => {
    const includeTypes = (args && args.includeTypes)
      ? new Set(String(args.includeTypes).split(',').map((s) => s.trim()).filter(Boolean))
      : null;
    const frontendGraph = localGraph.getGraph(localDb.getDatabase(), includeTypes);
    return { success: true, nodes: frontendGraph.nodes, links: frontendGraph.links };
  }));
  ipcMain.handle('local-index:relations', guardDelegating(async (_ev, args) => {
    const { id } = args || {};
    if (!id) return { success: false, message: 'id required' };
    return { success: true, relations: localGraph.relationsFor(localDb.getDatabase(), id) };
  }));
  ipcMain.handle('local-index:status', guardDelegating(async () => ({ ...localIndexService.status(), success: true })));
  ipcMain.handle('local-index:search', guardDelegating(async (_ev, args) => {
    return localSearch.search((args && args.query) || '', (args && args.limit) || 20);
  }));

  try { localIndexService.initLocalIndex(storagePath); } catch (e) { console.log('SMOKE_FAIL init', e.message); app.exit(1); return; }

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: PRELOAD }
  });

  const consoleErrors = [];
  win.webContents.on('console-message', (e, level, message) => {
    if (level >= 2) consoleErrors.push(message);
  });

  win.loadFile(GRAPH_HTML).then(() => {
    // 轮询等待 D3 渲染完成（page 内 buildGraph 异步 + D3 force 布局）
    const deadline = Date.now() + 12000;
    (function poll() {
      win.webContents.executeJavaScript(`new Promise(r=>{
        const t0=Date.now();
        (function wait(){
          try{
            const svg=document.querySelector('#graphContainer svg');
            const nodes=document.querySelectorAll('#graphContainer svg .node');
            const links=document.querySelectorAll('#graphContainer svg .link');
            const empty=document.getElementById('emptyEl');
            const emptyVisible=empty ? getComputedStyle(empty).display!=='none' : false;
            if((nodes.length>0 && links.length>0)|| emptyVisible || Date.now()-t0>11000){
              r({
                ready:true,
                hasSvg:!!svg,
                nodeCount:nodes.length,
                linkCount:links.length,
                emptyVisible:emptyVisible,
                emptyTitle:empty ? (empty.querySelector('#emptyTitle')||{}).textContent : null,
                bodyText:(document.body.innerText||'').slice(0,60)
              });
            } else { setTimeout(wait,150); }
          }catch(e2){ r({ready:false,error:String(e2)}); }
        })();
      })`, true).then((res) => {
        res.consoleErrors = consoleErrors.slice(0, 8);
        console.log('SMOKE_RENDER ' + JSON.stringify(res));
        try { localDb.closeDatabase(); } catch (e) {}
        app.exit(0);
      }).catch((e) => { console.log('SMOKE_FAIL ev ' + e.message); app.exit(1); });
    })();
  });
});