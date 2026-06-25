package com.example.clip.service;

import com.example.clip.core.AiService;
import com.example.clip.dto.ClipRequest;
import com.example.clip.dto.OrganizeClipRequest;
import com.example.clip.dto.OrganizeInboxRequest;
import com.example.clip.model.ClipContent;
import com.example.clip.utils.ImageUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 剪藏服务类
 * 处理剪藏内容的保存、AI分析、存储等操作
 */
@Service
public class ClipService {

    public static final String INBOX_CATEGORY = "inbox";
    public static final String WORKFLOW_INBOX = "inbox";
    public static final String WORKFLOW_ORGANIZED = "organized";
    private static final Set<String> SUPPORTED_CAPTURE_METHODS = Set.of(
            "popup", "context-menu", "shortcut", "floating-button", "system-share", "system-clip"
    );

    private static final Logger logger = LoggerFactory.getLogger(ClipService.class);
    private final FileStorageService storageService;  // 文件存储服务
    private final AiService aiService;  // AI服务
    private final LinkParseService linkParseService;  // 链接解析服务
    private final DocumentParseService documentParseService;  // 文档解析服务
    private final ImageUtils imageUtils;

    /**
     * 构造函数
     *
     * @param storageService       文件存储服务
     * @param aiService            AI服务
     * @param linkParseService     链接解析服务
     * @param documentParseService 文档解析服务
     */
    public ClipService(FileStorageService storageService, AiService aiService,
                       LinkParseService linkParseService, DocumentParseService documentParseService,
                       ImageUtils imageUtils) {
        this.storageService = storageService;
        this.aiService = aiService;
        this.linkParseService = linkParseService;
        this.documentParseService = documentParseService;
        this.imageUtils = imageUtils;
    }

