package com.example.clip.controller;

import com.example.clip.config.PromptConfig;
import com.example.clip.core.AiService;
import com.example.clip.dto.ClipEditRequest;
import com.example.clip.dto.ClipRequest;
import com.example.clip.dto.ClipResponse;
import com.example.clip.dto.ClipToTodoRequest;
import com.example.clip.dto.OrganizeClipRequest;
import com.example.clip.dto.OrganizeInboxRequest;
import com.example.clip.dto.TagRequest;
import com.example.clip.model.ClipContent;
import com.example.clip.model.TodoContent;
import com.example.clip.service.AppConfigService;
import com.example.clip.service.ClipService;
import com.example.clip.service.ContentOrganizeService;
import com.example.clip.service.PromptConfigService;
import com.example.clip.service.SearchService;
import com.example.clip.service.TodoService;
import com.example.clip.service.WeeklyReportService;
import com.example.clip.service.UserActionEventRecorder;
import com.example.clip.index.WorkspaceIndexService;
import com.example.clip.index.WorkspaceMembership;
import com.example.clip.util.WorkspaceFilterUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.nio.file.Paths;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 剪藏内容 REST 控制器
 * <p>
 * 提供剪藏内容的全生命周期管理，包括：
 * <ul>
 *   <li>剪藏内容的增删改查（CRUD）</li>
 *   <li>AI 驱动的标签生成与智能分类</li>
 *   <li>全文搜索与分类搜索</li>
 *   <li>AI 发散性总结生成</li>
 *   <li>内容整理与收件箱管理</li>
 *   <li>剪藏转待办事项</li>
 *   <li>周报生成</li>
 *   <li>Prompt 配置管理</li>
 *   <li>存储目录打开</li>
 * </ul>
 * 所有接口均映射到 {@code /api/clip} 路径下，并允许跨域访问（供浏览器扩展使用）。
 * </p>
 *
 * @see ClipService
 * @see AiService
 * @see SearchService
 */
@RestController
@RequestMapping("/api/clip")
@CrossOrigin(origins = "*")  // 允许所有来源的跨域请求，包括浏览器扩展
public class ClipController {

    private static final Logger log = LoggerFactory.getLogger(ClipController.class);

    /** 剪藏内容核心业务服务 */
    private final ClipService clipService;
    /** 全文搜索服务，基于向量/关键词检索 */
    private final SearchService searchService;
    /** AI 大模型服务，提供标签生成、总结、分类等功能 */
    private final AiService aiService;
    /** 内容整理服务，负责将剪藏内容组织到文件系统 */
    private final ContentOrganizeService contentOrganizeService;
    /** 周报生成服务 */
    private final WeeklyReportService weeklyReportService;
    /** Prompt 模板配置服务 */
    private final PromptConfigService promptConfigService;
    /** 待办事项服务，用于剪藏转待办功能 */
    private final TodoService todoService;
    /** 应用配置服务，用于获取配置目录路径 */
    private final AppConfigService appConfigService;
    @Autowired(required = false)
    private UserActionEventRecorder actionEventRecorder;

    /**
     * 构造函数，通过依赖注入初始化所有服务组件
     *
     * @param clipService           剪藏内容服务
     * @param searchService          搜索服务
     * @param aiService              AI 服务
     * @param contentOrganizeService 内容整理服务
     * @param weeklyReportService    周报服务
     * @param promptConfigService    Prompt 配置服务
     * @param todoService            待办事项服务
     * @param appConfigService       应用配置服务
     */
    public ClipController(ClipService clipService, SearchService searchService, AiService aiService,
                          ContentOrganizeService contentOrganizeService, WeeklyReportService weeklyReportService,
                          PromptConfigService promptConfigService, TodoService todoService,
                          AppConfigService appConfigService) {
        this.clipService = clipService;
        this.searchService = searchService;
        this.aiService = aiService;
        this.contentOrganizeService = contentOrganizeService;
        this.weeklyReportService = weeklyReportService;
        this.promptConfigService = promptConfigService;
        this.todoService = todoService;
        this.appConfigService = appConfigService;
    }

