package com.example.clip.service;

import com.example.clip.config.WikiConfig;
import com.example.clip.core.AiService;
import com.example.clip.dto.ClipEditRequest;
import com.example.clip.dto.ClipRequest;
import com.example.clip.dto.OrganizeClipRequest;
import com.example.clip.dto.OrganizeInboxRequest;
import com.example.clip.model.ClipContent;
import com.example.clip.utils.ImageUtils;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * 剪藏业务核心服务
 * <p>
 * 负责剪藏内容的完整生命周期管理，包括：
 * <ul>
 *   <li>多种类型的剪藏保存（AI文本、仅存储、链接AI、文档AI）</li>
 *   <li>图片上传、Base64解码与存储</li>
 *   <li>AI 分析（摘要、标签、分类）</li>
 *   <li>收件箱（inbox）工作流管理</li>
 *   <li>剪藏内容的手动/AI 整理</li>
 * </ul>
 * 工作流状态：inbox（待整理）→ organized（已整理）。
 * </p>
 *
 * @see FileStorageService
 * @see AiService
 */
@Service
public class ClipService {

    /** 收件箱分类名称常量 */
    public static final String INBOX_CATEGORY = "inbox";
    /** 工作流状态：待整理（收件箱中） */
    public static final String WORKFLOW_INBOX = "inbox";
    /** 工作流状态：已整理 */
    public static final String WORKFLOW_ORGANIZED = "organized";
    /** 支持的浏览器捕获方式白名单，用于校验和规范化 */
    private static final Set<String> SUPPORTED_CAPTURE_METHODS = Set.of(
            "popup", "context-menu", "shortcut", "floating-button", "system-share", "system-clip"
    );

    /** 剪藏文本内容最大长度（字符），防止超大请求导致内存/AI token 超限 */
    private static final int MAX_CONTENT_LENGTH = 200_000;

    private static final Logger logger = LoggerFactory.getLogger(ClipService.class);
    /** 文件存储服务，负责 JSON 文件持久化 */
    private final FileStorageService storageService;
    /** AI 服务，负责内容分析、摘要、分类等 */
    private final AiService aiService;
    /** 链接解析服务，负责爬取网页内容 */
    private final LinkParseService linkParseService;
    /** 文档解析服务，负责解析 PDF/DOCX/TXT 等文档 */
    private final DocumentParseService documentParseService;
    /** 图片工具类，负责图片验证和存储 */
    private final ImageUtils imageUtils;
    /** Wiki 配置，提供 vault 路径用于读取源文件 */
    private final WikiConfig wikiConfig;

    /** 整理存储根目录（旧图片迁移定位用） */
    private final String organizedStoragePath;

    /** AI 分析状态：分析中 */
    public static final String ANALYSIS_PENDING = "pending";
    /** AI 分析状态：已完成 */
    public static final String ANALYSIS_READY = "ready";
    /** AI 分析状态：失败 */
    public static final String ANALYSIS_FAILED = "failed";
    /** AI 分析状态：无需分析（store-only） */
    public static final String ANALYSIS_EMPTY = "empty";

    /**
     * 异步 AI 分析执行器（守护线程，固定 2 线程）。
     * <p>
     * 剪藏保存后立即返回（analysisStatus=pending），AI 分析在此线程池中异步执行，
     * 避免同步阻塞 HTTP 请求线程（原 link-ai 最坏可阻塞 90s）。
     * </p>
     */
    private final ExecutorService aiExecutor = Executors.newFixedThreadPool(2, r -> {
        Thread t = new Thread(r, "clip-ai-worker");
        t.setDaemon(true);
        return t;
    });

    /**
     * 构造器注入所有依赖
     *
     * @param storageService       文件存储服务
     * @param aiService            AI 服务
     * @param linkParseService     链接解析服务
     * @param documentParseService 文档解析服务
     * @param imageUtils           图片工具类
     * @param wikiConfig           Wiki 配置
     */
    public ClipService(FileStorageService storageService, AiService aiService,
                       LinkParseService linkParseService, DocumentParseService documentParseService,
                       ImageUtils imageUtils, WikiConfig wikiConfig,
                       @Value("${clip.organized-storage.path:./clip-organized}") String organizedStoragePath) {
        this.storageService = storageService;
        this.aiService = aiService;
        this.linkParseService = linkParseService;
        this.documentParseService = documentParseService;
        this.imageUtils = imageUtils;
        this.wikiConfig = wikiConfig;
        this.organizedStoragePath = organizedStoragePath;
    }

    /**
     * 容器销毁时关闭异步 AI 执行器，避免线程泄漏。
     */
    @PreDestroy
    public void shutdown() {
        aiExecutor.shutdown();
    }

    /**
     * 保存剪藏内容（核心方法，支持图片上传）
     * <p>
     * 根据类型（type）执行不同的处理逻辑：
     * <ul>
     *   <li>store-only：仅存储原文，不做 AI 分析</li>
     *   <li>link-ai：爬取链接内容 → AI 分析</li>
     *   <li>doc-ai：解析文档（PDF/DOCX等）→ AI 分析</li>
     *   <li>ai-text（默认）：直接 AI 分析文本内容</li>
     * </ul>
     * 对于 ai-text 和 store-only 类型，还会处理图片上传（Base64 解码 → 验证 → 存储）。
     * </p>
     *
     * @param content       剪藏文本内容
     * @param type          剪藏类型（ai-text/store-only/link-ai/doc-ai）
     * @param source        来源信息
     * @param category      分类（可为 null，AI 会自动分类）
     * @param fileData      文件数据（Base64 编码，仅 doc-ai 类型使用）
     * @param fileName      文件名（仅 doc-ai 类型使用）
     * @param imageDataList 图片数据列表（Base64 编码的图片，已废弃，兼容解析）
     * @param imagePaths    图片相对路径清单（推荐，media/{yyMM}/{uuid}.{ext}）
     * @return 保存后的剪藏内容对象
     */
    /**
     * 保存剪藏内容（兼容旧签名，imagePaths 置空）。
     */
    public ClipContent saveClip(String content, String type, String source, String category,
                                String fileData, String fileName, List<ClipRequest.ImageData> imageDataList) {
        return saveClip(content, type, source, category, fileData, fileName, imageDataList, null);
    }

