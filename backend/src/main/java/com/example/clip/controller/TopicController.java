package com.example.clip.controller;

import com.example.clip.dto.TopicRequest;
import com.example.clip.dto.TopicResponse;
import com.example.clip.model.Comment;
import com.example.clip.model.Topic;
import com.example.clip.service.FileStorageService;
import com.example.clip.service.TopicService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.File;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 话题 REST API 控制器
 * <p>
 * 提供话题（Topic）的全生命周期管理，包括：
 * <ul>
 *   <li>话题的创建、更新、删除、查询</li>
 *   <li>从剪藏内容一键创建话题</li>
 *   <li>话题搜索（按关键词和分类）</li>
 *   <li>话题点赞互动</li>
 *   <li>话题存储目录管理</li>
 * </ul>
 * 所有接口均映射到 {@code /api/topic} 路径下，并允许跨域访问。
 * </p>
 *
 * @see TopicService
 * @see FileStorageService
 */
@RestController
@RequestMapping("/api/topic")
@CrossOrigin(origins = "*")
public class TopicController {

    /** 话题核心业务服务 */
    private final TopicService topicService;
    /** 文件存储服务，管理话题文件的存储路径 */
    private final FileStorageService storageService;

    /**
     * 构造函数，通过依赖注入初始化服务组件
     *
     * @param topicService   话题服务
     * @param storageService 文件存储服务
     */
    public TopicController(TopicService topicService, FileStorageService storageService) {
        this.topicService = topicService;
        this.storageService = storageService;
    }

    /**
     * 创建话题
     * <p>
     * POST /api/topic
     * <p>
     * 接收话题数据，创建新的话题记录。从请求 DTO 中提取字段映射到实体对象后保存。
     *
     * @param request 话题创建请求，包含标题、摘要、内容、封面图、分类、标签等信息
     * @return 创建成功的话题响应；若保存失败则返回 400
     */
    @PostMapping
    public ResponseEntity<TopicResponse> createTopic(@RequestBody TopicRequest request) {
        // 将请求 DTO 映射为实体对象
        Topic topic = new Topic();
        topic.setTitle(request.getTitle());
        topic.setSummary(request.getSummary());
        topic.setContent(request.getContent());
        topic.setCategory(request.getCategory());
        topic.setTags(request.getTags());
        topic.setSourceClipId(request.getSourceClipId());
        topic.setPublished(request.isPublished());
        topic.setMyThoughts(request.getMyThoughts());

        Topic saved = topicService.createTopic(topic);
        if (saved == null) {
            return ResponseEntity.badRequest().build();
        }
        return ResponseEntity.ok(toResponse(saved));
    }

    /**
     * 更新话题
     * <p>
     * PUT /api/topic/{id}
     * <p>
     * 根据 ID 查找现有话题，用请求中的字段覆盖后保存。
     *
     * @param id      话题 ID
     * @param request 话题更新请求
     * @return 更新后的话题响应；若话题不存在则返回 404
     */
    @PutMapping("/{id}")
    public ResponseEntity<TopicResponse> updateTopic(@PathVariable Long id, @RequestBody TopicRequest request) {
        // 先查找话题，不存在则返回 404
        Topic topic = topicService.getTopicById(id);
        if (topic == null) {
            return ResponseEntity.notFound().build();
        }

        // 全量覆盖更新各字段
        topic.setTitle(request.getTitle());
        topic.setSummary(request.getSummary());
        topic.setContent(request.getContent());
        topic.setCategory(request.getCategory());
        topic.setTags(request.getTags());
        topic.setPublished(request.isPublished());
        topic.setMyThoughts(request.getMyThoughts());

        Topic updated = topicService.updateTopic(topic);
        return ResponseEntity.ok(toResponse(updated));
    }

    /**
     * 获取话题列表
     * <p>
     * GET /api/topic/list?category=xxx&keyword=yyy
     * <p>
     * 支持按分类和关键词组合筛选。若两者都为空，返回全部话题。
     *
     * @param category 可选的分类筛选条件
     * @param keyword  可选的搜索关键词（模糊匹配）
     * @return 话题响应列表
     */
    @GetMapping("/list")
    public ResponseEntity<List<TopicResponse>> listTopics(
            @RequestParam(required = false) String category,
            @RequestParam(required = false) String keyword) {
        List<Topic> topics;
        // 根据参数组合选择不同的查询策略
        if (keyword != null && !keyword.isEmpty()) {
            // 有关键词时，调用搜索服务（支持按分类进一步过滤）
            topics = topicService.searchTopics(keyword, category);
        } else if (category != null && !category.isEmpty()) {
            // 仅按分类筛选（传 null 关键词表示不过滤关键词）
            topics = topicService.searchTopics(null, category);
        } else {
            // 无任何过滤条件，返回全部
            topics = topicService.getAllTopics();
        }
        // 将实体列表转换为响应 DTO 列表
        return ResponseEntity.ok(topics.stream().map(this::toResponse).collect(Collectors.toList()));
    }

