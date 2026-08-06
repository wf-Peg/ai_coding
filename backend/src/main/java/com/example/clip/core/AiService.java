package com.example.clip.core;

import com.example.clip.dto.ClipAnalysisResult;
import com.example.clip.dto.KnowledgeExtractionResult;
import com.example.clip.dto.WikiExtractionResult;
import com.example.clip.service.PromptConfigService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
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
    /**
     * 一键处理碎片内容（带用户思考）。
     * <p>
     * 当用户为剪藏附加了「我的思考」（myThoughts）时使用此方法。
     * 在标准分析流程基础上，追加"认知对话模式"指令，
     * 要求 AI 将用户思考与原文进行对照分析，输出融合了用户视角的结果。
     * </p>
     *
     * <h3>与标准流程的区别</h3>
     * <ul>
     *   <li>系统提示词中追加认知对话模式指令（思考-内容对照、标签融合、摘要视角）</li>
     *   <li>用户消息中包含「💭 我的思考」标记，将思考作为额外上下文传递给 AI</li>
     * </ul>
     *
     * @param content         用户输入的碎片内容
     * @param includeCategory 是否包含分类任务
     * @param myThoughts      用户自己的思考，非空字符串时触发认知对话模式
     * @return 包含处理结果的 Map
     */
    public Map<String, Object> processClipContent(String content, boolean includeCategory, String myThoughts) {
        // 1. 角色 Prompt（来自 PromptConfigService，用户可自定义）
        StringBuilder systemPrompt = new StringBuilder();
        systemPrompt.append(promptConfigService.getClipAnalyzePrompt()).append("\n\n");

        // 2. 任务格式 Prompt（来自 PromptConfigService，支持 {{category_tree}} 占位符）
        String categoryTreeText = includeCategory ? getCategoryDescription() : "";
        String taskFormat = promptConfigService.getRenderedClipAnalyzeTaskFormat(categoryTreeText);
        taskFormat = taskFormat.replace("{task_count}", includeCategory ? "四项" : "三项");
        systemPrompt.append(taskFormat);

        // 3. 如果有用户思考，追加认知对话模式指令
        if (myThoughts != null && !myThoughts.trim().isEmpty()) {
            systemPrompt.append(promptConfigService.getClipAnalyzeDialoguePrompt());
        }

        // 4. 构建用户消息：如果有思考，将思考附加到内容之后
        String userMessage = content;
        if (myThoughts != null && !myThoughts.trim().isEmpty()) {
            userMessage = content + "\n\n---\n💭 我的思考：\n" + myThoughts.trim();
        }

        try {
            String responseStr = llmProvider.chat(systemPrompt.toString(), userMessage);
            return parseProcessResult(responseStr);
        } catch (Exception e) {
            logger.error("[AI] processClipContent with thoughts failed: {}", e.getMessage(), e);
            Map<String, Object> fallback = new LinkedHashMap<>();
            fallback.put("summary", "处理失败: " + e.getMessage());
            fallback.put("analysis", "");
            fallback.put("tags", List.of());
            fallback.put("category", "default");
            return fallback;
        }
    }

    public Map<String, Object> processClipContent(String content, boolean includeCategory) {
        // 1. 角色 Prompt（来自 PromptConfigService，用户可自定义）
        StringBuilder systemPrompt = new StringBuilder();
        systemPrompt.append(promptConfigService.getClipAnalyzePrompt()).append("\n\n");

        // 2. 任务格式 Prompt（来自 PromptConfigService，支持 {{category_tree}} 占位符）
        String categoryTreeText = includeCategory ? getCategoryDescription() : "";
        String taskFormat = promptConfigService.getRenderedClipAnalyzeTaskFormat(categoryTreeText);
        // 替换 {task_count} 占位符为实际任务数
        taskFormat = taskFormat.replace("{task_count}", includeCategory ? "四项" : "三项");
        systemPrompt.append(taskFormat);

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
            return llmProvider.chat(promptConfigService.getAnalyzeContentPrompt(), content);
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
            return llmProvider.chat(promptConfigService.getGenerateSummaryPrompt(), content);
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
            String tagsString = llmProvider.chat(promptConfigService.getGenerateTagsPrompt(), content);
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
        // 构建分类树文本
        String categoryTreeText = getCategoryDescription();

        // 从 PromptConfigService 获取模板并渲染
        String systemPrompt = promptConfigService.getSmartOrganizePrompt()
                .replace("{{category_tree}}", categoryTreeText);

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

        // 从 PromptConfigService 加载角色映射，替换硬编码的 if-else
        try {
            String roleMapJson = promptConfigService.getDivergentSummaryRoleMap();
            ObjectMapper mapper = new ObjectMapper();
            Map<String, String> roleMap = mapper.readValue(roleMapJson, new TypeReference<Map<String, String>>() {});

            String roleDesc = null;
            if (category != null) {
                // 按前缀匹配，先精确匹配再前缀匹配
                roleDesc = roleMap.get(category);
                if (roleDesc == null) {
                    // 子串匹配（如 "work-company" 匹配 "work"）
                    for (Map.Entry<String, String> entry : roleMap.entrySet()) {
                        if (category.startsWith(entry.getKey())) {
                            roleDesc = entry.getValue();
                            break;
                        }
                    }
                }
            }
            prompt.append(roleDesc != null ? roleDesc : "你是一位综合专家，擅长从多个角度分析问题。");
        } catch (Exception e) {
            // 角色映射解析失败时使用默认角色
            logger.error("[AI] generateRolePrompt failed to parse role map: {}", e.getMessage(), e);
            prompt.append("你是一位综合专家，擅长从多个角度分析问题。");
        }

        if (!tags.isEmpty()) {
            prompt.append(" 请特别关注以下关键词：").append(String.join("、", tags)).append("。");
        }

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

    /**
     * 使用自定义 Prompt 整理内容用于知识库存储。
     * <p>
     * 与 {@link #organizeContentForKnowledgeBase(String, String)} 不同，
     * 此方法接受调用方预先组装好的完整 systemPrompt，允许在标准 Prompt 之外
     * 追加额外的指令（如认知对话模式）。
     * </p>
     *
     * @param category     内容分类
     * @param content      需要整理的内容
     * @param systemPrompt 完整的系统提示词（已由调用方组装）
     * @return 整理后的内容，或错误信息
     */
    public String organizeContentForKnowledgeBase(String category, String content, String systemPrompt) {
        try {
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
            String result = llmProvider.chat(promptConfigService.getGenerateSynonymsPrompt(), query);
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
        String systemPrompt = promptConfigService.getWeeklyReportPrompt();
        return extractKnowledgePoints(content, category, systemPrompt);
    }

    /**
     * 使用自定义 Prompt 从内容中提取知识点。
     * <p>
     * 与 {@link #extractKnowledgePoints(String, String)} 的区别在于允许调用方
     * 传入预先组装好的完整 systemPrompt，以便在标准 Prompt 之外追加额外指令。
     * </p>
     *
     * @param content      需要提取知识点的内容
     * @param category     内容分类
     * @param systemPrompt 完整的系统提示词（已由调用方组装）
     * @return 包含 mainReport 和 knowledgePoints 的 Map
     */
    public Map<String, Object> extractKnowledgePoints(String content, String category, String systemPrompt) {
        Map<String, Object> result = new LinkedHashMap<>();
        try {
            String responseStr = llmProvider.chat(systemPrompt,
                    "分类：" + getCategoryName(category) + "\n\n内容：\n" + content);

            String cleaned = cleanJsonWrapper(responseStr);
            ObjectMapper mapper = new ObjectMapper()
                    .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
            KnowledgeExtractionResult parsed = mapper.readValue(cleaned, KnowledgeExtractionResult.class);

            result.put("mainReport", parsed.getMainReport() != null ? parsed.getMainReport() : content);

            List<Map<String, String>> knowledgePoints = new ArrayList<>();
            if (parsed.getKnowledgePoints() != null) {
                for (KnowledgeExtractionResult.KnowledgePoint kp : parsed.getKnowledgePoints()) {
                    if (kp.getFileName() != null && kp.getContent() != null) {
                        Map<String, String> kpMap = new LinkedHashMap<>();
                        kpMap.put("fileName", kp.getFileName());
                        kpMap.put("title", kp.getTitle());
                        kpMap.put("content", kp.getContent());
                        knowledgePoints.add(kpMap);
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

    // ==================== LLM Wiki 功能 ====================

    /**
     * 批量从多个源内容中抽取实体与概念（Token 节省方案）。
     * <p>
     * 将多个源文档合并到一次 LLM 调用中，统一抽取实体（人物、产品、技术、组织、地点）
     * 和概念（主题、思想、理论、方法），并为每个源生成一行摘要。
     * 相比逐个源调用 LLM，可显著减少 Token 消耗和网络往返。
     * </p>
     *
     * <h3>返回格式</h3>
     * <pre>
     * [
     *   {"index": 0, "entities": ["React", "Facebook"], "concepts": ["Virtual DOM"], "summary": "..."},
     *   {"index": 1, "entities": [...], "concepts": [...], "summary": "..."}
     * ]
     * </pre>
     *
     * <p>失败时返回空列表（优雅降级）。</p>
     *
     * @param contents 源文档内容列表
     * @return 抽取结果列表，与输入顺序对应；失败返回空列表
     */
    public List<WikiExtractionResult> batchExtractEntitiesAndConcepts(List<String> contents) {
        if (contents == null || contents.isEmpty()) {
            return List.of();
        }
        try {
            String systemPrompt = promptConfigService.getWikiBatchExtractPrompt();
            // 构建用户消息：将每个源文档按索引拼接
            StringBuilder userMessage = new StringBuilder();
            for (int i = 0; i < contents.size(); i++) {
                userMessage.append("=== Source ").append(i).append(" ===\n");
                userMessage.append(contents.get(i) != null ? contents.get(i) : "").append("\n\n");
            }
            String response = llmProvider.chat(systemPrompt, userMessage.toString());
            String cleaned = cleanJsonWrapper(response);
            ObjectMapper mapper = new ObjectMapper()
                    .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
            List<WikiExtractionResult> parsed = mapper.readValue(cleaned,
                    new TypeReference<List<WikiExtractionResult>>() {});
            return parsed != null ? parsed : List.of();
        } catch (Exception e) {
            logger.error("[AI] batchExtractEntitiesAndConcepts failed: {}", e.getMessage(), e);
            return List.of();
        }
    }

    /**
     * 生成或更新实体 Wiki 页面。
     * <p>
     * 若 {@code existingPageContent} 为 null/空，则创建新页面；否则在已有内容基础上增量更新。
     * 系统提示词要求 LLM 使用 Obsidian [[Wiki-Link]] 语法和 > [!note] callout。
     * </p>
     *
     * @param entityName          实体名称
     * @param newSourceSummary    新来源的摘要内容
     * @param existingPageContent 已有页面内容（可为 null 或空）
     * @return 生成/更新后的 Markdown 页面内容；失败时返回 existingPageContent 或空字符串
     */
    public String generateEntityPage(String entityName, String newSourceSummary, String existingPageContent) {
        boolean hasExisting = existingPageContent != null && !existingPageContent.trim().isEmpty();
        try {
            String systemPrompt = promptConfigService.getWikiGenerateEntityPagePrompt()
                    .replace("{entityName}", entityName != null ? entityName : "");
            StringBuilder userMessage = new StringBuilder();
            userMessage.append("Entity: ").append(entityName != null ? entityName : "").append("\n\n");
            userMessage.append("New source summary:\n").append(newSourceSummary != null ? newSourceSummary : "").append("\n\n");
            if (hasExisting) {
                userMessage.append("Existing page content (update this, do not remove existing information):\n")
                        .append(existingPageContent);
            } else {
                userMessage.append("Existing page content: (none — create a new page)");
            }
            return llmProvider.chat(systemPrompt, userMessage.toString());
        } catch (Exception e) {
            logger.error("[AI] generateEntityPage failed for '{}': {}", entityName, e.getMessage(), e);
            return hasExisting ? existingPageContent : "";
        }
    }

    /**
     * 生成或更新概念 Wiki 页面。
     * <p>
     * 与 {@link #generateEntityPage} 类似，但面向概念。包含概念解释、跨源综合、
     * 相关实体（wiki-links）和相关源列表。
     * </p>
     *
     * @param conceptName         概念名称
     * @param newSourceSummary    新来源的摘要内容
     * @param existingPageContent 已有页面内容（可为 null 或空）
     * @return 生成/更新后的 Markdown 页面内容；失败时返回 existingPageContent 或空字符串
     */
    public String generateConceptPage(String conceptName, String newSourceSummary, String existingPageContent) {
        boolean hasExisting = existingPageContent != null && !existingPageContent.trim().isEmpty();
        try {
            String systemPrompt = promptConfigService.getWikiGenerateConceptPagePrompt()
                    .replace("{conceptName}", conceptName != null ? conceptName : "");
            StringBuilder userMessage = new StringBuilder();
            userMessage.append("Concept: ").append(conceptName != null ? conceptName : "").append("\n\n");
            userMessage.append("New source summary:\n").append(newSourceSummary != null ? newSourceSummary : "").append("\n\n");
            if (hasExisting) {
                userMessage.append("Existing page content (update this, do not remove existing content):\n")
                        .append(existingPageContent);
            } else {
                userMessage.append("Existing page content: (none — create a new page)");
            }
            return llmProvider.chat(systemPrompt, userMessage.toString());
        } catch (Exception e) {
            logger.error("[AI] generateConceptPage failed for '{}': {}", conceptName, e.getMessage(), e);
            return hasExisting ? existingPageContent : "";
        }
    }

    /**
     * 生成源页面，对原始源文档进行汇总。
     * <p>
     * 包含原始内容摘要、AI 分析和源 URL。失败时返回一个基础摘要。
     * </p>
     *
     * @param sourceContent 原始源内容
     * @param sourceUrl     源 URL
     * @return 源页面的 Markdown 内容；失败时返回基础摘要
     */
    public String generateSourcePage(String sourceContent, String sourceUrl) {
        try {
            String systemPrompt = promptConfigService.getWikiGenerateSourcePagePrompt();
            StringBuilder userMessage = new StringBuilder();
            userMessage.append("Source URL: ").append(sourceUrl != null ? sourceUrl : "").append("\n\n");
            userMessage.append("Source content:\n").append(sourceContent != null ? sourceContent : "");
            return llmProvider.chat(systemPrompt, userMessage.toString());
        } catch (Exception e) {
            logger.error("[AI] generateSourcePage failed: {}", e.getMessage(), e);
            // 返回基础摘要作为降级
            String safeUrl = sourceUrl != null ? sourceUrl : "";
            String snippet = sourceContent != null && sourceContent.length() > 200
                    ? sourceContent.substring(0, 200) + "..."
                    : (sourceContent != null ? sourceContent : "");
            return "# Source Page\n\nSource URL: " + safeUrl + "\n\n## Summary\n\n" + snippet;
        }
    }

    /**
     * 检测新内容与已有页面内容之间的事实矛盾。
     * <p>
     * 系统提示词要求 LLM 在发现矛盾时返回矛盾描述，无矛盾时返回 "NONE"。
     * 本方法将 "NONE"（不区分大小写、忽略空白）映射为 null。
     * </p>
     *
     * @param newContent           新内容
     * @param existingPageContent  已有页面内容
     * @return 矛盾描述字符串；无矛盾或失败时返回 null
     */
    public String detectContradiction(String newContent, String existingPageContent) {
        try {
            String systemPrompt = promptConfigService.getWikiDetectContradictionPrompt();
            StringBuilder userMessage = new StringBuilder();
            userMessage.append("Existing page content:\n")
                    .append(existingPageContent != null ? existingPageContent : "")
                    .append("\n\n===\n\nNew content:\n")
                    .append(newContent != null ? newContent : "");
            String response = llmProvider.chat(systemPrompt, userMessage.toString());
            if (response == null) {
                return null;
            }
            String trimmed = response.trim();
            if (trimmed.isEmpty() || trimmed.equalsIgnoreCase("NONE")) {
                return null;
            }
            return trimmed;
        } catch (Exception e) {
            logger.error("[AI] detectContradiction failed: {}", e.getMessage(), e);
            return null;
        }
    }

    // ==================== LLM Wiki 查询功能 ====================

    /**
     * 根据问题和 Wiki 索引定位最相关的页面名列表。
     * <p>
     * 第一阶段（便宜模型）：使用 {@link PromptConfigService#getWikiQueryIndexPrompt()} 作为系统提示词，
     * 让 LLM 从 index.md 内容中挑选最多 5 个与问题最相关的页面名，返回 JSON 字符串数组。
     * 调用方据此仅读取相关页面，避免全量扫描，节省 Token。
     * </p>
     *
     * <p>失败时返回空列表（优雅降级）。</p>
     *
     * @param question     用户问题
     * @param indexContent wiki/index.md 内容
     * @return 相关页面名列表；失败时返回空列表
     */
    @SuppressWarnings("unchecked")
    public List<String> locateRelevantPages(String question, String indexContent) {
        try {
            String systemPrompt = promptConfigService.getWikiQueryIndexPrompt();
            String userMessage = "Question: " + (question != null ? question : "") + "\n\nWiki Index:\n"
                    + (indexContent != null ? indexContent : "");
            String response = llmProvider.chat(systemPrompt, userMessage);
            if (response == null || response.trim().isEmpty()) {
                return List.of();
            }
            String cleaned = cleanJsonWrapper(response);
            ObjectMapper mapper = new ObjectMapper()
                    .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
            List<String> parsed = mapper.readValue(cleaned, new TypeReference<List<String>>() {});
            return parsed != null ? parsed : List.of();
        } catch (Exception e) {
            logger.error("[AI] locateRelevantPages failed: {}", e.getMessage(), e);
            return List.of();
        }
    }

    /**
     * 基于问题和相关页面内容综合生成答案。
     * <p>
     * 第二阶段（强模型）：使用 {@link PromptConfigService#getWikiQuerySynthesisPrompt()} 作为系统提示词，
     * 将问题与每个相关页面内容拼接送入 LLM，生成 Markdown 答案，含 [[Wiki-Link]] 引用。
     * </p>
     *
     * <p>失败时返回降级字符串 {@code "无法生成答案: " + e.getMessage()}。</p>
     *
     * @param question     用户问题
     * @param pageContents 页面名 → 页面内容映射
     * @return Markdown 答案字符串
     */
    public String synthesizeAnswer(String question, Map<String, String> pageContents) {
        try {
            String systemPrompt = promptConfigService.getWikiQuerySynthesisPrompt();
            StringBuilder userMessage = new StringBuilder();
            userMessage.append("Question: ").append(question != null ? question : "").append("\n\n");
            userMessage.append("Relevant pages:\n\n");
            if (pageContents != null && !pageContents.isEmpty()) {
                for (Map.Entry<String, String> entry : pageContents.entrySet()) {
                    String pageName = entry.getKey();
                    String content = entry.getValue() != null ? entry.getValue() : "";
                    userMessage.append("## ").append(pageName).append("\n")
                            .append(content).append("\n\n");
                }
            }
            return llmProvider.chat(systemPrompt, userMessage.toString());
        } catch (Exception e) {
            logger.error("[AI] synthesizeAnswer failed: {}", e.getMessage(), e);
            return "无法生成答案: " + e.getMessage();
        }
    }

    // ==================== LLM Wiki Lint 功能 ====================

    /**
     * 对所有 Wiki 页面执行健康检查（lint）。
     * <p>
     * 系统提示词使用 {@link PromptConfigService#getWikiLintPrompt()}，
     * 用户消息先列出页面清单，再逐个展示页面内容。LLM 返回 JSON 数组，
     * 每个元素含 type（contradiction/stale/orphan/missing_page/missing_cross_reference）、
     * pages（涉及页面名列表）和 description（问题描述）字段。
     * </p>
     *
     * <p>失败时返回空列表（优雅降级），不中断 lint 流程。</p>
     *
     * @param pageContents 页面名 → 页面内容映射
     * @return 检测到的问题列表，每个元素含 type/pages/description；失败返回空列表
     */
    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> lintWikiPages(Map<String, String> pageContents) {
        if (pageContents == null || pageContents.isEmpty()) {
            return List.of();
        }
        try {
            String systemPrompt = promptConfigService.getWikiLintPrompt();
            StringBuilder userMessage = new StringBuilder();
            // 1. 页面清单
            userMessage.append("Pages to lint:\n");
            for (String pageName : pageContents.keySet()) {
                userMessage.append("- ").append(pageName).append("\n");
            }
            userMessage.append("\n");
            // 2. 逐个展示页面内容
            for (Map.Entry<String, String> entry : pageContents.entrySet()) {
                String pageName = entry.getKey();
                String content = entry.getValue() != null ? entry.getValue() : "";
                userMessage.append("=== ").append(pageName).append(" ===\n")
                        .append(content).append("\n\n");
            }
            String response = llmProvider.chat(systemPrompt, userMessage.toString());
            if (response == null || response.trim().isEmpty()) {
                return List.of();
            }
            String cleaned = cleanJsonWrapper(response);
            ObjectMapper mapper = new ObjectMapper()
                    .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
            List<Map<String, Object>> parsed = mapper.readValue(cleaned,
                    new TypeReference<List<Map<String, Object>>>() {});
            return parsed != null ? parsed : List.of();
        } catch (Exception e) {
            logger.error("[AI] lintWikiPages failed: {}", e.getMessage(), e);
            return List.of();
        }
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
            String cleaned = cleanJsonWrapper(json);
            ObjectMapper mapper = new ObjectMapper()
                    .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
            ClipAnalysisResult parsed = mapper.readValue(cleaned, ClipAnalysisResult.class);

            result.put("summary", parsed.getSummary() != null ? parsed.getSummary() : "摘要生成失败");
            result.put("analysis", parsed.getAnalysis() != null ? parsed.getAnalysis() : "分析生成失败");
            result.put("tags", parsed.getTags() != null ? parsed.getTags() : List.of());
            String category = parsed.getCategory();
            result.put("category", (category != null && isValidCategory(category)) ? category : "default");
        } catch (Exception e) {
            logger.error("[AI] parseProcessResult failed: {}", e.getMessage(), e);
            result.put("summary", "解析失败");
            result.put("analysis", "");
            result.put("tags", List.of());
            result.put("category", "default");
        }
        return result;
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
            String cleaned = cleanJsonWrapper(json);
            if (!cleaned.startsWith("{")) return result;

            ObjectMapper mapper = new ObjectMapper()
                    .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
            Map<String, Object> parsed = mapper.readValue(cleaned, new TypeReference<Map<String, Object>>() {});
            result.putAll(parsed);
        } catch (Exception e) {
            logger.error("[AI] parseSimpleJson failed: {}", e.getMessage(), e);
        }
        return result;
    }

    /**
     * 清理 LLM 返回的 markdown 代码块包裹。
     * <p>
     * 大模型经常在 JSON 外面包裹 ```json ... ```，
     * 此方法统一清理，返回纯净的 JSON 字符串。
     * </p>
     *
     * @param json 可能被包裹的 JSON 字符串
     * @return 清理后的 JSON 字符串
     */
    private String cleanJsonWrapper(String json) {
        if (json == null) return "";
        json = json.trim();
        if (json.startsWith("```")) {
            json = json.replaceAll("^```json?\\s*", "").replaceAll("\\s*```$", "").trim();
        }
        return json;
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

    // ==================== 密码库 AI 自动填充 ====================

    /**
     * 从文本中智能提取密码条目列表（支持多条）。
     * LLM 返回 JSON 数组，每个元素包含 name/url/username/password/notes 字段。
     *
     * @param rawText 用户粘贴的原始文本
     * @return 提取的条目列表
     */
    public List<Map<String, String>> parsePasswordInfo(String rawText) {
        List<Map<String, String>> result = new ArrayList<>();

        // ---- 1. 脱敏：替换疑似密码内容为占位符 ----
        // 使用正则匹配常见的密码标识行，例如：
        // "密码：123456", "password: abc123", "pass = 123"
        // 同时保留占位符映射
        Map<String, String> placeholderToReal = new LinkedHashMap<>();
        String sanitizedText = sanitizePasswords(rawText, placeholderToReal);

        // 构建 system prompt（注意：不要求 AI 返回密码，但保留 password 字段占位）
        String systemPrompt = "你是一个密码管理器助手。请从以下文本中提取所有密码条目信息。"
                + "这些文本可能包含多条账号密码。返回 JSON 数组（不要 markdown 代码块）。\n\n"
                + "要求：\n"
                + "1. 每条提取字段：name（条目名称）、url（网址）、username（用户名）、password（密码）、notes（备注）\n"
                + "2. 去除噪声：忽略时间戳、无关文本、广告、UI 标签等非密码信息\n"
                + "3. 智能推断：如果用户名是邮箱格式（如 user@example.com），且没有明确网址，搜索关键字找到官方网站，找不到的则将 example.com 作为 url\n"
                + "4. 如果某字段确实无法提取，设为空字符串 \"\"\n"
                + "5. 注意：一条信息中可能同时包含多个账号，每条都是一个独立对象\n"
                + "6. 只返回 JSON 数组，不要任何额外文字\n\n"
                + "示例返回格式：\n"
                + "[\n"
                + "  {\"name\":\"GitHub\",\"url\":\"https://github.com\",\"username\":\"user1\",\"password\":\"<PASSWORD_1>\",\"notes\":\"\"},\n"
                + "  {\"name\":\"Google\",\"url\":\"https://google.com\",\"username\":\"user2@gmail.com\",\"password\":\"<PASSWORD_2>\",\"notes\":\"工作账号\"}\n"
                + "]";

        String response = null;
        try {
            // 调用 AI，传入脱敏后的文本
            response = llmProvider.chat(systemPrompt, sanitizedText);
            String cleaned = cleanJsonWrapper(response);
            ObjectMapper mapper = new ObjectMapper()
                    .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

            // 尝试解析为数组
            List<Map<String, Object>> parsed = mapper.readValue(cleaned, new TypeReference<List<Map<String, Object>>>() {});
            for (Map<String, Object> item : parsed) {
                Map<String, String> entry = new LinkedHashMap<>();
                for (String key : new String[]{"name", "url", "username", "password", "notes"}) {
                    Object val = item.get(key);
                    String strVal = val != null ? val.toString() : "";
                    // ---- 2. 恢复密码占位符 ----
                    if (key.equals("password") && placeholderToReal.containsKey(strVal)) {
                        strVal = placeholderToReal.get(strVal);
                    }
                    entry.put(key, strVal);
                }
                result.add(entry);
            }
        } catch (Exception e) {
            // 兼容单对象格式
            logger.warn("[AI] parsePasswordInfo array parse failed, trying single object: {}", e.getMessage());
            try {
                ObjectMapper mapper = new ObjectMapper()
                        .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
                Map<String, Object> single = mapper.readValue(cleanJsonWrapper(response), new TypeReference<Map<String, Object>>() {});
                Map<String, String> entry = new LinkedHashMap<>();
                for (String key : new String[]{"name", "url", "username", "password", "notes"}) {
                    Object val = single.get(key);
                    String strVal = val != null ? val.toString() : "";
                    if (key.equals("password") && placeholderToReal.containsKey(strVal)) {
                        strVal = placeholderToReal.get(strVal);
                    }
                    entry.put(key, strVal);
                }
                result.add(entry);
            } catch (Exception e2) {
                logger.error("[AI] parsePasswordInfo failed completely: {}", e2.getMessage(), e2);
                String snippet = (response != null && response.length() > 200) ? response.substring(0, 200) + "..." : response;
                throw new RuntimeException("AI 模型返回结果解析失败，请检查 AI 模型配置是否正确。原始响应：" + snippet);
            }
        }
        return result;
    }

    /**
     * 脱敏函数：将 rawText 中疑似密码的值替换为 <PASSWORD_N> 占位符。
     * 支持常见格式：password: xxx, 密码：xxx, pass = xxx, pwd=xxx 等。
     * 同时也支持行内直接出现密码字符串（如 csv 中 password 列）。
     *
     * @param rawText 原始文本
     * @param placeholderMap 输出映射（占位符 -> 真实密码）
     * @return 脱敏后的文本
     */
    private String sanitizePasswords(String rawText, Map<String, String> placeholderMap) {
        // 使用正则匹配：密码关键词 + 分隔符 + 非空密码值（不包含换行）
        // 关键词：password|pass|pwd|密码
        // 分隔符：[:：=]\s*
        // 密码值：非空白字符序列（或直到行末）
        Pattern pattern = Pattern.compile(
                "(?i)(password|pass|pwd|密码)\\s*[:：=]\\s*([^\\s,;，；]+)",
                Pattern.MULTILINE
        );
        Matcher matcher = pattern.matcher(rawText);
        StringBuffer sb = new StringBuffer();
        int counter = 1;
        while (matcher.find()) {
            String passwordValue = matcher.group(2);
            // 避免替换空串或明显不是密码的（如 "null", "none"）
            if (passwordValue != null && !passwordValue.isEmpty()
                    && !passwordValue.equalsIgnoreCase("null")
                    && !passwordValue.equalsIgnoreCase("none")) {
                String placeholder = "<PASSWORD_" + counter + ">";
                placeholderMap.put(placeholder, passwordValue);
                // 替换整个匹配组，保留前缀（关键词+分隔符）并插入占位符
                matcher.appendReplacement(sb, matcher.group(1) + " " + placeholder);
                counter++;
            } else {
                // 不替换，保留原文
                matcher.appendReplacement(sb, matcher.group(0));
            }
        }
        matcher.appendTail(sb);
        return sb.toString();
    }

    // ==================== 知识合成 ====================

    /**
     * 综合多个剪藏内容，生成结构化的知识条目草稿。
     * <p>
     * 调用 LLM 对多条剪藏内容进行综合分析，提取共同主题、关键概念和矛盾点，
     * 生成一个结构化的知识条目，包含标题、摘要和 Markdown 格式的正文内容。
     * 结果以 JSON 形式返回，供前端编辑器预填充使用。
     * </p>
     *
     * @param combinedContent 拼接后的多条剪藏内容，含分隔标记
     * @return 包含 title、summary、content 的 Map；失败时返回 null
     */
    public Map<String, String> synthesizeKnowledgeContent(String combinedContent) {
        String systemPrompt = "你是一个知识管理专家。请综合以下多条剪藏内容，提取共同主题、关键概念和矛盾点，"
                + "生成一个结构化的知识条目。\n\n"
                + "要求：\n"
                + "1. title：精炼的标题，概括核心主题\n"
                + "2. summary：1-2句话的摘要，概述知识要点\n"
                + "3. content：Markdown格式的正文，包含以下章节：\n"
                + "   - ## 核心概念（列出关键概念及其解释）\n"
                + "   - ## 共同主题（分析各剪藏之间的关联）\n"
                + "   - ## 关键洞察（提炼有价值的见解）\n"
                + "   - ## 矛盾与讨论（如有不一致的观点，列出并分析）\n"
                + "4. 只返回 JSON 格式，不要包含 markdown 代码块标记\n\n"
                + "输出格式：\n"
                + "{\"title\": \"...\", \"summary\": \"...\", \"content\": \"...\"}";

        try {
            String response = llmProvider.chat(systemPrompt, combinedContent);
            if (response == null || response.trim().isEmpty()) {
                return null;
            }
            String cleaned = cleanJsonWrapper(response);
            ObjectMapper mapper = new ObjectMapper()
                    .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
            return mapper.readValue(cleaned, new TypeReference<Map<String, String>>() {});
        } catch (Exception e) {
            logger.error("[AI] synthesizeKnowledgeContent failed: {}", e.getMessage(), e);
            return null;
        }
    }

    // ==================== 智能入库：意图识别与字段提取 ====================

    /**
     * 识别文本意图，判断应存入剪藏、待办还是话题。
     * <p>
     * 调用 LLM 进行三分类（clip / todo / topic），返回纯文本标签。
     * 失败时返回 null，调用方应降级为 clip 处理。
     * </p>
     *
     * @param text 用户输入的文本内容
     * @return "clip" / "todo" / "topic"；失败返回 null
     */
    public String identifyIntent(String text) {
        try {
            String systemPrompt = "你是一个智能内容分类助手。请判断以下文本最适合存入哪种类型：\n" +
                "\n" +
                "- clip（剪藏）：长文分析、URL、结构化报告、知识点、无明确行动项或待办属性的内容\n" +
                "- todo（待办）：含 deadline/时间限制、优先级、行动项、待办标记、提醒类内容\n" +
                "- topic（话题）：分享推荐、观点讨论、社交讨论、对话内容\n" +
                "\n" +
                "只返回一个单词：clip、todo 或 topic。不要返回其他任何内容。";

            String response = llmProvider.chat(systemPrompt, text);
            if (response == null) return null;
            String intent = response.trim().toLowerCase();
            if (intent.contains("todo")) return "todo";
            if (intent.contains("topic")) return "topic";
            return "clip"; // 默认剪藏
        } catch (Exception e) {
            logger.error("[AI] identifyIntent failed: {}", e.getMessage());
            return null;
        }
    }

    /**
     * 根据意图从文本中提取结构化字段。
     * <p>
     * 调用 LLM 提取字段并以 JSON 格式返回。返回的 Map key 为对应模型字段名。
     * 失败时返回 null，调用方应降级处理。
     * </p>
     *
     * @param text   原始文本
     * @param intent 意图类型（clip / todo / topic）
     * @return 字段映射，key 为目标模型字段名；失败返回 null
     */
    public Map<String, Object> extractFields(String text, String intent) {
        try {
            String fieldDesc;
            switch (intent) {
                case "todo":
                    fieldDesc = "title（必填，任务标题）, priority（high/medium/low，默认 medium）, deadline（yyyy-MM-dd 格式的日期）, deadlineTime（HH:mm 格式的时间）, category（work/study/life/hobby/finance/social）";
                    break;
                case "topic":
                    fieldDesc = "title（必填，话题标题）, summary（简短摘要）, content（正文内容）, tags（字符串数组，3-8 个关键词）, category（work/study/life/hobby/finance/social）";
                    break;
                case "clip":
                default:
                    fieldDesc = "title（标题）, content（正文内容）, summary（简短摘要，≤100字）, analysis（深度分析，Markdown格式）, tags（字符串数组，3-8 个关键词）, category（work/study/life/hobby/finance/social）, sourceUrl（如有URL）";
                    break;
            }

            String systemPrompt = "你是一个智能数据提取助手。请从以下文本中提取结构化字段，以 JSON 格式返回。\n" +
                "\n" +
                "需要提取的字段：" + fieldDesc + "\n" +
                "\n" +
                "规则：\n" +
                "1. 只返回 JSON 对象，不要包含 markdown 代码块标记\n" +
                "2. 无法确定的字段用 null\n" +
                "3. 日期用 yyyy-MM-dd 格式，时间用 HH:mm 格式\n" +
                "4. tags 必须是字符串数组\n" +
                "5. 不要添加任何额外解释";

            String response = llmProvider.chat(systemPrompt, text);
            if (response == null) return null;

            // 清理 LLM 输出中可能的 markdown 代码块包裹
            String cleaned = response.trim();
            if (cleaned.startsWith("```")) {
                cleaned = cleaned.replaceAll("```[a-z]*\\s*", "").trim();
            }

            ObjectMapper mapper = new ObjectMapper();
            mapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
            return mapper.readValue(cleaned, new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            logger.error("[AI] extractFields failed for intent={}: {}", intent, e.getMessage());
            return null;
        }
    }
}