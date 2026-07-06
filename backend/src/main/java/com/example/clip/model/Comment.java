package com.example.clip.model;

import java.time.LocalDateTime;

/**
 * 评论模型类。
 * <p>
 * 评论属于某个话题，存储在话题 JSON 的 {@code comments} 数组中。
 * 评论无需审核，直接发布可见。
 * </p>
 */
public class Comment {

    /** 评论唯一标识 ID */
    private Long id;

    /** 所属话题 ID */
    private Long topicId;

    /** 评论者昵称（可选，空值显示"匿名"） */
    private String author;

    /** 评论内容（纯文本） */
    private String content;

    /** 创建时间 */
    private LocalDateTime createdAt;

    public Comment() {
        this.createdAt = LocalDateTime.now();
    }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public Long getTopicId() { return topicId; }
    public void setTopicId(Long topicId) { this.topicId = topicId; }

    public String getAuthor() { return author; }
    public void setAuthor(String author) { this.author = author; }

    public String getContent() { return content; }
    public void setContent(String content) { this.content = content; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}