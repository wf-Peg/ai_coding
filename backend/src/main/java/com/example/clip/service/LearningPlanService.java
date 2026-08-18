package com.example.clip.service;

import com.example.clip.core.LlmProvider;
import com.example.clip.model.LearningPlan;
import com.example.clip.model.LearningPlan.Phase;
import com.example.clip.model.LearningPlan.VideoResource;
import com.example.clip.model.LearningPlan.QuizQuestion;
import com.example.clip.model.LearningPlan.PracticeTask;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

/**
 * 学习计划服务。
 * <p>
 * 核心业务流程：AI 生成学习路线结构 → Exa 搜索真实学习资源 → 合并保存。
 * 当 Exa 不可用时自动降级为 AI 生成资源。
 * </p>
 *
 * <h3>生成流程</h3>
 * <ol>
 *   <li>接收用户输入（主题、水平、目标、时间投入）</li>
 *   <li>调用 AI 生成阶段结构（phase 列表 + mermaid 图）</li>
 *   <li>调用 Exa 为每个阶段搜索真实学习资源</li>
 *   <li>如果 Exa 返回空（未配置 / 失败），降级为 AI 生成资源</li>
 *   <li>保存到文件存储</li>
 * </ol>
 */
@Service
public class LearningPlanService {

    private static final Logger log = LoggerFactory.getLogger(LearningPlanService.class);

    private final FileStorageService fileStorageService;
    private final ExaSearchService exaSearchService;
    private final LlmProvider llmProvider;
    private final GraphService graphService;
    private final ObjectMapper objectMapper;

    public LearningPlanService(FileStorageService fileStorageService,
                               ExaSearchService exaSearchService,
                               LlmProvider llmProvider,
                               GraphService graphService) {
        this.fileStorageService = fileStorageService;
        this.exaSearchService = exaSearchService;
        this.llmProvider = llmProvider;
        this.graphService = graphService;
        this.objectMapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
    }

    /**
     * 创建学习计划（AI 生成结构 + Exa 搜索资源）。
     *
     * @param title        学习主题
     * @param level        当前水平
     * @param goal         学习目标
     * @param hoursPerWeek 每周投入小时数
     * @param totalWeeks   预计总周数
     * @return 生成的学习计划
     */
    public LearningPlan createPlan(String title, String level, String goal,
                                   int hoursPerWeek, int totalWeeks) {
        LearningPlan plan = new LearningPlan();
        plan.setTitle(title);
        plan.setLevel(level);
        plan.setGoal(goal);
        plan.setHoursPerWeek(hoursPerWeek);
        plan.setTotalWeeks(String.valueOf(totalWeeks));

        // Step 1: AI 生成阶段结构
        log.info("[LearningPlan] Step 1: AI generating phase structure for '{}'", title);
        Map<String, Object> aiResult = generatePhaseStructure(title, level, goal, hoursPerWeek, totalWeeks);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> phasesRaw = (List<Map<String, Object>>) aiResult.getOrDefault("phases", Collections.emptyList());

        if (phasesRaw.isEmpty()) {
            // AI 生成失败，不保存空计划，直接抛出异常告知用户
            throw new RuntimeException("AI 生成学习路线失败，请检查模型配置或 API Key 额度");
        }

        String mermaidDiagram = (String) aiResult.getOrDefault("mermaidDiagram", "");

        plan.setMermaidDiagram(mermaidDiagram);

        // Step 2: 解析阶段
        List<Phase> phases = new ArrayList<>();
        for (Map<String, Object> phaseRaw : phasesRaw) {
            Phase phase = parsePhase(phaseRaw);
            phases.add(phase);
        }

        // Step 3: Exa 搜索真实资源（为每个阶段）
        log.info("[LearningPlan] Step 2: Exa searching resources for {} phases", phases.size());
        for (Phase phase : phases) {
            List<VideoResource> exaResources = exaSearchService.searchResources(
                    title, phase.getGoal(), 5);
            if (!exaResources.isEmpty()) {
                phase.setVideos(exaResources);
                log.info("[LearningPlan] Phase '{}': {} Exa resources found", phase.getTitle(), exaResources.size());
            } else {
                // Exa 不可用，使用 AI 降级生成
                log.info("[LearningPlan] Phase '{}': Exa unavailable, using AI fallback", phase.getTitle());
                List<VideoResource> fallback = generateFallbackResources(title, phase.getGoal());
                phase.setVideos(fallback);
            }
        }

        plan.setPhases(phases);

        // Step 4: 保存
        LearningPlan saved = fileStorageService.saveLearningPlan(plan);
        if (saved != null && saved.getId() != null) {
            graphService.recordPlanRelations(saved);
        }
        log.info("[LearningPlan] Plan '{}' created with {} phases, saved as id={}",
                title, phases.size(), saved != null ? saved.getId() : null);
        return saved;
    }

