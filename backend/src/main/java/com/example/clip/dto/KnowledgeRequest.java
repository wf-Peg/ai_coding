package com.example.clip.dto;

import java.util.List;

/**
 * 知识创建/更新请求（KnowledgeRequest）DTO。
 * <p>
 * 用于创建或更新知识条目。字段与 {@link com.example.clip.model.Knowledge Knowledge} 模型
 * 基本对应，但不包含 {@code id}、{@code createdAt}、{@code updatedAt}
 * 等由服务端管理的字段。
 * </p>
 */
public class KnowledgeRequest {

    /** 知识标题 */
    private String title;

    /** 一句话摘要 */
    private String summary;

    /** 完整内容，Markdown 格式 */
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
}