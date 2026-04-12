package com.example.clip.service;

import com.example.clip.model.ClipContent;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Comparator;
import java.util.List;
import java.util.AbstractMap.SimpleEntry;
import java.util.stream.Collectors;

@Service
public class SearchService {

    private final FileStorageService storageService;

    @Autowired
    public SearchService(FileStorageService storageService) {
        this.storageService = storageService;
    }

    public List<ClipContent> search(String query, int topK) {
        try {
            // 获取所有剪藏内容
            List<ClipContent> allClips = storageService.getAllClips();
            
            // 第一步：先进行grep关键词精确匹配
            List<ClipContent> grepResults = allClips.stream()
                    .filter(clip -> isGrepMatch(query, clip))
                    .collect(Collectors.toList());
            
            if (!grepResults.isEmpty()) {
                return grepResults;
            }
            
            // 第二步：如果grep匹配没有结果，则使用关键词相似度搜索
            List<ClipContent> results = allClips.stream()
                    .map(clip -> new SimpleEntry<>(clip, calculateKeywordSimilarity(query, clip)))
                    .filter(entry -> entry.getValue() >= 0.5) // 过滤掉权重低于0.5的
                    .sorted(Comparator.comparing(SimpleEntry<ClipContent, Double>::getValue).reversed()) // 按相似度降序排序
                    .limit(topK)
                    .map(SimpleEntry::getKey)
                    .collect(Collectors.toList());
            
            return results;
        } catch (Exception e) {
            e.printStackTrace();
            return List.of();
        }
    }

    public List<ClipContent> searchByCategory(String query, String category, int topK) {
        try {
            // 获取指定分类的剪藏内容
            List<ClipContent> categoryClips = storageService.getClipsByCategory(category);
            
            // 第一步：先进行grep关键词精确匹配
            List<ClipContent> grepResults = categoryClips.stream()
                    .filter(clip -> isGrepMatch(query, clip))
                    .collect(Collectors.toList());
            
            if (!grepResults.isEmpty()) {
                return grepResults;
            }
            
            // 第二步：如果grep匹配没有结果，则使用关键词相似度搜索
            List<ClipContent> results = categoryClips.stream()
                    .map(clip -> new SimpleEntry<>(clip, calculateKeywordSimilarity(query, clip)))
                    .filter(entry -> entry.getValue() >= 0.5) // 过滤掉权重低于0.5的
                    .sorted(Comparator.comparing(SimpleEntry<ClipContent, Double>::getValue).reversed()) // 按相似度降序排序
                    .limit(topK)
                    .map(SimpleEntry::getKey)
                    .collect(Collectors.toList());
            
            return results;
        } catch (Exception e) {
            e.printStackTrace();
            return List.of();
        }
    }

    /**
     * 判断是否grep匹配（精确包含关键词）
     * @param query 搜索关键词
     * @param clip 剪藏内容
     * @return 是否匹配
     */
    private boolean isGrepMatch(String query, ClipContent clip) {
        if (query == null || query.trim().isEmpty()) {
            return false;
        }
        
        // 提取剪藏内容的所有文本
        StringBuilder textBuilder = new StringBuilder();
        textBuilder.append(clip.getContent() != null ? clip.getContent() : "");
        textBuilder.append(" ");
        textBuilder.append(clip.getType() != null ? clip.getType() : "");
        textBuilder.append(" ");
        textBuilder.append(clip.getSource() != null ? clip.getSource() : "");
        textBuilder.append(" ");
        textBuilder.append(clip.getCategory() != null ? clip.getCategory() : "");
        textBuilder.append(" ");
        textBuilder.append(clip.getSummary() != null ? clip.getSummary() : "");
        textBuilder.append(" ");
        textBuilder.append(clip.getAnalysis() != null ? clip.getAnalysis() : "");
        
        String text = textBuilder.toString().toLowerCase();
        String queryLower = query.toLowerCase().trim();
        
        return text.contains(queryLower);
    }

    /**
     * 计算关键词相似度
     * @param query 搜索关键词
     * @param clip 剪藏内容
     * @return 相似度分数，范围0-1
     */
    private double calculateKeywordSimilarity(String query, ClipContent clip) {
        if (query == null || query.trim().isEmpty()) {
            return 0.0;
        }
        
        // 提取剪藏内容的所有文本
        StringBuilder textBuilder = new StringBuilder();
        textBuilder.append(clip.getContent() != null ? clip.getContent() : "");
        textBuilder.append(" ");
        textBuilder.append(clip.getType() != null ? clip.getType() : "");
        textBuilder.append(" ");
        textBuilder.append(clip.getSource() != null ? clip.getSource() : "");
        textBuilder.append(" ");
        textBuilder.append(clip.getCategory() != null ? clip.getCategory() : "");
        textBuilder.append(" ");
        textBuilder.append(clip.getSummary() != null ? clip.getSummary() : "");
        textBuilder.append(" ");
        textBuilder.append(clip.getAnalysis() != null ? clip.getAnalysis() : "");
        
        String text = textBuilder.toString().toLowerCase();
        String queryLower = query.toLowerCase().trim();
        
        // 如果查询包含完整内容，则返回最高相似度
        if (text.contains(queryLower)) {
            return 1.0;
        }
        
        // 简单的关键词匹配算法
        // 计算查询关键词在文本中出现的次数
        String[] queryWords = queryLower.split("\\s+");
        int matchCount = 0;
        
        for (String word : queryWords) {
            if (!word.isEmpty() && text.contains(word)) {
                matchCount++;
            }
        }
        
        // 计算相似度分数
        return queryWords.length > 0 ? (double) matchCount / queryWords.length : 0.0;
    }
}
