# 修复收件箱图片剪藏与 OCR 流程

## Summary（结论先行）

图片剪藏的「存储路径 / 后端 `/api/media/*` / 列表渲染 / OCR 服务」在代码层面**基本都已实现**，并非"整块没做"。真正的断点在**前端交互链路**上，我定位到一处确定的功能性 bug 和两处真实的生命周期缺口：

1. **（确定 bug）`quickRecord('ocr')` 传入了不存在的类型值 `'ocr'`** → 表单类型被置空、图片上传区被隐藏 → 缩略图不显示、OCR 按钮不可达、保存时类型为空导致"存不上"。
2. **（缺口）OCR 只对"当前会话内、已上传完成、且带 `dataUrl`"的第一张图可用**（`clip-form.js runImageOcr` 的 `status==='done'` 强守卫 + 依赖内存 `dataUrl`）；已保存的图片剪藏**没有任何重新 OCR 入口**，OCR 结果也没有专门落库。
3. **（缺陷）列表缩略图只认 `clip.imagePaths[0]`**，对 `imagePaths` 缺失（旧索引/部分剪藏）的记录不显示任何图片，也没有从 content 兜底提取。

本方案修复以上三处，并给出验证清单确认"存不上"是否还残留后端问题。

---

## Current State Analysis（现状）

### 已实现的链路（无需重构）
- **后端存储**：`backend/.../controller/MediaController.java` 提供 `POST /api/media/upload`、`GET /api/media/{yyMM}/{fileName}?thumb=1`、`cleanup-orphans`；媒体根目录 = `{clip.storage.path}/media`（`MediaStorageProperties + ImageUtils`），与剪藏本体同根，路径一致。
- **配置→存储路径**：`electron/main.js` `generateApplicationYml()` 将 `config.storagePath` 写入后端 `clip.storage.path`。
- **列表数据结构**：列表首选本地索引 `apiClient.listClips → listByType('clip')`，`content_ref` 存完整 `ClipContent` JSON（`index-service.js L329-332`），`imagePaths` 会透传；缩略图渲染在 `frontend/js/clip-list.js L604`：`mediaUrl(clip.imagePaths[0]) + '?thumb=1'`。
- **上传/OCR 前端**：`clip.html` 已加载 `media-render.js / media-uploader.js`；表单区 `#image-ocr-btn`（`clip.html L341`）→ `clip-form.js runImageOcr()`；IPC `ocr:recognize / ocr:status`（`electron/main.js L4581-4605`，preload `L85/88`）正常，底层 `ocr-service.js`（PP-OCRv4 onnx）模型已打包（`ocr-models/` 含 det/rec/dict，cls 可选）。

### 断点/缺口明细
- **`quickRecord('ocr')` 类型错误（根因）**
  - `clip.html L287-290` OCR 按钮 `quickRecord('ocr')`。
  - `clip-form.js L94` `expandForm(mode)`：`expandForm('ocr')` 内 `typeSel.value = 'ocr'`。
  - `clip.html L363-369` 的 `<select id="type">` **只有** `store-only / ai-text / link-ai / doc-ai / image`，**没有 `ocr`** → `typeSel.value` 被置空 `''`。
  - 结果：`handleTypeChange('')` → `updateImageAreaVisibility('')` 隐藏图片区（`clip-shared.js L306-315` 仅 ai-text/store-only/image 可见）→ 上传无预览缩略图；提交时 `type=''` 导致后端无法按图片剪藏入库 → 表现为"图片根本没存上 + OCR 没结果"。
- **OCR 生命周期缺口**
  - `clip-form.js L110-134 runImageOcr()`：只取 `uploadedImages` 中 `status==='done' && dataUrl` 的第一张；保存后的剪藏无 OCR 入口；OCR 文本仅临时填入 `#content`，未持久化为独立字段。
- **缩略图兜底缺失**
  - `clip-list.js L604` 仅 `imagePaths` 首项，无 content 兜底。

---

## Proposed Changes（改动方案）

### 1) 修复 OCR 快速记录类型 —— `frontend/js/clip-form.js`
- **做什么**：让 `quickRecord('ocr')` 落实到合法的 `image` 类型，并保证图片上传区可见。
- **怎么改**：在 `quickRecord()` 中把 `mode === 'ocr'` 归一为 `type = 'image'`，再调用 `expandForm('image')` + `handleTypeChange()`，保留自动打开文件选择器；补一个最小 `type` 白名单兜底，避免任意非法值置空 select。
- **为什么**：根因在于类型值不存在，消除后 OCR 快速入口与主「插图」入口行为一致（显示图片区、可预览、可 OCR、type 正确入库）。
- **涉及**：`frontend/js/clip-form.js` `quickRecord()`（L91-108）。

