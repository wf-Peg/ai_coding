package com.example.clip.service;

import com.example.clip.model.ClipContent;
import com.example.clip.model.Comment;
import com.example.clip.model.Topic;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

/**
 * 话题业务服务
 * <p>
 * 提供话题（Topic）的 CRUD 操作、从剪藏创建话题、搜索话题等功能。
 * 话题是一种可发布的长内容形式，可以从剪藏内容转化而来，
 * 支持标题、摘要、正文、封面图、分类、标签等属性。
 * 所有持久化操作委托给 {@link FileStorageService}。
 * </p>
 *
 * @see FileStorageService
 * @see ClipService
 */
@Service
public class TopicService {

    /** 底层文件存储服务 */
    private final FileStorageService storageService;
    /** 剪藏服务，用于从剪藏创建话题 */
    private final ClipService clipService;

    /**
     * 构造器注入
     *
     * @param storageService 文件存储服务
     * @param clipService    剪藏服务
     */
    public TopicService(FileStorageService storageService, ClipService clipService) {
        this.storageService = storageService;
        this.clipService = clipService;
    }

    /**
     * 创建话题
     * <p>
     * 初始化点赞数为 0，保留用户设置的发布状态。
     * </p>
     *
     * @param topic 话题对象
     * @return 保存后的话题（包含自动生成的 ID）
     */
    public Topic createTopic(Topic topic) {
        topic.setLikeCount(0);
        topic.setPublished(topic.isPublished());
        return storageService.saveTopic(topic);
    }

    /**
     * 更新话题
     * <p>
     * 先根据 ID 查找已有话题，若不存在则返回 null。
     * 更新时保留原 ID 和创建时间，只更新可编辑字段，
     * 并自动设置 updatedAt 为当前时间。
     * </p>
     *
     * @param topic 包含更新字段的话题对象（必须包含有效 ID）
     * @return 更新后的话题；若原话题不存在则返回 null
     */
    public Topic updateTopic(Topic topic) {
        Topic existing = storageService.getTopicById(topic.getId());
        if (existing == null) return null;

        // 逐字段更新，保留 ID 和创建时间
        existing.setTitle(topic.getTitle());
        existing.setSummary(topic.getSummary());
        existing.setContent(topic.getContent());
        existing.setCategory(topic.getCategory());
        existing.setTags(topic.getTags());
        existing.setMyThoughts(topic.getMyThoughts());
        existing.setPublished(topic.isPublished());
        existing.setUpdatedAt(java.time.LocalDateTime.now());
        return storageService.saveTopic(existing);
    }

    /**
     * 获取所有话题
     * <p>
     * 返回结果按创建时间倒序排列（最新的在前）。
     * </p>
     *
     * @return 所有话题的列表
     */
    public List<Topic> getAllTopics() {
        return storageService.getAllTopics();
    }

    /**
     * 根据 ID 获取话题
     *
     * @param id 话题 ID
     * @return 匹配的话题；若未找到则返回 null
     */
    public Topic getTopicById(Long id) {
        return storageService.getTopicById(id);
    }

    /**
     * 删除话题
     *
     * @param id 话题 ID
     */
    public void deleteTopic(Long id) {
        storageService.deleteTopic(id);
    }

    /**
     * 点赞话题
     * <p>
     * 将话题的点赞数加 1 并保存。注意：此方法没有并发控制，
     * 在高并发场景下可能出现丢失更新的问题。
     * </p>
     *
     * @param id 话题 ID
     * @return 更新后的话题；若话题不存在则返回 null
     */
    // 注意：高并发场景下，点赞计数可能不准确，建议使用原子操作或数据库锁
    public Topic likeTopic(Long id) {
        Topic topic = storageService.getTopicById(id);
        if (topic == null) return null;
        topic.setLikeCount(topic.getLikeCount() + 1);
        return storageService.saveTopic(topic);
    }

    /**
     * 从剪藏内容创建话题
     * <p>
     * 将剪藏记录的内容转化为话题，标题优先使用剪藏的标题，
     * 若剪藏无标题则使用默认标题"来自剪藏的话题"。
     * 创建的话题默认不发布，点赞数为 0。
     * </p>
     *
     * @param clipId 源剪藏记录 ID
     * @return 创建的话题；若剪藏不存在则返回 null
     */
    public Topic createFromClip(Long clipId) {
        ClipContent clip = clipService.getClipById(clipId);
        if (clip == null) return null;

        Topic topic = new Topic();
        // 标题优先使用剪藏标题，否则使用默认标题
        topic.setTitle(clip.getTitle() != null ? clip.getTitle() : "来自剪藏的话题");
        topic.setSummary(clip.getSummary());
        topic.setContent(clip.getContent());
        topic.setCategory(clip.getCategory());
        topic.setTags(clip.getTags());
        topic.setSourceClipId(clipId);
        topic.setPublished(false);
        topic.setLikeCount(0);

        // 回填我的思考：优先使用剪藏的 myThoughts，其次使用 divergentSummary
        String thoughts = clip.getMyThoughts();
        if (thoughts == null || thoughts.isEmpty()) {
            thoughts = clip.getDivergentSummary();
        }
        topic.setMyThoughts(thoughts);

        return storageService.saveTopic(topic);
    }

    /**
     * 搜索话题
     * <p>
     * 支持按关键词（匹配标题、摘要、正文）和分类进行过滤。
     * 关键词和分类可以组合使用（AND 逻辑）。
     * 关键词匹配使用大小写不敏感的 contains 方式。
     * </p>
     *
     * @param keyword  搜索关键词（可为 null 或空，表示不按关键词过滤）
     * @param category 分类过滤（可为 null 或空，表示不按分类过滤）
     * @return 匹配的话题列表
     */
    public List<Topic> searchTopics(String keyword, String category) {
        List<Topic> all = storageService.getAllTopics();
        return all.stream()
                .filter(t -> {
                    boolean match = true;
                    // 关键词过滤：匹配标题、摘要或正文
                    if (keyword != null && !keyword.isEmpty()) {
                        String kw = keyword.toLowerCase();
                        match = (t.getTitle() != null && t.getTitle().toLowerCase().contains(kw))
                                || (t.getSummary() != null && t.getSummary().toLowerCase().contains(kw))
                                || (t.getContent() != null && t.getContent().toLowerCase().contains(kw));
                    }
                    // 分类过滤：精确匹配
                    if (match && category != null && !category.isEmpty()) {
                        match = category.equals(t.getCategory());
                    }
                    return match;
                })
                .toList();
    }

    /**
     * 获取话题评论列表
     *
     * @param topicId 话题 ID
     * @return 评论列表（按时间正序）
     */
    public List<Comment> getComments(Long topicId) {
        Topic topic = storageService.getTopicById(topicId);
        if (topic == null || topic.getComments() == null) return List.of();
        return topic.getComments();
    }

    /**
     * 添加评论
     * <p>
     * 评论无需审核，直接追加到话题的 comments 列表并持久化。
     * </p>
     *
     * @param topicId 话题 ID
     * @param comment 评论对象（需包含 author 和 content）
     * @return 保存后的评论；若话题不存在则返回 null
     */
    public Comment addComment(Long topicId, Comment comment) {
        Topic topic = storageService.getTopicById(topicId);
        if (topic == null) return null;

        comment.setId(storageService.generateId());
        comment.setTopicId(topicId);
        comment.setCreatedAt(java.time.LocalDateTime.now());

        if (topic.getComments() == null) {
            topic.setComments(new ArrayList<>());
        }
        topic.getComments().add(comment);
        storageService.saveTopic(topic);
        return comment;
    }
}