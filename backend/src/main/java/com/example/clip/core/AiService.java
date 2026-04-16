package com.example.clip.core;

import com.alibaba.dashscope.aigc.generation.Generation;
import com.alibaba.dashscope.aigc.generation.GenerationParam;
import com.alibaba.dashscope.aigc.generation.GenerationResult;
import com.alibaba.dashscope.common.Message;
import com.alibaba.dashscope.common.Role;
import com.alibaba.dashscope.exception.InputRequiredException;
import com.alibaba.dashscope.exception.NoApiKeyException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.stream.Collectors;

/**
 * AI服务类
 * 提供AI相关功能，包括内容分析、标签生成、智能整理等
 */
@Service
public class AiService {

    private final Generation generation;
    private final DashScopeConfig dashScopeConfig;

    @Autowired
    public AiService(Generation generation, DashScopeConfig dashScopeConfig) {
        this.generation = generation;
        this.dashScopeConfig = dashScopeConfig;
    }

    /**
     * One-shot processing: generate summary, analysis, and tags in a single API call.
     * Returns a map with keys: summary, analysis, tags
     */
    public Map<String, Object> processClipContent(String content) {
        String systemPrompt = "你是一个专业的内容分析助手。请对以下内容完成三项任务，严格按JSON格式返回：\n\n"
                + "1. 摘要(summary)：不超过100字的简短摘要\n"
                + "2. 分析(analysis)：使用markdown格式，提取关键信息进行深度分析，不要生成摘要\n"
                + "3. 标签(tags)：3-8个关键词标签\n\n"
                + "请严格按以下JSON格式返回，不要有任何其他文字：\n"
                + "{\"summary\":\"摘要内容\",\"analysis\":\"分析内容(markdown格式)\",\"tags\":[\"标签1\",\"标签2\",\"标签3\"]}";

        try {
            Message systemMessage = Message.builder()
                    .role(Role.SYSTEM.getValue())
                    .content(systemPrompt)
                    .build();

            Message userMessage = Message.builder()
                    .role(Role.USER.getValue())
                    .content(content)
                    .build();

            GenerationParam param = GenerationParam.builder()
                    .apiKey(dashScopeConfig.getApiKey())
                    .model(dashScopeConfig.getModel())
                    .messages(Arrays.asList(systemMessage, userMessage))
                    .resultFormat(GenerationParam.ResultFormat.MESSAGE)
                    .build();

            GenerationResult result = generation.call(param);
            String responseStr = result.getOutput().getChoices().get(0).getMessage().getContent();

            return parseProcessResult(responseStr);
        } catch (Exception e) {
            System.err.println("[AI] processClipContent failed: " + e.getMessage());
            e.printStackTrace();
            Map<String, Object> fallback = new LinkedHashMap<>();
            fallback.put("summary", "处理失败: " + e.getMessage());
            fallback.put("analysis", "");
            fallback.put("tags", List.of());
            return fallback;
        }
    }

    /**
     * Parse the JSON response from processClipContent
     */
    private Map<String, Object> parseProcessResult(String json) {
        Map<String, Object> result = new LinkedHashMap<>();
        try {
            json = json.trim();
            if (json.startsWith("```")) {
                json = json.replaceAll("^```json?\\s*", "").replaceAll("\\s*```$", "");
            }
            json = json.trim();

            // Extract summary
            String summary = extractJsonStringValue(json, "summary");
            result.put("summary", summary != null ? summary : "摘要生成失败");

            // Extract analysis
            String analysis = extractJsonStringValue(json, "analysis");
            result.put("analysis", analysis != null ? analysis : "分析生成失败");

            // Extract tags
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
                            if (!part.isEmpty() && i % 2 == 1) {
                                tags.add(part);
                            }
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
        } catch (Exception e) {
            System.err.println("[AI] parseProcessResult failed: " + e.getMessage());
            result.put("summary", "解析失败");
            result.put("analysis", "");
            result.put("tags", List.of());
        }
        return result;
    }

