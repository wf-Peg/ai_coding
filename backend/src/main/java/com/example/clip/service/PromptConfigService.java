package com.example.clip.service;

import com.example.clip.config.PromptConfig;
import org.springframework.stereotype.Service;

/**
 * Prompt 配置业务服务。
 * <p>
 * 管理所有 AI 提示词（Prompt）的读取、保存和重置操作。
 * 维护 10 个 Prompt 字段（3 核心 + 1 任务格式 + 6 辅助），
 * 全部支持用户通过前端弹窗自定义。
 * </p>
 *
 * <h3>Prompt 字段清单</h3>
 * <ul>
 *   <li><b>核心</b>：clipAnalyze、dailyOrganize、weeklyReport</li>
 *   <li><b>任务格式</b>：clipAnalyzeTaskFormat（含 {{category_tree}} 占位符）</li>
 *   <li><b>辅助</b>：analyzeContent、generateSummary、generateTags、smartOrganize、generateSynonyms、divergentSummaryRoleMap</li>
 * </ul>
 *
 * <h3>模板占位符</h3>
 * <ul>
 *   <li>{{category}} — 分类中文名称</li>
 *   <li>{{date}} — 当前日期</li>
 *   <li>{{category_tree}} — 分类树文本</li>
 *   <li>{{count}} — 条目数量</li>
 *   <li>{{week_range}} — 周报日期范围</li>
 * </ul>
 */
@Service
public class PromptConfigService {

    private static final int MAX_PROMPT_LENGTH = 30000;

    private final PromptConfigStorageService storageService;

    public PromptConfigService(PromptConfigStorageService storageService) {
        this.storageService = storageService;
    }

    // ==================== 读取 ====================

    /**
     * 获取当前完整 Prompt 配置，缺失字段用默认值填充。
     */
    public PromptConfig getPromptConfig() {
        PromptConfig loaded = storageService.loadConfig();
        if (loaded == null) {
            return getDefaultConfig();
        }
        PromptConfig normalized = new PromptConfig();
        // 核心
        normalized.setClipAnalyzeSystemPrompt(normalizeOrDefault(loaded.getClipAnalyzeSystemPrompt(), DEFAULT_CLIP_ANALYZE_PROMPT));
        normalized.setDailyOrganizeSystemPrompt(normalizeOrDefault(loaded.getDailyOrganizeSystemPrompt(), DEFAULT_DAILY_ORGANIZE_PROMPT));
        normalized.setWeeklyReportSystemPrompt(normalizeOrDefault(loaded.getWeeklyReportSystemPrompt(), DEFAULT_WEEKLY_REPORT_PROMPT));
        // 任务格式
        normalized.setClipAnalyzeTaskFormat(normalizeOrDefault(loaded.getClipAnalyzeTaskFormat(), DEFAULT_CLIP_ANALYZE_TASK_FORMAT));
        // 辅助
        normalized.setAnalyzeContentPrompt(normalizeOrDefault(loaded.getAnalyzeContentPrompt(), DEFAULT_ANALYZE_CONTENT_PROMPT));
        normalized.setGenerateSummaryPrompt(normalizeOrDefault(loaded.getGenerateSummaryPrompt(), DEFAULT_GENERATE_SUMMARY_PROMPT));
        normalized.setGenerateTagsPrompt(normalizeOrDefault(loaded.getGenerateTagsPrompt(), DEFAULT_GENERATE_TAGS_PROMPT));
        normalized.setSmartOrganizePrompt(normalizeOrDefault(loaded.getSmartOrganizePrompt(), DEFAULT_SMART_ORGANIZE_PROMPT));
        normalized.setGenerateSynonymsPrompt(normalizeOrDefault(loaded.getGenerateSynonymsPrompt(), DEFAULT_GENERATE_SYNONYMS_PROMPT));
        normalized.setDivergentSummaryRoleMap(normalizeOrDefault(loaded.getDivergentSummaryRoleMap(), DEFAULT_DIVERGENT_SUMMARY_ROLE_MAP));
        return normalized;
    }

    // ==================== 保存 ====================

