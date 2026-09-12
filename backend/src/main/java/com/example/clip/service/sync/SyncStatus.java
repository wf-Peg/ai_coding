package com.example.clip.service.sync;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 同步方案的状态快照。
 * <p>
 * 承载一次「同步/备份方案」的当前状态，供前端「同步状态」面板通用渲染。
 * 不同方案（Git、本地目录备份、WebDAV/网盘等）的差异统一收敛到 {@link #fields} 中，
 * 面板主框架不感知具体方案，仅按 {@code type/displayName/configured/ready/lastSyncAt}
 * 渲染通用信息，并按需读取 fields。
 * </p>
 *
 * @see SyncProvider
 */
public class SyncStatus {

    /** 方案唯一标识，如 "git" */
    private String type;
    /** 方案展示名，如 "Git 远程仓库" */
    private String displayName;
    /** 是否已完成方案配置（如 Git 远程仓库是否已填写） */
    private boolean configured;
    /** 目标仓库/目录是否就绪（如父目录下是否存在 .git） */
    private boolean ready;
    /** 最近一次同步时间（本地时间字符串）；无提交或未就绪时为 null */
    private String lastSyncAt;
    /** 方案相关参数（Git 用 remoteUrl/branch/workingDir/dirs），按需扩展 */
    private Map<String, Object> fields = new LinkedHashMap<>();

    public String getType() {
        return type;
    }

    public void setType(String type) {
        this.type = type;
    }

    public String getDisplayName() {
        return displayName;
    }

    public void setDisplayName(String displayName) {
        this.displayName = displayName;
    }

    public boolean isConfigured() {
        return configured;
    }

    public void setConfigured(boolean configured) {
        this.configured = configured;
    }

    public boolean isReady() {
        return ready;
    }

    public void setReady(boolean ready) {
        this.ready = ready;
    }

    public String getLastSyncAt() {
        return lastSyncAt;
    }

    public void setLastSyncAt(String lastSyncAt) {
        this.lastSyncAt = lastSyncAt;
    }

    public Map<String, Object> getFields() {
        return fields;
    }

    public void setFields(Map<String, Object> fields) {
        this.fields = fields == null ? new LinkedHashMap<>() : fields;
    }
}