    /**
     * 添加剪藏内容
     * <p>
     * POST /api/clip/add
     * <p>
     * 接收前端/浏览器扩展提交的剪藏请求，保存内容后根据用户偏好处理标签：
     * <ul>
     *   <li>如果用户提供了手动标签，覆盖 AI 生成的标签</li>
     *   <li>如果用户明确关闭 AI 标签且未提供手动标签，清除 AI 标签</li>
     *   <li>"store-only" 类型不做额外标签处理</li>
     * </ul>
     *
     * @param request 剪藏请求对象，包含内容、类型、标签、AI 标签开关等字段
     * @return 包含剪藏 ID 和 "success" 状态的响应
     */
    @PostMapping("/add")
    public ResponseEntity<?> addClip(@RequestBody ClipRequest request) {
        log.info("[API] /add called, type={}, useAiTags={}", request.getType(), request.getUseAiTags());
        // 去重：内容 + 来源 URL 一致时返回已有记录，避免重复剪藏
        ClipContent duplicate = clipService.findDuplicate(request);
        if (duplicate != null) {
            log.info("[API] /add duplicate detected, existing clipId={}", duplicate.getId());
            return ResponseEntity.ok(new ClipResponse(duplicate.getId(), "duplicate"));
        }
        // 保存剪藏内容，service 层会根据 useAiTags 决定是否调用 AI 生成标签
        ClipContent clip = clipService.saveClip(request);
        recordAction("content_created", "clip:" + clip.getId(), Map.of(
                "category", clip.getCategory() == null ? "" : clip.getCategory(),
                "tag", clip.getTags() == null || clip.getTags().isEmpty() ? "" : clip.getTags().get(0)));
        String savedType = clip.getType();

        // "store-only" 类型仅存储，不处理标签逻辑
        if (!"store-only".equals(savedType)) {
            // 用户提供了手动标签：覆盖 AI 生成的标签
            if (request.getTags() != null && !request.getTags().isEmpty()) {
                clip.setTags(request.getTags());
                clipService.saveClip(clip);
            }
            // 用户未提供手动标签且关闭了 AI 标签：清除 service 层可能生成的标签
            else if (request.getUseAiTags() == null || !request.getUseAiTags()) {
                // 注意：此处已在上层 else if 的上下文中，tags 必然为空，内层判断为冗余保护
                if (request.getTags() == null || request.getTags().isEmpty()) {
                    clip.setTags(new java.util.ArrayList<>());
                    clipService.saveClip(clip);
                }
            }
        }

        // 如果请求中携带了 workspaceId，自动创建成员关系关联到工作台
        if (request.getWorkspaceId() != null && !request.getWorkspaceId().isBlank()) {
            try {
                WorkspaceIndexService wsService = new WorkspaceIndexService(
                        Path.of(appConfigService.getConfigDirPath(), "index"));
                WorkspaceMembership membership = new WorkspaceMembership(
                        request.getWorkspaceId(),
                        "clip:" + clip.getId(),
                        "manual_input",
                        "工作台输入",
                        1.0,
                        null, 0,
                        LocalDateTime.now(), LocalDateTime.now());
                wsService.addMember(membership);
                log.info("event=clip.workspace_attached workspaceId={} clipId={} source=manual_input",
                        request.getWorkspaceId(), clip.getId());
            } catch (Exception e) {
                log.warn("event=clip.workspace_attach_failed workspaceId={} clipId={} error={}",
                        request.getWorkspaceId(), clip.getId(), e.getMessage());
            }
        }

        // 异步触发 AI 分析（pending 状态），保存立即返回
        clipService.triggerAsyncAnalysis(clip.getId());

        return ResponseEntity.ok(new ClipResponse(clip.getId(), "success"));
    }

