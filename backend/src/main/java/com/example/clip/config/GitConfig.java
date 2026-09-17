package com.example.clip.config;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * Git 配置类（GitConfig）。
 * <p>
 * 存储 Git 版本控制相关的配置信息，用于将剪藏数据同步到 Git 仓库。
 * 包含远程仓库 URL、可选访问令牌和分支信息。
 * </p>
 *
 * <h3>认证策略（local-first）</h3>
 * <p>
 * 默认完全依赖本机 git 认证（SSH 密钥 / 凭据管理器 / 全局身份），不存放任何凭据。
 * {@code token} 为可选的访问令牌，仅当用户主动填写时拼进 HTTPS 远程地址作为兜底认证；
 * SSH 地址（{@code git@}）不会注入 token。token 属于敏感信息，运行时会随远程地址写入
 * 本地仓库的 {@code .git/config}，此为本地仓库可接受的范围。
 * </p>
 *
 * <h3>配置完整性校验</h3>
 * <p>
 * {@link #isComplete()} 方法仅校验 {@code remoteUrl} 和 {@code branch}，
 * 不校验 {@code token}，因为本机 git 认证场景无需令牌。
 * </p>
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class GitConfig {

    /** 远程仓库 URL，如 https://github.com/user/repo.git */
    private String remoteUrl;

    /** 可选的访问令牌（Personal Access Token），用于 HTTPS 认证兜底 */
    private String token;

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
     * @param token     可选的访问令牌（可为 null）
     * @param branch    分支名称
     */
    public GitConfig(String remoteUrl, String token, String branch) {
        this.remoteUrl = remoteUrl;
        this.token = token;
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
     * 获取访问令牌
     * @return 访问令牌
     */
    public String getToken() {
        return token;
    }

    /**
     * 设置访问令牌
     * @param token 访问令牌
     */
    public void setToken(String token) {
        this.token = token;
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
     * 仅校验远程仓库 URL 和分支名称是否已配置，不要求 token，
     * 因为系统可能使用本机 SSH 密钥 / 凭据认证方式。
     * </p>
     *
     * @return true 表示配置完整可执行 Git 操作，false 表示缺少必要配置
     */
    public boolean isComplete() {
        return remoteUrl != null && !remoteUrl.isEmpty() &&
               branch != null && !branch.isEmpty();
    }
}
