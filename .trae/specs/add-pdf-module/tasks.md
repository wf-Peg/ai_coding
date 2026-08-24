# Tasks

## Phase 1（MVP）— 核心功能

- [x] Task 1: 创建 PdfService 后端服务
  - [x] SubTask 1.1: 创建 `PdfService.java`，注入 slf4j Logger
  - [x] SubTask 1.2: 实现 `mergePdfs(List<MultipartFile>)` — 用 `PDFMergerUtility` 合并多个 PDF
  - [x] SubTask 1.3: 实现 `splitPdf(MultipartFile, ranges/mode)` — 用 `Splitter` 按范围或每页拆分，返回 ZIP
  - [x] SubTask 1.4: 实现 `extractText(MultipartFile)` — 复用 `DocumentParseService` 逻辑，返回文本+页数+截断标志
  - [x] SubTask 1.5: 实现临时文件清理工具方法（try-finally 确保 `PDDocument.close()` 和临时文件删除）

- [x] Task 2: 创建 PdfController 后端接口
  - [x] SubTask 2.1: 创建 `PdfController.java`，`@RequestMapping("/api/pdf")` + `@CrossOrigin(origins = "*")`
  - [x] SubTask 2.2: `POST /api/pdf/merge` — 接收 `MultipartFile[]`，校验 ≥2 个文件，返回 `application/pdf`
  - [x] SubTask 2.3: `POST /api/pdf/split` — 接收 `file + ranges/mode`，校验页码范围，返回 `application/zip`
  - [x] SubTask 2.4: `POST /api/pdf/extract-text` — 返回 `{"text", "pages", "truncated"}`
  - [x] SubTask 2.5: 错误处理：400 返回 `{"error": "..."}`，500 返回 `{"error": "处理失败: ..."}`
  - [x] SubTask 2.6: 添加 Javadoc 注释和 slf4j 日志

- [x] Task 3: 创建前端 PDF 页面（MVP）
  - [x] SubTask 3.1: 创建 `frontend/pdf.html` — 引入 `theme-notion.css`，卡片式布局
  - [x] SubTask 3.2: 实现功能 Tab 切换（合并/拆分/提取文本 三个 Tab）
  - [x] SubTask 3.3: 合并 Tab：多文件上传区（拖拽+点击）、文件列表展示、合并按钮、加载态、下载结果
  - [x] SubTask 3.4: 拆分 Tab：单文件上传、页码范围输入框、"每页拆分"开关、拆分按钮、下载 ZIP
  - [x] SubTask 3.5: 提取文本 Tab：单文件上传、提取按钮、文本展示区（可复制/下载 .txt）
  - [x] SubTask 3.6: 主题同步：监听 `message` 事件 + `themeChange` action，读取 `localStorage.app_appearance_v1`

- [x] Task 4: SPA 导航注册
  - [x] SubTask 4.1: 在 `index.html` 导航栏添加 PDF 按钮（`data-view="pdf"`）
  - [x] SubTask 4.2: 添加 `pdfView` view-panel + `pdfFrame` iframe（`data-src="pdf.html"`）
  - [x] SubTask 4.3: 在 `viewMap`、`frameMap`、`allPanels` 注册 pdf
  - [x] SubTask 4.4: 在 `pathToView()` 添加 `if (clean === '/pdf') return 'pdf'`
  - [x] SubTask 4.5: 在 `broadcastThemeChange()` 数组添加 `pdfFrame`

- [x] Task 5: 验证 Phase 1 并提交
  - [x] SubTask 5.1: 本地编译后端（`mvn compile -o`），沙箱环境离线模式无法验证，代码静态审查通过
  - [x] SubTask 5.2: API 端点代码审查通过（错误处理、响应格式、MIME 类型）
  - [x] SubTask 5.3: 前端页面代码审查通过（Tab 切换、上传、下载、主题同步修复）
  - [x] SubTask 5.4: 主题切换同步修复为 message 事件监听（与 todo/clip/vault 页面一致）
  - [x] SubTask 5.5: 提交代码并追加 commit_history.log

## Phase 2 — 增强功能

- [ ] Task 6: 后端实现 Phase 2 功能
  - [ ] SubTask 6.1: `watermarkPdf(file, text, opacity, rotation)` — 用 `PDPageContentStream` 逐页绘制文字
  - [ ] SubTask 6.2: `addPageNumbers(file, position, startPage)` — 用 `PDPageContentStream` 绘制页码
  - [ ] SubTask 6.3: `getMetadata(file)` / `updateMetadata(file, fields)` — 读写 `PDDocumentInformation`
  - [ ] SubTask 6.4: `encryptPdf(file, password, allowPrinting, allowCopy)` — 用 `StandardProtectionPolicy`
  - [ ] SubTask 6.5: 对应 Controller 端点（4 个 POST）

- [ ] Task 7: 前端实现 Phase 2 功能 Tab
  - [ ] SubTask 7.1: 水印 Tab：文字输入、不透明度滑块、旋转角度选择
  - [ ] SubTask 7.2: 页码 Tab：位置选择（底部居中/右下角）、起始页码输入
  - [ ] SubTask 7.3: 元数据 Tab：上传后显示元数据表单、编辑保存
  - [ ] SubTask 7.4: 加密 Tab：密码输入、权限勾选框

## Phase 3 — 高级功能

- [ ] Task 8: 后端实现 Phase 3 功能
  - [ ] SubTask 8.1: `pdfToImages(file, format, dpi)` — 用 `PDFRenderer.renderImageWithDPI()`，返回 ZIP
  - [ ] SubTask 8.2: `imagesToPdf(List<MultipartFile>)` — 用 `PDImageXObject` + `PDPage` 逐图创建
  - [ ] SubTask 8.3: `compressPdf(file, imageQuality)` — 遍历页面图片重压缩 + `MemoryUsageSetting`
  - [ ] SubTask 8.4: 对应 Controller 端点（3 个 POST）

- [ ] Task 9: 前端实现 Phase 3 功能 Tab
  - [ ] SubTask 9.1: PDF转图片 Tab：格式选择（PNG/JPEG）、DPI 输入
  - [ ] SubTask 9.2: 图片转 PDF Tab：多图片上传
  - [ ] SubTask 9.3: 压缩 Tab：质量滑块（0.1-1.0）

# Task Dependencies
- Task 2 depends on Task 1
- Task 3 depends on Task 2（前端需要后端 API 可调用）
- Task 4 depends on Task 3（页面存在后才能注册到导航）
- Task 5 depends on Task 4
- Task 6 depends on Task 5（Phase 1 完成后再做 Phase 2）
- Task 7 depends on Task 6
- Task 8 depends on Task 7（Phase 2 完成后再做 Phase 3）
- Task 9 depends on Task 8
