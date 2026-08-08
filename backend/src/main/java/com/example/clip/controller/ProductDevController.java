package com.example.clip.controller;

import com.example.clip.model.ProductDevRecord;
import com.example.clip.service.ProductDevService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 产品开发工作区 REST 控制器
 * <p>
 * 提供产品开发工作区的数据接口，包括仪表盘统计、需求看板、知识图谱、时间线、归档管理等。
 * 所有数据通过 {@link ProductDevService} 读写本地 JSON 文件系统。
 * </p>
 *
 * <h3>端点汇总</h3>
 * <ul>
 *   <li>GET  /api/product-dev/stats               - 仪表盘统计数据</li>
 *   <li>GET  /api/product-dev/phase-distribution   - 各阶段需求分布</li>
 *   <li>GET  /api/product-dev/todo-completion      - 待办完成率</li>
 *   <li>GET  /api/product-dev/knowledge-trend      - 知识积累趋势</li>
 *   <li>GET  /api/product-dev/activities           - 最近活动记录</li>
 *   <li>GET  /api/product-dev/requirements         - 需求列表（按看板阶段分组）</li>
 *   <li>GET  /api/product-dev/graph                - 知识图谱节点和边数据</li>
 *   <li>GET  /api/product-dev/timeline             - 时间线数据</li>
 *   <li>GET  /api/product-dev/archives             - 归档列表</li>
 *   <li>POST /api/product-dev/archive              - 创建归档条目</li>
 *   <li>POST /api/product-dev/migrate              - 触发历史迁移</li>
 * </ul>
 *
 * @see ProductDevService
 * @see ProductDevRecord
 */
@RestController
@RequestMapping("/api/product-dev")
@CrossOrigin(origins = "*")
public class ProductDevController {

    private static final Logger log = LoggerFactory.getLogger(ProductDevController.class);

    private final ProductDevService productDevService;

    /**
     * 构造器注入 ProductDevService
     *
     * @param productDevService 产品开发业务服务
     */
    @Autowired
    public ProductDevController(ProductDevService productDevService) {
        this.productDevService = productDevService;
    }

    /**
     * 获取仪表盘统计数据
     * <p>
     * 返回总数、各阶段数量、归档数量、知识数量、待办数量等。
     * </p>
     *
     * @return 统计数据 Map
     */
    @GetMapping("/stats")
    public ResponseEntity<Map<String, Object>> getStats() {
        log.info("[ProductDevController] GET /api/product-dev/stats");
        try {
            Map<String, Object> stats = productDevService.getStats();
            return ResponseEntity.ok(stats);
        } catch (Exception e) {
            log.error("[ProductDevController] 获取统计数据失败: {}", e.getMessage(), e);
            return errorResponse(HttpStatus.INTERNAL_SERVER_ERROR, "获取统计数据失败");
        }
    }

    /**
     * 获取各阶段需求分布
     * <p>
     * 按 phase 字段分组统计数量，用于柱状图展示。
     * </p>
     *
     * @return 阶段分布列表
     */
    @GetMapping("/phase-distribution")
    public ResponseEntity<List<Map<String, Object>>> getPhaseDistribution() {
        log.info("[ProductDevController] GET /api/product-dev/phase-distribution");
        try {
            List<Map<String, Object>> distribution = productDevService.getPhaseDistribution();
            return ResponseEntity.ok(distribution);
        } catch (Exception e) {
            log.error("[ProductDevController] 获取阶段分布失败: {}", e.getMessage(), e);
            return ResponseEntity.ok(List.of());
        }
    }

    /**
     * 获取待办完成率
     * <p>
     * 统计所有 type=todo 的记录中，status=done 的比例。
     * </p>
     *
     * @return 待办完成率 Map（包含已完成数、总数、百分比）
     */
    @GetMapping("/todo-completion")
    public ResponseEntity<Map<String, Object>> getTodoCompletion() {
        log.info("[ProductDevController] GET /api/product-dev/todo-completion");
        try {
            Map<String, Object> completion = productDevService.getTodoCompletion();
            return ResponseEntity.ok(completion);
        } catch (Exception e) {
            log.error("[ProductDevController] 获取待办完成率失败: {}", e.getMessage(), e);
            return errorResponse(HttpStatus.INTERNAL_SERVER_ERROR, "获取待办完成率失败");
        }
    }

    /**
     * 获取知识积累趋势
     * <p>
     * 按月统计 type=knowledge 的记录数量，用于折线图展示。
     * </p>
     *
     * @return 知识趋势列表
     */
    @GetMapping("/knowledge-trend")
    public ResponseEntity<List<Map<String, Object>>> getKnowledgeTrend() {
        log.info("[ProductDevController] GET /api/product-dev/knowledge-trend");
        try {
            List<Map<String, Object>> trend = productDevService.getKnowledgeTrend();
            return ResponseEntity.ok(trend);
        } catch (Exception e) {
            log.error("[ProductDevController] 获取知识趋势失败: {}", e.getMessage(), e);
            return ResponseEntity.ok(List.of());
        }
    }

