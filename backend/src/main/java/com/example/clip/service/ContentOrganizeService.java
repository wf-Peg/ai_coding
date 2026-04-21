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
 * 内容整理服务类
 * 负责整理剪藏内容，按分类组织并生成报告
 */
@Service
public class ContentOrganizeService {

    private static final Logger log = LoggerFactory.getLogger(ContentOrganizeService.class);

    /**
     * 文件存储服务
     */
    private final FileStorageService storageService;
    /**
     * AI服务
     */
    private final AiService aiService;
    /**
     * 邮件服务
     */
    private final EmailService emailService;
    /**
     * 整理存储路径
     */
    private final Path organizedStoragePath;
    /**
     * 上次整理状态
     */
    private String lastOrganizeStatus;
    /**
     * 上次整理消息
     */
    private String lastOrganizeMessage;

    /**
     * 构造函数
     * @param storageService 文件存储服务
     * @param aiService AI服务
     * @param emailService 邮件服务
     * @param organizedStoragePath 整理存储路径
     */
    @Autowired
    public ContentOrganizeService(
            FileStorageService storageService,
            AiService aiService,
            EmailService emailService,
            @Value("${clip.organized-storage.path:./clip-organized}") String organizedStoragePath) {
        this.storageService = storageService;
        this.aiService = aiService;
        this.emailService = emailService;
        this.organizedStoragePath = Paths.get(organizedStoragePath);
        initOrganizedStorage();
        this.lastOrganizeStatus = "idle";
        this.lastOrganizeMessage = "";
    }

    /**
     * 初始化整理存储目录
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
     * 整理内容
     * 按分类组织今日剪藏内容，生成整理报告
     * @return 整理结果
     */
    public Map<String, Object> organizeContent() {
        Map<String, Object> result = new HashMap<>();
        lastOrganizeStatus = "processing";
        lastOrganizeMessage = "正在整理内容...";

        try {
            List<ClipContent> allClips = storageService.getAllClips();
            LocalDate today = LocalDate.now();
            
            // 筛选今日剪藏内容
            List<ClipContent> todayClips = allClips.stream()
                    .filter(clip -> {
                        if (clip.getCreatedAt() == null) return false;
                        LocalDate clipDate = clip.getCreatedAt().toLocalDate();
                        return clipDate.equals(today);
                    })
                    .collect(java.util.stream.Collectors.toList());
            
            if (todayClips.isEmpty()) {
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
                    String organizedContent = organizeCategoryContent(category, categoryClips);
                    String fileName = category + "_" + dateSuffix + ".md";
                    saveOrganizedContent(category, fileName, organizedContent);
                    organizedCount++;
                }
            }

            // 整理完成
            lastOrganizeStatus = "completed";
            lastOrganizeMessage = "内容整理完成，共整理 " + organizedCount + " 个分类";
            result.put("status", "success");
            result.put("message", lastOrganizeMessage);
            result.put("hasContent", true);
            result.put("organizedCount", organizedCount);
            result.put("storagePath", organizedStoragePath.toAbsolutePath().toString());

            // 发送邮件通知（如果配置）
            sendOrganizeEmail(today, organizedCount, clipsByCategory);

        } catch (Exception e) {
            lastOrganizeStatus = "error";
            lastOrganizeMessage = "内容整理失败: " + e.getMessage();
            result.put("status", "error");
            result.put("message", lastOrganizeMessage);
            e.printStackTrace();
        }

