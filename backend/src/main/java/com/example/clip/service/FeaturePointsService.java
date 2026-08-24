package com.example.clip.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * 产品概览数据服务：读取 TODO 目录下所有 feature-points.json 文件，
 * 按 v2.0 数据结构返回，直接服务于产品概览页渲染。
 */
@Service
public class FeaturePointsService {

    private static final Logger log = LoggerFactory.getLogger(FeaturePointsService.class);

    private static final String FEATURE_POINTS_FILE = "feature-points.json";

    private final Path todoDir;
    private final ObjectMapper objectMapper;

    @Autowired
    public FeaturePointsService(
            @Value("${product-dev.todo-dir:./TODO}") String todoDirPath) {
        this.todoDir = Paths.get(todoDirPath).toAbsolutePath().normalize();
        this.objectMapper = new ObjectMapper();
        log.info("[FeaturePointsService] TODO 目录: {}", this.todoDir);
    }

    /**
     * 读取所有 feature-points.json 文件，返回聚合后的产品概览数据。
     *
     * @return 包含所有 feature-points 聚合数据的 map
     */
    public Map<String, Object> loadAllFeaturePoints() {
        List<Map<String, Object>> items = new ArrayList<>();

        if (!Files.exists(todoDir) || !Files.isDirectory(todoDir)) {
            log.warn("[FeaturePointsService] TODO 目录不存在: {}", todoDir);
            return Map.of("projects", Collections.emptyList(), "totalFeaturePoints", 0, "totalKnowledgePoints", 0);
        }

        File[] dirs = todoDir.toFile().listFiles(File::isDirectory);
        if (dirs == null) {
            return Map.of("projects", Collections.emptyList(), "totalFeaturePoints", 0, "totalKnowledgePoints", 0);
        }

        int totalFp = 0;
        int totalKp = 0;

        for (File dir : dirs) {
            File fpFile = new File(dir, FEATURE_POINTS_FILE);
            if (!fpFile.exists()) continue;

            try {
                @SuppressWarnings("unchecked")
                Map<String, Object> data = objectMapper.readValue(fpFile, Map.class);
                String version = data.containsKey("version") ? String.valueOf(data.get("version")) : "1.0";

                // 提取 requirement
                @SuppressWarnings("unchecked")
                Map<String, Object> requirement = data.get("requirement") instanceof Map
                        ? (Map<String, Object>) data.get("requirement") : Map.of();

                // 提取 featurePoints
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> featurePoints = data.get("featurePoints") instanceof List
                        ? (List<Map<String, Object>>) data.get("featurePoints") : List.of();

                // 提取 knowledgePoints
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> knowledgePoints = data.get("knowledgePoints") instanceof List
                        ? (List<Map<String, Object>>) data.get("knowledgePoints") : List.of();

                // 统计各阶段分布（兼容 tasks 为字符串数组或对象数组）
                Map<String, Long> phaseDistribution = new java.util.LinkedHashMap<>();
                for (Map<String, Object> fp : featurePoints) {
                    Object tasksRaw = fp.getOrDefault("tasks", List.of());
                    if (tasksRaw instanceof List) {
                        for (Object taskObj : (List<?>) tasksRaw) {
                            if (taskObj instanceof Map) {
                                Map<?, ?> taskMap = (Map<?, ?>) taskObj;
                                Object s = taskMap.get("status");
                                String status = s != null ? String.valueOf(s) : "todo";
                                phaseDistribution.merge(status, 1L, Long::sum);
                            } else {
                                // 字符串格式的任务，默认为待完成
                                phaseDistribution.merge("todo", 1L, Long::sum);
                            }
                        }
                    }
                }

                // 统计设计章节
                List<String> allDesignSections = new java.util.ArrayList<>();
                for (Map<String, Object> fp : featurePoints) {
                    List<String> sections = (List<String>) fp.getOrDefault("designSections", List.of());
                    allDesignSections.addAll(sections);
                }

                Map<String, Object> project = new java.util.LinkedHashMap<>();
                project.put("dirName", dir.getName());
                project.put("version", version);
                project.put("requirement", requirement);
                project.put("featurePoints", featurePoints);
                project.put("knowledgePoints", knowledgePoints);
                project.put("featurePointCount", featurePoints.size());
                project.put("knowledgePointCount", knowledgePoints.size());
                project.put("phaseDistribution", phaseDistribution);
                project.put("designSections", allDesignSections);

                items.add(project);
                totalFp += featurePoints.size();
                totalKp += knowledgePoints.size();
            } catch (IOException e) {
                log.warn("[FeaturePointsService] 读取失败: {} ({})", fpFile, e.getMessage());
            }
        }

        Map<String, Object> result = new java.util.LinkedHashMap<>();
        result.put("projects", items);
        result.put("totalProjects", items.size());
        result.put("totalFeaturePoints", totalFp);
        result.put("totalKnowledgePoints", totalKp);
        return result;
    }
}