    /**
     * 获取最近活动记录
     * <p>
     * 按 updatedAt 时间倒序排列，最多返回 20 条。
     * </p>
     *
     * @return 最近活动记录列表
     */
    @GetMapping("/activities")
    public ResponseEntity<List<Map<String, Object>>> getActivities() {
        log.info("[ProductDevController] GET /api/product-dev/activities");
        try {
            List<Map<String, Object>> activities = productDevService.getActivities();
            return ResponseEntity.ok(activities);
        } catch (Exception e) {
            log.error("[ProductDevController] 获取活动记录失败: {}", e.getMessage(), e);
            return ResponseEntity.ok(List.of());
        }
    }

    /**
     * 获取需求列表
     * <p>
     * 按 phase 分组返回所有 type=requirement 的记录，用于看板展示。
     * </p>
     *
     * @return 需求列表（按看板阶段分组）
     */
    @GetMapping("/requirements")
    public ResponseEntity<List<Map<String, Object>>> getRequirements() {
        log.info("[ProductDevController] GET /api/product-dev/requirements");
        try {
            List<Map<String, Object>> requirements = productDevService.getRequirements();
            return ResponseEntity.ok(requirements);
        } catch (Exception e) {
            log.error("[ProductDevController] 获取需求列表失败: {}", e.getMessage(), e);
            return ResponseEntity.ok(List.of());
        }
    }

    /**
     * 获取知识图谱节点和边数据
     * <p>
     * 将 requirement 和 knowledge 类型的记录构建为图节点，
     * 通过 relatedId 关联关系构建边，用于力导向图展示。
     * </p>
     *
     * @return 图谱数据 Map（包含 nodes 和 edges）
     */
    @GetMapping("/graph")
    public ResponseEntity<Map<String, Object>> getGraph() {
        log.info("[ProductDevController] GET /api/product-dev/graph");
        try {
            Map<String, Object> graph = productDevService.getGraph();
            return ResponseEntity.ok(graph);
        } catch (Exception e) {
            log.error("[ProductDevController] 获取知识图谱失败: {}", e.getMessage(), e);
            return errorResponse(HttpStatus.INTERNAL_SERVER_ERROR, "获取知识图谱失败");
        }
    }

    /**
     * 获取时间线数据
     * <p>
     * 按 createdAt 时间排序的所有记录，用于甘特图展示。
     * </p>
     *
     * @return 时间线数据列表
     */
    @GetMapping("/timeline")
    public ResponseEntity<List<Map<String, Object>>> getTimeline() {
        log.info("[ProductDevController] GET /api/product-dev/timeline");
        try {
            List<Map<String, Object>> timeline = productDevService.getTimeline();
            return ResponseEntity.ok(timeline);
        } catch (Exception e) {
            log.error("[ProductDevController] 获取时间线数据失败: {}", e.getMessage(), e);
            return ResponseEntity.ok(List.of());
        }
    }

    /**
     * 获取归档列表
     * <p>
     * 返回所有 source=archive 或 source=migrate 的记录，按更新时间倒序排列。
     * </p>
     *
     * @return 归档记录列表
     */
    @GetMapping("/archives")
    public ResponseEntity<List<Map<String, Object>>> getArchives() {
        log.info("[ProductDevController] GET /api/product-dev/archives");
        try {
            List<Map<String, Object>> archives = productDevService.getArchives();
            return ResponseEntity.ok(archives);
        } catch (Exception e) {
            log.error("[ProductDevController] 获取归档列表失败: {}", e.getMessage(), e);
            return ResponseEntity.ok(List.of());
        }
    }

