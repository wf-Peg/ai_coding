package com.example.clip.service;

import com.example.clip.model.LearningPlan.VideoResource;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Exa 语义搜索服务。
 * <p>
 * 封装 <a href="https://exa.ai">Exa</a> API，为学习计划模块提供真实、高质量的学习资源搜索。
 * Exa 基于 embeddings 的语义搜索，理解查询意图而不仅仅是关键词匹配，
 * 返回的结果包含标题、URL、摘要等结构化数据，可直接用于填充 VideoResource。
 * </p>
 *
 * <h3>搜索策略</h3>
 * 每个阶段执行中英文两次搜索，结果合并，确保覆盖中文和英文学习资源。
 *
 * <h3>降级策略</h3>
 * 当 Exa API key 未配置或请求失败时，返回空列表，由调用方（LearningPlanService）
 * 降级为 AI 生成资源。
 */
@Service
public class ExaSearchService {

    private static final Logger log = LoggerFactory.getLogger(ExaSearchService.class);

    private final String apiKey;
    private final boolean enabled;
    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;

    /** Exa 搜索 API 端点 */
    private static final String EXA_SEARCH_URL = "https://api.exa.ai/search";

    /** 中文学习资源域名偏好 */
    private static final List<String> CN_DOMAINS = Arrays.asList(
            "csdn.net", "juejin.cn", "zhihu.com", "bilibili.com",
            "segmentfault.com", "cnblogs.com", "infoq.cn"
    );

    /** 英文学习资源域名偏好 */
    private static final List<String> EN_DOMAINS = Arrays.asList(
            "youtube.com", "github.com", "medium.com", "freecodecamp.org",
            "geeksforgeeks.org", "w3schools.com", "tutorialspoint.com",
            "arxiv.org", "dev.to", "stackoverflow.com"
    );

    public ExaSearchService(
            @Value("${exa.api-key:}") String apiKey,
            @Value("${exa.enabled:true}") boolean enabled) {
        this.apiKey = apiKey;
        this.enabled = enabled && (apiKey != null && !apiKey.isBlank());
        this.objectMapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .build();
        log.info("[ExaSearchService] initialized, enabled={}", this.enabled);
    }

    /**
     * 为单个学习阶段搜索学习资源。
     *
     * @param topic      学习主题（如 "Python 机器学习"）
     * @param phaseGoal  阶段目标（如 "掌握 Python 基础语法"）
     * @param numResults 期望返回的结果数
     * @return VideoResource 列表（可能为空）
     */
    public List<VideoResource> searchResources(String topic, String phaseGoal, int numResults) {
        if (!enabled) {
            log.debug("[Exa] disabled, skip search for: {}", phaseGoal);
            return Collections.emptyList();
        }

        List<VideoResource> allResults = new ArrayList<>();

        try {
            // 中文搜索
            String cnQuery = topic + " " + phaseGoal + " 教程 入门";
            List<VideoResource> cnResults = doSearch(cnQuery, CN_DOMAINS, numResults / 2 + 1);
            allResults.addAll(cnResults);

            // 英文搜索
            String enQuery = topic + " " + phaseGoal + " tutorial guide";
            List<VideoResource> enResults = doSearch(enQuery, EN_DOMAINS, numResults / 2 + 1);
            allResults.addAll(enResults);

            // 去重（按 URL）
            Set<String> seenUrls = new HashSet<>();
            allResults = allResults.stream()
                    .filter(r -> seenUrls.add(r.getUrl()))
                    .limit(numResults)
                    .collect(Collectors.toList());

            log.info("[Exa] search '{}' → {} results", phaseGoal, allResults.size());
        } catch (Exception e) {
            log.warn("[Exa] search failed for '{}': {}", phaseGoal, e.getMessage());
        }

        return allResults;
    }

    /**
     * 执行单次 Exa 搜索。
     *
     * @param query      搜索查询
     * @param domains    偏好域名列表
     * @param numResults 结果数量
     * @return VideoResource 列表
     */
    private List<VideoResource> doSearch(String query, List<String> domains, int numResults) {
        try {
            Map<String, Object> requestBody = new LinkedHashMap<>();
            requestBody.put("query", query);
            requestBody.put("type", "auto");
            requestBody.put("numResults", numResults);
            requestBody.put("contents", Map.of(
                    "text", Map.of("maxCharacters", 500)
            ));
            // 尝试限定域名（不强制，允许 Exa 返回更相关的结果）
            if (domains != null && !domains.isEmpty()) {
                requestBody.put("includeDomains", domains);
            }

            String json = objectMapper.writeValueAsString(requestBody);
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(EXA_SEARCH_URL))
                    .header("Content-Type", "application/json")
                    .header("x-api-key", apiKey)
                    .timeout(Duration.ofSeconds(30))
                    .POST(HttpRequest.BodyPublishers.ofString(json))
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

            if (response.statusCode() != 200) {
                log.warn("[Exa] HTTP {} for query '{}': {}", response.statusCode(), query, response.body());
                return Collections.emptyList();
            }

            return parseSearchResults(response.body());
        } catch (IOException | InterruptedException e) {
            log.warn("[Exa] request failed for '{}': {}", query, e.getMessage());
            return Collections.emptyList();
        }
    }

    /**
     * 解析 Exa 搜索结果，转换为 VideoResource 列表。
     */
    private List<VideoResource> parseSearchResults(String responseBody) {
        List<VideoResource> resources = new ArrayList<>();
        try {
            Map<String, Object> response = objectMapper.readValue(responseBody,
                    new TypeReference<Map<String, Object>>() {});
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> results = (List<Map<String, Object>>) response.get("results");
            if (results == null) return resources;

            for (Map<String, Object> result : results) {
                VideoResource vr = new VideoResource();
                vr.setTitle(Objects.toString(result.get("title"), ""));
                vr.setUrl(Objects.toString(result.get("url"), ""));
                vr.setSource("exa");

                // 使用 highlights 或 text 作为摘要
                Object highlights = result.get("highlights");
                if (highlights instanceof List && !((List<?>) highlights).isEmpty()) {
                    vr.setSnippet(((List<?>) highlights).get(0).toString());
                } else {
                    Object text = result.get("text");
                    if (text != null) {
                        String textStr = text.toString();
                        vr.setSnippet(textStr.length() > 300 ? textStr.substring(0, 300) + "..." : textStr);
                    }
                }

                // 生成推荐理由
                Object publishedDate = result.get("publishedDate");
                String author = Objects.toString(result.get("author"), "");
                vr.setReason(buildReason(Objects.toString(result.get("url"), ""), author, publishedDate));

                if (!vr.getTitle().isEmpty() && !vr.getUrl().isEmpty()) {
                    resources.add(vr);
                }
            }
        } catch (Exception e) {
            log.warn("[Exa] parse results failed: {}", e.getMessage());
        }
        return resources;
    }

    private String buildReason(String url, String author, Object publishedDate) {
        StringBuilder sb = new StringBuilder();
        if (url.contains("youtube.com") || url.contains("bilibili.com")) {
            sb.append("视频教程");
        } else if (url.contains("github.com")) {
            sb.append("开源项目/代码");
        } else if (url.contains("arxiv.org")) {
            sb.append("学术论文");
        } else if (url.contains("csdn.net") || url.contains("juejin.cn") || url.contains("medium.com")) {
            sb.append("技术博客");
        } else {
            sb.append("学习资源");
        }
        if (author != null && !author.isBlank()) {
            sb.append("，作者: ").append(author);
        }
        return sb.toString();
    }
}