package com.example.clip.model;

import java.util.ArrayList;
import java.util.List;

/**
 * 密码库数据模型。
 * <p>
 * 整个密码库的容器，序列化为 JSON 后用 DES 加密存储到 vault.enc 文件。
 * </p>
 */
public class VaultData {

    /** 密码库版本号 */
    private Long version = 1L;

    /** 密码条目列表 */
    private List<PasswordEntry> entries = new ArrayList<>();

    /** 最后修改时间戳（毫秒） */
    private Long lastModified;

    public VaultData() {}

    public Long getVersion() { return version; }
    public void setVersion(Long version) { this.version = version; }

    public List<PasswordEntry> getEntries() { return entries; }
    public void setEntries(List<PasswordEntry> entries) { this.entries = entries; }

    public Long getLastModified() { return lastModified; }
    public void setLastModified(Long lastModified) { this.lastModified = lastModified; }
}
