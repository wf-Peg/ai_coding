package com.example.clip.service;

import com.example.clip.config.GitConfig;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.locks.ReentrantLock;

/**
 * Git 操作服务
 * <p>
 * 负责 Git 仓库的自动化操作，包括：
 * <ul>
 *   <li>远程仓库配置（remote add/set-url）</li>
 *   <li>用户配置（user.name/user.email）</li>
 *   <li>分支跟踪设置</li>
 *   <li>自动 Pull → Add → Commit → Push 流程</li>
 *   <li>异步 Push/Pull 操作</li>
 *   <li>Git 连接测试</li>
 * </ul>
 * 使用 {@link ReentrantLock} 保证 Git 操作的互斥性，避免并发操作导致仓库状态不一致。
 * 所有 Git 命令通过 {@link ProcessBuilder} 执行，输出通过日志记录。
 * </p>
 *
 * @see GitConfig
 * @see GitConfigStorageService
 */
@Service
public class GitService {

    private static final Logger log = LoggerFactory.getLogger(GitService.class);
    /** Push 操作状态（idle/processing/completed/error） */
    private String pushStatus = "idle";
    /** Push 操作消息 */
    private String pushMessage = "";
    /** Pull 操作状态 */
    private String pullStatus = "idle";
    /** Pull 操作消息 */
    private String pullMessage = "";
    /** Git 配置对象 */
    private GitConfig gitConfig;

    /** Git 配置持久化服务 */
    private final GitConfigStorageService configStorageService;
    /** 可重入锁，保证 Git 操作互斥执行 */
    private final ReentrantLock gitLock = new ReentrantLock();

    public GitService(GitConfigStorageService configStorageService) {
        this.configStorageService = configStorageService;
    }

    /**
     * 初始化时加载 Git 配置
     * <p>
     * 使用 {@link PostConstruct} 确保依赖注入完成后自动执行。
     * </p>
     */
    @PostConstruct
    public void init() {
        // 初始化时从持久化存储加载配置
        this.gitConfig = configStorageService.loadConfig();
        if (gitConfig != null) {
            log.info("Git config loaded on startup");
        }
    }

    /**
     * 执行完整的 Git 操作流程
     * <p>
     * 流程：配置远程仓库 → fetch → pull → add → commit → push。
     * 使用锁保证互斥执行。如果配置完整则执行完整的远程操作，
     * 否则仅执行本地操作（add/commit）。
     * 所有 Git 命令失败只记录日志，不抛出异常，确保不影响主流程。
     * </p>
     *
     * @param directory 要执行 Git 操作的目录
     */
    public void executeGitOperations(Path directory) {
        gitLock.lock();
        try {
            if (directory == null || !directory.toFile().exists()) {
                log.error("Git operation failed: directory does not exist: {}", directory);
                return;
            }

            log.info("Executing git operations in directory: {}", directory);

            // 检查并配置远程仓库（仅当配置完整时）
            if (gitConfig != null && gitConfig.isComplete()) {
                configureRemoteRepository(directory);
            } else {
                log.warn("Git config not complete, skipping remote configuration");
            }

            // 先执行 git fetch 获取远程最新状态
            executeGitCommandSafe(directory, "git", "fetch", "origin");

            // 执行 git pull（指定 remote 和 branch）
            if (gitConfig != null && gitConfig.isComplete()) {
                executeGitCommandSafe(directory, "git", "pull", "origin", gitConfig.getBranch());
            } else {
                executeGitCommandSafe(directory, "git", "pull");
            }

            // 暂存所有变更
            executeGitCommandSafe(directory, "git", "add", ".");

            // 检查是否有暂存的变更，有变更才 commit
            boolean hasChanges = hasStagedChanges(directory);
            if (hasChanges) {
                // 提交变更
                executeGitCommandSafe(directory, "git", "commit", "-m", "Auto commit: content organize or weekly report");

                // 只有成功 commit 后才 push
                if (gitConfig != null && gitConfig.isComplete()) {
                    executeGitCommandSafe(directory, "git", "push", "--set-upstream", "origin", gitConfig.getBranch());
                } else {
                    executeGitCommandSafe(directory, "git", "push");
                }
            } else {
                log.info("No staged changes, skipping commit and push");
            }

            log.info("Git operations completed successfully");
        } catch (Exception e) {
            // 只打日志，不影响主流程
            log.error("Git operation failed: {}", e.getMessage());
        } finally {
            gitLock.unlock();
        }
    }

