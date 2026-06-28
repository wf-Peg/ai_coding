package com.example.clip.config;

/**
 * Git 配置类（GitConfig）。
 * <p>
 * 存储 Git 版本控制相关的配置信息，用于将剪藏数据同步到 Git 仓库。
 * 包含远程仓库 URL、认证凭据和分支信息。
 * </p>
 *
 * <h3>安全提醒</h3>
 * <p>
 * {@code password} 字段存储的是 Git 访问令牌或密码，属于敏感信息。
 * 实际使用时建议通过环境变量或加密配置注入，避免明文写入配置文件。
 * </p>
 *
 * <h3>配置完整性校验</h3>
 * <p>
 * {@link #isComplete()} 方法仅校验 {@code remoteUrl} 和 {@code branch}，
 * 不校验用户名和密码，因为某些场景下可能使用 SSH 密钥认证无需密码。
 * </p>
 */
public class GitConfig {

    /** 远程仓库 URL，如 https://github.com/user/repo.git */
    private String remoteUrl;

    /** Git 用户名，用于 HTTPS 认证 */
    private String username;

    /** Git 密码或访问令牌（Personal Access Token），用于 HTTPS 认证 */
    private String password;

    /** 分支名称，如 "main"、"master" */
    private String branch;

    /**
     * 无参构造函数，用于 Spring 等框架的反序列化。
     */
    public GitConfig() {
    }

    /**
     * 全参构造函数。
     *
     * @param remoteUrl 远程仓库 URL
     * @param username  Git 用户名
     * @param password  Git 密码或访问令牌
     * @param branch    分支名称
     */
    public GitConfig(String remoteUrl, String username, String password, String branch) {
        this.remoteUrl = remoteUrl;
        this.username = username;
        this.password = password;
        this.branch = branch;
    }

    /**
     * 获取远程仓库URL
     * @return 远程仓库URL
     */
    public String getRemoteUrl() {
        return remoteUrl;
    }

    /**
     * 设置远程仓库URL
     * @param remoteUrl 远程仓库URL
     */
    public void setRemoteUrl(String remoteUrl) {
        this.remoteUrl = remoteUrl;
    }

    /**
     * 获取Git用户名
     * @return Git用户名
     */
    public String getUsername() {
        return username;
    }

    /**
     * 设置Git用户名
     * @param username Git用户名
     */
    public void setUsername(String username) {
        this.username = username;
    }

    /**
     * 获取Git密码
     * @return Git密码
     */
    public String getPassword() {
        return password;
    }

    /**
     * 设置Git密码
     * @param password Git密码
     */
    public void setPassword(String password) {
        this.password = password;
    }

    /**
     * 获取分支名称
     * @return 分支名称
     */
    public String getBranch() {
        return branch;
    }

    /**
     * 设置分支名称
     * @param branch 分支名称
     */
    public void setBranch(String branch) {
        this.branch = branch;
    }

    /**
     * 检查 Git 配置是否满足基本操作要求。
     * <p>
     * 仅校验远程仓库 URL 和分支名称是否已配置，不要求用户名和密码，
     * 因为系统可能使用 SSH 密钥认证方式。
     * </p>
     *
     * @return true 表示配置完整可执行 Git 操作，false 表示缺少必要配置
     */
    public boolean isComplete() {
        return remoteUrl != null && !remoteUrl.isEmpty() &&
               branch != null && !branch.isEmpty();
    }
}
