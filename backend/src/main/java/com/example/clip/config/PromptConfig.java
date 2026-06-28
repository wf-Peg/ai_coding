package com.example.clip.config;

/**
 * Prompt 配置（PromptConfig）。
 * <p>
 * 用于集中管理 AI 交互中使用的系统提示词（System Prompt）。
 * 包含三个场景的提示词配置：
 * </p>
 * <ul>
 *   <li><b>clipAnalyzeSystemPrompt</b>：单条剪藏分析提示词，
 *       用于 AI 对剪藏内容进行摘要、分类和标签提取</li>
 *   <li><b>dailyOrganizeSystemPrompt</b>：每日整理提示词，
 *       用于 AI 批量整理收件箱中的剪藏</li>
 *   <li><b>weeklyReportSystemPrompt</b>：周报生成提示词，
 *       用于 AI 根据一周剪藏生成工作总结</li>
 * </ul>
 *
 * <p>
 * 提示词的实际内容从外部配置文件（如 application.yml）注入，
 * 支持热更新而无需修改代码。
 * </p>
 */
public class PromptConfig {

    /** 单条剪藏分析的系统提示词 */
    private String clipAnalyzeSystemPrompt;

    /** 每日批量整理的系统提示词 */
    private String dailyOrganizeSystemPrompt;

    /** 周报生成的系统提示词 */
    private String weeklyReportSystemPrompt;

    /**
     * 无参构造函数，用于 Spring 等框架的反序列化。
     */
    public PromptConfig() {
    }

    /**
     * 全参构造函数，用于快速创建 PromptConfig 实例。
     *
     * @param clipAnalyzeSystemPrompt    单条剪藏分析提示词
     * @param dailyOrganizeSystemPrompt  每日整理提示词
     * @param weeklyReportSystemPrompt   周报生成提示词
     */
    public PromptConfig(String clipAnalyzeSystemPrompt, String dailyOrganizeSystemPrompt, String weeklyReportSystemPrompt) {
        this.clipAnalyzeSystemPrompt = clipAnalyzeSystemPrompt;
        this.dailyOrganizeSystemPrompt = dailyOrganizeSystemPrompt;
        this.weeklyReportSystemPrompt = weeklyReportSystemPrompt;
    }

    public String getClipAnalyzeSystemPrompt() {
        return clipAnalyzeSystemPrompt;
    }

    public void setClipAnalyzeSystemPrompt(String clipAnalyzeSystemPrompt) {
        this.clipAnalyzeSystemPrompt = clipAnalyzeSystemPrompt;
    }

    public String getDailyOrganizeSystemPrompt() {
        return dailyOrganizeSystemPrompt;
    }

    public void setDailyOrganizeSystemPrompt(String dailyOrganizeSystemPrompt) {
        this.dailyOrganizeSystemPrompt = dailyOrganizeSystemPrompt;
    }

    public String getWeeklyReportSystemPrompt() {
        return weeklyReportSystemPrompt;
    }

    public void setWeeklyReportSystemPrompt(String weeklyReportSystemPrompt) {
        this.weeklyReportSystemPrompt = weeklyReportSystemPrompt;
    }
}