    /**
     * 检查是否有暂存的变更
     * <p>
     * 使用 git diff --cached --quiet 命令检查：
     * 退出码 0 表示无变更，非 0 表示有变更。
     * 如果检查过程出错，默认返回 true（有变更），避免遗漏需要提交的内容。
     * </p>
     *
     * @param directory Git 仓库目录
     * @return true 表示有暂存的变更，false 表示无变更
     */
    private boolean hasStagedChanges(Path directory) {
        try {
            ProcessBuilder processBuilder = new ProcessBuilder("git", "diff", "--cached", "--quiet");
            processBuilder.directory(directory.toFile());
            processBuilder.redirectErrorStream(true);

            Process process = processBuilder.start();
            int exitCode = process.waitFor();

            // 退出码为 0 表示没有更改，非 0 表示有更改
            return exitCode != 0;
        } catch (Exception e) {
            log.warn("Error checking staged changes: {}", e.getMessage());
            // 默认为有更改，避免跳过需要提交的内容（保守策略）
            return true;
        }
    }

    /**
     * 安全执行 Git 命令（出错只记录日志，不抛出异常）
     * <p>
     * 包装 {@link #executeGitCommand}，将异常转为日志警告。
     * 用于 Git 操作流程中不重要的步骤（如 fetch 失败不应阻止后续操作）。
     * </p>
     *
     * @param directory 执行目录
     * @param command   命令及参数
     */
    private void executeGitCommandSafe(Path directory, String... command) {
        try {
            executeGitCommand(directory, command);
        } catch (Exception e) {
            log.warn("Git command failed: {} - {}", String.join(" ", command), e.getMessage());
        }
    }

    /**
     * 配置远程仓库
     * <p>
     * 设置 Git 用户信息、检查/添加/更新远程仓库 URL、设置分支跟踪。
     * 如果用户名的格式是邮箱格式，则同时作为 user.email 使用。
     * </p>
     *
     * @param directory 要配置的 Git 仓库目录
     */
    private void configureRemoteRepository(Path directory) {
        try {
            // 设置 git 用户配置
            if (gitConfig.getUsername() != null && !gitConfig.getUsername().isEmpty()) {
                executeGitCommandSafe(directory, "git", "config", "user.name", gitConfig.getUsername());
                // 如果用户名是邮箱格式，同时设置为 user.email
                if (gitConfig.getUsername().contains("@")) {
                    executeGitCommandSafe(directory, "git", "config", "user.email", gitConfig.getUsername());
                }
            }

            // 检查远程仓库是否已配置
            if (!checkRemoteConfig(directory)) {
                // 添加远程仓库
                executeGitCommand(directory, "git", "remote", "add", "origin", gitConfig.getRemoteUrl());
                log.info("Added remote repository: {}", gitConfig.getRemoteUrl());
            } else {
                // 检查 URL 是否一致，不一致则更新
                String currentUrl = getRemoteUrl(directory);
                if (!gitConfig.getRemoteUrl().equals(currentUrl)) {
                    log.info("Updating remote URL from {} to {}", currentUrl, gitConfig.getRemoteUrl());
                    executeGitCommand(directory, "git", "remote", "set-url", "origin", gitConfig.getRemoteUrl());
                }
            }

            // 先 fetch 确保远程分支存在
            executeGitCommandSafe(directory, "git", "fetch", "origin");

            // 设置分支跟踪
            try {
                executeGitCommand(directory, "git", "branch", "--set-upstream-to=origin/" + gitConfig.getBranch(), gitConfig.getBranch());
                log.info("Set upstream branch to origin/{}", gitConfig.getBranch());
            } catch (Exception e) {
                log.warn("Failed to set upstream branch: {}", e.getMessage());
                log.info("Branch will be set upstream on first push");
            }
        } catch (Exception e) {
            log.error("Error configuring remote repository: {}", e.getMessage());
        }
    }

