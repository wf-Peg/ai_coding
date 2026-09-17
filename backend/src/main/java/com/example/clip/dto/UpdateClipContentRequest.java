package com.example.clip.dto;

/**
 * 剪藏正文写回请求（轻量）。
 * <p>
 * 仅更新正文内容，保留分类、标签、我的思考、AI 分析、工作流状态等，供 OCR 等
 * 「只把识别结果写入原文、不改变整理状态」的场景使用。不经过 organize 语义，
 * 因此不会把剪藏标记为已整理。
 * </p>
 */
public class UpdateClipContentRequest {

    /** 新的正文内容 */
    private String content;

    public String getContent() {
        return content;
    }

    public void setContent(String content) {
        this.content = content;
    }
}