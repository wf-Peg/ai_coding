package com.example.clip.core;

import com.example.clip.service.PromptConfigService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.stream.Collectors;

/**
 * AI 服务核心类 —— 应用层与大模型交互的统一入口。
 * <p>
 * 通过 {@link LlmProvider} 抽象层调用大模型，不直接依赖具体的模型厂商。
 * 所有 AI 相关的功能（摘要生成、内容分析、标签生成、分类、智能整理等）
 * 都通过此类向外提供。
 * </p>
 *
 * <h3>核心功能</h3>
 * <ul>
 *   <li><b>碎片内容处理</b>（{@link #processClipContent}）：一键生成摘要、分析、标签和分类</li>
 *   <li><b>内容分析</b>（{@link #analyzeContent}）：对内容进行深度分析</li>
 *   <li><b>摘要生成</b>（{@link #generateSummary}）：生成简短摘要</li>
 *   <li><b>标签生成</b>（{@link #generateTags}）：提取关键词标签</li>
 *   <li><b>智能整理</b>（{@link #smartOrganize}）：AI 驱动的分类和标签</li>
 *   <li><b>发散性总结</b>（{@link #generateDivergentSummary}）：基于分类的多角度分析</li>
 *   <li><b>知识库整理</b>（{@link #organizeContentForKnowledgeBase}）：整理内容用于知识库</li>
 *   <li><b>同义词生成</b>（{@link #generateSynonyms}）：搜索增强用</li>
 *   <li><b>知识点提取</b>（{@link #extractKnowledgePoints}）：周报/知识库用</li>
 * </ul>
 *
 * <h3>错误处理策略</h3>
 * <p>
 * 所有公开方法都捕获了异常，确保 AI 调用失败时不会导致整个请求崩溃。
 * 失败时返回包含错误信息的降级结果（fallback），而非抛出异常。
 * 这种 "优雅降级" 策略保证了用户体验的连续性。
 * </p>
 *
 * <h3>JSON 解析说明</h3>
 * <p>
 * 本类中包含多个手动 JSON 解析方法（如 {@link #parseProcessResult}、
 * {@link #parseSimpleJson}、{@link #extractJsonStringValue}），
 * 这是因为 LLM 返回的 JSON 可能包含格式问题（如 markdown 代码块包裹），
 * 使用标准 JSON 库（如 Jackson）可能会解析失败。
 * 这些手动解析方法对格式更加宽容，能处理 LLM 输出的各种边界情况。
 * </p>
 *
 * <p>
 * <b>【优化建议】</b> 如果未来 LLM 输出的 JSON 格式趋于稳定，
 * 建议将手动 JSON 解析替换为 Jackson ObjectMapper，以提高代码可维护性和健壮性。
 * </p>
 */
@Service
public class AiService {

    private static final Logger logger = LoggerFactory.getLogger(AiService.class);

    /** LLM 提供者（路由实现），支持 DashScope / DeepSeek 热切换 */
    private final LlmProvider llmProvider;

    /** 提示词配置服务，用于获取预设的提示词模板 */
    private final PromptConfigService promptConfigService;

    /**
     * 构造器注入依赖。
     *
     * @param llmProvider          LLM 提供者（由 {@link LlmProviderConfig} 注入的主 Bean）
     * @param promptConfigService  提示词配置服务
     */
    @Autowired
    public AiService(LlmProvider llmProvider, PromptConfigService promptConfigService) {
        this.llmProvider = llmProvider;
        this.promptConfigService = promptConfigService;
    }

    // ==================== 碎片内容处理 ====================

    /**
     * 一键处理碎片内容：生成摘要、分析、标签和分类。
     * <p>
     * 默认包含分类功能（includeCategory=true）。
     * </p>
     *
     * @param content 用户输入的碎片内容
     * @return 包含 summary、analysis、tags、category 的 Map
     */
    public Map<String, Object> processClipContent(String content) {
        return processClipContent(content, true);
    }

