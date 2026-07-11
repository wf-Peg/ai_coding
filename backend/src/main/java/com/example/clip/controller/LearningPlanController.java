package com.example.clip.controller;

import com.example.clip.model.LearningPlan;
import com.example.clip.service.LearningPlanService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 学习计划 REST API 控制器。
 * <p>
 * 提供学习计划的 CRUD 操作和阶段进度更新接口。
 * 创建计划时自动调用 AI 生成路线结构 + Exa 搜索真实资源。
 * </p>
 */
@RestController
@RequestMapping("/api/learning-plan")
@CrossOrigin(origins = "*")
public class LearningPlanController {

    private static final Logger log = LoggerFactory.getLogger(LearningPlanController.class);

    private final LearningPlanService learningPlanService;

    public LearningPlanController(LearningPlanService learningPlanService) {
        this.learningPlanService = learningPlanService;
    }

    /**
     * 创建学习计划。
     * <p>
     * 异步生成：AI 先生成阶段结构，然后 Exa 搜索真实资源填充。
     * 整个过程可能需要 10-30 秒，前端应显示加载动画。
     * </p>
     *
     * @param body 请求体：{ title, level, goal, hoursPerWeek, totalWeeks }
     * @return 创建的学习计划
     */
    @PostMapping
    public ResponseEntity<?> createPlan(@RequestBody Map<String, Object> body) {
        try {
            String title = (String) body.get("title");
            String level = (String) body.getOrDefault("level", "beginner");
            String goal = (String) body.getOrDefault("goal", "intro");
            int hoursPerWeek = toInt(body.get("hoursPerWeek"), 5);
            int totalWeeks = toInt(body.get("totalWeeks"), 8);

            if (title == null || title.isBlank()) {
                return ResponseEntity.badRequest().body(Map.of("error", "学习主题不能为空"));
            }

            LearningPlan plan = learningPlanService.createPlan(title, level, goal, hoursPerWeek, totalWeeks);
            if (plan == null) {
                return ResponseEntity.internalServerError().body(Map.of("error", "创建失败"));
            }

            return ResponseEntity.ok(plan);
        } catch (Exception e) {
            log.error("[LearningPlan] create failed", e);
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * 获取所有学习计划列表。
     *
     * @return 学习计划列表（按创建时间倒序）
     */
    @GetMapping
    public ResponseEntity<List<LearningPlan>> getAllPlans() {
        return ResponseEntity.ok(learningPlanService.getAllPlans());
    }

    /**
     * 获取单个学习计划详情。
     *
     * @param id 计划 ID
     * @return 学习计划详情
     */
    @GetMapping("/{id}")
    public ResponseEntity<?> getPlanById(@PathVariable Long id) {
        LearningPlan plan = learningPlanService.getPlanById(id);
        if (plan == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(plan);
    }

    /**
     * 更新学习计划（标题、进度等）。
     *
     * @param id   计划 ID
     * @param body 更新字段
     * @return 更新后的计划
     */
    @PutMapping("/{id}")
    public ResponseEntity<?> updatePlan(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        LearningPlan existing = learningPlanService.getPlanById(id);
        if (existing == null) {
            return ResponseEntity.notFound().build();
        }

        // 更新允许修改的字段
        if (body.containsKey("title")) existing.setTitle((String) body.get("title"));
        if (body.containsKey("level")) existing.setLevel((String) body.get("level"));
        if (body.containsKey("goal")) existing.setGoal((String) body.get("goal"));
        if (body.containsKey("hoursPerWeek")) existing.setHoursPerWeek(toInt(body.get("hoursPerWeek"), existing.getHoursPerWeek()));
        if (body.containsKey("totalWeeks")) existing.setTotalWeeks(toInt(body.get("totalWeeks"), existing.getTotalWeeks()));

        LearningPlan updated = learningPlanService.updatePlan(existing);
        return ResponseEntity.ok(updated);
    }

    /**
     * 删除学习计划。
     *
     * @param id 计划 ID
     * @return 204 No Content
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<?> deletePlan(@PathVariable Long id) {
        learningPlanService.deletePlan(id);
        return ResponseEntity.noContent().build();
    }

    /**
     * 更新某阶段的进度/完成状态。
     *
     * @param id       计划 ID
     * @param phaseNum 阶段编号
     * @param body     请求体：{ progress: 0-100, completed: boolean }
     * @return 更新后的计划
     */
    @PutMapping("/{id}/phase/{phaseNum}")
    public ResponseEntity<?> updatePhaseProgress(@PathVariable Long id,
                                                  @PathVariable int phaseNum,
                                                  @RequestBody Map<String, Object> body) {
        int progress = toInt(body.get("progress"), 0);
        boolean completed = Boolean.TRUE.equals(body.get("completed"));

        LearningPlan updated = learningPlanService.updatePhaseProgress(id, phaseNum, progress, completed);
        if (updated == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(updated);
    }

    private int toInt(Object value, int defaultValue) {
        if (value instanceof Number) return ((Number) value).intValue();
        if (value instanceof String) {
            try { return Integer.parseInt((String) value); } catch (NumberFormatException e) { return defaultValue; }
        }
        return defaultValue;
    }
}