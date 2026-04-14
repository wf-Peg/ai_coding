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

@Service
public class AiService {

    private final Generation generation;
    private final DashScopeConfig dashScopeConfig;

    @Autowired
    public AiService(Generation generation, DashScopeConfig dashScopeConfig) {
        this.generation = generation;
        this.dashScopeConfig = dashScopeConfig;
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
                    .content("作为[" + category + "]类目的行业专家，对剪藏的文档进行整理，加工每条剪藏内容中的'AI分析结果'结果，即`analysis`字段，转化为带有逻辑层级的知识库内容。具体操作流程如下：\n" +
                            "1. 内容关联性分析：逐段审查文档内容，判断各段落之间是否存在逻辑关联或主题相关性\n" +
                            "2. 内容整合规则：\n" +
                            "   - 对于存在明确关联性的内容段落，按序号拼接原文，然后ai分析结果融合，整合为新的一条清晰的知识内容\n" +
                            "   - 对于无关联性的内容，保留原始剪藏内容形式\n" +
                            "3. 层级逻辑分类：按照内容主题、重要程度或知识结构建立清晰的层级分类体系\n" +
                            "4. 内容提取规范：仅提取剪藏内容中：${原文content} + ${整理后的analysis}\n" +
                            "5. 总结与思考：完成整个类目的整理后，使用预设角色对整理完的内容进行系统性高浓度高信息密度总结（主要目的：提供反思思路，更好的思考复盘）\n" +
                            "\n" +
                            "注：输出不要带有角色式回答，只输出按上述要求整理的结果。")
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
}