    /**
     * 获取话题详情
     * <p>
     * GET /api/topic/{id}
     *
     * @param id 话题 ID
     * @return 话题详情响应；若不存在则返回 404
     */
    @GetMapping("/{id}")
    public ResponseEntity<TopicResponse> getTopic(@PathVariable Long id) {
        Topic topic = topicService.getTopicById(id);
        if (topic == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(toResponse(topic));
    }

    /**
     * 删除话题
     * <p>
     * DELETE /api/topic/{id}
     *
     * @param id 话题 ID
     * @return 包含 "success" 状态的响应
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, String>> deleteTopic(@PathVariable Long id) {
        topicService.deleteTopic(id);
        return ResponseEntity.ok(Map.of("status", "success"));
    }

    /**
     * 点赞话题
     * <p>
     * POST /api/topic/{id}/like
     * <p>
     * 对指定话题执行点赞操作，likeCount 自增 1。
     *
     * @param id 话题 ID
     * @return 更新后的话题响应；若话题不存在则返回 404
     */
    @PostMapping("/{id}/like")
    public ResponseEntity<TopicResponse> likeTopic(@PathVariable Long id) {
        Topic topic = topicService.likeTopic(id);
        if (topic == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(toResponse(topic));
    }

    /**
     * 从剪藏内容创建话题
     * <p>
     * POST /api/topic/from-clip/{clipId}
     * <p>
     * 根据剪藏 ID 查找对应的剪藏内容，将其转换为话题。
     * 这是将碎片化剪藏升级为结构化话题的快捷入口。
     *
     * @param clipId 源剪藏内容 ID
     * @return 新创建的话题响应；若剪藏不存在或转换失败则返回 400
     */
    @PostMapping("/from-clip/{clipId}")
    public ResponseEntity<TopicResponse> createFromClip(@PathVariable Long clipId) {
        Topic topic = topicService.createFromClip(clipId);
        if (topic == null) {
            return ResponseEntity.badRequest().build();
        }
        return ResponseEntity.ok(toResponse(topic));
    }

    /**
     * 搜索话题
     * <p>
     * GET /api/topic/search?keyword=xxx&category=yyy
     * <p>
     * 按关键词和/或分类进行话题搜索，两个参数均为可选。
     *
     * @param keyword  可选的搜索关键词
     * @param category 可选的分类过滤
     * @return 匹配的话题响应列表
     */
    @GetMapping("/search")
    public ResponseEntity<List<TopicResponse>> searchTopics(
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) String category) {
        List<Topic> topics = topicService.searchTopics(keyword, category);
        return ResponseEntity.ok(topics.stream().map(this::toResponse).collect(Collectors.toList()));
    }

    /**
     * 获取话题存储目录路径
     * <p>
     * GET /api/topic/storage-path
     * <p>
     * 返回话题文件在服务器上的绝对存储路径，供前端展示或调试使用。
     *
     * @return 包含存储路径的 Map
     */
    @GetMapping("/storage-path")
    public ResponseEntity<Map<String, String>> getStoragePath() {
        Path topicPath = storageService.getTopicStoragePath();
        return ResponseEntity.ok(Map.of("path", topicPath.toAbsolutePath().toString()));
    }

    /**
     * 打开话题文件存储目录。
     * <p>
     * 使用 ProcessBuilder 启动系统文件管理器，跨平台兼容（Windows/macOS/Linux）。
     * 若目录不存在则自动创建。
     *
     * @return 操作结果，包含状态和路径
     */
    @PostMapping("/storage-path/open")
    public ResponseEntity<Map<String, String>> openStoragePath() {
        try {
            Path topicPath = storageService.getTopicStoragePath();
            File dir = topicPath.toFile();
            if (!dir.exists()) {
                dir.mkdirs();
            }

            String os = System.getProperty("os.name").toLowerCase();
            ProcessBuilder pb;
            if (os.contains("win")) {
                pb = new ProcessBuilder("explorer.exe", topicPath.toAbsolutePath().toString());
            } else if (os.contains("mac")) {
                pb = new ProcessBuilder("open", topicPath.toAbsolutePath().toString());
            } else {
                pb = new ProcessBuilder("xdg-open", topicPath.toAbsolutePath().toString());
            }
            pb.start();

            return ResponseEntity.ok(Map.of("status", "success", "path", topicPath.toAbsolutePath().toString()));
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("status", "error", "message", e.getMessage()));
        }
    }

    /**
     * 获取话题评论列表
     * <p>
     * GET /api/topic/{id}/comments
     *
     * @param id 话题 ID
     * @return 评论列表（按时间正序）
     */
    @GetMapping("/{id}/comments")
    public ResponseEntity<List<Comment>> getComments(@PathVariable Long id) {
        List<Comment> comments = topicService.getComments(id);
        return ResponseEntity.ok(comments);
    }

    /**
     * 添加评论
     * <p>
     * POST /api/topic/{id}/comments
     * <p>
     * 评论无需审核，直接发布可见。
     *
     * @param id      话题 ID
     * @param comment 评论对象（至少包含 content）
     * @return 保存后的评论；若话题不存在则返回 404
     */
    @PostMapping("/{id}/comments")
    public ResponseEntity<Comment> addComment(@PathVariable Long id, @RequestBody Comment comment) {
        Comment saved = topicService.addComment(id, comment);
        if (saved == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(saved);
    }

    /**
     * 将 Topic 实体转换为 TopicResponse DTO
     * <p>
     * 提取实体中的关键字段，构建前端所需的响应对象。
     * 这样做可以避免直接暴露实体内部结构，也便于后续扩展响应字段。
     *
     * @param topic 话题实体对象
     * @return 话题响应 DTO
     */
    private TopicResponse toResponse(Topic topic) {
        TopicResponse response = new TopicResponse();
        response.setId(topic.getId());
        response.setTitle(topic.getTitle());
        response.setSummary(topic.getSummary());
        response.setContent(topic.getContent());
        response.setCategory(topic.getCategory());
        response.setTags(topic.getTags());
        response.setSourceClipId(topic.getSourceClipId());
        response.setPublished(topic.isPublished());
        response.setMyThoughts(topic.getMyThoughts());
        response.setLikeCount(topic.getLikeCount());
        response.setCreatedAt(topic.getCreatedAt());
        response.setUpdatedAt(topic.getUpdatedAt());
        return response;
    }
}