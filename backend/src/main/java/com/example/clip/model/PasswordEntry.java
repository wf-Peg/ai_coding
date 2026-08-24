package com.example.clip.model;

import java.util.ArrayList;
import java.util.List;

/**
 * 密码条目模型。
 * <p>
 * 表示密码库中的一条记录，可以是登录账号、银行卡、安全笔记或身份信息。
 * 借鉴 1Password 的分类体系和 Proton Pass 的别名功能。
 * </p>
 */
public class PasswordEntry {

    /** 唯一标识 ID */
    private Long id;

    /** 名称（如 "GitHub 账号"） */
    private String title;

    /** 分类：login / card / note / identity */
    private String category = "login";

    /** 用户名 */
    private String username;

    /** 密码（在密码库内以明文存储，整个库 DES 加密） */
    private String password;

    /** 网址 */
    private String url;

    /** 备注 */
    private String notes;

    /** 别名邮箱（借鉴 Proton Pass） */
    private String alias;

    /** 标签列表 */
    private List<String> tags = new ArrayList<>();

    /** 卡片图标颜色（十六进制） */
    private String iconColor = "#6366f1";

    /** 创建时间戳（毫秒） */
    private Long createdAt;

    /** 更新时间戳（毫秒） */
    private Long updatedAt;

    /** 是否收藏 */
    private boolean favorite;

    public PasswordEntry() {}

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }

    public String getCategory() { return category; }
    public void setCategory(String category) { this.category = category; }

    public String getUsername() { return username; }
    public void setUsername(String username) { this.username = username; }

    public String getPassword() { return password; }
    public void setPassword(String password) { this.password = password; }

    public String getUrl() { return url; }
    public void setUrl(String url) { this.url = url; }

    public String getNotes() { return notes; }
    public void setNotes(String notes) { this.notes = notes; }

    public String getAlias() { return alias; }
    public void setAlias(String alias) { this.alias = alias; }

    public List<String> getTags() { return tags; }
    public void setTags(List<String> tags) { this.tags = tags; }

    public String getIconColor() { return iconColor; }
    public void setIconColor(String iconColor) { this.iconColor = iconColor; }

    public Long getCreatedAt() { return createdAt; }
    public void setCreatedAt(Long createdAt) { this.createdAt = createdAt; }

    public Long getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Long updatedAt) { this.updatedAt = updatedAt; }

    public boolean isFavorite() { return favorite; }
    public void setFavorite(boolean favorite) { this.favorite = favorite; }
}
