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

import java.util.Arrays;
import java.util.List;
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
            
            // 解析标签，用逗号分隔
            return Arrays.stream(tagsString.split("[,，]"))
                    .map(String::trim)
                    .filter(tag -> !tag.isEmpty())
                    .limit(10)
                    .collect(Collectors.toList());
        } catch (Exception e) {
            return List.of();
        }
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
        // 基于分类和标签生成专家角色提示词
        StringBuilder prompt = new StringBuilder();
        
        // 根据分类确定专家角色
        switch (category) {
            case "tech":
                prompt.append("你是一位技术专家，擅长分析技术趋势和解决方案。");
                break;
            case "life":
                prompt.append("你是一位生活顾问，擅长提供生活建议和见解。");
                break;
            case "work":
                prompt.append("你是一位职场专家，擅长分析职业发展和工作效率。");
                break;
            case "study":
                prompt.append("你是一位教育专家，擅长学习方法和知识管理。");
                break;
            case "health":
                prompt.append("你是一位健康专家，擅长健康生活方式和保健建议。");
                break;
            case "finance":
                prompt.append("你是一位金融专家，擅长投资理财和财务规划。");
                break;
            case "entertainment":
                prompt.append("你是一位娱乐评论家，擅长分析文化和娱乐内容。");
                break;
            default:
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
                    .content("作为[" + category + "]类目的行业专家，对剪藏的文档进行系统性整理，转化为带有逻辑层级的知识库内容，内容不重叠的地方只保留原文就好了。具体操作流程如下：\n" +
                            "1. 内容关联性分析：逐段审查文档内容，判断各段落之间是否存在逻辑关联或主题相关性\n" +
                            "2. 内容整合规则：\n" +
                            "   - 对于存在明确关联性的内容段落，将其融合整合为清晰的单条知识条目\n" +
                            "   - 对于无关联性的内容，保留原始剪藏内容形式\n" +
                            "3. 层级逻辑分类：按照内容主题、重要程度或知识结构建立清晰的层级分类体系\n" +
                            "4. 内容提取规范：仅提取剪藏内容中：${原文内容} + AI分析结果\n" +
                            "5. 文档存储背景： 使用Obsidian软件进行管理\n" +
                            "6. 总结与思考：完成整理后，使用预设角色对整理完的内容进行系统性高浓度高信息密度总结（主要目的：希望总结内容能够为今日复盘提供关键要点和反思思路）\n" +
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
