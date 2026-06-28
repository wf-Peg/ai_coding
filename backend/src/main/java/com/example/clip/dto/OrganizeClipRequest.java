package com.example.clip.dto;

import java.util.List;

/**
 * 单条剪藏整理请求（OrganizeClipRequest）DTO。
 * <p>
 * 用于整理单条剪藏（非收件箱批量整理），支持 AI 自动模式或手动模式，
 * 并且可以携带 AI 生成的摘要和分析结果。
 * </p>
 *
 * <h3>与 {@link OrganizeInboxRequest} 的区别</h3>
 * <p>
 * 本 DTO 额外包含 {@code content}、{@code summary}、{@code analysis} 字段，
 * 用于携带 AI 对单条剪藏的处理结果，而收件箱整理请求侧重于状态变更。
 * </p>
 */
public class OrganizeClipRequest {

    /** 整理模式：auto 或 manual */
    private String mode;

    /** 剪藏类型 */
    private String type;

    /** 分类标识 */
    private String category;

    /** 标签列表 */
    private List<String> tags;

    /** 剪藏内容（可能被 AI 处理后的内容） */
    private String content;

    /** AI 生成的摘要 */
    private String summary;

    /** AI 生成的分析结果 */
    private String analysis;

    public String getMode() {
        return mode;
    }

    public void setMode(String mode) {
        this.mode = mode;
    }

    public String getType() {
        return type;
    }

    public void setType(String type) {
        this.type = type;
    }

    public String getCategory() {
        return category;
    }

    public void setCategory(String category) {
        this.category = category;
    }

    public List<String> getTags() {
        return tags;
    }

    public void setTags(List<String> tags) {
        this.tags = tags;
    }

    public String getContent() {
        return content;
    }

    public void setContent(String content) {
        this.content = content;
    }

    public String getSummary() {
        return summary;
    }

    public void setSummary(String summary) {
        this.summary = summary;
    }

    public String getAnalysis() {
        return analysis;
    }

    public void setAnalysis(String analysis) {
        this.analysis = analysis;
    }
}