    /**
     * 获取当前 remote origin 的 URL
     *
     * @param directory Git 仓库目录
     * @return remote URL 字符串；若失败返回空字符串
     */
    private String getRemoteUrl(Path directory) {
        try {
            ProcessBuilder processBuilder = new ProcessBuilder("git", "remote", "get-url", "origin");
            processBuilder.directory(directory.toFile());
            processBuilder.redirectErrorStream(true);

            Process process = processBuilder.start();
            int exitCode = process.waitFor();

            // 读取命令输出
            try (InputStream inputStream = process.getInputStream();
                 BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream))) {
                String line;
                StringBuilder url = new StringBuilder();
                while ((line = reader.readLine()) != null) {
                    url.append(line.trim());
                }
                return url.toString();
            }
        } catch (Exception e) {
            log.error("Error getting remote URL: {}", e.getMessage());
            return "";
        }
    }

    /**
     * 检查远程仓库是否已配置
     * <p>
     * 执行 git remote -v 命令，检查输出中是否包含 origin 的 push 或 fetch 行。
     * </p>
     *
     * @param directory 要检查的目录
     * @return true 表示已配置远程仓库，false 表示未配置
     */
    private boolean checkRemoteConfig(Path directory) {
        try {
            ProcessBuilder processBuilder = new ProcessBuilder("git", "remote", "-v");
            processBuilder.directory(directory.toFile());
            processBuilder.redirectErrorStream(true);

            Process process = processBuilder.start();
            int exitCode = process.waitFor();

            // 读取输出，检查是否有 origin 相关行
            try (InputStream inputStream = process.getInputStream();
                 BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream))) {
                String line;
                boolean hasRemote = false;
                while ((line = reader.readLine()) != null) {
                    if (line.contains("origin") && (line.contains("push") || line.contains("fetch"))) {
                        hasRemote = true;
                        break;
                    }
                }
                return hasRemote;
            }
        } catch (Exception e) {
            log.error("Error checking remote config: {}", e.getMessage());
            return false;
        }
    }

    /**
     * 获取 Git 配置
     *
     * @return Git 配置对象
     */
    public GitConfig getGitConfig() {
        return gitConfig;
    }

    /**
     * 设置 Git 配置并持久化
     *
     * @param gitConfig Git 配置对象
     */
    public void setGitConfig(GitConfig gitConfig) {
        this.gitConfig = gitConfig;
        // 持久化保存配置到文件
        configStorageService.saveConfig(gitConfig);
        log.info("Git config updated and saved");
    }

    /**
     * 测试 Git 连接
     * <p>
     * 配置远程仓库后执行 fetch 测试连通性。
     * 使用锁保证线程安全。
     * </p>
     *
     * @param directory 测试目录
     * @return 测试结果字符串
     */
    public String testGitConnection(Path directory) {
        if (gitConfig == null || !gitConfig.isComplete()) {
            return "Git configuration is not complete";
        }

        gitLock.lock();
        try {
            // 配置远程仓库
            configureRemoteRepository(directory);

            // 测试 fetch 连通性
            executeGitCommand(directory, "git", "fetch", "origin");

            return "Git connection test successful";
        } catch (Exception e) {
            log.error("Git connection test failed: {}", e.getMessage());
            return "Git connection test failed: " + e.getMessage();
        } finally {
            gitLock.unlock();
        }
    }

    /**
     * 异步执行 git push 操作
     * <p>
     * 使用 {@link CompletableFuture} 在独立线程中执行，不阻塞调用方。
     * 执行过程中更新 pushStatus 和 pushMessage 状态。
     * </p>
     *
     * @return CompletableFuture，完成时返回 "success" 或 "error"
     */
    public CompletableFuture<String> pushAsync() {
        return CompletableFuture.supplyAsync(() -> {
            try {
                pushStatus = "processing";
                pushMessage = "正在执行git push操作...";

                // 使用当前工作目录作为 Git 目录
                Path directory = Paths.get(".").toAbsolutePath();
                if (gitConfig != null && gitConfig.isComplete()) {
                    executeGitCommand(directory, "git", "push", "--set-upstream", "origin", gitConfig.getBranch());
                } else {
                    executeGitCommand(directory, "git", "push");
                }

                pushStatus = "completed";
                pushMessage = "Git push操作成功";
                return "success";
            } catch (Exception e) {
                pushStatus = "error";
                pushMessage = "Git push操作失败: " + e.getMessage();
                log.error("Git push failed: {}", e.getMessage());
                return "error";
            }
        });
    }

    /**
     * 异步执行 git pull 操作
     * <p>
     * 使用 {@link CompletableFuture} 在独立线程中执行。
     * </p>
     *
     * @return CompletableFuture，完成时返回 "success" 或 "error"
     */
    public CompletableFuture<String> pullAsync() {
        return CompletableFuture.supplyAsync(() -> {
            try {
                pullStatus = "processing";
                pullMessage = "正在执行git pull操作...";

                Path directory = Paths.get(".").toAbsolutePath();
                if (gitConfig != null && gitConfig.isComplete()) {
                    executeGitCommand(directory, "git", "pull", "origin", gitConfig.getBranch());
                } else {
                    executeGitCommand(directory, "git", "pull");
                }

                pullStatus = "completed";
                pullMessage = "Git pull操作成功";
                return "success";
            } catch (Exception e) {
                pullStatus = "error";
                pullMessage = "Git pull操作失败: " + e.getMessage();
                log.error("Git pull failed: {}", e.getMessage());
                return "error";
            }
        });
    }

    /**
     * 重置 Push 状态为 idle
     */
    public void resetPushStatus() {
        pushStatus = "idle";
        pushMessage = "";
    }

    /**
     * 重置 Pull 状态为 idle
     */
    public void resetPullStatus() {
        pullStatus = "idle";
        pullMessage = "";
    }

    /**
     * 获取 Push 状态
     *
     * @return 状态字符串
     */
    public String getPushStatus() {
        return pushStatus;
    }

    /**
     * 获取 Push 消息
     *
     * @return 消息描述
     */
    public String getPushMessage() {
        return pushMessage;
    }

    /**
     * 获取 Pull 状态
     *
     * @return 状态字符串
     */
    public String getPullStatus() {
        return pullStatus;
    }

    /**
     * 获取 Pull 消息
     *
     * @return 消息描述
     */
    public String getPullMessage() {
        return pullMessage;
    }

    /**
     * 执行 Git 命令（底层方法）
     * <p>
     * 使用 {@link ProcessBuilder} 执行命令，读取标准输出并记录日志。
     * 如果命令退出码非 0，抛出 IOException。
     * 注意：此方法会阻塞直到命令执行完成。
     * </p>
     *
     * @param directory 执行目录
     * @param command   命令及参数数组
     * @throws IOException          命令执行失败
     * @throws InterruptedException 等待被中断
     */
    private void executeGitCommand(Path directory, String... command) throws IOException, InterruptedException {
        ProcessBuilder processBuilder = new ProcessBuilder(command);
        processBuilder.directory(directory.toFile());
        // 合并标准错误到标准输出，简化读取
        processBuilder.redirectErrorStream(true);

        Process process = processBuilder.start();
        int exitCode = process.waitFor();

        // 读取命令输出并记录日志
        try (InputStream inputStream = process.getInputStream();
             BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream))) {
            String line;
            while ((line = reader.readLine()) != null) {
                log.info("Git command output: {}", line);
            }
        }

        if (exitCode != 0) {
            log.warn("Git command failed with exit code: {}", exitCode);
            throw new IOException("Git command failed with exit code: " + exitCode);
        }
    }
}