package com.example.clip.service;

import com.example.clip.model.PasswordEntry;
import com.example.clip.model.VaultData;
import com.example.clip.util.DesEncryptionUtil;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;
import java.util.stream.Collectors;

/**
 * 密码库业务服务。
 * <p>
 * 负责密码库的初始化、解锁、锁定、CRUD 操作、搜索和安全审计。
 * 密码库文件 (vault.enc) 使用 DES 加密，DES Key 仅在解锁时传入，
 * 不持久化存储。解锁后 VaultData 缓存在内存中，锁定时清除。
 * </p>
 */
@Service
public class PasswordVaultService {

    private static final Logger log = LoggerFactory.getLogger(PasswordVaultService.class);

    @Value("${clip.storage.path:./clip-storage}")
    private String storagePath;

    private final ObjectMapper objectMapper;

    /** 解锁后缓存在内存中的密码库数据 */
    private VaultData cachedVault;

    /** 当前会话的 DES Key（解锁后保存，用于后续写入操作） */
    private String sessionDesKey;

    /** 解锁状态 */
    private volatile boolean unlocked = false;

    /** ID 生成器 */
    private final AtomicLong idGenerator = new AtomicLong(1);

    public PasswordVaultService() {
        this.objectMapper = new ObjectMapper();
        this.objectMapper.enable(SerializationFeature.INDENT_OUTPUT);
    }

    /**
     * 获取密码库存储目录
     */
    private Path getVaultDir() {
        return Paths.get(storagePath, "vault");
    }

    /**
     * 获取密码库文件路径
     */
    private Path getVaultFile() {
        return getVaultDir().resolve("vault.enc");
    }

    /**
     * 获取元数据文件路径
     */
    private Path getMetaFile() {
        return getVaultDir().resolve("vault-meta.json");
    }

    /**
     * 生成随机 DES Key
     */
    public String generateKey() {
        return DesEncryptionUtil.generateKey();
    }

    /**
     * 查询密码库状态
     */
    public Map<String, Object> getStatus() {
        Map<String, Object> status = new HashMap<>();
        status.put("exists", Files.exists(getVaultFile()));
        status.put("unlocked", unlocked);
        status.put("entryCount", cachedVault != null ? cachedVault.getEntries().size() : 0);

        // 读取元数据
        if (Files.exists(getMetaFile())) {
            try {
                String metaContent = Files.readString(getMetaFile());
                @SuppressWarnings("unchecked")
                Map<String, Object> meta = objectMapper.readValue(metaContent, Map.class);
                status.put("meta", meta);
            } catch (Exception e) {
                log.warn("Failed to read vault meta: {}", e.getMessage());
            }
        }
        return status;
    }

    /**
     * 初始化密码库
     */
    public Map<String, Object> init(String desKey) {
        try {
            Path vaultDir = getVaultDir();
            if (!Files.exists(vaultDir)) {
                Files.createDirectories(vaultDir);
            }

            // 创建空密码库
            VaultData vault = new VaultData();
            vault.setVersion(1L);
            vault.setLastModified(System.currentTimeMillis());
            vault.setEntries(new ArrayList<>());

            // DES 加密并写入
            String json = objectMapper.writeValueAsString(vault);
            String encrypted = DesEncryptionUtil.encrypt(json, desKey);
            Files.writeString(getVaultFile(), encrypted);

            // 写入元数据
            Map<String, Object> meta = new HashMap<>();
            meta.put("version", 1);
            meta.put("algorithm", "DES/ECB/PKCS5Padding");
            meta.put("keyCheckHash", DesEncryptionUtil.getKeyCheckHash(desKey));
            meta.put("createdAt", System.currentTimeMillis());
            meta.put("entryCount", 0);
            Files.writeString(getMetaFile(), objectMapper.writeValueAsString(meta));

            // 缓存到内存
            cachedVault = vault;
            sessionDesKey = desKey;
            unlocked = true;
            idGenerator.set(1);

            log.info("Vault initialized successfully at {}", getVaultFile());

            Map<String, Object> result = new HashMap<>();
            result.put("success", true);
            result.put("entries", vault.getEntries());
            return result;
        } catch (Exception e) {
            log.error("Failed to init vault", e);
            throw new RuntimeException("密码库初始化失败: " + e.getMessage(), e);
        }
    }

