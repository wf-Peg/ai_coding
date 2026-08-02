package com.example.clip.core;

import com.fasterxml.jackson.annotation.JsonIgnore;

/**
 * 模型配置数据类（POJO）。
 * <p>
 * 存储用户在前端设置页面中选择的 LLM 模型提供者配置，
 * 包括当前激活的提供者、各提供者的 API Key 和模型名称。
 * 该配置由 {@link com.example.clip.service.ModelConfigService} 管理，
 * 支持运行时动态修改，无需重启应用即可切换模型。
 * </p>
 *
 * <h3>配置优先级</h3>
 * <p>
 * 对于 DashScope，用户在此配置的 API Key 和模型名称会覆盖
 * {@code application.yml} 中的默认配置。
 * 对于 DeepSeek，由于没有 yml 默认配置，必须在此处配置。
 * </p>
 *
 * <h3>JSON 序列化</h3>
 * <p>
 * 此类会被序列化为 JSON 返回给前端，也会从前端接收 JSON 反序列化。
 * {@code getActiveApiKey()} 和 {@code getActiveModel()} 方法标记了
 * {@code @JsonIgnore}，不会出现在序列化结果中，避免 API Key 泄露。
 * </p>
 */
public class ModelConfig {

    /** 当前激活的提供者标识："dashscope" 或 "deepseek"，默认为 dashscope */
    private String activeProvider = "dashscope";

    /** DeepSeek 的 API Key，由用户在设置页面配置 */
    private String deepseekApiKey = "";

    /** DeepSeek 使用的模型名称，默认为 deepseek-v4-flash */
    private String deepseekModel = "deepseek-v4-flash";

    /**
     * DashScope 的 API Key（可覆盖 application.yml 中的配置）。
     * 如果为空，则使用 yml 中的默认值。
     */
    private String dashscopeApiKey = "";

    /** DashScope 使用的模型名称，默认为 qwen-plus */
    private String dashscopeModel = "qwen-plus";

    // ===== 新增：自定义 OpenAI 兼容 Provider（中转站） =====

    /** 自定义中转站展示名称 */
    private String customProviderName = "";

    /** 自定义 API 地址，如 https://one-api.example.com/v1 */
    private String customBaseUrl = "";

    /** 自定义中转站 API Key */
    private String customApiKey = "";

    /** 自定义中转站模型名称 */
    private String customModel = "";

    /** 无参构造器，用于 JSON 反序列化 */
    public ModelConfig() {}

    // ==================== getters / setters ====================

    public String getActiveProvider() {
        return activeProvider;
    }

    public void setActiveProvider(String activeProvider) {
        this.activeProvider = activeProvider;
    }

    public String getDeepseekApiKey() {
        return deepseekApiKey;
    }

    public void setDeepseekApiKey(String deepseekApiKey) {
        this.deepseekApiKey = deepseekApiKey;
    }

    public String getDeepseekModel() {
        return deepseekModel;
    }

    public void setDeepseekModel(String deepseekModel) {
        this.deepseekModel = deepseekModel;
    }

    public String getDashscopeApiKey() {
        return dashscopeApiKey;
    }

    public void setDashscopeApiKey(String dashscopeApiKey) {
        this.dashscopeApiKey = dashscopeApiKey;
    }

    public String getDashscopeModel() {
        return dashscopeModel;
    }

    public void setDashscopeModel(String dashscopeModel) {
        this.dashscopeModel = dashscopeModel;
    }

    // ==================== custom getters / setters ====================

    public String getCustomProviderName() {
        return customProviderName;
    }

    public void setCustomProviderName(String customProviderName) {
        this.customProviderName = customProviderName;
    }

    public String getCustomBaseUrl() {
        return customBaseUrl;
    }

    public void setCustomBaseUrl(String customBaseUrl) {
        this.customBaseUrl = customBaseUrl;
    }

    public String getCustomApiKey() {
        return customApiKey;
    }

    public void setCustomApiKey(String customApiKey) {
        this.customApiKey = customApiKey;
    }

    public String getCustomModel() {
        return customModel;
    }

    public void setCustomModel(String customModel) {
        this.customModel = customModel;
    }

    // ==================== 便捷方法 ====================

    /**
     * 获取当前激活提供者的 API Key。
     * <p>
     * 根据 {@code activeProvider} 的值返回对应的 API Key。
     * 标记 {@code @JsonIgnore} 防止在 JSON 序列化时泄露 API Key。
     * </p>
     *
     * @return 当前激活提供者的 API Key，可能为空字符串
     */
    @JsonIgnore
    public String getActiveApiKey() {
        if ("custom".equals(activeProvider)) {
            return customApiKey;
        }
        if ("deepseek".equals(activeProvider)) {
            return deepseekApiKey;
        }
        // 默认返回 DashScope 的 API Key（包括 activeProvider 为 "dashscope" 或未知值的情况）
        return dashscopeApiKey;
    }

    /**
     * 获取当前激活提供者的模型名称。
     * <p>
     * 根据 {@code activeProvider} 的值返回对应的模型名称。
     * 标记 {@code @JsonIgnore} 以简化 JSON 序列化输出。
     * </p>
     *
     * @return 当前激活提供者的模型名称，如 "qwen-plus" 或 "deepseek-v4-flash"
     */
    @JsonIgnore
    public String getActiveModel() {
        if ("custom".equals(activeProvider)) {
            return customModel;
        }
        if ("deepseek".equals(activeProvider)) {
            return deepseekModel;
        }
        return dashscopeModel;
    }
}