    /**
     * 系统内部剪藏
     * <p>
     * POST /api/clip/system
     * <p>
     * 供系统内部调用，直接保存剪藏内容，不做额外的标签处理。
     *
     * @param request 剪藏请求对象
     * @return 包含剪藏 ID 和 "success" 状态的响应
     */
    @PostMapping("/system")
    public ResponseEntity<?> systemClip(@RequestBody ClipRequest request) {
        ClipContent clip = clipService.saveClip(request);
        recordAction("content_created", "clip:" + clip.getId(), Map.of("source", "system"));
        clipService.triggerAsyncAnalysis(clip.getId());
        return ResponseEntity.ok(new ClipResponse(clip.getId(), "success"));
    }

    /**
     * AI 生成标签
     * <p>
     * POST /api/clip/generate-tags
     * <p>
     * 调用 AI 服务根据内容文本自动生成标签列表，用于前端预览标签效果。
     *
     * @param request 标签请求，包含待分析的文本内容
     * @return AI 生成的标签列表
     */
    @PostMapping("/generate-tags")
    public ResponseEntity<List<String>> generateTags(@RequestBody TagRequest request) {
        List<String> tags = aiService.generateTags(request.getContent());
        return ResponseEntity.ok(tags);
    }

    /**
     * AI 智能整理
     * <p>
     * POST /api/clip/smart-organize
     * <p>
     * 调用 AI 对内容进行智能分类和标签生成，返回分类结果和标签建议。
     *
     * @param request 标签请求，包含待分析的内容
     * @return 包含分类（category）和标签（tags）的 Map
     */
    @PostMapping("/smart-organize")
    public ResponseEntity<Map<String, Object>> smartOrganize(@RequestBody TagRequest request) {
        Map<String, Object> result = aiService.smartOrganize(request.getContent());
        return ResponseEntity.ok(result);
    }

    /**
     * 获取分类树
     * <p>
     * GET /api/clip/categories
     * <p>
     * 返回预设的分类树结构，供前端渲染分类选择器。
     *
     * @return 分类树列表，每个节点包含 name、children 等字段
     */
    @GetMapping("/categories")
    public ResponseEntity<List<Map<String, Object>>> getCategories() {
        return ResponseEntity.ok(AiService.CATEGORY_TREE);
    }

    /**
     * 按分类获取剪藏内容
     * <p>
     * GET /api/clip/category/{category}
     *
     * @param category 分类名称（URL 路径变量）
     * @return 该分类下的所有剪藏内容列表
     */
    @GetMapping("/category/{category}")
    public ResponseEntity<List<ClipContent>> getClipsByCategory(@PathVariable(name = "category") String category) {
        List<ClipContent> clips = clipService.getClipsByCategory(category);
        return ResponseEntity.ok(clips);
    }

    /**
     * 获取剪藏列表（支持按工作流状态、工作区、关键词筛选）
     * <p>
     * GET /api/clip/list?workflowStatus=xxx&workspaceId=yyy&keyword=zzz
     * <p>
     * 所有参数均为可选：
     * <ul>
     *   <li>workflowStatus - 只返回对应工作流状态的剪藏（如 "inbox", "archived" 等）</li>
     *   <li>workspaceId    - 只返回对应工作区的剪藏</li>
     *   <li>keyword        - 按关键词模糊匹配标题、摘要、正文、来源、链接、标签等字段</li>
     * </ul>
     * 如果不传任何参数，返回全部剪藏内容。
     *
     * @param workflowStatus 可选的工作流状态过滤条件
     * @param workspaceId    可选的工作区过滤条件
     * @param keyword        可选的关键词模糊搜索条件
     * @return 剪藏内容列表
     */
    @GetMapping("/list")
    public ResponseEntity<List<ClipContent>> getClipList(
            @RequestParam(required = false) String workflowStatus,
            @RequestParam(required = false) String workspaceId,
            @RequestParam(required = false) String keyword) {
        // 根据是否传入 workflowStatus 决定调用哪个查询方法
        List<ClipContent> clips = (workflowStatus == null || workflowStatus.isBlank())
                ? clipService.getAllClips()
                : clipService.getClipsByWorkflowStatus(workflowStatus);
        if (workspaceId != null && !workspaceId.isBlank()) {
            clips = filterByWorkspace(clips, workspaceId);
        }
        if (keyword != null && !keyword.isBlank()) {
            clips = filterByKeyword(clips, keyword.trim());
        }
        return ResponseEntity.ok(clips);
    }

