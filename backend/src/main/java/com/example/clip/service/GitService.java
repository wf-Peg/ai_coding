package com.example.clip.service;

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

/**
 * Git服务类
 * 负责执行git操作，如pull、commit、push等
 */
@Service
public class GitService {

    private static final Logger log = LoggerFactory.getLogger(GitService.class);
    private String pushStatus = "idle";
    private String pushMessage = "";
    private String pullStatus = "idle";
    private String pullMessage = "";

    /**
     * 执行git操作
     * @param directory 要执行git操作的目录
     */
    public void executeGitOperations(Path directory) {
        if (directory == null || !directory.toFile().exists()) {
            log.error("Git operation failed: directory does not exist: {}", directory);
            return;
        }

        try {
            log.info("Executing git operations in directory: {}", directory);

            // 检查远程仓库配置
            if (!checkRemoteConfig(directory)) {
                log.warn("Remote repository not configured, skipping git push");
                // 仍然执行其他操作
            }

            // 执行git pull
            executeGitCommand(directory, "git", "pull");

            // 执行git add
            executeGitCommand(directory, "git", "add", ".");

            // 执行git commit
            executeGitCommand(directory, "git", "commit", "-m", "Auto commit: content organize or weekly report");

            // 执行git push
            executeGitCommand(directory, "git", "push");

            log.info("Git operations completed successfully");
        } catch (Exception e) {
            // 只打日志，不影响主流程
            log.error("Git operation failed: {}", e.getMessage());
        }
    }

    /**
     * 检查远程仓库配置
     * @param directory 要检查的目录
     * @return 是否配置了远程仓库
     */
    private boolean checkRemoteConfig(Path directory) {
        try {
            ProcessBuilder processBuilder = new ProcessBuilder("git", "remote", "-v");
            processBuilder.directory(directory.toFile());
            processBuilder.redirectErrorStream(true);

            Process process = processBuilder.start();
            int exitCode = process.waitFor();

            // 读取输出
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
     * 异步执行git push操作
     * @return CompletableFuture<String> 操作结果
     */
    public CompletableFuture<String> pushAsync() {
        return CompletableFuture.supplyAsync(() -> {
            try {
                pushStatus = "processing";
                pushMessage = "正在执行git push操作...";
                
                Path directory = Paths.get(".").toAbsolutePath();
                executeGitCommand(directory, "git", "push");
                
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
     * 异步执行git pull操作
     * @return CompletableFuture<String> 操作结果
     */
    public CompletableFuture<String> pullAsync() {
        return CompletableFuture.supplyAsync(() -> {
            try {
                pullStatus = "processing";
                pullMessage = "正在执行git pull操作...";
                
                Path directory = Paths.get(".").toAbsolutePath();
                executeGitCommand(directory, "git", "pull");
                
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
     * 重置push状态
     */
    public void resetPushStatus() {
        pushStatus = "idle";
        pushMessage = "";
    }

    /**
     * 重置pull状态
     */
    public void resetPullStatus() {
        pullStatus = "idle";
        pullMessage = "";
    }

    /**
     * 获取push状态
     * @return push状态
     */
    public String getPushStatus() {
        return pushStatus;
    }

    /**
     * 获取push消息
     * @return push消息
     */
    public String getPushMessage() {
        return pushMessage;
    }

    /**
     * 获取pull状态
     * @return pull状态
     */
    public String getPullStatus() {
        return pullStatus;
    }

    /**
     * 获取pull消息
     * @return pull消息
     */
    public String getPullMessage() {
        return pullMessage;
    }

    /**
     * 执行git命令
     * @param directory 执行目录
     * @param command 命令及参数
     * @throws IOException IO异常
     * @throws InterruptedException 中断异常
     */
    private void executeGitCommand(Path directory, String... command) throws IOException, InterruptedException {
        ProcessBuilder processBuilder = new ProcessBuilder(command);
        processBuilder.directory(directory.toFile());
        processBuilder.redirectErrorStream(true);

        Process process = processBuilder.start();
        int exitCode = process.waitFor();

        // 读取输出
        try (InputStream inputStream = process.getInputStream();
             BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream))) {
            String line;
            while ((line = reader.readLine()) != null) {
                log.info("Git command output: {}", line);
            }
        }

        if (exitCode != 0) {
            log.warn("Git command failed with exit code: {}", exitCode);
        }
    }
}