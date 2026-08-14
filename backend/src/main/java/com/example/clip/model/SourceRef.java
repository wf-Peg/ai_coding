package com.example.clip.model;

/**
 * 来源剪藏引用（provenance）。
 * <p>
 * 记录一条知识是由哪些剪藏衍生而来，并携带剪藏的关键溯源元数据
 * （标题、来源 URL、站点名、采集时间），供知识详情页展示更丰富的「来源」。
 * </p>
 */
public class SourceRef {

    /** 来源剪藏 ID */
    private Long clipId;

    /** 来源剪藏标题 */
    private String title;

    /** 来源剪藏 URL */
    private String sourceUrl;

    /** 来源站点名 */
    private String siteName;

    /** 来源剪藏采集时间 */
    private String capturedAt;

    public SourceRef() {
    }

    public SourceRef(Long clipId, String title, String sourceUrl, String siteName, String capturedAt) {
        this.clipId = clipId;
        this.title = title;
        this.sourceUrl = sourceUrl;
        this.siteName = siteName;
        this.capturedAt = capturedAt;
    }

    public Long getClipId() { return clipId; }
    public void setClipId(Long clipId) { this.clipId = clipId; }

    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }

    public String getSourceUrl() { return sourceUrl; }
    public void setSourceUrl(String sourceUrl) { this.sourceUrl = sourceUrl; }

    public String getSiteName() { return siteName; }
    public void setSiteName(String siteName) { this.siteName = siteName; }

    public String getCapturedAt() { return capturedAt; }
    public void setCapturedAt(String capturedAt) { this.capturedAt = capturedAt; }
}