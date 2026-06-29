package com.example.clip.dto;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 话题响应（TopicResponse）DTO。
 * <p>
 * 用于话题列表/详情接口的响应，包含话题的完整信息，
 * 包括点赞数、创建时间、更新时间等由服务端管理的字段。
 * </p>
 */
public class TopicResponse {

    /** 话题 ID */
    private Long id;

    /** 话题标题 */
    private String title;

    /** 一句话摘要 */
    private String summary;

    /** 完整内容 */
    private String content;

    /** 分类标识 */
    private String category;

    /** 标签列表 */
    private List<String> tags;

    /** 来源剪藏 ID */
    private Long sourceClipId;

    /** 是否已发布 */
    private boolean published;

    /** 点赞数 */
    private int likeCount;

    /** 创建时间 */
    private LocalDateTime createdAt;

    /** 最后更新时间 */
    private LocalDateTime updatedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }

    public String getSummary() { return summary; }
    public void setSummary(String summary) { this.summary = summary; }

    public String getContent() { return content; }
    public void setContent(String content) { this.content = content; }

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