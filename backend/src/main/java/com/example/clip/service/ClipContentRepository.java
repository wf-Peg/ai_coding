package com.example.clip.service;

import com.example.clip.model.ClipContent;

/**
 * 剪藏内容数据仓库接口（已废弃）
 * <p>
 * 原本计划使用 JPA（Spring Data JPA）与数据库交互，但当前项目采用文件存储（JSON 文件）方式持久化数据。
 * 因此该接口已被注释掉，相关 CRUD 操作由 {@link FileStorageService} 通过文件系统完成。
 * 保留此文件仅用于记录历史设计决策，若未来切换为数据库存储可重新启用。
 * </p>
 *
 * @see FileStorageService
 */
// import org.springframework.data.jpa.repository.JpaRepository;
// 注释掉，因为我们现在使用文件存储而不是数据库
// public interface ClipContentRepository extends JpaRepository<ClipContent, Long> {
// }