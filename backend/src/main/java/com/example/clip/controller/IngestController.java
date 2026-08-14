package com.example.clip.controller;

import com.example.clip.core.AiService;
import com.example.clip.dto.ClipRequest;
import com.example.clip.model.ClipContent;
import com.example.clip.model.TodoContent;
import com.example.clip.model.Knowledge;
import com.example.clip.service.ClipService;
import com.example.clip.service.KnowledgeService;
import com.example.clip.service.TodoService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.*;

/**
 * 通用智能入库 REST 控制器。
 * <p>
 * 提供统一的文本入库接口，AI 自动识别意图（剪藏/待办/话题）并路由到对应模块。
 * 浏览器插件、TRAE Agent Skill、前端页面均可调用此接口。
 * </p>
 */
@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*")
public class IngestController {

    private static final Logger log = LoggerFactory.getLogger(IngestController.class);

    private final AiService aiService;
    private final ClipService clipService;
    private final TodoService todoService;
    private final KnowledgeService knowledgeService;

    public IngestController(AiService aiService, ClipService clipService,
                            TodoService todoService, KnowledgeService knowledgeService) {
        this.aiService = aiService;
        this.clipService = clipService;
        this.todoService = todoService;
        this.knowledgeService = knowledgeService;
    }

    /**
     * 智能入库：接收任意文本，AI 识别意图后路由入库。
     *
     * <pre>
     * POST /api/ingest
     * Content-Type: application/json
     * { "text": "明天下午3点前完成报告，高优先级" }
     * </pre>
     *
     * @param body 请求体，包含 text 字段
     * @return 统一响应格式 {@code { success, intent, id, title, redirect }}
     */
    @PostMapping("/ingest")
    public ResponseEntity<Map<String, Object>> ingest(@RequestBody Map<String, String> body) {
        // 1. 参数校验
        String text = body != null ? body.get("text") : null;
        if (text == null || text.trim().isEmpty()) {
            return ResponseEntity.badRequest().body(errorResponse("内容不能为空", "validation"));
        }
        text = text.trim();
        if (text.length() < 5) {
            return ResponseEntity.badRequest().body(errorResponse("内容过短，请提供至少 5 个字符", "validation"));
        }

        // 2. 意图识别
        String intent = null;
        boolean degraded = false;
        String degradedReason = null;
        try {
            intent = aiService.identifyIntent(text);
        } catch (Exception e) {
            log.warn("[Ingest] identifyIntent failed, degrade to clip: {}", e.getMessage());
        }
        if (intent == null) {
            intent = "clip";
            degraded = true;
            degradedReason = "AI 意图识别失败，已降级存储为剪藏";
        }

        // 3. 字段提取
        Map<String, Object> fields = null;
        try {
            fields = aiService.extractFields(text, intent);
        } catch (Exception e) {
            log.warn("[Ingest] extractFields failed for intent={}: {}", intent, e.getMessage());
        }
        if (fields == null) {
            fields = new HashMap<>();
            if (!degraded) {
                degraded = true;
                degradedReason = "AI 字段提取失败，已降级存储为剪藏";
            }
        }

        // 4. 路由入库
        try {
            return routeAndSave(intent, fields, text, degraded, degradedReason);
        } catch (Exception e) {
            log.error("[Ingest] save failed: {}", e.getMessage(), e);
            return ResponseEntity.status(500).body(errorResponse("存储失败: " + e.getMessage(), "storage_failed"));
        }
    }

    /**
     * 根据意图将数据路由到对应的 Service 保存。
     */
    private ResponseEntity<Map<String, Object>> routeAndSave(String intent, Map<String, Object> fields,
                                                              String rawText, boolean degraded, String degradedReason) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", true);
        result.put("intent", intent);
        if (degraded) {
            result.put("degraded", true);
            result.put("degradedReason", degradedReason);
        }

