package com.example.clip.service.wiki;

import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Wiki 问答运行时耗时指标（内存环形缓冲，进程内有效、重启清空）。
 * <p>
 * 由 {@code WikiQueryService} 在每次 {@code query()} 正常返回前写入一条分阶段耗时记录，
 * 供「数据观测」模块的 {@code GET /api/data/wiki-query-metrics} 读取快照，
 * 用于诊断 wiki_ask / Web UI 问答的延迟构成（定位 / 综合 / 知识补充）。
 * 不落盘、不引入任何外部依赖，保持轻量。
 * </p>
 */
@Component
public class WikiQueryMetrics {

    /** 环形缓冲上限：保留最近 50 次查询 */
    private static final int MAX_RECORDS = 50;

    /** 问题展示截断长度（字符） */
    private static final int QUESTION_MAX_CHARS = 40;

    /** 记录队列：最旧在前，最新在后 */
    private final Deque<Map<String, Object>> recent = new ArrayDeque<>();

    /**
     * 记录一次 Wiki 查询的分阶段耗时。
     *
     * @param question   用户问题（展示时截断）
     * @param totalMs    查询总耗时（毫秒）
     * @param locateMs   页面定位耗时（本地检索或 LLM 兜底，毫秒）
     * @param synthMs    答案综合耗时（毫秒）
     * @param supplMs    知识补充耗时（毫秒）；{@code < 0} 表示本次跳过补充
     * @param usedLocal  定位是否由本地检索命中（true）而非 LLM 兜底（false）
     * @param pageCount  参与综合的相关页面数
     */
    public synchronized void record(String question, long totalMs, long locateMs,
                                    long synthMs, long supplMs, boolean usedLocal, int pageCount) {
        Map<String, Object> entry = new LinkedHashMap<>();
        entry.put("time", LocalDateTime.now().withNano(0).toString());
        entry.put("question", truncate(question, QUESTION_MAX_CHARS));
        entry.put("totalMs", totalMs);
        entry.put("locateMs", locateMs);
        entry.put("synthMs", synthMs);
        entry.put("supplMs", supplMs);
        entry.put("usedLocal", usedLocal);
        entry.put("pageCount", pageCount);
        recent.addLast(entry);
        while (recent.size() > MAX_RECORDS) {
            recent.removeFirst();
        }
    }

    /**
     * 返回指标快照：聚合统计 + 最近记录列表（最新在前）。
     *
     * @return {@code {count, stats: {...}, recent: [...]}}；无记录时 stats 为空 Map
     */
    public synchronized Map<String, Object> snapshot() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("count", recent.size());
        result.put("stats", buildStats());
        List<Map<String, Object>> newestFirst = new ArrayList<>(recent);
        java.util.Collections.reverse(newestFirst);
        result.put("recent", newestFirst);
        result.put("bufferSize", MAX_RECORDS);
        return result;
    }

    private Map<String, Object> buildStats() {
        Map<String, Object> stats = new LinkedHashMap<>();
        if (recent.isEmpty()) {
            return stats;
        }
        long count = recent.size();
        stats.put("avgTotalMs", round1(avgLong("totalMs") * 10) / 10.0);
        stats.put("maxTotalMs", maxLong("totalMs"));
        stats.put("avgSynthMs", round1(avgLong("synthMs") * 10) / 10.0);
        stats.put("avgSupplMs", avgPositiveLong("supplMs"));
        long localHits = recent.stream().filter(e -> Boolean.TRUE.equals(e.get("usedLocal"))).count();
        stats.put("localHitRate", round1(localHits * 1000.0 / count) / 10.0);
        return stats;
    }

    private double avgLong(String key) {
        return recent.stream().mapToLong(e -> toLong(e.get(key))).average().orElse(0.0);
    }

    /** 仅统计非负值（supplMs < 0 表示跳过，不计入平均值） */
    private double avgPositiveLong(String key) {
        return recent.stream()
                .mapToLong(e -> toLong(e.get(key)))
                .filter(v -> v >= 0)
                .average()
                .orElse(0.0);
    }

    private long maxLong(String key) {
        return recent.stream().mapToLong(e -> toLong(e.get(key))).max().orElse(0L);
    }

    private static long toLong(Object value) {
        return value instanceof Number ? ((Number) value).longValue() : 0L;
    }

    private static double round1(double value) {
        return Math.round(value * 10) / 10.0;
    }

    private static String truncate(String text, int maxChars) {
        if (text == null || text.isBlank()) {
            return "";
        }
        String trimmed = text.trim();
        return trimmed.length() <= maxChars ? trimmed : trimmed.substring(0, maxChars) + "…";
    }
}