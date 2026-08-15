package com.example.clip.controller;

import com.example.clip.config.PromptTemplate;
import com.example.clip.service.PromptLibraryService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 提示词库（Prompt Library）REST API 控制器。
 * <p>
 * 提供提示词模板的列表 / 槽位 / 新建 / 更新 / 删除 / 收藏 / 应用到系统槽位 / LangGPT 导入。
 * </p>
 *
 * @see PromptLibraryService
 */
@RestController
@RequestMapping("/api/prompt-library")
@CrossOrigin(origins = "*")
public class PromptLibraryController {

    private static final Logger logger = LoggerFactory.getLogger(PromptLibraryController.class);

    private final PromptLibraryService promptLibraryService;

    public PromptLibraryController(PromptLibraryService promptLibraryService) {
        this.promptLibraryService = promptLibraryService;
    }

    /**
     * 列出全部提示词模板（收藏优先）。
     */
    @GetMapping
    public ResponseEntity<Map<String, Object>> listPrompts() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("prompts", promptLibraryService.listPrompts());
        return ResponseEntity.ok(result);
    }

    /**
     * 列出系统槽位元数据。
     */
    @GetMapping("/slots")
    public ResponseEntity<Map<String, Object>> listSlots() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("slots", promptLibraryService.listSlots());
        return ResponseEntity.ok(result);
    }

    /**
     * 新建模板。
     */
    @PostMapping
    public ResponseEntity<?> createPrompt(@RequestBody Map<String, Object> body) {
        try {
            PromptTemplate t = promptLibraryService.createPrompt(
                    str(body.get("name")),
                    str(body.get("category")),
                    str(body.get("description")),
                    str(body.get("content")),
                    strList(body.get("tags")),
                    str(body.get("slot")),
                    bool(body.get("langgpt")),
                    strMap(body.get("sections")));
            return ResponseEntity.ok(t);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            logger.error("[PromptLibrary] 新建模板失败: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("error", "新建失败: " + e.getMessage()));
        }
    }

    /**
     * 更新模板。
     */
    @PutMapping("/{id}")
    public ResponseEntity<?> updatePrompt(@PathVariable String id, @RequestBody Map<String, Object> body) {
        try {
            PromptTemplate t = promptLibraryService.updatePrompt(
                    id,
                    str(body.get("name")),
                    str(body.get("category")),
                    str(body.get("description")),
                    str(body.get("content")),
                    strList(body.get("tags")),
                    str(body.get("slot")),
                    bool(body.get("langgpt")),
                    strMap(body.get("sections")));
            return ResponseEntity.ok(t);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            logger.error("[PromptLibrary] 更新模板失败: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("error", "更新失败: " + e.getMessage()));
        }
    }

    /**
     * 删除模板（内置不可删除）。
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<?> deletePrompt(@PathVariable String id) {
        try {
            boolean deleted = promptLibraryService.deletePrompt(id);
            if (!deleted) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "模板不存在: " + id));
            }
            return ResponseEntity.ok(Map.of("success", true, "id", id));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            logger.error("[PromptLibrary] 删除模板失败: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("error", "删除失败: " + e.getMessage()));
        }
    }

    /**
     * 设置收藏状态。
     */
    @PatchMapping("/{id}/favorite")
    public ResponseEntity<?> toggleFavorite(@PathVariable String id, @RequestBody Map<String, Object> body) {
        try {
            PromptTemplate t = promptLibraryService.toggleFavorite(id, bool(body.get("favorite")));
            return ResponseEntity.ok(t);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            logger.error("[PromptLibrary] 收藏操作失败: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("error", "操作失败: " + e.getMessage()));
        }
    }

    /**
     * 将模板应用到系统槽位。
     */
    @PostMapping("/{id}/apply")
    public ResponseEntity<?> applyToSlot(@PathVariable String id, @RequestBody Map<String, Object> body) {
        try {
            String slot = str(body.get("slot"));
            PromptTemplate t = promptLibraryService.applyToSlot(id, slot);
            return ResponseEntity.ok(Map.of("success", true, "template", t, "slot", slot));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            logger.error("[PromptLibrary] 应用到槽位失败: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("error", "应用失败: " + e.getMessage()));
        }
    }

    /**
     * 导入 LangGPT 结构化提示词。
     * <p>body: {name?, category?, text}，解析后创建模板并返回。</p>
     */
    @PostMapping("/import-langgpt")
    public ResponseEntity<?> importLangGpt(@RequestBody Map<String, Object> body) {
        try {
            String text = str(body.get("text"));
            Map<String, Object> parsed = promptLibraryService.parseLangGpt(text);
            String name = str(body.get("name"));
            if (name == null || name.isEmpty()) {
                name = (String) parsed.get("name");
            }
            if (name == null || name.isEmpty()) {
                name = "LangGPT 提示词";
            }
            @SuppressWarnings("unchecked")
            Map<String, String> sections = (Map<String, String>) parsed.get("sections");
            PromptTemplate t = promptLibraryService.createPrompt(
                    name,
                    str(body.get("category")),
                    str(body.get("description")),
                    (String) parsed.get("content"),
                    new ArrayList<>(),
                    null,
                    Boolean.TRUE.equals(parsed.get("langgpt")),
                    sections);
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("template", t);
            result.put("parsed", parsed);
            return ResponseEntity.ok(result);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            logger.error("[PromptLibrary] 导入 LangGPT 失败: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("error", "导入失败: " + e.getMessage()));
        }
    }

    // ==================== 辅助 ====================

    private String str(Object o) {
        return o == null ? null : o.toString();
    }

    private boolean bool(Object o) {
        return Boolean.TRUE.equals(o);
    }

    @SuppressWarnings("unchecked")
    private List<String> strList(Object o) {
        if (o instanceof List) {
            return (List<String>) o;
        }
        return new ArrayList<>();
    }

    @SuppressWarnings("unchecked")
    private Map<String, String> strMap(Object o) {
        if (o instanceof Map) {
            Map<Object, Object> raw = (Map<Object, Object>) o;
            Map<String, String> result = new LinkedHashMap<>();
            for (Map.Entry<Object, Object> e : raw.entrySet()) {
                result.put(e.getKey().toString(), e.getValue() == null ? "" : e.getValue().toString());
            }
            return result;
        }
        return new LinkedHashMap<>();
    }
}