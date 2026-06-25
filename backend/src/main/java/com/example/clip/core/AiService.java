package com.example.clip.core;

import com.example.clip.service.PromptConfigService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.stream.Collectors;

/**
 * AI服务类
 * 通过 LlmProvider 抽象层调用大模型，支持 DashScope / DeepSeek 热切换
 */
@Service
public class AiService {

    private static final Logger logger = LoggerFactory.getLogger(AiService.class);
    private final LlmProvider llmProvider;
    private final PromptConfigService promptConfigService;

    @Autowired
    public AiService(LlmProvider llmProvider, PromptConfigService promptConfigService) {
        this.llmProvider = llmProvider;
        this.promptConfigService = promptConfigService;
    }

    /**
     * One-shot processing: generate summary, analysis, and tags in a single API call.
     */
    public Map<String, Object> processClipContent(String content) {
        return processClipContent(content, true);
    }

    public Map<String, Object> processClipContent(String content, boolean includeCategory) {
        StringBuilder systemPrompt = new StringBuilder();
        systemPrompt.append(promptConfigService.getClipAnalyzePrompt()).append("\n\n");
        systemPrompt.append("请对以下内容完成");
        systemPrompt.append(includeCategory ? "四项任务" : "三项任务");
        systemPrompt.append("，严格按JSON格式返回：\n\n")
                .append("1. 摘要(summary)：不超过100字的简短摘要\n")
                .append("2. 分析(analysis)：使用markdown格式，提取关键信息进行深度分析，不要生成摘要\n")
                .append("3. 标签(tags)：3-8个关键词标签\n\n");
        if (includeCategory) {
            systemPrompt.append("4. 分类(category)：从下面的预设分类中选择最匹配的一个分类（优先选二级分类）\n\n")
                    .append("预设分类：\n").append(getCategoryDescription()).append("\n")
                    .append("注意：\n")
                    .append("- category 必须是上面预设分类中的 value 值对应的英文单词\n")
                    .append("- 只能选择二级分类\n\n");
        }
        systemPrompt.append("请严格按以下JSON格式返回，不要有任何其他文字：\n");
        if (includeCategory) {
            systemPrompt.append("{\"summary\":\"摘要内容\",\"analysis\":\"分析内容(markdown格式)\",\"tags\":[\"标签1\",\"标签2\",\"标签3\"],\"category\":\"分类value值\"}");
        } else {
            systemPrompt.append("{\"summary\":\"摘要内容\",\"analysis\":\"分析内容(markdown格式)\",\"tags\":[\"标签1\",\"标签2\",\"标签3\"]}");
        }

        try {
            String responseStr = llmProvider.chat(systemPrompt.toString(), content);
            return parseProcessResult(responseStr);
        } catch (Exception e) {
            logger.error("[AI] processClipContent failed: {}", e.getMessage(), e);
            Map<String, Object> fallback = new LinkedHashMap<>();
            fallback.put("summary", "处理失败: " + e.getMessage());
            fallback.put("analysis", "");
            fallback.put("tags", List.of());
            fallback.put("category", "default");
            return fallback;
        }
    }

    public String analyzeContent(String content) {
        try {
            return llmProvider.chat(
                    "你是一个专业的内容分析师，请对以下内容进行分析，提取关键信息。请使用markdown格式输出，不要生成摘要。",
                    content
            );
        } catch (Exception e) {
            return "分析过程中发生错误: " + e.getMessage();
        }
    }

    public String generateSummary(String content) {
        try {
            return llmProvider.chat(
                    "请为以下内容生成一个简短的摘要，不超过100字。",
                    content
            );
        } catch (Exception e) {
            return "摘要生成过程中发生错误: " + e.getMessage();
        }
    }

    public List<String> generateTags(String content) {
        try {
            String tagsString = llmProvider.chat(
                    "请为以下内容提取10个以内的关键词作为标签，每个标签用逗号分隔，不要有其他文字。",
                    content
            );
            return Arrays.stream(tagsString.split("[,，]"))
                    .map(String::trim)
                    .filter(tag -> !tag.isEmpty())
                    .limit(10)
                    .collect(Collectors.toList());
        } catch (Exception e) {
            logger.error("[AI] generateTags failed: {}", e.getMessage(), e);
            return List.of();
        }
    }

    // ==================== 预设分类树 ====================