    /**
     * 解锁密码库
     */
    public Map<String, Object> unlock(String desKey) {
        try {
            Path vaultFile = getVaultFile();
            if (!Files.exists(vaultFile)) {
                throw new RuntimeException("密码库不存在，请先初始化");
            }

            // 验证 Key
            Path metaFile = getMetaFile();
            if (Files.exists(metaFile)) {
                String metaContent = Files.readString(metaFile);
                @SuppressWarnings("unchecked")
                Map<String, Object> meta = objectMapper.readValue(metaContent, Map.class);
                String storedHash = (String) meta.get("keyCheckHash");
                if (storedHash != null) {
                    String inputHash = DesEncryptionUtil.getKeyCheckHash(desKey);
                    if (!storedHash.equals(inputHash)) {
                        throw new RuntimeException("DES Key 不正确");
                    }
                }
            }

            // DES 解密
            String encrypted = Files.readString(vaultFile);
            String json = DesEncryptionUtil.decrypt(encrypted, desKey);
            VaultData vault = objectMapper.readValue(json, VaultData.class);

            // 缓存
            cachedVault = vault;
            sessionDesKey = desKey;
            unlocked = true;

            // 初始化 ID 生成器
            long maxId = vault.getEntries().stream()
                    .mapToLong(PasswordEntry::getId)
                    .max().orElse(0);
            idGenerator.set(maxId + 1);

            log.info("Vault unlocked successfully, {} entries", vault.getEntries().size());

            Map<String, Object> result = new HashMap<>();
            result.put("success", true);
            result.put("entries", vault.getEntries());
            return result;
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            log.error("Failed to unlock vault", e);
            throw new RuntimeException("解锁失败: " + e.getMessage(), e);
        }
    }

    /**
     * 锁定密码库
     */
    public Map<String, Object> lock() {
        cachedVault = null;
        sessionDesKey = null;
        unlocked = false;

        log.info("Vault locked");

        Map<String, Object> result = new HashMap<>();
        result.put("success", true);
        return result;
    }

    /**
     * 确保已解锁
     */
    private void ensureUnlocked() {
        if (!unlocked || cachedVault == null) {
            throw new RuntimeException("密码库未解锁，请先输入 DES Key");
        }
    }

    /**
     * 保存密码库到文件
     */
    private void saveVault() {
        try {
            cachedVault.setLastModified(System.currentTimeMillis());
            String json = objectMapper.writeValueAsString(cachedVault);
            String encrypted = DesEncryptionUtil.encrypt(json, sessionDesKey);
            Files.writeString(getVaultFile(), encrypted);

            // 更新元数据中的条目数
            if (Files.exists(getMetaFile())) {
                String metaContent = Files.readString(getMetaFile());
                @SuppressWarnings("unchecked")
                Map<String, Object> meta = objectMapper.readValue(metaContent, Map.class);
                meta.put("entryCount", cachedVault.getEntries().size());
                meta.put("lastModified", cachedVault.getLastModified());
                Files.writeString(getMetaFile(), objectMapper.writeValueAsString(meta));
            }
        } catch (Exception e) {
            log.error("Failed to save vault", e);
            throw new RuntimeException("保存密码库失败: " + e.getMessage(), e);
        }
    }

    /**
     * 新增密码条目
     */
    public PasswordEntry addEntry(PasswordEntry entry) {
        ensureUnlocked();
        entry.setId(idGenerator.getAndIncrement());
        long now = System.currentTimeMillis();
        entry.setCreatedAt(now);
        entry.setUpdatedAt(now);
        cachedVault.getEntries().add(entry);
        saveVault();
        log.info("Added vault entry: id={}, title={}", entry.getId(), entry.getTitle());
        return entry;
    }

