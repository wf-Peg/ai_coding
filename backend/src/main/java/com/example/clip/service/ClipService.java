package com.example.clip.service;

import com.example.clip.core.AiService;
import com.example.clip.model.ClipContent;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class ClipService {

    private final FileStorageService storageService;
    private final AiService aiService;

    @Autowired
    public ClipService(FileStorageService storageService, AiService aiService) {
        this.storageService = storageService;
        this.aiService = aiService;
    }

    public ClipContent saveClip(String content, String type, String source, String category) {
        ClipContent clipContent = new ClipContent(content, type, source, category);
        // ID 由 FileStorageService 统一分配，此处不再手动设置
        
        // 直接调用AI生成内容，而不是异步处理
        try {
            String summary = aiService.generateSummary(clipContent.getContent());
            String analysis = aiService.analyzeContent(clipContent.getContent());
            clipContent.setSummary(summary);
            clipContent.setAnalysis(analysis);
        } catch (Exception e) {
            e.printStackTrace();
            clipContent.setSummary("摘要生成失败");
            clipContent.setAnalysis("分析生成失败");
        }
        
        ClipContent savedClip = storageService.saveClip(clipContent);
        return savedClip;
    }

    public ClipContent saveClip(ClipContent clipContent) {
        return storageService.saveClip(clipContent);
    }

    public List<ClipContent> getAllClips() {
        return storageService.getAllClips();
    }

    public ClipContent getClipById(Long id) {
        return storageService.getClipById(id.toString());
    }

    public void deleteClip(Long id) {
        storageService.deleteClip(id);
    }

    public List<ClipContent> getClipsByCategory(String category) {
        return storageService.getClipsByCategory(category);
    }

    @Async
    public void processClipAsync(Long clipId) {
        try {
            Thread.sleep(1000); 
            ClipContent clip = storageService.getClipById(clipId.toString());
            if (clip != null) {
                String summary = aiService.generateSummary(clip.getContent());
                String analysis = aiService.analyzeContent(clip.getContent());
                clip.setSummary(summary);
                clip.setAnalysis(analysis);
                storageService.saveClip(clip);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}