    /**
     * 一键处理碎片内容，可选择是否包含分类。
     * <p>
     * 构建系统提示词，要求 LLM 完成以下任务：
     * </p>
     * <ol>
     *   <li>摘要（summary）：不超过 100 字的简短摘要</li>
     *   <li>分析（analysis）：使用 markdown 格式的深度分析</li>
     *   <li>标签（tags）：3-8 个关键词标签</li>
     *   <li>分类（category）：从预设分类树中选择（可选）</li>
     * </ol>
     *
     * <p>
     * 通过单个 API 调用完成所有任务，减少网络开销和延迟。
     * 如果 LLM 调用失败，返回包含错误信息的降级结果。
     * </p>
     *
     * @param content         用户输入的碎片内容
     * @param includeCategory 是否包含分类任务
     * @return 包含处理结果的 Map
     */
    public Map<String, Object> processClipContent(String content, boolean includeCategory) {
        // 构建系统提示词
        StringBuilder systemPrompt = new StringBuilder();
        // 首先添加预设的片段分析提示词（来自 PromptConfigService）
        systemPrompt.append(promptConfigService.getClipAnalyzePrompt()).append("\n\n");
        systemPrompt.append("请对以下内容完成");
        // 根据 includeCategory 决定是"四项任务"还是"三项任务"
        systemPrompt.append(includeCategory ? "四项任务" : "三项任务");
        systemPrompt.append("，严格按JSON格式返回：\n\n")
                .append("1. 摘要(summary)：不超过100字的简短摘要\n")
                .append("2. 分析(analysis)：使用markdown格式，提取关键信息进行深度分析，不要生成摘要\n")
                .append("3. 标签(tags)：3-8个关键词标签\n\n");

        // 如果需要分类，添加分类相关的提示词
        if (includeCategory) {
            systemPrompt.append("4. 分类(category)：从下面的预设分类中选择最匹配的一个分类（优先选二级分类）\n\n")
                    .append("预设分类：\n").append(getCategoryDescription()).append("\n")
                    .append("注意：\n")
                    .append("- category 必须是上面预设分类中的 value 值对应的英文单词\n")
                    .append("- 只能选择二级分类\n\n");
        }

        // 指定期望的 JSON 输出格式
        systemPrompt.append("请严格按以下JSON格式返回，不要有任何其他文字：\n");
        if (includeCategory) {
            systemPrompt.append("{\"summary\":\"摘要内容\",\"analysis\":\"分析内容(markdown格式)\",\"tags\":[\"标签1\",\"标签2\",\"标签3\"],\"category\":\"分类value值\"}");
        } else {
            systemPrompt.append("{\"summary\":\"摘要内容\",\"analysis\":\"分析内容(markdown格式)\",\"tags\":[\"标签1\",\"标签2\",\"标签3\"]}");
        }

        try {
            // 调用 LLM 获取响应
            String responseStr = llmProvider.chat(systemPrompt.toString(), content);
            // 解析 LLM 返回的 JSON 字符串
            return parseProcessResult(responseStr);
        } catch (Exception e) {
            // 记录错误日志
            logger.error("[AI] processClipContent failed: {}", e.getMessage(), e);
            // 返回降级结果，包含错误信息
            Map<String, Object> fallback = new LinkedHashMap<>();
            fallback.put("summary", "处理失败: " + e.getMessage());
            fallback.put("analysis", "");
            fallback.put("tags", List.of());
            fallback.put("category", "default");
            return fallback;
        }
    }

    // ==================== 内容分析 ====================

    /**
     * 对内容进行深度分析。
     * <p>
     * 使用专业内容分析师的提示词，要求 LLM 以 markdown 格式输出分析结果。
     * 如果调用失败，返回包含错误信息的字符串。
     * </p>
     *
     * @param content 需要分析的内容
     * @return markdown 格式的分析结果，或错误信息
     */
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

    /**
     * 生成简短摘要。
     * <p>
     * 要求 LLM 生成不超过 100 字的摘要。
     * 如果调用失败，返回包含错误信息的字符串。
     * </p>
     *
     * @param content 需要生成摘要的内容
     * @return 摘要文本，或错误信息
     */
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

