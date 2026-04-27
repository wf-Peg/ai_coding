package com.example.clip.dto;

/**
 * 剪藏转待办请求
 */
public class ClipToTodoRequest {

    private Long clipId;
    private String title;
    private String priority;
    private String deadline;
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
