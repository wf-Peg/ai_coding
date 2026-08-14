package com.example.clip.model;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * 剪藏内容（ClipContent）模型类。
 * <p>
 * 剪藏是 Clip 系统的核心实体，用于存储用户从浏览器、手动输入或系统自动采集
 * 的内容片段。每条剪藏记录包含原始内容、元数据（来源、时间、采集方式等）、
 * 工作流状态、AI 分析结果（摘要、分析、发散性总结）以及关联的图片路径。
 * </p>
 *
 * <h3>工作流状态流转</h3>
 * <pre>
 *   inbox（收件箱） → organized（已整理） → archived（已归档）
 * </pre>
 *
 * @see TodoContent 可从剪藏生成待办事项
 * @see KnowledgeEntry 可从剪藏提取知识条目
 */
public class ClipContent {

    /** 剪藏唯一标识 ID，由持久层自动生成 */
    private Long id;

    /** 剪藏的核心内容，支持文本、HTML 等格式 */
    private String content;

    /** 剪藏类型：text（文本）、image（图片）、file（文件）等 */
    private String type;

    /** 剪藏来源：system（系统自动）、browser（浏览器插件）、manual（手动录入） */
    private String source;

    /** 分类标识，用于垂直领域划分，如 "work"、"study"、"life" 等 */
    private String category;

    /** 采集时自动提取或用户指定的标题 */
    private String title;

    /** 结构化来源 URL，记录原始网页地址 */
    private String sourceUrl;

    /** 来源站点名称，如 "知乎"、"GitHub" 等 */
    private String siteName;

    /** 采集时间，格式为 yyyy-MM-dd HH:mm:ss 的字符串 */
    private String capturedAt;

    /** 用户在页面上实际选中的原始文本 */
    private String selectedText;

    /** 选中文本之前的上文内容，用于 AI 理解语境 */
    private String contextBefore;

    /** 选中文本之后的下文内容，用于 AI 理解语境 */
    private String contextAfter;

    /** 采集方式，如 "mouse-select"、"keyboard-shortcut" 等 */
    private String captureMethod;

    /** 工作流状态：inbox（收件箱）、organized（已整理）、archived（已归档） */
    private String workflowStatus;

    /** 标签列表，支持多标签分类和检索 */
    private List<String> tags = new ArrayList<>();

    /** 记录创建时间（服务端时间），用于排序和审计 */
    private LocalDateTime createdAt;

    /** AI 生成的内容摘要，简明扼要地概括剪藏内容 */
    private String summary;

    /** AI 对内容的深度分析结果 */
    private String analysis;

    /**
     * AI 分析状态：pending（分析中）/ ready（已完成）/ failed（失败）/ empty（无需分析）。
     * <p>
     * 新增剪藏先以 pending 入库并立即返回，后台异步执行 AI 分析后更新为 ready/failed。
     * 历史数据无此字段，前端按字符串标记回退判定（兼容旧数据）。
     * </p>
     */
    private String analysisStatus;

    /** AI 生成的发散性总结，从不同角度拓展思考 */
    private String divergentSummary;

    /**
     * 关联的图片相对路径列表（权威引用清单，用于生命周期管理）。
     * <p>
     * 语义：图片统一存 media 根目录，路径格式 {@code media/{yyMM}/{uuid}.{ext}}
     * （UUID 命名 + 按月分片，与分类/整理解耦）。content 中的 Markdown 图片引用
     * {@code ![alt](media/...)} 与此清单保持一致；删除剪藏/清理孤儿均以此为准。
     * </p>
     */
    private List<String> imagePaths = new ArrayList<>();

    /**
     * doc-ai 源文件相对路径（可选）。
     * <p>
     * 当剪藏类型为 doc-ai 时，源文件（PDF/DOCX/TXT 等）独立存储于
     * {@code documents/} 目录，路径格式 {@code documents/{uuid}.{ext}}。
     * 与图片分离，不进入 imagePaths；前端通过
     * {@code GET /api/media/file/{fileName}} 下载原文件。
     * </p>
     */
    private String attachmentPath;

    /**
     * 用户自己的思考（可选，可编辑）。
     * 用于记录阅读后的主观判断、疑问、联想、反思等。
     * 与 AI 生成的 analysis 不同，这是用户的主动认知输出。
     * 在日报/周报中，包含此字段的剪藏会触发"认知对话模式"。
     */
    private String myThoughts;

    /**
     * Web Clipper 同步的源文件相对路径（可选）。
     * <p>
     * 当剪藏来源于 Obsidian Web Clipper 同步时，记录 sources/ 目录下的相对路径，
     * 例如 {@code sources/2026-07-30_React入门.md}。便于后续跳转原文、回链或增量
     * 处理。该字段不参与正常剪藏的存储流程，仅为 Web Clipper 同步链路保留。
     * </p>
     */
    private String sourceFilePath;

    /**
     * Web Clipper 同步的原始正文内容（不含 frontmatter）。
     * <p>
     * 当剪藏来源于 Obsidian Web Clipper 同步时，存储 frontmatter 之后的
     * Markdown 正文内容，用于前端展示和 AI 分析。与 {@link #content} 不同，
     * content 保留 wiki-link 引用 {@code [[sources/文件名|标题]]} 用于 Obsidian
     * 集成，bodyContent 存储实际可读的正文内容。
     * </p>
     */
    private String bodyContent;

    /** 编辑器内容类型：text/json/xml/sql，用于再次打开时恢复语法模式 */
    private String contentFormat;

