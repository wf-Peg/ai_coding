package com.example.clip.controller;

import com.example.clip.core.AiService;
import com.example.clip.config.PromptConfig;
import com.example.clip.dto.ClipRequest;
import com.example.clip.dto.ClipResponse;
import com.example.clip.dto.TagRequest;
import com.example.clip.model.ClipContent;
import com.example.clip.service.ClipService;
import com.example.clip.service.ContentOrganizeService;
import com.example.clip.service.PromptConfigService;
import com.example.clip.service.SearchService;
import com.example.clip.service.WeeklyReportService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.Map;

/**
 * 剪藏内容控制器
 * 处理剪藏内容的CRUD操作和AI相关功能
 */
@RestController
@RequestMapping("/api/clip")
@CrossOrigin(origins = {"http://127.0.0.1:3000", "http://localhost:3000", "http://127.0.0.1:5500", "http://localhost:5500", "null"})  // 允许前端跨域请求
public class ClipController {

    private static final Logger log = LoggerFactory.getLogger(ClipController.class);

    private final ClipService clipService;  // 剪藏服务
    private final SearchService searchService;  // 搜索服务
    private final AiService aiService;  // AI服务
    private final ContentOrganizeService contentOrganizeService;  // 内容整理服务
    private final WeeklyReportService weeklyReportService;  // 周报服务
    private final PromptConfigService promptConfigService;

    /**
     * 构造函数
     * @param clipService 剪藏服务
     * @param searchService 搜索服务
     * @param aiService AI服务
     * @param contentOrganizeService 内容整理服务
     * @param weeklyReportService 周报服务
     */
    public ClipController(ClipService clipService, SearchService searchService, AiService aiService, ContentOrganizeService contentOrganizeService, WeeklyReportService weeklyReportService, PromptConfigService promptConfigService) {
        this.clipService = clipService;
        this.searchService = searchService;
        this.aiService = aiService;
        this.contentOrganizeService = contentOrganizeService;
        this.weeklyReportService = weeklyReportService;
        this.promptConfigService = promptConfigService;
    }

    /**
     * 添加剪藏内容
     * @param request 剪藏请求对象
     * @return 响应实体，包含剪藏ID和状态
     */
    @PostMapping("/add")
    public ResponseEntity<?> addClip(@RequestBody ClipRequest request) {
        log.info("[API] /add called, type={}, useAiTags={}", request.getType(), request.getUseAiTags());
        // 保存剪藏内容，处理文件数据和图片数据
        ClipContent clip = clipService.saveClip(request.getContent(), request.getType(),
                request.getSource(), request.getCategory(),
                request.getFileData(), request.getFileName(),
                request.getImageDataList());

        // 处理标签：如果用户提供了手动标签，覆盖AI生成的标签
        if (!"store-only".equals(request.getType())) {
            if (request.getTags() != null && !request.getTags().isEmpty()) {
                clip.setTags(request.getTags());
                clipService.saveClip(clip);
            }
            // 如果useAiTags为false且没有手动标签，清除AI生成的标签
            else if (request.getUseAiTags() == null || !request.getUseAiTags()) {
                if (request.getTags() == null || request.getTags().isEmpty()) {
                    clip.setTags(new java.util.ArrayList<>());
                    clipService.saveClip(clip);
                }
            }
        }
        return ResponseEntity.ok(new ClipResponse(clip.getId(), "success"));
    }

    /**
     * 系统剪藏
     * 用于系统内部添加剪藏内容
     * @param request 剪藏请求对象
     * @return 响应实体，包含剪藏ID和状态
     */
    @PostMapping("/system")
    public ResponseEntity<?> systemClip(@RequestBody ClipRequest request) {
        ClipContent clip = clipService.saveClip(request.getContent(), request.getType(), request.getSource(), request.getCategory());
        return ResponseEntity.ok(new ClipResponse(clip.getId(), "success"));
    }

    /**
     * 生成标签
     * 使用AI为内容生成标签
     * @param request 标签请求对象
     * @return 响应实体，包含生成的标签列表
     */
    @PostMapping("/generate-tags")
    public ResponseEntity<List<String>> generateTags(@RequestBody TagRequest request) {
        List<String> tags = aiService.generateTags(request.getContent());
        return ResponseEntity.ok(tags);
    }

    /**
     * 智能整理
     * 使用AI对内容进行智能分类和标签生成
     * @param request 标签请求对象
     * @return 响应实体，包含分类和标签信息
     */
    @PostMapping("/smart-organize")
    public ResponseEntity<Map<String, Object>> smartOrganize(@RequestBody TagRequest request) {
        Map<String, Object> result = aiService.smartOrganize(request.getContent());
        return ResponseEntity.ok(result);
    }

    /**
     * 获取分类树
     * 返回预设的分类树结构
     * @return 响应实体，包含分类树列表
     */
    @GetMapping("/categories")
    public ResponseEntity<List<Map<String, Object>>> getCategories() {
        return ResponseEntity.ok(AiService.CATEGORY_TREE);
    }

    /**
     * 根据分类获取剪藏内容
     * @param category 分类值
     * @return 响应实体，包含该分类下的剪藏内容列表
     */
    @GetMapping("/category/{category}")
    public ResponseEntity<List<ClipContent>> getClipsByCategory(@PathVariable(name = "category") String category) {
        List<ClipContent> clips = clipService.getClipsByCategory(category);
        return ResponseEntity.ok(clips);
    }

    /**
     * 获取所有剪藏内容
     * 返回所有剪藏内容列表
     * @return 响应实体，包含所有剪藏内容列表
     */
    @GetMapping("/list")
    public ResponseEntity<List<ClipContent>> getClipList() {
        List<ClipContent> clips = clipService.getAllClips();
        return ResponseEntity.ok(clips);
    }

