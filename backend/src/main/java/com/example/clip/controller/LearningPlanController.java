package com.example.clip.controller;

import com.example.clip.model.LearningPlan;
import com.example.clip.service.AppConfigService;
import com.example.clip.service.FileStorageService;
import com.example.clip.service.LearningPlanService;
import com.example.clip.service.PdfGenerator;
import com.example.clip.util.WorkspaceFilterUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

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
    private final FileStorageService fileStorageService;
    private final PdfGenerator pdfGenerator;
    private final AppConfigService appConfigService;

    public LearningPlanController(LearningPlanService learningPlanService,
                                  FileStorageService fileStorageService,
                                  PdfGenerator pdfGenerator,
                                  AppConfigService appConfigService) {
        this.learningPlanService = learningPlanService;
        this.fileStorageService = fileStorageService;
        this.pdfGenerator = pdfGenerator;
        this.appConfigService = appConfigService;
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
    public ResponseEntity<List<LearningPlan>> getAllPlans(
            @RequestParam(required = false) String workspaceId) {
        List<LearningPlan> plans = learningPlanService.getAllPlans();
        if (workspaceId != null && !workspaceId.isBlank()) {
            plans = filterByWorkspace(plans, workspaceId);
        }
        return ResponseEntity.ok(plans);
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

    /**
     * 批量删除学习计划。
     *
     * @param body 请求体：{ ids: [1, 2, 3] }
     * @return 删除结果
     */
    @PutMapping("/{id}/mastery")
    public ResponseEntity<?> updateMastery(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        LearningPlan plan = learningPlanService.getPlanById(id);
        if (plan == null) return ResponseEntity.notFound().build();

        if (body.containsKey("mastery")) {
            plan.setMastery(toInt(body.get("mastery"), plan.getMastery() != null ? plan.getMastery() : 0));
        }
        if (body.containsKey("nextReviewAt")) {
            String reviewStr = (String) body.get("nextReviewAt");
            if (reviewStr != null) plan.setNextReviewAt(LocalDateTime.parse(reviewStr));
        }
        if (body.containsKey("reviewCount")) {
            plan.setReviewCount(toInt(body.get("reviewCount"), plan.getReviewCount()));
        }
        if (body.containsKey("category")) {
            plan.setCategory((String) body.get("category"));
        }
        if (body.containsKey("tags")) {
            @SuppressWarnings("unchecked")
            List<String> tags = (List<String>) body.get("tags");
            plan.setTags(tags != null ? tags : List.of());
        }

        LearningPlan updated = learningPlanService.updatePlan(plan);
        return ResponseEntity.ok(updated);
    }

    @PostMapping("/{id}/review")
    public ResponseEntity<?> recordReview(@PathVariable Long id) {
        LearningPlan plan = learningPlanService.getPlanById(id);
        if (plan == null) return ResponseEntity.notFound().build();

        int newMastery = Math.min(100, (plan.getMastery() != null ? plan.getMastery() : 0) + 10);
        plan.setMastery(newMastery);
        plan.setReviewCount(plan.getReviewCount() + 1);
        plan.setNextReviewAt(LocalDateTime.now().plusDays(plan.getReviewCount() <= 2 ? 1 : 7));
        LearningPlan updated = learningPlanService.updatePlan(plan);
        return ResponseEntity.ok(updated);
    }

    @PostMapping("/batch-delete")
    public ResponseEntity<?> batchDelete(@RequestBody Map<String, Object> body) {
        try {
            @SuppressWarnings("unchecked")
            List<Number> ids = (List<Number>) body.getOrDefault("ids", List.of());
            if (ids.isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of("error", "请选择要删除的计划"));
            }
            int count = 0;
            for (Number id : ids) {
                learningPlanService.deletePlan(id.longValue());
                count++;
            }
            return ResponseEntity.ok(Map.of("deleted", count));
        } catch (Exception e) {
            log.error("[LearningPlan] batch delete failed", e);
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * 打开学习计划存储目录。
     * <p>
     * 通过系统级命令打开文件管理器，定位到学习计划数据所在目录。
     * </p>
     *
     * @return 操作结果
     */
    @PostMapping("/open-folder")
    public ResponseEntity<?> openStorageFolder() {
        try {
            Path storageRoot = fileStorageService.getStoragePath();
            Path folderPath = storageRoot.resolve("learning-plan");

            if (!Files.exists(folderPath)) {
                Files.createDirectories(folderPath);
            }

            String os = System.getProperty("os.name").toLowerCase();
            ProcessBuilder pb;
            if (os.contains("win")) {
                pb = new ProcessBuilder("explorer.exe", folderPath.toAbsolutePath().toString());
            } else if (os.contains("mac")) {
                pb = new ProcessBuilder("open", folderPath.toAbsolutePath().toString());
            } else {
                pb = new ProcessBuilder("xdg-open", folderPath.toAbsolutePath().toString());
            }
            pb.start();

            return ResponseEntity.ok(Map.of(
                    "status", "success",
                    "path", folderPath.toAbsolutePath().toString()
            ));
        } catch (Exception e) {
            log.error("[LearningPlan] open folder failed", e);
            return ResponseEntity.internalServerError().body(Map.of("error", "打开目录失败: " + e.getMessage()));
        }
    }

    /**
     * 导出学习计划为 PDF。
     * <p>
     * 前端发送 Markdown 内容，后端通过 flexmark 转 HTML +
     * OpenHTMLtoPDF 渲染为 PDF 二进制流返回。
     * 自动探测系统中文字体，确保中文正确显示。
     * </p>
     *
     * @param id   计划 ID（用于生成文件名）
     * @param body 请求体：{ markdown: "Markdown 字符串" }
     * @return PDF 文件二进制流
     */
    @PostMapping("/{id}/export-pdf")
    public ResponseEntity<?> exportPdf(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        try {
            LearningPlan plan = learningPlanService.getPlanById(id);
            if (plan == null) {
                return ResponseEntity.notFound().build();
            }

            String markdown = (String) body.get("markdown");
            if (markdown == null || markdown.isBlank()) {
                return ResponseEntity.badRequest().body(Map.of("error", "Markdown 内容不能为空"));
            }

            byte[] pdfBytes = pdfGenerator.generateFromMarkdown(markdown);

            // 文件名使用计划标题，去除不安全字符
            String safeTitle = plan.getTitle().replaceAll("[\\\\/:*?\"<>|]", "_").trim();
            String filename = safeTitle + "_学习计划.pdf";

            return ResponseEntity.ok()
                    .header(HttpHeaders.CONTENT_DISPOSITION,
                            "attachment; filename*=UTF-8''" + java.net.URLEncoder.encode(filename, "UTF-8"))
                    .contentType(MediaType.APPLICATION_PDF)
                    .body(pdfBytes);
        } catch (Exception e) {
            log.error("[LearningPlan] PDF export failed for plan {}", id, e);
            return ResponseEntity.internalServerError().body(Map.of("error", "PDF 导出失败: " + e.getMessage()));
        }
    }

    /**
     * 根据工作台规则筛选学习计划列表，委托给 {@link WorkspaceFilterUtils} 共享工具类。
     */
    private List<LearningPlan> filterByWorkspace(List<LearningPlan> items, String workspaceId) {
        return WorkspaceFilterUtils.filterByWorkspace(items, workspaceId, appConfigService, LearningPlan::getId);
    }

    private int toInt(Object value, int defaultValue) {
        if (value instanceof Number) return ((Number) value).intValue();
        if (value instanceof String) {
            try { return Integer.parseInt((String) value); } catch (NumberFormatException e) { return defaultValue; }
        }
        return defaultValue;
    }
}