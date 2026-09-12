package com.example.clip.service.sync;

/**
 * 同步/备份方案扩展接口（预留设计）。
 * <p>
 * 剪藏页「同步状态」面板通过该抽象统一驱动各类同步/备份方案。
 * 当前唯一实现为 {@code GitSyncProvider}（Git 远程仓库），后续可按 NoteGen 的
 * 多同步方案路线新增实现（本地目录备份、WebDAV/坚果云、网盘、对象存储等）。
 * <p>
 * <b>如何新增一种方案：</b>
 * <ol>
 *   <li>新建 {@code @Component} 类实现本接口（需提供 {@code getType()/getDisplayName()}）；</li>
 *   <li>实现 {@link #getStatus()}，把该方案特有的参数放进 {@link SyncStatus#getFields()}；</li>
 *   <li>由 {@link SyncProviderRegistry} 的 {@code List<SyncProvider>} 自动收集注册；</li>
 *   <li>前端在 provider 渲染注册表中补充该 {@code type} 的 fields 渲染器即可自动展示。</li>
 * </ol>
 * 本接口为「预留扩展层」，不强制迁移既有 {@code /api/git/*} 端点。
 * </p>
 *
 * @see SyncStatus
 * @see SyncResult
 * @see SyncProviderRegistry
 */
public interface SyncProvider {

    /** 方案唯一标识，如 "git"；须全局唯一 */
    String getType();

    /** 方案展示名，如 "Git 远程仓库" */
    String getDisplayName();

    /** 是否已完成方案配置（如远程仓库是否已填写） */
    boolean isConfigured();

    /** 目标仓库/目录是否就绪（如 .git 是否存在、备份目标是否可达） */
    boolean isReady();

    /** 获取当前同步状态快照（面板数据来源） */
    SyncStatus getStatus();

    /** 执行一次同步，返回统一的 ok/steps/message */
    SyncResult sync();

    /** 测试方案连通性/可用性 */
    SyncResult testConnection();
}