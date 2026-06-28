package com.example.clip.service;

import com.example.clip.config.PromptConfig;
import org.springframework.stereotype.Service;

/**
 * Prompt 配置业务服务
 * <p>
 * 管理 AI 提示词（Prompt）的读取、保存和重置操作。
 * 维护三类提示词：
 * <ul>
 *   <li><b>剪藏分析提示词</b>（clipAnalyzeSystemPrompt）：用于剪藏内容的 AI 分析</li>
 *   <li><b>每日整理提示词</b>（dailyOrganizeSystemPrompt）：用于每日内容整理，支持 {{category}} 占位符</li>
 *   <li><b>周报生成提示词</b>（weeklyReportSystemPrompt）：用于周报的 AI 生成</li>
 * </ul>
 * 如果存储服务中没有配置，则使用内置的默认提示词。
 * 提供字段校验：非空 + 长度限制（30000 字符）。
 * </p>
 *
 * @see PromptConfigStorageService
 */
@Service
public class PromptConfigService {

    /** Prompt 最大长度限制，防止过大内容导致 AI API 调用失败 */
    private static final int MAX_PROMPT_LENGTH = 30000;

    /** 底层 Prompt 配置持久化服务 */
    private final PromptConfigStorageService storageService;

    public PromptConfigService(PromptConfigStorageService storageService) {
        this.storageService = storageService;
    }

    /**
     * 获取当前 Prompt 配置
     * <p>
     * 从存储服务加载配置，如果未配置则使用内置默认值。
     * 对每个字段做规范化处理：null 或空值使用默认值替换。
     * </p>
     *
     * @return 规范化后的 PromptConfig（保证所有字段非空）
     */
    public PromptConfig getPromptConfig() {
        PromptConfig loaded = storageService.loadConfig();
        if (loaded == null) {
            return getDefaultConfig();
        }

        // 规范化：如果用户配置了部分字段，缺失的字段使用默认值
        PromptConfig normalized = new PromptConfig();
        normalized.setClipAnalyzeSystemPrompt(normalizeOrDefault(
                loaded.getClipAnalyzeSystemPrompt(),
                DEFAULT_CLIP_ANALYZE_PROMPT
        ));
        normalized.setDailyOrganizeSystemPrompt(normalizeOrDefault(
                loaded.getDailyOrganizeSystemPrompt(),
                DEFAULT_DAILY_ORGANIZE_PROMPT
        ));
        normalized.setWeeklyReportSystemPrompt(normalizeOrDefault(
                loaded.getWeeklyReportSystemPrompt(),
                DEFAULT_WEEKLY_REPORT_PROMPT
        ));
        return normalized;
    }

    /**
     * 保存 Prompt 配置
     * <p>
     * 对输入进行规范化（空值使用已有配置的值），校验通过后持久化。
     * 采用"合并"而非"替换"策略：用户未填写的字段保留现有值。
     * </p>
     *
     * @param config 用户提交的配置（可能部分字段为空）
     * @return 保存后的规范化配置
     * @throws IllegalArgumentException 如果校验失败（字段为空或超长）
     */
    public PromptConfig savePromptConfig(PromptConfig config) {
        if (config == null) {
            throw new IllegalArgumentException("Prompt配置不能为空");
        }
        // 合并策略：用户未填写的字段使用现有配置值
        PromptConfig existing = getPromptConfig();
        PromptConfig normalized = new PromptConfig(
                normalizeOrDefault(config.getClipAnalyzeSystemPrompt(), existing.getClipAnalyzeSystemPrompt()),
                normalizeOrDefault(config.getDailyOrganizeSystemPrompt(), existing.getDailyOrganizeSystemPrompt()),
                normalizeOrDefault(config.getWeeklyReportSystemPrompt(), existing.getWeeklyReportSystemPrompt())
        );
        validate(normalized);
        storageService.saveConfig(normalized);
        return normalized;
    }

