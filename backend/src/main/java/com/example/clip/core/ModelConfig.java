package com.example.clip.core;

import com.fasterxml.jackson.annotation.JsonIgnore;

/**
 * 模型配置数据类
 * 存储用户选择的模型提供者及对应的 API Key 和模型名称
 */
public class ModelConfig {

    /** 当前激活的提供者："dashscope" 或 "deepseek" */
    private String activeProvider = "dashscope";

    /** DeepSeek API Key */
    private String deepseekApiKey = "";

    /** DeepSeek 模型名称 */
    private String deepseekModel = "deepseek-chat";

    /** DashScope API Key（可覆盖 yml 配置） */
    private String dashscopeApiKey = "";

    /** DashScope 模型名称 */
    private String dashscopeModel = "qwen-plus";

    public ModelConfig() {}

    // ---- getters / setters ----

    public String getActiveProvider() { return activeProvider; }
    public void setActiveProvider(String activeProvider) { this.activeProvider = activeProvider; }

    public String getDeepseekApiKey() { return deepseekApiKey; }
    public void setDeepseekApiKey(String deepseekApiKey) { this.deepseekApiKey = deepseekApiKey; }

    public String getDeepseekModel() { return deepseekModel; }
    public void setDeepseekModel(String deepseekModel) { this.deepseekModel = deepseekModel; }

    public String getDashscopeApiKey() { return dashscopeApiKey; }
    public void setDashscopeApiKey(String dashscopeApiKey) { this.dashscopeApiKey = dashscopeApiKey; }

    public String getDashscopeModel() { return dashscopeModel; }
    public void setDashscopeModel(String dashscopeModel) { this.dashscopeModel = dashscopeModel; }

    /**
     * 获取当前激活提供者的 API Key
     */
    @JsonIgnore
    public String getActiveApiKey() {
        if ("deepseek".equals(activeProvider)) {
            return deepseekApiKey;
        }
        return dashscopeApiKey;
    }

    /**
     * 获取当前激活提供者的模型名称
     */
    @JsonIgnore
    public String getActiveModel() {
        if ("deepseek".equals(activeProvider)) {
            return deepseekModel;
        }
        return dashscopeModel;
    }
}