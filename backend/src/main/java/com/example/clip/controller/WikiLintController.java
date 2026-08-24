package com.example.clip.controller;

import com.example.clip.service.wiki.WikiLintService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter.SseEventBuilder;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Wiki 按需 Lint REST 控制器。
 * <p>
 * 提供手动触发的 Wiki 健康检查接口。Lint 是按需触发（非定时），
 * 用户点击按钮后同步等待结果。支持读取上次生成的 lint-report.md，
 * 以及通过 SSE 流式推送 lint 过程中的实时进度。
 * </p>
 *
 * <h3>接口列表</h3>
 * <ul>
 *   <li>{@code POST /api/wiki/lint}         — 触发 lint（同步执行）</li>
 *   <li>{@code GET  /api/wiki/lint/stream}  — 触发 lint（SSE 流式进度）</li>
 *   <li>{@code GET  /api/wiki/lint/report}  — 读取 lint-report.md 内容</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/wiki/lint")
@CrossOrigin(origins = "*")
public class WikiLintController {

    private static final Logger log = LoggerFactory.getLogger(WikiLintController.class);

    private final WikiLintService wikiLintService;

    /**
     * 构造器注入。
     *
     * @param wikiLintService Wiki Lint 服务
     */
    public WikiLintController(WikiLintService wikiLintService) {
        this.wikiLintService = wikiLintService;
    }

    /**
     * 触发 Wiki 健康检查（lint）。
     * <p>
     * 按需触发，同步执行：用户等待结果返回。返回 lint 结果 Map，
     * 含 status / totalPages / pagesScanned / pagesSkipped / issues / issueCount / message。
     * </p>
     *
     * @return lint 结果 Map
     */
    @PostMapping
    public ResponseEntity<Map<String, Object>> lint() {
        log.info("[WikiLint] Manual lint triggered");
        Map<String, Object> result = wikiLintService.lint();
        return ResponseEntity.ok(result);
    }

    /**
     * 触发 Wiki 健康检查（lint）（SSE 流式进度）。
     * <p>
     * 通过 Server-Sent Events 实时推送 lint 各阶段（读取页面 → 加载缓存 →
     * 比对变更 → AI 检测 → 生成报告 → 完成/失败）的进度，完成时推送
     * {@code complete} 事件携带完整结果。
     * </p>
     *
     * @return SSE 流 {@code progress} / {@code complete} 事件
     */
    @GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter lintStream() {
        // 5 分钟超时
        SseEmitter emitter = new SseEmitter(300_000L);
        log.info("[WikiLint] SSE stream request received");

        new Thread(() -> {
            try {
                WikiLintService.ProgressCallback callback = (stage, message) -> {
                    try {
                        SseEventBuilder event = SseEmitter.event()
                                .name("progress")
                                .data(Map.of("stage", stage, "message", message));
                        emitter.send(event);
                    } catch (Exception e) {
                        log.warn("[WikiLint] Failed to send progress event: {}", e.getMessage());
                    }
                };
                Map<String, Object> result = wikiLintService.lint(callback);
                SseEventBuilder complete = SseEmitter.event().name("complete").data(result);
                emitter.send(complete);
                emitter.complete();
            } catch (Exception e) {
                log.error("[WikiLint] SSE stream failed: {}", e.getMessage(), e);
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
     * 读取 lint-report.md 内容。
     * <p>
     * 返回 {@code {"content": "...", "exists": true/false}}。
     * 文件不存在时 {@code exists=false, content=""}。
     * </p>
     *
     * @return 报告内容 Map
     */
    @GetMapping("/report")
    public ResponseEntity<Map<String, Object>> getReport() {
        Map<String, Object> result = new LinkedHashMap<>();
        try {
            result = wikiLintService.readReport();
        } catch (Exception e) {
            log.error("[WikiLint] Failed to read report: {}", e.getMessage(), e);
            result.put("content", "");
            result.put("exists", false);
            result.put("error", e.getMessage());
        }
        return ResponseEntity.ok(result);
    }
}
