package com.example.clip.model;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * 话题模型
 * 用于分享有价值的AI对话、记录AI对话、收藏优质内容
 */
public class Topic {

    private Long id;
    private String title;          // 话题标题
    private String summary;        // 一句话摘要
    private String content;        // 完整的AI对话内容（Markdown格式）
    private String coverImage;     // 封面图路径
    private String category;       // 分类
    private List<String> tags = new ArrayList<>();
    private Long sourceClipId;     // 来源剪藏ID（可选）
    private boolean published;     // 是否发布
    private int likeCount;         // 点赞数
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public Topic() {
        this.createdAt = LocalDateTime.now();
        this.updatedAt = LocalDateTime.now();
        this.published = false;
        this.likeCount = 0;
    }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }

    public String getSummary() { return summary; }
    public void setSummary(String summary) { this.summary = summary; }

    public String getContent() { return content; }
    public void setContent(String content) { this.content = content; }

    public String getCoverImage() { return coverImage; }
    public void setCoverImage(String coverImage) { this.coverImage = coverImage; }

    public String getCategory() { return category; }
    public void setCategory(String category) { this.category = category; }

    public List<String> getTags() { return tags; }
    public void setTags(List<String> tags) { this.tags = tags; }

    public Long getSourceClipId() { return sourceClipId; }
    public void setSourceClipId(Long sourceClipId) { this.sourceClipId = sourceClipId; }

    public boolean isPublished() { return published; }
    public void setPublished(boolean published) { this.published = published; }

    public int getLikeCount() { return likeCount; }
    public void setLikeCount(int likeCount) { this.likeCount = likeCount; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }

    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}