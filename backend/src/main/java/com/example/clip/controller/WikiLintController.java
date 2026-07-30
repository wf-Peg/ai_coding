package com.example.clip.controller;

import com.example.clip.service.wiki.WikiLintService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Wiki 按需 Lint REST 控制器。
 * <p>
 * 提供手动触发的 Wiki 健康检查接口。Lint 是按需触发（非定时），
 * 用户点击按钮后同步等待结果。支持读取上次生成的 lint-report.md。
 * </p>
 *
 * <h3>接口列表</h3>
 * <ul>
 *   <li>{@code POST /api/wiki/lint}         — 触发 lint（同步执行）</li>
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
