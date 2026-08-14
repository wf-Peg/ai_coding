package com.example.clip.controller;

import com.example.clip.service.GraphService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/**
 * 图谱 REST API 控制器
 * <p>
 * 提供统一图谱数据源（节点 + 边），把剪藏与知识两类数据打通，供前端知识图谱页渲染；
 * 以及关系索引的一致性重建接口。
 * </p>
 */
@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*")
public class GraphController {

    private final GraphService graphService;

    public GraphController(GraphService graphService) {
        this.graphService = graphService;
    }

    /**
     * 获取图谱数据。
     *
     * @param includeTypes 要包含的节点类型，逗号分隔（如 {@code clip,knowledge}），默认 clip,knowledge
     * @return 图谱节点与边
     */
    @GetMapping("/graph")
    public ResponseEntity<Map<String, Object>> getGraph(
            @RequestParam(required = false) String includeTypes) {
        Set<String> types = (includeTypes == null || includeTypes.isBlank())
                ? new HashSet<>(Arrays.asList("clip", "knowledge"))
                : new HashSet<>(Arrays.asList(includeTypes.split(",")));
        return ResponseEntity.ok(graphService.getGraph(types));
    }

    /**
     * 全量重建关系索引（幂等），使 relation-index.json 与权威 JSON 字段保持一致。
     */
    @PostMapping("/relations/sync")
    public ResponseEntity<Map<String, String>> syncRelations() {
        graphService.syncRelations();
        return ResponseEntity.ok(Map.of("status", "success"));
    }
}