    /** 来源文件名，不包含本地绝对路径 */
    private String sourceFileName;

    /** 来源或保存目标字符编码 */
    private String sourceEncoding;

    /** 来源或保存目标换行符：LF/CRLF/CR */
    private String sourceLineEnding;

    /**
     * 无参构造函数。
     * 自动设置创建时间（{@code createdAt}）为当前时间。
     */
    public ClipContent() {
        this.createdAt = LocalDateTime.now();
    }

    /**
     * 带参构造函数，用于快速创建剪藏记录。
     *
     * @param content  剪藏的核心内容
     * @param type     剪藏类型（text/image/file）
     * @param source   剪藏来源（system/browser/manual）
     * @param category 分类标识
     */
    public ClipContent(String content, String type, String source, String category) {
        this.content = content;
        this.type = type;
        this.source = source;
        this.category = category;
        this.createdAt = LocalDateTime.now();
    }

    // Getters and Setters
    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getContent() {
        return content;
    }

    public void setContent(String content) {
        this.content = content;
    }

    public String getType() {
        return type;
    }

    public void setType(String type) {
        this.type = type;
    }

    public String getSource() {
        return source;
    }

    public void setSource(String source) {
        this.source = source;
    }

    public String getCategory() {
        return category;
    }

    public void setCategory(String category) {
        this.category = category;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getSourceUrl() {
        return sourceUrl;
    }

    public void setSourceUrl(String sourceUrl) {
        this.sourceUrl = sourceUrl;
    }

    public String getSiteName() {
        return siteName;
    }

    public void setSiteName(String siteName) {
        this.siteName = siteName;
    }

    public String getCapturedAt() {
        return capturedAt;
    }

    public void setCapturedAt(String capturedAt) {
        this.capturedAt = capturedAt;
    }

    public String getSelectedText() {
        return selectedText;
    }

    public void setSelectedText(String selectedText) {
        this.selectedText = selectedText;
    }

    public String getCaptureMethod() {
        return captureMethod;
    }

    public void setCaptureMethod(String captureMethod) {
        this.captureMethod = captureMethod;
    }

    public String getContextBefore() {
        return contextBefore;
    }

    public void setContextBefore(String contextBefore) {
        this.contextBefore = contextBefore;
    }

    public String getContextAfter() {
        return contextAfter;
    }

    public void setContextAfter(String contextAfter) {
        this.contextAfter = contextAfter;
    }

    public String getWorkflowStatus() {
        return workflowStatus;
    }

    public void setWorkflowStatus(String workflowStatus) {
        this.workflowStatus = workflowStatus;
    }

    public List<String> getTags() {
        return tags;
    }

    public void setTags(List<String> tags) {
        this.tags = tags;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
    }

    public String getSummary() {
        return summary;
    }

    public void setSummary(String summary) {
        this.summary = summary;
    }

    public String getAnalysis() {
        return analysis;
    }

    public void setAnalysis(String analysis) {
        this.analysis = analysis;
    }

    public String getAnalysisStatus() {
        return analysisStatus;
    }

    public void setAnalysisStatus(String analysisStatus) {
        this.analysisStatus = analysisStatus;
    }

    public String getDivergentSummary() {
        return divergentSummary;
    }

    public void setDivergentSummary(String divergentSummary) {
        this.divergentSummary = divergentSummary;
    }

    public List<String> getImagePaths() {
        return imagePaths;
    }

    public void setImagePaths(List<String> imagePaths) {
        this.imagePaths = imagePaths;
    }

    public String getAttachmentPath() {
        return attachmentPath;
    }

    public void setAttachmentPath(String attachmentPath) {
        this.attachmentPath = attachmentPath;
    }

    public String getMyThoughts() {
        return myThoughts;
    }

    public void setMyThoughts(String myThoughts) {
        this.myThoughts = myThoughts;
    }

    /**
     * 返回 Web Clipper 同步的源文件相对路径。
     *
     * @return 源文件路径，例如 {@code sources/2026-07-30_React入门.md}；非同步剪藏返回 null
     */
    public String getSourceFilePath() {
        return sourceFilePath;
    }

    /**
     * 返回 Web Clipper 同步的原始正文内容。
     *
     * @return 正文内容（不含 frontmatter）；非同步剪藏返回 null
     */
    public String getBodyContent() {
        return bodyContent;
    }

    /**
     * 设置 Web Clipper 同步的源文件相对路径。
     *
     * @param sourceFilePath 源文件路径
     */
    public void setSourceFilePath(String sourceFilePath) {
        this.sourceFilePath = sourceFilePath;
    }

    /**
     * 设置 Web Clipper 同步的原始正文内容。
     *
     * @param bodyContent 正文内容
     */
    public void setBodyContent(String bodyContent) {
        this.bodyContent = bodyContent;
    }

    public String getContentFormat() {
        return contentFormat;
    }

    public void setContentFormat(String contentFormat) {
        this.contentFormat = contentFormat;
    }

    public String getSourceFileName() {
        return sourceFileName;
    }

    public void setSourceFileName(String sourceFileName) {
        this.sourceFileName = sourceFileName;
    }

    public String getSourceEncoding() {
        return sourceEncoding;
    }

    public void setSourceEncoding(String sourceEncoding) {
        this.sourceEncoding = sourceEncoding;
    }

    public String getSourceLineEnding() {
        return sourceLineEnding;
    }

    public void setSourceLineEnding(String sourceLineEnding) {
        this.sourceLineEnding = sourceLineEnding;
    }
}
