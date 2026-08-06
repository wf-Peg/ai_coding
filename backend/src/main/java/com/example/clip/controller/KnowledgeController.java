package com.example.clip.controller;

import com.example.clip.core.AiService;
import com.example.clip.dto.KnowledgeRequest;
import com.example.clip.dto.KnowledgeResponse;
import com.example.clip.model.ClipContent;
import com.example.clip.model.Comment;
import com.example.clip.model.Knowledge;
import com.example.clip.service.ClipService;
import com.example.clip.service.FileStorageService;
import com.example.clip.service.KnowledgeService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.File;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 知识 REST API 控制器
 * <p>
 * 提供知识（Knowledge）的全生命周期管理，包括：
 * <ul>
 *   <li>知识的创建、更新、删除、查询</li>
 *   <li>从剪藏内容一键创建知识</li>
 *   <li>知识搜索（按关键词和分类）</li>
 *   <li>多剪藏 AI 综合创建知识</li>
 *   <li>知识存储目录管理</li>
 * </ul>
 * 所有接口均映射到 {@code /api/knowledge} 路径下，并允许跨域访问。
 * </p>
 *
 * @see KnowledgeService
 * @see FileStorageService
 */
@RestController
@RequestMapping("/api/knowledge")
@CrossOrigin(origins = "*")
public class KnowledgeController {

    /** 知识核心业务服务 */
    private final KnowledgeService knowledgeService;
    /** 文件存储服务，管理知识文件的存储路径 */
    private final FileStorageService storageService;
    /** AI 服务，用于知识合成等 AI 功能 */
    private final AiService aiService;
    /** 剪藏服务，用于获取剪藏内容 */
    private final ClipService clipService;

    private static final Logger logger = LoggerFactory.getLogger(KnowledgeController.class);

    /**
     * 构造函数，通过依赖注入初始化服务组件
     *
     * @param knowledgeService 知识服务
     * @param storageService   文件存储服务
     * @param aiService        AI 服务
     * @param clipService      剪藏服务
     */
    public KnowledgeController(KnowledgeService knowledgeService, FileStorageService storageService,
                               AiService aiService, ClipService clipService) {
        this.knowledgeService = knowledgeService;
        this.storageService = storageService;
        this.aiService = aiService;
        this.clipService = clipService;
    }

    /**
     * 创建知识条目
     * <p>
     * POST /api/knowledge
     *
     * @param request 知识创建请求
     * @return 创建成功的知识响应；若保存失败则返回 400
     */
    @PostMapping
    public ResponseEntity<KnowledgeResponse> createKnowledge(@RequestBody KnowledgeRequest request) {
        Knowledge knowledge = new Knowledge();
        knowledge.setTitle(request.getTitle());
        knowledge.setSummary(request.getSummary());
        knowledge.setContent(request.getContent());
        knowledge.setCategory(request.getCategory());
        knowledge.setTags(request.getTags());
        knowledge.setSourceClipIds(request.getSourceClipIds());
        knowledge.setMyThoughts(request.getMyThoughts());
        knowledge.setLinkedKnowledgeIds(request.getLinkedKnowledgeIds());

        Knowledge saved = knowledgeService.createKnowledge(knowledge);
        if (saved == null) {
            return ResponseEntity.badRequest().build();
        }
        return ResponseEntity.ok(toResponse(saved));
    }

    /**
     * 获取知识列表
     * <p>
     * GET /api/knowledge/list?category=xxx&keyword=yyy
     * <p>
     * 支持按分类和关键词组合筛选。若两者都为空，返回全部知识。
     *
     * @param category 可选的分类筛选条件
     * @param keyword  可选的搜索关键词（模糊匹配）
     * @return 知识响应列表
     */
    @GetMapping("/list")
    public ResponseEntity<List<KnowledgeResponse>> listKnowledge(
            @RequestParam(required = false) String category,
            @RequestParam(required = false) String keyword) {
        List<Knowledge> knowledges;
        if (keyword != null && !keyword.isEmpty()) {
            knowledges = knowledgeService.searchKnowledge(keyword, category);
        } else if (category != null && !category.isEmpty()) {
            knowledges = knowledgeService.searchKnowledge(null, category);
        } else {
            knowledges = knowledgeService.getAllKnowledge();
        }
        return ResponseEntity.ok(knowledges.stream().map(this::toResponse).collect(Collectors.toList()));
    }