    /**
     * 重置为默认 Prompt 配置
     * <p>
     * 使用内置默认值覆盖所有字段，并持久化到存储。
     * </p>
     *
     * @return 默认配置
     */
    public PromptConfig resetToDefault() {
        PromptConfig defaultConfig = getDefaultConfig();
        storageService.saveConfig(defaultConfig);
        return defaultConfig;
    }

    /**
     * 渲染每日整理 Prompt（替换 {{category}} 占位符）
     * <p>
     * 将每日整理提示词中的 {{category}} 替换为实际分类名称。
     * 如果分类为空，则替换为"默认分类"。
     * </p>
     *
     * @param category 分类名称（用于替换占位符）
     * @return 渲染后的 Prompt 字符串
     */
    public String renderDailyPrompt(String category) {
        String prompt = getPromptConfig().getDailyOrganizeSystemPrompt();
        String safeCategory = (category == null || category.isBlank()) ? "默认分类" : category;
        return prompt.replace("{{category}}", safeCategory);
    }

    /**
     * 获取剪藏分析 Prompt
     *
     * @return 剪藏分析的提示词
     */
    public String getClipAnalyzePrompt() {
        return getPromptConfig().getClipAnalyzeSystemPrompt();
    }

    /**
     * 获取周报生成 Prompt
     *
     * @return 周报的提示词
     */
    public String getWeeklyReportPrompt() {
        return getPromptConfig().getWeeklyReportSystemPrompt();
    }

    /**
     * 规范化字段值：如果为空则使用默认值，否则 trim
     *
     * @param value        当前值
     * @param defaultValue 默认值
     * @return 规范化后的值
     */
    private String normalizeOrDefault(String value, String defaultValue) {
        if (value == null || value.trim().isEmpty()) {
            return defaultValue;
        }
        return value.trim();
    }

    /**
     * 获取内置默认配置
     */
    private PromptConfig getDefaultConfig() {
        return new PromptConfig(DEFAULT_CLIP_ANALYZE_PROMPT, DEFAULT_DAILY_ORGANIZE_PROMPT, DEFAULT_WEEKLY_REPORT_PROMPT);
    }

    /**
     * 校验配置合法性
     * <p>
     * 检查所有字段非空且不超过最大长度限制。
     * </p>
     *
     * @param config 待校验的配置
     * @throws IllegalArgumentException 如果校验失败
     */
    private void validate(PromptConfig config) {
        if (config == null) {
            throw new IllegalArgumentException("Prompt配置不能为空");
        }
        validateField("clipAnalyzeSystemPrompt", config.getClipAnalyzeSystemPrompt());
        validateField("dailyOrganizeSystemPrompt", config.getDailyOrganizeSystemPrompt());
        validateField("weeklyReportSystemPrompt", config.getWeeklyReportSystemPrompt());
    }

