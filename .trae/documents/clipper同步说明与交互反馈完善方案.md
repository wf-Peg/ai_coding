# 收件箱剪藏区 Clipper 同步：功能介绍 + 交互反馈 + 自动同步完善方案

## Summary

收件箱(clip)页面的 **Web Clipper 同步**（`SourceSyncService`，前端为 `web-clipper-sync-status` pill）目前存在三类问题：

1. **未同步**：pill 只在页面加载和手动点击时各拉取/触发一次，无轮询、无自动同步。Obsidian Web Clipper 写入 `sources/` 的新文件不会自动出现，用户需手动点 pill。
2. **无功能介绍**：没有任何地方说明「clipper 同步」是什么、Watch 哪个目录、Vault 路径、如何接入 Obsidian Web Clipper，用户不知道这个功能在干嘛。
3. **无失败原因**：失败时 pill 只显示一个「失败」小字 + 一次性 toast，不展示真实原因（如 `wiki.sync-enabled=false`、`sources/` 目录不存在、某文件解析失败），且不再反复出现。

按用户确认的三项决策落地：
- **交互形态**＝点击 `clipper同步` pill 打开一个**专属说明面板**（仿照已有 Git「同步状态」面板），内含功能介绍 + 当前状态 + 失败原因 + 手动「立即同步」。
- **自动同步**＝前端开启**状态轮询 + 自动同步**（到点自动 trigger），新文件自动入库并刷新列表。
- **后端诊断**＝扩展 `GET /api/sync/status` 与 `/api/sync/trigger`，返回结构化诊断（`enabled`/`intervalSeconds`/`lastSyncTime`/`lastError`/`failedFiles` 等），前端才能如实展示「为什么没同步/失败」。

> 本方案**只改 Web Clipper(clipper) 同步链路**，不动已有 Git 同步面板（`sync-status-panel` / `SYNC_PROVIDER_API_BASE_URL`）与其它模块，避免回归。

## Current State Analysis

