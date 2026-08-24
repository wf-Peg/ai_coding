package com.example.clip.config;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 提示词模板（PromptTemplate）。
 * <p>
 * 提示词库中一条可复用、可收藏、可分类的提示词模板。
 * 支持关联系统 Prompt 槽位（slot），可直接「应用到系统槽位」；
 * 也支持 LangGPT 结构化分段（sections），保存为结构化提示词。
 * </p>
 */
public class PromptTemplate {

    /** 唯一 id */
    private String id;

    /** 模板名称 */
    private String name;

    /** 分类（剪藏分析 / 整理 / 周报 / Wiki / 写作 / 通用…） */
    private String category;

    /** 一句话描述 */
    private String description;

    /** 完整提示词正文 */
    private String content;

    /** 关键词（供搜索） */
    private List<String> tags = new ArrayList<>();

    /** 是否收藏（置顶） */
    private boolean favorite;

    /** 关联的系统槽位 key（如 clip、daily…），可为空（纯自定义模板） */
    private String slot;

    /** 是否为 LangGPT 结构化模板 */
    private boolean langgpt;

    /** LangGPT 分段（Role/Profile/Skills/Rules/Workflow/Initialization…） */
    private Map<String, String> sections = new LinkedHashMap<>();

    /** 是否内置（不可删除） */
    private boolean builtin;

    /** 创建时间 */
    private String createdAt;

    /** 更新时间 */
    private String updatedAt;

    // ==================== Getter / Setter ====================

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

    public String getCategory() { return category; }
    public void setCategory(String category) { this.category = category; }

    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }

    public String getContent() { return content; }
    public void setContent(String content) { this.content = content; }

    public List<String> getTags() { return tags; }
    public void setTags(List<String> tags) { this.tags = tags == null ? new ArrayList<>() : tags; }

    public boolean isFavorite() { return favorite; }
    public void setFavorite(boolean favorite) { this.favorite = favorite; }

    public String getSlot() { return slot; }
    public void setSlot(String slot) { this.slot = slot; }

    public boolean isLanggpt() { return langgpt; }
    public void setLanggpt(boolean langgpt) { this.langgpt = langgpt; }

    public Map<String, String> getSections() { return sections; }
    public void setSections(Map<String, String> sections) { this.sections = sections == null ? new LinkedHashMap<>() : sections; }

    public boolean isBuiltin() { return builtin; }
    public void setBuiltin(boolean builtin) { this.builtin = builtin; }

    public String getCreatedAt() { return createdAt; }
    public void setCreatedAt(String createdAt) { this.createdAt = createdAt; }

    public String getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(String updatedAt) { this.updatedAt = updatedAt; }
}