    /**
     * 按工作流状态获取剪藏内容
     * <p>
     * GET /api/clip/workflow/{workflowStatus}
     *
     * @param workflowStatus 工作流状态（如 "inbox", "organized", "archived" 等）
     * @return 对应状态的剪藏内容列表
     */
    @GetMapping("/workflow/{workflowStatus}")
    public ResponseEntity<List<ClipContent>> getClipsByWorkflowStatus(@PathVariable String workflowStatus) {
        return ResponseEntity.ok(clipService.getClipsByWorkflowStatus(workflowStatus));
    }

    /**
     * 获取收件箱中的剪藏内容
     * <p>
     * GET /api/clip/inbox
     * <p>
     * 收件箱是工作流状态为 {@link ClipService#WORKFLOW_INBOX} 的剪藏集合。
     *
     * @return 收件箱中的剪藏内容列表
     */
    @GetMapping("/inbox")
    public ResponseEntity<List<ClipContent>> getInboxClips() {
        return ResponseEntity.ok(clipService.getClipsByWorkflowStatus(ClipService.WORKFLOW_INBOX));
    }

    /**
     * 按 ID 获取单条剪藏，供文本编辑器双向打开内容。
     */
    @GetMapping("/{id}")
    public ResponseEntity<ClipContent> getClipById(@PathVariable(name = "id") Long id) {
        ClipContent clip = clipService.getClipById(id);
        return clip == null ? ResponseEntity.notFound().build() : ResponseEntity.ok(clip);
    }

    /**
     * 从文本编辑器更新剪藏的可编辑字段。
     * 服务层会保留 AI 分析、附件和创建时间，并处理跨分类文件迁移。
     */
    @PutMapping("/{id}/editor-content")
    public ResponseEntity<?> updateClipFromEditor(@PathVariable(name = "id") Long id,
                                                   @RequestBody ClipEditRequest request) {
        log.info("[API] editor update clip id={}, chars={}",
                id,
                request.getContent() == null ? 0 : request.getContent().length());
        ClipContent updated = clipService.updateClipFromEditor(id, request);
        if (updated == null) {
            return ResponseEntity.notFound().build();
        }
        recordAction("content_edited", "clip:" + updated.getId(), Map.of("source", "editor"));
        return ResponseEntity.ok(new ClipResponse(updated.getId(), "success"));
    }

    /**
     * 删除剪藏内容
     * <p>
     * DELETE /api/clip/{id}
     *
     * @param id 要删除的剪藏 ID
     * @return 包含 "success" 状态的响应
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<?> deleteClip(@PathVariable(name = "id") Long id) {
        clipService.deleteClip(id);
        recordAction("content_deleted", "clip:" + id, Map.of());
        return ResponseEntity.ok(new ClipResponse(null, "success"));
    }

    /**
     * 更新剪藏的"我的思考"字段
     * <p>
     * PUT /api/clip/{id}/thoughts
     * <p>
     * 允许用户对已保存的剪藏追加或修改自己的思考。
     * 请求体为 {"myThoughts": "..."}，可选字段，传空字符串可清空。
     *
     * @param id   剪藏 ID
     * @param body 包含 myThoughts 字段的 JSON 对象
     * @return 更新后的剪藏内容；若剪藏不存在则返回 404
     */
    @PutMapping("/{id}/thoughts")
    public ResponseEntity<?> updateThoughts(@PathVariable(name = "id") Long id, @RequestBody Map<String, String> body) {
        ClipContent clip = clipService.getClipById(id);
        if (clip == null) {
            return ResponseEntity.notFound().build();
        }
        String thoughts = body.getOrDefault("myThoughts", "");
        clip.setMyThoughts(thoughts.isEmpty() ? null : thoughts);
        clipService.saveClip(clip);
        recordAction("content_edited", "clip:" + id, Map.of("field", "myThoughts"));
        return ResponseEntity.ok(Map.of("status", "success", "myThoughts", clip.getMyThoughts() != null ? clip.getMyThoughts() : ""));
    }

