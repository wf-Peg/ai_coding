package com.example.clip.service;

import com.example.clip.index.ContentIndexService;
import com.example.clip.model.Knowledge;
import com.example.clip.model.KnowledgeEntry;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 存量知识数据迁移。
 * <p>
 * 旧版知识条目以 {@link KnowledgeEntry} 存储于 {@code clip-storage/knowledge/}，新版 {@link Knowledge}
 * 存储于 {@code clip-storage/knowledge-base/}。历史版本从未执行迁移，导致旧数据"存在于磁盘却读不到"，
 * 知识模块列表返回空并提示"暂无知识条目"。
 * </p>
 * <p>
 * 本组件在应用启动时读取旧目录：对尚未迁移的条目转换为新版模型写入 {@code knowledge-base/}（保留旧文件），
 * 驱动多次启动不重复导入（基于条目 ID 与标记文件双重去重），完成后同步重建内容索引，使列表/详情/图谱/
 * 工作台筛选都能拾取。
 * </p>
 */
@Component
public class LegacyKnowledgeMigrationRunner implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(LegacyKnowledgeMigrationRunner.class);
    private static final String MARKER_FILE = "knowledge-legacy-migration.json";
    private static final String MARKER_IDS_KEY = "migratedIds";

    private final AppConfigService appConfigService;
    private final FileStorageService fileStorageService;
    private final ObjectMapper objectMapper = new ObjectMapper()
            .registerModule(new JavaTimeModule())
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);

    public LegacyKnowledgeMigrationRunner(AppConfigService appConfigService, FileStorageService fileStorageService) {
        this.appConfigService = appConfigService;
        this.fileStorageService = fileStorageService;
    }

    @Override
    public void run(String... args) {
        try {
            int migrated = migrate();
            if (migrated > 0) {
                rebuildContentIndex();
                log.info("event=legacyKnowledge.migrated count={}", migrated);
            } else {
                log.debug("event=legacyKnowledge.nothing_to_migrate");
            }
        } catch (Exception error) {
            log.warn("event=legacyKnowledge.migration_skipped error={}", error.getMessage(), error);
        }
    }

    private int migrate() {
        List<KnowledgeEntry> legacyEntries = fileStorageService.getAllKnowledgeEntries();
        if (legacyEntries == null || legacyEntries.isEmpty()) {
            return 0;
        }

        Set<Long> migratedIds = new HashSet<>(readMigratedIds());
        // 已存在于新模型中的 id 视为已迁移，跳过
        Set<Long> existingKnowledgeIds = new HashSet<>();
        fileStorageService.getAllKnowledge().forEach(k -> {
            if (k.getId() != null) existingKnowledgeIds.add(k.getId());
        });

        int migrated = 0;
        for (KnowledgeEntry entry : legacyEntries) {
            if (entry.getId() == null) {
                continue;
            }
            if (migratedIds.contains(entry.getId()) || existingKnowledgeIds.contains(entry.getId())) {
                continue;
            }
            Knowledge knowledge = toKnowledge(entry);
            fileStorageService.saveKnowledge(knowledge);
            migratedIds.add(entry.getId());
            migrated++;
        }

        if (migrated > 0) {
            writeMigratedIds(migratedIds);
        }
        return migrated;
    }

    private Knowledge toKnowledge(KnowledgeEntry entry) {
        Knowledge knowledge = new Knowledge();
        // 复用旧条目 ID 保持身份延续，避免重导入；类型隔离下与剪藏/待办同值 ID 不冲突
        knowledge.setId(entry.getId());
        knowledge.setTitle(entry.getTitle());
        knowledge.setSummary(entry.getSummary());
        // 内容正文：优先用洞察(insight)，如摘要存在且不同于洞察则作为引言拼入
        String insight = emptyToNull(entry.getInsight());
        String summary = emptyToNull(entry.getSummary());
        if (insight != null) {
            knowledge.setContent(summary != null && !summary.equals(insight) ? "> " + summary + "\n\n" + insight : insight);
        } else {
            knowledge.setContent(summary);
        }
        knowledge.setCategory(entry.getCategory());

        List<String> tags = new ArrayList<>();
        if (entry.getTags() != null) tags.addAll(entry.getTags());
        if (entry.getKeywords() != null) {
            for (String keyword : entry.getKeywords()) {
                if (keyword != null && !keyword.isBlank() && !tags.contains(keyword)) {
                    tags.add(keyword);
                }
            }
        }
        knowledge.setTags(tags);

        List<Long> sourceClipIds = new ArrayList<>();
        if (entry.getSourceClipId() != null) sourceClipIds.add(entry.getSourceClipId());
        knowledge.setSourceClipIds(sourceClipIds);

        knowledge.setLinkedKnowledgeIds(new ArrayList<>());
        knowledge.setCreatedAt(entry.getCreatedAt() != null ? entry.getCreatedAt() : knowledge.getCreatedAt());
        knowledge.setUpdatedAt(knowledge.getCreatedAt());
        return knowledge;
    }

    private String emptyToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    private Path markerPath() {
        return Path.of(appConfigService.getConfigDirPath(), "index", MARKER_FILE);
    }

    @SuppressWarnings("unchecked")
    private List<Long> readMigratedIds() {
        Path path = markerPath();
        if (!Files.exists(path)) {
            return new ArrayList<>();
        }
        try {
            Map<String, Object> data = objectMapper.readValue(path.toFile(), Map.class);
            Object raw = data.get(MARKER_IDS_KEY);
            if (raw instanceof List) {
                List<Long> ids = new ArrayList<>();
                for (Object item : (List<Object>) raw) {
                    if (item instanceof Number number) {
                        ids.add(number.longValue());
                    }
                }
                return ids;
            }
        } catch (Exception error) {
            log.warn("event=legacyKnowledge.marker_read_failed error={}", error.getMessage());
        }
        return new ArrayList<>();
    }

    private void writeMigratedIds(Set<Long> migratedIds) {
        try {
            Path path = markerPath();
            Files.createDirectories(path.getParent());
            Map<String, Object> data = new LinkedHashMap<>();
            List<Long> sorted = new ArrayList<>(migratedIds);
            sorted.sort(Long::compareTo);
            data.put(MARKER_IDS_KEY, sorted);
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(path.toFile(), data);
        } catch (Exception error) {
            log.warn("event=legacyKnowledge.marker_write_failed error={}", error.getMessage());
        }
    }

    private void rebuildContentIndex() {
        try {
            Path path = Path.of(appConfigService.getConfigDirPath(), "index", "content-index.json");
            new ContentIndexService(path).rebuildFromStorage(fileStorageService);
        } catch (Exception error) {
            log.warn("event=legacyKnowledge.index_rebuild_failed error={}", error.getMessage());
        }
    }
}