    /**
     * 提取关键词标签。
     * <p>
     * 要求 LLM 提取不超过 10 个关键词作为标签，以逗号分隔。
     * 解析返回的文本字符串，按逗号（中英文）分割，过滤空字符串。
     * 使用 Stream API 进行链式处理：分割 → 去空格 → 过滤空串 → 限制数量 → 收集。
     * </p>
     *
     * @param content 需要提取标签的内容
     * @return 标签列表，最多 10 个，失败时返回空列表
     */
    public List<String> generateTags(String content) {
        try {
            // 调用 LLM 获取标签字符串（逗号分隔）
            String tagsString = llmProvider.chat(
                    "请为以下内容提取10个以内的关键词作为标签，每个标签用逗号分隔，不要有其他文字。",
                    content
            );
            // 流式处理：分割 → 去空白 → 过滤空串 → 限制数量 → 收集为列表
            return Arrays.stream(tagsString.split("[,，]"))  // 支持中英文逗号分隔
                    .map(String::trim)                        // 去除每个标签的首尾空白
                    .filter(tag -> !tag.isEmpty())             // 过滤掉空字符串
                    .limit(10)                                 // 最多取 10 个（安全限制）
                    .collect(Collectors.toList());             // 收集为 List
        } catch (Exception e) {
            logger.error("[AI] generateTags failed: {}", e.getMessage(), e);
            return List.of();  // 失败时返回空列表，不中断业务流程
        }
    }

    // ==================== 预设分类树 ====================

    /**
     * 预设分类树。
     * <p>
     * 定义了两级分类结构：
     * </p>
     * <ul>
     *   <li>一级分类（6 个）：工作项目、学习成长、生活健康、兴趣探索、财务规划、人脉社交</li>
     *   <li>二级分类（12 个）：每个一级分类下有两个二级分类</li>
     * </ul>
     *
     * <p>
     * 每个分类节点包含三个属性：
     * <ul>
     *   <li>label：中文显示名称</li>
     *   <li>value：英文标识符，用于存储和 API 通信</li>
     *   <li>children：子分类列表（一级分类有子分类，二级分类为空列表）</li>
     * </ul>
     * </p>
     *
     * <p>
     * 使用 {@link Arrays#asList} 创建的列表是不可变的（固定大小），
     * 但列表中的元素（Map）仍然是可变的。这个设计是安全的，
     * 因为分类树在运行时不需要修改。
     * </p>
     */
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

    /**
     * 创建叶子分类节点（无子分类）。
     *
     * @param label 中文显示名称
     * @param value 英文标识符
     * @return 包含 label、value 和空 children 的 Map
     */
    private static Map<String, Object> createCategory(String label, String value) {
        Map<String, Object> cat = new LinkedHashMap<>();
        cat.put("label", label);
        cat.put("value", value);
        cat.put("children", Collections.emptyList());  // 叶子节点，子分类为空列表
        return cat;
    }

    /**
     * 创建父分类节点（含子分类）。
     *
     * @param label    中文显示名称
     * @param value    英文标识符
     * @param children 子分类列表
     * @return 包含 label、value 和 children 的 Map
     */
    private static Map<String, Object> createCategory(String label, String value, List<Map<String, Object>> children) {
        Map<String, Object> cat = new LinkedHashMap<>();
        cat.put("label", label);
        cat.put("value", value);
        cat.put("children", children);
        return cat;
    }

    /**
     * 生成分类树的文本描述，用于拼接到 LLM 提示词中。
     * <p>
     * 格式示例：
     * <pre>
     * - 工作项目(work): 公司事务(work-company), 个人副业(work-side)
     * - 学习成长(study): 课程学习(study-course), 读书笔记(study-book)
     * </pre>
     * </p>
     *
     * @return 分类树的文本描述
     */
    private String getCategoryDescription() {
        StringBuilder categoryDesc = new StringBuilder();
        for (Map<String, Object> cat : CATEGORY_TREE) {
            // 一级分类：label(value)
            categoryDesc.append("- ").append(cat.get("label")).append("(").append(cat.get("value")).append(")");
            List<Map<String, Object>> children = (List<Map<String, Object>>) cat.get("children");
            if (children != null && !children.isEmpty()) {
                categoryDesc.append(": ");
                // 使用 Stream 将子分类拼接为 "label(value), label(value)" 格式
                categoryDesc.append(children.stream()
                    .map(c -> c.get("label") + "(" + c.get("value") + ")")
                    .collect(Collectors.joining(", ")));
            }
            categoryDesc.append("\n");
        }
        return categoryDesc.toString();
    }

