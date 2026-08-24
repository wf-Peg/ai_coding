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
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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
     * <p>
     * 返回结构化结果，包含每一步的 {@code name/ok/files/message}（供前端分步展示）：
     * <ul>
     *   <li>{@code ok}：整体是否成功（fetch 失败视为非致命警告，不导致整体失败）</li>
     *   <li>{@code message}：整体结果摘要</li>
     *   <li>{@code steps}：步骤明细列表</li>
     * </ul>
     * 单个 Git 命令失败不抛出异常，而是写入对应步骤的 {@code ok=false} 与错误消息。
     * </p>
     *
     * @param directory 要执行 Git 操作的目录
     * @return 结构化的 Git 同步结果 Map
     */
    public Map<String, Object> executeGitOperations(Path directory) {
        List<Map<String, Object>> steps = new ArrayList<>();
        gitLock.lock();
        try {
            boolean ok = true;
            if (directory == null || !directory.toFile().exists()) {
                log.error("Git operation failed: directory does not exist: {}", directory);
                Map<String, Object> fail = new LinkedHashMap<>();
                fail.put("ok", false);
                fail.put("message", "Git 目录不存在: " + directory);
                fail.put("steps", steps);
                return fail;
            }

            log.info("Executing git operations in directory: {}", directory);
            boolean remoteComplete = gitConfig != null && gitConfig.isComplete();

            // ① 配置远程仓库（仅当配置完整时；失败不致命，后续步骤会暴露真实错误）
            if (remoteComplete) {
                configureRemoteRepository(directory);
            } else {
                log.warn("Git config not complete, skipping remote configuration");
            }

            // ② fetch：获取远程最新状态（无远程时可能失败，作为非致命警告展示）
            Map<String, Object> fetch = run(directory, "git", "fetch", "origin");
            int fetchCode = ((Number) fetch.getOrDefault("code", -1)).intValue();
            steps.add(stepResult("fetch", fetchCode == 0, 0, fetchCode == 0 ? "拉取远程最新状态" : NonFatalMsg(fetch)));

            // ③ pull：合并远程分支（有配置时指定 remote/branch）
            if (remoteComplete) {
                Map<String, Object> pull = run(directory, "git", "pull", "origin", gitConfig.getBranch());
                int pullCode = ((Number) pull.getOrDefault("code", -1)).intValue();
                boolean pullOk = pullCode == 0;
                steps.add(stepResult("pull", pullOk, 0, lastLine(pull)));
                if (!pullOk) ok = false;
            }

            // ④ add：暂存所有变更
            Map<String, Object> add = run(directory, "git", "add", ".");
            int addCode = ((Number) add.getOrDefault("code", -1)).intValue();
            boolean addOk = addCode == 0;
            if (addOk) {
                steps.add(stepResult("add", true, 0, "暂存变更"));
            } else {
                steps.add(stepResult("add", false, 0, lastLine(add)));
                ok = false;
            }

            // ⑤ commit：仅当存在暂存变更时提交
            int staged = addOk ? stagedFileCount(directory) : 0;
            if (staged > 0) {
                Map<String, Object> commit = run(directory, "git", "commit", "-m", "Auto commit: content organize or weekly report");
                int commitCode = ((Number) commit.getOrDefault("code", -1)).intValue();
                boolean commitOk = commitCode == 0;
                if (commitOk) {
                    steps.add(stepResult("commit", true, staged, "已提交 " + staged + " 个文件"));
                } else {
                    steps.add(stepResult("commit", false, staged, lastLine(commit)));
                    ok = false;
                }
                // ⑥ push：仅 commit 成功后且配置完整时推送
                if (commitOk && remoteComplete) {
                    Map<String, Object> push = run(directory, "git", "push", "--set-upstream", "origin", gitConfig.getBranch());
                    int pushCode = ((Number) push.getOrDefault("code", -1)).intValue();
                    boolean pushOk = pushCode == 0;
                    if (pushOk) {
                        steps.add(stepResult("push", true, 0, "推送成功"));
                    } else {
                        steps.add(stepResult("push", false, 0, lastLine(push)));
                        ok = false;
                    }
                }
            } else {
                steps.add(stepResult("commit", true, 0, "无待提交变更"));
            }

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("ok", ok);
            result.put("message", ok ? "同步完成" : "同步过程中出现问题，请查看分步结果");
            result.put("steps", steps);
            log.info("Git operations finished, ok={}", ok);
            return result;
        } catch (Exception e) {
            log.error("Git operation failed: {}", e.getMessage());
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("ok", false);
            result.put("message", "Git 同步出现异常: " + e.getMessage());
            result.put("steps", steps);
            return result;
        } finally {
            gitLock.unlock();
        }
    }

    /** 非致命错误提示：fetch 无远程等场景给用户一个中性说明，而非生硬的命令报错。 */
    private String NonFatalMsg(Map<String, Object> step) {
        String msg = lastLine(step);
        return (msg == null || msg.isEmpty()) ? "fetch 跳过（无远程或网络不可达）" : msg;
    }

    /**
     * 封装一步 Git 操作结果。
     *
     * @param name    步骤名（fetch/pull/add/commit/push）
     * @param ok      是否成功
     * @param files   涉及文件数（commit 步骤为提交数量，其余为 0）
     * @param message 步骤描述或错误消息
     * @return 步骤 Map
     */
    private Map<String, Object> stepResult(String name, boolean ok, int files, String message) {
        Map<String, Object> step = new LinkedHashMap<>();
        step.put("name", name);
        step.put("ok", ok);
        step.put("files", files);
        step.put("message", message == null ? "" : message);
        return step;
    }

    /**
     * 执行一条 Git 命令并收集退出码与输出（错误不抛异常）。
     *
     * @param directory 执行目录
     * @param command   命令及参数
     * @return Map：code（退出码，异常时为 -1）/ output（合并后的完整输出）
     */
    private Map<String, Object> run(Path directory, String... command) {
        Map<String, Object> out = new HashMap<>();
        out.put("code", -1);
        out.put("output", "");
        try {
            ProcessBuilder processBuilder = new ProcessBuilder(command);
            processBuilder.directory(directory.toFile());
            processBuilder.redirectErrorStream(true);
            Process process = processBuilder.start();
            int exitCode = process.waitFor();
            StringBuilder sb = new StringBuilder();
            try (InputStream inputStream = process.getInputStream();
                 BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    if (sb.length() > 0) sb.append("\n");
                    sb.append(line);
                }
            }
            out.put("code", exitCode);
            out.put("output", sb.toString());
        } catch (Exception e) {
            log.warn("Git command failed to run: {} - {}", String.join(" ", command), e.getMessage());
        }
        return out;
    }

    /**
     * 统计暂存区待提交的文件数量（git diff --cached --name-only）。
     *
     * @param directory Git 仓库目录
     * @return 待提交文件数；命令失败或无变更时返回 0
     */
    private int stagedFileCount(Path directory) {
        Map<String, Object> out = run(directory, "git", "diff", "--cached", "--name-only");
        if (((Number) out.getOrDefault("code", -1)).intValue() != 0) return 0;
        String output = (String) out.get("output");
        if (output == null || output.trim().isEmpty()) return 0;
        return output.split("\n").length;
    }

    /** 取命令输出的最后一行（用作简短消息/错误原因）。 */
    private String lastLine(Map<String, Object> runResult) {
        String output = (String) runResult.get("output");
        if (output == null || output.trim().isEmpty()) return "";
        String[] lines = output.trim().split("\n");
        return lines[lines.length - 1].trim();
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