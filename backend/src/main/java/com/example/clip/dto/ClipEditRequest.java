package com.example.clip.dto;

import java.util.List;

/**
 * 编辑器更新剪藏请求。
 *
 * 仅包含允许由文本编辑器修改的字段，避免覆盖创建时间、AI 分析结果、
 * 发散总结和附件路径等服务端管理字段。
 */
public class ClipEditRequest {

    private String content;
    private String title;
    private String type;
    private String category;
    private List<String> tags;
    private String myThoughts;
    private String captureMethod;
    private String selectedText;
    private String contextBefore;
    private String contextAfter;
    private String contentFormat;
    private String sourceFileName;
    private String sourceEncoding;
    private String sourceLineEnding;

    public String getContent() { return content; }
    public void setContent(String content) { this.content = content; }
    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }
    public String getType() { return type; }
    public void setType(String type) { this.type = type; }
    public String getCategory() { return category; }
    public void setCategory(String category) { this.category = category; }
    public List<String> getTags() { return tags; }
    public void setTags(List<String> tags) { this.tags = tags; }
    public String getMyThoughts() { return myThoughts; }
    public void setMyThoughts(String myThoughts) { this.myThoughts = myThoughts; }
    public String getCaptureMethod() { return captureMethod; }
    public void setCaptureMethod(String captureMethod) { this.captureMethod = captureMethod; }
    public String getSelectedText() { return selectedText; }
    public void setSelectedText(String selectedText) { this.selectedText = selectedText; }
    public String getContextBefore() { return contextBefore; }
    public void setContextBefore(String contextBefore) { this.contextBefore = contextBefore; }
    public String getContextAfter() { return contextAfter; }
    public void setContextAfter(String contextAfter) { this.contextAfter = contextAfter; }
    public String getContentFormat() { return contentFormat; }
    public void setContentFormat(String contentFormat) { this.contentFormat = contentFormat; }
    public String getSourceFileName() { return sourceFileName; }
    public void setSourceFileName(String sourceFileName) { this.sourceFileName = sourceFileName; }
    public String getSourceEncoding() { return sourceEncoding; }
    public void setSourceEncoding(String sourceEncoding) { this.sourceEncoding = sourceEncoding; }
    public String getSourceLineEnding() { return sourceLineEnding; }
    public void setSourceLineEnding(String sourceLineEnding) { this.sourceLineEnding = sourceLineEnding; }
}