    /**
     * 校验单个字段
     *
     * @param fieldName 字段名（用于错误信息）
     * @param value     字段值
     * @throws IllegalArgumentException 如果值为空或超长
     */
    private void validateField(String fieldName, String value) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException(fieldName + " 不能为空");
        }
        if (value.length() > MAX_PROMPT_LENGTH) {
            throw new IllegalArgumentException(fieldName + " 长度不能超过 " + MAX_PROMPT_LENGTH);
        }
    }

    // ==================== 默认 Prompt 常量 ====================

    /**
     * 默认每日整理 Prompt
     * <p>
     * 以行业专家角色对输入内容进行关联性分析和整合，
     * 输出结构化的知识库日报。支持 {{category}} 占位符。
     * </p>
     */
    private static final String DEFAULT_DAILY_ORGANIZE_PROMPT =
            "# Role\n" +
            "你是一位拥有20年经验的**{{category}}**行业专家及知识管理顾问。你擅长从碎片化的文档中提取核心逻辑，构建高信噪比的知识库，并能结合专业视角进行深度复盘。\n" +
            "\n" +
            "# Goal\n" +
            "接收用户提供的原始文档列表（包含原文、摘要、AI分析、标签等）以及指定的专家角色，按照\u201C关联性整合\u201D与\u201C层级化分类\u201D的原则，输出一份结构严谨、逻辑清晰的【行业知识库日报】。\n" +
            "\n" +
            "# Workflow\n" +
            "1.  **关联性分析**：\n" +
            "    - 逐条审查输入内容，识别主题重叠、逻辑互补或观点冲突的段落。\n" +
            "    - 将内容划分为\u201C关联组\u201D（需合并）和\u201C独立项\u201D（需保留原貌）。\n" +
            "\n" +
            "2.  **内容整合与重构**：\n" +
            "    - **关联组处理**：\n" +
            "        - 标题：提炼一个涵盖所有相关内容的标题。\n" +
            "        - 原文：将所有相关原文按序号排序组合，保持原始风貌。\n" +
            "        - 分析：对原有的AI分析进行\u201C融合重写\u201D，去除重复信息，梳理逻辑层级，形成一条高密度的综合分析。\n" +
            "        - 标签：合并所有相关标签。\n" +
            "    - **独立项处理**：\n" +
            "        - 标题：使用原文的总结摘要。\n" +
            "        - 原文：纯文本展示。\n" +
            "        - 分析：保留原始AI分析结果，仅做格式微调。\n" +
            "\n" +
            "3.  **全局复盘**：\n" +
            "    - 站在行业专家的视角，对上述整理的所有内容进行跨学科、跨领域的系统性总结。\n" +
            "    - 寻找不同知识点之间的隐性联系（如：心理学与博弈论、宏观与微观，或该专业领域的特定关联）。\n" +
            "    - 输出高浓度的\u201C今日复盘\u201D，作为标题展示。\n" +
            "\n" +
            "# Output Format Rules\n" +
            "- **严格禁止**使用角色扮演式的开场白（如\u201C好的，我是专家...\u201D），直接输出日报内容。\n" +
            "- **标题层级规范**：\n" +
            "    - **一级标题**：`# {日期}日报` （全文仅一个）\n" +
            "    - **二级标题**：`{内容板块标题}` 或 `今日复盘`\n" +
            "    - **三级标题**：`原文` 、 `分析`\n" +
            "- **原文展示**：正常文本的原文。\n" +
            "- **分析展示**：使用 Markdown 列表和加粗，确保可读性。\n" +
            "- **元数据**：在二级标题下方使用引用格式展示分类与标签，标签使用 `标签: #标签名1 #标签名2 ...#标签N`的格式，如:【\n" +
            "> 分类：技术探索/前端渲染 \n" +
            "> 标签: #Markdown #CommonMark #中文排版 #AI输出优化】\n" +
            "- **Markdown格式清洗**：确保所有标题符号（#）前后没有多余的空格或重复符号，确保标题层级清晰，没有重叠或混乱。\n" +
            "\n" +
            "# Constraints\n" +
            "- 保持客观、理性的语调。\n" +
            "- 确保\u201C分析\u201D部分具有高信息密度，拒绝废话。\n" +
            "- 清洗格式错误（如多余的冒号、错误的换行、标题符号重叠）。";

    /**
     * 默认剪藏分析 Prompt
     * <p>
     * 要求 AI 生成准确、简洁、结构化的摘要、分析和标签。
     * </p>
     */
    private static final String DEFAULT_CLIP_ANALYZE_PROMPT =
            "你是一个专业的内容分析助手。请对输入内容生成高质量摘要、分析和标签。\n" +
            "输出应准确、简洁、结构化，避免空话和重复。\n" +
            "analysis 字段使用 Markdown 格式，重点提炼关键结论与可执行洞见。";

    /**
     * 默认周报生成 Prompt
     * <p>
     * 要求 AI 将内容拆分为独立知识点，使用 Obsidian 双链语法建立关联。
     * 输出 JSON 格式，包含主报告和知识点列表。
     * </p>
     */
    private static final String DEFAULT_WEEKLY_REPORT_PROMPT =
            "# Role\n" +
            "你是一位专业的知识管理专家，擅长将复杂内容拆分为独立的知识点，并使用Obsidian双链语法建立知识点之间的关联。\n" +
            "\n" +
            "# Goal\n" +
            "接收用户提供的原始内容，将其拆分为独立的知识点，每个知识点存储为一个单独的文件，同时在主报告中使用Obsidian双链语法[[知识点名称]]引用这些知识点。\n" +
            "\n" +
            "# Workflow\n" +
            "1. **内容分析**：\n" +
            "   - 仔细阅读原始内容，识别核心知识点\n" +
            "   - 每个知识点应该是一个相对独立、完整的概念或信息单元\n" +
            "\n" +
            "2. **知识点命名**：\n" +
            "   - 为每个知识点创建一个清晰、简洁的文件名（使用中文，避免特殊字符）\n" +
            "   - 文件名应该能够准确反映知识点的核心内容\n" +
            "\n" +
            "3. **双链引用**：\n" +
            "   - 在主报告中使用[[知识点文件名]]的格式引用每个知识点\n" +
            "   - 确保引用自然融入主报告的上下文\n" +
            "\n" +
            "4. **知识点内容**：\n" +
            "   - 每个知识点文件包含完整的相关内容\n" +
            "   - 可以包含标签、相关链接等元信息\n" +
            "   - 如果知识点之间有关联，也可以在知识点文件中互相引用\n" +
            "\n" +
            "# Output Format Rules\n" +
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
}package com.examplpackage com.example.clip.service;

