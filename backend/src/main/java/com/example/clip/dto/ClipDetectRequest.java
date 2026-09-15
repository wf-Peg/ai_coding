package com.example.clip.dto;

/**
 * 智能剪藏结构化检测请求（ClipDetectRequest）DTO。
 * <p>
 * 写作区「智能剪藏」提交待检测文本，后端做「正则优先 + LLM 兜底」的
 * 结构化自动识别并返回 MD 视图预览，仅检测不落库。
 * </p>
 */
public class ClipDetectRequest {

    /** 待检测的文本内容 */
    private String content;

    public String getContent() {
        return content;
    }

    public void setContent(String content) {
        this.content = content;
    }
}