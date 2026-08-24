package com.example.clip.controller;

import com.example.clip.config.AppConfig;
import com.example.clip.service.AppConfigService;
import com.example.clip.service.EmailService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 应用统一配置 REST 控制器
 * <p>
 * 提供统一的配置读写接口，替代分散的 ModelConfigController / GitController 配置端点。
 * settings.html 通过此接口一次性加载/保存所有应用级配置。
 * </p>
 *
 * <h3>端點</h3>
 * <ul>
 *   <li>GET /api/config — 获取完整配置</li>
 *   <li>PUT /api/config — 保存完整配置（全量替换）</li>
 *   <li>POST /api/config/test-mail — 测试邮件 SMTP 连接</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/config")
@CrossOrigin(origins = "*")
public class AppConfigController {

    private final AppConfigService appConfigService;
    private final EmailService emailService;

    public AppConfigController(AppConfigService appConfigService, EmailService emailService) {
        this.appConfigService = appConfigService;
        this.emailService = emailService;
    }

    /**
     * 获取统一配置
     * <p>
     * GET /api/config
     *
     * @return 完整 AppConfig JSON
     */
    @GetMapping
    public ResponseEntity<AppConfig> getConfig() {
        return ResponseEntity.ok(appConfigService.getConfig());
    }

    /**
     * 保存统一配置
     * <p>
     * PUT /api/config
     * <p>
     * 前端 PUT 完整 AppConfig JSON，后端全量替换并同步到下游服务。
     *
     * @param config 新的配置
     * @return 保存并持久化后的配置
     */
    @PutMapping
    public ResponseEntity<?> saveConfig(@RequestBody AppConfig config) {
        try {
            AppConfig saved = appConfigService.saveConfig(config);
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("success", true);
            result.put("message", "配置已保存");
            result.put("config", saved);
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("success", false);
            result.put("message", "保存失败: " + e.getMessage());
            return ResponseEntity.badRequest().body(result);
        }
    }

    /**
     * 测试邮件 SMTP 连接
     * <p>
     * POST /api/config/test-mail
     *
     * @param body 包含 host, port, username, password 的 JSON
     * @return 测试结果
     */
    @PostMapping("/test-mail")
    public ResponseEntity<?> testMail(@RequestBody Map<String, Object> body) {
        try {
            String host = (String) body.getOrDefault("host", "");
            int port = body.get("port") instanceof Number
                    ? ((Number) body.get("port")).intValue() : 465;
            String username = (String) body.getOrDefault("username", "");
            String password = (String) body.getOrDefault("password", "");

            if (host.isEmpty() || username.isEmpty() || password.isEmpty()) {
                Map<String, Object> result = new LinkedHashMap<>();
                result.put("success", false);
                result.put("message", "请完整填写 SMTP 配置（host/username/password）");
                return ResponseEntity.badRequest().body(result);
            }

            String msg = emailService.testConnection(host, port, username, password);
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("success", true);
            result.put("message", msg);
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("success", false);
            result.put("message", "连接测试失败: " + e.getMessage());
            return ResponseEntity.ok(result);
        }
    }

    /**
     * 归档旧存储目录并迁移
     * <p>
     * POST /api/config/migrate-storage
     * <p>
     * 将旧存储目录打包为 zip 归档文件，保存在旧路径的父目录下。
     * 归档不删除原文件。
     *
     * @param body 包含 oldPath, newPath 的 JSON
     * @return 归档结果，含 archivePath 和 archiveSize
     */
    @PostMapping("/migrate-storage")
    public ResponseEntity<?> migrateStorage(@RequestBody Map<String, String> body) {
        try {
            String oldPath = body.getOrDefault("oldPath", "");
            String newPath = body.getOrDefault("newPath", "");

            Map<String, Object> result = appConfigService.archiveAndMigrate(oldPath, newPath);
            if (Boolean.TRUE.equals(result.get("success"))) {
                return ResponseEntity.ok(result);
            } else {
                return ResponseEntity.badRequest().body(result);
            }
        } catch (Exception e) {
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("success", false);
            result.put("message", "归档失败: " + e.getMessage());
            return ResponseEntity.internalServerError().body(result);
        }
    }

    /**
     * 获取本地配置文件路径
     * <p>
     * GET /api/config/path
     * <p>
     * 仅返回配置文件所在目录与完整路径，不执行打开操作，
     * 供设置页面加载时展示。
     *
     * @return 包含 configDir 和 configPath 的 JSON
     */
    @GetMapping("/path")
    public ResponseEntity<Map<String, Object>> getConfigPath() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("status", "success");
        result.put("configDir", appConfigService.getConfigDirPath());
        result.put("configPath", appConfigService.getConfigFileFullPath());
        return ResponseEntity.ok(result);
    }

    /**
     * 打开本地配置文件所在目录
     * <p>
     * POST /api/config/open-config-folder
     * <p>
     * 在服务器端操作系统上打开配置文件（~/.cut-shelter/config/app-config.json）
     * 所在目录，方便用户查看、备份或手动编辑配置文件。
     * 根据操作系统类型（Windows/macOS/Linux）使用不同的命令打开。
     *
     * @return 操作结果，包含状态、配置目录路径和配置文件完整路径
     */
    @PostMapping("/open-config-folder")
    public ResponseEntity<Map<String, Object>> openConfigFolder() {
        try {
            String configDir = appConfigService.getConfigDirPath();
            Path folderPath = Paths.get(configDir);

            // 目录不存在时主动创建，确保可以打开
            if (!Files.exists(folderPath)) {
                Files.createDirectories(folderPath);
            }

            // 根据操作系统类型选择对应的文件管理器命令
            String os = System.getProperty("os.name").toLowerCase();
            ProcessBuilder processBuilder;

            if (os.contains("win")) {
                processBuilder = new ProcessBuilder("explorer.exe", configDir);
            } else if (os.contains("mac")) {
                processBuilder = new ProcessBuilder("open", configDir);
            } else {
                processBuilder = new ProcessBuilder("xdg-open", configDir);
            }

            processBuilder.start();

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("status", "success");
            result.put("message", "已尝试打开配置文件目录");
            result.put("configDir", configDir);
            result.put("configPath", appConfigService.getConfigFileFullPath());
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("status", "error");
            result.put("message", "打开配置文件目录失败: " + e.getMessage());
            return ResponseEntity.badRequest().body(result);
        }
    }
}
