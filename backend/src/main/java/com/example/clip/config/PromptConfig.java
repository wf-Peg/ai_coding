package com.example.clip.config;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Prompt 配置（PromptConfig）。
 * <p>
 * 用于集中管理 AI 交互中使用的系统提示词（System Prompt）。
 * 包含三类字段：
 * </p>
 * <ul>
 *   <li><b>核心 Prompt</b>（3 个）：clipAnalyze、dailyOrganize、weeklyReport</li>
 *   <li><b>任务格式 Prompt</b>（1 个）：clipAnalyzeTaskFormat，管理剪藏分析的任务描述+JSON格式+分类树</li>
 *   <li><b>辅助 Prompt</b>（6 个）：analyzeContent、generateSummary、generateTags、smartOrganize、generateSynonyms、divergentSummaryRoleMap</li>
 * </ul>
 *
 * <p>
 * 所有 Prompt 均支持用户通过前端弹窗自定义，并通过 {@link com.example.clip.service.PromptConfigService} 统一管理。
 * </p>
 */
public class PromptConfig {

    // ==================== 核心 Prompt（3 个） ====================

    /** 单条剪藏分析的系统提示词 — 角色定义部分，不含任务格式 */
    private String clipAnalyzeSystemPrompt;

    /** 每日批量整理的系统提示词，支持 {{category}}、{{date}} 占位符 */
    private String dailyOrganizeSystemPrompt;

    /** 周报生成的系统提示词 */
    private String weeklyReportSystemPrompt;

    // ==================== 任务格式 Prompt（1 个） ====================

    /**
     * 剪藏分析的任务格式模版。
     * <p>
     * 在 processClipContent() 中拼接在 clipAnalyzeSystemPrompt 之后，
     * 定义 AI 需要完成的任务、JSON 输出格式、分类树等硬性约束。
     * 支持 {{category_tree}} 占位符，运行时替换为实际分类树。
     * </p>
     */
    private String clipAnalyzeTaskFormat;

    // ==================== 辅助 Prompt（6 个） ====================

    /** 深度内容分析的提示词 */
    private String analyzeContentPrompt;

    /** 摘要生成的提示词 */
    private String generateSummaryPrompt;

    /** 标签提取的提示词 */
    private String generateTagsPrompt;
    /** DSH 会话成果自动归档（牛马记录）：把一轮会话提炼为产品概览迭代记录的四字段 */
    private String dshSessionArchivePrompt;

    /** 智能分类+标签的提示词 */
    private String smartOrganizePrompt;

    /** 搜索同义词生成的提示词 */
    private String generateSynonymsPrompt;

    /**
     * 发散性总结的角色映射，JSON 格式。
     * <p>
     * key 为 category 前缀（如 "work"、"study"），value 为角色描述。
     * 例：{"work": "你是一位职场专家，擅长分析职业发展和工作效率。", ...}
     * </p>
     */
    private String divergentSummaryRoleMap;

    // ==================== Wiki Prompt（7 个） ====================

    /** Wiki 批量实体/概念抽取 Prompt — 一次调用抽取多个源 */
    private String wikiBatchExtractPrompt;

    /** Wiki 实体页面生成/更新 Prompt */
    private String wikiGenerateEntityPagePrompt;

    /** Wiki 概念页面生成/更新 Prompt */
    private String wikiGenerateConceptPagePrompt;

    /** Wiki 源页面生成 Prompt */
    private String wikiGenerateSourcePagePrompt;

    /** Wiki 矛盾检测 Prompt */
    private String wikiDetectContradictionPrompt;

    /** Wiki 查询索引路由 Prompt（用于 WikiQueryService） */
    private String wikiQueryIndexPrompt;

    /** Wiki 查询答案综合 Prompt（用于 WikiQueryService） */
    private String wikiQuerySynthesisPrompt;

    /** Wiki 按需 Lint Prompt — 检测矛盾/过时/孤儿页/缺失页/缺失交叉引用 */
    private String wikiLintPrompt;

    // ==================== 构造函数 ====================

    public PromptConfig() {
    }

