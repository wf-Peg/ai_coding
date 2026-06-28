package com.example.clip.dto;

/**
 * 剪藏转待办请求（ClipToTodoRequest）DTO。
 * <p>
 * 用于将指定剪藏转换为待办事项的请求。必须提供源剪藏 ID（{@code clipId}），
 * 可选的待办属性（标题、优先级、截止日期、分类）用于覆盖默认值。
 * </p>
 */
public class ClipToTodoRequest {

    /** 源剪藏 ID，必填 */
    private Long clipId;

    /** 待办事项标题，不填则使用剪藏标题 */
    private String title;

    /** 优先级：high、medium、low */
    private String priority;

    /** 截止日期 */
    private String deadline;

    /** 分类标识 */
    private String category;

    public Long getClipId() {
        return clipId;
    }

    public void setClipId(Long clipId) {
        this.clipId = clipId;
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

    public String getCategory() {
        return category;
    }

    public void setCategory(String category) {
        this.category = category;
    }
}
