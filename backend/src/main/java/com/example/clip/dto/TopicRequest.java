package com.example.clip.dto;

import java.util.List;

/**
 * 话题创建/更新请求（TopicRequest）DTO。
 * <p>
 * 用于创建或更新话题。字段与 {@link com.example.clip.model.Topic Topic} 模型
 * 基本对应，但不包含 {@code likeCount}、{@code createdAt}、{@code updatedAt}
 * 等由服务端管理的字段。
 * </p>
 */
public class TopicRequest {

    /** 话题标题 */
    private String title;

    /** 一句话摘要 */
    private String summary;

    /** 完整内容，Markdown 格式 */
    private String content;

    /** 分类标识 */
    private String category;

    /** 标签列表 */
    private List<String> tags;

    /** 来源剪藏 ID（可选） */
    private Long sourceClipId;

    /** 是否发布 */
    private boolean published;

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
}