    public ClipContent saveClip(String content, String type, String source, String category,
                                String fileData, String fileName, List<ClipRequest.ImageData> imageDataList,
                                List<String> imagePaths) {
        // 内容长度限制：防止超大请求导致内存与 AI token 超限
        if (content != null && content.length() > MAX_CONTENT_LENGTH) {
            throw new IllegalArgumentException("剪藏内容过长（超过 " + MAX_CONTENT_LENGTH + " 字符），请精简后重试");
        }
        ClipContent clipContent = new ClipContent(content, type, source, category);

        // 处理图片：新链路 imagePaths（权威清单，content 已含光标处插入的 Markdown 引用）+ 旧 base64 兼容解析
        if ("ai-text".equals(type) || "store-only".equals(type)) {
            List<String> validImagePaths = new ArrayList<>();

            // 新链路：校验 imagePaths 存在于 media 根目录，作为权威引用清单
            if (imagePaths != null) {
                for (String path : imagePaths) {
                    if (path != null && imageUtils.resolveMediaFile(path) != null) {
                        validImagePaths.add(path);
                    } else {
                        logger.warn("[ClipService] imagePath not found in media root: {}", path);
                    }
                }
            }

            // 旧链路兼容：base64 imageDataList（已废弃，不推荐）——存 media 根目录并追加引用
            if (imageDataList != null && !imageDataList.isEmpty()) {
                try {
                    for (ClipRequest.ImageData imageData : imageDataList) {
                        if (imageData.getBase64Data() == null || imageData.getBase64Data().isEmpty()) {
                            continue;
                        }
                        byte[] imageBytes = Base64.getDecoder().decode(imageData.getBase64Data());
                        if (imageBytes.length > 10 * 1024 * 1024) {
                            logger.warn("Image too large (legacy base64): {}", imageData.getFileName());
                            continue;
                        }
                        String imagePath = imageUtils.storeImage(imageBytes, imageData.getFileName());
                        if (imagePath == null) {
                            logger.warn("Invalid image data (legacy base64): {}", imageData.getFileName());
                            continue;
                        }
                        validImagePaths.add(imagePath);
                        clipContent.setContent((clipContent.getContent() == null ? "" : clipContent.getContent())
                                + "\n![图片](" + imagePath + ")\n");
                    }
                } catch (Exception e) {
                    logger.error("Failed to process legacy images: {}", e.getMessage(), e);
                    // 图片处理失败不影响文本内容的保存，继续后续流程
                }
            }

            clipContent.setImagePaths(validImagePaths);
        }

        // 根据类型执行不同的处理逻辑
        // AI 分析统一改为异步：先以 pending 状态入库并立即返回，后台线程执行分析后更新为 ready/failed
        switch (type != null ? type : "ai-text") {
            case "store-only":
                // 仅存储模式：先尝试识别 AI 结构化内容，匹配则自动填充字段
                if (!tryParseStructuredContent(clipContent)) {
                    // 非结构化内容，原文即摘要
                    clipContent.setSummary(content != null ? content : "");
                    clipContent.setAnalysis("");
                }
                clipContent.setAnalysisStatus(ANALYSIS_EMPTY);
                break;

            case "link-ai":
                // 链接 AI 模式：同步爬取网页内容（含总超时断路器），AI 分析异步执行
                String originalUrl = content;
                String crawledText = linkParseService.parseUrl(content);
                // 存储原始 URL 和爬取到的文本
                clipContent.setContent("来源链接: " + originalUrl + "\n\n" + crawledText);
                clipContent.setAnalysisStatus(ANALYSIS_PENDING);
                break;

            case "doc-ai":
                // 文档 AI 模式：同步解析文档内容，AI 分析异步执行
                try {
                    byte[] fileBytes = Base64.getDecoder().decode(fileData);

                    // 先存储源文件到 documents/ 独立目录（与图片分离，决策 D-F）
                    String attachmentPath = imageUtils.storeDocument(fileBytes, fileName);

                    // 记录附件相对路径（documents/{uuid}.{ext}）
                    clipContent.setAttachmentPath(attachmentPath);

                    // 解析文档内容为纯文本
                    String parsedText = documentParseService.parseDocument(fileBytes, fileName, attachmentPath);
                    clipContent.setContent(parsedText);
                    clipContent.setAnalysisStatus(ANALYSIS_PENDING);
                } catch (Exception e) {
                    logger.error("[ClipService] Document parse failed: {}", e.getMessage(), e);
                    clipContent.setSummary("[文档解析失败] " + e.getMessage());
                    clipContent.setAnalysis("");
                    clipContent.setAnalysisStatus(ANALYSIS_FAILED);
                }
                break;

            case "ai-text":
            default:
                // AI 文本模式（默认）：先检测是否已是 AI 结构化内容，是则跳过 AI 调用
                if (tryParseStructuredContent(clipContent)) {
                    clipContent.setAnalysisStatus(ANALYSIS_READY);
                } else {
                    // 非结构化内容，异步调用 AI 分析
                    clipContent.setAnalysisStatus(ANALYSIS_PENDING);
                }
                break;
        }

        ClipContent savedClip = storageService.saveClip(clipContent);
        return savedClip;
    }

