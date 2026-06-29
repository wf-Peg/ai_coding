package com.example.clip.service;

import com.example.clip.core.AiService;
import com.example.clip.model.ClipContent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.stream.Collectors;

/**
 * 搜索服务
 * <p>
 * 提供剪藏内容的全文搜索功能，采用两级搜索策略：
 * <ol>
 *   <li><b>精确匹配</b>：在剪藏内容（正文、摘要、分析、标签等）中做大小写不敏感的 contains 匹配</li>
 *   <li><b>AI 同义词搜索</b>：如果精确匹配无结果，调用 AI 生成同义词，逐个同义词进行搜索并去重合并</li>
 * </ol>
 * 支持全局搜索和按分类搜索两种模式。
 * </p>
 */
@Service
public class SearchService {

    private static final Logger log = LoggerFactory.getLogger(SearchService.class);

    /** 文件存储服务，用于获取所有剪藏数据 */
    private final FileStorageService storageService;
    /** AI 服务，用于生成同义词 */
    private final AiService aiService;

    @Autowired
    public SearchService(FileStorageService storageService, AiService aiService) {
        this.storageService = storageService;
        this.aiService = aiService;
    }

    /**
     * 全局搜索（无分类限制）
     * <p>
     * 搜索策略：
     * <ol>
     *   <li>先在所有剪藏中做精确匹配（contains），有结果则直接返回</li>
     *   <li>无结果则调用 AI 生成同义词，逐个同义词搜索</li>
     * </ol>
     * </p>
     *
     * @param query 搜索关键词
     * @param topK  最大返回数量
     * @return 匹配的剪藏内容列表
     */
    public List<ClipContent> search(String query, int topK) {
        try {
            List<ClipContent> allClips = storageService.getAllClips();

            // 第一步：精确匹配（grep 风格）
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
     * <p>
     * 先按分类过滤剪藏内容，再在过滤结果中执行精确匹配和同义词搜索。
     * </p>
     *
     * @param query    搜索关键词
     * @param category 分类名称
     * @param topK     最大返回数量
     * @return 匹配的剪藏内容列表
     */
    public List<ClipContent> searchByCategory(String query, String category, int topK) {
        try {
            // 先按分类过滤数据范围
            List<ClipContent> categoryClips = storageService.getClipsByCategory(category);

            // 第一步：精确匹配
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
     * <p>
     * 流程：
     * <ol>
     *   <li>调用 AI 生成不超过 3 个同义词</li>
     *   <li>逐个同义词在剪藏列表中做精确匹配</li>
     *   <li>使用 Set 按 ID 去重，避免同一剪藏被多次返回</li>
     *   <li>跳过与原始查询相同的同义词</li>
     *   <li>限制返回数量不超过 topK</li>
     * </ol>
     * </p>
     *
     * @param query 原始搜索关键词
     * @param clips 搜索范围（剪藏列表）
     * @param topK  最大返回数量
     * @return 去重后的匹配剪藏列表
     */
    private List<ClipContent> searchWithSynonyms(String query, List<ClipContent> clips, int topK) {
        log.info("[Search] No grep match for: {}, requesting AI synonyms...", query);

        List<String> synonyms = aiService.generateSynonyms(query);
        log.info("[Search] AI synonyms: {}", synonyms);

        if (synonyms.isEmpty()) {
            return List.of();
        }

        // 用 Set 按 clip id 去重，避免同一剪藏因多个同义词命中而重复出现
        Set<Long> seenIds = new HashSet<>();
        List<ClipContent> results = new ArrayList<>();

        for (String synonym : synonyms) {
            // 跳过和原始查询相同的同义词，避免重复搜索
            if (synonym.equalsIgnoreCase(query.trim())) {
                continue;
            }

            List<ClipContent> synonymResults = clips.stream()
                    .filter(clip -> isGrepMatch(synonym, clip))
                    .filter(clip -> !seenIds.contains(clip.getId())) // 去重
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
     * 精确匹配检查
     * <p>
     * 将剪藏的所有可搜索字段拼接成一个字符串，然后做大小写不敏感的 contains 匹配。
     * </p>
     *
     * @param query 搜索关键词
     * @param clip  剪藏内容
     * @return 是否匹配
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
     * 构建剪藏的可搜索文本
     * <p>
     * 将剪藏的所有文本字段拼接为一个大字符串（小写），
     * 包括：正文、类型、来源、分类、摘要、分析、所有标签、
     * 用户自己的思考（myThoughts）、AI发散性总结（divergentSummary）。
     * 这样一次 contains 即可覆盖所有字段。
     * </p>
     *
     * @param clip 剪藏内容
     * @return 拼接后的可搜索文本（小写）
     */
    private String buildSearchText(ClipContent clip) {
        StringBuilder sb = new StringBuilder();
        // 拼接各文本字段，用空格分隔
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
        sb.append(" ");
        sb.append(clip.getMyThoughts() != null ? clip.getMyThoughts() : "");
        sb.append(" ");
        sb.append(clip.getDivergentSummary() != null ? clip.getDivergentSummary() : "");

        // 标签也加入搜索范围
        if (clip.getTags() != null) {
            for (String tag : clip.getTags()) {
                sb.append(" ");
                sb.append(tag);
            }
        }

        // 统一转小写，实现大小写不敏感匹配
        return sb.toString().toLowerCase();
    }
}