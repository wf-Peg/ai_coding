package com.example.clip.dto;

/**
 * 标签请求（TagRequest）DTO。
 * <p>
 * 用于 AI 标签生成接口的请求，携带需要分析的内容文本。
 * AI 服务会根据内容自动提取相关标签。
 * </p>
 */
public class TagRequest {

    /** 需要提取标签的内容文本 */
    private String content;

    public String getContent() {
        return content;
    }

    public void setContent(String content) {
        this.content = content;
    }
}