    /**
     * 保存 Prompt 配置（合并策略：未填字段保留现有值）。
     */
    public PromptConfig savePromptConfig(PromptConfig config) {
        if (config == null) {
            throw new IllegalArgumentException("Prompt配置不能为空");
        }
        PromptConfig existing = getPromptConfig();
        PromptConfig normalized = new PromptConfig();
        normalized.setClipAnalyzeSystemPrompt(normalizeOrDefault(config.getClipAnalyzeSystemPrompt(), existing.getClipAnalyzeSystemPrompt()));
        normalized.setDailyOrganizeSystemPrompt(normalizeOrDefault(config.getDailyOrganizeSystemPrompt(), existing.getDailyOrganizeSystemPrompt()));
        normalized.setWeeklyReportSystemPrompt(normalizeOrDefault(config.getWeeklyReportSystemPrompt(), existing.getWeeklyReportSystemPrompt()));
        normalized.setClipAnalyzeTaskFormat(normalizeOrDefault(config.getClipAnalyzeTaskFormat(), existing.getClipAnalyzeTaskFormat()));
        normalized.setAnalyzeContentPrompt(normalizeOrDefault(config.getAnalyzeContentPrompt(), existing.getAnalyzeContentPrompt()));
        normalized.setGenerateSummaryPrompt(normalizeOrDefault(config.getGenerateSummaryPrompt(), existing.getGenerateSummaryPrompt()));
        normalized.setGenerateTagsPrompt(normalizeOrDefault(config.getGenerateTagsPrompt(), existing.getGenerateTagsPrompt()));
        normalized.setSmartOrganizePrompt(normalizeOrDefault(config.getSmartOrganizePrompt(), existing.getSmartOrganizePrompt()));
        normalized.setGenerateSynonymsPrompt(normalizeOrDefault(config.getGenerateSynonymsPrompt(), existing.getGenerateSynonymsPrompt()));
        normalized.setDivergentSummaryRoleMap(normalizeOrDefault(config.getDivergentSummaryRoleMap(), existing.getDivergentSummaryRoleMap()));
        validate(normalized);
        storageService.saveConfig(normalized);
        return normalized;
    }

    public PromptConfig resetToDefault() {
        PromptConfig defaultConfig = getDefaultConfig();
        storageService.saveConfig(defaultConfig);
        return defaultConfig;
    }

    // ==================== 便捷 Getter（核心） ====================

    public String getClipAnalyzePrompt() {
        return getPromptConfig().getClipAnalyzeSystemPrompt();
    }

    public String getDailyOrganizePrompt() {
        return getPromptConfig().getDailyOrganizeSystemPrompt();
    }

    public String getWeeklyReportPrompt() {
        return getPromptConfig().getWeeklyReportSystemPrompt();
    }

    // ==================== 便捷 Getter（任务格式） ====================

    /**
     * 渲染剪藏分析的任务格式 Prompt，替换 {{category_tree}} 占位符。
     *
     * @param categoryTreeText 分类树文本描述
     * @return 渲染后的任务格式 Prompt
     */
    public String getRenderedClipAnalyzeTaskFormat(String categoryTreeText) {
        String template = getPromptConfig().getClipAnalyzeTaskFormat();
        return template.replace("{{category_tree}}", categoryTreeText != null ? categoryTreeText : "");
    }

    // ==================== 便捷 Getter（辅助） ====================

    public String getAnalyzeContentPrompt() {
        return getPromptConfig().getAnalyzeContentPrompt();
    }

    public String getGenerateSummaryPrompt() {
        return getPromptConfig().getGenerateSummaryPrompt();
    }

    public String getGenerateTagsPrompt() {
        return getPromptConfig().getGenerateTagsPrompt();
    }

    public String getSmartOrganizePrompt() {
        return getPromptConfig().getSmartOrganizePrompt();
    }

    public String getGenerateSynonymsPrompt() {
        return getPromptConfig().getGenerateSynonymsPrompt();
    }

    public String getDivergentSummaryRoleMap() {
        return getPromptConfig().getDivergentSummaryRoleMap();
    }

    // ==================== 模板渲染 ====================

