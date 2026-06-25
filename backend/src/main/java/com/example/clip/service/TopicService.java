package com.example.clip.service;

import com.example.clip.model.ClipContent;
import com.example.clip.model.Topic;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 话题服务类
 * 处理话题的CRUD、搜索、互动等操作
 */
@Service
public class TopicService {

    private final FileStorageService storageService;
    private final ClipService clipService;

    public TopicService(FileStorageService storageService, ClipService clipService) {
        this.storageService = storageService;
        this.clipService = clipService;
    }

    /**
     * 创建话题
     */
    public Topic createTopic(Topic topic) {
        topic.setLikeCount(0);
        topic.setPublished(topic.isPublished());
        return storageService.saveTopic(topic);
    }

    /**
     * 更新话题
     */
    public Topic updateTopic(Topic topic) {
        Topic existing = storageService.getTopicById(topic.getId());
        if (existing == null) return null;

        existing.setTitle(topic.getTitle());
        existing.setSummary(topic.getSummary());
        existing.setContent(topic.getContent());
        existing.setCoverImage(topic.getCoverImage());
        existing.setCategory(topic.getCategory());
        existing.setTags(topic.getTags());
        existing.setPublished(topic.isPublished());
        existing.setUpdatedAt(java.time.LocalDateTime.now());
        return storageService.saveTopic(existing);
    }

    /**
     * 获取所有话题
     */
    public List<Topic> getAllTopics() {
        return storageService.getAllTopics();
    }

    /**
     * 根据ID获取话题
     */
    public Topic getTopicById(Long id) {
        return storageService.getTopicById(id);
    }

    /**
     * 删除话题
     */
    public void deleteTopic(Long id) {
        storageService.deleteTopic(id);
    }

    /**
     * 点赞
     */
    public Topic likeTopic(Long id) {
        Topic topic = storageService.getTopicById(id);
        if (topic == null) return null;
        topic.setLikeCount(topic.getLikeCount() + 1);
        return storageService.saveTopic(topic);
    }

    /**
     * 从剪藏创建话题
     */
    public Topic createFromClip(Long clipId) {
        ClipContent clip = clipService.getClipById(clipId);
        if (clip == null) return null;

        Topic topic = new Topic();
        topic.setTitle(clip.getTitle() != null ? clip.getTitle() : "来自剪藏的话题");
        topic.setSummary(clip.getSummary());
        topic.setContent(clip.getContent());
        topic.setCategory(clip.getCategory());
        topic.setTags(clip.getTags());
        topic.setSourceClipId(clipId);
        topic.setPublished(false);
        topic.setLikeCount(0);
        return storageService.saveTopic(topic);
    }

    /**
     * 搜索话题
     */
    public List<Topic> searchTopics(String keyword, String category) {
        List<Topic> all = storageService.getAllTopics();
        return all.stream()
                .filter(t -> {
                    boolean match = true;
                    if (keyword != null && !keyword.isEmpty()) {
                        String kw = keyword.toLowerCase();
                        match = (t.getTitle() != null && t.getTitle().toLowerCase().contains(kw))
                                || (t.getSummary() != null && t.getSummary().toLowerCase().contains(kw))
                                || (t.getContent() != null && t.getContent().toLowerCase().contains(kw));
                    }
                    if (match && category != null && !category.isEmpty()) {
                        match = category.equals(t.getCategory());
                    }
                    return match;
                })
                .toList();
    }
}