package com.example.clip.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * 功能点历史迭代记录服务：为产品概览中的“功能点”提供历史迭代的定位与记录能力。
 *
 * <p>每条迭代记录归属于某个项目（TODO/{需求名称}）下的一个功能点（featurePoints[].id），
 * 结构为 {@code {id, project, fpId, fpName, version, note, tags, status, createdAt}}。
 *
 * <p>数据持久化在 {@code {configDir}/index/feature-point-iterations.json}（与 workspace.json、
 * workspace-rules.json 等同目录），文件不存在时按空列表处理，保证产品概览页正常渲染。
 */
public class FeaturePointIterationService {
    private static final Logger log = LoggerFactory.getLogger(FeaturePointIterationService.class);
    private static final String ITERATIONS_FILE = "feature-point-iterations.json";
    private static final DateTimeFormatter ISO_FORMAT = DateTimeFormatter.ISO_LOCAL_DATE_TIME;

    private final Path iterationsPath;
    private final ObjectMapper objectMapper = new ObjectMapper().registerModule(new JavaTimeModule());

    public FeaturePointIterationService(Path indexDir) {
        this.iterationsPath = indexDir.resolve(ITERATIONS_FILE);
    }

    /**
     * 读取全部迭代记录（文件不存在时返回空列表）。
     */
    public synchronized List<Map<String, Object>> loadAll() {
        if (!Files.exists(iterationsPath)) {
            return new ArrayList<>();
        }
        try {
            return objectMapper.readValue(iterationsPath.toFile(), new TypeReference<List<Map<String, Object>>>() {});
        } catch (IOException e) {
            log.warn("[FeaturePointIterationService] 读取迭代记录失败: {} ({})", iterationsPath, e.getMessage());
            return new ArrayList<>();
        }
    }

    /**
     * 按项目/功能点过滤迭代记录（参数为空或空白时不过滤）。
     *
     * @param project 项目目录名（TODO 下的需求目录名），可为 null
     * @param fpId    功能点 ID（featurePoints[].id），可为 null
     */
    public List<Map<String, Object>> loadByTarget(String project, String fpId) {
        return loadAll().stream()
                .filter(r -> (project == null || project.isBlank() || project.equals(r.get("project")))
                        && (fpId == null || fpId.isBlank() || fpId.equals(r.get("fpId"))))
                .collect(Collectors.toList());
    }

    /**
     * 新增一条迭代记录。缺省字段自动补全：id 用 UUID，createdAt 用当前时间。
     *
     * @param record 前端传入的记录（project/fpId/fpName/version/note/tags/status）
     * @return 补全后的完整记录
     */
    public synchronized Map<String, Object> add(Map<String, Object> record) {
        List<Map<String, Object>> all = new ArrayList<>(loadAll());
        String id = record.get("id") != null ? String.valueOf(record.get("id")) : UUID.randomUUID().toString();
        String createdAt = record.get("createdAt") != null
                ? String.valueOf(record.get("createdAt"))
                : LocalDateTime.now().format(ISO_FORMAT);

        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", id);
        item.put("project", record.getOrDefault("project", ""));
        item.put("fpId", record.getOrDefault("fpId", ""));
        item.put("fpName", record.getOrDefault("fpName", ""));
        item.put("version", record.getOrDefault("version", "v1"));
        item.put("note", record.getOrDefault("note", ""));
        item.put("tags", record.getOrDefault("tags", List.of()));
        item.put("status", record.getOrDefault("status", "in-progress"));
        // DSH 会话成果（牛马记录）四字段：title/problem/solution/outcome 与来源 source
        item.put("title", record.getOrDefault("title", ""));
        item.put("problem", record.getOrDefault("problem", ""));
        item.put("solution", record.getOrDefault("solution", ""));
        item.put("outcome", record.getOrDefault("outcome", ""));
        item.put("source", record.getOrDefault("source", "manual"));
        item.put("createdAt", createdAt);
        all.add(item);
        writeAll(all);
        return item;
    }

    /**
     * 删除一条迭代记录。
     *
     * @return true 表示删除成功；false 表示记录不存在
     */
    public synchronized boolean delete(String id) {
        List<Map<String, Object>> all = new ArrayList<>(loadAll());
        boolean removed = all.removeIf(r -> id != null && id.equals(r.get("id")));
        if (removed) {
            writeAll(all);
        }
        return removed;
    }

    private synchronized void writeAll(List<Map<String, Object>> items) {
        try {
            if (iterationsPath.getParent() != null) {
                Files.createDirectories(iterationsPath.getParent());
            }
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(iterationsPath.toFile(), items);
        } catch (IOException e) {
            throw new IllegalStateException("保存功能点迭代记录失败: " + e.getMessage(), e);
        }
    }
}