    /**
     * 渲染每日整理 Prompt，支持 {{category}}、{{date}} 占位符。
     */
    public String renderDailyPrompt(String category) {
        String prompt = getPromptConfig().getDailyOrganizeSystemPrompt();
        String safeCategory = (category == null || category.isBlank()) ? "默认分类" : category;
        String date = java.time.LocalDate.now().toString();
        return prompt.replace("{{category}}", safeCategory).replace("{{date}}", date);
    }

    /**
     * 渲染每日整理 Prompt，支持 {{category}}、{{date}}、{{count}} 占位符。
     */
    public String renderDailyPrompt(String category, int count) {
        String prompt = renderDailyPrompt(category);
        return prompt.replace("{{count}}", String.valueOf(count));
    }

    /**
     * 渲染周报 Prompt，支持 {{week_range}} 占位符。
     */
    public String renderWeeklyPrompt(String weekRange) {
        String prompt = getPromptConfig().getWeeklyReportSystemPrompt();
        return prompt.replace("{{week_range}}", weekRange != null ? weekRange : "");
    }

    // ==================== 内部工具方法 ====================

    private String normalizeOrDefault(String value, String defaultValue) {
        if (value == null || value.trim().isEmpty()) {
            return defaultValue;
        }
        return value.trim();
    }

    private PromptConfig getDefaultConfig() {
        PromptConfig c = new PromptConfig();
        c.setClipAnalyzeSystemPrompt(DEFAULT_CLIP_ANALYZE_PROMPT);
        c.setDailyOrganizeSystemPrompt(DEFAULT_DAILY_ORGANIZE_PROMPT);
        c.setWeeklyReportSystemPrompt(DEFAULT_WEEKLY_REPORT_PROMPT);
        c.setClipAnalyzeTaskFormat(DEFAULT_CLIP_ANALYZE_TASK_FORMAT);
        c.setAnalyzeContentPrompt(DEFAULT_ANALYZE_CONTENT_PROMPT);
        c.setGenerateSummaryPrompt(DEFAULT_GENERATE_SUMMARY_PROMPT);
        c.setGenerateTagsPrompt(DEFAULT_GENERATE_TAGS_PROMPT);
        c.setSmartOrganizePrompt(DEFAULT_SMART_ORGANIZE_PROMPT);
        c.setGenerateSynonymsPrompt(DEFAULT_GENERATE_SYNONYMS_PROMPT);
        c.setDivergentSummaryRoleMap(DEFAULT_DIVERGENT_SUMMARY_ROLE_MAP);
        return c;
    }

    private void validate(PromptConfig config) {
        if (config == null) {
            throw new IllegalArgumentException("Prompt配置不能为空");
        }
        validateField("clipAnalyzeSystemPrompt", config.getClipAnalyzeSystemPrompt());
        validateField("dailyOrganizeSystemPrompt", config.getDailyOrganizeSystemPrompt());
        validateField("weeklyReportSystemPrompt", config.getWeeklyReportSystemPrompt());
        validateField("clipAnalyzeTaskFormat", config.getClipAnalyzeTaskFormat());
        validateField("analyzeContentPrompt", config.getAnalyzeContentPrompt());
        validateField("generateSummaryPrompt", config.getGenerateSummaryPrompt());
        validateField("generateTagsPrompt", config.getGenerateTagsPrompt());
        validateField("smartOrganizePrompt", config.getSmartOrganizePrompt());
        validateField("generateSynonymsPrompt", config.getGenerateSynonymsPrompt());
        validateField("divergentSummaryRoleMap", config.getDivergentSummaryRoleMap());
    }