    public static final List<Map<String, Object>> CATEGORY_TREE = Arrays.asList(
        createCategory("工作项目", "work", Arrays.asList(
            createCategory("公司事务", "work-company"),
            createCategory("个人副业", "work-side")
        )),
        createCategory("学习成长", "study", Arrays.asList(
            createCategory("课程学习", "study-course"),
            createCategory("读书笔记", "study-book")
        )),
        createCategory("生活健康", "life", Arrays.asList(
            createCategory("日常记录", "life-daily"),
            createCategory("健康运动", "life-health")
        )),
        createCategory("兴趣探索", "hobby", Arrays.asList(
            createCategory("技术探索", "hobby-tech"),
            createCategory("创意灵感", "hobby-idea")
        )),
        createCategory("财务规划", "finance", Arrays.asList(
            createCategory("投资理财", "finance-invest"),
            createCategory("消费记录", "finance-spend")
        )),
        createCategory("人脉社交", "social", Arrays.asList(
            createCategory("人脉管理", "social-contact"),
            createCategory("社交活动", "social-event")
        ))
    );

    private static Map<String, Object> createCategory(String label, String value) {
        Map<String, Object> cat = new LinkedHashMap<>();
        cat.put("label", label);
        cat.put("value", value);
        cat.put("children", Collections.emptyList());
        return cat;
    }

    private static Map<String, Object> createCategory(String label, String value, List<Map<String, Object>> children) {
        Map<String, Object> cat = new LinkedHashMap<>();
        cat.put("label", label);
        cat.put("value", value);
        cat.put("children", children);
        return cat;
    }

    private String getCategoryDescription() {
        StringBuilder categoryDesc = new StringBuilder();
        for (Map<String, Object> cat : CATEGORY_TREE) {
            categoryDesc.append("- ").append(cat.get("label")).append("(").append(cat.get("value")).append(")");
            List<Map<String, Object>> children = (List<Map<String, Object>>) cat.get("children");
            if (children != null && !children.isEmpty()) {
                categoryDesc.append(": ");
                categoryDesc.append(children.stream()
                    .map(c -> c.get("label") + "(" + c.get("value") + ")")
                    .collect(Collectors.joining(", ")));
            }
            categoryDesc.append("\n");
        }
        return categoryDesc.toString();
    }

    private boolean isValidCategory(String category) {
        for (Map<String, Object> cat : CATEGORY_TREE) {
            if (cat.get("value").equals(category)) return true;
            List<Map<String, Object>> children = (List<Map<String, Object>>) cat.get("children");
            if (children != null) {
                for (Map<String, Object> child : children) {
                    if (child.get("value").equals(category)) return true;
                }
            }
        }
        return false;
    }

    /**
     * AI 智能整理
     */
    public Map<String, Object> smartOrganize(String content) {
        StringBuilder categoryDesc = new StringBuilder();
        for (Map<String, Object> cat : CATEGORY_TREE) {
            categoryDesc.append("- ").append(cat.get("label")).append("(").append(cat.get("value")).append(")");
            List<Map<String, Object>> children = (List<Map<String, Object>>) cat.get("children");
            if (children != null && !children.isEmpty()) {
                categoryDesc.append(": ");
                categoryDesc.append(children.stream()
                    .map(c -> c.get("label") + "(" + c.get("value") + ")")
                    .collect(Collectors.joining(", ")));
            }
            categoryDesc.append("\n");
        }

        String systemPrompt = "你是一个智能内容分类助手。请分析用户的内容，完成以下任务：\n\n"
                + "1. 从下面的预设分类中选择最匹配的【一个】分类（优先选二级分类，没有合适的选一级）\n"
                + "2. 提取3-8个关键词作为标签\n\n"
                + "预设分类：\n" + categoryDesc + "\n"
                + "请严格按以下JSON格式返回，不要有任何其他文字：\n"
                + "{\"category\":\"分类value值\",\"tags\":[\"标签1\",\"标签2\"]}\n\n"
                + "注意：\n"
                + "- category 必须是上面预设分类中的 value 值\n"
                + "- tags 是关键词数组，3-8个，简洁精准\n"
                + "- 只返回JSON，不要有其他内容";

        try {
            String responseStr = llmProvider.chat(systemPrompt, content);
            responseStr = responseStr.trim();
            if (responseStr.startsWith("```")) {
                responseStr = responseStr.replaceAll("^```json?\\s*", "").replaceAll("\\s*```$", "");
            }
            Map<String, Object> result_map = parseSimpleJson(responseStr);
            String category = (String) result_map.getOrDefault("category", "work");
            List<String> tags = (List<String>) result_map.getOrDefault("tags", List.of());
            if (!isValidCategory(category)) category = "work";
            if (tags.size() > 10) tags = tags.subList(0, 10);
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("category", category);
            result.put("tags", tags);
            return result;
        } catch (Exception e) {
            logger.error("[AI] smartOrganize failed: {}", e.getMessage(), e);
            Map<String, Object> fallback = new LinkedHashMap<>();
            fallback.put("category", "work");
            fallback.put("tags", List.of());
            return fallback;
        }
    }