### 2) 补齐 OCR 对已保存剪藏的能力 + 结果可持久化
- **做什么**：让图片剪藏（无论当前会话还是已保存）都能离线 OCR，并把结果写回剪藏内容。
- **怎么改**：
  - 重构 `runImageOcr()`：入参支持"当前会话图 / 已保存剪藏的 `mediaUrl` 相对路径"两种来源；图片字节获取逻辑抽成 `loadImageDataUrl(src)`（当前会话取 `entry.dataUrl`，已保存取 `API_BASE_URL` 去掉 `/clip` 后 + `/media/${rel}` 的 `?thumb=0`，`fetch → blob → FileReader` 转 dataUrl），再走既有 `electronAPI.ocrRecognize(dataUrl)`。
  - 在列表/详情图片区（`clip-list.js` 展开详情的图片处）增加「✨ OCR 提取文字」按钮，识别结果写入该剪藏 `content` 并复用现有 `POST /organize/{id}`（`clip-actions.js confirmOrganizeAction` 的编辑保存语义）落库，之后 `fetchClips()` 刷新。
  - 保留桌面端判断：无 `electronAPI.ocrRecognize` 时提示"OCR 仅桌面客户端可用"（现状已如此）。
- **为什么**：满足用户"剪藏 OCR"的完整生命周期（当前会话 + 已保存），弥补"结果无下落"。
- **涉及**：`frontend/js/clip-form.js`、`frontend/js/clip-list.js`（详情区 OCR 按钮）、复用 `clip-actions.js` 的编辑保存。

### 3) 列表缩略图兜底 —— `frontend/js/clip-list.js`
- **做什么**：`imagePaths` 为空时，从 `content` 匹配首个 `media/{yyMM}/{file}` 相对路径作为缩略图。
- **怎么改**：在 `createClipItem` 计算缩略图处（L604 附近）抽 `resolveThumbSrc(clip)`：优先 `imagePaths[0]`，否则 `(clip.content||'').match(/media\/\d{4}\/[\w.-]+\.\w{1,10}/)`，再经 `mediaUrl()`。
- **为什么**：覆盖旧索引/部分记录的 `imagePaths` 缺失，降低"列表无图片"概率。
- **涉及**：`frontend/js/clip-list.js`。

### 4) 存储路径显示与诊断（低风险，辅助验证）
- **做什么**：不新增后端改动；在验证阶段确认媒体根目录与 `config` 中存储路径一致（`{storagePath}/media`），排除"数据文件路径 vs 配置文件路径"混淆。
- **怎么改**：验证时打开存储目录，检查 `media/{yyMM}/{uuid}.png` 是否生成；若 `/api/media/upload` 返回 404，说明运行的后端 jar 过旧，需重启/重打包（前端 × 后端需同一版本）。
- **为什么**：为"图片根本没存上"做最终归因，避免与前端 bug 混淆。

---

## Assumptions & Decisions（假设与决策）
- **假设**：用户走的是收件箱（`clip.html`，经 `index.html` 内嵌 iframe）里的「OCR」或「插图」快速记录来上传图片。若实际用的主「插图」按钮（type 合法）仍存在"存不上"，则进入验证清单确认后端版本/媒体目录。
- **决策**：不重构后端存储；仅前端修复 + 复用既有 IPC/端点。改 `electron/main.js` 需重启应用，本次不改主进程，仅前端文件（`clip-form.js / clip-list.js / clip-actions.js`），改完刷新 `clip.html` 即生效。
- **决策**：OCR 结果以追加进 `content` 的方式持久化（沿用现有编辑保存链路），不新增数据库字段（避免后端改动）。

---

## Verification（验证步骤）
1. **语法检查**：对改动的 `frontend/js/clip-form.js`、`clip-list.js`、`clip-actions.js` 做 `node --check`。
2. **OCR 快速入口回归**：桌面客户端 → 收件箱 → 「OCR」按钮 → 选择图片 → 应展开「插图」表单、出现上传缩略图、点「✨ OCR 提取文字」得到文字填入内容；保存后列表显示缩略图、类型为「插图」。
3. **主「插图」入口回归**：直接点「插图」→ 上传 → 预览 → OCR → 保存 → 列表缩略图 + 打开存储目录确认 `media/{yyMM}/` 下有文件且与 `imagePaths` 一致。
4. **已保存剪藏 OCR**：选中一条已保存的图片剪藏 → 详情图片区出现「OCR 提取文字」→ 识别结果写入内容并可保存。
5. **缩略图兜底**：临时构造一条 `imagePaths` 为空但 `content` 含 `media/...` 引用的记录，确认列表仍渲染缩略图。
6. **存不上归因**：若上述均正常但仍有"存不上"，拦截 `/api/media/upload` 响应与后端日志；404 即后端 jar 过旧需重打包/重启。