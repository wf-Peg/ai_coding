package com.example.clip.service;

import com.example.clip.core.AiService;
import com.example.clip.model.ClipContent;
import com.example.clip.service.obsidian.ObsidianExportFormatter;
import com.example.clip.utils.ImageUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 内容整理服务
 * <p>
 * 负责将今日剪藏内容按分类整理，生成 Markdown 格式的知识库日报，
 * 并存储到指定的整理目录中。整理流程：
 * <ol>
 *   <li>获取所有剪藏内容，筛选今日创建的记录</li>
 *   <li>按分类分组</li>
 *   <li>对每个分类调用 AI 进行智能整理</li>
 *   <li>将整理结果保存为 Markdown 文件</li>
 *   <li>发送邮件通知（可选）</li>
 *   <li>执行 Git 操作（pull、commit、push）</li>
 * </ol>
 * 使用 CATEGORY_TREE 将分类值映射为目录路径和中文名称。
 * </p>
 *
 * @see AiService
 * @see GitService
 */
@Service
public class ContentOrganizeService {

    private static final Logger log = LoggerFactory.getLogger(ContentOrganizeService.class);

    /** 文件存储服务 */
    private final FileStorageService storageService;
    /** AI 服务，用于智能整理内容 */
    private final AiService aiService;
    /** 邮件服务，用于发送整理结果通知 */
    private final EmailService emailService;
    /** Git 服务，用于自动提交整理结果 */
    private final GitService gitService;
    /** Prompt 配置服务，用于获取认知对话模式 Prompt */
    private final PromptConfigService promptConfigService;
    /** Obsidian 格式化服务，用于生成兼容 Obsidian 的 Markdown */
    private final ObsidianExportFormatter obsidianExportFormatter;
    /** 整理结果的存储根目录 */
    private final Path organizedStoragePath;
    /** 媒体工具类（图片复制/引用重写） */
    private final ImageUtils imageUtils;
    /** 上次整理状态（idle/processing/completed/error） */
    private String lastOrganizeStatus;
    /** 上次整理的消息描述 */
    private String lastOrganizeMessage;

    /**
     * 构造器注入
     *
     * @param storageService       文件存储服务
     * @param aiService            AI 服务
     * @param emailService         邮件服务
     * @param gitService           Git 服务
     * @param organizedStoragePath 整理存储路径（从配置读取，默认 ./clip-organized）
     */
    @Autowired
    public ContentOrganizeService(
            FileStorageService storageService,
            AiService aiService,
            EmailService emailService,
            GitService gitService,
            PromptConfigService promptConfigService,
            ObsidianExportFormatter obsidianExportFormatter,
            ImageUtils imageUtils,
            @Value("${clip.organized-storage.path:./clip-organized}") String organizedStoragePath) {
        this.storageService = storageService;
        this.aiService = aiService;
        this.emailService = emailService;
        this.gitService = gitService;
        this.promptConfigService = promptConfigService;
        this.obsidianExportFormatter = obsidianExportFormatter;
        this.imageUtils = imageUtils;
        this.organizedStoragePath = Paths.get(organizedStoragePath);
        // 确保整理存储目录存在
        initOrganizedStorage();
        this.lastOrganizeStatus = "idle";
        this.lastOrganizeMessage = "";
    }

