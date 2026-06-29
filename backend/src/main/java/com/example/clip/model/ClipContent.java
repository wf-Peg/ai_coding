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

    /** AI 生成的发散性总结，从不同角度拓展思考 */
    private String divergentSummary;

    /** 关联的图片相对路径列表，用于富文本剪藏中的图片引用 */
    private List<String> imagePaths = new ArrayList<>();

    /**
     * 用户自己的思考（可选，可编辑）。
     * 用于记录阅读后的主观判断、疑问、联想、反思等。
     * 与 AI 生成的 analysis 不同，这是用户的主动认知输出。
     * 在日报/周报中，包含此字段的剪藏会触发"认知对话模式"。
     */
    private String myThoughts;

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

    public String getMyThoughts() {
        return myThoughts;
    }

    public void setMyThoughts(String myThoughts) {
        this.myThoughts = myThoughts;
    }
}