- 前端 pill 结构：[clip.html](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/clip.html#L283-L287) — `.wc-pill#web-clipper-sync-status`（点状 `.sync-dot` + `.wc-pill-text`“clipper同步” + `.wc-pill-meta`）。`onclick="triggerWebClipperSync()"` 单击即触发同步。
- pill 样式：[clip.css](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/styles/clip.css#L323-L380) — 消费 `--app-*` 令牌（surface/border/success/warning/primary），主题主蓝族。
- 前端逻辑：[clip-sync.js](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/clip-sync.js)：
  - [loadSyncStatus()](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/clip-sync.js#L188-L216)：仅 DOMContentLoaded 与手动 trigger 后调用，无定时轮询。
  - [triggerWebClipperSync()](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/clip-sync.js#L155-L185)：`POST /api/sync/trigger`；失败仅一次性 toast + pill“失败”，无持久原因。
  - 已有 Git 面板函数（`toggleSyncPanel`/`loadSyncStatusPanel`/`renderSyncPanel`/`fieldRow`/`emptyRow`）可作为 clipper 面板的样式与复用参考。
- 后端逻辑：
  - [SourceSyncService.syncSources()](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/service/sync/SourceSyncService.java#L168-L237)：扫描 `sources/`，`isSyncEnabled` 决定是否启动调度器；`sources/` 不存在时返回 message 但**丢失错误原因**；单文件异常只记 `log.error`，**不记录失败文件**。
  - [SourceSyncService.getStatus()](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/service/sync/SourceSyncService.java#L335-L349)：仅返回 `syncedCount/pendingCount/lastSyncTime/sourcesDir`，**无 enabled/interval/错误**。
  - [SourceSyncController](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/controller/SourceSyncController.java)：`POST /trigger`→`syncSources()`，`GET /status`→`getStatus()`。
  - [WikiConfig](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/config/WikiConfig.java#L88-L91)：`syncEnabled=true`、`syncIntervalSeconds=60` 已存在；`getSourcesDirName()`/`getWikiDirName()`/`getVaultPath()` 可复用。

## Proposed Changes

### A. 后端：`SourceSyncService` 记录并暴露结构化诊断

**文件 A1：`service/sync/SourceSyncService.java`（修改）**

1. 新增字段（线程可见）：
   ```java
   private volatile String lastError = null;          // 最近一次整体同步错误（如 "sources directory not found"）
   private final java.util.Queue<String> failedFiles =  // 最近失败文件清单（文件名:原因），上限 20
       new java.util.LinkedList<>();                    // 用 synchronized 包裹
   ```
2. `syncSources()` 内：
   - `getSourcesDir()` 不存在分支：`lastError = "sources directory not found: " + sourcesDir;`（并 `result.put("lastError", lastError)`、`result.put("failedFiles", List.of())`）
   - 单文件 catch 分支：把 `fileName + ": " + e.getMessage()` 加入 `failedFiles`（上限 20，超出移除最旧），并 `result.put("lastError", null)`（本次有单文件失败）。
   - 正常完成：`failCount` 统计，`lastError` 保持（不清除非再次失败）。
   - 整体 catch 分支：`lastError = e.getMessage()`。
3. `getStatus()` 追加字段：
   ```java
   status.put("enabled", wikiConfig.isSyncEnabled());
   status.put("intervalSeconds", wikiConfig.getSyncIntervalSeconds());
   status.put("vaultPath", wikiConfig.getVaultPath());
   status.put("wikiDirName", wikiConfig.getWikiDirName());
   status.put("lastError", lastError);
   status.put("failedFiles", new ArrayList<>(failedFiles));
   ```
   （`syncedCount/pendingCount/lastSyncTime/sourcesDir` 保留不变）

> 向后兼容：`getStatus()` 只增不改字段名，旧前端忽略新字段即可正常。

**文件 A2：`controller/SourceSyncController.java`（几乎不改）**
- `GET /status` 已直接返回 `getStatus()` 的 Map，自动带上新字段。
- `POST /trigger` 返回 `syncSources()` 的 Map，已含 `lastError`/`failedFiles`（syncSources 内补充写入）。

### B. 前端：Clupper 专属说明面板 + 轮询 + 自动同步

**文件 B1：`frontend/clip.html`（修改）**
- 把 pill 点击行为从「直接同步」改为「打开说明面板」：
  ```html
  <span class="wc-pill" id="web-clipper-sync-status" title="Clipper 同步：加载中..." role="button" tabindex="0" onclick="toggleClipperSyncPanel()">
  ```
- 在 `git-sync-result`/`sync-status-panel` 附近新增独立面板（默认 `hidden`）：
  ```html
  <div id="clipper-sync-panel" class="sync-status-panel clipper-sync-panel" hidden>
      <div class="sync-panel-head">
          <strong class="sync-panel-title">Clipper 同步</strong>
          <button class="sync-panel-close" type="button" title="关闭" onclick="toggleClipperSyncPanel()">&times;</button>
      </div>
      <div id="clipper-panel-body"></div>
  </div>
  ```

**文件 B2：`frontend/js/clip-sync.js`（修改）**
1. 新增 `toggleClipperSyncPanel()`：切换 `#clipper-sync-panel` 显隐；展开时调用 `loadClipperSync()`,`渲染 body`。
2. 新增 `loadClipperSync()`：`GET /api/sync/status` → `renderClipperPanel(data)`；失败时面板内显示降级文案（不抛全局错误）。
3. 新增 `renderClipperPanel(status)`：用 DOM API / `escapeHtml` 逐块渲染（仿 `renderSyncPanel`）：
   - **功能介绍**：卡片说明“Clipper 同步会把 Obsidian Web Clipper 存入「原样保存目录」的新 .md 文件自动同步为收件箱剪藏，原文保留在 Vault，剪藏以 wiki-link 引用。”并列出：Vault 路径、`sources/` 目录、wiki 目录名、建议接入方式（在 Obsidian Web Clipper 模板的保存目录设置到该 `sources/`）。
   - **当前状态**：badge（`enabled ? '自动同步已开启（每 N 秒）' : '自动同步已关闭（需手动同步）'`，未启用用 warn 色）+ 已同步 N 条 / 待同步 N 条 + 最近同步时间（`lastSyncTime`，0/缺省显示“暂无同步记录”）。
   - **失败/待同步诊断**：`lastError` 非空 → 红色行“上次失败原因：…”；`failedFiles` 非空 → 逐行“文件名：原因”；`pending>0` → “待同步 N 条，点击下方按钮立即同步”。
   - **手动操作**：`立即同步` 按钮 → `triggerWebClipperSync()`；成功后 `loadClipperSync()` + `fetchClips()` 刷新。
4. 改写 [triggerWebClipperSync()](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/clip-sync.js#L155-L185)：成功/失败后均调用 `loadClipperSync()`（刷新面板与 pill）；失败 toast 保留，但 pill 与面板展示 `data.lastError`/`message`。
5. **轮询**：新增定时器（如 30s）调用 `loadClipperSync()`，并在页面可见时驱动；同时若 `status.enabled && pending>0` 且自动同步开关开启，则自动 `triggerWebClipperSync()`（节流：距上次 trigger≥interval 才触发），解决“未同步”。自动同步开关状态存 `localStorage('clipper_auto_sync')`，面板内 `checkbox` 控制。
6. **抽公共**：载入时同时初始化轮询定时器；`DOMContentLoaded` 里已有 `loadSyncStatus()` 保留为 pill 初次渲染，可复用 `loadClipperSync()` 的轻量版刷新 pill。

> 复用现有 `fieldRow`/`emptyRow`（[clip-sync.js](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/clip-sync.js#L376-L396)）与 `escapeHtml`。

**文件 B3：`frontend/styles/clip.css`（修改）**
- 新增 `.clipper-sync-panel` 复用 `.sync-status-panel` 系列（已消费 `--app-*` 令牌），仅补充：`.clipper-intro`（功能说明段落样式）、`.clipper-err`（失败原因红/警告色）、`.clipper-actions`（手动按钮行）、轮询“同步中”动画复用现有 `wcSyncPulse`。

## Assumptions & Decisions

- **只改 Clipper 链路**：不动 Git 同步面板与 `/api/git/*`、`/api/sync-provider/*`，无回归。
- **后端只增字段不改语义**：`getStatus()`/`syncSources()` 返回体新增 `enabled/intervalSeconds/vaultPath/wikiDirName/lastError/failedFiles`，保留原字段名，兼容旧前端。
- **失败原因来源**：`lastError`＝整批错误（目录缺失、异常），`failedFiles`＝单文件失败清单（上限 20）。未发生错误时为空。
- **自动同步默认开启**：`localStorage('clipper_auto_sync')` 默认 true；仅当后端 `enabled=true` 且 `pending>0` 时自动 trigger，避免空跑。轮询间隔 30s。
- **涉及安全**：所有动态内容用 `escapeHtml`/DOM API，禁止字符串拼 HTML 注入。
- **遵循项目规范**：消费 `--app-*`/`--primary/--surface/--border/--radius` 令牌（主蓝族），禁止引入新色相；补日志与中文注释。

## Verification

1. 后端编译：`cd backend && mvn -q -o compile`，exit 0。
2. 手动启动后端：
   - `GET http://127.0.0.1:8081/api/sync/status` 返回新增 `enabled/intervalSeconds/vaultPath/wikiDirName/lastError/failedFiles`（旧字段仍在）。
   - 把 `sources/` 指向不存在目录（或临时改名）后 `GET /status`，`lastError` 应为 `sources directory not found...`。
   - 放入一个损坏 .md 到 `sources/` 后 `POST /api/sync/trigger`，返回体 `failedFiles` 含该文件名与原因。
3. 前端语法：`node --check frontend/js/clip-sync.js` 通过。
4. 前端手测（重载 clip 页）：
   - 点击 `clipper同步` pill → 打开说明面板：功能介绍、Vault/`sources/` 路径、当前状态 badge（自动同步开关状态 + 间隔）、已同步/待同步、失败原因/失败文件、手动「立即同步」按钮均正确显示；路径可复制。
   - 未启用（`wiki.sync-enabled=false`）→ badge「自动同步已关闭（需手动同步）」。
   - `sources/` 缺失 → 红色「上次失败原因」。
   - 放一个新 .md 到 `sources/` → 30s 内自动同步为收件箱剪藏并刷新列表，pill 待同步数归零。
   - 成功/失败后 pill 与面板状态同步更新；主题切换（普通/Notion）下样式正常、色相主蓝族。
5. 回归：Git「同步仓库」面板与 `/api/git/sync` 行为不变。