package com.example.clip.model;

import com.fasterxml.jackson.annotation.JsonIgnore;
import java.time.LocalDateTime;
import java.time.ZoneId;

/**
 * 待办事项模型类
 */
public class TodoContent {

    private Long id;  // 待办事项ID

    private String title;  // 待办事项标题

    private String priority;  // 优先级：high/medium/low

    private String deadline;  // 截止日期

    private boolean completed;  // 完成状态

    @JsonIgnore
    private LocalDateTime createdAt;  // 创建时间（内部使用）

    private String category;  // 分类

    private Long sourceClipId;  // 回链来源剪藏ID

    private String sourceUrl;  // 来源URL

    /**
     * 无参构造函数
     * 自动设置创建时间为当前时间
     */
    public TodoContent() {
        this.createdAt = LocalDateTime.now();
    }

    /**
     * 构造函数
     * @param title 待办事项标题
     * @param priority 优先级
     * @param deadline 截止日期
     * @param completed 完成状态
     * @param category 分类
     */
    public TodoContent(String title, String priority, String deadline, boolean completed, String category) {
        this.title = title;
        this.priority = priority;
        this.deadline = deadline;
        this.completed = completed;
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

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getPriority() {
        return priority;
    }

    public void setPriority(String priority) {
        this.priority = priority;
    }

    public String getDeadline() {
        return deadline;
    }

    public void setDeadline(String deadline) {
        this.deadline = deadline;
    }

    public boolean isCompleted() {
        return completed;
    }

    public void setCompleted(boolean completed) {
        this.completed = completed;
    }

    @JsonIgnore
    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    @JsonIgnore
    public void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
    }

    /**
     * 获取创建时间的时间戳（毫秒）
     * 用于前端显示
     * @return 时间戳
     */
    public long getCreatedAtTimestamp() {
        return createdAt.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
    }

    /**
     * 设置创建时间的时间戳（毫秒）
     * 用于从JSON反序列化
     * @param timestamp 时间戳
     */
    public void setCreatedAtTimestamp(long timestamp) {
        this.createdAt = LocalDateTime.ofInstant(
                java.time.Instant.ofEpochMilli(timestamp),
                ZoneId.systemDefault()
        );
    }

    public String getCategory() {
        return category;
    }

    public void setCategory(String category) {
        this.category = category;
    }

    public Long getSourceClipId() {
        return sourceClipId;
    }

    public void setSourceClipId(Long sourceClipId) {
        this.sourceClipId = sourceClipId;
    }

    public String getSourceUrl() {
        return sourceUrl;
    }

    public void setSourceUrl(String sourceUrl) {
        this.sourceUrl = sourceUrl;
    }

    /**
     * 生成待办事项的正文和摘要
     * 按照字段名/字段值的方式拼接
     * @return 拼接后的字符串
     */
    public String generateContent() {
        StringBuilder sb = new StringBuilder();
        sb.append("title/").append(title != null ? title : "");
        sb.append(" priority/").append(priority != null ? priority : "");
        sb.append(" deadline/").append(deadline != null ? deadline : "");
        sb.append(" completed/").append(completed);
        sb.append(" category/").append(category != null ? category : "");
        sb.append(" sourceClipId/").append(sourceClipId != null ? sourceClipId : "");
        sb.append(" sourceUrl/").append(sourceUrl != null ? sourceUrl : "");
        return sb.toString();
    }
}
