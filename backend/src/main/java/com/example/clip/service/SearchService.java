package com.example.clip.service;

import com.example.clip.core.AiService;
import com.example.clip.model.ClipContent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.stream.Collectors;

@Service
public class SearchService {

    private static final Logger log = LoggerFactory.getLogger(SearchService.class);

    private final FileStorageService storageService;
    private final AiService aiService;

    @Autowired
    public SearchService(FileStorageService storageService, AiService aiService) {
        this.storageService = storageService;
        this.aiService = aiService;
    }

    /**
     * 全局搜索（无分类限制）
     * 1. grep 精确匹配所有文件
     * 2. 无结果则 AI 生成同义词，逐个 grep 搜索
     */
    public List<ClipContent> search(String query, int topK) {
        try {
            List<ClipContent> allClips = storageService.getAllClips();

            // 第一步：grep 精确匹配
            List<ClipContent> grepResults = allClips.stream()
                    .filter(clip -> isGrepMatch(query, clip))
                    .collect(Collectors.toList());

            if (!grepResults.isEmpty()) {
                return grepResults;
            }

            // 第二步：AI 同义词搜索
            return searchWithSynonyms(query, allClips, topK);
        } catch (Exception e) {
            e.printStackTrace();
            return List.of();
        }
    }

    /**
     * 按分类搜索
     * 1. grep 精确匹配对应分类目录
     * 2. 无结果则 AI 生成同义词，逐个 grep 搜索
     */
    public List<ClipContent> searchByCategory(String query, String category, int topK) {
        try {
            List<ClipContent> categoryClips = storageService.getClipsByCategory(category);

            // 第一步：grep 精确匹配
            List<ClipContent> grepResults = categoryClips.stream()
                    .filter(clip -> isGrepMatch(query, clip))
                    .collect(Collectors.toList());

            if (!grepResults.isEmpty()) {
                return grepResults;
            }

            // 第二步：AI 同义词搜索
            return searchWithSynonyms(query, categoryClips, topK);
        } catch (Exception e) {
            e.printStackTrace();
            return List.of();
        }
    }

    /**
     * AI 同义词循环搜索
     * 1. 调用 AI 生成不超过3个同义词
     * 2. 逐个同义词进行 grep 搜索
     * 3. 合并去重后返回
     */
    private List<ClipContent> searchWithSynonyms(String query, List<ClipContent> clips, int topK) {
        log.info("[Search] No grep match for: {}, requesting AI synonyms...", query);

        List<String> synonyms = aiService.generateSynonyms(query);
        log.info("[Search] AI synonyms: {}", synonyms);

        if (synonyms.isEmpty()) {
            return List.of();
        }

        // 用 Set 去重（按 clip id）
        Set<Long> seenIds = new HashSet<>();
        List<ClipContent> results = new ArrayList<>();

        for (String synonym : synonyms) {
            if (synonym.equalsIgnoreCase(query.trim())) {
                continue; // 跳过和原词相同的同义词
            }

            List<ClipContent> synonymResults = clips.stream()
                    .filter(clip -> isGrepMatch(synonym, clip))
                    .filter(clip -> !seenIds.contains(clip.getId()))
                    .collect(Collectors.toList());

            for (ClipContent clip : synonymResults) {
                seenIds.add(clip.getId());
                results.add(clip);
            }

            log.info("[Search] Synonym '{}' found {} results", synonym, synonymResults.size());
        }

        // 限制返回数量
        if (results.size() > topK) {
            return results.subList(0, topK);
        }

        return results;
    }

    /**
     * grep 精确匹配（关键词包含检查）
     */
    private boolean isGrepMatch(String query, ClipContent clip) {
        if (query == null || query.trim().isEmpty()) {
            return false;
        }

        String text = buildSearchText(clip);
        String queryLower = query.toLowerCase().trim();

        return text.contains(queryLower);
    }

    /**
     * 提取剪藏内容的所有可搜索文本
     */
    private String buildSearchText(ClipContent clip) {
        StringBuilder sb = new StringBuilder();
        sb.append(clip.getContent() != null ? clip.getContent() : "");
        sb.append(" ");
        sb.append(clip.getType() != null ? clip.getType() : "");
        sb.append(" ");
        sb.append(clip.getSource() != null ? clip.getSource() : "");
        sb.append(" ");
        sb.append(clip.getCategory() != null ? clip.getCategory() : "");
        sb.append(" ");
        sb.append(clip.getSummary() != null ? clip.getSummary() : "");
        sb.append(" ");
        sb.append(clip.getAnalysis() != null ? clip.getAnalysis() : "");

        // 也搜索标签
        if (clip.getTags() != null) {
            for (String tag : clip.getTags()) {
                sb.append(" ");
                sb.append(tag);
            }
        }

        return sb.toString().toLowerCase();
    }
}
