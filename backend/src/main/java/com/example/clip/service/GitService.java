package com.example.clip.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.util.concurrent.CompletableFuture;

@Service
public class GitService {

    private static final Logger logger = LoggerFactory.getLogger(GitService.class);

    @Value("${git.repo.path:${user.dir}}")
    private String repoPath;

    private String lastPushStatus = "idle";
    private String lastPushMessage = "";
    private String lastPullStatus = "idle";
    private String lastPullMessage = "";

    public CompletableFuture<String> pushAsync() {
        return CompletableFuture.supplyAsync(() -> {
            try {
                lastPushStatus = "running";
                lastPushMessage = "正在执行 git push...";
                
                File repoDir = new File(repoPath);
                if (!repoDir.exists() || !new File(repoDir, ".git").exists()) {
                    throw new RuntimeException("未找到Git仓库: " + repoPath);
                }

                ProcessBuilder addBuilder = new ProcessBuilder("git", "add", ".");
                addBuilder.directory(repoDir);
                Process addProcess = addBuilder.start();
                addProcess.waitFor();

                ProcessBuilder commitBuilder = new ProcessBuilder("git", "commit", "-m", "Update from clip tool");
                commitBuilder.directory(repoDir);
                Process commitProcess = commitBuilder.start();
                commitProcess.waitFor();

                ProcessBuilder pushBuilder = new ProcessBuilder("git", "push");
                pushBuilder.directory(repoDir);
                Process pushProcess = pushBuilder.start();
                
                StringBuilder output = new StringBuilder();
                BufferedReader reader = new BufferedReader(new InputStreamReader(pushProcess.getInputStream()));
                String line;
                while ((line = reader.readLine()) != null) {
                    output.append(line).append("\n");
                }
                
                BufferedReader errorReader = new BufferedReader(new InputStreamReader(pushProcess.getErrorStream()));
                while ((line = errorReader.readLine()) != null) {
                    output.append(line).append("\n");
                }
                
                int exitCode = pushProcess.waitFor();
                
                if (exitCode == 0) {
                    lastPushStatus = "success";
                    lastPushMessage = "Git push 成功";
                    return "Git push 成功: " + output.toString();
                } else {
                    lastPushStatus = "error";
                    lastPushMessage = "Git push 失败: " + output.toString();
                    return lastPushMessage;
                }
            } catch (Exception e) {
                logger.error("Git push failed", e);
                lastPushStatus = "error";
                lastPushMessage = "Git push 异常: " + e.getMessage();
                return lastPushMessage;
            }
        });
    }

    public CompletableFuture<String> pullAsync() {
        return CompletableFuture.supplyAsync(() -> {
            try {
                lastPullStatus = "running";
                lastPullMessage = "正在执行 git pull...";
                
                File repoDir = new File(repoPath);
                if (!repoDir.exists() || !new File(repoDir, ".git").exists()) {
                    throw new RuntimeException("未找到Git仓库: " + repoPath);
                }

                ProcessBuilder pullBuilder = new ProcessBuilder("git", "pull");
                pullBuilder.directory(repoDir);
                Process pullProcess = pullBuilder.start();
                
                StringBuilder output = new StringBuilder();
                BufferedReader reader = new BufferedReader(new InputStreamReader(pullProcess.getInputStream()));
                String line;
                while ((line = reader.readLine()) != null) {
                    output.append(line).append("\n");
                }
                
                BufferedReader errorReader = new BufferedReader(new InputStreamReader(pullProcess.getErrorStream()));
                while ((line = errorReader.readLine()) != null) {
                    output.append(line).append("\n");
                }
                
                int exitCode = pullProcess.waitFor();
                
                if (exitCode == 0) {
                    lastPullStatus = "success";
                    lastPullMessage = "Git pull 成功";
                    return "Git pull 成功: " + output.toString();
                } else {
                    lastPullStatus = "error";
                    lastPullMessage = "Git pull 失败: " + output.toString();
                    return lastPullMessage;
                }
            } catch (Exception e) {
                logger.error("Git pull failed", e);
                lastPullStatus = "error";
                lastPullMessage = "Git pull 异常: " + e.getMessage();
                return lastPullMessage;
            }
        });
    }

    public String getPushStatus() {
        return lastPushStatus;
    }

    public String getPushMessage() {
        return lastPushMessage;
    }

    public String getPullStatus() {
        return lastPullStatus;
    }

    public String getPullMessage() {
        return lastPullMessage;
    }

    public void resetPushStatus() {
        lastPushStatus = "idle";
        lastPushMessage = "";
    }

    public void resetPullStatus() {
        lastPullStatus = "idle";
        lastPullMessage = "";
    }
}
