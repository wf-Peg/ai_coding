package com.example.clip.model;

import com.fasterxml.jackson.annotation.JsonIgnore;
import java.time.LocalDateTime;
import java.time.ZoneId;

/**
 * 待办事项（TodoContent）模型类。
 * <p>
 * 待办事项可以从剪藏内容中生成，也可以独立创建。每条待办事项关联一个来源剪藏
 * （通过 {@code sourceClipId} 回链），支持优先级、截止日期、完成状态等标准
 * 待办管理功能。
 * </p>
 *
 * <h3>字段说明</h3>
 * <ul>
 *   <li>{@code createdAt} 字段使用 {@link JsonIgnore @JsonIgnore} 注解，
 *       序列化时不直接暴露，而是通过 {@code createdAtTimestamp} 时间戳属性
 *       与前端交互。</li>
 *   <li>{@code generateContent()} 方法将待办事项序列化为结构化字符串，
 *       用于 AI 处理或全文检索。</li>
 * </ul>
 *
 * @see ClipContent 待办事项的来源剪藏
 */
public class TodoContent {

    /** 待办事项唯一标识 ID，由持久层自动生成 */
    private Long id;

    /** 待办事项标题，简明描述待完成的任务 */
    private String title;

    /** 优先级：high（高）、medium（中）、low（低） */
    private String priority;

    /** 截止日期，格式为 yyyy-MM-dd 的字符串 */
    private String deadline;

    /** 截止时间（HH:mm:ss），与 deadline 日期组合为完整截止时刻 */
    private String deadlineTime;

    /** 是否启用系统提醒 */
    private boolean reminderEnabled;

    /** 提醒提前分钟数（如 5、10、15、30、60） */
    private int reminderMinutes;

    /** 提醒是否已触发（防止重复通知） */
    private boolean reminderFired;

    /** 完成状态，true 表示已完成 */
    private boolean completed;

    /** 创建时间（服务端内部使用），序列化时通过 {@code createdAtTimestamp} 暴露 */
    @JsonIgnore
    private LocalDateTime createdAt;

    /** 分类标识，与剪藏的分类体系一致 */
    private String category;

    /** 来源剪藏 ID，用于从待办事项回链到原始剪藏内容 */
    private Long sourceClipId;

    /** 来源 URL，记录待办事项的原始网页地址 */
    private String sourceUrl;

    /**
     * 无参构造函数。
     * 自动设置创建时间为当前时间。
     */
    public TodoContent() {
        this.createdAt = LocalDateTime.now();
    }

    /**
     * 带参构造函数，用于快速创建待办事项。
     *
     * @param title     待办事项标题
     * @param priority  优先级（high/medium/low）
     * @param deadline  截止日期（yyyy-MM-dd）
     * @param completed 初始完成状态，通常为 false
     * @param category  分类标识
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

    public String getDeadlineTime() {
        return deadlineTime;
    }

    public void setDeadlineTime(String deadlineTime) {
        this.deadlineTime = deadlineTime;
    }

    public boolean isReminderEnabled() {
        return reminderEnabled;
    }

    public void setReminderEnabled(boolean reminderEnabled) {
        this.reminderEnabled = reminderEnabled;
    }

    public int getReminderMinutes() {
        return reminderMinutes;
    }

    public void setReminderMinutes(int reminderMinutes) {
        this.reminderMinutes = reminderMinutes;
    }

    public boolean isReminderFired() {
        return reminderFired;
    }

    public void setReminderFired(boolean reminderFired) {
        this.reminderFired = reminderFired;
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
     * 获取创建时间的时间戳（毫秒）。
     * <p>
     * 将服务端 {@code LocalDateTime} 转换为毫秒级 Unix 时间戳，
     * 用于前端 JavaScript 直接使用，避免时区转换问题。
     * </p>
     *
     * @return 毫秒级 Unix 时间戳
     */
    public long getCreatedAtTimestamp() {
        return createdAt.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
    }

    /**
     * 通过时间戳（毫秒）设置创建时间。
     * <p>
     * 用于从 JSON 反序列化时，将前端传入的时间戳转换为服务端 {@code LocalDateTime}。
     * </p>
     *
     * @param timestamp 毫秒级 Unix 时间戳
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
     * 生成待办事项的结构化字符串表示。
     * <p>
     * 按照"字段名/字段值"的格式拼接所有字段，用于 AI 处理或全文检索。
     * 字段间用空格分隔，null 值转换为空字符串。
     * </p>
     * <p>
     * 输出示例：{@code title/完成报告 priority/high deadline/2026-06-30 completed/false category/work sourceClipId/123 sourceUrl/https://...}
     * </p>
     *
     * @return 结构化字符串
     */
    public String generateContent() {
        StringBuilder sb = new StringBuilder();
        sb.append("title/").append(title != null ? title : "");
        sb.append(" priority/").append(priority != null ? priority : "");
        sb.append(" deadline/").append(deadline != null ? deadline : "");
        sb.append(" deadlineTime/").append(deadlineTime != null ? deadlineTime : "");
        sb.append(" completed/").append(completed);
        sb.append(" reminderEnabled/").append(reminderEnabled);
        sb.append(" category/").append(category != null ? category : "");
        sb.append(" sourceClipId/").append(sourceClipId != null ? sourceClipId : "");
        sb.append(" sourceUrl/").append(sourceUrl != null ? sourceUrl : "");
        return sb.toString();
    }
}
