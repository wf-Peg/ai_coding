package com.example.clip.service.wiki;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 本地拆词检索器：对 wiki/index.md 条目做关键词打分，替代/前置 LLM 定位。
 * <p>
 * 零依赖实现：英文按空白拆词，中文连续 CJK 段按 2-gram 切分。
 * 打分规则：question 的每个 token 在（页面名 + 摘要）中命中即计 1 分；
 * 达标条件：命中 token 数 ≥ minHits；按命中数倒序取 Top K。
 * </p>
 * <p>
 * 用于 {@code WikiQueryService.query} 阶段 1：本地命中时跳过
 * {@code AiService.locateRelevantPages} 的 LLM 调用，省一次模型调用；
 * 未命中时自动降级走 LLM，保证语义类问题的命中率。
 * </p>
 */
@Component
public class WikiLocalRetriever {

    private static final Logger log = LoggerFactory.getLogger(WikiLocalRetriever.class);

    private static final Pattern INDEX_ENTRY = Pattern.compile(
            "^- \\[\\[(.+?)\\]\\] — (.+?) \\(updated: .+?\\)$", Pattern.MULTILINE);

    private static final Pattern CJK_SEGMENT = Pattern.compile("[\\u4e00-\\u9fa5]+");

    /**
     * 拆词：英文按空白拆分并小写；中文连续 CJK 段按 2-gram 切分。
     *
     * @param text 待拆词文本
     * @return 去重后的 token 列表
     */
    public List<String> tokenize(String text) {
        Set<String> tokens = new LinkedHashSet<>();
        if (text == null || text.trim().isEmpty()) {
            return new ArrayList<>(tokens);
        }
        String normalized = text.toLowerCase();
        for (String seg : normalized.split("[\\s\\p{Punct}]+")) {
            if (seg.isEmpty()) {
                continue;
            }
            Matcher cjkMatcher = CJK_SEGMENT.matcher(seg);
            int lastEnd = 0;
            while (cjkMatcher.find()) {
                if (cjkMatcher.start() > lastEnd) {
                    tokens.add(seg.substring(lastEnd, cjkMatcher.start()));
                }
                String cjk = cjkMatcher.group();
                if (cjk.length() >= 2) {
                    for (int i = 0; i + 2 <= cjk.length(); i++) {
                        tokens.add(cjk.substring(i, i + 2));
                    }
                }
                lastEnd = cjkMatcher.end();
            }
            if (lastEnd < seg.length()) {
                tokens.add(seg.substring(lastEnd));
            }
        }
        return new ArrayList<>(tokens);
    }

    /**
     * 对 index.md 条目打分检索。
     *
     * @param question    用户问题
     * @param indexContent wiki/index.md 全文
     * @param topK        最多返回条数
     * @param minHits     达标最小命中 token 数
     * @return 达标（≥ minHits）页面名列表，按命中数倒序；未达标返回空列表
     */
    public List<String> retrieve(String question, String indexContent, int topK, int minHits) {
        List<String> queryTokens = tokenize(question);
        if (queryTokens.isEmpty() || indexContent == null || indexContent.isEmpty()) {
            return List.of();
        }
        List<ScoredEntry> scored = new ArrayList<>();
        Matcher matcher = INDEX_ENTRY.matcher(indexContent);
        while (matcher.find()) {
            String pageName = matcher.group(1);
            String summary = matcher.group(2);
            String haystack = (pageName + " " + summary).toLowerCase();
            int hits = 0;
            for (String token : queryTokens) {
                if (token.length() < 2) {
                    continue;
                }
                if (haystack.contains(token)) {
                    hits++;
                }
            }
            if (hits > 0) {
                scored.add(new ScoredEntry(pageName, hits));
            }
        }
        scored.sort(Comparator.comparingInt(ScoredEntry::hits).reversed());
        List<String> result = new ArrayList<>();
        for (ScoredEntry entry : scored) {
            if (entry.hits() < minHits) {
                break;
            }
            result.add(entry.pageName());
            if (result.size() >= topK) {
                break;
            }
        }
        if (!result.isEmpty()) {
            log.debug("[WikiLocalRetriever] Retrieved {} pages (minHits={}, topK={})",
                    result.size(), minHits, topK);
        }
        return result;
    }

    private record ScoredEntry(String pageName, int hits) {}
}