    /**
     * 初始化整理存储目录
     * <p>
     * 如果目录不存在则自动创建，创建失败仅打印异常（不影响服务启动）。
     * </p>
     */
    private void initOrganizedStorage() {
        try {
            if (!Files.exists(organizedStoragePath)) {
                Files.createDirectories(organizedStoragePath);
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    /**
     * 执行内容整理
     * <p>
     * 核心整理流程：筛选今日剪藏 → 按分类分组 → AI 整理 → 保存文件 → 发送邮件 → Git 操作。
     * Git 操作放在 finally 块中，确保即使整理失败也会执行。
     * </p>
     *
     * @return 整理结果 Map，包含 status、message、hasContent 等字段
     */
    public Map<String, Object> organizeContent() {
        Map<String, Object> result = new HashMap<>();
        lastOrganizeStatus = "processing";
        lastOrganizeMessage = "正在整理内容...";

        try {
            List<ClipContent> allClips = storageService.getAllClips();
            LocalDate today = LocalDate.now();

            // 筛选今日创建的剪藏内容
            List<ClipContent> todayClips = allClips.stream()
                    .filter(clip -> {
                        if (clip.getCreatedAt() == null) return false;
                        LocalDate clipDate = clip.getCreatedAt().toLocalDate();
                        return clipDate.equals(today);
                    })
                    .collect(java.util.stream.Collectors.toList());

            if (todayClips.isEmpty()) {
                // 今日无内容，直接返回
                lastOrganizeStatus = "idle";
                lastOrganizeMessage = "今日无内容需要整理";
                result.put("status", "success");
                result.put("message", lastOrganizeMessage);
                result.put("hasContent", false);
                return result;
            }

            // 按分类分组剪藏内容
            Map<String, List<ClipContent>> clipsByCategory = groupClipsByCategory(todayClips);

            int organizedCount = 0;
            // 收集各分类的 AI 整理产物，供日报邮件并入「AI 整理摘要」章节
            Map<String, String> categoryDigests = new HashMap<>();

            // 处理每个分类的内容
            for (Map.Entry<String, List<ClipContent>> entry : clipsByCategory.entrySet()) {
                String category = entry.getKey();
                List<ClipContent> categoryClips = entry.getValue();

                if (!categoryClips.isEmpty()) {
                    // 组织分类内容（AI 整理）
                    String organizedContent = organizeCategoryContent(category, categoryClips);
                    categoryDigests.put(category, organizedContent);
                    // 文件名格式：{分类中文名}_{yyyy-MM-dd}.md（Obsidian 友好）
                    String fileName = obsidianExportFormatter.generateFileName(getTopCategoryName(category), today);
                    saveOrganizedContent(category, fileName, organizedContent);
                    organizedCount++;
                }
            }

            // 整理完成，更新状态
            lastOrganizeStatus = "completed";
            lastOrganizeMessage = "内容整理完成，共整理 " + organizedCount + " 个分类";
            result.put("status", "success");
            result.put("message", lastOrganizeMessage);
            result.put("hasContent", true);
            result.put("organizedCount", organizedCount);
            result.put("storagePath", organizedStoragePath.toAbsolutePath().toString());

            // 发送邮件通知（如果邮件已配置）
            sendOrganizeEmail(today, organizedCount, clipsByCategory, categoryDigests);

        } catch (Exception e) {
            lastOrganizeStatus = "error";
            lastOrganizeMessage = "内容整理失败: " + e.getMessage();
            result.put("status", "error");
            result.put("message", lastOrganizeMessage);
            e.printStackTrace();
        } finally {
            // 无论主流程是否成功，都执行 Git 操作（pull + commit + push）
            try {
                Path gitDirectory = storageService.getStorageParentPath();
                if (gitDirectory != null) {
                    gitService.executeGitOperations(gitDirectory);
                }
            } catch (Exception e) {
                // Git 操作失败只记录日志，不影响主流程的返回结果
                log.error("Git operation failed in finally block: {}", e.getMessage());
            }
        }

        return result;
    }

    /**
     * 按分类分组剪藏内容
     * <p>
     * 将剪藏列表按 category 字段分组，category 为 null 的归入 "default"。
     * 使用 computeIfAbsent 简化分组逻辑。
     * </p>
     *
     * @param clips 剪藏内容列表
     * @return 按分类分组的 Map（category → 剪藏列表）
     */
    private Map<String, List<ClipContent>> groupClipsByCategory(List<ClipContent> clips) {
        Map<String, List<ClipContent>> result = new HashMap<>();

        for (ClipContent clip : clips) {
            String category = clip.getCategory() != null ? clip.getCategory() : "default";
            // computeIfAbsent：如果 key 不存在则创建新列表
            result.computeIfAbsent(category, k -> new java.util.ArrayList<>()).add(clip);
        }

        return result;
    }

    /**
     * 组织单个分类的内容
     * <p>
     * 为指定分类的所有剪藏生成 Markdown 内容，包含：
     * 标题、日期、原文（含图片路径替换）、AI 分析、标签。
     * 生成后调用 AI 进行智能整理。
     * </p>
     *
     * @param category 分类名称
     * @param clips    该分类下的剪藏列表
     * @return AI 整理后的 Markdown 内容
     */
    private String organizeCategoryContent(String category, List<ClipContent> clips) {
        StringBuilder contentBuilder = new StringBuilder();

        // 收集所有剪藏的标签（去重）和来源 URL，用于 frontmatter
        List<String> allTags = clips.stream()
                .filter(c -> c.getTags() != null)
                .flatMap(c -> c.getTags().stream())
                .filter(t -> t != null && !t.trim().isEmpty())
                .distinct()
                .collect(Collectors.toList());
        List<String> allSourceUrls = clips.stream()
                .map(ClipContent::getSourceUrl)
                .filter(u -> u != null && !u.trim().isEmpty())
                .collect(Collectors.toList());

        // 生成 Obsidian 兼容的 YAML frontmatter
        String categoryName = getCategoryName(category);
        contentBuilder.append(obsidianExportFormatter.generateFrontmatter(
                LocalDate.now(), allTags, categoryName, allSourceUrls));

        // 正文标题（frontmatter 之后）
        contentBuilder.append("# ").append(categoryName).append("\n\n");

        for (int i = 0; i < clips.size(); i++) {
            ClipContent clip = clips.get(i);
            contentBuilder.append("## ").append(i + 1).append(". ").append(clip.getSummary() != null ? clip.getSummary() : "内容摘要").append("\n\n");

            if (clip.getContent() != null) {
                // 图文一体整理：复制引用图片到 organized assets（扁平化）+ 重写引用
                copyClipImagesToAssets(category, clip);
                String content = rewriteImageReferences(clip.getContent());
                contentBuilder.append("### 原文\n\n").append(content).append("\n\n");
            }

            if (clip.getAnalysis() != null) {
                contentBuilder.append(obsidianExportFormatter.wrapCallout("AI 分析", clip.getAnalysis(), "analysis")).append("\n");
            }

            if (clip.getMyThoughts() != null && !clip.getMyThoughts().isEmpty()) {
                contentBuilder.append(obsidianExportFormatter.wrapCallout("💭 我的思考", clip.getMyThoughts(), "thoughts")).append("\n");
            }

            if (clip.getTags() != null && !clip.getTags().isEmpty()) {
                contentBuilder.append("### 标签\n\n");
                contentBuilder.append(obsidianExportFormatter.formatTagsInline(clip.getTags())).append("\n\n");
            }

            // 一剪藏一文件落库 + 汇总双链引用
            String clipLink = exportClipToVault(clip, category, LocalDate.now());
            if (clipLink != null) {
                contentBuilder.append("📎 来源：").append(clipLink).append("\n\n");
            }

            contentBuilder.append("---\n\n");
        }

        String rawContent = contentBuilder.toString();
        // 调用 AI 进行智能整理
        return aiOrganizeContent(category, rawContent);
    }
    /**
     * 复制剪藏引用图片到 organized assets 目录（扁平化，uuid 命名）。
     * <p>
     * 源：media/{yyMM}/{uuid}.{ext}；目标：{organizedPath}/{categoryDir}/assets/{uuid}.{ext}。
     * 复制而非移动，保证原剪藏引用不受影响（原图保留在 media/，供 cleanup 引用计数）。
     * </p>
     */
    private void copyClipImagesToAssets(String category, ClipContent clip) {
        if (clip.getImagePaths() == null || clip.getImagePaths().isEmpty()) {
            return;
        }
        try {
            Path assetsDir = organizedStoragePath.resolve(getCategoryDir(category)).resolve("assets");
            Files.createDirectories(assetsDir);
            for (String path : clip.getImagePaths()) {
                Path source = imageUtils.resolveMediaFile(path);
                if (source == null) {
                    continue;
                }
                String fileName = source.getFileName().toString();
                Files.copy(source, assetsDir.resolve(fileName), StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException e) {
            log.error("[Organize] copy images to assets failed: category={}, clipId={}", category, clip.getId(), e);
        }
    }

    /**
     * 将单条剪藏导出为独立 Markdown 文件（一剪藏一文件），并返回 Obsidian wikilink。
     * <p>
     * 存储位置：{@code {organizedPath}/clips/{yyyy}/{MM}/{categoryDir}/{yyMMdd}_{短id}.md}，
     * 按年/月分片避免单目录文件过多。frontmatter 含 AI 提炼字段（summary/divergent/thoughts），
     * 供 Dataview 结构化检索。汇总文件通过返回的 {@code [[文件名|标题]]} 引用本条剪藏。
     * </p>
     *
     * @param clip     剪藏内容
     * @param category 分类值
     * @param date     整理日期
     * @return wikilink 字符串（{@code [[2026-08-12_3f2a9c|标题]]}）；导出失败返回 null
     */
    private String exportClipToVault(ClipContent clip, String category, LocalDate date) {
        try {
            String topCategoryName = getTopCategoryName(category);
            // 短 ID：取剪藏 id 的稳定短哈希，避免链接因标题改动失效
            String shortId = shortIdOf(clip.getId());
            String dateStr = date.format(DateTimeFormatter.ofPattern("yyyyMMdd"));
            String fileName = dateStr + "_" + shortId + ".md";

            // 目录：clips/{yyyy}/{MM}/{一级分类目录}
            Path baseDir = organizedStoragePath.resolve("clips")
                    .resolve(String.valueOf(date.getYear()))
                    .resolve(String.format("%02d", date.getMonthValue()))
                    .resolve(sanitizeDirName(topCategoryName));
            Files.createDirectories(baseDir);

            // frontmatter：含 AI 提炼字段
            List<String> tags = clip.getTags() != null ? clip.getTags() : List.of();
            String frontmatter = obsidianExportFormatter.generateClipFrontmatter(
                    date, tags, topCategoryName,
                    clip.getSourceUrl(), clip.getSiteName(), clip.getAnalysisStatus(),
                    clip.getSummary(), clip.getDivergentSummary(), clip.getMyThoughts());

            StringBuilder sb = new StringBuilder(frontmatter);
            sb.append("# ").append(clip.getTitle() != null ? clip.getTitle() : "剪藏").append("\n\n");
            if (clip.getSummary() != null && !clip.getSummary().isEmpty()) {
                sb.append("> ").append(clip.getSummary()).append("\n\n");
            }
            if (clip.getContent() != null) {
                sb.append("## 原文\n\n").append(rewriteImageReferences(clip.getContent())).append("\n\n");
            }
            if (clip.getAnalysis() != null && !clip.getAnalysis().isEmpty()) {
                sb.append(obsidianExportFormatter.wrapCallout("AI 分析", clip.getAnalysis(), "analysis")).append("\n");
            }
            if (clip.getDivergentSummary() != null && !clip.getDivergentSummary().isEmpty()) {
                sb.append(obsidianExportFormatter.wrapCallout("发散总结", clip.getDivergentSummary(), "analysis")).append("\n");
            }
            if (clip.getMyThoughts() != null && !clip.getMyThoughts().isEmpty()) {
                sb.append(obsidianExportFormatter.wrapCallout("💭 我的思考", clip.getMyThoughts(), "thoughts")).append("\n");
            }
            if (clip.getSourceUrl() != null && !clip.getSourceUrl().isEmpty()) {
                sb.append("\n🔗 来源：[").append(clip.getSourceUrl()).append("](").append(clip.getSourceUrl()).append(")\n");
            }

            Path filePath = baseDir.resolve(fileName);
            Files.write(filePath, sb.toString().getBytes("UTF-8"));
            log.info("[Organize] export clip to vault: file={}, clipId={}", filePath, clip.getId());

            // 显示标题：优先用标题，否则用摘要截断
            String display = clip.getTitle() != null && !clip.getTitle().isEmpty()
                    ? clip.getTitle()
                    : (clip.getSummary() != null && !clip.getSummary().isEmpty()
                            ? clip.getSummary()
                            : "剪藏" + shortId);
            return "[[" + stripMdExtension(fileName) + "|" + yamlSafeDisplay(display) + "]]";
        } catch (Exception e) {
            log.error("[Organize] export clip to vault failed: clipId={}", clip.getId(), e);
            return null;
        }
    }

    /**
     * 生成剪藏 id 的稳定短哈希（8 位 hex），用于文件名与 wikilink。
     *
     * @param id 剪藏 id
     * @return 8 位小写 hex 字符串
     */
    private String shortIdOf(Long id) {
        if (id == null) {
            return "0";
        }
        int hash = id.hashCode();
        return String.format("%08x", hash);
    }

    /**
     * 移除 wikilink 文件名中的 .md 后缀。
     *
     * @param fileName 文件名（含 .md）
     * @return 去后缀后的链接锚名
     */
    private String stripMdExtension(String fileName) {
        return fileName.endsWith(".md") ? fileName.substring(0, fileName.length() - 3) : fileName;
    }

    /**
     * 将 wikilink 显示文本转为 YAML/链接安全值（去除换行、压缩空白）。
     *
     * @param display 原始显示文本
     * @return 压缩后的单行安全值
     */
    private String yamlSafeDisplay(String display) {
        if (display == null) {
            return "";
        }
        return display.replaceAll("\\s+", " ").trim();
    }

    /**
     * 净化目录名，移除文件系统不安全字符。
     *
     * @param name 目录名
     * @return 净化后的目录名
     */
    private String sanitizeDirName(String name) {
        if (name == null || name.isEmpty()) {
            return "default";
        }
        return name.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
    }

    /**
     * 重写图片引用为 Obsidian 兼容的相对路径。
     * <ul>
     *   <li>新引用：{@code (media/{yyMM}/{uuid}.{ext})} → {@code (./assets/{uuid}.{ext})}</li>
     *   <li>旧引用（未迁移数据）：{@code (/api/clip/image/{cat}/{file})} → {@code (./assets/{file})}</li>
     * </ul>
     */
    private String rewriteImageReferences(String content) {
        if (content == null) {
            return content;
        }
        // media/{yyMM}/{uuid}.{ext} → ./assets/{uuid}.{ext}
        String mediaPattern = "\\(media/\\d{4}/([^)]+)\\)";
        String rewritten = content.replaceAll(mediaPattern, "(./assets/$1)");
        String legacyPattern = "\\(/api/clip/image/[^/]+/([^)]+)\\)";
        rewritten = rewritten.replaceAll(legacyPattern, "(./assets/$1)");
        return rewritten;
    }


    /**
     * 使用 AI 组织内容
     * <p>
     * 调用 AI 服务对原始内容进行智能整理（如合并重复、优化结构等）。
     * 如果检测到内容中包含用户自己的思考（💭 我的思考），
     * 会在 Prompt 末尾追加"认知对话模式"指令，将整理从"客观汇总"升级为"认知对话"。
     * 如果 AI 调用失败，返回原始内容作为降级方案。
     * </p>
     *
     * @param category 分类名称
     * @param content  原始内容
     * @return AI 整理后的内容；若 AI 失败则返回原始内容
     */
    private String aiOrganizeContent(String category, String content) {
        try {
            // 检测是否存在用户思考，决定是否启用认知对话模式
            boolean hasThoughts = content.contains("💭 我的思考");
            String systemPrompt = promptConfigService.renderDailyPrompt(category);
            if (hasThoughts) {
                systemPrompt += promptConfigService.getDailyDialoguePrompt();
            }
            return aiService.organizeContentForKnowledgeBase(category, content, systemPrompt);
        } catch (Exception e) {
            e.printStackTrace();
            return content;
        }
    }

    /**
     * 将 category value 映射为文件系统目录路径
     * <p>
     * 例如: "work-company" → "work/公司事务", "work" → "work", null/空 → "default"。
     * 遍历 CATEGORY_TREE 匹配一级和二级分类。
     * </p>
     *
     * @param category 分类值
     * @return 目录路径
     */
    private String getCategoryDir(String category) {
        String cat = (category != null && !category.isEmpty()) ? category : "default";

        for (Map<String, Object> topCat : AiService.CATEGORY_TREE) {
            String topValue = topCat.get("value").toString();

            // 一级分类直接匹配
            if (topValue.equals(cat)) {
                return topValue;
            }

            // 二级分类：一级目录/二级 label
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> children = (List<Map<String, Object>>) topCat.get("children");
            if (children != null) {
                for (Map<String, Object> child : children) {
                    if (child.get("value").toString().equals(cat)) {
                        return topValue + "/" + child.get("label").toString();
                    }
                }
            }
        }

        return cat;
    }

    /**
     * 保存整理后的内容到文件
     * <p>
     * 按分类目录存储，如果文件已存在则先创建备份（带时间戳），再写入新内容。
     * </p>
     *
     * @param category 分类名称
     * @param fileName 文件名
     * @param content  整理后的 Markdown 内容
     * @throws IOException 文件操作异常
     */
    private void saveOrganizedContent(String category, String fileName, String content) throws IOException {
        String categoryDir = getCategoryDir(category);
        Path categoryPath = organizedStoragePath.resolve(categoryDir);
        // 确保分类目录存在
        if (!Files.exists(categoryPath)) {
            Files.createDirectories(categoryPath);
        }

        Path filePath = categoryPath.resolve(fileName);

        // 如果文件已存在，创建带时间戳的备份
        if (Files.exists(filePath)) {
            long timestamp = System.currentTimeMillis();
            String baseName = fileName.substring(0, fileName.lastIndexOf('.'));
            String extension = fileName.substring(fileName.lastIndexOf('.'));
            String backupFileName = baseName + "_" + timestamp + extension;
            Path backupPath = categoryPath.resolve(backupFileName);
            Files.move(filePath, backupPath);
        }

        // 写入 UTF-8 编码的内容
        Files.write(filePath, content.getBytes("UTF-8"));
    }

    /**
     * 将 category value 映射为中文名称（用于显示标题和 AI prompt）
     * <p>
     * 例如: "work-company" → "工作项目 > 公司事务", "work" → "工作项目"。
     * </p>
     *
     * @param category 分类值
     * @return 中文名称
     */
    private String getCategoryName(String category) {
        if (category == null || category.isEmpty()) return "默认分类";

        for (Map<String, Object> cat : AiService.CATEGORY_TREE) {
            String topValue = cat.get("value").toString();
            String topLabel = cat.get("label").toString();

            if (topValue.equals(category)) {
                return topLabel;
            }

            @SuppressWarnings("unchecked")
            List<Map<String, Object>> children = (List<Map<String, Object>>) cat.get("children");
            if (children != null) {
                for (Map<String, Object> child : children) {
                    if (child.get("value").toString().equals(category)) {
                        return topLabel + " > " + child.get("label").toString();
                    }
                }
            }
        }

        return category;
    }

    /**
     * 获取一级分类中文名（不含子分类）。
     * <p>
     * 例如: "work-company" → "工作项目", "work" → "工作项目"。
     * 用于归档文件名生成，使文件名简洁。
     * </p>
     *
     * @param category 分类值
     * @return 一级分类中文名
     */
    private String getTopCategoryName(String category) {
        String fullName = getCategoryName(category);
        int idx = fullName.indexOf(" > ");
        return idx > 0 ? fullName.substring(0, idx) : fullName;
    }

    /**
     * 获取上次整理状态
     *
     * @return 状态字符串（idle/processing/completed/error）
     */
    public String getLastOrganizeStatus() {
        return lastOrganizeStatus;
    }

    /**
     * 获取上次整理消息
     *
     * @return 消息描述
     */
    public String getLastOrganizeMessage() {
        return lastOrganizeMessage;
    }

    /**
     * 获取整理存储路径
     *
     * @return 整理存储目录的绝对路径
     */
    public String getOrganizedStoragePath() {
        return organizedStoragePath.toAbsolutePath().toString();
    }

    /**
     * 发送整理结果邮件通知（日报）
     * <p>
     * 构建结构化的 HTML 日报邮件，包含以下信息层级：
     * <ol>
     *   <li><b>概览</b>：日期、总条数、分类数、来源数、标签数</li>
     *   <li><b>全局统计</b>：来源站点分布、内容类型分布、热门标签</li>
     *   <li><b>AI 整理摘要</b>：每个分类由 AI 整理出的正文要点（去除 frontmatter）</li>
     *   <li><b>分类详情</b>：每个分类下的剪藏卡片（摘要、来源链接、标签、AI 分析摘要）</li>
     * </ol>
     * </p>
     *
     * @param date            整理日期
     * @param organizedCount  整理的分类数量
     * @param clipsByCategory 按分类分组的剪藏内容
     * @param categoryDigests 按分类的 AI 整理产物（Markdown）
     */
    private void sendOrganizeEmail(LocalDate date, int organizedCount, Map<String, List<ClipContent>> clipsByCategory, Map<String, String> categoryDigests) {
        try {
            if (!emailService.isEmailConfigured()) {
                return;
            }

            // ── 收集所有剪藏列表 ──
            List<ClipContent> allClips = clipsByCategory.values().stream()
                    .flatMap(List::stream)
                    .collect(Collectors.toList());

            // ── 统计信息 ──
            int totalItems = allClips.size();
            int totalTags = (int) allClips.stream().filter(c -> c.getTags() != null).flatMap(c -> c.getTags().stream()).distinct().count();
            int totalSources = (int) allClips.stream().map(c -> c.getSiteName() != null ? c.getSiteName() : "未知来源").distinct().count();
            int totalImageCount = (int) allClips.stream().filter(c -> c.getImagePaths() != null).mapToInt(c -> c.getImagePaths().size()).sum();

            String dateStr = date.format(DateTimeFormatter.ofPattern("yyyy年MM月dd日"));
            String dateKey = date.format(DateTimeFormatter.ofPattern("yyyy-MM-dd"));
            String subject = "剪藏日报 | " + dateKey + " | " + totalItems + "条内容";

            // ── 构建 HTML ──
            StringBuilder html = new StringBuilder();
            html.append("<!DOCTYPE html><html><head><meta charset=\"UTF-8\"></head><body>");
            html.append("<div style=\"font-family: -apple-system, 'Microsoft YaHei', sans-serif; max-width: 640px; margin: 0 auto; padding: 20px 0;\">");

            // ===== 头部 =====
            html.append("<div style=\"background: linear-gradient(135deg, #3b82f6, #6366f1); color: #fff; padding: 24px 28px; border-radius: 12px 12px 0 0;\">");
            html.append("<h1 style=\"margin: 0; font-size: 22px; font-weight: 700;\">剪藏日报</h1>");
            html.append("<p style=\"margin: 6px 0 0; font-size: 14px; opacity: 0.85;\">").append(dateStr).append("</p>");
            html.append("</div>");

            // ===== 概览统计卡片 =====
            html.append("<div style=\"background: #f8fafc; padding: 20px 28px; border-bottom: 1px solid #e2e8f0;\">");
            html.append("<table style=\"width: 100%; border-collapse: collapse;\">");
            html.append("<tr>");
            html.append(buildStatCell("剪藏", String.valueOf(totalItems)));
            html.append(buildStatCell("分类", String.valueOf(organizedCount)));
            html.append(buildStatCell("来源", String.valueOf(totalSources)));
            html.append(buildStatCell("标签", String.valueOf(totalTags)));
            if (totalImageCount > 0) {
                html.append(buildStatCell("图片", String.valueOf(totalImageCount)));
            }
            html.append("</tr></table></div>");

            // ===== 全局统计面板 =====
            html.append("<div style=\"padding: 20px 28px; background: #fff;\">");
            html.append("<h2 style=\"font-size: 16px; color: #1e293b; margin: 0 0 12px; padding-bottom: 8px; border-bottom: 2px solid #3b82f6;\">全局统计</h2>");

            // 来源分布
            Map<String, Long> sourceCounts = allClips.stream()
                    .collect(Collectors.groupingBy(c -> c.getSiteName() != null && !c.getSiteName().isEmpty() ? c.getSiteName() : "其他", Collectors.counting()));
            if (!sourceCounts.isEmpty()) {
                html.append("<div style=\"margin-bottom: 14px;\">");
                html.append("<span style=\"color: #64748b; font-size: 13px;\">来源分布：</span>");
                sourceCounts.entrySet().stream()
                        .sorted(Map.Entry.<String, Long>comparingByValue().reversed())
                        .forEach(e -> html.append("<span style=\"display: inline-block; background: #e0e7ff; color: #3730a3; font-size: 12px; padding: 2px 8px; border-radius: 10px; margin: 2px 4px;\">")
                                .append(escapeHtml(e.getKey())).append(" ×").append(e.getValue()).append("</span>"));
                html.append("</div>");
            }

            // 内容类型分布
            Map<String, Long> typeCounts = allClips.stream()
                    .collect(Collectors.groupingBy(c -> {
                        String t = c.getType();
                        if (t == null) return "其他";
                        switch (t) {
                            case "ai-text": return "文本";
                            case "link-ai": return "链接";
                            case "doc-ai": return "文档";
                            case "store-only": return "纯存储";
                            default: return t;
                        }
                    }, Collectors.counting()));
            html.append("<div style=\"margin-bottom: 14px;\">");
            html.append("<span style=\"color: #64748b; font-size: 13px;\">内容类型：</span>");
            typeCounts.forEach((type, count) -> html.append("<span style=\"display: inline-block; background: #fef3c7; color: #92400e; font-size: 12px; padding: 2px 8px; border-radius: 10px; margin: 2px 4px;\">")
                    .append(type).append(" ×").append(count).append("</span>"));
            html.append("</div>");

            // 热门标签
            Map<String, Long> tagCounts = allClips.stream()
                    .filter(c -> c.getTags() != null)
                    .flatMap(c -> c.getTags().stream())
                    .collect(Collectors.groupingBy(t -> t, Collectors.counting()));
            if (!tagCounts.isEmpty()) {
                html.append("<div style=\"margin-bottom: 14px;\">");
                html.append("<span style=\"color: #64748b; font-size: 13px;\">热门标签：</span>");
                tagCounts.entrySet().stream()
                        .sorted(Map.Entry.<String, Long>comparingByValue().reversed())
                        .limit(10)
                        .forEach(e -> html.append("<span style=\"display: inline-block; background: #dcfce7; color: #166534; font-size: 12px; padding: 2px 8px; border-radius: 10px; margin: 2px 4px;\">#")
                                .append(escapeHtml(e.getKey())).append("</span>"));
                html.append("</div>");
            }

            html.append("</div>");

            // ===== AI 整理摘要（每分类由 AI 整理出的正文要点）=====
            if (categoryDigests != null && !categoryDigests.isEmpty()) {
                html.append("<div style=\"padding: 4px 28px; background: #fff;\">");
                html.append("<h2 style=\"font-size: 16px; color: #1e293b; margin: 0 0 12px; padding-bottom: 8px; border-bottom: 2px solid #3b82f6;\">AI 整理摘要</h2>");
                categoryDigests.entrySet().stream()
                        .filter(e -> e.getValue() != null && !e.getValue().trim().isEmpty())
                        .forEach(e -> {
                            String digest = EmailMarkdownUtil.stripFrontmatter(e.getValue());
                            if (digest.length() > 900) digest = digest.substring(0, 900) + "…";
                            html.append("<div style=\"margin: 12px 0; padding: 14px 16px; background: #f8fafc; border-radius: 8px; border-left: 4px solid #10b981;\">");
                            html.append("<div style=\"font-weight: 700; color: #166534; font-size: 14px; margin-bottom: 6px;\">📌 ")
                                    .append(escapeHtml(getCategoryName(e.getKey()))).append("</div>");
                            html.append("<div style=\"font-size: 13px; color: #334155; line-height: 1.7;\">")
                                    .append(EmailMarkdownUtil.mdToHtml(digest)).append("</div>");
                            html.append("</div>");
                        });
                html.append("</div>");
            }

            // ===== 分类详情 =====
            html.append("<div style=\"padding: 4px 28px 20px; background: #fff;\">");
            html.append("<h2 style=\"font-size: 16px; color: #1e293b; margin: 0 0 12px; padding-bottom: 8px; border-bottom: 2px solid #3b82f6;\">分类详情</h2>");

            // 按分类中条目数降序排列
            clipsByCategory.entrySet().stream()
                    .sorted(Map.Entry.<String, List<ClipContent>>comparingByValue(
                            (a, b) -> Integer.compare(b.size(), a.size())))
                    .forEach(entry -> {
                        String categoryName = getCategoryName(entry.getKey());
                        List<ClipContent> clips = entry.getValue();

                        html.append("<div style=\"margin: 14px 0; padding: 16px; background: #f8fafc; border-radius: 10px; border-left: 4px solid #3b82f6;\">");
                        html.append("<h3 style=\"margin: 0 0 4px; color: #1e293b; font-size: 15px;\">")
                                .append(categoryName)
                                .append(" <span style=\"color: #94a3b8; font-size: 12px; font-weight: normal;\">")
                                .append(clips.size()).append(" 条</span></h3>");

                        // 该分类下的来源统计
                        Map<String, Long> catSources = clips.stream()
                                .collect(Collectors.groupingBy(c -> c.getSiteName() != null && !c.getSiteName().isEmpty() ? c.getSiteName() : "其他", Collectors.counting()));
                        if (!catSources.isEmpty()) {
                            html.append("<p style=\"margin: 0 0 10px; font-size: 12px; color: #94a3b8;\">");
                            catSources.entrySet().stream()
                                    .sorted(Map.Entry.<String, Long>comparingByValue().reversed())
                                    .forEach(e -> html.append(escapeHtml(e.getKey())).append("(").append(e.getValue()).append(") "));
                            html.append("</p>");
                        }

                        // 剪藏条目列表
                        for (ClipContent clip : clips) {
                            boolean hasThoughts = clip.getMyThoughts() != null && !clip.getMyThoughts().isEmpty();
                            String borderColor = hasThoughts ? "#a855f7" : "#e2e8f0";
                            String bgColor = hasThoughts ? "#faf5ff" : "#fff";

                            html.append("<div style=\"margin: 8px 0; padding: 10px 12px; background: ").append(bgColor).append("; border-radius: 6px; border: 1px solid ").append(borderColor).append(";\">");

                            // 摘要 + 来源链接 + 思考标记
                            html.append("<div style=\"margin-bottom: 4px;\">");
                            if (hasThoughts) {
                                html.append("<span style=\"font-size: 14px;\" title=\"包含用户思考\">💭 </span>");
                            }
                            String summary = clip.getSummary() != null ? clip.getSummary() : "无摘要";
                            html.append("<span style=\"font-weight: 600; color: #1e293b; font-size: 14px;\">").append(escapeHtml(summary)).append("</span>");
                            if (clip.getSourceUrl() != null && !clip.getSourceUrl().isEmpty()) {
                                html.append(" <a href=\"").append(escapeAttr(clip.getSourceUrl())).append("\" style=\"color: #3b82f6; font-size: 12px; text-decoration: none;\">[原文]</a>");
                            }
                            html.append("</div>");

                            // 标签
                            if (clip.getTags() != null && !clip.getTags().isEmpty()) {
                                html.append("<div style=\"margin-bottom: 4px;\">");
                                for (String tag : clip.getTags()) {
                                    html.append("<span style=\"display: inline-block; background: #ede9fe; color: #6d28d9; font-size: 11px; padding: 1px 6px; border-radius: 8px; margin-right: 4px;\">#").append(escapeHtml(tag)).append("</span>");
                                }
                                html.append("</div>");
                            }

                            // 用户思考预览（截取前 80 字）
                            if (hasThoughts) {
                                String thought = clip.getMyThoughts();
                                if (thought.length() > 80) thought = thought.substring(0, 80) + "...";
                                html.append("<p style=\"margin: 4px 0 0; font-size: 12px; color: #7c3aed; line-height: 1.5; font-style: italic;\">💭 ").append(escapeHtml(thought)).append("</p>");
                            }

                            // AI 分析摘要（截取前 120 字）
                            if (clip.getAnalysis() != null && !clip.getAnalysis().isEmpty()) {
                                String analysis = clip.getAnalysis();
                                if (analysis.length() > 120) analysis = analysis.substring(0, 120) + "...";
                                html.append("<p style=\"margin: 4px 0 0; font-size: 12px; color: #64748b; line-height: 1.5;\">")
                                        .append(escapeHtml(analysis)).append("</p>");
                            }

                            html.append("</div>");
                        }

                        html.append("</div>");
                    });

            html.append("</div>");

            // ===== 页脚 =====
            html.append("<div style=\"padding: 16px 28px; background: #f1f5f9; border-radius: 0 0 12px 12px; color: #94a3b8; font-size: 12px;\">");
            html.append("存储路径：").append(organizedStoragePath.toAbsolutePath()).append("<br>");
            html.append("由 Clip 剪藏系统自动生成 · ").append(dateKey);
            html.append("</div>");

            html.append("</div></body></html>");

            emailService.sendOrganizeResult(emailService.getMailFrom(), subject, html.toString());
        } catch (Exception e) {
            log.error("[Organize] Failed to send email: {}", e.getMessage());
        }
    }

    /**
     * 构建统计数字单元格（HTML table td）
     * <p>
     * 用于概览统计卡片，展示"指标名 + 数值"的紧凑布局。
     * </p>
     *
     * @param label 指标名称
     * @param value 指标数值
     * @return HTML td 字符串
     */
    private String buildStatCell(String label, String value) {
        return "<td style=\"text-align: center; padding: 0 12px;\">"
                + "<div style=\"font-size: 22px; font-weight: 700; color: #1e293b;\">" + value + "</div>"
                + "<div style=\"font-size: 12px; color: #64748b;\">" + label + "</div>"
                + "</td>";
    }

    /**
     * 转义 HTML 特殊字符（正文内容安全）
     */
    private String escapeHtml(String text) {
        if (text == null) return "";
        return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    /**
     * 转义 HTML 属性值中的特殊字符
     */
    private String escapeAttr(String text) {
        if (text == null) return "";
        return text.replace("&", "&amp;").replace("\"", "&quot;").replace("'", "&#39;").replace("<", "&lt;").replace(">", "&gt;");
    }
}