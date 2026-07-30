package com.example.clip.controller;

import com.example.clip.config.WikiConfig;
import com.example.clip.service.wiki.WikiIndexService;
import com.example.clip.service.wiki.WikiPageService;
import com.example.clip.service.wiki.WikiQueryService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

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
     * 两步流程：index 定位（便宜模型）→ 页面综合（强模型），
     * 返回 Markdown 答案、相关页面列表与 Token 估算。
     * </p>
     *
     * @param body 请求体 {@code {"question": "..."}}
     * @return 查询结果 Map
     */
    @PostMapping("/query")
    public ResponseEntity<Map<String, Object>> query(@RequestBody Map<String, Object> body) {
        String question = body != null ? (String) body.get("question") : null;
        log.info("[WikiQuery] Query request received");
        Map<String, Object> result = wikiQueryService.query(question);
        return ResponseEntity.ok(result);
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