    /**
     * 获取知识详情
     * <p>
     * GET /api/knowledge/{id}
     *
     * @param id 知识 ID
     * @return 知识详情响应；若不存在则返回 404
     */
    @GetMapping("/{id}")
    public ResponseEntity<KnowledgeResponse> getKnowledge(@PathVariable Long id) {
        Knowledge knowledge = knowledgeService.getKnowledgeById(id);
        if (knowledge == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(toResponse(knowledge));
    }

    /**
     * 更新知识条目
     * <p>
     * PUT /api/knowledge/{id}
     *
     * @param id      知识 ID
     * @param request 知识更新请求
     * @return 更新后的知识响应；若知识不存在则返回 404
     */
    @PutMapping("/{id}")
    public ResponseEntity<KnowledgeResponse> updateKnowledge(@PathVariable Long id, @RequestBody KnowledgeRequest request) {
        Knowledge knowledge = knowledgeService.getKnowledgeById(id);
        if (knowledge == null) {
            return ResponseEntity.notFound().build();
        }

        knowledge.setTitle(request.getTitle());
        knowledge.setSummary(request.getSummary());
        knowledge.setContent(request.getContent());
        knowledge.setCategory(request.getCategory());
        knowledge.setTags(request.getTags());
        knowledge.setSourceClipIds(request.getSourceClipIds());
        knowledge.setMyThoughts(request.getMyThoughts());
        knowledge.setLinkedKnowledgeIds(request.getLinkedKnowledgeIds());

        Knowledge updated = knowledgeService.updateKnowledge(knowledge);
        return ResponseEntity.ok(toResponse(updated));
    }

    /**
     * 删除知识条目
     * <p>
     * DELETE /api/knowledge/{id}
     *
     * @param id 知识 ID
     * @return 包含 "success" 状态的响应
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, String>> deleteKnowledge(@PathVariable Long id) {
        knowledgeService.deleteKnowledge(id);
        return ResponseEntity.ok(Map.of("status", "success"));
    }

    /**
     * 根据来源剪藏 ID 查找关联的知识条目
     * <p>
     * GET /api/knowledge/by-clip/{clipId}
     *
     * @param clipId 来源剪藏 ID
     * @return 关联的知识条目列表
     */
    @GetMapping("/by-clip/{clipId}")
    public ResponseEntity<List<KnowledgeResponse>> getKnowledgeByClipId(@PathVariable Long clipId) {
        List<Knowledge> knowledges = knowledgeService.getKnowledgeByClipId(clipId);
        return ResponseEntity.ok(knowledges.stream().map(this::toResponse).collect(Collectors.toList()));
    }

    /**
     * 从剪藏内容创建知识条目
     * <p>
     * POST /api/knowledge/from-clip/{clipId}
     *
     * @param clipId 源剪藏记录 ID
     * @return 新创建的知识响应；若剪藏不存在或转换失败则返回 400
     */
    @PostMapping("/from-clip/{clipId}")
    public ResponseEntity<KnowledgeResponse> createFromClip(@PathVariable Long clipId) {
        Knowledge knowledge = knowledgeService.createFromClip(clipId);
        if (knowledge == null) {
            return ResponseEntity.badRequest().build();
        }
        return ResponseEntity.ok(toResponse(knowledge));
    }

    /**
     * 综合多个剪藏内容，通过 AI 生成知识条目草稿。
     * <p>
     * POST /api/knowledge/synthesize
     * <p>
     * 接收一组剪藏 ID，读取对应的剪藏内容，调用 AI 进行综合分析，
     * 生成结构化的知识条目（标题、摘要、Markdown 正文）。
     * 知识条目不会自动保存——仅返回草稿供用户在前端编辑器预览和编辑。
     * </p>
     *
     * @param body 包含 clipIds 列表的请求体
     * @return 合成的知识响应草稿；若 AI 调用失败则返回 500
     */
    @PostMapping("/synthesize")
    public ResponseEntity<?> synthesizeKnowledge(@RequestBody Map<String, List<Long>> body) {
        List<Long> clipIds = body.get("clipIds");
        if (clipIds == null || clipIds.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "请至少选择一个剪藏"));
        }

