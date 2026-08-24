# 工具模块（Tools Hub）设计与实现方案

## 一、摘要

将现有的独立 **PDF 模块** 重构为一套统一的 **「工具」模块**：导航栏新增一个「工具」入口，进入一个工具聚合页（Tools Hub）。PDF 作为其中一个工具卡片保留。首批再补充 **文件处理类** 小工具。架构上采用 **模块化 + 拔插式** 设计：

- 每个小工具 = 一个自包含的 HTML 页面 + 一条注册元数据（含 `prompt` 开发提示词）
- 工具页面内可查看/复制该工具的**开发提示词**，方便「复制源代码 + 提示词」做新需求开发
- 支持**导入**（上传 HTML + 填写名称/描述/提示词）与**删除**（用户导入的工具可删，内置工具不可删）

样式交互参考大厂工具聚合页（Arc / Raycast / Notion / Worktile 风格）：卡片网格 + 搜索 + 分类筛选 + 悬停抬升动效。

---

## 二、当前状态分析

### 2.1 现有 PDF 模块
- 导航入口：`frontend/index.html` 顶部标题栏 `.nav-btn[data-view="pdf"]`（第 531 行）
- 页面：`frontend/pdf.html`，含 3 个 Tab：合并 / 拆分 / 提取文本
- 后端：`backend/.../controller/PdfController.java`，`/api/pdf/{merge, split, extract-text, ocr}`，服务层 `PdfService`
- 内置 OCR 入口在 `index.html` 第 1487 行（`/api/pdf/ocr`，Electron 右键菜单触达）

### 2.2 导航切换机制（index.html）
新增一个视图需改动 6 处：
1. 标题栏 `<nav>` 加 `.nav-btn[data-view="tools"]`
2. 加 `<div class="view-panel" id="toolsView"><iframe id="toolsFrame" data-src="tools.html"></iframe></div>`
3. `viewMap` 加 `tools: toolsView`（第 817 行附近）
4. `VIEW_IFRAME` 加 `tools: [toolsFrame]`（第 829 行附近）
5. `pathToView` 加 `/tools` 映射（第 877 行附近）
6. 各 iframe 数组（第 654、660、1141、1267 行）加入 `toolsFrame`

### 2.3 设计系统
- `frontend/styles/design-tokens.css`：CSS 变量（`--app-*`），含语义色、圆角、阴影梯度、动效曲线
- 主题文件：`theme-notion.css` / `theme-regular.css` 等，通过 `html[data-theme]` 切换
- 现代设计参考：`workspace.html`（sidebar + overview 卡片 + design-tokens）

### 2.4 后端数据目录
- 配置存于 `~/.cut-shelter/config/`（见 `AppConfigService.getConfigDir()`）
- 工具 HTML + 注册表存储目录建议：`~/.cut-shelter/tools/`

---

## 三、变更方案

### A. 后端：工具管理 + 文件处理接口

**A1. 新建 `ToolRegistryService` + `ToolController`（`/api/tools`）**

存储目录：`~/.cut-shelter/tools/`
- `registry.json`：工具元数据注册表
- `<toolId>.html`：各工具自包含页面

注册表结构：
```json
{
  "version": 1,
  "tools": [
    {
      "id": "pdf-toolbox",
      "name": "PDF 工具箱",
      "icon": "📄",
      "category": "文件处理",
      "description": "合并、拆分、提取文本与 OCR 识别 PDF 文档",
      "keywords": ["pdf", "合并", "拆分", "ocr"],
      "file": "pdf-toolbox.html",
      "prompt": "开发一个 PDF 处理工具，支持合并/拆分/提取文本/OCR，界面参考……",
      "builtin": true,
      "createdAt": "..."
    }
  ]
}
```

接口：
- `GET  /api/tools` — 返回注册表工具列表
- `GET  /api/tools/{id}/page` — 返回工具 HTML 内容（`text/html`）
- `GET  /api/tools/{id}/prompt` — 返回该工具的 `prompt`（供复制）
- `POST /api/tools` — 导入工具（`multipart`：`html` 文件 + `name` + `category` + `description` + `prompt`），生成唯一 `id`，写入 `registry.json` 与 `tools/<id>.html`
- `DELETE /api/tools/{id}` — 删除工具（`builtin=true` 拒绝删除，返回 400）

**A2. 文件处理接口（首批工具的后端支撑）**

- 图片压缩/格式转换：`POST /api/tools/image/convert`（`multipart`：`file` + `format` + `quality`），用 `ImageIO` 处理，返回转换后的图片字节流
- CSV↔JSON：`POST /api/tools/csv-json`（`application/json`：`{ direction: "csvToJson"|"jsonToCsv", content, delimiter }`），纯后端字符串处理，返回转换结果
- 批量重命名：走 **Electron 主进程 IPC**（见 B2），不占用后端接口

### B. 前端：工具聚合页（Tools Hub）

**B1. 新建 `frontend/tools.html` + `frontend/styles/tools.css` + `frontend/js/tools-core.js`**

页面结构（参考大厂工具聚合页）：
- 顶部：标题 + 副标题 + 右侧「导入工具」按钮
- 搜索框 + 分类筛选 chips（全部 / 文件处理 / 文本处理 / …）
- 主体：响应式卡片网格，每张卡片：
  - 圆形图标底 + emoji 图标
  - 名称 + 一句话描述
  - 分类徽标
  - 悬停：上浮 + 阴影加深 + 轻微缩放（`--app-ease-out-expo`）
  - 卡片右上角「⋯」菜单：查看开发提示词 /（非内置）删除
