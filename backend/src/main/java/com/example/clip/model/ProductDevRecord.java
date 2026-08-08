package com.example.clip.model;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 产品开发工作区记录
 * <p>
 * 用于归档产品开发全流程数据，包括需求分析、设计、实现、测试、完成等阶段。
 * 数据来源包括：agent 自动归档、历史需求迁移、手动创建。
 * </p>
 */
public class ProductDevRecord {
    private String id;
    private String type;        // "requirement", "knowledge", "todo", "archive"
    private String title;
    private String description;
    private String phase;       // "analysis", "design", "implementation", "testing", "completed"
    private String status;      // "todo", "in-progress", "done", "archived"
    private String source;      // "archive", "migrate", "manual"
    private String sourcePath;  // 原始文件路径（迁移时记录）
    private List<String> tags;
    private String relatedId;   // 关联的需求ID
    private String content;     // Markdown 内容
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    // 全参构造函数
    public ProductDevRecord(String id, String type, String title, String description,
                           String phase, String status, String source, String sourcePath,
                           List<String> tags, String relatedId, String content,
                           LocalDateTime createdAt, LocalDateTime updatedAt) {
        this.id = id;
        this.type = type;
        this.title = title;
        this.description = description;
        this.phase = phase;
        this.status = status;
        this.source = source;
        this.sourcePath = sourcePath;
        this.tags = tags;
        this.relatedId = relatedId;
        this.content = content;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }

    // Getters
    public String getId() { return id; }
    public String getType() { return type; }
    public String getTitle() { return title; }
    public String getDescription() { return description; }
    public String getPhase() { return phase; }
    public String getStatus() { return status; }
    public String getSource() { return source; }
    public String getSourcePath() { return sourcePath; }
    public List<String> getTags() { return tags; }
    public String getRelatedId() { return relatedId; }
    public String getContent() { return content; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }

    // Setters
    public void setId(String id) { this.id = id; }
    public void setType(String type) { this.type = type; }
    public void setTitle(String title) { this.title = title; }
    public void setDescription(String description) { this.description = description; }
    public void setPhase(String phase) { this.phase = phase; }
    public void setStatus(String status) { this.status = status; }
    public void setSource(String source) { this.source = source; }
    public void setSourcePath(String sourcePath) { this.sourcePath = sourcePath; }
    public void setTags(List<String> tags) { this.tags = tags; }
    public void setRelatedId(String relatedId) { this.relatedId = relatedId; }
    public void setContent(String content) { this.content = content; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}