    /**
     * 更新密码条目
     */
    public PasswordEntry updateEntry(Long id, PasswordEntry entry) {
        ensureUnlocked();
        for (int i = 0; i < cachedVault.getEntries().size(); i++) {
            PasswordEntry existing = cachedVault.getEntries().get(i);
            if (existing.getId().equals(id)) {
                entry.setId(id);
                entry.setCreatedAt(existing.getCreatedAt());
                entry.setUpdatedAt(System.currentTimeMillis());
                cachedVault.getEntries().set(i, entry);
                saveVault();
                log.info("Updated vault entry: id={}", id);
                return entry;
            }
        }
        throw new RuntimeException("密码条目不存在: id=" + id);
    }

    /**
     * 删除密码条目
     */
    public Map<String, Object> deleteEntry(Long id) {
        ensureUnlocked();
        boolean removed = cachedVault.getEntries().removeIf(e -> e.getId().equals(id));
        if (!removed) {
            throw new RuntimeException("密码条目不存在: id=" + id);
        }
        saveVault();
        log.info("Deleted vault entry: id={}", id);
        Map<String, Object> result = new HashMap<>();
        result.put("success", true);
        return result;
    }

    /**
     * 搜索密码条目
     */
    public List<PasswordEntry> search(String keyword) {
        ensureUnlocked();
        if (keyword == null || keyword.trim().isEmpty()) {
            return cachedVault.getEntries();
        }
        String lower = keyword.toLowerCase();
        return cachedVault.getEntries().stream()
                .filter(e -> (e.getTitle() != null && e.getTitle().toLowerCase().contains(lower)) ||
                             (e.getUsername() != null && e.getUsername().toLowerCase().contains(lower)) ||
                             (e.getUrl() != null && e.getUrl().toLowerCase().contains(lower)) ||
                             (e.getNotes() != null && e.getNotes().toLowerCase().contains(lower)) ||
                             (e.getTags() != null && e.getTags().stream().anyMatch(t -> t.toLowerCase().contains(lower))))
                .collect(Collectors.toList());
    }

    /**
     * 安全审计
     */
    public Map<String, Object> audit() {
        ensureUnlocked();
        Map<String, Object> audit = new HashMap<>();

        List<PasswordEntry> entries = cachedVault.getEntries();
        int strong = 0, medium = 0, weak = 0;
        Map<String, List<String>> duplicateMap = new HashMap<>();
        List<Map<String, Object>> duplicates = new ArrayList<>();
        List<Map<String, Object>> oldPasswords = new ArrayList<>();
        long now = System.currentTimeMillis();
        long sixMonthsMs = 180L * 24 * 60 * 60 * 1000;

        for (PasswordEntry entry : entries) {
            if (entry.getPassword() == null || entry.getPassword().isEmpty()) continue;

            // 密码强度
            int strength = checkPasswordStrength(entry.getPassword());
            if (strength >= 4) strong++;
            else if (strength >= 2) medium++;
            else {
                weak++;
            }

            // 重复密码
            duplicateMap.computeIfAbsent(entry.getPassword(), k -> new ArrayList<>())
                    .add(entry.getTitle() != null ? entry.getTitle() : "未命名");
        }

        // 找出重复密码
        for (Map.Entry<String, List<String>> dup : duplicateMap.entrySet()) {
            if (dup.getValue().size() > 1) {
                Map<String, Object> dupInfo = new HashMap<>();
                dupInfo.put("passwords", dup.getValue());
                dupInfo.put("count", dup.getValue().size());
                duplicates.add(dupInfo);
            }
        }

        // 过期密码
        for (PasswordEntry entry : entries) {
            if (entry.getUpdatedAt() != null && (now - entry.getUpdatedAt()) > sixMonthsMs) {
                Map<String, Object> oldInfo = new HashMap<>();
                oldInfo.put("id", entry.getId());
                oldInfo.put("title", entry.getTitle());
                long daysOld = (now - entry.getUpdatedAt()) / (24 * 60 * 60 * 1000);
                oldInfo.put("daysOld", daysOld);
                oldPasswords.add(oldInfo);
            }
        }

        audit.put("total", entries.size());
        audit.put("strong", strong);
        audit.put("medium", medium);
        audit.put("weak", weak);
        audit.put("duplicates", duplicates);
        audit.put("oldPasswords", oldPasswords);
        return audit;
    }

