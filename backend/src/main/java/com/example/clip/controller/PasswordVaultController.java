package com.example.clip.controller;

import com.example.clip.model.PasswordEntry;
import com.example.clip.service.PasswordVaultService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 密码库 REST API 控制器。
 * <p>
 * 提供密码库的初始化、解锁/锁定、CRUD、搜索、审计、导入和密码生成接口，
 * 以及多密码库管理（列出、切换、删除、验证 Key）。
 * 前端通过 axios 调用这些端点，DES Key 在请求体中传递，不持久化存储。
 * 允许所有来源的跨域请求，包括浏览器扩展。
 * </p>
 */
@RestController
@RequestMapping("/api/vault")
@CrossOrigin(origins = "*")
public class PasswordVaultController {

    private static final Logger log = LoggerFactory.getLogger(PasswordVaultController.class);

    private final PasswordVaultService vaultService;
    private final ObjectMapper objectMapper;

    public PasswordVaultController(PasswordVaultService vaultService, ObjectMapper objectMapper) {
        this.vaultService = vaultService;
        this.objectMapper = objectMapper;
    }

    /** 生成随机 DES Key */
    @PostMapping("/generate-key")
    public ResponseEntity<Map<String, Object>> generateKey() {
        log.info("generate-key requested");
        try {
            String key = vaultService.generateKey();
            return ResponseEntity.ok(Map.of("key", key));
        } catch (RuntimeException e) {
            log.error("generate-key failed: {}", e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /** 查询密码库状态（包含所有 vault 信息） */
    @GetMapping("/status")
    public ResponseEntity<Map<String, Object>> getStatus() {
        log.debug("status requested");
        try {
            return ResponseEntity.ok(vaultService.getStatus());
        } catch (RuntimeException e) {
            log.error("status failed: {}", e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /** 初始化密码库 */
    @PostMapping("/init")
    public ResponseEntity<Map<String, Object>> init(@RequestBody Map<String, String> body) {
        String desKey = body.get("desKey");
        if (desKey == null || desKey.trim().isEmpty()) {
            log.warn("Init failed: DES Key is empty");
            return ResponseEntity.badRequest().body(Map.of("error", "DES Key 不能为空"));
        }
        String vaultName = body.getOrDefault("vaultName", "default");
        String label = body.getOrDefault("label", "主密码库");
        log.info("Init vault request: vaultName={}, label={}", vaultName, label);
        try {
            Map<String, Object> result = vaultService.init(desKey, vaultName, label);
            log.info("Init vault success: vaultName={}", vaultName);
            return ResponseEntity.ok(result);
        } catch (RuntimeException e) {
            log.error("Init vault failed: vaultName={}, error={}", vaultName, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /** 解锁密码库 */
    @PostMapping("/unlock")
    public ResponseEntity<Map<String, Object>> unlock(@RequestBody Map<String, String> body) {
        String desKey = body.get("desKey");
        if (desKey == null || desKey.trim().isEmpty()) {
            log.warn("Unlock failed: DES Key is empty");
            return ResponseEntity.badRequest().body(Map.of("error", "DES Key 不能为空"));
        }
        String vaultName = body.getOrDefault("vaultName", null);
        log.info("Unlock vault request: vaultName={}", vaultName);
        try {
            return ResponseEntity.ok(vaultService.unlock(desKey, vaultName));
        } catch (RuntimeException e) {
            log.error("Unlock vault failed: vaultName={}, error={}", vaultName, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /** 锁定密码库 */
    @PostMapping("/lock")
    public ResponseEntity<Map<String, Object>> lock() {
        log.info("Lock requested");
        try {
            return ResponseEntity.ok(vaultService.lock());
        } catch (RuntimeException e) {
            log.error("Lock failed: {}", e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /** 列出所有密码库 */
    @GetMapping("/vaults")
    public ResponseEntity<List<Map<String, Object>>> listVaults() {
        log.debug("List vaults requested");
        try {
            return ResponseEntity.ok(vaultService.listVaults());
        } catch (RuntimeException e) {
            log.error("List vaults failed: {}", e.getMessage());
            return ResponseEntity.badRequest().build();
        }
    }

    /** 切换激活密码库 */
    @PutMapping("/vaults/active")
    public ResponseEntity<Map<String, Object>> switchVault(@RequestBody Map<String, String> body) {
        String vaultName = body.get("vaultName");
        if (vaultName == null || vaultName.trim().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "vaultName 不能为空"));
        }
        log.info("Switch vault requested: vaultName={}", vaultName);
        try {
            return ResponseEntity.ok(vaultService.switchVault(vaultName));
        } catch (RuntimeException e) {
            log.error("Switch vault failed: vaultName={}, error={}", vaultName, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /** 删除密码库 */
    @DeleteMapping("/vaults/{name}")
    public ResponseEntity<Map<String, Object>> deleteVault(@PathVariable String name) {
        log.info("Delete vault requested: name={}", name);
        try {
            return ResponseEntity.ok(vaultService.deleteVault(name));
        } catch (RuntimeException e) {
            log.error("Delete vault failed: name={}, error={}", name, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /** 验证 Key 是否正确 */
    @PostMapping("/check-key")
    public ResponseEntity<Map<String, Object>> checkKey(@RequestBody Map<String, String> body) {
        String desKey = body.get("desKey");
        String vaultName = body.getOrDefault("vaultName", null);
        if (desKey == null || desKey.trim().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("valid", false, "error", "DES Key 不能为空"));
        }
        log.debug("Check key requested: vaultName={}", vaultName);
        try {
            return ResponseEntity.ok(vaultService.checkKey(vaultName, desKey));
        } catch (RuntimeException e) {
            log.error("Check key failed: vaultName={}, error={}", vaultName, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("valid", false, "error", e.getMessage()));
        }
    }

    /** 新增密码条目 */
    @PostMapping("/entry")
    public ResponseEntity<?> addEntry(@RequestBody PasswordEntry entry) {
        log.debug("Add entry requested: title={}", entry.getTitle());
        try {
            return ResponseEntity.ok(vaultService.addEntry(entry));
        } catch (RuntimeException e) {
            log.error("Add entry failed: error={}", e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /** 更新密码条目 */
    @PutMapping("/entry/{id}")
    public ResponseEntity<?> updateEntry(@PathVariable Long id, @RequestBody PasswordEntry entry) {
        log.debug("Update entry requested: id={}", id);
        try {
            return ResponseEntity.ok(vaultService.updateEntry(id, entry));
        } catch (RuntimeException e) {
            log.error("Update entry failed: id={}, error={}", id, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /** 删除密码条目 */
    @DeleteMapping("/entry/{id}")
    public ResponseEntity<?> deleteEntry(@PathVariable Long id) {
        log.debug("Delete entry requested: id={}", id);
        try {
            return ResponseEntity.ok(vaultService.deleteEntry(id));
        } catch (RuntimeException e) {
            log.error("Delete entry failed: id={}, error={}", id, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /** 切换收藏状态 */
    @PutMapping("/entry/{id}/favorite")
    public ResponseEntity<?> toggleFavorite(@PathVariable Long id) {
        log.debug("Toggle favorite requested: id={}", id);
        try {
            return ResponseEntity.ok(vaultService.toggleFavorite(id));
        } catch (RuntimeException e) {
            log.error("Toggle favorite failed: id={}, error={}", id, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /** 搜索密码条目 */
    @GetMapping("/search")
    public ResponseEntity<?> search(@RequestParam(required = false, defaultValue = "") String keyword) {
        log.debug("Search requested: keyword={}", keyword);
        try {
            return ResponseEntity.ok(vaultService.search(keyword));
        } catch (RuntimeException e) {
            log.error("Search failed: keyword={}, error={}", keyword, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /** 安全审计 */
    @GetMapping("/audit")
    public ResponseEntity<?> audit() {
        log.debug("Audit requested");
        try {
            return ResponseEntity.ok(vaultService.audit());
        } catch (RuntimeException e) {
            log.error("Audit failed: error={}", e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /** 批量导入密码条目 */
    @SuppressWarnings("unchecked")
    @PostMapping("/import")
    public ResponseEntity<?> importEntries(@RequestBody Map<String, Object> body) {
        try {
            Object entriesObj = body.get("entries");
            if (entriesObj == null) {
                return ResponseEntity.badRequest().body(Map.of("error", "entries 字段不能为空"));
            }
            List<PasswordEntry> entries = new ArrayList<>();
            if (entriesObj instanceof List) {
                for (Object item : (List<Object>) entriesObj) {
                    if (item instanceof Map) {
                        entries.add(objectMapper.convertValue(item, PasswordEntry.class));
                    }
                }
            }
            log.info("Import entries requested: count={}", entries.size());
            return ResponseEntity.ok(vaultService.importEntries(entries));
        } catch (RuntimeException e) {
            log.error("Import failed: error={}", e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /** 生成随机密码 */
    @PostMapping("/generate-password")
    public ResponseEntity<Map<String, Object>> generatePassword(@RequestBody Map<String, Object> params) {
        int length = params.containsKey("length") ? ((Number) params.get("length")).intValue() : 16;
        boolean useUpper = !params.containsKey("useUpper") || (boolean) params.get("useUpper");
        boolean useLower = !params.containsKey("useLower") || (boolean) params.get("useLower");
        boolean useDigits = !params.containsKey("useDigits") || (boolean) params.get("useDigits");
        boolean useSpecial = params.containsKey("useSpecial") && (boolean) params.get("useSpecial");
        boolean excludeAmbiguous = params.containsKey("excludeAmbiguous") && (boolean) params.get("excludeAmbiguous");

        log.debug("Generate password requested: length={}", length);
        try {
            String password = vaultService.generatePassword(length, useUpper, useLower, useDigits, useSpecial, excludeAmbiguous);
            return ResponseEntity.ok(Map.of("password", password));
        } catch (RuntimeException e) {
            log.error("Generate password failed: error={}", e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }
}