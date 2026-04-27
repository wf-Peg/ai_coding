package com.example.clip.model;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * 剪藏内容模型类
 * 存储剪藏的内容、类型、来源、分类、标签等信息
 */
public class ClipContent {

    private Long id;  // 剪藏ID

    private String content;  // 剪藏内容

    private String type;  // 剪藏类型：text, image, file, etc.

    private String source;  // 剪藏来源：system, browser, manual

    private String category;  // 分类，用于垂直领域

    private String title;  // 采集标题

    private String sourceUrl;  // 结构化来源 URL

    private String siteName;  // 站点名称

    private String capturedAt;  // 采集时间

    private String selectedText;  // 原始选中文本

    private String captureMethod;  // 采集方式

    private List<String> tags = new ArrayList<>();  // 标签列表

    private LocalDateTime createdAt;  // 创建时间

    private String summary;  // 内容摘要

    private String analysis;  // 内容分析

    private List<String> imagePaths = new ArrayList<>();  // 图片相对路径列表

    /**
     * 无参构造函数
     * 自动设置创建时间为当前时间
     */
    public ClipContent() {
        this.createdAt = LocalDateTime.now();
    }

    /**
     * 构造函数
     * @param content 剪藏内容
     * @param type 剪藏类型
     * @param source 剪藏来源
     * @param category 剪藏分类
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

    public List<String> getImagePaths() {
        return imagePaths;
    }

    public void setImagePaths(List<String> imagePaths) {
        this.imagePaths = imagePaths;
    }
}
