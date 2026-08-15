package com.example.clip.controller;

import com.example.clip.config.WikiConfig;
import com.example.clip.service.wiki.WikiIndexService;
import com.example.clip.service.wiki.WikiPageService;
import com.example.clip.service.wiki.WikiQueryService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter.SseEventBuilder;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Wiki 综合查询 REST 控制器。
 * <p>
 * 提供基于两步查询流程（index 定位 → 页面综合）的 Wiki 查询接口，
 * 支持查询、归档为综述页、读取索引和列出所有页面。
 * </p>
 *
 * <h3>接口列表</h3>
 * <ul>
 *   <li>{@code POST /api/wiki/query}   — 综合查询，返回答案 + 相关页面 + Token 估算</li>
 *   <li>{@code POST /api/wiki/archive} — 将查询答案归档为 synthesis 综述页</li>
 *   <li>{@code GET  /api/wiki/index}   — 读取 wiki/index.md 内容</li>
 *   <li>{@code GET  /api/wiki/pages}   — 列出所有 Wiki 页面（按类型分组）</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/wiki")
@CrossOrigin(origins = "*")
public class WikiQueryController {

    private static final Logger log = LoggerFactory.getLogger(WikiQueryController.class);

    private final WikiQueryService wikiQueryService;
    private final WikiIndexService wikiIndexService;
    private final WikiPageService wikiPageService;
    private final WikiConfig wikiConfig;

    /**
     * 构造器注入。
     *
     * @param wikiQueryService Wiki 查询服务
     * @param wikiIndexService Wiki 索引服务
     * @param wikiPageService  Wiki 页面服务
     * @param wikiConfig       Wiki 配置
     */
    public WikiQueryController(WikiQueryService wikiQueryService,
                               WikiIndexService wikiIndexService,
                               WikiPageService wikiPageService,
                               WikiConfig wikiConfig) {
        this.wikiQueryService = wikiQueryService;
        this.wikiIndexService = wikiIndexService;
        this.wikiPageService = wikiPageService;
        this.wikiConfig = wikiConfig;
    }

    /**
     * 执行 Wiki 综合查询。
     * <p>
     * 两步流程：index 定位（本地拆词优先，LLM 兜底）→ 页面综合（强模型），
     * 返回 Markdown 答案、相关页面列表与 Token 估算。
     * 请求体可携带 {@code includeClips} / {@code includeKnowledge} 覆盖
     * WikiConfig 的默认多数据源开关。
     * </p>
     *
     * @param body 请求体 {@code {"question": "...", "includeClips": true, "includeKnowledge": false}}
     * @return 查询结果 Map
     */
    @PostMapping("/query")
    public ResponseEntity<Map<String, Object>> query(@RequestBody Map<String, Object> body) {
        String question = body != null ? (String) body.get("question") : null;
        boolean includeClips = body != null && Boolean.TRUE.equals(body.get("includeClips"));
        boolean includeKnowledge = body != null && Boolean.TRUE.equals(body.get("includeKnowledge"));
        log.info("[WikiQuery] Query request received");
        Map<String, Object> result = wikiQueryService.query(question, includeClips, includeKnowledge);
        return ResponseEntity.ok(result);
    }