    public String generateDivergentSummary(String content, String category, List<String> tags) {
        try {
            String rolePrompt = generateRolePrompt(category, tags);
            return llmProvider.chat(rolePrompt,
                    "请基于以下内容进行发散性思考和深度分析，提供多角度的见解和建议：\n" + content);
        } catch (Exception e) {
            return "发散性总结生成过程中发生错误: " + e.getMessage();
        }
    }

    private String generateRolePrompt(String category, List<String> tags) {
        StringBuilder prompt = new StringBuilder();
        if (category != null) {
            if (category.startsWith("work")) prompt.append("你是一位职场专家，擅长分析职业发展和工作效率。");
            else if (category.startsWith("study")) prompt.append("你是一位教育专家，擅长学习方法和知识管理。");
            else if (category.startsWith("life")) prompt.append("你是一位生活顾问，擅长提供生活建议和见解。");
            else if (category.startsWith("hobby")) prompt.append("你是一位创意专家，擅长多领域探索和创新思维。");
            else if (category.startsWith("finance")) prompt.append("你是一位金融专家，擅长投资理财和财务规划。");
            else if (category.startsWith("social")) prompt.append("你是一位社交专家，擅长人际关系和沟通分析。");
            else prompt.append("你是一位综合专家，擅长从多个角度分析问题。");
        } else {
            prompt.append("你是一位综合专家，擅长从多个角度分析问题。");
        }
        if (!tags.isEmpty()) {
            prompt.append(" 请特别关注以下关键词：").append(String.join("、", tags)).append("。");
        }
        prompt.append(" 请提供深入、全面的分析，包括但不限于：问题的本质、可能的影响、潜在的机会、可行的解决方案等。");
        return prompt.toString();
    }

    public String organizeContentForKnowledgeBase(String category, String content) {
        try {
            String systemPrompt = promptConfigService.renderDailyPrompt(category);
            return llmProvider.chat(systemPrompt, content);
        } catch (Exception e) {
            return "内容整理过程中发生错误: " + e.getMessage();
        }
    }

    public List<String> generateSynonyms(String query) {
        try {
            String result = llmProvider.chat(
                    "你是一个搜索助手。用户输入一个搜索关键词，请给出不超过3个与该词语义相关的同义词或近义词。只输出同义词，用逗号分隔，不要输出任何其他内容。如果没有合适的同义词，直接输出原词。",
                    query
            );
            return Arrays.stream(result.split("[,，、\\n]"))
                    .map(String::trim)
                    .filter(s -> !s.isEmpty())
                    .limit(3)
                    .collect(Collectors.toList());
        } catch (Exception e) {
            logger.error("[AI] generateSynonyms failed: {}", e.getMessage(), e);
            return List.of();
        }
    }

    public Map<String, Object> extractKnowledgePoints(String content, String category) {
        Map<String, Object> result = new LinkedHashMap<>();
        try {
            String systemPrompt = promptConfigService.getWeeklyReportPrompt();
            String responseStr = llmProvider.chat(systemPrompt,
                    "分类：" + getCategoryName(category) + "\n\n内容：\n" + content);
            responseStr = responseStr.trim();
            if (responseStr.startsWith("```")) {
                responseStr = responseStr.replaceAll("^```json?\\s*", "").replaceAll("\\s*```$", "");
            }
            responseStr = responseStr.trim();
            String mainReport = extractJsonStringValue(responseStr, "mainReport");
            result.put("mainReport", mainReport != null ? mainReport : content);
            List<Map<String, String>> knowledgePoints = new ArrayList<>();
            int kpIdx = responseStr.indexOf("\"knowledgePoints\"");
            if (kpIdx >= 0) {
                int arrStart = responseStr.indexOf("[", kpIdx);
                int arrEnd = responseStr.lastIndexOf("]");
                if (arrStart >= 0 && arrEnd > arrStart) {
                    String arrStr = responseStr.substring(arrStart + 1, arrEnd);
                    String[] objStrs = arrStr.split("\\},\\s*\\{");
                    for (String objStr : objStrs) {
                        objStr = objStr.trim();
                        if (!objStr.startsWith("{")) objStr = "{" + objStr;
                        if (!objStr.endsWith("}")) objStr = objStr + "}";
                        Map<String, String> kp = new LinkedHashMap<>();
                        kp.put("fileName", extractJsonStringValue(objStr, "fileName"));
                        kp.put("title", extractJsonStringValue(objStr, "title"));
                        kp.put("content", extractJsonStringValue(objStr, "content"));
                        if (kp.get("fileName") != null && kp.get("content") != null) {
                            knowledgePoints.add(kp);
                        }
                    }
                }
            }
            result.put("knowledgePoints", knowledgePoints);
        } catch (Exception e) {
            logger.error("[AI] extractKnowledgePoints failed: {}", e.getMessage(), e);
            result.put("mainReport", content);
            result.put("knowledgePoints", List.of());
        }
        return result;
    }