        // 1. 获取所有剪藏内容
        StringBuilder combinedContent = new StringBuilder();
        for (int i = 0; i < clipIds.size(); i++) {
            ClipContent clip = clipService.getClipById(clipIds.get(i));
            if (clip != null) {
                if (i > 0) {
                    combinedContent.append("\n\n---\n\n");
                }
                combinedContent.append("### 剪藏 #").append(i + 1);
                if (clip.getTitle() != null && !clip.getTitle().isEmpty()) {
                    combinedContent.append(": ").append(clip.getTitle());
                }
                combinedContent.append("\n");
                combinedContent.append(clip.getContent() != null ? clip.getContent() : "");
            }
        }

        if (combinedContent.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "未找到任何有效的剪藏内容"));
        }

        // 2. 调用 AI 合成知识
        try {
            Map<String, String> synthesized = aiService.synthesizeKnowledgeContent(combinedContent.toString());
            if (synthesized == null) {
                return ResponseEntity.status(500)
                        .body(Map.of("error", "AI 合成失败，请稍后重试或手动创建知识条目"));
            }

            // 3. 构建响应（不保存，仅返回草稿）
            KnowledgeResponse response = new KnowledgeResponse();
            response.setTitle(synthesized.getOrDefault("title", ""));
            response.setSummary(synthesized.getOrDefault("summary", ""));
            response.setContent(synthesized.getOrDefault("content", ""));
            response.setSourceClipIds(clipIds);
            response.setSourceCount(clipIds.size());

            return ResponseEntity.ok(response);
        } catch (Exception e) {
            logger.error("[KnowledgeController] synthesizeKnowledge failed: {}", e.getMessage(), e);
            return ResponseEntity.status(500)
                    .body(Map.of("error", "AI 合成失败，请稍后重试或手动创建知识条目"));
        }
    }

    /**
     * 获取知识存储目录路径
     * <p>
     * GET /api/knowledge/storage-path
     *
     * @return 包含存储路径的 Map
     */
    @GetMapping("/storage-path")
    public ResponseEntity<Map<String, String>> getStoragePath() {
        Path knowledgePath = storageService.getKnowledgeStoragePath();
        return ResponseEntity.ok(Map.of("path", knowledgePath.toAbsolutePath().toString()));
    }

    /**
     * 打开知识文件存储目录
     * <p>
     * 使用 ProcessBuilder 启动系统文件管理器，跨平台兼容（Windows/macOS/Linux）。
     * 若目录不存在则自动创建。
     *
     * @return 操作结果，包含状态和路径
     */
    @PostMapping("/storage-path/open")
    public ResponseEntity<Map<String, String>> openStoragePath() {
        try {
            Path knowledgePath = storageService.getKnowledgeStoragePath();
            File dir = knowledgePath.toFile();
            if (!dir.exists()) {
                dir.mkdirs();
            }

            String os = System.getProperty("os.name").toLowerCase();
            ProcessBuilder pb;
            if (os.contains("win")) {
                pb = new ProcessBuilder("explorer.exe", knowledgePath.toAbsolutePath().toString());
            } else if (os.contains("mac")) {
                pb = new ProcessBuilder("open", knowledgePath.toAbsolutePath().toString());
            } else {
                pb = new ProcessBuilder("xdg-open", knowledgePath.toAbsolutePath().toString());
            }
            pb.start();

            return ResponseEntity.ok(Map.of("status", "success", "path", knowledgePath.toAbsolutePath().toString()));
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("status", "error", "message", e.getMessage()));
        }
    }

    // ==================== 讨论功能 ====================

    /**
     * 获取知识条目的评论列表
     * <p>
     * GET /api/knowledge/{id}/comments
     *
     * @param id 知识条目 ID
     * @return 评论列表
     */
    @GetMapping("/{id}/comments")
    public ResponseEntity<List<Comment>> getComments(@PathVariable Long id) {
        List<Comment> comments = storageService.getCommentsByKnowledgeId(id);
        return ResponseEntity.ok(comments);
    }

    /**
     * 发布评论
     * <p>
     * POST /api/knowledge/{id}/comments
     * <p>
     * 请求体：{ "author": "昵称", "content": "评论内容" }
     *
     * @param id      知识条目 ID
     * @param comment 评论对象（包含 author 和 content）
     * @return 保存后的评论
     */
    @PostMapping("/{id}/comments")
    public ResponseEntity<Comment> addComment(@PathVariable Long id, @RequestBody Comment comment) {
        comment.setKnowledgeId(id);
        Comment saved = storageService.saveComment(comment);
        if (saved == null) {
            return ResponseEntity.status(500).build();
        }
        return ResponseEntity.ok(saved);
    }

    /**
     * 更新评论
     * <p>
     * PUT /api/knowledge/{id}/comments/{commentId}
     *
     * @param id        知识条目 ID
     * @param commentId 评论 ID
     * @param comment   更新后的评论对象
     * @return 更新后的评论
     */
    @PutMapping("/{id}/comments/{commentId}")
    public ResponseEntity<Comment> updateComment(@PathVariable Long id, @PathVariable Long commentId, @RequestBody Comment comment) {
        comment.setId(commentId);
        comment.setKnowledgeId(id);
        Comment saved = storageService.saveComment(comment);
        if (saved == null) {
            return ResponseEntity.status(500).build();
        }
        return ResponseEntity.ok(saved);
    }

    /**
     * 删除评论
     * <p>
     * DELETE /api/knowledge/{id}/comments/{commentId}
     *
     * @param id        知识条目 ID
     * @param commentId 评论 ID
     * @return 操作结果
     */
    @DeleteMapping("/{id}/comments/{commentId}")
    public ResponseEntity<Map<String, Object>> deleteComment(@PathVariable Long id, @PathVariable Long commentId) {
        boolean removed = storageService.deleteComment(id, commentId);
        if (removed) {
            return ResponseEntity.ok(Map.of("status", "success"));
        }
        return ResponseEntity.status(404).body(Map.of("status", "error", "message", "评论不存在"));
    }

    /**
     * 将 Knowledge 实体转换为 KnowledgeResponse DTO
     *
     * @param knowledge 知识实体对象
     * @return 知识响应 DTO
     */
    private KnowledgeResponse toResponse(Knowledge knowledge) {
        KnowledgeResponse response = new KnowledgeResponse();
        response.setId(knowledge.getId());
        response.setTitle(knowledge.getTitle());
        response.setSummary(knowledge.getSummary());
        response.setContent(knowledge.getContent());
        response.setCategory(knowledge.getCategory());
        response.setTags(knowledge.getTags());
        response.setSourceClipIds(knowledge.getSourceClipIds());
        response.setMyThoughts(knowledge.getMyThoughts());
        response.setLinkedKnowledgeIds(knowledge.getLinkedKnowledgeIds());
        response.setSourceCount(knowledge.getSourceClipIds() != null ? knowledge.getSourceClipIds().size() : 0);
        response.setLinkedCount(knowledge.getLinkedKnowledgeIds() != null ? knowledge.getLinkedKnowledgeIds().size() : 0);
        response.setCreatedAt(knowledge.getCreatedAt());
        response.setUpdatedAt(knowledge.getUpdatedAt());
        return response;
    }
}