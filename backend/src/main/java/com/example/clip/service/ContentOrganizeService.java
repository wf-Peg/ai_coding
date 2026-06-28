package com.example.clip.service;

import com.example.clip.core.AiService;
import com.example.clip.model.ClipContent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

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
    /** 整理结果的存储根目录 */
    private final Path organizedStoragePath;
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
            @Value("${clip.organized-storage.path:./clip-organized}") String organizedStoragePath) {
        this.storageService = storageService;
        this.aiService = aiService;
        this.emailService = emailService;
        this.gitService = gitService;
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
            String dateSuffix = today.format(DateTimeFormatter.ofPattern("yyMMdd"));

            int organizedCount = 0;

            // 处理每个分类的内容
            for (Map.Entry<String, List<ClipContent>> entry : clipsByCategory.entrySet()) {
                String category = entry.getKey();
                List<ClipContent> categoryClips = entry.getValue();

                if (!categoryClips.isEmpty()) {
                    // 组织分类内容（AI 整理）
                    String organizedContent = organizeCategoryContent(category, categoryClips);
                    // 文件名格式：{category}_{yyMMdd}.md
                    String fileName = category + "_" + dateSuffix + ".md";
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
            sendOrganizeEmail(today, organizedCount, clipsByCategory);

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
        contentBuilder.append("# ").append(getCategoryName(category)).append("\n\n");
        contentBuilder.append("整理日期: ").append(LocalDate.now().format(DateTimeFormatter.ofPattern("yyyy年MM月dd日"))).append("\n\n");
        contentBuilder.append("---\n\n");

        for (int i = 0; i < clips.size(); i++) {
            ClipContent clip = clips.get(i);
            contentBuilder.append("## ").append(i + 1).append(". ").append(clip.getSummary() != null ? clip.getSummary() : "内容摘要").append("\n\n");

            if (clip.getContent() != null) {
                // 替换图片路径：将 /api/clip/image/xxx/ 替换为 ./assets/
                String content = clip.getContent();
                content = content.replaceAll(
                        "\\(/api/clip/image/[^/]+/([^\\)]+)\\)",
                        "(./assets/$1)"
                );
                contentBuilder.append("### 原文\n\n").append(content).append("\n\n");
            }

            if (clip.getAnalysis() != null) {
                contentBuilder.append("### AI分析\n\n").append(clip.getAnalysis()).append("\n\n");
            }

            if (clip.getTags() != null && !clip.getTags().isEmpty()) {
                contentBuilder.append("### 标签\n\n");
                for (String tag : clip.getTags()) {
                    contentBuilder.append("tag:#").append(tag).append("  ");
                }
                contentBuilder.append("\n\n");
            }

            contentBuilder.append("---\n\n");
        }

        String rawContent = contentBuilder.toString();
        // 调用 AI 进行智能整理
        return aiOrganizeContent(category, rawContent);
    }

    /**
     * 使用 AI 组织内容
     * <p>
     * 调用 AI 服务对原始内容进行智能整理（如合并重复、优化结构等）。
     * 如果 AI 调用失败，返回原始内容作为降级方案。
     * </p>
     *
     * @param category 分类名称
     * @param content  原始内容
     * @return AI 整理后的内容；若 AI 失败则返回原始内容
     */
    private String aiOrganizeContent(String category, String content) {
        try {
            return aiService.organizeContentForKnowledgeBase(getCategoryName(category), content);
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
     * 发送整理结果邮件通知
     * <p>
     * 构建 HTML 格式的日报邮件，包含各分类的内容数量和摘要。
     * 如果邮件未配置则静默跳过。
     * </p>
     *
     * @param date            整理日期
     * @param organizedCount  整理的分类数量
     * @param clipsByCategory 按分类分组的剪藏内容
     */
    private void sendOrganizeEmail(LocalDate date, int organizedCount, Map<String, List<ClipContent>> clipsByCategory) {
        try {
            // 邮件未配置则跳过
            if (!emailService.isEmailConfigured()) {
                return;
            }

            String dateStr = date.format(DateTimeFormatter.ofPattern("yyyy-MM-dd"));
            String subject = "剪藏日报 - " + dateStr;

            // 构建 HTML 邮件内容
            StringBuilder html = new StringBuilder();
            html.append("<div style=\"font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto;\">");
            html.append("<h2 style=\"color: #3b82f6;\">剪藏日报</h2>");
            html.append("<p style=\"color: #6b7280;\">").append(dateStr).append("</p>");
            html.append("<hr style=\"border: none; border-top: 1px solid #e5e7eb;\">");
            html.append("<p>共整理 <strong>").append(organizedCount).append("</strong> 个分类，");
            // 统计总内容条数
            html.append("总计 <strong>").append(clipsByCategory.values().stream().mapToInt(List::size).sum()).append("</strong> 条内容。</p>");

            // 按分类展示内容摘要
            for (Map.Entry<String, List<ClipContent>> entry : clipsByCategory.entrySet()) {
                String categoryName = getCategoryName(entry.getKey());
                List<ClipContent> clips = entry.getValue();
                html.append("<div style=\"margin: 16px 0; padding: 12px; background: #f9fafb; border-radius: 8px;\">");
                html.append("<h3 style=\"color: #1f2937; margin: 0 0 8px;\">").append(categoryName).append("</h3>");
                html.append("<p style=\"color: #6b7280; margin: 0;\">").append(clips.size()).append(" 条内容</p>");
                for (ClipContent clip : clips) {
                    String summary = clip.getSummary() != null ? clip.getSummary() : "无摘要";
                    // 摘要截断，避免过长
                    if (summary.length() > 80) summary = summary.substring(0, 80) + "...";
                    html.append("<p style=\"margin: 4px 0; color: #374151; font-size: 14px;\">• ").append(summary).append("</p>");
                }
                html.append("</div>");
            }

            html.append("<hr style=\"border: none; border-top: 1px solid #e5e7eb;\">");
            html.append("<p style=\"color: #9ca3af; font-size: 12px;\">存储路径: ").append(organizedStoragePath.toAbsolutePath()).append("</p>");
            html.append("</div>");

            // 发送邮件（发给自己）
            emailService.sendOrganizeResult(
                    emailService.getMailFrom(),
                    subject,
                    html.toString()
            );
        } catch (Exception e) {
            // 邮件发送失败不影响整理流程
            log.error("[Organize] Failed to send email: {}", e.getMessage());
        }
    }
}