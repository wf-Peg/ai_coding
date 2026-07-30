package com.example.clip.dto;

import java.util.List;

/**
 * 剪藏请求（ClipRequest）DTO。
 * <p>
 * 用于接收前端发送的剪藏创建/更新请求。包含剪藏内容的所有元数据字段，
 * 以及图片数据、文件数据等附件信息。内部类 {@link ImageData} 用于
 * 封装 Base64 编码的图片数据。
 * </p>
 *
 * <h3>特殊字段说明</h3>
 * <ul>
 *   <li>{@code useAiTags}：控制是否使用 AI 自动生成标签</li>
 *   <li>{@code fileData}：Base64 编码的文件数据，用于文件类型剪藏</li>
 *   <li>{@code imageDataList}：多图片附件列表，每项包含 Base64 数据和文件名</li>
 *   <li>{@code target}：剪藏目标，如 "inbox" 指定存入收件箱</li>
 * </ul>
 */
public class ClipRequest {

    /** 剪藏内容，核心文本数据 */
    private String content;

    /** 剪藏类型：text、image、file 等 */
    private String type;

    /** 剪藏来源：system、browser、manual */
    private String source;

    /** 分类标识 */
    private String category;

    /** 标题 */
    private String title;

    /** 摘要（一句话概括内容，不应为原文；由 agent 或前端传入，覆盖后端 fallback 逻辑） */
    private String summary;

    /** 来源 URL */
    private String sourceUrl;

    /** 站点名称 */
    private String siteName;

    /** 采集时间 */
    private String capturedAt;

    /** 用户选中的原始文本 */
    private String selectedText;

    /** 选中文本上文 */
    private String contextBefore;

    /** 选中文本下文 */
    private String contextAfter;

    /** 采集方式 */
    private String captureMethod;

    /** 剪藏目标，如 "inbox" 表示存入收件箱 */
    private String target;

    /** 工作流状态 */
    private String workflowStatus;

    /** 标签列表 */
    private List<String> tags;

    /** 是否使用 AI 自动生成标签 */
    private Boolean useAiTags;

    /** Base64 编码的文件数据，用于文件类型剪藏 */
    private String fileData;

    /** 原始文件名，用于文件类型剪藏 */
    private String fileName;

    /** 图片附件列表，每项包含 Base64 数据和文件名 */
    private List<ImageData> imageDataList;

    /** 用户自己的思考（可选，可编辑），记录阅读后的主观判断、疑问、联想 */
    private String myThoughts;

    /** 编辑器内容类型：text/json/xml/sql */
    private String contentFormat;

    /** 来源文件名。出于隐私考虑，不存储完整本地路径 */
    private String sourceFileName;

    /** 来源或保存目标字符编码 */
    private String sourceEncoding;

    /** 来源或保存目标换行符：LF/CRLF/CR */
    private String sourceLineEnding;

    public String getContent() {
        return content;
    }

    public void setContent(String content) {
        this.content = content;
    }

    public String getType() {
        return type;
    }

    public void setType(String type) {
        this.type = type;
    }

    public String getSource() {
        return source;
    }

    public void setSource(String source) {
        this.source = source;
    }

    public String getCategory() {
        return category;
    }

    public void setCategory(String category) {
        this.category = category;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getSummary() {
        return summary;
    }

    public void setSummary(String summary) {
        this.summary = summary;
    }

    public String getSourceUrl() {
        return sourceUrl;
    }

    public void setSourceUrl(String sourceUrl) {
        this.sourceUrl = sourceUrl;
    }

    public String getSiteName() {
        return siteName;
    }

    public void setSiteName(String siteName) {
        this.siteName = siteName;
    }

    public String getCapturedAt() {
        return capturedAt;
    }

    public void setCapturedAt(String capturedAt) {
        this.capturedAt = capturedAt;
    }

    public String getSelectedText() {
        return selectedText;
    }

    public void setSelectedText(String selectedText) {
        this.selectedText = selectedText;
    }

    public String getCaptureMethod() {
        return captureMethod;
    }

    public void setCaptureMethod(String captureMethod) {
        this.captureMethod = captureMethod;
    }

    public String getContextBefore() {
        return contextBefore;
    }

    public void setContextBefore(String contextBefore) {
        this.contextBefore = contextBefore;
    }

    public String getContextAfter() {
        return contextAfter;
    }

    public void setContextAfter(String contextAfter) {
        this.contextAfter = contextAfter;
    }

    public String getTarget() {
        return target;
    }

    public void setTarget(String target) {
        this.target = target;
    }

    public String getWorkflowStatus() {
        return workflowStatus;
    }

    public void setWorkflowStatus(String workflowStatus) {
        this.workflowStatus = workflowStatus;
    }

    public List<String> getTags() {
        return tags;
    }

    public void setTags(List<String> tags) {
        this.tags = tags;
    }

    public Boolean getUseAiTags() {
        return useAiTags;
    }

    public void setUseAiTags(Boolean useAiTags) {
        this.useAiTags = useAiTags;
    }

    public String getFileData() {
        return fileData;
    }

    public void setFileData(String fileData) {
        this.fileData = fileData;
    }

    public String getFileName() {
        return fileName;
    }

    public void setFileName(String fileName) {
        this.fileName = fileName;
    }

    public List<ImageData> getImageDataList() {
        return imageDataList;
    }

    public void setImageDataList(List<ImageData> imageDataList) {
        this.imageDataList = imageDataList;
    }

    public String getMyThoughts() {
        return myThoughts;
    }

    public void setMyThoughts(String myThoughts) {
        this.myThoughts = myThoughts;
    }

    public String getContentFormat() {
        return contentFormat;
    }

    public void setContentFormat(String contentFormat) {
        this.contentFormat = contentFormat;
    }

    public String getSourceFileName() {
        return sourceFileName;
    }

    public void setSourceFileName(String sourceFileName) {
        this.sourceFileName = sourceFileName;
    }

    public String getSourceEncoding() {
        return sourceEncoding;
    }

    public void setSourceEncoding(String sourceEncoding) {
        this.sourceEncoding = sourceEncoding;
    }

    public String getSourceLineEnding() {
        return sourceLineEnding;
    }

    public void setSourceLineEnding(String sourceLineEnding) {
        this.sourceLineEnding = sourceLineEnding;
    }

    /**
     * 图片数据内部类。
     * <p>
     * 封装单张图片的 Base64 编码数据及其原始文件名，
     * 用于剪藏请求中附带多张图片的场景。
     * </p>
     */
    public static class ImageData {

        /** 图片的 Base64 编码字符串 */
        private String base64Data;

        /** 原始文件名，用于保留扩展名信息 */
        private String fileName;

        public String getBase64Data() {
            return base64Data;
        }

        public void setBase64Data(String base64Data) {
            this.base64Data = base64Data;
        }

        public String getFileName() {
            return fileName;
        }

        public void setFileName(String fileName) {
            this.fileName = fileName;
        }
    }
}
