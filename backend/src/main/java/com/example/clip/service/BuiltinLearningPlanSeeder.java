package com.example.clip.service;

import com.example.clip.model.LearningPlan;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

import java.io.InputStream;
import java.util.List;

/**
 * 内置学习计划播种器。
 * <p>
 * 应用启动时执行，从 classpath:builtin/product-feature-learning-plan.json 加载
 * 系统内置学习计划并保存到文件存储。
 * 幂等设计：已存在的内置计划（按 title 匹配）不会重复创建。
 * </p>
 */
@Component
public class BuiltinLearningPlanSeeder implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(BuiltinLearningPlanSeeder.class);

    private static final String BUILTIN_PLAN_RESOURCE = "/builtin/product-feature-learning-plan.json";

    private final LearningPlanService learningPlanService;
    private final ObjectMapper objectMapper;

    public BuiltinLearningPlanSeeder(LearningPlanService learningPlanService) {
        this.learningPlanService = learningPlanService;
        this.objectMapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)
                .registerModule(new JavaTimeModule());
    }

    @Override
    public void run(String... args) {
        log.info("[BuiltinLearningPlanSeeder] 开始播种内置学习计划...");
        try {
            InputStream is = getClass().getResourceAsStream(BUILTIN_PLAN_RESOURCE);
            if (is == null) {
                log.warn("[BuiltinLearningPlanSeeder] 未找到内置学习计划资源文件: {}", BUILTIN_PLAN_RESOURCE);
                return;
            }

            List<LearningPlan> builtinPlans = objectMapper.readValue(is,
                    new TypeReference<List<LearningPlan>>() {});

            int seeded = 0;
            int skipped = 0;
            for (LearningPlan plan : builtinPlans) {
                LearningPlan result = learningPlanService.saveBuiltinPlan(plan);
                if (result != null) {
                    log.info("[BuiltinLearningPlanSeeder] 内置计划已创建: id={}, title={}", result.getId(), result.getTitle());
                    seeded++;
                } else {
                    skipped++;
                }
            }

            log.info("[BuiltinLearningPlanSeeder] 播种完成: 创建 {} 个, 跳过 {} 个", seeded, skipped);
        } catch (Exception e) {
            log.error("[BuiltinLearningPlanSeeder] 播种内置学习计划失败", e);
        }
    }
}