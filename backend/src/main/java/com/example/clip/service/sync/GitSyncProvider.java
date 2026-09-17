package com.example.clip.service.sync;

import com.example.clip.service.FileStorageService;
import com.example.clip.service.GitService;
import com.example.clip.config.GitConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Git 远程仓库同步方案。
 * <p>
 * 作为 {@link SyncProvider} 的第一个实现，封装剪藏存储目录的 Git 版本化同步：
 * 同步范围＝{@code clip.storage.path} 的父目录（含剪藏 json / 日报 / 周报 / tmp 等）。
 * 同步与连接测试委托既有 {@link GitService}，状态组装依赖 {@link FileStorageService}。
 * </p>
 *
 * @see SyncProvider
 * @see GitService
 * @see FileStorageService
 */
@Component
public class GitSyncProvider implements SyncProvider {

    private static final Logger log = LoggerFactory.getLogger(GitSyncProvider.class);

    /** Git 操作服务（同步 / 连接测试 / 配置） */
    private final GitService gitService;
    /** 文件存储服务（获取同步工作目录与同步范围目录） */
    private final FileStorageService fileStorageService;

    public GitSyncProvider(GitService gitService, FileStorageService fileStorageService) {
        this.gitService = gitService;
        this.fileStorageService = fileStorageService;
    }

    @Override
    public String getType() {
        return "git";
    }

    @Override
    public String getDisplayName() {
        return "Git 远程仓库";
    }

    @Override
    public boolean isConfigured() {
        GitConfig cfg = gitService.getGitConfig();
        return cfg != null && cfg.isComplete();
    }

    @Override
    public boolean isReady() {
        Path parent = fileStorageService.getStorageParentPath();
        return parent != null && Files.exists(parent.resolve(".git"));
    }

    @Override
    public SyncStatus getStatus() {
        SyncStatus status = new SyncStatus();
        status.setType(getType());
        status.setDisplayName(getDisplayName());
        status.setConfigured(isConfigured());
        status.setReady(isReady());
        status.setLastSyncAt(gitService.getLastCommitDate(fileStorageService.getStorageParentPath()));
        status.setFields(buildFields());
        return status;
    }

    @Override
    public SyncResult sync() {
        log.info("[SyncProvider.git] sync called");
        Path parent = fileStorageService.getStorageParentPath();
        if (parent == null || !parent.toFile().exists()) {
            log.error("Git sync failed: working dir not exists: {}", parent);
            return SyncResult.fail("Git 工作目录不存在");
        }
        return SyncResult.from(gitService.executeGitOperations(parent));
    }

    @Override
    public SyncResult testConnection() {
        log.info("[SyncProvider.git] test-connection called");
        Path parent = fileStorageService.getStorageParentPath();
        if (parent == null || !parent.toFile().exists()) {
            return SyncResult.fail("Git 工作目录不存在");
        }
        String msg = gitService.testGitConnection(parent);
        boolean ok = msg != null && msg.contains("successful") && !msg.contains("failed");
        return ok ? SyncResult.ok(msg) : SyncResult.fail(msg);
    }

    /**
     * 组装 Git 方案特有的状态字段。
     * <p>
     * {@code remoteUrl/branch} 来自应用内配置；{@code workingDir/dirs} 为同步工作目录与范围。
     * 新增检测字段：{@code detectedRemoteUrl}（本机已配的 origin）、{@code localBranch}（当前分支）、
     * {@code identityConfigured}（commit 身份是否就绪）、{@code authMode}（认证方式：token/local/none）。
     * </p>
     *
     * @return 状态字段 Map
     */
    private Map<String, Object> buildFields() {
        Map<String, Object> fields = new LinkedHashMap<>();
        GitConfig cfg = gitService.getGitConfig();
        String cfgRemote = cfg == null ? null : cfg.getRemoteUrl();
        String cfgBranch = cfg == null ? null : cfg.getBranch();
        boolean hasToken = cfg != null && cfg.getToken() != null && !cfg.getToken().isEmpty();

        Path parent = fileStorageService.getStorageParentPath();
        String localRemote = gitService.getLocalRemoteUrl(parent);
        String localBranch = gitService.getLocalBranch(parent);
        boolean identity = gitService.hasLocalIdentity(parent);

        fields.put("remoteUrl", cfgRemote);
        fields.put("branch", cfgBranch);
        fields.put("detectedRemoteUrl", localRemote);
        fields.put("localBranch", localBranch);
        fields.put("identityConfigured", identity);
        fields.put("authMode", hasToken ? "token" : (localRemote != null && !localRemote.isEmpty() ? "local" : "none"));
        fields.put("workingDir", parent == null ? null : parent.toString());
        fields.put("dirs", fileStorageService.getSyncDirs());
        return fields;
    }
}