    /**
     * 验证分类值是否在预设分类树中（包括一级和二级分类）。
     * <p>
     * 遍历整个分类树，检查是否存在 value 匹配的分类节点。
     * 这用于校验 LLM 返回的分类值是否合法，防止 LLM 生成不存在的分类。
     * </p>
     *
     * @param category 待验证的分类 value 值
     * @return true 表示是有效分类，false 表示无效
     */
    private boolean isValidCategory(String category) {
        for (Map<String, Object> cat : CATEGORY_TREE) {
            // 检查一级分类
            if (cat.get("value").equals(category)) return true;
            // 检查二级分类
            List<Map<String, Object>> children = (List<Map<String, Object>>) cat.get("children");
            if (children != null) {
                for (Map<String, Object> child : children) {
                    if (child.get("value").equals(category)) return true;
                }
            }
        }
        return false;
    }

    // ==================== 智能整理 ====================

    /**
     * AI 智能整理：自动分类和标签提取。
     * <p>
     * 与 {@link #processClipContent} 不同，此方法专注于分类和标签两个任务，
     * 不生成摘要和分析。适用于需要快速分类和打标签的场景。
     * </p>
     *
     * <h3>处理流程</h3>
     * <ol>
     *   <li>构建包含分类树的系统提示词</li>
     *   <li>调用 LLM 获取分类和标签</li>
     *   <li>清理 LLM 返回的 markdown 代码块包裹</li>
     *   <li>手动解析 JSON 提取 category 和 tags</li>
     *   <li>验证分类值的合法性，不合法则默认为 "work"</li>
     *   <li>限制标签数量不超过 10 个</li>
     * </ol>
     *
     * @param content 需要整理的内容
     * @return 包含 category 和 tags 的 Map
     */
    public Map<String, Object> smartOrganize(String content) {
        // 构建分类树描述文本（与 getCategoryDescription 逻辑相同，但此处内联实现）
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

        // 构建系统提示词：要求 LLM 完成分类和标签提取
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
            // 调用 LLM 获取分类和标签
            String responseStr = llmProvider.chat(systemPrompt, content);
            // 清理可能的 markdown 代码块包裹（如 ```json ... ```）
            responseStr = responseStr.trim();
            if (responseStr.startsWith("```")) {
                responseStr = responseStr.replaceAll("^```json?\\s*", "").replaceAll("\\s*```$", "");
            }

            // 手动解析 JSON 获取 category 和 tags
            Map<String, Object> result_map = parseSimpleJson(responseStr);
            String category = (String) result_map.getOrDefault("category", "work");
            List<String> tags = (List<String>) result_map.getOrDefault("tags", List.of());

            // 验证分类值合法性，无效则回退到默认值 "work"
            if (!isValidCategory(category)) category = "work";

            // 限制标签数量不超过 10 个（安全限制）
            if (tags.size() > 10) tags = tags.subList(0, 10);

            // 构建最终结果
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("category", category);
            result.put("tags", tags);
            return result;
        } catch (Exception e) {
            // 调用失败时返回默认值
            logger.error("[AI] smartOrganize failed: {}", e.getMessage(), e);
            Map<String, Object> fallback = new LinkedHashMap<>();
            fallback.put("category", "work");
            fallback.put("tags", List.of());
            return fallback;
        }
    }

    // ==================== 发散性总结 ====================

    /**
     * 生成发散性总结。
     * <p>
     * 根据内容分类和标签，选择合适的专家角色提示词，
     * 让 LLM 从该领域的专业角度进行多角度、发散性的深度分析。
     * </p>
     *
     * <h3>角色映射</h3>
     * <ul>
     *   <li>work* → 职场专家</li>
     *   <li>study* → 教育专家</li>
     *   <li>life* → 生活顾问</li>
     *   <li>hobby* → 创意专家</li>
     *   <li>finance* → 金融专家</li>
     *   <li>social* → 社交专家</li>
     * </ul>
     *
     * @param content  需要分析的内容
     * @param category 内容分类（用于选择专家角色）
     * @param tags     关键词标签（用于聚焦分析方向）
     * @return 发散性分析结果，或错误信息
     */
    public String generateDivergentSummary(String content, String category, List<String> tags) {
        try {
            // 根据分类和标签生成角色提示词
            String rolePrompt = generateRolePrompt(category, tags);
            // 调用 LLM 进行发散性分析
            return llmProvider.chat(rolePrompt,
                    "请基于以下内容进行发散性思考和深度分析，提供多角度的见解和建议：\n" + content);
        } catch (Exception e) {
            return "发散性总结生成过程中发生错误: " + e.getMessage();
        }
    }

    /**
     * 根据分类和标签生成角色提示词。
     * <p>
     * 根据 category 前缀匹配专家角色，并在提示词中注入关键词标签，
     * 引导 LLM 从特定领域角度进行有针对性的分析。
     * </p>
     *
     * @param category 分类值（如 "work-company"、"study-course"）
     * @param tags     关键词标签列表
     * @return 角色提示词字符串
     */
    private String generateRolePrompt(String category, List<String> tags) {
        StringBuilder prompt = new StringBuilder();

        // 根据 category 前缀匹配专家角色
        if (category != null) {
            if (category.startsWith("work")) prompt.append("你是一位职场专家，擅长分析职业发展和工作效率。");
            else if (category.startsWith("study")) prompt.append("你是一位教育专家，擅长学习方法和知识管理。");
            else if (category.startsWith("life")) prompt.append("你是一位生活顾问，擅长提供生活建议和见解。");
            else if (category.startsWith("hobby")) prompt.append("你是一位创意专家，擅长多领域探索和创新思维。");
            else if (category.startsWith("finance")) prompt.append("你是一位金融专家，擅长投资理财和财务规划。");
            else if (category.startsWith("social")) prompt.append("你是一位社交专家，擅长人际关系和沟通分析。");
            else prompt.append("你是一位综合专家，擅长从多个角度分析问题。");
        } else {
            // category 为 null 时使用默认角色
            prompt.append("你是一位综合专家，擅长从多个角度分析问题。");
        }

        // 如果有标签，注入到提示词中，引导 LLM 聚焦这些关键词
        if (!tags.isEmpty()) {
            prompt.append(" 请特别关注以下关键词：").append(String.join("、", tags)).append("。");
        }

        // 添加分析要求
        prompt.append(" 请提供深入、全面的分析，包括但不限于：问题的本质、可能的影响、潜在的机会、可行的解决方案等。");
        return prompt.toString();
    }

    // ==================== 知识库整理 ====================

    /**
     * 整理内容用于知识库存储。
     * <p>
     * 使用 {@link PromptConfigService} 提供的每日整理提示词模板，
     * 根据分类对内容进行结构化整理。
     * </p>
     *
     * @param category 内容分类
     * @param content  需要整理的内容
     * @return 整理后的内容，或错误信息
     */
    public String organizeContentForKnowledgeBase(String category, String content) {
        try {
            // 使用提示词服务渲染每日整理提示词（根据分类选择合适的模板）
            String systemPrompt = promptConfigService.renderDailyPrompt(category);
            return llmProvider.chat(systemPrompt, content);
        } catch (Exception e) {
            return "内容整理过程中发生错误: " + e.getMessage();
        }
    }

    // ==================== 搜索增强 ====================

    /**
     * 为搜索关键词生成同义词/近义词。
     * <p>
     * 用于搜索增强：当用户搜索某个关键词时，同时搜索其同义词，
     * 提高搜索命中率。要求 LLM 返回不超过 3 个同义词，用逗号分隔。
     * </p>
     *
     * <p>
     * 返回值处理：按逗号、顿号、换行符分割，去空白，过滤空串，限制最多 3 个。
     * </p>
     *
     * @param query 用户输入的搜索关键词
     * @return 同义词列表，最多 3 个，失败时返回空列表
     */
    public List<String> generateSynonyms(String query) {
        try {
            // 调用 LLM 获取同义词
            String result = llmProvider.chat(
                    "你是一个搜索助手。用户输入一个搜索关键词，请给出不超过3个与该词语义相关的同义词或近义词。只输出同义词，用逗号分隔，不要输出任何其他内容。如果没有合适的同义词，直接输出原词。",
                    query
            );
            // 流式处理：按多种分隔符分割 → 去空白 → 过滤空串 → 限制数量 → 收集
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

    // ==================== 知识点提取 ====================

    /**
     * 从内容中提取知识点，用于周报或知识库。
     * <p>
     * 使用周报提示词模板，要求 LLM 同时对内容进行总结和知识点提取。
     * 返回结构包含：
     * </p>
     * <ul>
     *   <li>mainReport：主报告（总结）</li>
     *   <li>knowledgePoints：知识点列表，每个知识点包含 fileName、title、content</li>
     * </ul>
     *
     * <h3>JSON 解析策略</h3>
     * <p>
     * 由于 LLM 返回的 JSON 可能不规范，此处使用手动字符串解析而非 Jackson。
     * 解析 knowledgePoints 数组时，先定位到数组的起止位置，
     * 然后按 "},{ " 分割每个对象，再逐对象提取字段。
     * </p>
     *
     * <p>
     * <b>【已知问题】</b> knowledgePoints 数组的解析方式比较脆弱，
     * 如果 LLM 返回的 JSON 中包含嵌套对象或数组，可能会解析失败。
     * 建议后续使用 Jackson 进行 JSON 解析。
     * </p>
     *
     * @param content  需要提取知识点的内容
     * @param category 内容分类
     * @return 包含 mainReport 和 knowledgePoints 的 Map
     */
    public Map<String, Object> extractKnowledgePoints(String content, String category) {
        Map<String, Object> result = new LinkedHashMap<>();
        try {
            // 使用周报提示词模板
            String systemPrompt = promptConfigService.getWeeklyReportPrompt();
            // 调用 LLM，传入分类名称和内容
            String responseStr = llmProvider.chat(systemPrompt,
                    "分类：" + getCategoryName(category) + "\n\n内容：\n" + content);

            // 清理可能的 markdown 代码块包裹
            responseStr = responseStr.trim();
            if (responseStr.startsWith("```")) {
                responseStr = responseStr.replaceAll("^```json?\\s*", "").replaceAll("\\s*```$", "");
            }
            responseStr = responseStr.trim();

            // 提取主报告（mainReport 字段）
            String mainReport = extractJsonStringValue(responseStr, "mainReport");
            result.put("mainReport", mainReport != null ? mainReport : content);

            // 提取知识点列表（knowledgePoints 数组）
            List<Map<String, String>> knowledgePoints = new ArrayList<>();
            int kpIdx = responseStr.indexOf("\"knowledgePoints\"");
            if (kpIdx >= 0) {
                // 定位数组的起止位置
                int arrStart = responseStr.indexOf("[", kpIdx);
                int arrEnd = responseStr.lastIndexOf("]");
                if (arrStart >= 0 && arrEnd > arrStart) {
                    // 提取数组内容（去掉首尾的 [ 和 ]）
                    String arrStr = responseStr.substring(arrStart + 1, arrEnd);
                    // 按 "},{ " 分割每个知识点对象
                    String[] objStrs = arrStr.split("\\},\\s*\\{");
                    for (String objStr : objStrs) {
                        objStr = objStr.trim();
                        // 修复可能缺失的大括号（分割后首尾可能丢失）
                        if (!objStr.startsWith("{")) objStr = "{" + objStr;
                        if (!objStr.endsWith("}")) objStr = objStr + "}";
                        // 提取每个知识点对象的字段
                        Map<String, String> kp = new LinkedHashMap<>();
                        kp.put("fileName", extractJsonStringValue(objStr, "fileName"));
                        kp.put("title", extractJsonStringValue(objStr, "title"));
                        kp.put("content", extractJsonStringValue(objStr, "content"));
                        // 只有 fileName 和 content 都存在时才添加（数据完整性校验）
                        if (kp.get("fileName") != null && kp.get("content") != null) {
                            knowledgePoints.add(kp);
                        }
                    }
                }
            }
            result.put("knowledgePoints", knowledgePoints);
        } catch (Exception e) {
            // 失败时返回原始内容作为主报告，知识点为空
            logger.error("[AI] extractKnowledgePoints failed: {}", e.getMessage(), e);
            result.put("mainReport", content);
            result.put("knowledgePoints", List.of());
        }
        return result;
    }

    // ==================== JSON 解析工具方法 ====================

    /**
     * 解析 LLM 返回的 processClipContent 结果 JSON。
     * <p>
     * 从 LLM 返回的 JSON 字符串中提取 summary、analysis、tags、category 四个字段。
     * 使用手动字符串解析以兼容 LLM 可能返回的非标准 JSON 格式。
     * </p>
     *
     * <h3>解析步骤</h3>
     * <ol>
     *   <li>清理 markdown 代码块包裹（```json ... ```）</li>
     *   <li>使用 {@link #extractJsonStringValue} 提取 summary 和 analysis</li>
     *   <li>手动定位 tags 数组，按引号分割提取标签值</li>
     *   <li>使用 {@link #extractJsonStringValue} 提取 category 并验证合法性</li>
     * </ol>
     *
     * <h3>标签解析逻辑</h3>
     * <p>
     * 定位到 "tags" 后的数组 `[...]`，按双引号分割字符串。
     * 由于 JSON 数组中字符串值位于两个引号之间，
     * 在按引号分割后，奇数索引（1, 3, 5, ...）的元素即为标签值。
     * 例如：`["tag1","tag2","tag3"]` 按 `"` 分割后得到：
     * `[`, `tag1`, `,`, `tag2`, `,`, `tag3`, `]`，
     * 索引 1、3、5 即为标签值。
     * </p>
     *
     * <p>
     * <b>【已知问题】</b> 此标签解析逻辑假设标签值不包含引号或逗号。
     * 如果标签值本身包含特殊字符，解析可能会出错。
     * 建议后续使用 Jackson 进行 JSON 解析。
     * </p>
     *
     * @param json LLM 返回的 JSON 字符串
     * @return 包含 summary、analysis、tags、category 的 Map
     */
    private Map<String, Object> parseProcessResult(String json) {
        Map<String, Object> result = new LinkedHashMap<>();
        try {
            // 清理可能的 markdown 代码块包裹
            json = json.trim();
            if (json.startsWith("```")) {
                json = json.replaceAll("^```json?\\s*", "").replaceAll("\\s*```$", "");
            }
            json = json.trim();

            // 提取 summary 字段
            String summary = extractJsonStringValue(json, "summary");
            result.put("summary", summary != null ? summary : "摘要生成失败");

            // 提取 analysis 字段
            String analysis = extractJsonStringValue(json, "analysis");
            result.put("analysis", analysis != null ? analysis : "分析生成失败");

            // 手动提取 tags 数组
            int tagsIdx = json.indexOf("\"tags\"");
            if (tagsIdx >= 0) {
                // 定位数组的起始位置 [ 和结束位置 ]
                int arrStart = json.indexOf("[", tagsIdx);
                int arrEnd = json.indexOf("]", arrStart);
                if (arrStart >= 0 && arrEnd > arrStart) {
                    // 提取数组内容（去掉首尾的 [ 和 ]）
                    String arrStr = json.substring(arrStart + 1, arrEnd);

                    // 按双引号分割，提取标签值
                    // 在 JSON 数组 ["a","b","c"] 中，按 " 分割后，
                    // 索引 1, 3, 5... 即为标签值
                    List<String> tags = new ArrayList<>();
                    String[] parts = arrStr.split("\"");
                    for (int i = 0; i < parts.length; i++) {
                        String part = parts[i].trim();
                        // 跳过空字符串和纯逗号分隔符
                        if (!part.isEmpty() && !part.equals(",") && !part.equals(", ")) {
                            // 清理可能残留的前后逗号
                            part = part.replaceAll("^,|,$", "").trim();
                            // 只取奇数索引位置的值（即引号内的字符串）
                            if (!part.isEmpty() && i % 2 == 1) tags.add(part);
                        }
                    }
                    // 限制标签数量
                    if (tags.size() > 10) tags = tags.subList(0, 10);
                    result.put("tags", tags);
                } else {
                    result.put("tags", List.of());
                }
            } else {
                result.put("tags", List.of());
            }

            // 提取 category 字段并验证
            String category = extractJsonStringValue(json, "category");
            if (category != null && isValidCategory(category)) {
                result.put("category", category);
            } else {
                // 无效分类或未提取到，使用默认值
                result.put("category", "default");
            }
        } catch (Exception e) {
            // 解析完全失败时返回降级结果
            logger.error("[AI] parseProcessResult failed: {}", e.getMessage(), e);
            result.put("summary", "解析失败");
            result.put("analysis", "");
            result.put("tags", List.of());
            result.put("category", "default");
        }
        return result;
    }

    /**
     * 从 JSON 字符串中提取指定 key 的字符串值。
     * <p>
     * 使用手动字符遍历方式提取，而非正则表达式或 JSON 库，
     * 以兼容 LLM 可能返回的非标准 JSON 格式。
     * </p>
     *
     * <h3>解析流程</h3>
     * <ol>
     *   <li>定位 key 的位置：查找 "key" 字符串</li>
     *   <li>定位冒号 : 的位置</li>
     *   <li>定位值的起始引号 "</li>
     *   <li>逐字符遍历，处理转义字符（\n、\t 等），直到遇到闭合引号</li>
     *   <li>返回提取的字符串值</li>
     * </ol>
     *
     * <h3>转义字符处理</h3>
     * <p>
     * 当前仅处理 `\n`（换行）和 `\t`（制表符），
     * 其他转义序列按原字符输出（如 `\"` 输出 `"`，`\\` 输出 `\`）。
     * </p>
     *
     * <p>
     * <b>【已知限制】</b> 不支持 Unicode 转义（如 \\uXXXX），
     * 如果 LLM 返回的 JSON 中包含 Unicode 转义序列，解析会不正确。
     * </p>
     *
     * @param json JSON 字符串
     * @param key  要提取的字段名
     * @return 提取到的字符串值，如果未找到或解析失败返回 null
     */
    private String extractJsonStringValue(String json, String key) {
        try {
            // 定位 key 的位置
            int keyIdx = json.indexOf("\"" + key + "\"");
            if (keyIdx < 0) return null;

            // 定位冒号位置
            int colonIdx = json.indexOf(":", keyIdx);
            if (colonIdx < 0) return null;

            // 定位值的起始引号
            int startQuote = json.indexOf("\"", colonIdx + 1);
            if (startQuote < 0) return null;

            // 逐字符遍历，处理转义
            int i = startQuote + 1;  // 跳过起始引号
            StringBuilder sb = new StringBuilder();
            while (i < json.length()) {
                char c = json.charAt(i);
                // 处理转义字符
                if (c == '\\' && i + 1 < json.length()) {
                    char next = json.charAt(i + 1);
                    // 常见转义：\n → 换行，\t → 制表符，其他 → 原字符
                    sb.append(next == 'n' ? '\n' : next == 't' ? '\t' : next);
                    i += 2;  // 跳过转义序列的两个字符
                    continue;
                }
                // 遇到闭合引号，结束提取
                if (c == '"') break;
                sb.append(c);
                i++;
            }
            return sb.toString();
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * 简化版 JSON 解析：仅提取 category 和 tags 字段。
     * <p>
     * 用于 {@link #smartOrganize} 方法，只需要解析这两个字段。
     * 解析逻辑与 {@link #parseProcessResult} 中的标签解析类似，
     * 但更轻量，不处理 summary 和 analysis。
     * </p>
     *
     * @param json LLM 返回的 JSON 字符串
     * @return 包含 category 和 tags 的 Map
     */
    private Map<String, Object> parseSimpleJson(String json) {
        Map<String, Object> result = new LinkedHashMap<>();
        try {
            json = json.trim();
            // 如果不是以 { 开头，说明不是有效的 JSON 对象
            if (!json.startsWith("{")) return result;

            // 提取 category 字段
            int catIdx = json.indexOf("\"category\"");
            if (catIdx >= 0) {
                int colonIdx = json.indexOf(":", catIdx);
                int startQuote = json.indexOf("\"", colonIdx + 1);
                int endQuote = json.indexOf("\"", startQuote + 1);
                if (startQuote >= 0 && endQuote > startQuote) {
                    // 提取两个引号之间的字符串值
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
                    String[] parts = arrStr.split("\"");
                    // 与 parseProcessResult 相同的标签提取逻辑：取奇数索引
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

    /**
     * 获取分类的中文显示名称。
     * <p>
     * 当前实现直接返回 category 原始值（通常为英文），
     * 如果需要转换为中文，可以扩展此方法遍历分类树查找对应的 label。
     * </p>
     *
     * @param category 分类值（如 "work-company"）
     * @return 分类名称，如果 category 为 null 则返回 "未分类"
     */
    private String getCategoryName(String category) {
        return category != null ? category : "未分类";
    }
}