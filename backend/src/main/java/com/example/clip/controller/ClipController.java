package com.example.clip.controller;

import com.example.clip.core.AiService;
import com.example.clip.model.ClipContent;
import com.example.clip.service.ClipService;
import com.example.clip.service.ContentOrganizeService;
import com.example.clip.service.SearchService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

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

    /**
     * 构造函数
     * @param clipService 剪藏服务
     * @param searchService 搜索服务
     * @param aiService AI服务
     * @param contentOrganizeService 内容整理服务
     */
    @Autowired
    public ClipController(ClipService clipService, SearchService searchService, AiService aiService, ContentOrganizeService contentOrganizeService) {
        this.clipService = clipService;
        this.searchService = searchService;
        this.aiService = aiService;
        this.contentOrganizeService = contentOrganizeService;
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

    // Request and Response classes
    /**
     * 剪藏请求类
     * 用于接收前端发送的剪藏内容请求
     */
    public static class ClipRequest {
        private String content;  // 剪藏内容
        private String type;  // 剪藏类型
        private String source;  // 剪藏来源
        private String category;  // 剪藏分类
        private List<String> tags;  // 剪藏标签
        private Boolean useAiTags;  // 是否使用AI生成标签
        private String fileData;  // 文件数据（Base64编码）
        private String fileName;  // 文件名
        private List<ImageData> imageDataList;  // 图片数据列表

        // Getters and Setters
        public String getContent() {
            return content;
        }

        public void setContent(String content) {
            this.content = content;
        }

        public String getType() {
            return type;
        }

        public void setType(String type) {
            this.type = type;
        }

        public String getSource() {
            return source;
        }

        public void setSource(String source) {
            this.source = source;
        }

        public String getCategory() {
            return category;
        }

        public void setCategory(String category) {
            this.category = category;
        }

        public List<String> getTags() {
            return tags;
        }

        public void setTags(List<String> tags) {
            this.tags = tags;
        }

        public Boolean getUseAiTags() {
            return useAiTags;
        }

        public void setUseAiTags(Boolean useAiTags) {
            this.useAiTags = useAiTags;
        }

        public String getFileData() { return fileData; }
        public void setFileData(String fileData) { this.fileData = fileData; }

        public String getFileName() { return fileName; }
        public void setFileName(String fileName) { this.fileName = fileName; }

        public List<ImageData> getImageDataList() { return imageDataList; }
        public void setImageDataList(List<ImageData> imageDataList) { this.imageDataList = imageDataList; }

        /**
         * 图片数据类
         * 用于接收前端上传的图片数据
         */
        public static class ImageData {
            private String base64Data;  // Base64编码的图片数据
            private String fileName;  // 图片文件名

            public String getBase64Data() { return base64Data; }
            public void setBase64Data(String base64Data) { this.base64Data = base64Data; }

            public String getFileName() { return fileName; }
            public void setFileName(String fileName) { this.fileName = fileName; }
        }
    }

    /**
     * 标签请求类
     * 用于接收前端发送的标签生成请求
     */
    public static class TagRequest {
        private String content;  // 内容

        /**
         * 获取内容
         * @return 内容
         */
        public String getContent() {
            return content;
        }

        /**
         * 设置内容
         * @param content 内容
         */
        public void setContent(String content) {
            this.content = content;
        }
    }

    /**
     * 剪藏响应类
     * 用于返回剪藏操作的响应结果
     */
    public static class ClipResponse {
        private Long id;  // 剪藏ID
        private String status;  // 操作状态

        /**
         * 构造函数
         * @param id 剪藏ID
         * @param status 操作状态
         */
        public ClipResponse(Long id, String status) {
            this.id = id;
            this.status = status;
        }

        /**
         * 获取剪藏ID
         * @return 剪藏ID
         */
        public Long getId() {
            return id;
        }

        /**
         * 设置剪藏ID
         * @param id 剪藏ID
         */
        public void setId(Long id) {
            this.id = id;
        }

        /**
         * 获取操作状态
         * @return 操作状态
         */
        public String getStatus() {
            return status;
        }

        /**
         * 设置操作状态
         * @param status 操作状态
         */
        public void setStatus(String status) {
            this.status = status;
        }
    }
}