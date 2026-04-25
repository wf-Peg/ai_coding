package com.example.clip.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.file.Path;

/**
 * Git服务类
 * 负责执行git操作，如pull、commit、push等
 */
@Service
public class GitService {

    private static final Logger log = LoggerFactory.getLogger(GitService.class);

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