    /**
     * 执行 Wiki 综合查询（SSE 流式进度）。
     * <p>
     * 与 {@code POST /api/wiki/query} 语义一致，但通过 Server-Sent Events 实时推送
     * 查询各阶段（读取索引 → 定位页面 → 读取内容 → 补充资源 → 生成答案 → 完成）的进度，
     * 便于前端展示类似"思维链"的执行过程。完成时推送 {@code complete} 事件携带完整结果。
     * </p>
     *
     * @param question         用户问题
     * @param includeClips     是否纳入应用内剪藏内容
     * @param includeKnowledge 是否纳入知识条目内容
     * @return SSE 流 {@code progress} / {@code complete} 事件
     */
    @GetMapping(value = "/query/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter queryStream(@RequestParam String question,
                                  @RequestParam(defaultValue = "false") boolean includeClips,
                                  @RequestParam(defaultValue = "false") boolean includeKnowledge) {
        // 5 分钟超时
        SseEmitter emitter = new SseEmitter(300_000L);
        log.info("[WikiQuery] SSE stream request received");

        new Thread(() -> {
            try {
                WikiQueryService.ProgressCallback callback = (stage, message) -> {
                    try {
                        SseEventBuilder event = SseEmitter.event()
                                .name("progress")
                                .data(Map.of("stage", stage, "message", message));
                        emitter.send(event);
                    } catch (Exception e) {
                        log.warn("[WikiQuery] Failed to send progress event: {}", e.getMessage());
                    }
                };
                Map<String, Object> result = wikiQueryService.query(question, includeClips, includeKnowledge, callback);
                SseEventBuilder complete = SseEmitter.event().name("complete").data(result);
                emitter.send(complete);
                emitter.complete();
            } catch (Exception e) {
                log.error("[WikiQuery] SSE stream failed: {}", e.getMessage(), e);
                // 尽量将错误信息推送给前端
                try {
                    SseEventBuilder error = SseEmitter.event()
                            .name("error")
                            .data(Map.of("message", e.getMessage() != null ? e.getMessage() : "Unknown error"));
                    emitter.send(error);
                } catch (Exception ignored) {
                    // ignore
                }
                emitter.completeWithError(e);
            }
        }).start();

        return emitter;
    }

    /**
     * 将一次查询的答案归档为 synthesis 综述页。
     *
     * @param body 请求体 {@code {"title": "...", "answer": "..."}}
     * @return 归档结果 Map
     */
    @PostMapping("/archive")
    public ResponseEntity<Map<String, Object>> archive(@RequestBody Map<String, Object> body) {
        String title = body != null ? (String) body.get("title") : null;
        String answer = body != null ? (String) body.get("answer") : null;
        log.info("[WikiQuery] Archive request received for title: {}", title);
        Map<String, Object> result = wikiQueryService.archiveAsSynthesis(title, answer);
        return ResponseEntity.ok(result);
    }

    /**
     * 读取 wiki/index.md 内容。
     *
     * @return {@code {"content": "..."}}；索引不存在时返回空内容
     */
    @GetMapping("/index")
    public ResponseEntity<Map<String, Object>> getIndex() {
        Map<String, Object> result = new LinkedHashMap<>();
        try {
            Path indexPath = wikiIndexService.getIndexPath();
            String content = wikiPageService.readPage(indexPath);
            result.put("content", content != null ? content : "");
        } catch (Exception e) {
            log.error("[WikiQuery] Failed to read index: {}", e.getMessage(), e);
            result.put("content", "");
            result.put("error", e.getMessage());
        }
        return ResponseEntity.ok(result);
    }

    /**
     * 列出所有 Wiki 页面（按配置的页面类型遍历）。
     * <p>
     * 返回 {@code {"pages": [{type, name, path}, ...]}}。
     * </p>
     *
     * @return 所有页面列表
     */
    @GetMapping("/pages")
    public ResponseEntity<Map<String, Object>> listPages() {
        Map<String, Object> result = new LinkedHashMap<>();
        List<Map<String, String>> pages = new ArrayList<>();
        try {
            for (String pageType : wikiConfig.getPageTypes()) {
                try {
                    List<Path> files = wikiPageService.listPages(pageType);
                    if (files == null) {
                        continue;
                    }
                    for (Path file : files) {
                        Map<String, String> entry = new LinkedHashMap<>();
                        entry.put("type", pageType);
                        String fileName = file.getFileName().toString();
                        // 去除 .md 扩展名作为 name
                        if (fileName.endsWith(".md")) {
                            fileName = fileName.substring(0, fileName.length() - 3);
                        }
                        entry.put("name", fileName);
                        entry.put("path", file.toString());
                        pages.add(entry);
                    }
                } catch (Exception e) {
                    log.warn("[WikiQuery] Failed to list pages for type '{}': {}", pageType, e.getMessage());
                }
            }
        } catch (Exception e) {
            log.error("[WikiQuery] Failed to list pages: {}", e.getMessage(), e);
        }
        result.put("pages", pages);
        return ResponseEntity.ok(result);
    }
}
