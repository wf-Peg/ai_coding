package com.example.clip.service;

import com.example.clip.model.ClipContent;
import com.example.clip.model.KnowledgeEntry;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 轻量知识条目服务
 */
@Service
public class KnowledgeService {

    private final FileStorageService storageService;
    private final ClipService clipService;

    public KnowledgeService(FileStorageService storageService, ClipService clipService) {
        this.storageService = storageService;
        this.clipService = clipService;
    }

    /**
     * 从剪藏派生知识条目（同步）
     */
    public KnowledgeEntry deriveFromClip(Long clipId) {
        ClipContent clip = clipService.getClipById(clipId);
        if (clip == null) {
            throw new IllegalArgumentException("未找到对应剪藏记录: " + clipId);
        }

        KnowledgeEntry entry = new KnowledgeEntry();
        entry.setSourceClipId(clip.getId());
        entry.setTitle(firstNonBlank(clip.getTitle(), clip.getSelectedText(), clip.getSummary(), "未命名知识条目"));
        entry.setSummary(firstNonBlank(clip.getSummary(), clip.getContent(), ""));
        entry.setInsight(firstNonBlank(clip.getAnalysis(), clip.getSummary(), ""));
        entry.setTags(clip.getTags() == null ? new ArrayList<>() : new ArrayList<>(clip.getTags()));
        entry.setCategory(firstNonBlank(clip.getCategory(), "default"));
        entry.setKeywords(extractKeywords(entry));

        return storageService.saveKnowledgeEntry(entry);
    }

    /**
     * 从剪藏派生知识条目（异步）
     */
    @Async
    public void deriveFromClipAsync(Long clipId) {
        deriveFromClip(clipId);
    }

    public List<KnowledgeEntry> listAll() {
        return storageService.getAllKnowledgeEntries();
    }

    public KnowledgeEntry getById(Long id) {
        return storageService.getKnowledgeEntryById(id);
    }

    public List<KnowledgeEntry> getBySourceClipId(Long clipId) {
        return storageService.getKnowledgeEntriesBySourceClipId(clipId);
    }

    public List<KnowledgeEntry> search(String query, String category, int topK) {
        List<KnowledgeEntry> all = storageService.getAllKnowledgeEntries();
        if (all.isEmpty()) {
            return Collections.emptyList();
        }

        String normalizedQuery = query == null ? "" : query.trim().toLowerCase(Locale.ROOT);
        String normalizedCategory = category == null ? "" : category.trim().toLowerCase(Locale.ROOT);

        return all.stream()
                .filter(entry -> normalizedCategory.isBlank() || (entry.getCategory() != null && normalizedCategory.equals(entry.getCategory().toLowerCase(Locale.ROOT))))
                .map(entry -> Map.entry(entry, calcScore(entry, normalizedQuery)))
                .filter(pair -> normalizedQuery.isBlank() || pair.getValue() > 0)
                .sorted((a, b) -> Integer.compare(b.getValue(), a.getValue()))
                .limit(Math.max(topK, 1))
                .map(Map.Entry::getKey)
                .collect(Collectors.toList());
    }

    private int calcScore(KnowledgeEntry entry, String query) {
        if (query == null || query.isBlank()) {
            return 1;
        }
        int score = 0;
        score += contains(entry.getTitle(), query) ? 4 : 0;
        score += contains(entry.getSummary(), query) ? 3 : 0;
        score += contains(entry.getInsight(), query) ? 3 : 0;
        score += containsAny(entry.getTags(), query) ? 2 : 0;
        score += containsAny(entry.getKeywords(), query) ? 2 : 0;
        return score;
    }

    private boolean contains(String value, String query) {
        return value != null && value.toLowerCase(Locale.ROOT).contains(query);
    }

    private boolean containsAny(List<String> values, String query) {
        if (values == null || values.isEmpty()) {
            return false;
        }
        return values.stream().anyMatch(item -> contains(item, query));
    }

    private List<String> extractKeywords(KnowledgeEntry entry) {
        List<String> keywords = new ArrayList<>();
        addKeyword(keywords, entry.getTitle());
        addKeyword(keywords, entry.getCategory());
        if (entry.getTags() != null) {
            entry.getTags().forEach(tag -> addKeyword(keywords, tag));
        }
        return keywords.stream().distinct().limit(10).collect(Collectors.toList());
    }

    private void addKeyword(List<String> keywords, String candidate) {
        if (candidate == null || candidate.isBlank()) {
            return;
        }
        String normalized = candidate.trim();
        if (normalized.length() <= 20) {
            keywords.add(normalized);
        }
    }

    private String firstNonBlank(String... values) {
        for (String value : values) {
            if (value != null && !value.isBlank()) {
                return value.trim();
            }
        }
        return null;
    }
}
