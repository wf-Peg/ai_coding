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
import java.util.*;
import java.util.concurrent.atomic.AtomicLong;
import java.util.stream.Collectors;

/**
 * 密码库业务服务。
 * <p>
 * 负责密码库的初始化、解锁、锁定、CRUD 操作、搜索和安全审计。
 * 支持多密码库（multi-vault），每个密码库有独立的 DES Key 和加密文件。
 * DES Key 仅在解锁时传入，不持久化存储。解锁后 VaultData 缓存在内存中，锁定时清除。
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

    /** 密码库注册表缓存 */
    private Map<String, VaultMeta> vaultRegistry = new LinkedHashMap<>();

    /** 当前激活的密码库名称 */
    private String activeVaultName = "default";

    public PasswordVaultService() {
        this.objectMapper = new ObjectMapper();
        this.objectMapper.enable(SerializationFeature.INDENT_OUTPUT);
    }

    // ========== 内部类 ==========

    /**
     * 密码库元数据，存储在 vaults.json 注册表中。
     */
    public static class VaultMeta {
        private String name;
        private String label;
        private String keyCheckHash;
        private String algorithm = "DES/ECB/PKCS5Padding";
        private long createdAt;
        private int entryCount;

        public VaultMeta() {}

        public VaultMeta(String name, String label, String keyCheckHash) {
            this.name = name;
            this.label = label;
            this.keyCheckHash = keyCheckHash;
            this.createdAt = System.currentTimeMillis();
        }

        public String getName() { return name; }
        public void setName(String name) { this.name = name; }

        public String getLabel() { return label; }
        public void setLabel(String label) { this.label = label; }

        public String getKeyCheckHash() { return keyCheckHash; }
        public void setKeyCheckHash(String keyCheckHash) { this.keyCheckHash = keyCheckHash; }

        public String getAlgorithm() { return algorithm; }
        public void setAlgorithm(String algorithm) { this.algorithm = algorithm; }

        public long getCreatedAt() { return createdAt; }
        public void setCreatedAt(long createdAt) { this.createdAt = createdAt; }

        public int getEntryCount() { return entryCount; }
        public void setEntryCount(int entryCount) { this.entryCount = entryCount; }
    }

    // ========== 路径方法 ==========

    /**
     * 获取指定密码库的存储目录
     */
    private Path getVaultDir(String vaultName) {
        return Paths.get(storagePath, "vault", vaultName);
    }

    /**
     * 获取指定密码库的加密文件路径
     */
    private Path getVaultFile(String vaultName) {
        return getVaultDir(vaultName).resolve("vault.enc");
    }

    /**
     * 获取指定密码库的元数据文件路径
     */
    private Path getMetaFile(String vaultName) {
        return getVaultDir(vaultName).resolve("vault-meta.json");
    }

    /**
     * 获取密码库注册表文件路径
     */
    private Path getVaultsFile() {
        return Paths.get(storagePath, "vault", "vaults.json");
    }

    // ========== 注册表管理 ==========

    /**
     * 加载密码库注册表，并在首次加载时执行向后兼容迁移。
     */
    private synchronized void loadVaultsRegistry() {
        Path vaultsFile = getVaultsFile();

        // 如果注册表不存在，先尝试迁移旧版文件
        if (!Files.exists(vaultsFile)) {
            migrateLegacyVault();
        }

        // 读取注册表
        if (Files.exists(vaultsFile)) {
            try {
                String json = Files.readString(vaultsFile);
                @SuppressWarnings("unchecked")
                Map<String, Object> registry = objectMapper.readValue(json, Map.class);
                activeVaultName = (String) registry.getOrDefault("active", "default");

                @SuppressWarnings("unchecked")
                Map<String, Object> vaultsMap = (Map<String, Object>) registry.get("vaults");
                vaultRegistry = new LinkedHashMap<>();
                if (vaultsMap != null) {
                    for (Map.Entry<String, Object> entry : vaultsMap.entrySet()) {
                        VaultMeta meta = objectMapper.convertValue(entry.getValue(), VaultMeta.class);
                        vaultRegistry.put(entry.getKey(), meta);
                    }
                }
                log.info("Loaded vaults registry: active={}, vaults={}", activeVaultName, vaultRegistry.keySet());
            } catch (Exception e) {
                log.error("Failed to load vaults registry", e);
                vaultRegistry = new LinkedHashMap<>();
                activeVaultName = "default";
            }
        }
    }

    /**
     * 保存密码库注册表到文件。
     */
    private void saveVaultsRegistry() {
        try {
            Map<String, Object> registry = new LinkedHashMap<>();
            registry.put("active", activeVaultName);
            registry.put("vaults", vaultRegistry);
            String json = objectMapper.writeValueAsString(registry);
            Files.writeString(getVaultsFile(), json);
        } catch (Exception e) {
            log.error("Failed to save vaults registry", e);
            throw new RuntimeException("保存密码库注册表失败: " + e.getMessage(), e);
        }
    }

    /**
     * 向后兼容迁移：旧版 vault.enc 在 vault/ 根目录，迁移到 vault/default/ 子目录。
     */
    private void migrateLegacyVault() {
        Path vaultsFile = getVaultsFile();
        if (Files.exists(vaultsFile)) return; // 已经迁移过

        Path oldVaultFile = Paths.get(storagePath, "vault", "vault.enc");
        Path oldMetaFile = Paths.get(storagePath, "vault", "vault-meta.json");

        if (!Files.exists(oldVaultFile)) return; // 没有旧版文件，无需迁移

        log.info("Migrating legacy vault to vault/default/");

        try {
            // 创建 default 目录
            Path defaultDir = getVaultDir("default");
            Files.createDirectories(defaultDir);

            // 移动文件
            Files.move(oldVaultFile, getVaultFile("default"));
            if (Files.exists(oldMetaFile)) {
                Files.move(oldMetaFile, getMetaFile("default"));
            }

            // 读取旧元数据获取 keyCheckHash 和 entryCount
            String keyCheckHash = "";
            int entryCount = 0;
            Path migratedMetaFile = getMetaFile("default");
            if (Files.exists(migratedMetaFile)) {
                try {
                    String metaContent = Files.readString(migratedMetaFile);
                    @SuppressWarnings("unchecked")
                    Map<String, Object> meta = objectMapper.readValue(metaContent, Map.class);
                    keyCheckHash = (String) meta.getOrDefault("keyCheckHash", "");
                    entryCount = ((Number) meta.getOrDefault("entryCount", 0)).intValue();
                } catch (Exception e) {
                    log.warn("Failed to read migrated meta file: {}", e.getMessage());
                }
            }

            // 创建 vaults.json 注册表
            vaultRegistry = new LinkedHashMap<>();
            VaultMeta meta = new VaultMeta("default", "主密码库", keyCheckHash);
            meta.setEntryCount(entryCount);
            vaultRegistry.put("default", meta);
            activeVaultName = "default";
            saveVaultsRegistry();

            log.info("Legacy vault migrated successfully");
        } catch (Exception e) {
            log.error("Failed to migrate legacy vault", e);
        }
    }

    /**
     * 确保注册表已加载
     */
    private void ensureRegistryLoaded() {
        if (vaultRegistry.isEmpty() && !Files.exists(getVaultsFile())) {
            loadVaultsRegistry();
        }
        if (vaultRegistry.isEmpty()) {
            loadVaultsRegistry();
        }
    }

    // ========== 公开 API ==========

    /**
     * 生成随机 DES Key
     */
    public String generateKey() {
        return DesEncryptionUtil.generateKey();
    }

    /**
     * 查询密码库状态（包含所有 vault 信息）
     */
    public Map<String, Object> getStatus() {
        ensureRegistryLoaded();

        Map<String, Object> status = new HashMap<>();
        status.put("active", activeVaultName);

        // 构建 vaults 列表
        List<Map<String, Object>> vaultsList = new ArrayList<>();
        for (VaultMeta meta : vaultRegistry.values()) {
            Map<String, Object> vaultInfo = new HashMap<>();
            vaultInfo.put("name", meta.getName());
            vaultInfo.put("label", meta.getLabel());
            vaultInfo.put("entryCount", meta.getEntryCount());
            vaultInfo.put("createdAt", meta.getCreatedAt());
            vaultInfo.put("isActive", meta.getName().equals(activeVaultName));
            vaultsList.add(vaultInfo);
        }
        status.put("vaults", vaultsList);

        // 当前 active vault 的状态
        Path activeVaultFile = getVaultFile(activeVaultName);
        status.put("exists", Files.exists(activeVaultFile));
        status.put("unlocked", unlocked);
        status.put("entryCount", cachedVault != null ? cachedVault.getEntries().size() : 0);

        // 读取当前 active vault 的元数据
        Path metaFile = getMetaFile(activeVaultName);
        if (Files.exists(metaFile)) {
            try {
                String metaContent = Files.readString(metaFile);
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
     * 列出所有密码库
     */
    public List<Map<String, Object>> listVaults() {
        ensureRegistryLoaded();
        List<Map<String, Object>> list = new ArrayList<>();
        for (VaultMeta meta : vaultRegistry.values()) {
            Map<String, Object> info = new HashMap<>();
            info.put("name", meta.getName());
            info.put("label", meta.getLabel());
            info.put("entryCount", meta.getEntryCount());
            info.put("createdAt", meta.getCreatedAt());
            info.put("isActive", meta.getName().equals(activeVaultName));
            info.put("keyCheckHash", meta.getKeyCheckHash());
            list.add(info);
        }
        return list;
    }

    /**
     * 初始化密码库
     */
    public Map<String, Object> init(String desKey, String vaultName, String label) {
        ensureRegistryLoaded();

        if (vaultName == null || vaultName.trim().isEmpty()) {
            vaultName = "default";
        }
        if (label == null || label.trim().isEmpty()) {
            label = "主密码库";
        }

        log.info("Initializing vault: vaultName={}, label={}, storagePath={}", vaultName, label, storagePath);

        // 检查 vaultName 是否已存在
        if (vaultRegistry.containsKey(vaultName)) {
            VaultMeta existing = vaultRegistry.get(vaultName);
            log.warn("Init failed: vault name '{}' already exists", vaultName);
            throw new RuntimeException("密码库名称「" + existing.getLabel() + "」已存在，请使用其他名称");
        }

        try {
            Path vaultDir = getVaultDir(vaultName);
            if (!Files.exists(vaultDir)) {
                Files.createDirectories(vaultDir);
                log.debug("Created vault directory: {}", vaultDir);
            }

            // 创建空密码库
            VaultData vault = new VaultData();
            vault.setVersion(1L);
            vault.setLastModified(System.currentTimeMillis());
            vault.setEntries(new ArrayList<>());

            // DES 加密并写入
            String json = objectMapper.writeValueAsString(vault);
            String encrypted = DesEncryptionUtil.encrypt(json, desKey);
            Files.writeString(getVaultFile(vaultName), encrypted);
            log.debug("Vault data encrypted and written to {}", getVaultFile(vaultName));

            // 写入元数据
            String keyCheckHash = DesEncryptionUtil.getKeyCheckHash(desKey);
            Map<String, Object> meta = new HashMap<>();
            meta.put("version", 1);
            meta.put("algorithm", "DES/ECB/PKCS5Padding");
            meta.put("keyCheckHash", keyCheckHash);
            meta.put("createdAt", System.currentTimeMillis());
            meta.put("entryCount", 0);
            Files.writeString(getMetaFile(vaultName), objectMapper.writeValueAsString(meta));

            // 注册到 vaults.json
            VaultMeta vaultMeta = new VaultMeta(vaultName, label, keyCheckHash);
            vaultMeta.setEntryCount(0);
            vaultRegistry.put(vaultName, vaultMeta);
            activeVaultName = vaultName;
            saveVaultsRegistry();

            // 缓存到内存
            cachedVault = vault;
            sessionDesKey = desKey;
            unlocked = true;
            idGenerator.set(1);

            log.info("Vault '{}' initialized successfully at {}", label, getVaultFile(vaultName));

            Map<String, Object> result = new HashMap<>();
            result.put("success", true);
            result.put("vaultName", vaultName);
            result.put("label", label);
            result.put("entries", vault.getEntries());
            return result;
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            log.error("Failed to init vault", e);
            throw new RuntimeException("密码库初始化失败: " + e.getMessage(), e);
        }
    }

    /**
     * 解锁密码库
     */
    public Map<String, Object> unlock(String desKey, String vaultName) {
        ensureRegistryLoaded();

        if (vaultName == null || vaultName.trim().isEmpty()) {
            vaultName = activeVaultName;
        }

        log.info("Unlocking vault: vaultName={}", vaultName);

        if (!vaultRegistry.containsKey(vaultName)) {
            log.warn("Unlock failed: vault '{}' not in registry", vaultName);
            throw new RuntimeException("密码库「" + vaultName + "」不存在，请先初始化");
        }

        try {
            Path vaultFile = getVaultFile(vaultName);
            if (!Files.exists(vaultFile)) {
                VaultMeta meta = vaultRegistry.get(vaultName);
                String label = meta != null ? meta.getLabel() : vaultName;
                throw new RuntimeException("密码库「" + label + "」不存在，请先初始化");
            }

            // 验证 Key
            Path metaFile = getMetaFile(vaultName);
            if (Files.exists(metaFile)) {
                String metaContent = Files.readString(metaFile);
                @SuppressWarnings("unchecked")
                Map<String, Object> meta = objectMapper.readValue(metaContent, Map.class);
                String storedHash = (String) meta.get("keyCheckHash");
                if (storedHash != null) {
                    String inputHash = DesEncryptionUtil.getKeyCheckHash(desKey);
                    if (!storedHash.equals(inputHash)) {
                        log.warn("Unlock failed: wrong DES key for vault '{}'", vaultName);
                        throw new RuntimeException("DES Key 不正确，请检查后重试");
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
            activeVaultName = vaultName;

            // 初始化 ID 生成器
            long maxId = vault.getEntries().stream()
                    .mapToLong(PasswordEntry::getId)
                    .max().orElse(0);
            idGenerator.set(maxId + 1);

            log.info("Vault '{}' unlocked successfully, {} entries", vaultName, vault.getEntries().size());

            Map<String, Object> result = new HashMap<>();
            result.put("success", true);
            result.put("vaultName", vaultName);
            result.put("entries", vault.getEntries());
            return result;
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            log.error("Failed to unlock vault '{}'", vaultName, e);
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
     * 切换激活密码库（锁定当前，切换到新 vault）
     */
    public Map<String, Object> switchVault(String vaultName) {
        ensureRegistryLoaded();

        if (vaultName == null || vaultName.trim().isEmpty()) {
            throw new RuntimeException("密码库名称不能为空");
        }

        if (!vaultRegistry.containsKey(vaultName)) {
            throw new RuntimeException("密码库「" + vaultName + "」不存在");
        }

        // 锁定当前
        if (unlocked) {
            lock();
        }

        // 切换 active
        activeVaultName = vaultName;
        saveVaultsRegistry();

        VaultMeta meta = vaultRegistry.get(vaultName);
        log.info("Switched active vault to '{}'", vaultName);

        Map<String, Object> result = new HashMap<>();
        result.put("success", true);
        result.put("vaultName", vaultName);
        result.put("label", meta != null ? meta.getLabel() : vaultName);
        return result;
    }

    /**
     * 删除密码库
     */
    public Map<String, Object> deleteVault(String vaultName) {
        ensureRegistryLoaded();

        if (vaultName == null || vaultName.trim().isEmpty()) {
            throw new RuntimeException("密码库名称不能为空");
        }

        if (!vaultRegistry.containsKey(vaultName)) {
            throw new RuntimeException("密码库「" + vaultName + "」不存在");
        }

        if (vaultName.equals(activeVaultName) && unlocked) {
            throw new RuntimeException("无法删除正在使用的密码库，请先切换到其他密码库");
        }

        VaultMeta meta = vaultRegistry.get(vaultName);

        // 删除文件目录
        Path vaultDir = getVaultDir(vaultName);
        try {
            if (Files.exists(vaultDir)) {
                Files.walk(vaultDir)
                        .sorted(Comparator.reverseOrder())
                        .forEach(path -> {
                            try {
                                Files.deleteIfExists(path);
                            } catch (Exception e) {
                                log.warn("Failed to delete file: {}", path, e);
                            }
                        });
            }
        } catch (Exception e) {
            log.error("Failed to delete vault directory: {}", vaultName, e);
            throw new RuntimeException("删除密码库文件失败: " + e.getMessage(), e);
        }

        // 从注册表移除
        vaultRegistry.remove(vaultName);

        // 如果删除的是当前 active，切换到第一个可用 vault
        if (vaultName.equals(activeVaultName)) {
            if (!vaultRegistry.isEmpty()) {
                activeVaultName = vaultRegistry.keySet().iterator().next();
            } else {
                activeVaultName = "default";
            }
        }
        saveVaultsRegistry();

        log.info("Deleted vault '{}'", vaultName);

        Map<String, Object> result = new HashMap<>();
        result.put("success", true);
        result.put("deletedName", vaultName);
        result.put("deletedLabel", meta != null ? meta.getLabel() : vaultName);
        result.put("newActive", activeVaultName);
        return result;
    }

    /**
     * 验证 Key 是否正确（不解密全部数据）
     */
    public Map<String, Object> checkKey(String vaultName, String desKey) {
        ensureRegistryLoaded();

        if (vaultName == null || vaultName.trim().isEmpty()) {
            vaultName = activeVaultName;
        }

        if (!vaultRegistry.containsKey(vaultName)) {
            return Map.of("valid", false, "error", "密码库不存在");
        }

        Path metaFile = getMetaFile(vaultName);
        if (!Files.exists(metaFile)) {
            return Map.of("valid", false, "error", "元数据不存在");
        }

        try {
            String metaContent = Files.readString(metaFile);
            @SuppressWarnings("unchecked")
            Map<String, Object> meta = objectMapper.readValue(metaContent, Map.class);
            String storedHash = (String) meta.get("keyCheckHash");
            if (storedHash == null) {
                return Map.of("valid", false, "error", "元数据中没有 keyCheckHash");
            }
            String inputHash = DesEncryptionUtil.getKeyCheckHash(desKey);
            boolean valid = storedHash.equals(inputHash);
            log.debug("Key check for vault '{}': valid={}", vaultName, valid);
            return Map.of("valid", valid);
        } catch (Exception e) {
            log.error("Failed to check key for vault '{}'", vaultName, e);
            return Map.of("valid", false, "error", e.getMessage());
        }
    }

    // ========== 内部辅助 ==========

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
            Files.writeString(getVaultFile(activeVaultName), encrypted);
            log.debug("Vault '{}' saved: {} entries", activeVaultName, cachedVault.getEntries().size());

            // 更新元数据中的条目数
            Path metaFile = getMetaFile(activeVaultName);
            if (Files.exists(metaFile)) {
                String metaContent = Files.readString(metaFile);
                @SuppressWarnings("unchecked")
                Map<String, Object> meta = objectMapper.readValue(metaContent, Map.class);
                meta.put("entryCount", cachedVault.getEntries().size());
                meta.put("lastModified", cachedVault.getLastModified());
                Files.writeString(metaFile, objectMapper.writeValueAsString(meta));
            }

            // 更新注册表中的 entryCount
            VaultMeta vm = vaultRegistry.get(activeVaultName);
            if (vm != null) {
                vm.setEntryCount(cachedVault.getEntries().size());
                saveVaultsRegistry();
            }
        } catch (Exception e) {
            log.error("Failed to save vault", e);
            throw new RuntimeException("保存密码库失败: " + e.getMessage(), e);
        }
    }

    // ========== CRUD ==========

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
     * 批量导入密码条目（去重）
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

            if (entry.getPassword() == null || entry.getPassword().isEmpty()) {
                errors++;
                detail.put("status", "error");
                detail.put("reason", "密码为空");
                details.add(detail);
                continue;
            }

            String key = buildDedupeKey(entry);

            if (existingKeys.contains(key)) {
                skipped++;
                detail.put("status", "skipped");
                detail.put("reason", "已存在相同 url+username");
                details.add(detail);
                continue;
            }

            if (!batchKeys.add(key)) {
                duplicates++;
                detail.put("status", "duplicate");
                detail.put("reason", "同批次内重复");
                details.add(detail);
                continue;
            }

            if (entry.getTitle() != null && entry.getTitle().length() > 500) {
                entry.setTitle(entry.getTitle().substring(0, 500));
            }
            if (entry.getUrl() != null && entry.getUrl().length() > 500) {
                entry.setUrl(entry.getUrl().substring(0, 500));
            }
            if (entry.getUsername() != null && entry.getUsername().length() > 500) {
                entry.setUsername(entry.getUsername().substring(0, 500));
            }

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

    private static String buildDedupeKey(PasswordEntry entry) {
        String url = entry.getUrl() == null ? "" : entry.getUrl().trim();
        int q = url.indexOf('?');
        if (q >= 0) url = url.substring(0, q);
        int h = url.indexOf('#');
        if (h >= 0) url = url.substring(0, h);
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