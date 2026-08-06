package com.example.clip.dto;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 知识响应（KnowledgeResponse）DTO。
 * <p>
 * 用于知识列表/详情接口的响应，包含知识条目的完整信息，
 * 包括创建时间、更新时间等由服务端管理的字段，
 * 以及计算字段 sourceCount 和 linkedCount。
 * </p>
 */
public class KnowledgeResponse {

    /** 知识条目 ID */
    private Long id;

    /** 知识标题 */
    private String title;

    /** 一句话摘要 */
    private String summary;

    /** 完整内容 */
    private String content;

    /** 分类标识 */
    private String category;

    /** 标签列表 */
    private List<String> tags;

    /** 来源剪藏 ID 列表 */
    private List<Long> sourceClipIds;

    /** 我的思考 */
    private String myThoughts;

    /** 双向链接的知识条目 ID 列表 */
    private List<Long> linkedKnowledgeIds;

    /** 来源剪藏数量（计算字段） */
    private int sourceCount;

    /** 链接知识条目数量（计算字段） */
    private int linkedCount;

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

    public List<Long> getSourceClipIds() { return sourceClipIds; }
    public void setSourceClipIds(List<Long> sourceClipIds) { this.sourceClipIds = sourceClipIds; }

    public String getMyThoughts() { return myThoughts; }
    public void setMyThoughts(String myThoughts) { this.myThoughts = myThoughts; }

    public List<Long> getLinkedKnowledgeIds() { return linkedKnowledgeIds; }
    public void setLinkedKnowledgeIds(List<Long> linkedKnowledgeIds) { this.linkedKnowledgeIds = linkedKnowledgeIds; }

    public int getSourceCount() { return sourceCount; }
    public void setSourceCount(int sourceCount) { this.sourceCount = sourceCount; }

    public int getLinkedCount() { return linkedCount; }
    public void setLinkedCount(int linkedCount) { this.linkedCount = linkedCount; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }

    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}