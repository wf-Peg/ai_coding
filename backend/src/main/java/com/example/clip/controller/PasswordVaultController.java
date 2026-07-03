package com.example.clip.controller;

import com.example.clip.model.PasswordEntry;
import com.example.clip.service.PasswordVaultService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * 密码库 REST API 控制器。
 * <p>
 * 提供密码库的初始化、解锁/锁定、CRUD、搜索、审计和密码生成接口。
 * 前端通过 axios 调用这些端点，DES Key 在请求体中传递，不持久化存储。
 * </p>
 */
@RestController
@RequestMapping("/api/vault")
public class PasswordVaultController {

    private static final Logger log = LoggerFactory.getLogger(PasswordVaultController.class);

    private final PasswordVaultService vaultService;

    public PasswordVaultController(PasswordVaultService vaultService) {
        this.vaultService = vaultService;
    }

    /** 生成随机 DES Key */
    @PostMapping("/generate-key")
    public ResponseEntity<Map<String, Object>> generateKey() {
        String key = vaultService.generateKey();
        return ResponseEntity.ok(Map.of("key", key));
    }

    /** 查询密码库状态 */
    @GetMapping("/status")
    public ResponseEntity<Map<String, Object>> getStatus() {
        return ResponseEntity.ok(vaultService.getStatus());
    }

    /** 初始化密码库 */
    @PostMapping("/init")
    public ResponseEntity<Map<String, Object>> init(@RequestBody Map<String, String> body) {
        String desKey = body.get("desKey");
        if (desKey == null || desKey.trim().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "DES Key 不能为空"));
        }
        return ResponseEntity.ok(vaultService.init(desKey));
    }

    /** 解锁密码库 */
    @PostMapping("/unlock")
    public ResponseEntity<Map<String, Object>> unlock(@RequestBody Map<String, String> body) {
        String desKey = body.get("desKey");
        if (desKey == null || desKey.trim().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "DES Key 不能为空"));
        }
        return ResponseEntity.ok(vaultService.unlock(desKey));
    }

    /** 锁定密码库 */
    @PostMapping("/lock")
    public ResponseEntity<Map<String, Object>> lock() {
        return ResponseEntity.ok(vaultService.lock());
    }

    /** 新增密码条目 */
    @PostMapping("/entry")
    public ResponseEntity<?> addEntry(@RequestBody PasswordEntry entry) {
        try {
            return ResponseEntity.ok(vaultService.addEntry(entry));
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /** 更新密码条目 */
    @PutMapping("/entry/{id}")
    public ResponseEntity<?> updateEntry(@PathVariable Long id, @RequestBody PasswordEntry entry) {
        try {
            return ResponseEntity.ok(vaultService.updateEntry(id, entry));
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /** 删除密码条目 */
    @DeleteMapping("/entry/{id}")
    public ResponseEntity<?> deleteEntry(@PathVariable Long id) {
        try {
            return ResponseEntity.ok(vaultService.deleteEntry(id));
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /** 搜索密码条目 */
    @GetMapping("/search")
    public ResponseEntity<?> search(@RequestParam(required = false, defaultValue = "") String keyword) {
        try {
            return ResponseEntity.ok(vaultService.search(keyword));
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /** 安全审计 */
    @GetMapping("/audit")
    public ResponseEntity<?> audit() {
        try {
            return ResponseEntity.ok(vaultService.audit());
        } catch (RuntimeException e) {
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

        String password = vaultService.generatePassword(length, useUpper, useLower, useDigits, useSpecial, excludeAmbiguous);
        return ResponseEntity.ok(Map.of("password", password));
    }
}
