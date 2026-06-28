package com.example.clip.model;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * 轻量知识条目（KnowledgeEntry）模型类。
 * <p>
 * 知识条目是 Clip 系统的知识沉淀模块，从剪藏内容中提取精华信息，形成结构化的
 * 知识卡片。每条知识条目包含标题、摘要、洞察（insight）和关键词，便于检索和回顾。
 * </p>
 *
 * <h3>与剪藏的关系</h3>
 * <p>
 * 通过 {@code sourceClipId} 回链到原始剪藏，实现"剪藏 → 知识"的转化链路。
 * 一条剪藏可以生成多条知识条目。
 * </p>
 *
 * <h3>字段区分</h3>
 * <ul>
 *   <li>{@code summary}：对原文的事实性概括</li>
 *   <li>{@code insight}：AI 或个人对内容的深度洞察和观点</li>
 *   <li>{@code keywords}：用于检索的关键词列表，与 {@code tags} 不同，
 *       keywords 更偏向内容特征词</li>
 * </ul>
 */
public class KnowledgeEntry {

    /** 知识条目唯一标识 ID */
    private Long id;

    /** 来源剪藏 ID，用于回链到原始剪藏内容 */
    private Long sourceClipId;

    /** 知识条目标题 */
    private String title;

    /** 内容摘要，事实性概括原文要点 */
    private String summary;

    /** 深度洞察，AI 或个人对内容的观点和思考 */
    private String insight;

    /** 标签列表，用于分类和检索 */
    private List<String> tags = new ArrayList<>();

    /** 分类标识，与剪藏分类体系一致 */
    private String category;

    /** 关键词列表，内容特征词，用于精确检索 */
    private List<String> keywords = new ArrayList<>();

    /** 创建时间 */
    private LocalDateTime createdAt;

    /**
     * 无参构造函数。
     * 自动设置创建时间为当前时间。
     */
    public KnowledgeEntry() {
        this.createdAt = LocalDateTime.now();
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Long getSourceClipId() {
        return sourceClipId;
    }

    public void setSourceClipId(Long sourceClipId) {
        this.sourceClipId = sourceClipId;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getSummary() {
        return summary;
    }

    public void setSummary(String summary) {
        this.summary = summary;
    }

    public String getInsight() {
        return insight;
    }

    public void setInsight(String insight) {
        this.insight = insight;
    }

    public List<String> getTags() {
        return tags;
    }

    public void setTags(List<String> tags) {
        this.tags = tags;
    }

    public String getCategory() {
        return category;
    }

    public void setCategory(String category) {
        this.category = category;
    }

    public List<String> getKeywords() {
        return keywords;
    }

    public void setKeywords(List<String> keywords) {
        this.keywords = keywords;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
    }
}
