package com.example.clip.config;

/**
 * Git配置类
 * 存储Git相关的配置信息
 */
public class GitConfig {
    private String remoteUrl;  // 远程仓库URL
    private String username;  // Git用户名
    private String password;  // Git密码
    private String branch;  // 分支名称

    /**
     * 无参构造函数
     */
    public GitConfig() {
    }

    /**
     * 构造函数
     * @param remoteUrl 远程仓库URL
     * @param username Git用户名
     * @param password Git密码
     * @param branch 分支名称
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
     * 检查配置是否完整
     * @return 是否完整
     */
    public boolean isComplete() {
        return remoteUrl != null && !remoteUrl.isEmpty() &&
               branch != null && !branch.isEmpty();
    }
}