    /** 核心 Prompt 全参构造 */
    public PromptConfig(String clipAnalyzeSystemPrompt, String dailyOrganizeSystemPrompt, String weeklyReportSystemPrompt) {
        this.clipAnalyzeSystemPrompt = clipAnalyzeSystemPrompt;
        this.dailyOrganizeSystemPrompt = dailyOrganizeSystemPrompt;
        this.weeklyReportSystemPrompt = weeklyReportSystemPrompt;
    }

    // ==================== 核心 Prompt Getter/Setter ====================

    public String getClipAnalyzeSystemPrompt() { return clipAnalyzeSystemPrompt; }
    public void setClipAnalyzeSystemPrompt(String v) { this.clipAnalyzeSystemPrompt = v; }

    public String getDailyOrganizeSystemPrompt() { return dailyOrganizeSystemPrompt; }
    public void setDailyOrganizeSystemPrompt(String v) { this.dailyOrganizeSystemPrompt = v; }

    public String getWeeklyReportSystemPrompt() { return weeklyReportSystemPrompt; }
    public void setWeeklyReportSystemPrompt(String v) { this.weeklyReportSystemPrompt = v; }

    // ==================== 任务格式 Getter/Setter ====================

    public String getClipAnalyzeTaskFormat() { return clipAnalyzeTaskFormat; }
    public void setClipAnalyzeTaskFormat(String v) { this.clipAnalyzeTaskFormat = v; }

    // ==================== 辅助 Prompt Getter/Setter ====================

    public String getAnalyzeContentPrompt() { return analyzeContentPrompt; }
    public void setAnalyzeContentPrompt(String v) { this.analyzeContentPrompt = v; }

    public String getGenerateSummaryPrompt() { return generateSummaryPrompt; }
    public void setGenerateSummaryPrompt(String v) { this.generateSummaryPrompt = v; }

    public String getGenerateTagsPrompt() { return generateTagsPrompt; }
    public void setGenerateTagsPrompt(String v) { this.generateTagsPrompt = v; }
    public String getDshSessionArchivePrompt() { return dshSessionArchivePrompt; }
    public void setDshSessionArchivePrompt(String v) { this.dshSessionArchivePrompt = v; }

    public String getSmartOrganizePrompt() { return smartOrganizePrompt; }
    public void setSmartOrganizePrompt(String v) { this.smartOrganizePrompt = v; }

    public String getGenerateSynonymsPrompt() { return generateSynonymsPrompt; }
    public void setGenerateSynonymsPrompt(String v) { this.generateSynonymsPrompt = v; }

    public String getDivergentSummaryRoleMap() { return divergentSummaryRoleMap; }
    public void setDivergentSummaryRoleMap(String v) { this.divergentSummaryRoleMap = v; }

    // ==================== Wiki Prompt Getter/Setter ====================

    public String getWikiBatchExtractPrompt() { return wikiBatchExtractPrompt; }
    public void setWikiBatchExtractPrompt(String v) { this.wikiBatchExtractPrompt = v; }

    public String getWikiGenerateEntityPagePrompt() { return wikiGenerateEntityPagePrompt; }
    public void setWikiGenerateEntityPagePrompt(String v) { this.wikiGenerateEntityPagePrompt = v; }

    public String getWikiGenerateConceptPagePrompt() { return wikiGenerateConceptPagePrompt; }
    public void setWikiGenerateConceptPagePrompt(String v) { this.wikiGenerateConceptPagePrompt = v; }

    public String getWikiGenerateSourcePagePrompt() { return wikiGenerateSourcePagePrompt; }
    public void setWikiGenerateSourcePagePrompt(String v) { this.wikiGenerateSourcePagePrompt = v; }

    public String getWikiDetectContradictionPrompt() { return wikiDetectContradictionPrompt; }
    public void setWikiDetectContradictionPrompt(String v) { this.wikiDetectContradictionPrompt = v; }

    public String getWikiQueryIndexPrompt() { return wikiQueryIndexPrompt; }
    public void setWikiQueryIndexPrompt(String v) { this.wikiQueryIndexPrompt = v; }

    public String getWikiQuerySynthesisPrompt() { return wikiQuerySynthesisPrompt; }
    public void setWikiQuerySynthesisPrompt(String v) { this.wikiQuerySynthesisPrompt = v; }

    public String getWikiLintPrompt() { return wikiLintPrompt; }
    public void setWikiLintPrompt(String v) { this.wikiLintPrompt = v; }
}