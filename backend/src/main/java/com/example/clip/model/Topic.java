package com.example.clip.model;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * 话题（Topic）模型类。
 * <p>
 * 话题是 Clip 系统的分享与沉淀模块，用于将 AI 对话、优质内容整理为结构化话题，
 * 支持发布到公共广场、点赞互动等社交功能。每个话题可关联一个来源剪藏。
 * </p>
 *
 * <h3>核心属性</h3>
 * <ul>
 *   <li>{@code content} 为 Markdown 格式的完整 AI 对话内容</li>
 *   <li>{@code published} 控制话题是否对外可见</li>
 *   <li>{@code likeCount} 记录点赞数，用于热门排序</li>
 * </ul>
 *
 * <h3>约束</h3>
 * <ul>
 *   <li>构造函数中 {@code published} 默认为 {@code false}，避免意外发布</li>
 *   <li>{@code likeCount} 默认从 0 开始</li>
 * </ul>
 */
public class Topic {

    /** 话题唯一标识 ID */
    private Long id;

    /** 话题标题，吸引眼球的简短标题 */
    private String title;

    /** 一句话摘要，用于列表页展示 */
    private String summary;

    /** 完整的 AI 对话内容，支持 Markdown 格式 */
    private String content;

    /** 分类标识，与剪藏分类体系一致 */
    private String category;

    /** 标签列表，支持多标签检索 */
    private List<String> tags = new ArrayList<>();

    /** 来源剪藏 ID（可选），用于从话题回链到原始剪藏 */
    private Long sourceClipId;

    /** 是否已发布，true 表示对外可见 */
    private boolean published;

    /** 我的思考，Markdown 格式，记录用户对话题内容的个人观点、反思或总结 */
    private String myThoughts;

    /** 评论列表 */
    private List<Comment> comments = new ArrayList<>();

    /** 点赞数，用于热门排序和社交互动 */
    private int likeCount;

    /** 创建时间 */
    private LocalDateTime createdAt;

    /** 最后更新时间，每次修改时需手动更新 */
    private LocalDateTime updatedAt;

    /**
     * 无参构造函数。
     * 初始化创建时间和更新时间为当前时间，{@code published} 默认为 false，
     * {@code likeCount} 默认为 0。
     */
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

    public String getCategory() { return category; }
    public void setCategory(String category) { this.category = category; }

    public List<String> getTags() { return tags; }
    public void setTags(List<String> tags) { this.tags = tags; }

    public Long getSourceClipId() { return sourceClipId; }
    public void setSourceClipId(Long sourceClipId) { this.sourceClipId = sourceClipId; }

    public boolean isPublished() { return published; }
    public void setPublished(boolean published) { this.published = published; }

    public String getMyThoughts() { return myThoughts; }
    public void setMyThoughts(String myThoughts) { this.myThoughts = myThoughts; }

    public List<Comment> getComments() { return comments; }
    public void setComments(List<Comment> comments) { this.comments = comments; }

    public int getLikeCount() { return likeCount; }
    public void setLikeCount(int likeCount) { this.likeCount = likeCount; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }

    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}