    /**
     * 保存剪藏内容（结构化请求版本）
     * <p>
     * 将 {@link ClipRequest} 结构化请求转换为内部参数后调用核心保存方法。
     * 此方法会额外处理标题、来源 URL、捕获方式等工作流元数据。
     * </p>
     *
     * @param request 结构化剪藏请求
     * @return 保存后的剪藏内容
     */
    public ClipContent saveClip(ClipRequest request) {
        // 规范化工作流状态：根据请求类型和 category 推断 inbox/organized
        String workflowStatus = normalizeWorkflowStatus(request);
        // 规范化分类：兼容旧版 category=inbox 的迁移逻辑
        String normalizedCategory = normalizeCategory(request);
        // 规范化类型：确保 type 不为空
        String effectiveType = normalizeType(request.getType(), workflowStatus);
        // 优先使用 sourceUrl，其次使用 source
        String normalizedSource = firstNonBlank(request.getSourceUrl(), request.getSource());
        ClipContent clipContent = saveClip(
                request.getContent(),
                effectiveType,
                normalizedSource,
                normalizedCategory,
                request.getFileData(),
                request.getFileName(),
                request.getImageDataList(),
                request.getImagePaths()
        );

        // 设置浏览器插件传来的结构化元数据
        clipContent.setTitle(request.getTitle());
        clipContent.setSourceUrl(firstNonBlank(request.getSourceUrl(), request.getSource()));
        clipContent.setSiteName(request.getSiteName());
        clipContent.setCapturedAt(request.getCapturedAt());
        clipContent.setSelectedText(request.getSelectedText());
        clipContent.setContextBefore(request.getContextBefore());
        clipContent.setContextAfter(request.getContextAfter());
        clipContent.setCaptureMethod(normalizeCaptureMethod(request.getCaptureMethod()));
        clipContent.setWorkflowStatus(workflowStatus);
        // 传递用户自己的思考
        clipContent.setMyThoughts(request.getMyThoughts());
        clipContent.setContentFormat(request.getContentFormat());
        clipContent.setSourceFileName(request.getSourceFileName());
        clipContent.setSourceEncoding(request.getSourceEncoding());
        clipContent.setSourceLineEnding(request.getSourceLineEnding());
        // 覆盖摘要：若 request 显式传入 summary（非空且非空白），优先使用，避免 store-only 分支把 content 当 summary
        // 场景：agent 已整理好简短摘要，不需要后端 fallback 到原文
        if (request.getSummary() != null && !request.getSummary().trim().isEmpty()) {
            clipContent.setSummary(request.getSummary());
        }

        return storageService.saveClip(clipContent);
    }

    // ==================== 结构化内容自动识别 ====================

    /**
     * 尝试解析 AI 生成的结构化内容（如其他 AI 工具产出的 Markdown 格式分析结果）。
     * <p>
     * 自动检测内容是否包含"核心摘要"、"分析"、"标签"等结构化章节标记，
     * 如果匹配则将各段内容映射到 ClipContent 的 summary、analysis、tags 字段，
     * 避免重复调用 AI 接口，实现"一键安装"结构化存储。
     * </p>
     *
     * @param clipContent 剪藏内容对象（会被直接修改）
     * @return true 表示已识别并填充结构化字段；false 表示内容非结构化格式
     */
    private boolean tryParseStructuredContent(ClipContent clipContent) {
        String content = clipContent.getContent();
        if (content == null || content.trim().isEmpty()) {
            return false;
        }

        boolean hasSummary = content.matches("(?s).*#{1,3}\\s*核心摘要.*");
        boolean hasAnalysis = content.matches("(?s).*#{1,3}\\s*分析.*");
        // 至少包含摘要或分析才算结构化内容
        if (!hasSummary && !hasAnalysis) {
            return false;
        }

        logger.info("[ClipService] 检测到 AI 结构化内容，自动解析字段");

        if (hasSummary) {
            String summary = extractMarkdownSection(content, "核心摘要");
            if (summary != null && !summary.trim().isEmpty()) {
                clipContent.setSummary(summary.trim());
            }
        }

        if (hasAnalysis) {
            String analysis = extractMarkdownSection(content, "分析");
            if (analysis != null && !analysis.trim().isEmpty()) {
                clipContent.setAnalysis(analysis.trim());
            }
        }

        // 解析标签（## 标签 章节下的反引号标签）
        List<String> tags = extractTagsFromMarkdown(content);
        if (tags != null && !tags.isEmpty()) {
            if (clipContent.getTags() == null || clipContent.getTags().isEmpty()) {
                clipContent.setTags(tags);
            }
        }

        return true;
    }

    /**
     * 从 Markdown 内容中提取指定章节的文本内容。
     * <p>
     * 章节由 {@code ## 标题名} 开始，到下一个同级或更高级标题、分隔线（---）或文末结束。
     * 支持一级到三级标题（#、##、###）。
     * </p>
     *
     * @param content     Markdown 全文
     * @param sectionName 章节名称（如"核心摘要"、"分析"、"标签"）
     * @return 章节正文内容；未找到返回 null
     */
    private String extractMarkdownSection(String content, String sectionName) {
        // 匹配 #/##/### + 章节名，内容捕获到下一个一级/二级标题、分隔线（---）或文末
        // 三级标题（###）视为子章节，包含在父章节内容中
        Pattern pattern = Pattern.compile(
            "(?s)^#{1,3}\\s*" + Pattern.quote(sectionName) + "\\s*\\n(.*?)(?=^#{1,2}\\s|\\n---\\s*$|\\Z)",
            Pattern.MULTILINE
        );
        Matcher matcher = pattern.matcher(content);
        if (matcher.find()) {
            return matcher.group(1).trim();
        }
        return null;
    }

    /**
     * 从 Markdown 内容的"标签"章节提取标签列表。
     * <p>
     * 支持两种标签格式：
     * <ul>
     *   <li>反引号格式：{@code `标签1` `标签2` `标签3`}</li>
     *   <li>列表格式：{@code - 标签1} 或 {@code * 标签1}</li>
     * </ul>
     * </p>
     *
     * @param content Markdown 全文
     * @return 标签列表；未找到返回 null
     */
    private List<String> extractTagsFromMarkdown(String content) {
        String tagSection = extractMarkdownSection(content, "标签");
        if (tagSection == null || tagSection.trim().isEmpty()) {
            return null;
        }

        List<String> tags = new ArrayList<>();

        // 反引号格式：`标签`
        Pattern backtickPattern = Pattern.compile("`([^`]+)`");
        Matcher backtickMatcher = backtickPattern.matcher(tagSection);
        while (backtickMatcher.find()) {
            String tag = backtickMatcher.group(1).trim();
            if (!tag.isEmpty() && !tags.contains(tag)) {
                tags.add(tag);
            }
        }

        // 如果反引号没匹配到，尝试列表格式
        if (tags.isEmpty()) {
            Pattern listPattern = Pattern.compile("^[-*+]\\s+(.+)$", Pattern.MULTILINE);
            Matcher listMatcher = listPattern.matcher(tagSection);
            while (listMatcher.find()) {
                String tag = listMatcher.group(1).trim();
                if (!tag.isEmpty() && !tags.contains(tag)) {
                    tags.add(tag);
                }
            }
        }

        return tags.isEmpty() ? null : tags;
    }

