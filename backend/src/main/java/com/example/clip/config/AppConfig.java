package com.example.clip.config;

/**
 * 应用统一配置 POJO
 * <p>
 * 聚合所有应用级配置项（AI 模型、邮件、Git、存储路径等），
 * 通过统一的 {@code /api/config} REST API 进行读写。
 * 所有配置持久化到 {@code {clip.storage.path}/config/app-config.json} 文件中。
 * </p>
 *
 * <h3>设计说明</h3>
 * <ul>
 *   <li>全量提交：前端 PUT 时传递完整 JSON，后端全量替换</li>
 *   <li>向后兼容：保存时同步写入旧的 model-config.json 和 git-config.json</li>
 *   <li>存储路径：只配置一个根路径 storagePath，organizedPath 和 weeklyReportPath
 *       由代码自动派生为根路径同级目录下的 clip-organized/ 和 weekly-report/</li>
 * </ul>
 */
public class AppConfig {

    // ===== AI 模型配置 =====
    private String activeProvider = "dashscope";
    private String dashscopeApiKey = "";
    private String dashscopeModel = "qwen-plus";
    private String deepseekApiKey = "";
    private String deepseekModel = "deepseek-v4-flash";

    // ===== 自定义 OpenAI 兼容 Provider =====
    private String customProviderName = "";
    private String customBaseUrl = "";
    private String customApiKey = "";
    private String customModel = "";

    // ===== 邮件配置 =====
    private boolean mailEnabled = false;
    private String mailHost = "";
    private int mailPort = 465;
    private String mailUsername = "";
    private String mailPassword = "";

    // ===== Git 配置 =====
    private String gitRemoteUrl = "";
    private String gitUsername = "";
    private String gitPassword = "";
    private String gitBranch = "main";

    // ===== Exa 搜索配置 =====
    private String exaApiKey = "";
    private boolean exaEnabled = false;

    // ===== PDF OCR 配置 =====
    private String pdfOcrBaseUrl = "";
    private String pdfOcrApiKey = "";
    private boolean pdfOcrEnabled = true;
    private String pdfOcrModel = "qwen-vl-plus";
    private int pdfOcrMinTextLength = 15;

    // ===== 任务档位模型名 =====
    private String simpleTierModel = "deepseek-v4-flash";
    private String strongTierModel = "deepseek-v4-pro";

    // ===== 存储路径（可配置） =====
    private String storagePath = "";

    public AppConfig() {
    }

    // ===== AI 模型 =====

    public String getActiveProvider() {
        return activeProvider;
    }

    public void setActiveProvider(String activeProvider) {
        this.activeProvider = activeProvider;
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

    // ===== 自定义 OpenAI 兼容 Provider =====

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

    // ===== 邮件 =====

    public boolean isMailEnabled() {
        return mailEnabled;
    }

    public void setMailEnabled(boolean mailEnabled) {
        this.mailEnabled = mailEnabled;
    }

    public String getMailHost() {
        return mailHost;
    }

    public void setMailHost(String mailHost) {
        this.mailHost = mailHost;
    }

    public int getMailPort() {
        return mailPort;
    }

    public void setMailPort(int mailPort) {
        this.mailPort = mailPort;
    }

    public String getMailUsername() {
        return mailUsername;
    }

    public void setMailUsername(String mailUsername) {
        this.mailUsername = mailUsername;
    }

    public String getMailPassword() {
        return mailPassword;
    }

    public void setMailPassword(String mailPassword) {
        this.mailPassword = mailPassword;
    }

    // ===== Git =====

    public String getGitRemoteUrl() {
        return gitRemoteUrl;
    }

    public void setGitRemoteUrl(String gitRemoteUrl) {
        this.gitRemoteUrl = gitRemoteUrl;
    }

    public String getGitUsername() {
        return gitUsername;
    }

    public void setGitUsername(String gitUsername) {
        this.gitUsername = gitUsername;
    }

    public String getGitPassword() {
        return gitPassword;
    }

    public void setGitPassword(String gitPassword) {
        this.gitPassword = gitPassword;
    }

    public String getGitBranch() {
        return gitBranch;
    }

    public void setGitBranch(String gitBranch) {
        this.gitBranch = gitBranch;
    }

    // ===== Exa 搜索 =====

    public String getExaApiKey() {
        return exaApiKey;
    }

    public void setExaApiKey(String exaApiKey) {
        this.exaApiKey = exaApiKey;
    }

    public boolean isExaEnabled() {
        return exaEnabled;
    }

    public void setExaEnabled(boolean exaEnabled) {
        this.exaEnabled = exaEnabled;
    }

    // ===== PDF OCR =====

    public String getPdfOcrBaseUrl() {
        return pdfOcrBaseUrl;
    }

    public void setPdfOcrBaseUrl(String pdfOcrBaseUrl) {
        this.pdfOcrBaseUrl = pdfOcrBaseUrl;
    }

    public String getPdfOcrApiKey() {
        return pdfOcrApiKey;
    }

    public void setPdfOcrApiKey(String pdfOcrApiKey) {
        this.pdfOcrApiKey = pdfOcrApiKey;
    }

    public boolean isPdfOcrEnabled() {
        return pdfOcrEnabled;
    }

    public void setPdfOcrEnabled(boolean pdfOcrEnabled) {
        this.pdfOcrEnabled = pdfOcrEnabled;
    }

    public String getPdfOcrModel() {
        return pdfOcrModel;
    }

    public void setPdfOcrModel(String pdfOcrModel) {
        this.pdfOcrModel = pdfOcrModel;
    }

    public int getPdfOcrMinTextLength() {
        return pdfOcrMinTextLength;
    }

    public void setPdfOcrMinTextLength(int pdfOcrMinTextLength) {
        this.pdfOcrMinTextLength = pdfOcrMinTextLength;
    }

    // ===== 任务档位模型名 =====

    public String getSimpleTierModel() {
        return simpleTierModel;
    }

    public void setSimpleTierModel(String simpleTierModel) {
        this.simpleTierModel = simpleTierModel;
    }

    public String getStrongTierModel() {
        return strongTierModel;
    }

    public void setStrongTierModel(String strongTierModel) {
        this.strongTierModel = strongTierModel;
    }

    // ===== 存储路径 =====

    public String getStoragePath() {
        return storagePath;
    }

    public void setStoragePath(String storagePath) {
        this.storagePath = storagePath;
    }
}