    /**
     * 全文搜索剪藏内容
     * <p>
     * GET /api/clip/search?query=xxx&topK=5
     * <p>
     * 基于向量相似度或关键词匹配进行语义搜索。
     *
     * @param query 搜索关键词
     * @param topK  返回结果的最大数量，默认 5
     * @return 匹配的剪藏内容列表，按相关度排序
     */
    @GetMapping("/search")
    public ResponseEntity<List<ClipContent>> search(@RequestParam String query,
                                                    @RequestParam(defaultValue = "5") int topK) {
        List<ClipContent> results = searchService.search(query, topK);
        return ResponseEntity.ok(results);
    }

    /**
     * 按分类搜索剪藏内容
     * <p>
     * GET /api/clip/search/category?query=xxx&category=yyy&topK=5
     * <p>
     * 在指定分类范围内进行语义搜索。
     *
     * @param query    搜索关键词
     * @param category 限定搜索的分类
     * @param topK     返回结果的最大数量，默认 5
     * @return 匹配的剪藏内容列表
     */
    @GetMapping("/search/category")
    public ResponseEntity<List<ClipContent>> searchByCategory(@RequestParam String query,
                                                              @RequestParam String category,
                                                              @RequestParam(defaultValue = "5") int topK) {
        List<ClipContent> results = searchService.searchByCategory(query, category, topK);
        return ResponseEntity.ok(results);
    }

    /**
     * 获取发散性总结
     * <p>
     * GET /api/clip/divergent-summary/{id}
     * <p>
     * 使用 AI 对指定剪藏内容进行发散性思考和深度分析，生成总结。
     * 如果已存在缓存的总结，直接返回；否则调用 AI 生成并持久化。
     *
     * @param id 剪藏 ID
     * @return 发散性总结文本；若剪藏不存在则返回 404
     */
    @GetMapping("/divergent-summary/{id}")
    public ResponseEntity<String> getDivergentSummary(@PathVariable(name = "id") Long id) {
        ClipContent clip = clipService.getClipById(id);
        if (clip == null) {
            return ResponseEntity.notFound().build();
        }

        // 如果已有缓存的总结，直接返回，避免重复调用 AI
        if (clip.getDivergentSummary() != null && !clip.getDivergentSummary().isBlank()) {
            return ResponseEntity.ok(clip.getDivergentSummary());
        }

        // 调用 AI 生成发散性总结，并将结果持久化到数据库（Web Clipper 剪藏优先使用 bodyContent 正文）
        String summary = aiService.generateDivergentSummary(clipService.resolveAiSourceText(clip), clip.getCategory(), clip.getTags());
        clip.setDivergentSummary(summary);
        clipService.saveClip(clip);
        return ResponseEntity.ok(summary);
    }

    /**
     * 触发内容整理
     * <p>
     * POST /api/clip/organize
     * <p>
     * 调用内容整理服务对剪藏内容进行组织和分类，将结果写入文件系统。
     *
     * @return 整理结果（包含状态、消息等）
     */
    @PostMapping("/organize")
    public ResponseEntity<?> organizeContent() {
        return ResponseEntity.ok(contentOrganizeService.organizeContent());
    }