    /**
     * 创建归档条目
     * <p>
     * 接收客户端或 agent 提交的归档数据，保存为 ProductDevRecord。
     * 请求体应包含 ProductDevRecord 的字段（如 title, type, phase, status, content 等）。
     * </p>
     *
     * @param request 归档请求数据（ProductDevRecord 字段的 JSON）
     * @return 创建结果，包含保存后的记录信息
     */
    @PostMapping("/archive")
    public ResponseEntity<Map<String, Object>> createArchive(@RequestBody Map<String, Object> request) {
        log.info("[ProductDevController] POST /api/product-dev/archive - 请求体: {}", request);
        try {
            if (request == null || request.isEmpty()) {
                return errorResponse(HttpStatus.BAD_REQUEST, "请求体不能为空");
            }

            String title = (String) request.getOrDefault("title", "未命名归档");
            String type = (String) request.getOrDefault("type", "requirement");
            String phase = (String) request.getOrDefault("phase", "analysis");
            String status = (String) request.getOrDefault("status", "todo");
            String description = (String) request.getOrDefault("description", "");
            String content = (String) request.getOrDefault("content", "");
            String source = (String) request.getOrDefault("source", "archive");
            String sourcePath = (String) request.getOrDefault("sourcePath", "");
            String relatedId = (String) request.getOrDefault("relatedId", "");
            @SuppressWarnings("unchecked")
            List<String> tags = (List<String>) request.getOrDefault("tags", List.of());

            ProductDevRecord record = new ProductDevRecord(
                    UUID.randomUUID().toString(), type, title, description,
                    phase, status, source, sourcePath,
                    tags, relatedId, content, null, null
            );

            ProductDevRecord saved = productDevService.saveRecord(record);
            if (saved != null) {
                Map<String, Object> result = new LinkedHashMap<>();
                result.put("success", true);
                result.put("id", saved.getId());
                result.put("message", "归档条目已创建");
                log.info("[ProductDevController] 归档条目创建成功: id={}, title={}", saved.getId(), title);
                return ResponseEntity.ok(result);
            } else {
                return errorResponse(HttpStatus.INTERNAL_SERVER_ERROR, "保存归档条目失败");
            }
        } catch (Exception e) {
            log.error("[ProductDevController] 创建归档条目失败: {}", e.getMessage(), e);
            return errorResponse(HttpStatus.INTERNAL_SERVER_ERROR, "创建归档条目失败: " + e.getMessage());
        }
    }

    /**
     * 更新需求的阶段（看板拖拽切换）
     * <p>
     * PUT /api/product-dev/requirements/{id}/phase
     * 更新指定需求的 phase 字段，用于看板拖拽切换阶段。
     * </p>
     *
     * @param id   需求记录的 ID
     * @param body 请求体：{ phase: "analysis"|"design"|"implementation"|"testing"|"completed" }
     * @return 更新后的记录
     */
    @PutMapping("/requirements/{id}/phase")
    public ResponseEntity<Map<String, Object>> updateRequirementPhase(@PathVariable String id,
                                                                       @RequestBody Map<String, Object> body) {
        log.info("[ProductDevController] PUT /api/product-dev/requirements/{}/phase - body: {}", id, body);
        try {
            String phase = (String) body.get("phase");
            if (phase == null || phase.isBlank()) {
                return errorResponse(HttpStatus.BAD_REQUEST, "phase 不能为空");
            }
            List<String> validPhases = List.of("analysis", "design", "implementation", "testing", "completed");
            if (!validPhases.contains(phase)) {
                return errorResponse(HttpStatus.BAD_REQUEST, "无效的 phase 值: " + phase);
            }

            ProductDevRecord existing = productDevService.getRecordById(id);
            if (existing == null) {
                return errorResponse(HttpStatus.NOT_FOUND, "需求记录不存在: " + id);
            }

            existing.setPhase(phase);
            existing.setUpdatedAt(LocalDateTime.now());
            ProductDevRecord saved = productDevService.saveRecord(existing);
            if (saved != null) {
                Map<String, Object> result = new LinkedHashMap<>();
                result.put("success", true);
                result.put("id", saved.getId());
                result.put("phase", saved.getPhase());
                result.put("message", "阶段已更新");
                log.info("[ProductDevController] 需求阶段更新成功: id={}, phase={}", id, phase);
                return ResponseEntity.ok(result);
            } else {
                return errorResponse(HttpStatus.INTERNAL_SERVER_ERROR, "保存更新失败");
            }
        } catch (Exception e) {
            log.error("[ProductDevController] 更新需求阶段失败: {}", e.getMessage(), e);
            return errorResponse(HttpStatus.INTERNAL_SERVER_ERROR, "更新需求阶段失败: " + e.getMessage());
        }
    }

    /**
     * 触发历史迁移
     * <p>
     * 扫描 TODO/ 和 .trae/specs/ 目录下的 markdown 文件，
     * 解析为 ProductDevRecord 并写入数据存储。
     * </p>
     *
     * @return 迁移结果摘要
     */
    @PostMapping("/migrate")
    public ResponseEntity<Map<String, Object>> migrate() {
        log.info("[ProductDevController] POST /api/product-dev/migrate - 触发历史迁移");
        try {
            Map<String, Object> result = productDevService.executeMigration();
            log.info("[ProductDevController] 历史迁移完成: {}", result.get("message"));
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            log.error("[ProductDevController] 历史迁移失败: {}", e.getMessage(), e);
            return errorResponse(HttpStatus.INTERNAL_SERVER_ERROR, "历史迁移失败: " + e.getMessage());
        }
    }

    /**
     * 构造错误响应
     *
     * @param status  HTTP 状态码
     * @param message 错误信息
     * @return 错误响应实体
     */
    private ResponseEntity<Map<String, Object>> errorResponse(HttpStatus status, String message) {
        Map<String, Object> error = new LinkedHashMap<>();
        error.put("status", "error");
        error.put("message", message);
        return ResponseEntity.status(status).body(error);
    }
}