        return result;
    }

    /**
     * 按分类分组剪藏内容
     * @param clips 剪藏内容列表
     * @return 按分类分组的剪藏内容
     */
    private Map<String, List<ClipContent>> groupClipsByCategory(List<ClipContent> clips) {
        Map<String, List<ClipContent>> result = new HashMap<>();
        
        for (ClipContent clip : clips) {
            String category = clip.getCategory() != null ? clip.getCategory() : "default";
            result.computeIfAbsent(category, k -> new java.util.ArrayList<>()).add(clip);
        }
        
        return result;
    }

    /**
     * 组织分类内容
     * 为每个分类生成整理内容
     * @param category 分类
     * @param clips 剪藏内容列表
     * @return 组织后的内容
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
                // 替换图片路径，将 /api/clip/image/default 替换为 ./assets
                String content = clip.getContent();
                // 替换图片路径
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
        return aiOrganizeContent(category, rawContent);
    }

    /**
     * 使用AI组织内容
     * 调用AI服务对内容进行智能整理
     * @param category 分类
     * @param content 原始内容
     * @return AI整理后的内容
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
     * 将 category value 映射为目录路径（与 FileStorageService 一致）
     * 例如: "work-company" → "work/公司事务"
     *       "work" → "work"
     *       null/空 → "default"
     */
    private String getCategoryDir(String category) {
        String cat = (category != null && !category.isEmpty()) ? category : "default";

        for (Map<String, Object> topCat : AiService.CATEGORY_TREE) {
            String topValue = topCat.get("value").toString();

            if (topValue.equals(cat)) {
                return topValue;
            }

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
     * 保存整理后的内容
     * 将整理后的内容保存到文件系统
     * @param category 分类
     * @param fileName 文件名
     * @param content 整理后的内容
     * @throws IOException IO异常
     */
    private void saveOrganizedContent(String category, String fileName, String content) throws IOException {
        String categoryDir = getCategoryDir(category);
        Path categoryPath = organizedStoragePath.resolve(categoryDir);
        if (!Files.exists(categoryPath)) {
            Files.createDirectories(categoryPath);
        }

        Path filePath = categoryPath.resolve(fileName);

        // 如果文件已存在，创建备份
        if (Files.exists(filePath)) {
            long timestamp = System.currentTimeMillis();
            String baseName = fileName.substring(0, fileName.lastIndexOf('.'));
            String extension = fileName.substring(fileName.lastIndexOf('.'));
            String backupFileName = baseName + "_" + timestamp + extension;
            Path backupPath = categoryPath.resolve(backupFileName);
            Files.move(filePath, backupPath);
        }

        // 写入内容
        Files.write(filePath, content.getBytes("UTF-8"));
    }

    /**
     * 将 category value 映射为中文名称（用于显示标题和 AI prompt）
     * 例如: "work-company" → "工作项目 > 公司事务"
     *       "work" → "工作项目"
     */
    private String getCategoryName(String category) {
        if (category == null || category.isEmpty()) return "默认分类";

        for (Map<String, Object> cat : AiService.CATEGORY_TREE) {
            String topValue = cat.get("value").toString();
            String topLabel = cat.get("label").toString();

            if (topValue.equals(category)) {
                return topLabel;
            }

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
     * @return 上次整理状态
     */
    public String getLastOrganizeStatus() {
        return lastOrganizeStatus;
    }

    /**
     * 获取上次整理消息
     * @return 上次整理消息
     */
    public String getLastOrganizeMessage() {
        return lastOrganizeMessage;
    }

    /**
     * 获取整理存储路径
     * @return 整理存储路径
     */
    public String getOrganizedStoragePath() {
        return organizedStoragePath.toAbsolutePath().toString();
    }

    /**
     * 发送整理结果邮件通知
     * @param date 整理日期
     * @param organizedCount 整理的分类数量
     * @param clipsByCategory 按分类分组的剪藏内容
     */
    private void sendOrganizeEmail(LocalDate date, int organizedCount, Map<String, List<ClipContent>> clipsByCategory) {
        try {
            if (!emailService.isEmailConfigured()) {
                return;
            }

            String dateStr = date.format(DateTimeFormatter.ofPattern("yyyy-MM-dd"));
            String subject = "剪藏日报 - " + dateStr;

            StringBuilder html = new StringBuilder();
            html.append("<div style=\"font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto;\">");
            html.append("<h2 style=\"color: #3b82f6;\">剪藏日报</h2>");
            html.append("<p style=\"color: #6b7280;\">").append(dateStr).append("</p>");
            html.append("<hr style=\"border: none; border-top: 1px solid #e5e7eb;\">");
            html.append("<p>共整理 <strong>").append(organizedCount).append("</strong> 个分类，");
            html.append("总计 <strong>").append(clipsByCategory.values().stream().mapToInt(List::size).sum()).append("</strong> 条内容。</p>");

            for (Map.Entry<String, List<ClipContent>> entry : clipsByCategory.entrySet()) {
                String categoryName = getCategoryName(entry.getKey());
                List<ClipContent> clips = entry.getValue();
                html.append("<div style=\"margin: 16px 0; padding: 12px; background: #f9fafb; border-radius: 8px;\">");
                html.append("<h3 style=\"color: #1f2937; margin: 0 0 8px;\">").append(categoryName).append("</h3>");
                html.append("<p style=\"color: #6b7280; margin: 0;\">").append(clips.size()).append(" 条内容</p>");
                for (ClipContent clip : clips) {
                    String summary = clip.getSummary() != null ? clip.getSummary() : "无摘要";
                    if (summary.length() > 80) summary = summary.substring(0, 80) + "...";
                    html.append("<p style=\"margin: 4px 0; color: #374151; font-size: 14px;\">• ").append(summary).append("</p>");
                }
                html.append("</div>");
            }

            html.append("<hr style=\"border: none; border-top: 1px solid #e5e7eb;\">");
            html.append("<p style=\"color: #9ca3af; font-size: 12px;\">存储路径: ").append(organizedStoragePath.toAbsolutePath()).append("</p>");
            html.append("</div>");

            emailService.sendOrganizeResult(
                    emailService.getMailFrom(),
                    subject,
                    html.toString()
            );
        } catch (Exception e) {
            log.error("[Organize] Failed to send email: {}", e.getMessage());
        }
    }
}