    /**
     * 密码强度检测
     * <p>
     * 返回 0-5 的分数：
     * 0: 极弱（<6 字符）
     * 1: 弱（仅一种字符类型）
     * 2: 中等（两种字符类型）
     * 3: 较强（三种字符类型）
     * 4: 强（四种字符类型 + 12 字符以上）
     * 5: 很强（四种字符类型 + 16 字符以上）
     * </p>
     */
    private int checkPasswordStrength(String password) {
        int score = 0;
        if (password.length() >= 8) score++;
        if (password.length() >= 12) score++;
        if (password.length() >= 16) score++;
        if (password.matches(".*[a-z].*")) score++;
        if (password.matches(".*[A-Z].*")) score++;
        if (password.matches(".*[0-9].*")) score++;
        if (password.matches(".*[^a-zA-Z0-9].*")) score++;
        return Math.min(score, 5);
    }

    /**
     * 批量导入密码条目（去重）。
     * <p>
     * 唯一键为 url + username（url 归一化：去除末尾斜杠、查询参数、hash）。
     * 已存在的相同唯一键条目跳过，同批次内重复只保留第一条。
     * 导入的条目统一标记 tags=[imported, chrome]，category=login。
     * 单次最多 2000 条，超出拒绝。
     * </p>
     *
     * @param entries 待导入的条目列表
     * @return 导入结果统计 {imported, skipped, duplicates, errors, details}
     */
    public Map<String, Object> importEntries(List<PasswordEntry> entries) {
        ensureUnlocked();

        Map<String, Object> result = new HashMap<>();
        if (entries == null || entries.isEmpty()) {
            result.put("imported", 0);
            result.put("skipped", 0);
            result.put("duplicates", 0);
            result.put("errors", 0);
            result.put("details", new ArrayList<>());
            return result;
        }

        if (entries.size() > 2000) {
            throw new RuntimeException("单次导入不能超过 2000 条，当前: " + entries.size());
        }

        // 构建现有条目的唯一键集合
        java.util.Set<String> existingKeys = cachedVault.getEntries().stream()
                .map(PasswordVaultService::buildDedupeKey)
                .collect(Collectors.toSet());

        int imported = 0, skipped = 0, duplicates = 0, errors = 0;
        long now = System.currentTimeMillis();
        java.util.Set<String> batchKeys = new java.util.HashSet<>();
        List<Map<String, Object>> details = new ArrayList<>();

        for (PasswordEntry entry : entries) {
            Map<String, Object> detail = new HashMap<>();
            detail.put("title", entry.getTitle());
            detail.put("url", entry.getUrl());
            detail.put("username", entry.getUsername());

            // 数据校验
            if (entry.getPassword() == null || entry.getPassword().isEmpty()) {
                errors++;
                detail.put("status", "error");
                detail.put("reason", "密码为空");
                details.add(detail);
                continue;
            }

            String key = buildDedupeKey(entry);

            // 跨批次去重
            if (existingKeys.contains(key)) {
                skipped++;
                detail.put("status", "skipped");
                detail.put("reason", "已存在相同 url+username");
                details.add(detail);
                continue;
            }

            // 同批次去重
            if (!batchKeys.add(key)) {
                duplicates++;
                detail.put("status", "duplicate");
                detail.put("reason", "同批次内重复");
                details.add(detail);
                continue;
            }

            // 字段长度限制
            if (entry.getTitle() != null && entry.getTitle().length() > 500) {
                entry.setTitle(entry.getTitle().substring(0, 500));
            }
            if (entry.getUrl() != null && entry.getUrl().length() > 500) {
                entry.setUrl(entry.getUrl().substring(0, 500));
            }
            if (entry.getUsername() != null && entry.getUsername().length() > 500) {
                entry.setUsername(entry.getUsername().substring(0, 500));
            }

            // 规范化字段
            entry.setId(idGenerator.getAndIncrement());
            entry.setCategory("login");
            List<String> tags = entry.getTags();
            if (tags == null) {
                tags = new ArrayList<>();
            }
            if (!tags.contains("imported")) tags.add("imported");
            if (!tags.contains("chrome")) tags.add("chrome");
            entry.setTags(tags);
            if (entry.getIconColor() == null || entry.getIconColor().isEmpty()) {
                entry.setIconColor("#6366f1");
            }
            entry.setCreatedAt(now);
            entry.setUpdatedAt(now);

            cachedVault.getEntries().add(entry);
            existingKeys.add(key);
            imported++;

            detail.put("status", "imported");
            details.add(detail);
        }

        // 一次性加密落盘
        if (imported > 0) {
            saveVault();
        }

        log.info("Imported {} entries (skipped={}, duplicates={}, errors={})",
                imported, skipped, duplicates, errors);

        result.put("imported", imported);
        result.put("skipped", skipped);
        result.put("duplicates", duplicates);
        result.put("errors", errors);
        result.put("details", details);
        return result;
    }

