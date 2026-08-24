package com.example.clip.model;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * 知识（Knowledge）模型类。
 * <p>
 * 知识是个人知识管理模块的核心实体，用于将剪藏内容、
 * AI 对话、个人思考等整理为结构化知识条目。
 * 支持双向链接（[[wikilink]]）关联其他知识条目。
 * </p>
 *
 * <h3>核心属性</h3>
 * <ul>
 *   <li>{@code content} 为 Markdown 格式的完整内容</li>
 *   <li>{@code sourceClipIds} 关联多个来源剪藏</li>
 *   <li>{@code linkedKnowledgeIds} 双向链接的知识条目 ID</li>
 * </ul>
 */
public class Knowledge {

    /** 知识条目唯一标识 ID */
    private Long id;

    /** 知识标题 */
    private String title;

    /** 一句话摘要，用于列表页展示 */
    private String summary;

    /** 完整内容，支持 Markdown 格式 */
    private String content;

    /** 分类标识 */
    private String category;

    /** 标签列表，支持多标签检索 */
    private List<String> tags = new ArrayList<>();

    /** 来源剪藏 ID 列表（多个来源剪藏） */
    private List<Long> sourceClipIds = new ArrayList<>();

    /** 来源剪藏引用明细（provenance），含来源 URL/站点名/采集时间等溯源元数据 */
    private List<SourceRef> sourceRefs = new ArrayList<>();

    /** 我的思考，Markdown 格式，记录用户对知识内容的个人观点、反思或总结 */
    private String myThoughts;

    /** 双向链接的知识条目 ID 列表 */
    private List<Long> linkedKnowledgeIds = new ArrayList<>();

    /** 创建时间 */
    private LocalDateTime createdAt;

    /** 最后更新时间，每次修改时需手动更新 */
    private LocalDateTime updatedAt;

    /**
     * 无参构造函数。
     * 初始化创建时间和更新时间为当前时间，默认空列表。
     */
    public Knowledge() {
        this.createdAt = LocalDateTime.now();
        this.updatedAt = LocalDateTime.now();
        this.tags = new ArrayList<>();
        this.sourceClipIds = new ArrayList<>();
        this.linkedKnowledgeIds = new ArrayList<>();
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

    public List<Long> getSourceClipIds() { return sourceClipIds; }
    public void setSourceClipIds(List<Long> sourceClipIds) { this.sourceClipIds = sourceClipIds; }

    public List<SourceRef> getSourceRefs() { return sourceRefs; }
    public void setSourceRefs(List<SourceRef> sourceRefs) { this.sourceRefs = sourceRefs; }

    public String getMyThoughts() { return myThoughts; }
    public void setMyThoughts(String myThoughts) { this.myThoughts = myThoughts; }

    public List<Long> getLinkedKnowledgeIds() { return linkedKnowledgeIds; }
    public void setLinkedKnowledgeIds(List<Long> linkedKnowledgeIds) { this.linkedKnowledgeIds = linkedKnowledgeIds; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }

    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}