# 无限画布 canvas_* 层：后端持久化 + 双向自动同步

## 一、Context（为什么做）

「知识图谱/无限画布」当前只把用户手动画布数据（`canvas_node` / `canvas_edge` / `canvas_layout` / `canvas_group` / `canvas_group_member`）写在本机 Electron 的 SQLite 里，由 `local-index:*` IPC 读写；后端 `/api/graph` 完全不碰这几张表。结果是：换机器、重装、或索引库被清后，用户手工搭建的节点/连线/坐标/分组全部丢失。

本次任务：**把这五张「手动画布层」表同步到后端做持久化，并在本地与后端之间做双向自动同步**（本地变更 → 推送后端；启动/进图谱 → 拉取恢复）。语义 `relation` 关系表不同步（由文件扫描+relation-builder 本地重建，避免与本地重建冲突）。

决策（已确认）：
- 范围：**仅手动画布层**（不含 relation）。
- 后端存储形态：**JSON 文件快照**（符合项目「文件为真、库为缓存」风格）。
- 同步方向/时机：**双向自动同步**（变更 debounced 推送 + 启动/进图拉取，last-write-wins）。

## 二、现状分析（已核实）

- **本地 schema**（`electron/sqlite/init.js`，v4/v5）：
  - `canvas_node(id, kind, text, title, created_at, updated_at)`，kind ∈ note/link/image/ref
  - `canvas_edge(id, from_id, to_id, created_at, UNIQUE(from_id,to_id))`
  - `canvas_layout(node_id PK, x, y, updated_at)`
  - `canvas_group(id, name, created_at, updated_at)` + `canvas_group_member(group_id, node_id)`
- **本地读写封装**：
  - `electron/sqlite/canvas-node.js`：`listNodes()`、`listEdges()`、`createNode`、`updateNode`、`deleteNode`、`createEdge`、`deleteEdge`、`clearAll`
  - `electron/sqlite/canvas-layout.js`：`positions()`、`savePositions()`
  - `electron/sqlite/canvas-group.js`：`listGroups()`（已存在）
- **IPC 暴露**：`electron/main.js` L2946-3026 附近，`local-index:graph`、`local-index:layout:save`、`local-index:canvas:create-node/update-node/delete-node/create-edge/delete-edge`、`local-index:canvas:list-groups` 等。
- **前端触点**：`frontend/knowledge-graph.js` `persistPositionsDebounced()`、`completeLink()` 等在拖拽结束/连线时触发 `local-index:layout:save` / `local-index:canvas:create-edge`。
- **后端范式**：`backend/.../GraphController` 提供 `/api/graph`、`/api/relations/sync`；剪藏内容走 `FileStorageService`（根路径 `clip.storage.path`）【实现时复用其路径解析/原子写（tmp+rename）约定】。

## 三、目标

1. 手动画布层五表以**全量快照 JSON** 存到后端 `clip.storage.path/graph/canvas-state.json`。
2. 提供后端读写接口：`GET /api/canvas`、`POST /api/canvas`。
3. 本地每次手动画布变更后 **debounced 推送**全量快照到后端。
4. 应用启动（索引就绪后）与进入知识图谱模块时**拉取**后端快照并按 `updatedAt` last-write-wins 恢复。
5. 快照带 `version` 字段，兼容后续结构演进。

## 四、具体改动

### 4.1 后端

#### 4.1.1 新增 `GraphService`-旁路服务或独立 `CanvasStateService`（`backend/.../service/CanvasStateService.java`）
- 复用 `FileStorageService` 的根目录解析，指向 `{clip.storage.path}/graph/`。
- `Path getPath()` → `<root>/graph/canvas-state.json`。
- `Map<String,Object> readState()`：文件不存在返回 `{nodes:[], edges:[], layout:{}, groups:[], updatedAt:null, version:1}`。
- `void writeState(Map<String,Object> snapshot)`：原子写（写入 `.tmp` 后 `Files.move(ATOMIC_MOVE/REPLACE_EXISTING)`），与 `FileStorageService` 写文件风格一致。
- 依赖注入 `FileStorageService`（或直接读其暴露的根路径方法）。

#### 4.1.2 新增 `CanvasController`（`backend/.../controller/CanvasController.java`）
```
GET  /api/canvas        → CanvasStateService.readState()
POST /api/canvas        → body 为快照 {nodes,edges,layout,groups,updatedAt,version}，writeState 后返回 ok
```
- 复用项目 `@CrossOrigin(origins="*")`、统一错误返回（参照 `GraphController`）。
- 不做字段级校验（快照由 Electron 侧组装），仅 `updatedAt` 为空时拒绝写入（服务端也不做合并，合并归 Electron 端）。

