package com.example.clip.controller;

import com.example.clip.dto.TopicRequest;
import com.example.clip.dto.TopicResponse;
import com.example.clip.model.Topic;
import com.example.clip.service.FileStorageService;
import com.example.clip.service.TopicService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.awt.Desktop;
import java.io.File;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 话题 REST API 控制器
 * 提供话题的 CRUD、搜索、互动等接口
 */
@RestController
@RequestMapping("/api/topic")
@CrossOrigin(origins = "*")
public class TopicController {

    private final TopicService topicService;
    private final FileStorageService storageService;

    public TopicController(TopicService topicService, FileStorageService storageService) {
        this.topicService = topicService;
        this.storageService = storageService;
    }

    /**
     * 创建话题
     */
    @PostMapping
    public ResponseEntity<TopicResponse> createTopic(@RequestBody TopicRequest request) {
        Topic topic = new Topic();
        topic.setTitle(request.getTitle());
        topic.setSummary(request.getSummary());
        topic.setContent(request.getContent());
        topic.setCoverImage(request.getCoverImage());
        topic.setCategory(request.getCategory());
        topic.setTags(request.getTags());
        topic.setSourceClipId(request.getSourceClipId());
        topic.setPublished(request.isPublished());

        Topic saved = topicService.createTopic(topic);
        if (saved == null) {
            return ResponseEntity.badRequest().build();
        }
        return ResponseEntity.ok(toResponse(saved));
    }

    /**
     * 更新话题
     */
    @PutMapping("/{id}")
    public ResponseEntity<TopicResponse> updateTopic(@PathVariable Long id, @RequestBody TopicRequest request) {
        Topic topic = topicService.getTopicById(id);
        if (topic == null) {
            return ResponseEntity.notFound().build();
        }

        topic.setTitle(request.getTitle());
        topic.setSummary(request.getSummary());
        topic.setContent(request.getContent());
        topic.setCoverImage(request.getCoverImage());
        topic.setCategory(request.getCategory());
        topic.setTags(request.getTags());
        topic.setPublished(request.isPublished());

        Topic updated = topicService.updateTopic(topic);
        return ResponseEntity.ok(toResponse(updated));
    }

    /**
     * 获取话题列表
     */
    @GetMapping("/list")
    public ResponseEntity<List<TopicResponse>> listTopics(
            @RequestParam(required = false) String category,
            @RequestParam(required = false) String keyword) {
        List<Topic> topics;
        if (keyword != null && !keyword.isEmpty()) {
            topics = topicService.searchTopics(keyword, category);
        } else if (category != null && !category.isEmpty()) {
            topics = topicService.searchTopics(null, category);
        } else {
            topics = topicService.getAllTopics();
        }
        return ResponseEntity.ok(topics.stream().map(this::toResponse).collect(Collectors.toList()));
    }

    /**
     * 获取话题详情
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
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, String>> deleteTopic(@PathVariable Long id) {
        topicService.deleteTopic(id);
        return ResponseEntity.ok(Map.of("status", "success"));
    }

    /**
     * 点赞
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
     * 从剪藏创建话题
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
     */
    @GetMapping("/storage-path")
    public ResponseEntity<Map<String, String>> getStoragePath() {
        Path topicPath = storageService.getTopicStoragePath();
        return ResponseEntity.ok(Map.of("path", topicPath.toAbsolutePath().toString()));
    }

    /**
     * 在文件管理器中打开话题存储目录
     */
    @PostMapping("/storage-path/open")
    public ResponseEntity<Map<String, String>> openStoragePath() {
        try {
            Path topicPath = storageService.getTopicStoragePath();
            File dir = topicPath.toFile();
            if (!dir.exists()) {
                dir.mkdirs();
            }
            if (Desktop.isDesktopSupported() && Desktop.getDesktop().isSupported(Desktop.Action.OPEN)) {
                Desktop.getDesktop().open(dir);
                return ResponseEntity.ok(Map.of("status", "success", "path", topicPath.toAbsolutePath().toString()));
            }
            return ResponseEntity.ok(Map.of("status", "unsupported", "path", topicPath.toAbsolutePath().toString()));
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("status", "error", "message", e.getMessage()));
        }
    }

    private TopicResponse toResponse(Topic topic) {
        TopicResponse response = new TopicResponse();
        response.setId(topic.getId());
        response.setTitle(topic.getTitle());
        response.setSummary(topic.getSummary());
        response.setContent(topic.getContent());
        response.setCoverImage(topic.getCoverImage());
        response.setCategory(topic.getCategory());
        response.setTags(topic.getTags());
        response.setSourceClipId(topic.getSourceClipId());
        response.setPublished(topic.isPublished());
        response.setLikeCount(topic.getLikeCount());
        response.setCreatedAt(topic.getCreatedAt());
        response.setUpdatedAt(topic.getUpdatedAt());
        return response;
    }
}