    /**
     * 调用 AI 生成学习路线阶段结构。
     */
    private Map<String, Object> generatePhaseStructure(String title, String level, String goal,
                                                        int hoursPerWeek, int totalWeeks) {
        String levelLabel = switch (level) {
            case "zero" -> "零基础";
            case "beginner" -> "入门";
            case "intermediate" -> "中级";
            default -> level;
        };
        String goalLabel = switch (goal) {
            case "intro" -> "了解入门";
            case "project" -> "完成项目";
            case "job" -> "求职面试";
            case "portfolio" -> "构建作品集";
            default -> goal;
        };

        String systemPrompt = """
                你是一个技术学习导师。请根据以下信息生成一份分阶段学习路线图的结构。
                
                要求：
                1. 阶段数量合理（根据总周数，通常 3-6 个阶段）
                2. 每个阶段有明确的学习目标和可执行的知识作业、实战任务
                3. 知识作业包含选择题和问答题，实战任务有验收标准
                4. 难度随阶段递增
                5. mermaidDiagram 使用中文节点标签，清晰展示学习路径
                6. 返回纯 JSON（不要 markdown 代码块标记）
                
                返回格式：
                {
                  "phases": [
                    {
                      "phaseNumber": 1,
                      "title": "阶段名称",
                      "goal": "阶段目标",
                      "estimatedWeeks": 2,
                      "knowledgeQuiz": [
                        {"type": "choice", "question": "...", "options": ["A", "B", "C", "D"]},
                        {"type": "essay", "question": "..."}
                      ],
                      "practiceTasks": [
                        {"description": "...", "difficulty": 2, "acceptanceCriteria": "..."}
                      ]
                    }
                  ],
                  "mermaidDiagram": "graph TD\\n  A[开始] --> B[阶段1]\\n  ..."
                }
                
                注意：不需要生成 videos 字段，学习资源将通过搜索引擎实时获取。""";

        String userMessage = String.format("""
                学习主题：%s
                当前水平：%s
                学习目标：%s
                每周投入：%d 小时
                预计周期：%d 周""",
                title, levelLabel, goalLabel, hoursPerWeek, totalWeeks);

        try {
            String response = llmProvider.chat(systemPrompt, userMessage);
            String cleaned = cleanJson(response);
            return objectMapper.readValue(cleaned, new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            log.error("[LearningPlan] AI generation failed: {}", e.getMessage(), e);
            // 返回降级结果
            Map<String, Object> fallback = new LinkedHashMap<>();
            fallback.put("phases", Collections.emptyList());
            fallback.put("mermaidDiagram", "");
            return fallback;
        }
    }

    /**
     * AI 降级生成学习资源（Exa 不可用时使用）。
     */
    private List<VideoResource> generateFallbackResources(String topic, String phaseGoal) {
        String systemPrompt = """
                你是一个学习资源推荐助手。请为以下学习主题和阶段目标推荐 3-5 个高质量的学习资源。
                返回 JSON 数组格式（不要 markdown 代码块）：
                [
                  {"title": "资源名称", "url": "资源链接", "reason": "推荐理由"}
                ]
                注意：请确保推荐的资源是真实存在的知名平台资源（如官方文档、知名教程网站、GitHub 知名项目等）。""";

        String userMessage = String.format("学习主题：%s\n阶段目标：%s", topic, phaseGoal);

        try {
            String response = llmProvider.chat(systemPrompt, userMessage);
            String cleaned = cleanJson(response);
            List<Map<String, Object>> raw = objectMapper.readValue(cleaned,
                    new TypeReference<List<Map<String, Object>>>() {});
            List<VideoResource> resources = new ArrayList<>();
            for (Map<String, Object> item : raw) {
                VideoResource vr = new VideoResource();
                vr.setTitle(Objects.toString(item.get("title"), ""));
                vr.setUrl(Objects.toString(item.get("url"), ""));
                vr.setReason(Objects.toString(item.get("reason"), ""));
                vr.setSource("ai");
                vr.setSnippet("AI 推荐资源");
                resources.add(vr);
            }
            return resources;
        } catch (Exception e) {
            log.warn("[LearningPlan] AI fallback resource generation failed: {}", e.getMessage());
            return Collections.emptyList();
        }
    }

    /**
     * 解析 AI 返回的阶段 JSON 为 Phase 对象。
     */
    private Phase parsePhase(Map<String, Object> raw) {
        Phase phase = new Phase();
        phase.setPhaseNumber(toInt(raw.get("phaseNumber"), 1));
        phase.setTitle(Objects.toString(raw.get("title"), ""));
        phase.setGoal(Objects.toString(raw.get("goal"), ""));
        phase.setEstimatedWeeks(Objects.toString(raw.get("estimatedWeeks"), "1"));
        phase.setDetailMarkdown(Objects.toString(raw.get("detailMarkdown"), ""));
        phase.setProgress(0);
        phase.setCompleted(false);

        // 解析知识作业
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> quizRaw = (List<Map<String, Object>>) raw.getOrDefault("knowledgeQuiz", Collections.emptyList());
        List<QuizQuestion> quizzes = new ArrayList<>();
        for (Map<String, Object> q : quizRaw) {
            QuizQuestion quiz = new QuizQuestion();
            quiz.setType(Objects.toString(q.get("type"), "choice"));
            quiz.setQuestion(Objects.toString(q.get("question"), ""));
            @SuppressWarnings("unchecked")
            List<String> options = (List<String>) q.getOrDefault("options", Collections.emptyList());
            quiz.setOptions(options);
            quizzes.add(quiz);
        }
        phase.setKnowledgeQuiz(quizzes);

        // 解析实战任务
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> tasksRaw = (List<Map<String, Object>>) raw.getOrDefault("practiceTasks", Collections.emptyList());
        List<PracticeTask> tasks = new ArrayList<>();
        for (Map<String, Object> t : tasksRaw) {
            PracticeTask task = new PracticeTask();
            task.setDescription(Objects.toString(t.get("description"), ""));
            task.setDifficulty(toInt(t.get("difficulty"), 1));
            task.setAcceptanceCriteria(Objects.toString(t.get("acceptanceCriteria"), ""));
            tasks.add(task);
        }
        phase.setPracticeTasks(tasks);

        return phase;
    }

    /**
     * 清理 LLM 返回的 markdown 代码块包裹。
     */
    private String cleanJson(String json) {
        if (json == null) return "";
        json = json.trim();
        if (json.startsWith("```")) {
            json = json.replaceAll("^```json?\\s*", "").replaceAll("\\s*```$", "").trim();
        }
        return json;
    }

    private int toInt(Object value, int defaultValue) {
        if (value instanceof Number) return ((Number) value).intValue();
        if (value instanceof String) {
            try { return Integer.parseInt((String) value); } catch (NumberFormatException e) { return defaultValue; }
        }
        return defaultValue;
    }

    // ==================== CRUD 委托 ====================

    public List<LearningPlan> getAllPlans() {
        return fileStorageService.getAllLearningPlans();
    }

    public LearningPlan getPlanById(Long id) {
        return fileStorageService.getLearningPlanById(id);
    }

    public LearningPlan updatePlan(LearningPlan plan) {
        plan.setUpdatedAt(LocalDateTime.now());
        return fileStorageService.saveLearningPlan(plan);
    }

    public void deletePlan(Long id) {
        // 保护内置计划，不允许删除
        LearningPlan existing = fileStorageService.getLearningPlanById(id);
        if (existing != null && existing.isBuiltin()) {
            throw new RuntimeException("系统内置计划不可删除");
        }
        fileStorageService.deleteLearningPlan(id);
        graphService.removePlanRelations(id);
    }

    /**
     * 保存内置学习计划（从 JSON 资源加载）。
     * 与现有计划去重检测：按 title 匹配，已存在则跳过。
     */
    public LearningPlan saveBuiltinPlan(LearningPlan plan) {
        List<LearningPlan> existing = fileStorageService.getAllLearningPlans();
        // 同名内置计划：保留 updatedAt 最新的一个，清除其余副本（自愈历史重复播种数据）
        List<LearningPlan> sameTitleBuiltin = existing.stream()
                .filter(p -> plan.getTitle().equals(p.getTitle()) && p.isBuiltin())
                .collect(Collectors.toList());
        if (!sameTitleBuiltin.isEmpty()) {
            sameTitleBuiltin.sort(Comparator.comparing(
                    LearningPlan::getUpdatedAt, Comparator.nullsFirst(Comparator.naturalOrder())).reversed());
            LearningPlan keep = sameTitleBuiltin.get(0);
            for (LearningPlan dup : sameTitleBuiltin) {
                if (!dup.getId().equals(keep.getId())) {
                    log.info("[LearningPlanService] 清理重复内置计划: id={}, title={}", dup.getId(), dup.getTitle());
                    fileStorageService.deleteLearningPlan(dup.getId());
                }
            }
            return null; // 已存在，跳过播种
        }
        plan.setBuiltin(true);
        return fileStorageService.saveLearningPlan(plan);
    }

    /**
     * 更新某个阶段的进度/完成状态。
     */
    public LearningPlan updatePhaseProgress(Long planId, int phaseNum, int progress, boolean completed) {
        LearningPlan plan = fileStorageService.getLearningPlanById(planId);
        if (plan == null) return null;

        for (Phase phase : plan.getPhases()) {
            if (phase.getPhaseNumber() == phaseNum) {
                phase.setProgress(progress);
                phase.setCompleted(completed);
                break;
            }
        }

        plan.setUpdatedAt(LocalDateTime.now());
        return fileStorageService.saveLearningPlan(plan);
    }

    /**
     * 更新某阶段的关联知识/剪藏，并在更新后同步图谱关系。
     *
     * @param planId             计划 ID
     * @param phaseNum           阶段编号
     * @param linkedKnowledgeIds 关联的知识条目 ID
     * @param sourceClipIds      关联的剪藏 ID
     * @return 更新后的计划；计划不存在返回 null
     */
    public LearningPlan updatePhaseLinks(Long planId, int phaseNum,
                                         List<Long> linkedKnowledgeIds, List<Long> sourceClipIds) {
        LearningPlan plan = fileStorageService.getLearningPlanById(planId);
        if (plan == null) return null;

        for (Phase phase : plan.getPhases()) {
            if (phase.getPhaseNumber() == phaseNum) {
                phase.setLinkedKnowledgeIds(linkedKnowledgeIds != null ? linkedKnowledgeIds : new ArrayList<>());
                phase.setSourceClipIds(sourceClipIds != null ? sourceClipIds : new ArrayList<>());
                break;
            }
        }

        plan.setUpdatedAt(LocalDateTime.now());
        LearningPlan saved = fileStorageService.saveLearningPlan(plan);
        if (saved != null && saved.getId() != null) {
            graphService.recordPlanRelations(saved);
        }
        return saved;
    }

    /**
     * 反查引用指定知识的全部学习阶段（用于知识详情反链）。
     *
     * @param knowledgeId 知识条目 ID
     * @return [{planId, planTitle, phases:[{phaseNumber, phaseTitle}]}]
     */
    public List<Map<String, Object>> getPlansByKnowledge(Long knowledgeId) {
        return collectPlanRefs(plan -> plan.getPhases().stream()
                .filter(p -> p.getLinkedKnowledgeIds() != null && p.getLinkedKnowledgeIds().contains(knowledgeId))
                .toList());
    }

    /**
     * 反查引用指定剪藏的全部学习阶段（用于剪藏详情反链）。
     *
     * @param clipId 剪藏 ID
     * @return [{planId, planTitle, phases:[{phaseNumber, phaseTitle}]}]
     */
    public List<Map<String, Object>> getPlansByClip(Long clipId) {
        return collectPlanRefs(plan -> plan.getPhases().stream()
                .filter(p -> p.getSourceClipIds() != null && p.getSourceClipIds().contains(clipId))
                .toList());
    }

    private List<Map<String, Object>> collectPlanRefs(java.util.function.Function<LearningPlan, List<Phase>> matcher) {
        List<Map<String, Object>> result = new ArrayList<>();
        for (LearningPlan plan : fileStorageService.getAllLearningPlans()) {
            if (plan.getId() == null) continue;
            List<Phase> matched = matcher.apply(plan);
            if (matched.isEmpty()) continue;
            List<Map<String, Object>> phases = new ArrayList<>();
            for (Phase phase : matched) {
                Map<String, Object> phaseRef = new LinkedHashMap<>();
                phaseRef.put("phaseNumber", phase.getPhaseNumber());
                phaseRef.put("phaseTitle", phase.getTitle());
                phases.add(phaseRef);
            }
            Map<String, Object> planRef = new LinkedHashMap<>();
            planRef.put("planId", plan.getId());
            planRef.put("planTitle", plan.getTitle());
            planRef.put("phases", phases);
            result.add(planRef);
        }
        return result;
    }
}