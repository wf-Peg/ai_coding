package com.example.clip.model;

/**
 * 内容分发记录（DispatchRecord）。
 * <p>
 * 记录一次"投递"操作：把剪藏内容投递到某个内部场景目标（或执行蒸馏总结）后
 * 生成的结果快照。旁路存储于 {@code clip-storage/dispatch-records/{clipId}.json}，
 * 不进入 ClipContent 存储文件，避免影响既有剪藏数据结构。
 * </p>
 * <p>
 * 字段全部可空安全；{@code targetId} 为 {@code internal:xxx} 场景标识，
 * 蒸馏记录使用 {@code internal:distill}。
 * </p>
 *
 * @see com.example.clip.service.DispatchService
 */
public class DispatchRecord {

    /** 所属剪藏 ID */
    private Long clipId;

    /** 投递目标标识，如 internal:divergent、internal:distill */
    private String targetId;

    /** 投递目标展示名称，如 "发散性总结"、"蒸馏总结" */
    private String targetName;

    /** 投递结果（Markdown 文本） */
    private String result;

    /** 投递时间，格式 yyyy-MM-dd HH:mm:ss */
    private String createdAt;

    public DispatchRecord() {
    }

    public DispatchRecord(Long clipId, String targetId, String targetName, String result, String createdAt) {
        this.clipId = clipId;
        this.targetId = targetId;
        this.targetName = targetName;
        this.result = result;
        this.createdAt = createdAt;
    }

    public Long getClipId() {
        return clipId;
    }

    public void setClipId(Long clipId) {
        this.clipId = clipId;
    }

    public String getTargetId() {
        return targetId;
    }

    public void setTargetId(String targetId) {
        this.targetId = targetId;
    }

    public String getTargetName() {
        return targetName;
    }

    public void setTargetName(String targetName) {
        this.targetName = targetName;
    }

    public String getResult() {
        return result;
    }

    public void setResult(String result) {
        this.result = result;
    }

    public String getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(String createdAt) {
        this.createdAt = createdAt;
    }
}
