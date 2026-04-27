package com.example.clip.dto;

import java.util.List;

/**
 * 收件箱整理请求
 */
public class OrganizeInboxRequest {
    private String mode; // auto | manual
    private String type;
    private String category;
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