    /**
     * 删除剪藏内容
     * @param id 剪藏ID
     * @return 响应实体，包含删除状态
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<?> deleteClip(@PathVariable(name = "id") Long id) {
        clipService.deleteClip(id);
        return ResponseEntity.ok(new ClipResponse(null, "success"));
    }

    /**
     * 搜索剪藏内容
     * @param query 搜索关键词
     * @param topK 返回结果数量
     * @return 响应实体，包含搜索结果列表
     */
    @GetMapping("/search")
    public ResponseEntity<List<ClipContent>> search(@RequestParam String query, @RequestParam(defaultValue = "5") int topK) {
        List<ClipContent> results = searchService.search(query, topK);
        return ResponseEntity.ok(results);
    }

    /**
     * 按分类搜索剪藏内容
     * @param query 搜索关键词
     * @param category 分类值
     * @param topK 返回结果数量
     * @return 响应实体，包含搜索结果列表
     */
    @GetMapping("/search/category")
    public ResponseEntity<List<ClipContent>> searchByCategory(@RequestParam String query, @RequestParam String category, @RequestParam(defaultValue = "5") int topK) {
        List<ClipContent> results = searchService.searchByCategory(query, category, topK);
        return ResponseEntity.ok(results);
    }

    /**
     * 获取发散性总结
     * 使用AI对剪藏内容进行发散性思考和深度分析
     * @param id 剪藏ID
     * @return 响应实体，包含发散性总结内容
     */
    @GetMapping("/divergent-summary/{id}")
    public ResponseEntity<String> getDivergentSummary(@PathVariable(name = "id") Long id) {
        ClipContent clip = clipService.getClipById(id);
        if (clip == null) {
            return ResponseEntity.notFound().build();
        }

        String summary = aiService.generateDivergentSummary(clip.getContent(), clip.getCategory(), clip.getTags());
        return ResponseEntity.ok(summary);
    }

    /**
     * 整理内容
     * 触发内容整理服务，对剪藏内容进行组织和分类
     * @return 响应实体，包含整理结果
     */
    @PostMapping("/organize")
    public ResponseEntity<?> organizeContent() {
        return ResponseEntity.ok(contentOrganizeService.organizeContent());
    }

    /**
     * 获取整理状态
     * 返回内容整理的状态信息
     * @return 响应实体，包含整理状态、消息和存储路径
     */
    @GetMapping("/organize/status")
    public ResponseEntity<?> getOrganizeStatus() {
        java.util.Map<String, Object> status = new java.util.HashMap<>();
        status.put("status", contentOrganizeService.getLastOrganizeStatus());
        status.put("message", contentOrganizeService.getLastOrganizeMessage());
        status.put("storagePath", contentOrganizeService.getOrganizedStoragePath());
        return ResponseEntity.ok(status);
    }

    /**
     * 打开存储目录
     * 在服务器端打开存储目录
     * @return 操作结果
     */
    @PostMapping("/open-storage-folder")
    public ResponseEntity<Map<String, Object>> openStorageFolder() {
        try {
            String storagePath = contentOrganizeService.getOrganizedStoragePath();
            Path folderPath = Paths.get(storagePath);

            if (!Files.exists(folderPath)) {
                return ResponseEntity.badRequest().body(Map.of(
                        "status", "error",
                        "message", "存储目录不存在"
                ));
            }

            // 根据操作系统打开文件夹
            String os = System.getProperty("os.name").toLowerCase();
            ProcessBuilder processBuilder;

            if (os.contains("win")) {
                processBuilder = new ProcessBuilder("explorer.exe", storagePath);
            } else if (os.contains("mac")) {
                processBuilder = new ProcessBuilder("open", storagePath);
            } else {
                // Linux
                processBuilder = new ProcessBuilder("xdg-open", storagePath);
            }

            processBuilder.start();

            return ResponseEntity.ok(Map.of(
                    "status", "success",
                    "message", "已尝试打开存储目录",
                    "storagePath", storagePath
            ));
        } catch (Exception e) {
            log.error("Failed to open storage folder: {}", e.getMessage(), e);
            return ResponseEntity.badRequest().body(Map.of(
                    "status", "error",
                    "message", "打开存储目录失败: " + e.getMessage()
            ));
        }
    }

    /**
     * 周报功能路由
     * 调用周报服务生成周报
     */
    @PostMapping("/weekly-report")
    public ResponseEntity<Map<String, Object>> generateWeeklyReport() {
        try {
            log.info("[API] /weekly-report called (clip controller)");
            Map<String, Object> result = weeklyReportService.generateWeeklyReport();
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            log.error("Failed to generate weekly report: {}", e.getMessage(), e);
            return ResponseEntity.badRequest().body(Map.of(
                    "status", "error",
                    "message", e.getMessage()
            ));
        }
    }

    /**
     * 获取Prompt配置
     */
    @GetMapping("/prompt-config")
    public ResponseEntity<PromptConfig> getPromptConfig() {
        return ResponseEntity.ok(promptConfigService.getPromptConfig());
    }

    /**
     * 保存Prompt配置
     */
    @PostMapping("/prompt-config")
    public ResponseEntity<?> savePromptConfig(@RequestBody PromptConfig config) {
        try {
            PromptConfig savedConfig = promptConfigService.savePromptConfig(config);
            return ResponseEntity.ok(savedConfig);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of(
                    "status", "error",
                    "message", e.getMessage()
            ));
        }
    }

    /**
     * 重置Prompt配置为默认值
     */
    @PostMapping("/prompt-config/reset")
    public ResponseEntity<PromptConfig> resetPromptConfig() {
        return ResponseEntity.ok(promptConfigService.resetToDefault());
    }
}
