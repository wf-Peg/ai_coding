package com.example.clip.service;

import com.example.clip.core.AiService;
import com.example.clip.model.ClipContent;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.util.Base64;
import java.util.List;
import java.util.Map;

/**
 * 剪藏服务类
 * 处理剪藏内容的保存、AI分析、存储等操作
 */
@Service
public class ClipService {

    private final FileStorageService storageService;  // 文件存储服务
    private final AiService aiService;  // AI服务
    private final LinkParseService linkParseService;  // 链接解析服务
    private final DocumentParseService documentParseService;  // 文档解析服务

    /**
     * 构造函数
     * @param storageService 文件存储服务
     * @param aiService AI服务
     * @param linkParseService 链接解析服务
     * @param documentParseService 文档解析服务
     */
    @Autowired
    public ClipService(FileStorageService storageService, AiService aiService,
                       LinkParseService linkParseService, DocumentParseService documentParseService) {
        this.storageService = storageService;
        this.aiService = aiService;
        this.linkParseService = linkParseService;
        this.documentParseService = documentParseService;
    }

    /**
     * 保存剪藏内容
     * @param content 剪藏内容
     * @param type 剪藏类型
     * @param source 剪藏来源
     * @param category 剪藏分类
     * @param fileData 文件数据（Base64编码）
     * @param fileName 文件名
     * @return 保存后的剪藏内容
     */
    public ClipContent saveClip(String content, String type, String source, String category,
                                 String fileData, String fileName) {
        ClipContent clipContent = new ClipContent(content, type, source, category);

        switch (type != null ? type : "ai-text") {
            case "store-only":
                // 仅存储内容，不进行AI处理
                clipContent.setSummary(content != null ? content : "");
                clipContent.setAnalysis("");
                break;

            case "link-ai":
                // 爬取链接内容，然后进行AI处理
                String originalUrl = content;
                String crawledText = linkParseService.parseUrl(content);
                // 存储：URL + 爬取的原始文本
                clipContent.setContent("来源链接: " + originalUrl + "\n\n" + crawledText);
                processWithAi(clipContent);
                break;

            case "doc-ai":
                // 解析文档，然后进行AI处理
                try {
                    byte[] fileBytes = Base64.getDecoder().decode(fileData);
                    String parsedText = documentParseService.parseDocument(fileBytes, fileName);
                    clipContent.setContent(parsedText);
                    processWithAi(clipContent);
                } catch (Exception e) {
                    System.err.println("[ClipService] Document parse failed: " + e.getMessage());
                    clipContent.setSummary("[文档解析失败] " + e.getMessage());
                    clipContent.setAnalysis("");
                }
                break;

            case "ai-text":
            default:
                // 原始逻辑：AI文本处理
                processWithAi(clipContent);
                break;
        }

        ClipContent savedClip = storageService.saveClip(clipContent);
        return savedClip;
    }

    /**
     * AI处理：一次性生成摘要、分析和标签
     * 标签直接设置到clipContent对象上
     * @param clipContent 剪藏内容对象
     */
    @SuppressWarnings("unchecked")
    private void processWithAi(ClipContent clipContent) {
        try {
            Map<String, Object> aiResult = aiService.processClipContent(clipContent.getContent());
            clipContent.setSummary((String) aiResult.getOrDefault("summary", "摘要生成失败"));
            clipContent.setAnalysis((String) aiResult.getOrDefault("analysis", ""));
            List<String> tags = (List<String>) aiResult.getOrDefault("tags", List.of());
            // 如果clipContent没有设置标签，则设置AI生成的标签
            if (clipContent.getTags() == null || clipContent.getTags().isEmpty()) {
                clipContent.setTags(tags);
            }
        } catch (Exception e) {
            e.printStackTrace();
            clipContent.setSummary("摘要生成失败");
            clipContent.setAnalysis("分析生成失败");
        }
    }

    /**
     * 保存剪藏内容（兼容重载方法）
     * @param content 剪藏内容
     * @param type 剪藏类型
     * @param source 剪藏来源
     * @param category 剪藏分类
     * @return 保存后的剪藏内容
     */
    public ClipContent saveClip(String content, String type, String source, String category) {
        return saveClip(content, type, source, category, null, null);
    }

    /**
     * 保存剪藏内容
     * @param clipContent 剪藏内容对象
     * @return 保存后的剪藏内容
     */
    public ClipContent saveClip(ClipContent clipContent) {
        return storageService.saveClip(clipContent);
    }

    /**
     * 获取所有剪藏内容
     * @return 剪藏内容列表
     */
    public List<ClipContent> getAllClips() {
        return storageService.getAllClips();
    }

    /**
     * 根据ID获取剪藏内容
     * @param id 剪藏ID
     * @return 剪藏内容对象
     */
    public ClipContent getClipById(Long id) {
        return storageService.getClipById(id.toString());
    }

    /**
     * 删除剪藏内容
     * @param id 剪藏ID
     */
    public void deleteClip(Long id) {
        storageService.deleteClip(id);
    }

    /**
     * 根据分类获取剪藏内容
     * @param category 分类值
     * @return 剪藏内容列表
     */
    public List<ClipContent> getClipsByCategory(String category) {
        return storageService.getClipsByCategory(category);
    }

    /**
     * 异步处理剪藏内容
     * @param clipId 剪藏ID
     */
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