    /**
     * 保存剪藏内容（支持图片上传）
     *
     * @param content       剪藏内容
     * @param type          剪藏类型
     * @param source        剪藏来源
     * @param category      剪藏分类
     * @param fileData      文件数据（Base64编码）
     * @param fileName      文件名
     * @param imageDataList 图片数据列表
     * @return 保存后的剪藏内容
     */
    public ClipContent saveClip(String content, String type, String source, String category,
                                String fileData, String fileName, List<ClipRequest.ImageData> imageDataList) {
        ClipContent clipContent = new ClipContent(content, type, source, category);

        // 处理图片 - 只有ai-text和store-only类型才处理图片上传
        if (("ai-text".equals(type) || "store-only".equals(type)) && imageDataList != null && !imageDataList.isEmpty()) {
            try {
                // 生成笔记文件名（用于图片存储）
                String noteFileName = generateNoteFileName(category);
                String cat = (category != null && !category.isEmpty()) ? category : "default";

                // 处理每张图片
                for (int i = 0; i < imageDataList.size(); i++) {
                    ClipRequest.ImageData imageData = imageDataList.get(i);
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
                        String imagePath = imageUtils.storeImage(imageBytes, imageData.getFileName(), cat, noteFileName);

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
                    
                    // 存储源文件（按照图片存储逻辑）
                    String noteFileName = generateNoteFileName(category);
                    String cat = (category != null && !category.isEmpty()) ? category : "default";
                    String sourceFilePath = imageUtils.storeImage(fileBytes, fileName, cat, noteFileName);
                    
                    // 将源文件路径添加到clipContent
                    clipContent.getImagePaths().add(sourceFilePath);
                    
                    // 解析文档
                    String parsedText = documentParseService.parseDocument(fileBytes, fileName, sourceFilePath);
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
     * 保存剪藏内容（结构化请求版本）
     *
     * @param request 剪藏请求
     * @return 保存后的剪藏内容
     */
    public ClipContent saveClip(ClipRequest request) {
        String workflowStatus = normalizeWorkflowStatus(request);
        String normalizedCategory = normalizeCategory(request);
        String effectiveType = normalizeType(request.getType(), workflowStatus);
        String normalizedSource = firstNonBlank(request.getSourceUrl(), request.getSource());
        ClipContent clipContent = saveClip(
                request.getContent(),
                effectiveType,
                normalizedSource,
                normalizedCategory,
                request.getFileData(),
                request.getFileName(),
                request.getImageDataList()
        );

        clipContent.setTitle(request.getTitle());
        clipContent.setSourceUrl(firstNonBlank(request.getSourceUrl(), request.getSource()));
        clipContent.setSiteName(request.getSiteName());
        clipContent.setCapturedAt(request.getCapturedAt());
        clipContent.setSelectedText(request.getSelectedText());
        clipContent.setContextBefore(request.getContextBefore());
        clipContent.setContextAfter(request.getContextAfter());
        clipContent.setCaptureMethod(normalizeCaptureMethod(request.getCaptureMethod()));
        clipContent.setWorkflowStatus(workflowStatus);

        return storageService.saveClip(clipContent);
    }

    /**
     * AI处理：一次性生成摘要、分析和标签
     * 标签直接设置到clipContent对象上
     *
     * @param clipContent   剪藏内容对象
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
     *
     * @param content  剪藏内容
     * @param type     剪藏类型
     * @param source   剪藏来源
     * @param category 剪藏分类
     * @return 保存后的剪藏内容
     */
    public ClipContent saveClip(String content, String type, String source, String category) {
        return saveClip(content, type, source, category, null, null, null);
    }

    /**
     * 保存剪藏内容（兼容重载方法）
     *
     * @param content  剪藏内容
     * @param type     剪藏类型
     * @param source   剪藏来源
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
     *
     * @param clipContent 剪藏内容对象
     * @return 保存后的剪藏内容
     */
    public ClipContent saveClip(ClipContent clipContent) {
        return storageService.saveClip(clipContent);
    }

    /**
     * 获取所有剪藏内容
     *
     * @return 剪藏内容列表
     */
    public List<ClipContent> getAllClips() {
        return storageService.getAllClips();
    }

    /**
     * 根据ID获取剪藏内容
     *
     * @param id 剪藏ID
     * @return 剪藏内容对象
     */
    public ClipContent getClipById(Long id) {
        return storageService.getClipById(id.toString());
    }

    /**
     * 删除剪藏内容
     *
     * @param id 剪藏ID
     */
    public void deleteClip(Long id) {
        storageService.deleteClip(id);
    }

    /**
     * 根据分类获取剪藏内容
     *
     * @param category 分类值
     * @return 剪藏内容列表
     */
    public List<ClipContent> getClipsByCategory(String category) {
        return storageService.getClipsByCategory(category);
    }

    public List<ClipContent> getClipsByWorkflowStatus(String workflowStatus) {
        if (workflowStatus == null || workflowStatus.isBlank()) {
            return getAllClips();
        }
        String normalized = workflowStatus.trim();
        return getAllClips().stream()
                .filter(clip -> normalized.equalsIgnoreCase(resolveWorkflowStatus(clip)))
                .collect(Collectors.toList());
    }

    /**
     * 整理收件箱：默认AI分类，可手动覆盖类型/分类/标签
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> organizeInbox(OrganizeInboxRequest request) {
        String mode = (request == null || request.getMode() == null) ? "auto" : request.getMode().trim().toLowerCase();
        List<ClipContent> inboxClips = getClipsByWorkflowStatus(WORKFLOW_INBOX);
        int organizedCount = 0;

        for (ClipContent clip : inboxClips) {
            if (!"store-only".equals(clip.getType())) {
                continue;
            }

            if ("manual".equals(mode)) {
                applyManualOverrides(clip, request);
            } else {
                applyFullAiOrganize(clip);
            }

            if (clip.getType() == null || clip.getType().isBlank()) {
                clip.setType("ai-text");
            }
            if (clip.getCategory() == null || clip.getCategory().isBlank()) {
                clip.setCategory("default");
            }
            if (!"store-only".equals(clip.getType()) && needsAiOrganizeResult(clip)) {
                applyFullAiOrganize(clip);
            }
            clip.setWorkflowStatus(WORKFLOW_ORGANIZED);
            storageService.replaceClip(clip);
            organizedCount++;
        }

        Map<String, Object> result = new HashMap<>();
        result.put("status", "success");
        result.put("mode", mode);
        result.put("organizedCount", organizedCount);
        return result;
    }

    /**
     * 单条整理：支持任意剪藏记录
     */
    public Map<String, Object> organizeClip(Long clipId, OrganizeClipRequest request) {
        ClipContent clip = getClipById(clipId);
        if (clip == null) {
            throw new IllegalArgumentException("未找到对应剪藏记录: " + clipId);
        }

        String mode = (request == null || request.getMode() == null) ? "auto" : request.getMode().trim().toLowerCase();
        if ("manual".equals(mode)) {
            applyManualOverrides(clip, request);
        } else {
            applyFullAiOrganize(clip);
        }

        if (clip.getType() == null || clip.getType().isBlank()) {
            clip.setType("store-only");
        }
        if (clip.getCategory() == null || clip.getCategory().isBlank()) {
            clip.setCategory("default");
        }

        // 单条整理完成后标记为已整理
        clip.setWorkflowStatus(WORKFLOW_ORGANIZED);
        storageService.replaceClip(clip);

        Map<String, Object> result = new HashMap<>();
        result.put("status", "success");
        result.put("mode", mode);
        result.put("clipId", clip.getId());
        return result;
    }

    private String normalizeCategory(ClipRequest request) {
        String category = request.getCategory();
        if (category == null || category.isBlank()) {
            return null;
        }

        String normalized = category.trim();
        if (INBOX_CATEGORY.equalsIgnoreCase(normalized)) {
            // 兼容旧逻辑：category=inbox 迁移为 workflowStatus=inbox
            return null;
        }
        return normalized;
    }

    private String normalizeWorkflowStatus(ClipRequest request) {
        String requestType = normalizeRequestedType(request.getType());
        if (request.getWorkflowStatus() != null && !request.getWorkflowStatus().isBlank()) {
            String requestedStatus = request.getWorkflowStatus().trim().toLowerCase();
            if (WORKFLOW_INBOX.equals(requestedStatus) && !"store-only".equals(requestType)) {
                return WORKFLOW_ORGANIZED;
            }
            return requestedStatus;
        }

        if ("store-only".equals(requestType)) {
            return WORKFLOW_INBOX;
        }

        if (request.getCategory() != null
                && INBOX_CATEGORY.equalsIgnoreCase(request.getCategory().trim())
                && "store-only".equals(requestType)) {
            return WORKFLOW_INBOX;
        }
        return WORKFLOW_ORGANIZED;
    }

    private boolean isStructuredCapture(ClipRequest request) {
        return (request.getCaptureMethod() != null && !request.getCaptureMethod().isBlank())
                || (request.getSourceUrl() != null && !request.getSourceUrl().isBlank())
                || (request.getTitle() != null && !request.getTitle().isBlank())
                || (request.getSelectedText() != null && !request.getSelectedText().isBlank())
                || (request.getContextBefore() != null && !request.getContextBefore().isBlank())
                || (request.getContextAfter() != null && !request.getContextAfter().isBlank());
    }

    private void applyAutoOrganize(ClipContent clip) {
        if (clip == null || clip.getContent() == null || clip.getContent().isBlank()) {
            return;
        }

        Map<String, Object> aiResult = aiService.smartOrganize(clip.getContent());
        Object category = aiResult.get("category");
        if ((clip.getCategory() == null || clip.getCategory().isBlank()) && category instanceof String cat && !cat.isBlank()) {
            clip.setCategory(cat);
        }
        Object tags = aiResult.get("tags");
        if ((clip.getTags() == null || clip.getTags().isEmpty()) && tags instanceof List<?> tagList) {
            List<String> normalizedTags = tagList.stream().filter(String.class::isInstance).map(String.class::cast).collect(Collectors.toList());
            clip.setTags(normalizedTags);
        }
    }

    private boolean needsAiOrganizeResult(ClipContent clip) {
        return clip.getSummary() == null || clip.getSummary().isBlank()
                || clip.getAnalysis() == null || clip.getAnalysis().isBlank();
    }

    private void applyFullAiOrganize(ClipContent clip) {
        if (clip == null || clip.getContent() == null || clip.getContent().isBlank()) {
            return;
        }

        Map<String, Object> aiResult = aiService.processClipContent(clip.getContent(), true);
        Object summary = aiResult.get("summary");
        if (summary instanceof String value && !value.isBlank()) {
            clip.setSummary(value);
        }
        Object analysis = aiResult.get("analysis");
        if (analysis instanceof String value) {
            clip.setAnalysis(value);
        }
        Object tags = aiResult.get("tags");
        if (tags instanceof List<?> tagList) {
            List<String> normalizedTags = tagList.stream()
                    .filter(String.class::isInstance)
                    .map(String.class::cast)
                    .collect(Collectors.toList());
            clip.setTags(normalizedTags);
        }
        Object category = aiResult.get("category");
        if (category instanceof String value && !value.isBlank()) {
            clip.setCategory(value);
        }
        clip.setType("ai-text");
    }

    private void applyManualOverrides(ClipContent clip, OrganizeInboxRequest request) {
        if (request == null) {
            return;
        }
        if (request.getType() != null && !request.getType().isBlank()) {
            clip.setType(request.getType().trim());
        } else if (clip.getType() == null || clip.getType().isBlank()) {
            clip.setType("store-only");
        }
        if (request.getCategory() != null && !request.getCategory().isBlank()) {
            clip.setCategory(request.getCategory().trim());
        }
        if (request.getTags() != null && !request.getTags().isEmpty()) {
            clip.setTags(request.getTags().stream().filter(tag -> tag != null && !tag.isBlank()).map(String::trim).collect(Collectors.toList()));
        }
    }

    private void applyManualOverrides(ClipContent clip, OrganizeClipRequest request) {
        if (request == null) {
            return;
        }
        if (request.getType() != null && !request.getType().isBlank()) {
            clip.setType(request.getType().trim());
        } else if (clip.getType() == null || clip.getType().isBlank()) {
            clip.setType("store-only");
        }
        if (request.getCategory() != null && !request.getCategory().isBlank()) {
            clip.setCategory(request.getCategory().trim());
        }
        if (request.getTags() != null && !request.getTags().isEmpty()) {
            clip.setTags(request.getTags().stream().filter(tag -> tag != null && !tag.isBlank()).map(String::trim).collect(Collectors.toList()));
        }
    }

    private String normalizeType(String requestType, String workflowStatus) {
        if (requestType != null && !requestType.isBlank()) {
            return requestType.trim();
        }
        return "ai-text";
    }

    private String normalizeRequestedType(String requestType) {
        if (requestType != null && !requestType.isBlank()) {
            return requestType.trim();
        }
        return "ai-text";
    }

    private String resolveWorkflowStatus(ClipContent clip) {
        if (clip.getWorkflowStatus() != null && !clip.getWorkflowStatus().isBlank()) {
            return clip.getWorkflowStatus();
        }
        // 兼容旧数据：仅将历史 category=inbox 且只存储内容的记录视为 inbox 状态
        if (INBOX_CATEGORY.equalsIgnoreCase(clip.getCategory()) && "store-only".equals(clip.getType())) {
            return WORKFLOW_INBOX;
        }
        return WORKFLOW_ORGANIZED;
    }

    private String firstNonBlank(String primary, String fallback) {
        if (primary != null && !primary.isBlank()) {
            return primary.trim();
        }
        if (fallback != null && !fallback.isBlank()) {
            return fallback.trim();
        }
        return fallback;
    }

    private String normalizeCaptureMethod(String captureMethod) {
        if (captureMethod == null || captureMethod.isBlank()) {
            return null;
        }
        String normalized = captureMethod.trim().toLowerCase();
        if (SUPPORTED_CAPTURE_METHODS.contains(normalized)) {
            return normalized;
        }
        return "popup";
    }

    /**
     * 生成笔记文件名
     * 格式：{category}_{yyMMdd}
     *
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
     *
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
