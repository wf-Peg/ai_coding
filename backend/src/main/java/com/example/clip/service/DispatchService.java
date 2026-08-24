package com.example.clip.service;

import com.example.clip.core.AiService;
import com.example.clip.core.ModelConfig;
import com.example.clip.model.ClipContent;
import com.example.clip.model.DispatchRecord;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 内容分发服务（MVP）。
 * <p>
 * 提供两类能力：
 * <ul>
 *   <li><b>内部投递</b>：把剪藏内容投递到内置场景目标（深度分析/总结提炼/发散性总结/
 *       标签生成/智能整理/知识库整理），复用已配置模型（省 token，不跳外部平台）；</li>
 *   <li><b>答案汇总蒸馏</b>：将同一剪藏的多条投递结果汇总，蒸馏成一份精炼总结。</li>
 * </ul>
 * </p>
 * <p>
 * 投递记录旁路存储于 {@code clip-storage/dispatch-records/{clipId}.json}，
 * 不触碰 ClipContent 存储文件（兼容性约束见 TODO/04-内容分发MVP设计.md 2.5 节）。
 * </p>
 */
@Service
public class DispatchService {

    private static final Logger log = LoggerFactory.getLogger(DispatchService.class);
    private static final DateTimeFormatter TIME_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    /** 蒸馏记录的专用目标标识 */
    public static final String DISTILL_TARGET_ID = "internal:distill";

    private final AiService aiService;
    private final ClipService clipService;
    private final ModelConfigService modelConfigService;
    private final ObjectMapper objectMapper;
    private final String storagePath;

    public DispatchService(AiService aiService,
                           ClipService clipService,
                           ModelConfigService modelConfigService,
                           @Value("${clip.storage.path:./clip-storage}") String storagePath) {
        this.aiService = aiService;
        this.clipService = clipService;
        this.modelConfigService = modelConfigService;
        this.storagePath = storagePath;
        this.objectMapper = new ObjectMapper();
    }

    // ==================== 目标与模型信息 ====================

    /**
     * 内置投递目标列表（数据驱动：名称/描述/目标标识）。
     * MVP 为内置枚举，不做持久化配置；后续 spec 支持自定义目标/平台注册表。
     */
    public List<Map<String, String>> getTargets() {
        List<Map<String, String>> targets = new ArrayList<>();
        targets.add(target("internal:analyze", "深度分析", "基于剪藏内容的多角度分析"));
        targets.add(target("internal:summary", "总结提炼", "生成结构化摘要"));
        targets.add(target("internal:divergent", "发散性总结", "专家级多角色发散分析"));
        targets.add(target("internal:tags", "标签生成", "提取关键词标签"));
        targets.add(target("internal:organize", "智能整理", "AI 分类 + 标签建议"));
        targets.add(target("internal:knowledge", "知识库整理", "生成知识库格式内容"));
        return targets;
    }

    private Map<String, String> target(String id, String name, String desc) {
        Map<String, String> t = new LinkedHashMap<>();
        t.put("id", id);
        t.put("name", name);
        t.put("description", desc);
        return t;
    }

    /** 当前激活模型信息（provider + model，来自 ModelConfig，不泄露 API Key） */
    public Map<String, String> getCurrentModel() {
        ModelConfig config = modelConfigService.getConfig();
        Map<String, String> m = new LinkedHashMap<>();
        m.put("provider", config.getActiveProvider());
        m.put("model", config.getActiveModel() == null ? "" : config.getActiveModel());
        return m;
    }

    // ==================== 投递执行 ====================

    /**
     * 执行一次投递。
     *
     * @param clipId   剪藏 ID
     * @param targetId 投递目标标识
     * @return 统一结果 Map：{success, result, targetId, targetName, dispatchedAt, error?}
     */
    public Map<String, Object> dispatch(Long clipId, String targetId) {
        Map<String, Object> out = new LinkedHashMap<>();
        ClipContent clip = clipService.getClipById(clipId);
        if (clip == null) {
            out.put("success", false);
            out.put("error", "剪藏不存在: " + clipId);
            return out;
        }
        if (targetId == null || !isKnownTarget(targetId)) {
            out.put("success", false);
            out.put("error", "未知的投递目标: " + targetId);
            return out;
        }
        String content = clip.getContent();
        if (content == null || content.isBlank()) {
            out.put("success", false);
            out.put("error", "剪藏内容为空，无法投递");
            return out;
        }

        String result;
        try {
            result = execute(targetId, clip, content);
        } catch (Exception e) {
            log.error("[Dispatch] target={} clipId={} failed: {}", targetId, clipId, e.getMessage(), e);
            out.put("success", false);
            out.put("error", "AI 调用失败: " + e.getMessage());
            return out;
        }

        String dispatchedAt = LocalDateTime.now().format(TIME_FMT);
        // 回存最近一次投递到剪藏（可空字段，不影响既有字段）
        clipService.updateDispatchResult(clipId, targetId, result);
        // 追加投递记录（旁路存储）
        appendRecord(new DispatchRecord(clipId, targetId, nameOf(targetId), result, dispatchedAt));

        out.put("success", true);
        out.put("result", result);
        out.put("targetId", targetId);
        out.put("targetName", nameOf(targetId));
        out.put("dispatchedAt", dispatchedAt);
        return out;
    }