        switch (intent) {
            case "todo":
                return saveAsTodo(fields, rawText, result);
            case "topic":
            case "knowledge":
                return saveAsKnowledge(fields, rawText, result);
            case "clip":
            default:
                return saveAsClip(fields, rawText, result, degraded);
        }
    }

    /**
     * 保存为待办事项。
     */
    private ResponseEntity<Map<String, Object>> saveAsTodo(Map<String, Object> fields, String rawText,
                                                            Map<String, Object> result) {
        TodoContent todo = new TodoContent();
        todo.setTitle(getString(fields, "title", truncate(rawText, 50)));
        todo.setPriority(getString(fields, "priority", "medium"));
        todo.setDeadline(getString(fields, "deadline", null));
        todo.setDeadlineTime(getString(fields, "deadlineTime", null));
        todo.setCategory(getString(fields, "category", null));
        todo.setCompleted(false);

        TodoContent saved = todoService.saveTodo(todo);
        if (saved == null) {
            return ResponseEntity.status(500).body(errorResponse("待办保存失败", "storage_failed"));
        }
        result.put("id", saved.getId());
        result.put("title", saved.getTitle());
        result.put("redirect", "/api/todo/" + saved.getId());
        log.info("[Ingest] Saved as todo: id={}, title={}", saved.getId(), saved.getTitle());
        return ResponseEntity.ok(result);
    }

    /**
     * 保存为知识条目。
     */
    private ResponseEntity<Map<String, Object>> saveAsKnowledge(Map<String, Object> fields, String rawText,
                                                              Map<String, Object> result) {
        Knowledge knowledge = new Knowledge();
        knowledge.setTitle(getString(fields, "title", truncate(rawText, 50)));
        knowledge.setSummary(getString(fields, "summary", null));
        knowledge.setContent(getString(fields, "content", rawText));
        knowledge.setCategory(getString(fields, "category", null));
        knowledge.setTags(getStringList(fields, "tags"));

        Knowledge saved = knowledgeService.createKnowledge(knowledge);
        if (saved == null) {
            return ResponseEntity.status(500).body(errorResponse("知识保存失败", "storage_failed"));
        }
        result.put("id", saved.getId());
        result.put("title", saved.getTitle());
        result.put("redirect", "/api/knowledge/" + saved.getId());
        log.info("[Ingest] Saved as knowledge: id={}, title={}", saved.getId(), saved.getTitle());
        return ResponseEntity.ok(result);
    }

    /**
     * 保存为剪藏。
     */
    private ResponseEntity<Map<String, Object>> saveAsClip(Map<String, Object> fields, String rawText,
                                                            Map<String, Object> result, boolean degraded) {
        ClipRequest request = new ClipRequest();
        request.setContent(getString(fields, "content", rawText));
        request.setType(degraded ? "store-only" : "ai-text");
        request.setSource("system");
        request.setCategory(getString(fields, "category", null));
        request.setTitle(getString(fields, "title", truncate(rawText, 30)));
        request.setSourceUrl(getString(fields, "sourceUrl", null));
        request.setSiteName(getString(fields, "siteName", null));
        request.setTags(getStringList(fields, "tags"));
        request.setUseAiTags(!degraded);
        request.setWorkflowStatus("inbox");
        request.setCapturedAt(LocalDateTime.now().toString());

        ClipContent clip = clipService.saveClip(request);
        if (clip == null) {
            return ResponseEntity.status(500).body(errorResponse("剪藏保存失败", "storage_failed"));
        }
        // 如果 AI 提取了 summary/analysis，直接设置到剪藏实体并标记为就绪，避免重复异步分析
        if (!degraded) {
            String summary = getString(fields, "summary", null);
            String analysis = getString(fields, "analysis", null);
            if (summary != null || analysis != null) {
                if (summary != null) clip.setSummary(summary);
                if (analysis != null) clip.setAnalysis(analysis);
                clip.setAnalysisStatus(com.example.clip.service.ClipService.ANALYSIS_READY);
                clipService.saveClip(clip);
            }
        }
        // 其余 pending 状态触发异步 AI 分析
        clipService.triggerAsyncAnalysis(clip.getId());
        result.put("id", clip.getId());
        result.put("title", clip.getTitle());
        result.put("redirect", "/api/clip/" + clip.getId());
        log.info("[Ingest] Saved as clip: id={}, title={}", clip.getId(), clip.getTitle());
        return ResponseEntity.ok(result);
    }

    // ==================== 辅助方法 ====================

    private String getString(Map<String, Object> fields, String key, String defaultValue) {
        Object val = fields.get(key);
        if (val == null) return defaultValue;
        String s = val.toString().trim();
        return s.isEmpty() ? defaultValue : s;
    }

    @SuppressWarnings("unchecked")
    private List<String> getStringList(Map<String, Object> fields, String key) {
        Object val = fields.get(key);
        if (val instanceof List) {
            return (List<String>) val;
        }
        return null;
    }

    private String truncate(String text, int maxLen) {
        if (text == null) return "";
        return text.length() > maxLen ? text.substring(0, maxLen) : text;
    }

    private Map<String, Object> errorResponse(String error, String errorType) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", false);
        result.put("error", error);
        result.put("errorType", errorType);
        return result;
    }
}