### 4.2 Electron 本地 → 后端同步

#### 4.2.1 新增 `electron/canvas-sync.js`
- `buildSnapshot(dbConn)`：调用现有 `canvas-node.listNodes/listEdges`、`canvas-layout.positions`、`canvas-group.listGroups`，组装并扁平化 layout 为 `{id,x,y}` 对象，附 `updatedAt`（取本表最大 updated_at / 当前时间）与 `version:1`。
- `pushSnapshot(dbConn)`：`buildSnapshot` → `POST {API_BASE}/api/canvas`；失败静默记录（不阻塞本地）。
- `pullSnapshot(dbConn)`：`GET {API_BASE}/api/canvas` → 与本地当前快照比较 `updatedAt`：后端更新则整库替换恢复；本地更新则反向 `pushSnapshot`（last-write-wins 由时间戳决定）。
- 后端基地址从现有 Electron 配置里的 `API_BASE_URL`/后端端口取【实现时与主进程现有 api 配置共用同一来源】。
- 提供 `schedulePush()`：300-500ms debounce，合并多次变更为一次 push。

#### 4.2.2 `electron/main.js` 接线
- **推送钩子**：在 `local-index:layout:save`、`local-index:canvas:create-node/update-node/delete-node/create-edge/delete-edge`、以及分组创建/改名/删除等写操作成功后，调用 `canvasSync.schedulePush(dbConn)`。
- **拉取钩子**：
  - 应用启动、本地索引就绪后，异步 `pullSnapshot` 一次；
  - 新增 IPC `local-index:canvas:sync` → 前端在知识图谱模块初始化（`knowledge-graph.js` 首次 `initGraph/fetchData`）时调用，触发一次 `pullSnapshot`（”进图即拉最新”）。

#### 4.2.3 `electron/preload.js`（如前端需要手动同步）
- 暴露 `window.electronAPI.canvasSync()` 转发到 `local-index:canvas:sync` IPC【仅当需要前端手动触发时；若纯自动可省略】。

### 4.3 前端（最小改动，仅触发拉取）
- `frontend/knowledge-graph.js`：在初始化链路上调用 `window.electronAPI.canvasSync && window.electronAPI.canvasSync()`，使进入知识模块时拉取最新快照。本地已有 `local-index:graph` 返回即会带上恢复后的坐标，前端无需理解同步逻辑。

## 五、假设与决策

1. **合并策略 = last-write-wins（整库覆盖）**，以 `updatedAt` 时间戳为基准；不做逐字段 diff merge。单设备本地优先，跨设备以最近写入者为准，符合“快照”定位。
2. **全量快照**而非增量；手动画布数据量小（用户手建，非文件扫描），全量 push 成本可接受且最不易出错。
3. **同步失败不阻塞本地**：push 失败仅记日志、本地照常；下次变更/进图再补。
4. **relation 不同步**：本次不下传 /api/graph 的 relation；语义关系依旧本地重建，避免与后端脏数据冲突。
5. **数据安全**：后端文件不可达（未配置/后端未起）时，canvas 仍完整保留在本地 SQLite，功能不受影响。

## 六、验证步骤

1. **语法/构建**
   - `node --check electron/canvas-sync.js electron/main.js frontend/knowledge-graph.js`
   - 后端 `cd backend && mvn -q -o compile`，EXIT=0。
2. **单元测试（本地快照）**
   - 在 `electron/sqlite` 下加一测试：建节点/连线/坐标 → `buildSnapshot` → `restore` 到全新空库 → 数据一致。
3. **端到端（运行应用）**
   - 知识图谱手动画布：新建便签节点 A、节点 B、连一条边、拖动到某坐标、新建分组并加入成员。
   - 等 debounce 后检查 `{clip.storage.path}/graph/canvas-state.json` 存在且包含 nodes/edges/layout/groups。
   - 调用 `curl http://127.0.0.1:8081/api/canvas` 确认返回快照。
   - 清空本机 SQLite（模拟换机），重启应用/重进图谱 → 后端快照被拉回，节点/连线/坐标/分组恢复。
   - **反向**：手动把本地快照的 `updatedAt` 改成更大，进图后应 push 覆盖后端。
4. **回归**
   - 现有 `node --test electron/sqlite/*.test.js`（graph/canvas-node）不回归。
   - `/api/graph` 不受影响（canvas 快照不写入 relation）。