    /**
     * Extract a string value from a JSON key, handling nested quotes and escaped characters
     */
    private String extractJsonStringValue(String json, String key) {
        try {
            int keyIdx = json.indexOf("\"" + key + "\"");
            if (keyIdx < 0) return null;
            int colonIdx = json.indexOf(":", keyIdx);
            if (colonIdx < 0) return null;
            int startQuote = json.indexOf("\"", colonIdx + 1);
            if (startQuote < 0) return null;
            // Find the closing quote (handle escaped quotes)
            int i = startQuote + 1;
            StringBuilder sb = new StringBuilder();
            while (i < json.length()) {
                char c = json.charAt(i);
                if (c == '\\' && i + 1 < json.length()) {
                    char next = json.charAt(i + 1);
                    if (next == '"' || next == 'n' || next == 't' || next == '\\') {
                        sb.append(next == 'n' ? '\n' : next == 't' ? '\t' : next);
                        i += 2;
                        continue;
                    }
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

    public String analyzeContent(String content) {
        try {
            Message systemMessage = Message.builder()
                    .role(Role.SYSTEM.getValue())
                    .content("你是一个专业的内容分析师，请对以下内容进行分析，提取关键信息。请使用markdown格式输出，不要生成摘要。")
                    .build();

            Message userMessage = Message.builder()
                    .role(Role.USER.getValue())
                    .content(content)
                    .build();

            GenerationParam param = GenerationParam.builder()
                    .apiKey(dashScopeConfig.getApiKey())
                    .model(dashScopeConfig.getModel())
                    .messages(Arrays.asList(systemMessage, userMessage))
                    .resultFormat(GenerationParam.ResultFormat.MESSAGE)
                    .build();

            GenerationResult result = generation.call(param);
            return result.getOutput().getChoices().get(0).getMessage().getContent();
        } catch (NoApiKeyException | InputRequiredException e) {
            return "分析失败: " + e.getMessage();
        } catch (Exception e) {
            return "分析过程中发生错误: " + e.getMessage();
        }
    }

    public String generateSummary(String content) {
        try {
            Message systemMessage = Message.builder()
                    .role(Role.SYSTEM.getValue())
                    .content("请为以下内容生成一个简短的摘要，不超过100字。")
                    .build();

            Message userMessage = Message.builder()
                    .role(Role.USER.getValue())
                    .content(content)
                    .build();

            GenerationParam param = GenerationParam.builder()
                    .apiKey(dashScopeConfig.getApiKey())
                    .model(dashScopeConfig.getModel())
                    .messages(Arrays.asList(systemMessage, userMessage))
                    .resultFormat(GenerationParam.ResultFormat.MESSAGE)
                    .build();

            GenerationResult result = generation.call(param);
            return result.getOutput().getChoices().get(0).getMessage().getContent();
        } catch (NoApiKeyException | InputRequiredException e) {
            return "摘要生成失败: " + e.getMessage();
        } catch (Exception e) {
            return "摘要生成过程中发生错误: " + e.getMessage();
        }
    }

    public List<String> generateTags(String content) {
        try {
            Message systemMessage = Message.builder()
                    .role(Role.SYSTEM.getValue())
                    .content("请为以下内容提取10个以内的关键词作为标签，每个标签用逗号分隔，不要有其他文字。")
                    .build();

            Message userMessage = Message.builder()
                    .role(Role.USER.getValue())
                    .content(content)
                    .build();

            GenerationParam param = GenerationParam.builder()
                    .apiKey(dashScopeConfig.getApiKey())
                    .model(dashScopeConfig.getModel())
                    .messages(Arrays.asList(systemMessage, userMessage))
                    .resultFormat(GenerationParam.ResultFormat.MESSAGE)
                    .build();

            GenerationResult result = generation.call(param);
            String tagsString = result.getOutput().getChoices().get(0).getMessage().getContent();

            return Arrays.stream(tagsString.split("[,，]"))
                    .map(String::trim)
                    .filter(tag -> !tag.isEmpty())
                    .limit(10)
                    .collect(Collectors.toList());
        } catch (Exception e) {
            System.err.println("[AI] generateTags failed: " + e.getMessage());
            e.printStackTrace();
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

    /**
     * AI 智能整理：分析内容，返回分类和标签
     */
    public Map<String, Object> smartOrganize(String content) {
        // 构建分类选项描述
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
                + "预设分类：\n" + categoryDesc.toString() + "\n"
                + "请严格按以下JSON格式返回，不要有任何其他文字：\n"
                + "{\"category\":\"分类value值\",\"tags\":[\"标签1\",\"标签2\"]}\n\n"
                + "注意：\n"
                + "- category 必须是上面预设分类中的 value 值\n"
                + "- tags 是关键词数组，3-8个，简洁精准\n"
                + "- 只返回JSON，不要有其他内容";

        try {
            Message systemMessage = Message.builder()
                    .role(Role.SYSTEM.getValue())
                    .content(systemPrompt)
                    .build();

            Message userMessage = Message.builder()
                    .role(Role.USER.getValue())
                    .content(content)
                    .build();

            GenerationParam param = GenerationParam.builder()
                    .apiKey(dashScopeConfig.getApiKey())
                    .model(dashScopeConfig.getModel())
                    .messages(Arrays.asList(systemMessage, userMessage))
                    .resultFormat(GenerationParam.ResultFormat.MESSAGE)
                    .build();

            GenerationResult result = generation.call(param);
            String responseStr = result.getOutput().getChoices().get(0).getMessage().getContent();

            // 解析 JSON 响应
            responseStr = responseStr.trim();
            // 去除可能的 markdown 代码块包裹
            if (responseStr.startsWith("```")) {
                responseStr = responseStr.replaceAll("^```json?\\s*", "").replaceAll("\\s*```$", "");
            }

            // 简单 JSON 解析（避免引入额外依赖）
            Map<String, Object> result_map = parseSimpleJson(responseStr);

            String category = (String) result_map.getOrDefault("category", "work");
            List<String> tags = (List<String>) result_map.getOrDefault("tags", List.of());

            // 验证 category 是否在预设列表中
            boolean validCategory = isValidCategory(category);
            if (!validCategory) {
                category = "work"; // 默认归到工作项目
            }

            // 确保 tags 不超过 10 个
            if (tags.size() > 10) {
                tags = tags.subList(0, 10);
            }

            Map<String, Object> resultMap = new LinkedHashMap<>();
            resultMap.put("category", category);
            resultMap.put("tags", tags);
            return resultMap;

        } catch (Exception e) {
            e.printStackTrace();
            // 失败时返回默认值
            Map<String, Object> fallback = new LinkedHashMap<>();
            fallback.put("category", "work");
            fallback.put("tags", List.of());
            return fallback;
        }
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

    private Map<String, Object> parseSimpleJson(String json) {
        Map<String, Object> result = new LinkedHashMap<>();
        try {
            // 使用简单的字符串解析
            json = json.trim();
            if (!json.startsWith("{")) return result;

            // 提取 category
            int catIdx = json.indexOf("\"category\"");
            if (catIdx >= 0) {
                int colonIdx = json.indexOf(":", catIdx);
                int startQuote = json.indexOf("\"", colonIdx + 1);
                int endQuote = json.indexOf("\"", startQuote + 1);
                if (startQuote >= 0 && endQuote > startQuote) {
                    result.put("category", json.substring(startQuote + 1, endQuote));
                }
            }

            // 提取 tags 数组
            int tagsIdx = json.indexOf("\"tags\"");
            if (tagsIdx >= 0) {
                int arrStart = json.indexOf("[", tagsIdx);
                int arrEnd = json.indexOf("]", arrStart);
                if (arrStart >= 0 && arrEnd > arrStart) {
                    String arrStr = json.substring(arrStart + 1, arrEnd);
                    List<String> tags = new ArrayList<>();
                    // 按引号分割提取标签
                    String[] parts = arrStr.split("\"");
                    for (int i = 0; i < parts.length; i++) {
                        String part = parts[i].trim();
                        if (!part.isEmpty() && !part.equals(",") && !part.equals(", ")) {
                            // 清理逗号
                            part = part.replaceAll("^,|,$", "").trim();
                            if (!part.isEmpty() && i % 2 == 1) {
                                tags.add(part);
                            }
                        }
                    }
                    result.put("tags", tags);
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
        return result;
    }

    public String generateDivergentSummary(String content, String category, List<String> tags) {
        try {
            // 第一级prompt：匹配对应角色的专家级提示词
            String rolePrompt = generateRolePrompt(category, tags);
            
            // 第二级prompt：拼接专家级提示词和原文
            Message systemMessage = Message.builder()
                    .role(Role.SYSTEM.getValue())
                    .content(rolePrompt)
                    .build();

            Message userMessage = Message.builder()
                    .role(Role.USER.getValue())
                    .content("请基于以下内容进行发散性思考和深度分析，提供多角度的见解和建议：\n" + content)
                    .build();

            GenerationParam param = GenerationParam.builder()
                    .apiKey(dashScopeConfig.getApiKey())
                    .model(dashScopeConfig.getModel())
                    .messages(Arrays.asList(systemMessage, userMessage))
                    .resultFormat(GenerationParam.ResultFormat.MESSAGE)
                    .build();

            GenerationResult result = generation.call(param);
            return result.getOutput().getChoices().get(0).getMessage().getContent();
        } catch (NoApiKeyException | InputRequiredException e) {
            return "发散性总结生成失败: " + e.getMessage();
        } catch (Exception e) {
            return "发散性总结生成过程中发生错误: " + e.getMessage();
        }
    }

    private String generateRolePrompt(String category, List<String> tags) {
        StringBuilder prompt = new StringBuilder();

        // 根据分类前缀确定专家角色
        if (category != null) {
            if (category.startsWith("work")) {
                prompt.append("你是一位职场专家，擅长分析职业发展和工作效率。");
            } else if (category.startsWith("study")) {
                prompt.append("你是一位教育专家，擅长学习方法和知识管理。");
            } else if (category.startsWith("life")) {
                prompt.append("你是一位生活顾问，擅长提供生活建议和见解。");
            } else if (category.startsWith("hobby")) {
                prompt.append("你是一位创意专家，擅长多领域探索和创新思维。");
            } else if (category.startsWith("finance")) {
                prompt.append("你是一位金融专家，擅长投资理财和财务规划。");
            } else if (category.startsWith("social")) {
                prompt.append("你是一位社交专家，擅长人际关系和沟通分析。");
            } else {
                prompt.append("你是一位综合专家，擅长从多个角度分析问题。");
            }
        } else {
            prompt.append("你是一位综合专家，擅长从多个角度分析问题。");
        }
        
        // 结合标签进一步细化角色
        if (!tags.isEmpty()) {
            prompt.append(" 请特别关注以下关键词：").append(String.join("、", tags)).append("。");
        }
        
        prompt.append(" 请提供深入、全面的分析，包括但不限于：问题的本质、可能的影响、潜在的机会、可行的解决方案等。");
        
        return prompt.toString();
    }

    public String organizeContentForKnowledgeBase(String category, String content) {
        try {
            Message systemMessage = Message.builder()
                    .role(Role.SYSTEM.getValue())
                    .content("# Role\n" +
                            "你是一位拥有20年经验的**{{" + category + "}}**行业专家及知识管理顾问。你擅长从碎片化的文档中提取核心逻辑，构建高信噪比的知识库，并能结合专业视角进行深度复盘。\n" +
                            "\n" +
                            "# Goal\n" +
                            "接收用户提供的原始文档列表（包含原文、摘要、AI分析、标签等）以及指定的专家角色，按照“关联性整合”与“层级化分类”的原则，输出一份结构严谨、逻辑清晰的【行业知识库日报】。\n" +
                            "\n" +
                            "# Workflow\n" +
                            "1.  **关联性分析**：\n" +
                            "    - 逐条审查输入内容，识别主题重叠、逻辑互补或观点冲突的段落。\n" +
                            "    - 将内容划分为“关联组”（需合并）和“独立项”（需保留原貌）。\n" +
                            "\n" +
                            "2.  **内容整合与重构**：\n" +
                            "    - **关联组处理**：\n" +
                            "        - 标题：提炼一个涵盖所有相关内容的标题。\n" +
                            "        - 原文：将所有相关原文按序号放入独立的代码块中（```text ... ```），保持原始风貌。\n" +
                            "        - 分析：对原有的AI分析进行“融合重写”，去除重复信息，梳理逻辑层级，形成一条高密度的综合分析。\n" +
                            "        - 标签：合并所有相关标签。\n" +
                            "    - **独立项处理**：\n" +
                            "        - 标题：使用原文的总结摘要。\n" +
                            "        - 原文：放入代码块中。\n" +
                            "        - 分析：保留原始AI分析结果，仅做格式微调。\n" +
                            "\n" +
                            "3.  **全局复盘**：\n" +
                            "    - 站在行业专家的视角，对上述整理的所有内容进行跨学科、跨领域的系统性总结。\n" +
                            "    - 寻找不同知识点之间的隐性联系（如：心理学与博弈论、宏观与微观，或该专业领域的特定关联）。\n" +
                            "    - 输出高浓度的“今日复盘”，作为标题展示。\n" +
                            "\n" +
                            "# Output Format Rules\n" +
                            "- **严格禁止**使用角色扮演式的开场白（如“好的，我是专家...”），直接输出日报内容。\n" +
                            "- **标题层级规范**：\n" +
                            "    - **一级标题**：`# {日期}日报` （全文仅一个）\n" +
                            "    - **二级标题**：`{内容板块标题}` 或 `今日复盘`\n" +
                            "    - **三级标题**：`原文` 、 `分析`\n" +
                            "- **原文展示**：必须使用 `text` 代码块包裹原文，禁止直接以引用或段落形式展示。\n" +
                            "- **分析展示**：使用 Markdown 列表和加粗，确保可读性。\n" +
                            "- **元数据**：在二级标题下方使用引用格式展示分类与标签 `> 分类/标签：...`。\n" +
                            "- **Markdown格式清洗**：确保所有标题符号（#）前后没有多余的空格或重复符号，确保标题层级清晰，没有重叠或混乱。\n" +
                            "\n" +
                            "# Constraints\n" +
                            "- 保持客观、理性的语调。\n" +
                            "- 确保“分析”部分具有高信息密度，拒绝废话。\n" +
                            "- 清洗格式错误（如多余的冒号、错误的换行、标题符号重叠）。")
                    .build();

            Message userMessage = Message.builder()
                    .role(Role.USER.getValue())
                    .content(content)
                    .build();

            GenerationParam param = GenerationParam.builder()
                    .apiKey(dashScopeConfig.getApiKey())
                    .model(dashScopeConfig.getModel())
                    .messages(Arrays.asList(systemMessage, userMessage))
                    .resultFormat(GenerationParam.ResultFormat.MESSAGE)
                    .build();

            GenerationResult result = generation.call(param);
            return result.getOutput().getChoices().get(0).getMessage().getContent();
        } catch (NoApiKeyException | InputRequiredException e) {
            return "内容整理失败: " + e.getMessage();
        } catch (Exception e) {
            return "内容整理过程中发生错误: " + e.getMessage();
        }
    }

    /**
     * 生成搜索同义词
     * @param query 搜索关键词
     * @return 不超过3个同义词列表
     */
    public List<String> generateSynonyms(String query) {
        try {
            Message systemMessage = Message.builder()
                    .role(Role.SYSTEM.getValue())
                    .content("你是一个搜索助手。用户输入一个搜索关键词，请给出不超过3个与该词语义相关的同义词或近义词。只输出同义词，用逗号分隔，不要输出任何其他内容。如果没有合适的同义词，直接输出原词。")
                    .build();

            Message userMessage = Message.builder()
                    .role(Role.USER.getValue())
                    .content(query)
                    .build();

            GenerationParam param = GenerationParam.builder()
                    .apiKey(dashScopeConfig.getApiKey())
                    .model(dashScopeConfig.getModel())
                    .messages(Arrays.asList(systemMessage, userMessage))
                    .resultFormat(GenerationParam.ResultFormat.MESSAGE)
                    .build();

            GenerationResult result = generation.call(param);
            String content = result.getOutput().getChoices().get(0).getMessage().getContent();

            // 解析返回的同义词，按逗号分隔
            return Arrays.stream(content.split("[,，、\\n]"))
                    .map(String::trim)
                    .filter(s -> !s.isEmpty())
                    .limit(3)
                    .collect(java.util.stream.Collectors.toList());
        } catch (Exception e) {
            System.err.println("[AI] generateSynonyms failed: " + e.getMessage());
            return List.of();
        }
    }
}
