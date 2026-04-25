package com.example.clip.controller;

import com.example.clip.config.GitConfig;
import com.example.clip.service.GitService;
import com.example.clip.service.FileStorageService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.nio.file.Path;

/**
 * Git控制器
 * 处理git同步相关的API请求
 */
@RestController
@RequestMapping("/api/git")
@CrossOrigin(origins = {"http://127.0.0.1:3000", "http://localhost:3000", "http://127.0.0.1:5500", "http://localhost:5500", "null"})  // 允许前端跨域请求
public class GitController {

    private static final Logger log = LoggerFactory.getLogger(GitController.class);

    private final GitService gitService;
    private final FileStorageService fileStorageService;

    /**
     * 构造函数
     * @param gitService Git服务
     * @param fileStorageService 文件存储服务
     */
    @Autowired
    public GitController(GitService gitService, FileStorageService fileStorageService) {
        this.gitService = gitService;
        this.fileStorageService = fileStorageService;
    }

    /**
     * 执行git同步操作
     * @return 响应实体，包含同步结果
     */
    @PostMapping("/sync")
    public ResponseEntity<?> sync() {
        log.info("[API] /sync called");
        try {
            // 获取存储路径的父级目录
            Path parentPath = fileStorageService.getStorageParentPath();
            log.info("Executing git sync in directory: {}", parentPath);
            
            // 执行git操作
            gitService.executeGitOperations(parentPath);
            
            return ResponseEntity.ok("Git sync completed successfully");
        } catch (Exception e) {
            log.error("[API] Git sync failed: {}", e.getMessage());
            return ResponseEntity.badRequest().body("Git sync failed: " + e.getMessage());
        }
    }

    /**
     * 获取Git配置
     * @return 响应实体，包含Git配置
     */
    @GetMapping("/config")
    public ResponseEntity<?> getConfig() {
        log.info("[API] /config get called");
        try {
            GitConfig gitConfig = gitService.getGitConfig();
            return ResponseEntity.ok(gitConfig);
        } catch (Exception e) {
            log.error("[API] Get git config failed: {}", e.getMessage());
            return ResponseEntity.badRequest().body("Get git config failed: " + e.getMessage());
        }
    }

    /**
     * 保存Git配置
     * @param gitConfig Git配置
     * @return 响应实体，包含保存结果
     */
    @PostMapping("/config")
    public ResponseEntity<?> saveConfig(@RequestBody GitConfig gitConfig) {
        log.info("[API] /config post called");
        try {
            gitService.setGitConfig(gitConfig);
            return ResponseEntity.ok("Git config saved successfully");
        } catch (Exception e) {
            log.error("[API] Save git config failed: {}", e.getMessage());
            return ResponseEntity.badRequest().body("Save git config failed: " + e.getMessage());
        }
    }

    /**
     * 测试Git连接
     * @return 响应实体，包含测试结果
     */
    @PostMapping("/test-connection")
    public ResponseEntity<?> testConnection() {
        log.info("[API] /test-connection called");
        try {
            // 获取存储路径的父级目录
            Path parentPath = fileStorageService.getStorageParentPath();
            String result = gitService.testGitConnection(parentPath);
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            log.error("[API] Test git connection failed: {}", e.getMessage());
            return ResponseEntity.badRequest().body("Test git connection failed: " + e.getMessage());
        }
    }
}
