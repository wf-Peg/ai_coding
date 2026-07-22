# PDF 处理模块 Spec

## Why

本项目（CutShelter）已有成熟的剪藏、待办、话题、密码库等模块，但缺少 PDF 文件处理能力。参考 [pdf-master](https://github.com/topul/pdf-master) 项目（18 个 PDF 功能），在本应用中新增 PDF 处理模块，让用户无需切换到外部工具即可完成常见 PDF 操作。

pdf-master 是纯前端 React + WASM 应用，而本项目是 Spring Boot + 原生 JS 架构，因此 PDF 处理逻辑放在**后端用 Apache PDFBox**（已在 pom.xml 中）实现，前端提供 Notion 风格的操作界面。

## What Changes

- 新增后端 `PdfController` + `PdfService`，基于 Apache PDFBox 2.0.27 实现 PDF 处理 API
- 新增前端 `pdf.html` 页面，Notion 风格，集成到 SPA 导航
- 按 3 个优先级阶段逐步交付功能：
  - **Phase 1（MVP）**：PDF 合并、PDF 拆分、PDF 提取文本
  - **Phase 2**：PDF 水印、PDF 页码、PDF 元数据查看/编辑、PDF 加密
  - **Phase 3**：PDF 转图片、图片转 PDF、PDF 压缩、PDF 批量处理
- 不引入新前端框架，不引入数据库，复用现有 `FileStorageService` 做临时文件管理

## Impact

- Affected specs: 无（新模块）
- Affected code:
  - 新增：`backend/.../controller/PdfController.java`、`backend/.../service/PdfService.java`
  - 新增：`frontend/pdf.html`、`frontend/styles/pdf-theme-notion.css`
  - 修改：`frontend/index.html`（SPA 导航注册：nav-btn、view-panel、viewMap、frameMap、allPanels、pathToView、broadcastThemeChange）
  - 不修改：现有任何 controller/service/frontend 页面

## ADDED Requirements

### Requirement: PDF 模块导航入口
系统 SHALL 在 SPA 导航栏新增 "PDF" 按钮，点击后切换到 PDF 模块页面（`pdf.html`），遵循现有 SPA 路由约定（`history.pushState` + `popstate`）。

#### Scenario: 用户从导航栏进入 PDF 模块
- **WHEN** 用户点击导航栏 "PDF" 按钮
- **THEN** SPA 切换到 PDF 视图面板，iframe 懒加载 `pdf.html`
- **AND** URL 变为 `/pdf`
- **AND** 主题（Notion/深色）自动同步到 PDF 页面

### Requirement: PDF 合并
系统 SHALL 提供将多个 PDF 文件合并为一个 PDF 的功能。

#### Scenario: 上传多个 PDF 合并
- **WHEN** 用户上传 2 个或以上 PDF 文件并点击"合并"
- **THEN** 后端用 `PDFMergerUtility` 按上传顺序合并
- **AND** 返回合并后的 PDF 文件供下载
- **AND** 合并过程中显示加载状态

#### Scenario: 仅上传 1 个文件
- **WHEN** 用户仅上传 1 个 PDF 并点击"合并"
- **THEN** 返回 400 错误，提示"至少需要 2 个 PDF 文件"

### Requirement: PDF 拆分
系统 SHALL 提供按页码范围拆分 PDF 的功能。

#### Scenario: 按页码范围拆分
- **WHEN** 用户上传 1 个 PDF 并输入页码范围（如 "1-3,5,7-9"）
- **THEN** 后端按范围拆分，生成多个 PDF
- **AND** 打包为 ZIP 返回下载
- **AND** 无效页码范围返回 400 错误

#### Scenario: 拆分每一页
- **WHEN** 用户选择"每页拆分"
- **THEN** 后端将 PDF 的每一页拆分为独立 PDF
- **AND** 打包为 ZIP 返回下载

### Requirement: PDF 提取文本
系统 SHALL 提供从 PDF 提取纯文本的功能（复用现有 `DocumentParseService`）。

#### Scenario: 提取 PDF 文本
- **WHEN** 用户上传 1 个 PDF 并点击"提取文本"
- **THEN** 后端用 `PDFTextStripper` 提取全文文本
- **AND** 返回文本内容在前端展示，支持复制和下载为 .txt
- **AND** 文本超过 50000 字符时截断并提示

### Requirement: PDF 水印
系统 SHALL 提供为 PDF 添加文字水印的功能。

#### Scenario: 添加文字水印
- **WHEN** 用户上传 PDF，输入水印文字、选择不透明度和旋转角度
- **THEN** 后端用 PDFBox `Overlay` 或逐页绘制在每页中心添加水印
- **AND** 返回加水印后的 PDF 下载

### Requirement: PDF 页码
系统 SHALL 提供为 PDF 添加页码的功能。

#### Scenario: 添加页码
- **WHEN** 用户上传 PDF，选择页码位置（底部居中/右下角）和起始页码
- **THEN** 后端用 PDFBox 在每页指定位置绘制页码
- **AND** 返回加页码后的 PDF 下载

### Requirement: PDF 元数据
系统 SHALL 提供查看和编辑 PDF 元数据的功能。

#### Scenario: 查看元数据
- **WHEN** 用户上传 PDF
- **THEN** 显示标题、作者、主题、关键词、创建时间、修改时间、页数
- **AND** 允许编辑标题/作者/主题/关键词并保存

### Requirement: PDF 加密
系统 SHALL 提供为 PDF 设置密码保护的功能。

#### Scenario: 加密 PDF
- **WHEN** 用户上传 PDF，输入用户密码和权限设置（是否允许打印/复制）
- **THEN** 后端用 `StandardProtectionPolicy` 加密
- **AND** 返回加密后的 PDF 下载

### Requirement: PDF 转图片
系统 SHALL 提供将 PDF 每页转为图片的功能。

#### Scenario: PDF 转图片
- **WHEN** 用户上传 PDF，选择图片格式（PNG/JPEG）和 DPI
- **THEN** 后端用 `PDFRenderer` 逐页渲染为图片
- **AND** 打包为 ZIP 返回下载

### Requirement: 图片转 PDF
系统 SHALL 提供将多张图片合并为一个 PDF 的功能。

#### Scenario: 图片转 PDF
- **WHEN** 用户上传多张图片（PNG/JPEG）
- **THEN** 后端用 PDFBox 创建 PDF，每张图片为一页
- **AND** 返回 PDF 下载

### Requirement: Notion 风格 UI
PDF 模块前端 SHALL 遵循项目现有 Notion 主题样式（`theme-notion.css`），使用统一的 CSS 变量（`--bg: #f7f7f5`、`--fg: #2f3437`、`--primary: #2383e2` 等），圆角 10-14px，卡片式布局。

#### Scenario: 主题切换同步
- **WHEN** 用户在设置页切换主题（Notion/深色/常规）
- **THEN** PDF 页面通过 `themeChange` 事件同步切换主题
- **AND** 所有 PDF 模块 UI 元素颜色跟随主题变化

### Requirement: 文件上传与临时存储
系统 SHALL 通过 `MultipartFile` 接收上传的 PDF 文件，处理完成后立即删除临时文件，不持久化用户上传的 PDF。

#### Scenario: 临时文件清理
- **WHEN** PDF 处理完成（无论成功或失败）
- **THEN** 临时上传文件和处理产物从服务器磁盘删除
- **AND** 仅保留 HTTP 响应中的二进制流

## 接口文档

### POST /api/pdf/merge — 合并 PDF
```
POST /api/pdf/merge
Content-Type: multipart/form-data

files: file1.pdf (MultipartFile, 必填, ≥2个)
files: file2.pdf

→ 200 application/pdf (二进制流)
→ 400 {"error": "至少需要 2 个 PDF 文件"}
```

### POST /api/pdf/split — 拆分 PDF
```
POST /api/pdf/split
Content-Type: multipart/form-data

file: input.pdf (MultipartFile, 必填)
ranges: "1-3,5,7-9" (String, 可选, 与 mode 二选一)
mode: "each" (String, 可选, 每页拆分)

→ 200 application/zip (二进制流, 多个PDF打包)
→ 400 {"error": "页码范围无效: 1-3,5,7-9"}
```

### POST /api/pdf/extract-text — 提取文本
```
POST /api/pdf/extract-text
Content-Type: multipart/form-data

file: input.pdf (MultipartFile, 必填)

→ 200 application/json {"text": "...", "pages": 10, "truncated": false}
→ 400 {"error": "文件不是有效PDF"}
```

### POST /api/pdf/watermark — 添加水印
```
POST /api/pdf/watermark
Content-Type: multipart/form-data

file: input.pdf (MultipartFile, 必填)
text: "机密" (String, 必填)
opacity: 0.3 (float, 默认0.3)
rotation: 45 (int, 默认45度)

→ 200 application/pdf
→ 400 {"error": "水印文字不能为空"}
```

### POST /api/pdf/page-number — 添加页码
```
POST /api/pdf/page-number
Content-Type: multipart/form-data

file: input.pdf (MultipartFile, 必填)
position: "bottom-center" (String, bottom-center|bottom-right, 默认bottom-center)
startPage: 1 (int, 默认1)

→ 200 application/pdf
```

### POST /api/pdf/metadata — 查看/编辑元数据
```
GET /api/pdf/metadata (file: MultipartFile)
→ 200 {"title":"...", "author":"...", "subject":"...", "keywords":"...", "creationDate":"...", "pages":10}

POST /api/pdf/metadata (file: MultipartFile, title/author/subject/keywords: String)
→ 200 application/pdf (修改后的PDF)
```

### POST /api/pdf/encrypt — 加密 PDF
```
POST /api/pdf/encrypt
Content-Type: multipart/form-data

file: input.pdf (MultipartFile, 必填)
password: "abc123" (String, 必填)
allowPrinting: true (boolean, 默认true)
allowCopy: true (boolean, 默认true)

→ 200 application/pdf
→ 400 {"error": "密码不能为空"}
```

### POST /api/pdf/to-images — PDF 转图片
```
POST /api/pdf/to-images
Content-Type: multipart/form-data

file: input.pdf (MultipartFile, 必填)
format: "png" (String, png|jpeg, 默认png)
dpi: 150 (int, 默认150)

→ 200 application/zip (图片打包)
```

### POST /api/pdf/images-to-pdf — 图片转 PDF
```
POST /api/pdf/images-to-pdf
Content-Type: multipart/form-data

files: img1.png (MultipartFile, 必填, ≥1个)
files: img2.jpg

→ 200 application/pdf
```

### POST /api/pdf/compress — 压缩 PDF
```
POST /api/pdf/compress
Content-Type: multipart/form-data

file: input.pdf (MultipartFile, 必填)
imageQuality: 0.5 (float, 0.1-1.0, 默认0.5)

→ 200 application/pdf
```
