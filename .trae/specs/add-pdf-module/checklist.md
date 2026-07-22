# Checklist

## Phase 1（MVP）

- [ ] PdfService.java 创建在 `backend/src/main/java/com/example/clip/service/` 包下
- [ ] PdfService 使用 `@Service` 注解和 slf4j Logger
- [ ] mergePdfs 使用 `PDFMergerUtility`，文件数 < 2 时抛出 IllegalArgumentException
- [ ] splitPdf 支持 "1-3,5,7-9" 格式的页码范围解析，无效范围返回错误
- [ ] splitPdf 支持 mode="each" 每页拆分模式
- [ ] splitPdf 返回 ZIP 格式（`java.util.zip.ZipOutputStream`）
- [ ] extractText 复用 PDFTextStripper 逻辑，返回 {text, pages, truncated}
- [ ] extractText 超过 50000 字符时 truncated=true
- [ ] 所有 PDDocument 实例在 try-finally 或 try-with-resources 中关闭
- [ ] PdfController.java 使用 `@RestController` + `@RequestMapping("/api/pdf")` + `@CrossOrigin(origins = "*")`
- [ ] PdfController 构造器注入 PdfService（无 @Autowired）
- [ ] POST /api/pdf/merge 接收 `MultipartFile[] files`，校验 ≥2，返回 `application/pdf`
- [ ] POST /api/pdf/split 接收 `MultipartFile file` + `String ranges` + `String mode`，返回 `application/zip`
- [ ] POST /api/pdf/extract-text 返回 `application/json` 含 text/pages/truncated
- [ ] 所有端点错误时返回 `{"error": "..."}` 格式，HTTP 状态码 400/500
- [ ] 所有端点和方法有 Javadoc 注释
- [ ] 所有端点有 slf4j 日志记录（请求进入和结果）
- [ ] pdf.html 引入 `./styles/theme-notion.css`
- [ ] pdf.html 使用项目 CSS 变量（--bg, --fg, --primary, --card, --border, --radius-md 等）
- [ ] pdf.html 三个功能 Tab（合并/拆分/提取文本）可切换
- [ ] 合并 Tab 支持多文件上传（拖拽 + 点击），显示文件列表
- [ ] 合并按钮点击时有加载状态（禁用 + 文字变化）
- [ ] 拆分 Tab 有页码范围输入框和"每页拆分"开关
- [ ] 提取文本 Tab 有文本展示区，支持复制和下载 .txt
- [ ] pdf.html 监听 themeChange 事件，同步主题切换
- [ ] index.html 导航栏新增 PDF 按钮（data-view="pdf"）
- [ ] index.html 新增 pdfView view-panel（view-panel-hidden 类）+ pdfFrame iframe（data-src="pdf.html"）
- [ ] index.html 的 viewMap 包含 `pdf: pdfView`
- [ ] index.html 的 frameMap 包含 `pdf: pdfFrame`
- [ ] index.html 的 allPanels 包含 pdfView
- [ ] index.html 的 pathToView() 包含 `if (clean === '/pdf') return 'pdf'`
- [ ] index.html 的 broadcastThemeChange() 数组包含 pdfFrame
- [ ] 后端 mvn compile 无编译错误
- [ ] 不修改任何现有 controller/service/frontend 页面
- [ ] commit_history.log 追加提交记录

## Phase 2

- [ ] watermarkPdf 用 PDPageContentStream 逐页在中心绘制半透明文字
- [ ] watermarkPdf 支持自定义不透明度（0-1）和旋转角度
- [ ] addPageNumbers 支持底部居中和右下角两个位置
- [ ] addPageNumbers 支持自定义起始页码
- [ ] getMetadata 返回 title/author/subject/keywords/creationDate/pages
- [ ] updateMetadata 可编辑 title/author/subject/keywords 并返回修改后的 PDF
- [ ] encryptPdf 用 StandardProtectionPolicy，支持密码和权限设置
- [ ] 4 个 Phase 2 端点均有 Javadoc 和日志
- [ ] 前端 4 个 Phase 2 Tab UI 符合 Notion 风格

## Phase 3

- [ ] pdfToImages 用 PDFRenderer.renderImageWithDPI()，支持 PNG/JPEG
- [ ] pdfToImages 返回 ZIP
- [ ] imagesToPdf 支持 PNG/JPEG，每图一页
- [ ] compressPdf 通过图片重压缩减小文件体积
- [ ] 3 个 Phase 3 端点均有 Javadoc 和日志
- [ ] 前端 3 个 Phase 3 Tab UI 符合 Notion 风格
