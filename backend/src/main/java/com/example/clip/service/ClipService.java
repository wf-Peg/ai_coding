package com.example.clip.service;

import com.example.clip.controller.ClipController;
import com.example.clip.core.AiService;
import com.example.clip.model.ClipContent;
import com.example.clip.utils.ImageUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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

    private static final Logger logger = LoggerFactory.getLogger(ClipService.class);
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
     * 保存剪藏内容（支持图片上传）
     * @param content 剪藏内容
     * @param type 剪藏类型
     * @param source 剪藏来源
     * @param category 剪藏分类
     * @param fileData 文件数据（Base64编码）
     * @param fileName 文件名
     * @param imageDataList 图片数据列表
     * @return 保存后的剪藏内容
     */
    public ClipContent saveClip(String content, String type, String source, String category,
                                 String fileData, String fileName, List<ClipController.ClipRequest.ImageData> imageDataList) {
        ClipContent clipContent = new ClipContent(content, type, source, category);

        // 处理图片
        if (imageDataList != null && !imageDataList.isEmpty()) {
            try {
                // 生成笔记文件名（用于图片存储）
                String noteFileName = generateNoteFileName(category);
                String cat = (category != null && !category.isEmpty()) ? category : "default";
                
                // 处理每张图片
                for (int i = 0; i < imageDataList.size(); i++) {
                    ClipController.ClipRequest.ImageData imageData = imageDataList.get(i);
                    if (imageData.getBase64Data() != null && !imageData.getBase64Data().isEmpty()) {
                        // 解码Base64图片数据
                        byte[] imageBytes = Base64.getDecoder().decode(imageData.getBase64Data());
                        
                        // 验证图片文件类型
                        if (!ImageUtils.isValidImageFile(imageData.getFileName())) {
                            logger.warn("Invalid image file type: {}", imageData.getFileName());
                            continue;
                        }
                        
                        // 验证图片大小（限制10MB）
                        if (!ImageUtils.isWithinSizeLimit(imageBytes, 10 * 1024 * 1024)) {
                            logger.warn("Image too large: {}", imageData.getFileName());
                            continue;
                        }
                        
                        // 存储图片并获取相对路径
                        String imagePath = ImageUtils.storeImage(imageBytes, imageData.getFileName(), category, noteFileName);
                        
                        // 将图片路径添加到clipContent
                        clipContent.getImagePaths().add(imagePath);
                        
                        // 在内容中添加图片引用
                        if (clipContent.getContent() == null) {
                            clipContent.setContent("");
                        }
                        clipContent.setContent(clipContent.getContent() + "\n![图片](" + imagePath + ")\n");
                    }
                }
            } catch (Exception e) {
                logger.error("Failed to process images: {}", e.getMessage(), e);
                // 图片处理失败不影响文本内容的保存
            }
        }

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
                // 如果没有分类，则使用AI分类
                boolean useAiCategoryLink = (clipContent.getCategory() == null || clipContent.getCategory().isEmpty());
                processWithAi(clipContent, useAiCategoryLink);
                break;

            case "doc-ai":
                // 解析文档，然后进行AI处理
                try {
                    byte[] fileBytes = Base64.getDecoder().decode(fileData);
                    String parsedText = documentParseService.parseDocument(fileBytes, fileName);
                    clipContent.setContent(parsedText);
                    // 如果没有分类，则使用AI分类
                    boolean useAiCategoryDoc = (clipContent.getCategory() == null || clipContent.getCategory().isEmpty());
                    processWithAi(clipContent, useAiCategoryDoc);
                } catch (Exception e) {
                    logger.error("[ClipService] Document parse failed: {}", e.getMessage(), e);
                    clipContent.setSummary("[文档解析失败] " + e.getMessage());
                    clipContent.setAnalysis("");
                }
                break;

            case "ai-text":
            default:
                // 原始逻辑：AI文本处理
                // 如果没有分类，则使用AI分类
                boolean useAiCategory = (clipContent.getCategory() == null || clipContent.getCategory().isEmpty());
                processWithAi(clipContent, useAiCategory);
                break;
        }

        ClipContent savedClip = storageService.saveClip(clipContent);
        return savedClip;
    }

    /**
     * AI处理：一次性生成摘要、分析和标签
     * 标签直接设置到clipContent对象上
     * @param clipContent 剪藏内容对象
     * @param useAiCategory 是否使用AI分类
     */
    @SuppressWarnings("unchecked")
    private void processWithAi(ClipContent clipContent, boolean useAiCategory) {
        try {
            Map<String, Object> aiResult = aiService.processClipContent(clipContent.getContent(), useAiCategory);
            clipContent.setSummary((String) aiResult.getOrDefault("summary", "摘要生成失败"));
            clipContent.setAnalysis((String) aiResult.getOrDefault("analysis", ""));
            List<String> tags = (List<String>) aiResult.getOrDefault("tags", List.of());
            // 如果clipContent没有设置标签，则设置AI生成的标签
            if (clipContent.getTags() == null || clipContent.getTags().isEmpty()) {
                clipContent.setTags(tags);
            }
            // 如果使用AI分类且clipContent没有设置分类，则设置AI生成的分类
            if (useAiCategory && (clipContent.getCategory() == null || clipContent.getCategory().isEmpty())) {
                String category = (String) aiResult.getOrDefault("category", "default");
                clipContent.setCategory(category);
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
        return saveClip(content, type, source, category, null, null, null);
    }
    
    /**
     * 保存剪藏内容（兼容重载方法）
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
        return saveClip(content, type, source, category, fileData, fileName, null);
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
     * 生成笔记文件名
     * 格式：{category}_{yyMMdd}
     * @param category 分类
     * @return 笔记文件名
     */
    private String generateNoteFileName(String category) {
        String cat = (category != null && !category.isEmpty()) ? category : "default";
        // 移除分类中的斜杠和其他特殊字符
        cat = cat.replaceAll("/", "-");
        // 获取当前日期
        String dateSuffix = java.time.LocalDate.now().format(java.time.format.DateTimeFormatter.ofPattern("yyMMdd"));
        return cat + "_" + dateSuffix;
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
