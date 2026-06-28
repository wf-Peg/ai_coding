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
 * Git 同步 REST 控制器
 * <p>
 * 提供 Git 远程同步相关的 API 接口，包括：
 * <ul>
 *   <li>执行 Git 同步操作（pull + commit + push）</li>
 *   <li>获取和更新 Git 配置（仓库地址、认证信息等）</li>
 *   <li>测试 Git 连接可用性</li>
 * </ul>
 * 所有接口均映射到 {@code /api/git} 路径下，并允许跨域访问。
 * Git 操作在文件存储的父目录中执行，确保数据文件的版本控制。
 * </p>
 *
 * @see GitService
 * @see FileStorageService
 */
@RestController
@RequestMapping("/api/git")
@CrossOrigin(origins = "*")  // 允许所有来源的跨域请求，包括浏览器扩展
public class GitController {

    private static final Logger log = LoggerFactory.getLogger(GitController.class);

    /** Git 操作服务，封装 git 命令行调用 */
    private final GitService gitService;
    /** 文件存储服务，用于获取 Git 仓库的工作目录路径 */
    private final FileStorageService fileStorageService;

    /**
     * 构造函数，通过依赖注入初始化服务组件
     *
     * @param gitService          Git 操作服务
     * @param fileStorageService 文件存储服务
     */
    @Autowired
    public GitController(GitService gitService, FileStorageService fileStorageService) {
        this.gitService = gitService;
        this.fileStorageService = fileStorageService;
    }

    /**
     * 执行 Git 同步操作
     * <p>
     * POST /api/git/sync
     * <p>
     * 在文件存储的父目录中执行完整的 Git 同步流程：pull 拉取远程更新 →
     * 提交本地变更 → push 推送到远程仓库。整个流程由 GitService 封装。
     *
     * @return 同步结果消息；若失败则返回 400 及错误信息
     */
    @PostMapping("/sync")
    public ResponseEntity<?> sync() {
        log.info("[API] /sync called");
        try {
            // 获取存储路径的父级目录作为 Git 工作目录
            Path parentPath = fileStorageService.getStorageParentPath();
            log.info("Executing git sync in directory: {}", parentPath);

            // 执行完整的 Git 同步流程（内部包含 pull、commit、push）
            gitService.executeGitOperations(parentPath);

            return ResponseEntity.ok("Git sync completed successfully");
        } catch (Exception e) {
            log.error("[API] Git sync failed: {}", e.getMessage());
            return ResponseEntity.badRequest().body("Git sync failed: " + e.getMessage());
        }
    }

    /**
     * 获取 Git 配置
     * <p>
     * GET /api/git/config
     * <p>
     * 返回当前的 Git 配置信息，包括远程仓库地址、分支、认证方式等。
     * 注意：出于安全考虑，敏感信息（如 token）应在返回前做脱敏处理。
     *
     * @return Git 配置对象；若读取失败则返回 400
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
     * 保存 Git 配置
     * <p>
     * POST /api/git/config
     * <p>
     * 更新 Git 配置（远程仓库地址、认证信息、分支等）并持久化到配置文件。
     *
     * @param gitConfig 新的 Git 配置对象
     * @return 保存结果消息；若保存失败则返回 400
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
     * 测试 Git 连接
     * <p>
     * POST /api/git/test-connection
     * <p>
     * 使用当前配置测试与远程 Git 仓库的连接是否正常。
     * 通常执行 git ls-remote 或类似轻量操作来验证认证和网络连通性。
     *
     * @return 测试结果消息；若连接失败则返回 400 及错误详情
     */
    @PostMapping("/test-connection")
    public ResponseEntity<?> testConnection() {
        log.info("[API] /test-connection called");
        try {
            // 获取 Git 工作目录用于测试连接
            Path parentPath = fileStorageService.getStorageParentPath();
            String result = gitService.testGitConnection(parentPath);
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            log.error("[API] Test git connection failed: {}", e.getMessage());
            return ResponseEntity.badRequest().body("Test git connection failed: " + e.getMessage());
        }
    }
}