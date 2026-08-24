package com.example.clip.dto;

import java.util.List;

/**
 * 收件箱整理请求（OrganizeInboxRequest）DTO。
 * <p>
 * 用于批量整理收件箱中的剪藏，支持两种模式：
 * </p>
 * <ul>
 *   <li>{@code auto}：自动模式，由 AI 自动分类和打标签</li>
 *   <li>{@code manual}：手动模式，使用请求中指定的 type、category、tags</li>
 * </ul>
 */
public class OrganizeInboxRequest {

    /** 整理模式：auto（AI 自动整理）或 manual（手动指定） */
    private String mode;

    /** 手动模式下指定的剪藏类型 */
    private String type;

    /** 手动模式下指定的分类 */
    private String category;

    /** 手动模式下指定的标签列表 */
    private List<String> tags;

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
}