- 空状态：无工具时的引导插画 + 提示导入
- 工具运行区：点击卡片 → 在 hub 内以浅色遮罩层 + 内嵌区域加载该工具（`iframe src = API_BASE + /api/tools/{id}/page`），右上角关闭返回卡片列表

交互逻辑（`tools-core.js`）：
- 加载 `GET /api/tools` 渲染网格；搜索/筛选在前端过滤
- 「打开工具」：显示工具工作区遮罩，注入 iframe
- 「开发提示词」：弹出 Modal，展示 `prompt` + 「复制」按钮（`navigator.clipboard`）
- 「导入工具」：Modal——上传 `.html` 文件 + 填写名称/分类/描述/提示词 → `POST /api/tools` → 刷新列表
- 「删除工具」：确认后 `DELETE /api/tools/{id}` → 刷新列表

样式：复用 `design-tokens.css` 变量 + 兼容 `theme-notion.css` 等主题；空状态与动效参考现有 workspace/clip 模块风格。

**B2. Electron 批量重命名（`electron/main.js` + 工具页）**

- `main.js` 新增 IPC handler `tools:batchRename`：调用目录选择对话框 → 读取目录下文件 → 返回文件列表 → 接收重命名规则（前缀/替换/序号/扩展名保留）→ 执行重命名 → 返回结果
- 工具页 `batch-rename.html`：选择目录 → 展示文件列表 → 配置规则 → 实时预览新文件名 → 执行

### C. 迁移 PDF 为内置工具

- 将现有 `frontend/pdf.html` 内容作为内置工具页 `pdf-toolbox.html`（保留 合并/拆分/提取文本 三个 Tab；OCR 维持现有 Electron 右键入口）
- 在 `registry.json` 注册 `pdf-toolbox`（`builtin: true`），`prompt` 字段描述该 PDF 工具的开发需求
- 保留原有 `pdf.html` 文件（避免破坏现有 Electron 右键 OCR 路径），仅作为工具页内容复用

### D. 导航集成（index.html）

- 标题栏新增「工具」按钮（`data-view="tools"`，图标沿用 PDF 的文档图标或改为工具铁锹图标）
- 新增 `toolsView` 面板 + `toolsFrame` iframe（`data-src="tools.html"`）
- 注册 `viewMap` / `VIEW_IFRAME` / `pathToView`（`/tools`）
- 各 iframe 数组（654、660、1141、1267 行）加入 `toolsFrame`
- 移除原 `pdf` 导航按钮（PDF 并入工具模块），`viewMap`/`VIEW_IFRAME`/`pathToView` 中 `pdf` 相关映射一并移除或保留兼容映射到工具页

---

## 四、假设与决策

1. **工具模块为单一导航入口**：点击「工具」进入 hub；工具页在 hub 内以遮罩层 + iframe 运行，不占用额外导航位
2. **工具 HTML 由后端服务**：`GET /api/tools/{id}/page` 返回页面内容，hub 内 iframe 引用；导入/删除统一走后端，便于管理与持久化
3. **内置 vs 导入**：`builtin=true` 的工具（如 PDF）不可删除；用户导入的工具可删除
4. **提示词语义**：`prompt` = 该工具的「开发需求提示词」，供用户复制后结合源码做新工具开发
5. **首批工具范围**：PDF（迁移）+ 批量重命名 + 图片压缩/格式转换 + CSV↔JSON；其余分类工具后续按同一机制追加
6. 兼容主题：工具页统一引用 `design-tokens.css`，沿用现有主题切换机制

---

## 五、文件清单

| 动作 | 文件 |
|------|------|
| 新增 | `backend/.../service/ToolRegistryService.java` |
| 新增 | `backend/.../controller/ToolController.java` |
| 新增 | `frontend/tools.html` |
| 新增 | `frontend/styles/tools.css` |
| 新增 | `frontend/js/tools-core.js` |
| 新增 | `frontend/tools/batch-rename.html` |
| 新增 | `frontend/tools/image-convert.html` |
| 新增 | `frontend/tools/csv-json.html` |
| 新增 | `frontend/tools/pdf-toolbox.html`（复用 pdf.html 内容） |
| 修改 | `frontend/index.html`（导航 + 视图注册） |
| 修改 | `electron/main.js`（批量重命名 IPC） |
| 复用 | `frontend/pdf.html`（内置工具内容源） |

---

## 六、验证步骤

1. 后端 `mvn compile` 通过
2. 启动应用，导航栏出现「工具」按钮，点击进入 hub
3. hub 展示工具卡片网格；搜索、分类筛选正常
4. 打开「PDF 工具箱」，合并/拆分/提取文本 可用
5. 打开「批量重命名」：选择目录 → 预览 → 执行成功
6. 打开「图片转换」：上传图片 → 选择格式/质量 → 下载成功
7. 打开「CSV↔JSON」：双向转换正确
8. 「导入工具」：上传一个自定义 HTML + 填写信息 → 出现在网格 → 可打开
9. 「开发提示词」：弹出 prompt 并可复制
10. 「删除工具」：用户导入的工具可删，内置 PDF 不可删