import com.example.clip.config.PromptConfig;
import org.springframework.stereotype.Servicpackage com.example.clip.service;

import com.example.clip.config.PromptConfig;
import org.springframework.stereotype.Service;

/**
 * Prompt 配置业务服务。
 * <p>
 * 管理所有 AIpackage com.example.clip.service;

import com.example.clip.config.PromptConfig;
import org.springframework.stereotype.Service;

/**
 * Prompt 配置业务服务。
 * <p>
 * 管理所有 AI 提示词（Prompt）的读取、保存和重置操作。
 * 维护 10package com.example.clip.service;

import com.example.clip.config.PromptConfig;
import org.springframework.stereotype.Service;

/**
 * Prompt 配置业务服务。
 * <p>
 * 管理所有 AI 提示词（Prompt）的读取、保存和重置操作。
 * 维护 10 个 Prompt 字段（3 核心 + 1 任务格式 + 6 辅助package com.example.clip.service;

import com.example.clip.config.PromptConfig;
import org.springframework.stereotype.Service;

/**
 * Prompt 配置业务服务。
 * <p>
 * 管理所有 AI 提示词（Prompt）的读取、保存和重置操作。
 * 维护 10 个 Prompt 字段（3 核心 + 1 任务格式 + 6 辅助），
 * 全部支持用户通过前端弹窗自定义。
 * </p>
 *package com.example.clip.service;

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
 *   <lipackage com.example.clip.service;

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
 *   <li><b>核心</b>：clipAnalyze、dailyOrganize、weeklyReportpackage com.example.clip.service;

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
 *   <li><b>任务格式</b>：clipAnalyzeTaskFopackage com.example.clip.service;

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
 *   <li><bpackage com.example.clip.service;

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
 *   <li><b>辅助</b>：analyzeContent、generateSummary、generateTags、smartOrganizpackage com.example.clip.service;

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
 *package com.example.clip.service;

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
 *package com.example.clip.service;

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
 *   <li>{{dpackage com.example.clip.service;

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
 *   <li>{{category_tree}} — 分类package com.example.clip.service;

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
 *   <li>{{count}} — 条目数量</lipackage com.example.clip.service;

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
 * </ul>package com.example.clip.service;

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

    private static final int MAX_PROMPT_LENGTHpackage com.example.clip.service;

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

    public Pro