    /**
     * 构建去重唯一键：url(归一化) + username(小写)。
     * url 归一化：去除末尾斜杠、查询参数、hash，保留 protocol + host + path。
     */
    private static String buildDedupeKey(PasswordEntry entry) {
        String url = entry.getUrl() == null ? "" : entry.getUrl().trim();
        // 去除 query 和 hash
        int q = url.indexOf('?');
        if (q >= 0) url = url.substring(0, q);
        int h = url.indexOf('#');
        if (h >= 0) url = url.substring(0, h);
        // 去除末尾斜杠
        while (url.endsWith("/")) {
            url = url.substring(0, url.length() - 1);
        }
        String username = entry.getUsername() == null ? "" : entry.getUsername().trim().toLowerCase();
        return url + "|" + username;
    }

    /**
     * 生成随机密码
     */
    public String generatePassword(int length, boolean useUpper, boolean useLower,
                                   boolean useDigits, boolean useSpecial, boolean excludeAmbiguous) {
        StringBuilder charPool = new StringBuilder();
        String ambiguous = "0O1lI|`'\"";

        if (useLower) {
            for (char c = 'a'; c <= 'z'; c++) {
                if (!excludeAmbiguous || ambiguous.indexOf(c) < 0) charPool.append(c);
            }
        }
        if (useUpper) {
            for (char c = 'A'; c <= 'Z'; c++) {
                if (!excludeAmbiguous || ambiguous.indexOf(c) < 0) charPool.append(c);
            }
        }
        if (useDigits) {
            for (char c = '0'; c <= '9'; c++) {
                if (!excludeAmbiguous || ambiguous.indexOf(c) < 0) charPool.append(c);
            }
        }
        if (useSpecial) {
            String specials = "!@#$%^&*()-_=+[]{};:,.?/";
            for (char c : specials.toCharArray()) {
                if (!excludeAmbiguous || ambiguous.indexOf(c) < 0) charPool.append(c);
            }
        }

        if (charPool.length() == 0) {
            charPool.append("abcdefghijklmnopqrstuvwxyz0123456789");
        }

        java.security.SecureRandom random = new java.security.SecureRandom();
        StringBuilder password = new StringBuilder();
        for (int i = 0; i < length; i++) {
            password.append(charPool.charAt(random.nextInt(charPool.length())));
        }
        return password.toString();
    }
}