    /**
     * 整理收件箱中的剪藏内容
     * <p>
     * POST /api/clip/organize-inbox
     * <p>
     * 将收件箱中的剪藏内容批量整理到对应的分类目录中。
     *
     * @param request 可选的整理请求参数（如指定分类、是否强制覆盖等）
     * @return 整理结果，包含处理数量和状态
     */
    @PostMapping("/organize-inbox")
    public ResponseEntity<Map<String, Object>> organizeInbox(@RequestBody(required = false) OrganizeInboxRequest request) {
        return ResponseEntity.ok(clipService.organizeInbox(request));
    }

    /**
     * 整理单条剪藏内容
     * <p>
     * POST /api/clip/organize/{id}
     * <p>
     * 对指定 ID 的剪藏内容进行单独整理。
     *
     * @param id      剪藏 ID
     * @param request 可选的整理参数（如目标分类）
     * @return 整理结果；若剪藏不存在则返回 400 错误
     */
    @PostMapping("/organize/{id}")
    public ResponseEntity<?> organizeClip(@PathVariable(name = "id") Long id,
                                          @RequestBody(required = false) OrganizeClipRequest request) {
        try {
            return ResponseEntity.ok(clipService.organizeClip(id, request));
        } catch (IllegalArgumentException e) {
            // 参数非法（如剪藏不存在），返回 400
            return ResponseEntity.badRequest().body(Map.of(
                    "status", "error",
                    "message", e.getMessage()
            ));
        }
    }

    /**
     * 将剪藏内容转换为待办事项
     * <p>
     * POST /api/clip/to-todo
     * <p>
     * 从剪藏内容创建一条待办事项。标题优先使用请求中指定的 title，
     * 否则依次回退到剪藏的选中文本、摘要、标题，最终使用默认值。
     *
     * @param request 包含 clipId、title、priority、deadline、category 等字段
     * @return 包含新建待办 ID 和源剪藏 ID 的响应；若参数无效则返回 400
     */
    @PostMapping("/to-todo")
    public ResponseEntity<?> clipToTodo(@RequestBody ClipToTodoRequest request) {
        // 校验 clipId 必填
        if (request.getClipId() == null) {
            return ResponseEntity.badRequest().body(Map.of(
                    "status", "error",
                    "message", "clipId 不能为空"
            ));
        }

        // 查找源剪藏记录
        ClipContent clip = clipService.getClipById(request.getClipId());
        if (clip == null) {
            return ResponseEntity.badRequest().body(Map.of(
                    "status", "error",
                    "message", "未找到对应剪藏记录: " + request.getClipId()
            ));
        }

        // 构建待办事项对象
        TodoContent todo = new TodoContent();
        // 标题优先级：请求指定的 title > 剪藏的选中文本 > 摘要 > 标题 > 默认值
        String title = request.getTitle();
        if (title == null || title.isBlank()) {
            title = firstNonBlank(clip.getSelectedText(), clip.getSummary(), clip.getTitle(), "来自剪藏的待办");
        }
        todo.setTitle(title);
        // 优先级：请求值 > 默认 "medium"
        todo.setPriority(firstNonBlank(request.getPriority(), "medium"));
        todo.setDeadline(request.getDeadline());
        // 分类：请求值 > 剪藏分类 > 默认 "inbox"
        todo.setCategory(firstNonBlank(request.getCategory(), clip.getCategory(), "inbox"));
        todo.setCompleted(false);
        // 关联源剪藏信息
        todo.setSourceClipId(clip.getId());
        todo.setSourceUrl(clip.getSourceUrl());

        TodoContent saved = todoService.saveTodo(todo);
        if (saved == null) {
            return ResponseEntity.badRequest().body(Map.of(
                    "status", "error",
                    "message", "待办保存失败"
            ));
        }

        return ResponseEntity.ok(Map.of(
                "status", "success",
                "todoId", saved.getId(),
                "sourceClipId", clip.getId()
        ));
    }