    private boolean isKnownTarget(String targetId) {
        return getTargets().stream().anyMatch(t -> t.get("id").equals(targetId));
    }

    private String nameOf(String targetId) {
        return getTargets().stream()
                .filter(t -> t.get("id").equals(targetId))
                .map(t -> t.get("name"))
                .findFirst()
                .orElse(targetId);
    }

    /** 目标 → AiService 方法映射（结果统一为 Markdown 文本） */
    private String execute(String targetId, ClipContent clip, String content) {
        switch (targetId) {
            case "internal:analyze":
                return aiService.analyzeContent(content);
            case "internal:summary":
                return aiService.generateSummary(content);
            case "internal:divergent":
                return aiService.generateDivergentSummary(content, clip.getCategory(), clip.getTags());
            case "internal:tags":
                return "建议标签：\n\n" + String.join("、", aiService.generateTags(content));
            case "internal:organize": {
                Map<String, Object> organized = aiService.smartOrganize(content);
                return "推荐分类：" + String.valueOf(organized.getOrDefault("category", "work"))
                        + "\n\n推荐标签：" + String.join("、", (List<String>) organized.getOrDefault("tags", List.of()));
            }
            case "internal:knowledge":
                return aiService.organizeContentForKnowledgeBase(clip.getCategory(), content);
            default:
                throw new IllegalArgumentException("未知目标: " + targetId);
        }
    }

    // ==================== 投递记录（旁路存储） ====================

    /**
     * 获取某剪藏的全部投递记录（含蒸馏记录），按时间升序。
     */
    public List<DispatchRecord> getRecords(Long clipId) {
        Path file = recordFile(clipId);
        if (!Files.exists(file)) {
            return new ArrayList<>();
        }
        try {
            String json = Files.readString(file, StandardCharsets.UTF_8);
            List<DispatchRecord> records = objectMapper.readValue(json, new TypeReference<List<DispatchRecord>>() {
            });
            return records == null ? new ArrayList<>() : records;
        } catch (IOException e) {
            log.warn("[Dispatch] read records failed clipId={}: {}", clipId, e.getMessage());
            return new ArrayList<>();
        }
    }

    private void appendRecord(DispatchRecord record) {
        try {
            Path file = recordFile(record.getClipId());
            List<DispatchRecord> records = new ArrayList<>();
            if (Files.exists(file)) {
                try {
                    records = objectMapper.readValue(Files.readString(file, StandardCharsets.UTF_8),
                            new TypeReference<List<DispatchRecord>>() {
                            });
                } catch (IOException e) {
                    log.warn("[Dispatch] records file corrupt, reset: {}", file);
                    records = new ArrayList<>();
                }
            }
            records.add(record);
            Files.createDirectories(file.getParent());
            Files.writeString(file, objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(records),
                    StandardCharsets.UTF_8);
        } catch (Exception e) {
            log.error("[Dispatch] append record failed: {}", e.getMessage(), e);
        }
    }

    private Path recordFile(Long clipId) {
        return Path.of(storagePath, "dispatch-records", clipId + ".json");
    }

    // ==================== 答案汇总蒸馏 ====================

    /**
     * 将某剪藏的全部投递结果汇总蒸馏为一份精炼总结。
     *
     * @param clipId 剪藏 ID
     * @return 统一结果 Map：{success, result, targetId, targetName, dispatchedAt, error?}
     */
    public Map<String, Object> distill(Long clipId) {
        Map<String, Object> out = new LinkedHashMap<>();
        if (clipService.getClipById(clipId) == null) {
            out.put("success", false);
            out.put("error", "剪藏不存在: " + clipId);
            return out;
        }
        List<DispatchRecord> records = getRecords(clipId).stream()
                .filter(r -> !DISTILL_TARGET_ID.equals(r.getTargetId()))
                .toList();
        if (records.isEmpty()) {
            out.put("success", false);
            out.put("error", "暂无投递记录，请先投递至少一个目标");
            return out;
        }

        StringBuilder combined = new StringBuilder();
        for (DispatchRecord r : records) {
            combined.append("【").append(r.getTargetName()).append("】\n")
                    .append(r.getResult() == null ? "" : r.getResult())
                    .append("\n\n");
        }

        String result;
        try {
            result = aiService.distillAnswers(combined.toString());
        } catch (Exception e) {
            log.error("[Dispatch] distill failed clipId={}: {}", clipId, e.getMessage(), e);
            out.put("success", false);
            out.put("error", "AI 调用失败: " + e.getMessage());
            return out;
        }

        String dispatchedAt = LocalDateTime.now().format(TIME_FMT);
        // 蒸馏结果回存最近投递字段 + 追加蒸馏记录
        clipService.updateDispatchResult(clipId, DISTILL_TARGET_ID, result);
        appendRecord(new DispatchRecord(clipId, DISTILL_TARGET_ID, "蒸馏总结", result, dispatchedAt));

        out.put("success", true);
        out.put("result", result);
        out.put("targetId", DISTILL_TARGET_ID);
        out.put("targetName", "蒸馏总结");
        out.put("dispatchedAt", dispatchedAt);
        return out;
    }
}