    private void validateField(String fieldName, String value) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException(fieldName + " 不能为空");
        }
        if (value.length() > MAX_PROMPT_LENGTH) {
            throw new IllegalArgumentException(fieldName + " 长度不能超过 " + MAX_PROMPT_LENGTH);
        }
    }

    // ==================== 默认 Prompt 常量 ====================

    /** 默认剪藏分析 Prompt — 角色定义部分 */
    private static final String DEFAULT_CLIP_ANALYZE_PROMPT =
            "# Role\n" +
            "你是一个专业的内容分析助手，擅长从碎片化信息中提炼核心要点。\n" +
            "\n" +
            "# Goal\n" +
            "对输入的剪藏内容进行深度分析，输出准确、简洁、结构化的摘要、分析和标签。\n" +
            "\n" +
            "# Constraints\n" +
            "- 输出应准确、简洁、结构化，避免空话和重复\n" +
            "- analysis 字段使用 Markdown 格式，重点提炼关键结论与可执行洞见\n" +
            "- 不要生成与输入内容无关的冗余信息";

    /** 默认剪藏分析任务格式 — 含 {{category_tree}} 占位符 */
    private static final String DEFAULT_CLIP_ANALYZE_TASK_FORMAT =
            "请对以下内容完成{task_count}任务，严格按JSON格式返回：\n\n" +
            "1. 摘要(summary)：不超过100字的简短摘要\n" +
            "2. 分析(analysis)：使用markdown格式，提取关键信息进行深度分析，不要生成摘要\n" +
            "3. 标签(tags)：3-8个关键词标签\n\n" +
            "4. 分类(category)：从下面的预设分类中选择最匹配的一个分类（优先选二级分类）\n\n" +
            "预设分类：\n" +
            "{{category_tree}}\n" +
            "注意：\n" +
            "- category 必须是上面预设分类中的 value 值对应的英文单词\n" +
            "- 只能选择二级分类\n\n" +
            "请严格按以下JSON格式返回，不要有任何其他文字：\n" +
            "{\"summary\":\"摘要内容\",\"analysis\":\"分析内容(markdown格式)\",\"tags\":[\"标签1\",\"标签2\",\"标签3\"],\"category\":\"分类value值\"}\n\n" +
            "注意：\n" +
            "- category 必须是上面预设分类中的 value 值\n" +
            "- tags 是关键词数组，3-8个，简洁精准\n" +
            "- 只返回JSON，不要有其他内容";

    /** 默认每日整理 Prompt */
    private static final String DEFAULT_DAILY_ORGANIZE_PROMPT =
            "# Role\n" +
            "你是一位拥有20年经验的**{{category}}**行业专家及知识管理顾问。\n" +
            "\n" +
            "# Goal\n" +
            "接收用户提供的原始文档列表，按照\u201C关联性整合\u201D与\u201C层级化分类\u201D的原则，输出一份结构严谨、逻辑清晰的【行业知识库日报】。\n" +
            "\n" +
            "# Workflow\n" +
            "1. **关联性分析**：\n" +
            "   - 逐条审查输入内容，识别主题重叠、逻辑互补或观点冲突的段落\n" +
            "   - 将内容划分为\u201C关联组\u201D（需合并）和\u201C独立项\u201D（需保留原貌）\n" +
            "\n" +
            "2. **内容整合与重构**：\n" +
            "   - **关联组处理**：合并相关内容，融合重写分析，合并标签\n" +
            "   - **独立项处理**：保留原文，仅做格式微调\n" +
            "\n" +
            "3. **全局复盘**：\n" +
            "   - 站在行业专家视角，进行跨学科系统性总结\n" +
            "   - 输出高浓度的\u201C今日复盘\u201D作为标题\n" +
            "\n" +
            "# Output Format\n" +
            "- 一级标题：`# {日期}日报`（全文仅一个）\n" +
            "- 二级标题：内容板块标题 或 `今日复盘`\n" +
            "- 三级标题：`原文`、`分析`\n" +
            "- 标签使用 `#标签名` 格式\n" +
            "\n" +
            "# Constraints\n" +
            "- 保持客观、理性的语调\n" +
            "- 分析部分具有高信息密度，拒绝废话\n" +
            "- 严格禁止使用角色扮演式开场白，直接输出日报内容";

    /** 默认周报生成 Prompt */
    private static final String DEFAULT_WEEKLY_REPORT_PROMPT =
            "# Role\n" +
            "你是一位专业的知识管理专家，擅长将复杂内容拆分为独立的知识点，并使用Obsidian双链语法建立知识点之间的关联。\n" +
            "\n" +
            "# Goal\n" +
            "接收用户提供的原始内容，将其拆分为独立的知识点，每个知识点存储为一个单独的文件，同时在主报告中使用Obsidian双链语法[[知识点名称]]引用这些知识点。\n" +
            "\n" +
            "# Workflow\n" +
            "1. **内容分析**：仔细阅读原始内容，识别核心知识点\n" +
            "2. **知识点命名**：为每个知识点创建清晰简洁的文件名（中文，避免特殊字符）\n" +
            "3. **双链引用**：在主报告中使用[[知识点文件名]]格式引用\n" +
            "4. **知识点内容**：每个知识点包含完整内容，标签和关联信息\n" +
            "\n" +
            "# Output Format\n" +
            "请严格按以下JSON格式返回，不要有任何其他文字：\n" +
            "{\n" +
            "  \"mainReport\": \"主报告内容，使用[[知识点文件名]]格式引用知识点\",\n" +
            "  \"knowledgePoints\": [\n" +
            "    {\n" +
            "      \"fileName\": \"知识点文件名（不含.md扩展名）\",\n" +
            "      \"title\": \"知识点标题\",\n" +
            "      \"content\": \"知识点完整内容，使用Markdown格式\"\n" +
            "    }\n" +
            "  ]\n" +
            "}\n" +
            "\n" +
            "# Constraints\n" +
            "- 知识点数量控制在3-10个之间\n" +
            "- 每个知识点内容应该充实，有实际价值\n" +
            "- 主报告应该结构清晰，引用自然\n" +
            "- 文件名只使用中文、数字和下划线，不要特殊字符";

    /** 默认深度内容分析 Prompt */
    private static final String DEFAULT_ANALYZE_CONTENT_PROMPT =
            "你是一个专业的内容分析师，请对以下内容进行深度分析，提取关键信息。请使用markdown格式输出，不要生成摘要。";

    /** 默认摘要生成 Prompt */
    private static final String DEFAULT_GENERATE_SUMMARY_PROMPT =
            "请为以下内容生成一个简短的摘要，不超过100字。";

    /** 默认标签提取 Prompt */
    private static final String DEFAULT_GENERATE_TAGS_PROMPT =
            "请为以下内容提取10个以内的关键词作为标签，每个标签用逗号分隔，不要有其他文字。";

    /** 默认智能分类+标签 Prompt，含 {{category_tree}} 占位符 */
    private static final String DEFAULT_SMART_ORGANIZE_PROMPT =
            "你是一个智能内容分类助手。请分析用户的内容，完成以下任务：\n\n" +
            "1. 从下面的预设分类中选择最匹配的【一个】分类（优先选二级分类，没有合适的选一级）\n" +
            "2. 提取3-8个关键词作为标签\n\n" +
            "预设分类：\n" +
            "{{category_tree}}\n\n" +
            "请严格按以下JSON格式返回，不要有任何其他文字：\n" +
            "{\"category\":\"分类value值\",\"tags\":[\"标签1\",\"标签2\"]}\n\n" +
            "注意：\n" +
            "- category 必须是上面预设分类中的 value 值\n" +
            "- tags 是关键词数组，3-8个，简洁精准\n" +
            "- 只返回JSON，不要有其他内容";

    /** 默认搜索同义词 Prompt */
    private static final String DEFAULT_GENERATE_SYNONYMS_PROMPT =
            "你是一个搜索助手。用户输入一个搜索关键词，请给出不超过3个与该词语义相关的同义词或近义词。只输出同义词，用逗号分隔，不要输出任何其他内容。如果没有合适的同义词，直接输出原词。";

    /** 默认发散性总结角色映射（JSON 格式） */
    private static final String DEFAULT_DIVERGENT_SUMMARY_ROLE_MAP =
            "{\n" +
            "  \"work\": \"你是一位职场专家，擅长分析职业发展和工作效率。\",\n" +
            "  \"study\": \"你是一位教育专家，擅长学习方法和知识管理。\",\n" +
            "  \"life\": \"你是一位生活顾问，擅长提供生活建议和见解。\",\n" +
            "  \"hobby\": \"你是一位创意专家，擅长多领域探索和创新思维。\",\n" +
            "  \"finance\": \"你是一位金融专家，擅长投资理财和财务规划。\",\n" +
            "  \"social\": \"你是一位社交专家，擅长人际关系和沟通分析。\"\n" +
            "}";
}