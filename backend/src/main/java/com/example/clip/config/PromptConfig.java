package com.example.clip.config;

/**
 * Prompt配置
 * 用于配置整理今日内容与周报总结的系统提示词
 */
public class PromptConfig {

    private String clipAnalyzeSystemPrompt;
    private String dailyOrganizeSystemPrompt;
    private String weeklyReportSystemPrompt;

    public PromptConfig() {
    }

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