    /**
     * AI 处理：一次性生成摘要、分析和标签
     * <p>
     * 调用 AI 服务对剪藏内容进行分析，返回结果包含摘要、分析文本、
     * 标签列表和分类建议。如果剪藏内容已有标签或分类，则不会覆盖。
     * 如果 AI 调用失败，则设置默认的失败提示。
     * </p>
     *
     * @param clipContent   剪藏内容对象（会被直接修改）
     * @param useAiCategory 是否使用 AI 生成的分类（当用户未指定分类时为 true）
     */
    @SuppressWarnings("unchecked")
    private void processWithAi(ClipContent clipContent, boolean useAiCategory) {
        try {
            // 检测是否有用户思考，有则使用带思考的 AI 分析方法
            String myThoughts = clipContent.getMyThoughts();
            String sourceText = resolveAiSourceText(clipContent);
            Map<String, Object> aiResult;
            if (myThoughts != null && !myThoughts.trim().isEmpty()) {
                aiResult = aiService.processClipContent(sourceText, useAiCategory, myThoughts);
            } else {
                aiResult = aiService.processClipContent(sourceText, useAiCategory);
            }
            // 提取各字段，若 AI 未返回则使用默认值；使用 instanceof 类型安全取值，避免 ClassCastException
            Object summaryObj = aiResult.get("summary");
            Object analysisObj = aiResult.get("analysis");
            clipContent.setSummary(summaryObj instanceof String s && !s.isBlank() ? s : "摘要生成失败");
            clipContent.setAnalysis(analysisObj instanceof String a ? a : "");
            Object tagsObj = aiResult.get("tags");
            List<String> tags = tagsObj instanceof List<?> tagList
                    ? tagList.stream().filter(String.class::isInstance).map(String.class::cast).collect(Collectors.toList())
                    : List.of();
            // 如果剪藏内容已有标签，则保留用户标签，不覆盖
            if (clipContent.getTags() == null || clipContent.getTags().isEmpty()) {
                clipContent.setTags(tags);
            }
            // 如果开启了 AI 分类且剪藏内容未设置分类，则使用 AI 分类
            if (useAiCategory && (clipContent.getCategory() == null || clipContent.getCategory().isEmpty())) {
                Object categoryObj = aiResult.get("category");
                if (categoryObj instanceof String cat && !cat.isBlank()) {
                    clipContent.setCategory(cat);
                }
            }
        } catch (Exception e) {
            logger.error("[ClipService] AI 处理失败", e);
            // AI 处理失败时设置默认提示，不影响内容保存
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
     * 使用文本编辑器提交的白名单字段更新剪藏。
     *
     * 更新后使用 replaceClip 持久化，确保分类改变时旧分类文件中的记录会被移除。
     * AI 分析、发散总结、创建时间和附件路径均保持不变。
     */
    public ClipContent updateClipFromEditor(Long id, ClipEditRequest request) {
        ClipContent clip = getClipById(id);
        if (clip == null) {
            return null;
        }

        String previousContent = clip.getContent();
        if (request.getContent() != null) {
            clip.setContent(request.getContent());
            if ("store-only".equals(clip.getType())
                    && (clip.getSummary() == null || clip.getSummary().equals(previousContent))) {
                clip.setSummary(request.getContent());
            }
        }
        // Web Clipper 剪藏：正文单独存于 bodyContent，编辑保存时更新正文并保留 content 中的 wiki-link
        if (request.getBodyContent() != null) {
            clip.setBodyContent(request.getBodyContent());
        }
        if (request.getTitle() != null) {
            clip.setTitle(request.getTitle().trim());
        }
        clip.setCategory(request.getCategory() == null || request.getCategory().isBlank()
                ? null
                : request.getCategory().trim());
        if (request.getTags() != null) {
            clip.setTags(new ArrayList<>(request.getTags().stream().limit(10).toList()));
        }
        clip.setMyThoughts(request.getMyThoughts() == null || request.getMyThoughts().isBlank()
                ? null
                : request.getMyThoughts());
        if (request.getCaptureMethod() != null) {
            clip.setCaptureMethod(request.getCaptureMethod());
        }
        clip.setSelectedText(request.getSelectedText());
        clip.setContextBefore(request.getContextBefore());
        clip.setContextAfter(request.getContextAfter());
        clip.setContentFormat(request.getContentFormat());
        clip.setSourceFileName(request.getSourceFileName());
        clip.setSourceEncoding(request.getSourceEncoding());
        clip.setSourceLineEnding(request.getSourceLineEnding());

        // 图文一体：重扫 content 中 media 图片引用，reconcile imagePaths（权威清单）
        clip.setImagePaths(extractImagePathsFromContent(clip.getContent()));

        logger.info("[Editor] Updating clip id={}, chars={}, category={}, images={}",
                id,
                clip.getContent() == null ? 0 : clip.getContent().length(),
                clip.getCategory(),
                clip.getImagePaths() == null ? 0 : clip.getImagePaths().size());
        return storageService.replaceClip(clip);
    }

    /**
     * 从 Markdown content 中提取 media 图片相对路径（去重、保序）。
     * 匹配 {@code ![alt](media/{yyMM}/{uuid}.{ext})} 引用。
     *
     * @param content Markdown 内容
     * @return media 相对路径清单
     */
    public List<String> extractImagePathsFromContent(String content) {
        List<String> paths = new ArrayList<>();
        if (content == null) {
            return paths;
        }
        Pattern pattern = Pattern.compile("!\\[[^\\]]*\\]\\((media/\\d{4}/[\\w.-]+\\.\\w{1,10})\\)");
        Matcher matcher = pattern.matcher(content);
        while (matcher.find()) {
            String path = matcher.group(1);
            if (!paths.contains(path)) {
                paths.add(path);
            }
        }
        return paths;
    }

    /**
     * 清理未被任何剪藏引用的孤儿图片。
     * <p>
     * 扫描 media/ 目录下所有文件，删除不在任何剪藏 imagePaths 中的文件
     * （含"上传后未提交剪藏"产生的孤儿）。.tmp 临时文件一并清理。
     * </p>
     *
     * @return 清理的文件数量
     */
    public int cleanupOrphanMedia() {
        int cleaned = 0;
        try {
            Path mediaRoot = imageUtils.getMediaRoot();
            if (!Files.exists(mediaRoot)) {
                return 0;
            }
            Set<String> referenced = new HashSet<>();
            for (ClipContent clip : storageService.getAllClips()) {
                if (clip.getImagePaths() != null) {
                    referenced.addAll(clip.getImagePaths());
                }
            }
            try (var stream = Files.walk(mediaRoot)) {
                List<Path> files = stream.filter(Files::isRegularFile).toList();
                for (Path file : files) {
                    String rel = "media/" + mediaRoot.relativize(file).toString().replace('\\', '/');
                    if (!referenced.contains(rel)) {
                        Files.deleteIfExists(file);
                        cleaned++;
                        logger.info("[ClipService] cleanup orphan media: {}", rel);
                    }
                }
            }
        } catch (IOException e) {
            logger.error("[ClipService] cleanupOrphanMedia failed", e);
        }
        return cleaned;
    }

    /**
     * 迁移旧图片数据（migrate-images）。
     * <p>
     * 解析 content 中旧引用 {@code /api/clip/image/{cat}/{file}}，从 organized assets
     * 目录定位旧文件（兼容 noteFileName 子目录），复制到 media 根目录（uuid 命名），
     * 重写 content 引用为 {@code media/{yyMM}/{uuid}.{ext}}，回填 imagePaths。
     * 幂等：文件缺失的引用跳过；迁移后旧文件保留（由 cleanup-orphans 统一清理）。
     * </p>
     *
     * @return 迁移的剪藏数量
     */
    public int migrateImages() {
        int migrated = 0;
        List<ClipContent> allClips = storageService.getAllClips();
        for (ClipContent clip : allClips) {
            String content = clip.getContent();
            if (content == null || !content.contains("/api/clip/image/")) {
                continue;
            }
            String newContent = content;
            boolean changed = false;
            List<String> newImagePaths = new ArrayList<>(
                    clip.getImagePaths() == null ? List.of() : clip.getImagePaths());

            Pattern oldRef = Pattern.compile("!\\[[^\\]]*\\]\\(/api/clip/image/([^/]+)/([^\\)]+)\\)");
            Matcher matcher = oldRef.matcher(content);
            while (matcher.find()) {
                String cat = matcher.group(1);
                String file = matcher.group(2);
                Path oldFile = findLegacyImageFile(cat, file);
                if (oldFile == null) {
                    logger.warn("[Migrate] legacy image file not found: cat={}, file={}", cat, file);
                    continue;
                }
                try {
                    byte[] data = Files.readAllBytes(oldFile);
                    String rel = imageUtils.storeImage(data, file);
                    if (rel == null) {
                        continue;
                    }
                    newContent = newContent.replace("/api/clip/image/" + cat + "/" + file, rel);
                    if (!newImagePaths.contains(rel)) {
                        newImagePaths.add(rel);
                    }
                    changed = true;
                    migrated++;
                } catch (IOException e) {
                    logger.warn("[Migrate] copy legacy image failed: {}", oldFile, e);
                }
            }
            if (changed) {
                clip.setContent(newContent);
                clip.setImagePaths(newImagePaths);
                storageService.saveClip(clip);
            }
        }
        return migrated;
    }

    /**
     * 在 organized assets 目录中按文件名定位旧图片（兼容 noteFileName 子目录）。
     */
    private Path findLegacyImageFile(String category, String fileName) {
        try {
            String catDir = ImageUtils.getCategoryDir(category);
            Path assetsRoot = Paths.get(organizedStoragePath).resolve(catDir).resolve("assets");
            if (!Files.exists(assetsRoot)) {
                return null;
            }
            try (var stream = Files.walk(assetsRoot)) {
                return stream.filter(Files::isRegularFile)
                        .filter(p -> p.getFileName().toString().equals(fileName))
                        .findFirst()
                        .orElse(null);
            }
        } catch (IOException e) {
            logger.warn("[Migrate] search legacy image failed: category={}, file={}", category, fileName, e);
            return null;
        }
    }

    /**
     * 删除剪藏内容
     *
     * @param id 剪藏ID
     */
    public void deleteClip(Long id) {
        ClipContent clip = getClipById(id);
        storageService.deleteClip(id);
        // 生命周期：删除该剪藏引用的图片（未被其他剪藏引用时）
        if (clip != null && clip.getImagePaths() != null && !clip.getImagePaths().isEmpty()) {
            deleteUnreferencedImages(clip.getImagePaths());
        }
    }

    /**
     * 删除未被任何其他剪藏引用的图片文件（引用计数语义）。
     *
     * @param imagePaths 待删除候选的图片相对路径清单
     */
    private void deleteUnreferencedImages(List<String> imagePaths) {
        List<ClipContent> allClips = storageService.getAllClips();
        for (String path : imagePaths) {
            boolean referencedElsewhere = allClips.stream()
                    .filter(c -> c.getImagePaths() != null)
                    .anyMatch(c -> c.getImagePaths().contains(path));
            if (referencedElsewhere) {
                continue;
            }
            try {
                Path file = imageUtils.resolveMediaFile(path);
                if (file != null) {
                    Files.deleteIfExists(file);
                    logger.info("[ClipService] delete unreferenced image: {}", path);
                }
            } catch (IOException e) {
                logger.warn("[ClipService] delete image failed: {}", path, e);
            }
        }
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

    /**
     * 根据工作流状态获取剪藏内容
     * <p>
     * 如果工作流状态为 null 或空，则返回所有剪藏。
     * 否则过滤出匹配工作流状态的内容。兼容旧数据中没有 workflowStatus 字段的记录。
     * </p>
     *
     * @param workflowStatus 工作流状态（inbox/organized），可为 null
     * @return 匹配的剪藏内容列表
     */
    public List<ClipContent> getClipsByWorkflowStatus(String workflowStatus) {
        if (workflowStatus == null || workflowStatus.isBlank()) {
            return getAllClips();
        }
        String normalized = workflowStatus.trim();
        // 流式过滤：先获取全部，再按状态筛选
        return getAllClips().stream()
                .filter(clip -> normalized.equalsIgnoreCase(resolveWorkflowStatus(clip)))
                .collect(Collectors.toList());
    }

    /**
     * 批量整理收件箱
     * <p>
     * 遍历所有 inbox 状态的剪藏记录，根据模式（auto/manual）执行整理：
     * <ul>
     *   <li>auto 模式：调用 AI 自动生成摘要、分析、标签、分类</li>
     *   <li>manual 模式：使用请求中指定的类型、分类、标签覆盖</li>
     * </ul>
     * 整理完成后，将工作流状态改为 organized 并持久化。
     * 注意：仅处理 store-only 类型的剪藏，其他类型（如 ai-text）跳过。
     * </p>
     *
     * @param request 整理请求（包含 mode 和可选的覆盖字段）
     * @return 整理结果，包含状态、模式、整理数量
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> organizeInbox(OrganizeInboxRequest request) {
        // 默认为 auto 模式
        String mode = (request == null || request.getMode() == null) ? "auto" : request.getMode().trim().toLowerCase();
        List<ClipContent> inboxClips = getClipsByWorkflowStatus(WORKFLOW_INBOX);
        int organizedCount = 0;

        for (ClipContent clip : inboxClips) {
            // 只整理 store-only 类型的剪藏（其他类型已有 AI 分析结果）
            if (!"store-only".equals(clip.getType())) {
                continue;
            }

            if ("manual".equals(mode)) {
                // 手动模式：使用请求中指定的字段覆盖
                applyManualOverrides(clip, request);
            } else {
                // 自动模式：调用 AI 进行全面整理
                applyFullAiOrganize(clip);
            }

            // 确保类型和分类不为空，设置默认值
            if (clip.getType() == null || clip.getType().isBlank()) {
                clip.setType("ai-text");
            }
            if (clip.getCategory() == null || clip.getCategory().isBlank()) {
                clip.setCategory("default");
            }
            // 如果 type 已变更但缺少 AI 分析结果，补充 AI 整理
            if (!"store-only".equals(clip.getType()) && needsAiOrganizeResult(clip)) {
                applyFullAiOrganize(clip);
            }
            // 标记为已整理并持久化
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
     * 单条剪藏整理
     * <p>
     * 对指定 ID 的剪藏记录执行整理操作。支持 auto 和 manual 两种模式。
     * 整理完成后自动标记为 organized 状态。
     * </p>
     *
     * @param clipId  剪藏记录 ID
     * @param request 整理请求（包含 mode 和可选的覆盖字段）
     * @return 整理结果，包含状态、模式、clipId
     * @throws IllegalArgumentException 如果指定 ID 的剪藏记录不存在
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

    /**
     * 规范化分类字段
     * <p>
     * 如果分类为 inbox，则迁移为 workflowStatus=inbox（兼容旧逻辑），
     * 此时 category 返回 null 以便后续 AI 自动分类。
     * </p>
     */
    private String normalizeCategory(ClipRequest request) {
        String category = request.getCategory();
        if (category == null || category.isBlank()) {
            return null;
        }

        String normalized = category.trim();
        if (INBOX_CATEGORY.equalsIgnoreCase(normalized)) {
            // 兼容旧逻辑：category=inbox 迁移为 workflowStatus=inbox，category 置空让 AI 分类
            return null;
        }
        return normalized;
    }

    /**
     * 规范化工作流状态
     * <p>
     * 根据请求类型和分类推断工作流状态：
     * store-only 类型默认进入 inbox，非 store-only 默认为 organized。
     * </p>
     */
    private String normalizeWorkflowStatus(ClipRequest request) {
        String requestType = normalizeRequestedType(request.getType());
        // 如果请求中明确指定了工作流状态，优先使用
        if (request.getWorkflowStatus() != null && !request.getWorkflowStatus().isBlank()) {
            String requestedStatus = request.getWorkflowStatus().trim().toLowerCase();
            // 非 store-only 类型出现在 inbox 不合理，强制改为 organized
            if (WORKFLOW_INBOX.equals(requestedStatus) && !"store-only".equals(requestType)) {
                return WORKFLOW_ORGANIZED;
            }
            return requestedStatus;
        }

        // store-only 类型默认进入 inbox 等待整理
        if ("store-only".equals(requestType)) {
            return WORKFLOW_INBOX;
        }

        // 兼容旧逻辑：category=inbox 且 store-only 类型 → inbox
        if (request.getCategory() != null
                && INBOX_CATEGORY.equalsIgnoreCase(request.getCategory().trim())
                && "store-only".equals(requestType)) {
            return WORKFLOW_INBOX;
        }
        // 其他情况默认已整理
        return WORKFLOW_ORGANIZED;
    }

    /**
     * 获取用于 AI 分析的源文本。
     * <p>
     * Web Clipper 同步的剪藏中 {@code content} 仅保留 Obsidian wiki-link 引用，
     * 真实正文存放在 {@code bodyContent}。AI 整理、发散总结等方法应优先使用
     * bodyContent，避免把 wiki-link 文本直接交给大模型。
     * </p>
     *
     * @param clip 剪藏对象
     * @return AI 分析用的源文本（bodyContent 非空时优先，否则退回 content）
     */
    public String resolveAiSourceText(ClipContent clip) {
        if (clip == null) {
            return null;
        }
        if (clip.getBodyContent() != null && !clip.getBodyContent().isBlank()) {
            return clip.getBodyContent();
        }
        return clip.getContent();
    }

    /**
     * 自动整理单个剪藏（轻量版，仅设置分类和标签）
     * <p>
     * 调用 AI 的 smartOrganize 方法，仅获取分类和标签建议。
     * 不会覆盖已有的分类和标签。
     * </p>
     */
    private void applyAutoOrganize(ClipContent clip) {
        String sourceText = resolveAiSourceText(clip);
        if (sourceText == null || sourceText.isBlank()) {
            return;
        }

        Map<String, Object> aiResult = aiService.smartOrganize(sourceText);
        Object category = aiResult.get("category");
        // 仅当剪藏未设置分类时才覆盖
        if ((clip.getCategory() == null || clip.getCategory().isBlank()) && category instanceof String cat && !cat.isBlank()) {
            clip.setCategory(cat);
        }
        Object tags = aiResult.get("tags");
        // 仅当剪藏未设置标签时才覆盖
        if ((clip.getTags() == null || clip.getTags().isEmpty()) && tags instanceof List<?> tagList) {
            // 过滤非 String 元素，确保类型安全
            List<String> normalizedTags = tagList.stream().filter(String.class::isInstance).map(String.class::cast).collect(Collectors.toList());
            clip.setTags(normalizedTags);
        }
    }

    /**
     * 判断剪藏是否需要 AI 整理结果
     * <p>
     * 如果摘要或分析为空，说明需要 AI 整理。
     * </p>
     */
    private boolean needsAiOrganizeResult(ClipContent clip) {
        return clip.getSummary() == null || clip.getSummary().isBlank()
                || clip.getAnalysis() == null || clip.getAnalysis().isBlank();
    }

    /**
     * 全面 AI 整理（重量版，生成摘要、分析、标签、分类）
     * <p>
     * 调用 AI 的 processClipContent 方法，获取完整的分析结果。
     * 会覆盖剪藏的所有 AI 分析字段，并将 type 设为 ai-text。
     * </p>
     */
    private void applyFullAiOrganize(ClipContent clip) {
        String sourceText = resolveAiSourceText(clip);
        if (sourceText == null || sourceText.isBlank()) {
            return;
        }

        Map<String, Object> aiResult = aiService.processClipContent(sourceText, true);
        // 使用类型安全的方式提取各字段
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
            // 过滤非法元素，确保标签列表只包含 String
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
        // 同步整理完成后更新分析状态（根据失败标记判定）
        boolean failed = (clip.getSummary() != null
                && (clip.getSummary().contains("摘要生成失败") || clip.getSummary().contains("[文档解析失败]")))
                || (clip.getAnalysis() != null && clip.getAnalysis().contains("分析生成失败"));
        clip.setAnalysisStatus(failed ? ANALYSIS_FAILED : ANALYSIS_READY);
    }

    /**
     * 手动覆盖剪藏字段（OrganizeInboxRequest 版本）
     * <p>
     * 仅覆盖请求中明确指定的字段，未指定的字段保持不变。
     * </p>
     */
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
            // 过滤空白标签
            clip.setTags(request.getTags().stream().filter(tag -> tag != null && !tag.isBlank()).map(String::trim).collect(Collectors.toList()));
        }
    }

    /**
     * 手动覆盖剪藏字段（OrganizeClipRequest 版本，支持更多字段）
     * <p>
     * 除了类型、分类、标签外，还支持覆盖内容和摘要/分析。
     * </p>
     */
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
            // 过滤空白标签
            clip.setTags(request.getTags().stream().filter(tag -> tag != null && !tag.isBlank()).map(String::trim).collect(Collectors.toList()));
        }
        // OrganizeClipRequest 额外支持覆盖内容和摘要/分析
        if (request.getContent() != null) {
            clip.setContent(request.getContent().trim());
        }
        if (request.getSummary() != null) {
            clip.setSummary(request.getSummary().trim().isEmpty() ? null : request.getSummary().trim());
        }
        if (request.getAnalysis() != null) {
            clip.setAnalysis(request.getAnalysis().trim().isEmpty() ? null : request.getAnalysis().trim());
        }
        if (request.getMyThoughts() != null) {
            clip.setMyThoughts(request.getMyThoughts().trim().isEmpty() ? null : request.getMyThoughts().trim());
        }
    }

    /**
     * 规范化类型字段，默认返回 "ai-text"
     */
    private String normalizeType(String requestType, String workflowStatus) {
        if (requestType != null && !requestType.isBlank()) {
            return requestType.trim();
        }
        return "ai-text";
    }

    /**
     * 规范化请求类型，默认返回 "ai-text"
     */
    private String normalizeRequestedType(String requestType) {
        if (requestType != null && !requestType.isBlank()) {
            return requestType.trim();
        }
        return "ai-text";
    }

    /**
     * 解析剪藏的实际工作流状态
     * <p>
     * 优先使用记录的 workflowStatus 字段，兼容旧数据中通过 category=inbox
     * 且 type=store-only 来判断 inbox 状态的逻辑。
     * </p>
     */
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

    /**
     * 返回第一个非空白字符串，优先使用 primary，其次 fallback
     */
    private String firstNonBlank(String primary, String fallback) {
        if (primary != null && !primary.isBlank()) {
            return primary.trim();
        }
        if (fallback != null && !fallback.isBlank()) {
            return fallback.trim();
        }
        return fallback;
    }

    /**
     * 规范化捕获方式
     * <p>
     * 如果捕获方式在白名单中则直接使用，否则返回默认值 "popup"。
     * </p>
     */
    private String normalizeCaptureMethod(String captureMethod) {
        if (captureMethod == null || captureMethod.isBlank()) {
            return null;
        }
        String normalized = captureMethod.trim().toLowerCase();
        if (SUPPORTED_CAPTURE_METHODS.contains(normalized)) {
            return normalized;
        }
        // 不在白名单中的捕获方式，默认使用 popup
        return "popup";
    }

    /**
     * 生成笔记文件名
     * <p>
     * 格式：{category}_{yyMMdd}，用于图片和文档的存储目录组织。
     * 分类中的斜杠会被替换为连字符，避免产生子目录。
     * </p>
     *
     * @param category 分类名
     * @return 文件名（如 "work_250628"）
     */
    private String generateNoteFileName(String category) {
        String cat = (category != null && !category.isEmpty()) ? category : "default";
        // 移除分类中的斜杠和其他特殊字符，避免路径问题
        cat = cat.replaceAll("/", "-");
        // 获取当前日期作为后缀
        String dateSuffix = java.time.LocalDate.now().format(java.time.format.DateTimeFormatter.ofPattern("yyMMdd"));
        return cat + "_" + dateSuffix;
    }

    /**
     * 查找重复剪藏（内容 + 来源 URL 完全一致时视为重复）。
     * <p>
     * 仅当 content 与 sourceUrl 均非空时参与去重；命中返回已有记录，未命中返回 null。
     * 用于避免同一页面/同一文本被反复剪藏产生冗余数据。
     * </p>
     *
     * @param request 剪藏请求
     * @return 已存在的重复剪藏；无重复返回 null
     */
    public ClipContent findDuplicate(ClipRequest request) {
        if (request == null || request.getContent() == null || request.getContent().isBlank()
                || request.getSourceUrl() == null || request.getSourceUrl().isBlank()) {
            return null;
        }
        String content = request.getContent().trim();
        String url = request.getSourceUrl().trim();
        for (ClipContent existing : storageService.getAllClips()) {
            if (existing.getContent() != null && existing.getContent().trim().equals(content)
                    && url.equalsIgnoreCase(existing.getSourceUrl() == null ? null : existing.getSourceUrl().trim())) {
                return existing;
            }
        }
        return null;
    }

    /**
     * 触发异步 AI 分析（幂等）。
     * <p>
     * 由保存流程在剪藏最终落盘后调用；仅在 analysisStatus=pending 时提交到
     * {@link #aiExecutor} 执行 {@link #processClipAsync(Long)}，避免重复提交。
     * </p>
     *
     * @param clipId 剪藏记录 ID
     */
    public void triggerAsyncAnalysis(Long clipId) {
        if (clipId == null) {
            return;
        }
        ClipContent clip = storageService.getClipById(clipId.toString());
        if (clip != null && ANALYSIS_PENDING.equals(clip.getAnalysisStatus())) {
            aiExecutor.submit(() -> processClipAsync(clipId));
            logger.info("[ClipService] 已提交异步 AI 分析: clipId={}", clipId);
        }
    }

    /**
     * 异步执行剪藏 AI 分析。
     * <p>
     * 在独立线程中运行：读取剪藏 → 调用 AI 生成摘要/分析/标签/分类 →
     * 根据失败标记更新 analysisStatus（ready/failed）并持久化。
     * 调用方保证数据已落盘（先保存再触发），无需 sleep 等待。
     * </p>
     *
     * @param clipId 剪藏记录 ID
     */
    public void processClipAsync(Long clipId) {
        try {
            ClipContent clip = storageService.getClipById(clipId.toString());
            if (clip == null) {
                return;
            }
            // 幂等：已就绪/失败/无需分析 的剪藏跳过
            if (!ANALYSIS_PENDING.equals(clip.getAnalysisStatus())) {
                return;
            }
            boolean useAiCategory = clip.getCategory() == null || clip.getCategory().isBlank();
            processWithAi(clip, useAiCategory);
            // 根据失败标记判定最终状态
            boolean failed = (clip.getSummary() != null
                    && (clip.getSummary().contains("摘要生成失败") || clip.getSummary().contains("[文档解析失败]")))
                    || (clip.getAnalysis() != null && clip.getAnalysis().contains("分析生成失败"));
            clip.setAnalysisStatus(failed ? ANALYSIS_FAILED : ANALYSIS_READY);
            storageService.replaceClip(clip);
            logger.info("[ClipService] 异步 AI 分析完成: clipId={}, status={}", clipId, clip.getAnalysisStatus());
        } catch (Exception e) {
            logger.error("[ClipService] processClipAsync 失败: clipId={}", clipId, e);
            try {
                ClipContent clip = storageService.getClipById(clipId.toString());
                if (clip != null) {
                    clip.setAnalysisStatus(ANALYSIS_FAILED);
                    storageService.replaceClip(clip);
                }
            } catch (Exception ignored) {
                // 状态回写失败仅记录，不抛出
            }
        }
    }

    /**
     * 迁移 Web Clipper 剪藏数据：读取 sourceFilePath 指向的文件内容，填充到 bodyContent 字段
     * <p>
     * 此方法用于修复现有 Web Clipper 记录的 bodyContent 为空的问题，
     * 确保后续 AI 分析能使用原文全文而非仅标题。
     * 文件路径为 {@code {vaultPath}/{sourceFilePath}}，例如 vault 路径 + sources/filename.md。
     * </p>
     *
     * @return 迁移的记录数
     */
    public int migrateWebClipperRecords() {
        List<ClipContent> allClips = storageService.getAllClips();
        int count = 0;
        for (ClipContent clip : allClips) {
            String sourceFilePath = clip.getSourceFilePath();
            // 跳过没有源文件路径的记录，或已有 bodyContent 的记录
            if (sourceFilePath == null || sourceFilePath.isBlank()) {
                continue;
            }
            if (clip.getBodyContent() != null && !clip.getBodyContent().isBlank()) {
                continue;
            }
            try {
                Path filePath = Paths.get(wikiConfig.getVaultPath()).resolve(sourceFilePath);
                if (Files.exists(filePath)) {
                    String content = Files.readString(filePath, StandardCharsets.UTF_8);
                    // 提取正文（去掉 frontmatter），使用与 SourceSyncService 相同的逻辑
                    String bodyContent = clip.getBodyContent();
                    // 尝试从文件内容提取 frontmatter 后的正文
                    if (content.startsWith("---")) {
                        int endIndex = content.indexOf("---", 3);
                        if (endIndex != -1) {
                            bodyContent = content.substring(endIndex + 3).trim();
                        }
                    } else {
                        bodyContent = content;
                    }
                    if (bodyContent != null && !bodyContent.isBlank()) {
                        clip.setBodyContent(bodyContent);
                        storageService.replaceClip(clip);
                        count++;
                        logger.info("迁移 Web Clipper 记录: clipId={}, sourceFilePath={}", clip.getId(), sourceFilePath);
                    }
                } else {
                    logger.warn("迁移 Web Clipper 记录失败，文件不存在: clipId={}, filePath={}", clip.getId(), filePath);
                }
            } catch (Exception e) {
                logger.error("迁移 Web Clipper 记录失败: clipId={}, sourceFilePath={}", clip.getId(), sourceFilePath, e);
            }
        }
        return count;
    }
}