    /**
     * 获取内容整理状态
     * <p>
     * GET /api/clip/organize/status
     * <p>
     * 返回最近一次内容整理的状态、消息和存储路径。
     *
     * @return 包含 status、message、storagePath 的 Map
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
     * <p>
     * POST /api/clip/open-storage-folder
     * <p>
     * 在服务器端操作系统上打开整理后的文件存储目录。
     * 根据操作系统类型（Windows/macOS/Linux）使用不同的命令。
     *
     * @return 操作结果，包含状态和存储路径；若目录不存在则返回 400
     */
    @PostMapping("/open-storage-folder")
    public ResponseEntity<Map<String, Object>> openStorageFolder() {
        try {
            String storagePath = contentOrganizeService.getOrganizedStoragePath();
            Path folderPath = Paths.get(storagePath);

            // 目录不存在时返回错误
            if (!Files.exists(folderPath)) {
                return ResponseEntity.badRequest().body(Map.of(
                        "status", "error",
                        "message", "存储目录不存在"
                ));
            }

            // 根据操作系统类型选择对应的文件管理器命令
            String os = System.getProperty("os.name").toLowerCase();
            ProcessBuilder processBuilder;

            if (os.contains("win")) {
                // Windows: 使用 explorer.exe 打开目录
                processBuilder = new ProcessBuilder("explorer.exe", storagePath);
            } else if (os.contains("mac")) {
                // macOS: 使用 open 命令
                processBuilder = new ProcessBuilder("open", storagePath);
            } else {
                // Linux 及其他 Unix 系统: 使用 xdg-open
                processBuilder = new ProcessBuilder("xdg-open", storagePath);
            }

            // 启动进程打开目录（不等待进程结束）
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
     * 生成周报
     * <p>
     * POST /api/clip/weekly-report
     * <p>
     * 调用周报服务，基于本周的剪藏内容生成周报。
     * 此接口是 ClipController 对 WeeklyReportService 的代理路由。
     *
     * @return 周报生成结果，包含状态、内容和存储路径
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
     * 获取 Prompt 配置
     * <p>
     * GET /api/clip/prompt-config
     * <p>
     * 返回当前生效的 Prompt 模板配置，包括系统提示词、用户提示词模板等。
     *
     * @return 当前 Prompt 配置对象
     */
    @GetMapping("/prompt-config")
    public ResponseEntity<PromptConfig> getPromptConfig() {
        return ResponseEntity.ok(promptConfigService.getPromptConfig());
    }

    /**
     * 保存 Prompt 配置
     * <p>
     * POST /api/clip/prompt-config
     * <p>
     * 更新 Prompt 模板配置并持久化。
     *
     * @param config 新的 Prompt 配置对象
     * @return 保存后的配置；若参数非法则返回 400
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
     * 重置 Prompt 配置为默认值
     * <p>
     * POST /api/clip/prompt-config/reset
     * <p>
     * 将 Prompt 配置恢复为系统预设的默认值，覆盖当前自定义配置。
     *
     * @return 重置后的默认 Prompt 配置
     */
    @PostMapping("/prompt-config/reset")
    public ResponseEntity<PromptConfig> resetPromptConfig() {
        return ResponseEntity.ok(promptConfigService.resetToDefault());
    }

    /**
     * 根据工作台规则筛选内容列表。
     * <p>
     * 委托给 {@link WorkspaceFilterUtils} 共享工具类。
     * </p>
     *
     * @param items       内容列表
     * @param workspaceId 工作台 ID
     * @param <T>         内容类型泛型
     * @return 筛选后的内容列表
     */
    private <T> List<T> filterByWorkspace(List<T> items, String workspaceId) {
        return WorkspaceFilterUtils.filterByWorkspace(items, workspaceId, appConfigService,
                item -> {
                    if (item instanceof ClipContent) return ((ClipContent) item).getId();
                    if (item instanceof com.example.clip.model.TodoContent) return ((com.example.clip.model.TodoContent) item).getId();
                    if (item instanceof com.example.clip.model.Knowledge) return ((com.example.clip.model.Knowledge) item).getId();
                    if (item instanceof com.example.clip.model.LearningPlan) return ((com.example.clip.model.LearningPlan) item).getId();
                    return null;
                });
    }

    /**
     * 按关键词模糊过滤剪藏内容
     * <p>
     * 匹配字段包括：标题、摘要、正文（content/bodyContent）、来源、原始链接、
     * 选中文本和标签。关键词匹配不区分大小写。
     *
     * @param clips   剪藏内容列表
     * @param keyword 搜索关键词（已 trim）
     * @return 匹配的剪藏内容列表
     */
    private List<ClipContent> filterByKeyword(List<ClipContent> clips, String keyword) {
        String kw = keyword.toLowerCase();
        return clips.stream()
                .filter(clip -> matchesKeyword(clip, kw))
                .collect(Collectors.toList());
    }

    private boolean matchesKeyword(ClipContent clip, String kw) {
        return containsIgnoreCase(clip.getTitle(), kw)
                || containsIgnoreCase(clip.getSummary(), kw)
                || containsIgnoreCase(clip.getContent(), kw)
                || containsIgnoreCase(clip.getBodyContent(), kw)
                || containsIgnoreCase(clip.getSource(), kw)
                || containsIgnoreCase(clip.getSourceUrl(), kw)
                || containsIgnoreCase(clip.getSelectedText(), kw)
                || (clip.getTags() != null
                    && clip.getTags().stream().anyMatch(tag -> containsIgnoreCase(tag, kw)));
    }

    private boolean containsIgnoreCase(String value, String kw) {
        return value != null && value.toLowerCase().contains(kw);
    }

    /**
     * 从候选字符串中返回第一个非空且非空白的内容
     * <p>
     * 用于实现字段值的优先级回退逻辑（fallback chain）。
     * 按参数顺序依次检查，返回第一个不为 null 且不为空白字符串的值（已 trim）。
     * 若所有候选值均为空，返回 null。
     *
     * @param candidates 候选字符串数组，按优先级从高到低排列
     * @return 第一个非空字符串（已去除首尾空格），或 null
     */
    private String firstNonBlank(String... candidates) {
        if (candidates == null) {
            return null;
        }
        for (String candidate : candidates) {
            if (candidate != null && !candidate.isBlank()) {
                return candidate.trim();
            }
        }
        return null;
    }

    /**
     * 迁移 Web Clipper 剪藏数据：读取 sourceFilePath 指向的文件内容，填充到 bodyContent 字段
     * <p>
     * 用于修复现有 Web Clipper 记录的 bodyContent 为空的问题，
     * 确保后续 AI 分析能使用原文全文而非仅标题。
     * </p>
     *
     * @return 迁移结果，包含 migratedCount 字段
     */
    @PostMapping("/migrate-webclipper")
    public ResponseEntity<Map<String, Object>> migrateWebClipper() {
        int count = clipService.migrateWebClipperRecords();
        return ResponseEntity.ok(Map.of("success", true, "migratedCount", count));
    }

    @PostMapping("/event")
    public ResponseEntity<Map<String, Object>> recordEvent(@RequestBody EventRequest eventRequest) {
        if (eventRequest != null && eventRequest.type() != null && !eventRequest.type().isBlank()) {
            recordAction(eventRequest.type(), eventRequest.contentId(), eventRequest.metadata());
        }
        return ResponseEntity.ok(Map.of("status", "ok"));
    }

    private void recordAction(String type, String contentId, Map<String, String> metadata) {
        if (actionEventRecorder != null) {
            actionEventRecorder.record(type, contentId, metadata);
        }
    }

    public record EventRequest(String type, String contentId, Map<String, String> metadata) {}
}