    // ==================== JSON 解析工具方法 ====================

    private Map<String, Object> parseProcessResult(String json) {
        Map<String, Object> result = new LinkedHashMap<>();
        try {
            json = json.trim();
            if (json.startsWith("```")) {
                json = json.replaceAll("^```json?\\s*", "").replaceAll("\\s*```$", "");
            }
            json = json.trim();
            String summary = extractJsonStringValue(json, "summary");
            result.put("summary", summary != null ? summary : "摘要生成失败");
            String analysis = extractJsonStringValue(json, "analysis");
            result.put("analysis", analysis != null ? analysis : "分析生成失败");
            int tagsIdx = json.indexOf("\"tags\"");
            if (tagsIdx >= 0) {
                int arrStart = json.indexOf("[", tagsIdx);
                int arrEnd = json.indexOf("]", arrStart);
                if (arrStart >= 0 && arrEnd > arrStart) {
                    String arrStr = json.substring(arrStart + 1, arrEnd);
                    List<String> tags = new ArrayList<>();
                    String[] parts = arrStr.split("\"");
                    for (int i = 0; i < parts.length; i++) {
                        String part = parts[i].trim();
                        if (!part.isEmpty() && !part.equals(",") && !part.equals(", ")) {
                            part = part.replaceAll("^,|,$", "").trim();
                            if (!part.isEmpty() && i % 2 == 1) tags.add(part);
                        }
                    }
                    if (tags.size() > 10) tags = tags.subList(0, 10);
                    result.put("tags", tags);
                } else {
                    result.put("tags", List.of());
                }
            } else {
                result.put("tags", List.of());
            }
            String category = extractJsonStringValue(json, "category");
            if (category != null && isValidCategory(category)) {
                result.put("category", category);
            } else {
                result.put("category", "default");
            }
        } catch (Exception e) {
            logger.error("[AI] parseProcessResult failed: {}", e.getMessage(), e);
            result.put("summary", "解析失败");
            result.put("analysis", "");
            result.put("tags", List.of());
            result.put("category", "default");
        }
        return result;
    }

    private String extractJsonStringValue(String json, String key) {
        try {
            int keyIdx = json.indexOf("\"" + key + "\"");
            if (keyIdx < 0) return null;
            int colonIdx = json.indexOf(":", keyIdx);
            if (colonIdx < 0) return null;
            int startQuote = json.indexOf("\"", colonIdx + 1);
            if (startQuote < 0) return null;
            int i = startQuote + 1;
            StringBuilder sb = new StringBuilder();
            while (i < json.length()) {
                char c = json.charAt(i);
                if (c == '\\' && i + 1 < json.length()) {
                    char next = json.charAt(i + 1);
                    sb.append(next == 'n' ? '\n' : next == 't' ? '\t' : next);
                    i += 2;
                    continue;
                }
                if (c == '"') break;
                sb.append(c);
                i++;
            }
            return sb.toString();
        } catch (Exception e) {
            return null;
        }
    }

    private Map<String, Object> parseSimpleJson(String json) {
        Map<String, Object> result = new LinkedHashMap<>();
        try {
            json = json.trim();
            if (!json.startsWith("{")) return result;
            int catIdx = json.indexOf("\"category\"");
            if (catIdx >= 0) {
                int colonIdx = json.indexOf(":", catIdx);
                int startQuote = json.indexOf("\"", colonIdx + 1);
                int endQuote = json.indexOf("\"", startQuote + 1);
                if (startQuote >= 0 && endQuote > startQuote) {
                    result.put("category", json.substring(startQuote + 1, endQuote));
                }
            }
            int tagsIdx = json.indexOf("\"tags\"");
            if (tagsIdx >= 0) {
                int arrStart = json.indexOf("[", tagsIdx);
                int arrEnd = json.indexOf("]", arrStart);
                if (arrStart >= 0 && arrEnd > arrStart) {
                    String arrStr = json.substring(arrStart + 1, arrEnd);
                    List<String> tags = new ArrayList<>();
                    String[] parts = arrStr.split("\"");
                    for (int i = 0; i < parts.length; i++) {
                        String part = parts[i].trim();
                        if (!part.isEmpty() && !part.equals(",") && !part.equals(", ")) {
                            part = part.replaceAll("^,|,$", "").trim();
                            if (!part.isEmpty() && i % 2 == 1) tags.add(part);
                        }
                    }
                    result.put("tags", tags);
                }
            }
        } catch (Exception e) {
            logger.error("[AI] parseSimpleJson failed: {}", e.getMessage(), e);
        }
        return result;
    }

    private String getCategoryName(String category) {
        return category != null ? category : "未分类";
    }
}