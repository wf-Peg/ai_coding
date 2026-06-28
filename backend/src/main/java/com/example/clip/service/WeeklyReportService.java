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
import java.util.*;
import java.util.stream.Collectors;

/**
 * 周报生成服务
 * <p>
 * 负责生成最近7天的内容周报，流程如下：
 * <ol>
 *   <li>筛选最近 7 天创建的剪藏内容</li>
 *   <li>按分类分组</li>
 *   <li>对每个分类调用 AI 提取知识点（主报告 + 知识点列表）</li>
 *   <li>保存主报告和知识点文件（使用 Obsidian 双链语法）</li>
 *   <li>发送邮件通知（可选）</li>
 *   <li>执行 Git 操作</li>
 * </ol>
 * 与 {@link ContentOrganizeService} 类似，但周报侧重于知识点的拆分和关联。
 * </p>
 *
 * @see AiService
 * @see ContentOrganizeService
 */
@Service
public class WeeklyReportService {

    private static final Logger log = LoggerFactory.getLogger(WeeklyReportService.class);

    /** 文件存储服务 */
    private final FileStorageService storageService;
    /** AI 服务，用于知识点提取 */
    private final AiService aiService;
    /** 邮件服务 */
    private final EmailService emailService;
    /** Git 服务 */
    private final GitService gitService;
    /** 周报存储根目录 */
    private final Path weeklyReportPath;
    /** 上次周报生成状态 */
    private String lastReportStatus;
    /** 上次周报生成消息 */
    private String lastReportMessage;

    @Autowired
    public WeeklyReportService(
            FileStorageService storageService,
            AiService aiService,
            EmailService emailService,
            GitService gitService,
            @Value("${clip.clip-weekly-report.path:./weeklyReport}") String weeklyReportPath) {
        this.storageService = storageService;
        this.aiService = aiService;
        this.emailService = emailService;
        this.gitService = gitService;
        this.weeklyReportPath = Paths.get(weeklyReportPath);
        initWeeklyReportStorage();
        this.lastReportStatus = "idle";
        this.lastReportMessage = "";
    }

    /**
     * 初始化周报存储目录
     */
    private void initWeeklyReportStorage() {
        try {
            if (!Files.exists(weeklyReportPath)) {
                Files.createDirectories(weeklyReportPath);
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    /**
     * 生成周报
     * <p>
     * 核心流程：筛选最近 7 天内容 → 按分类分组 → AI 提取知识点 → 保存文件 → 发送邮件 → Git 操作。
     * AI 返回的主报告和知识点列表分别保存为独立文件，知识点使用 Obsidian 双链语法引用。
     * </p>
     *
     * @return 周报生成结果 Map
     */
    public Map<String, Object> generateWeeklyReport() {
        Map<String, Object> result = new HashMap<>();
        lastReportStatus = "processing";
        lastReportMessage = "正在生成周报...";

        try {
            List<ClipContent> allClips = storageService.getAllClips();
            LocalDate today = LocalDate.now();
            LocalDate weekAgo = today.minusDays(7);

            // 筛选最近 7 天（含今天）的剪藏内容
            List<ClipContent> weeklyClips = allClips.stream()
                    .filter(clip -> {
                        if (clip.getCreatedAt() == null) return false;
                        LocalDate clipDate = clip.getCreatedAt().toLocalDate();
                        // 日期在 [weekAgo, today] 范围内
                        return !clipDate.isBefore(weekAgo) && !clipDate.isAfter(today);
                    })
                    .collect(Collectors.toList());

            if (weeklyClips.isEmpty()) {
                lastReportStatus = "idle";
                lastReportMessage = "最近7天无内容";
                result.put("status", "success");
                result.put("message", lastReportMessage);
                result.put("hasContent", false);
                return result;
            }

            // 按分类分组
            Map<String, List<ClipContent>> clipsByCategory = groupClipsByCategory(weeklyClips);
            // 周次标识，如 "2025_W26"
            String weekSuffix = getWeekSuffix(today);

            int reportCount = 0;
            List<String> generatedFiles = new ArrayList<>();

            for (Map.Entry<String, List<ClipContent>> entry : clipsByCategory.entrySet()) {
                String category = entry.getKey();
                List<ClipContent> categoryClips = entry.getValue();

                if (!categoryClips.isEmpty()) {
                    // 组织分类内容为 Markdown 文本
                    String organizedContent = organizeCategoryContent(category, categoryClips, today, weekAgo);

                    // 调用 AI 提取知识点
                    Map<String, Object> extractionResult = aiService.extractKnowledgePoints(organizedContent, category);
                    String mainReport = (String) extractionResult.get("mainReport");
                    @SuppressWarnings("unchecked")
                    List<Map<String, String>> knowledgePoints = (List<Map<String, String>>) extractionResult.get("knowledgePoints");

                    // 按分类目录/周次组织存储
                    String categoryDir = getCategoryDir(category);
                    Path categoryPath = weeklyReportPath.resolve(categoryDir).resolve(weekSuffix);
                    if (!Files.exists(categoryPath)) {
                        Files.createDirectories(categoryPath);
                    }

                    // 保存主报告
                    String mainReportFileName = category + "_周报_" + weekSuffix + ".md";
                    saveReportFile(categoryPath, mainReportFileName, mainReport);
                    generatedFiles.add(categoryPath.resolve(mainReportFileName).toString());

                    // 保存每个知识点为独立文件
                    for (Map<String, String> kp : knowledgePoints) {
                        String kpFileName = kp.get("fileName") + ".md";
                        String kpContent = formatKnowledgePointContent(kp);
                        saveReportFile(categoryPath, kpFileName, kpContent);
                        generatedFiles.add(categoryPath.resolve(kpFileName).toString());
                    }

                    reportCount++;
                }
            }

            lastReportStatus = "completed";
            lastReportMessage = "周报生成完成，共生成 " + reportCount + " 个分类报告";
            result.put("status", "success");
            result.put("message", lastReportMessage);
            result.put("hasContent", true);
            result.put("reportCount", reportCount);
            result.put("generatedFiles", generatedFiles);
            result.put("storagePath", weeklyReportPath.toAbsolutePath().toString());

            // 发送邮件通知
            sendWeeklyReportEmail(today, reportCount, clipsByCategory);

        } catch (Exception e) {
            lastReportStatus = "error";
            lastReportMessage = "周报生成失败: " + e.getMessage();
            result.put("status", "error");
            result.put("message", lastReportMessage);
            e.printStackTrace();
        } finally {
            // 无论主流程是否成功，都执行 Git 操作
            try {
                Path gitDirectory = storageService.getStorageParentPath();
                if (gitDirectory != null) {
                    gitService.executeGitOperations(gitDirectory);
                }
            } catch (Exception e) {
                log.error("Git operation failed in finally block: {}", e.getMessage());
            }
        }

        return result;
    }

    /**
     * 格式化知识点内容为 Markdown
     *
     * @param kp 知识点 Map（包含 title、content 和 fileName）
     * @return 格式化后的 Markdown 字符串
     */
    private String formatKnowledgePointContent(Map<String, String> kp) {
        StringBuilder sb = new StringBuilder();
        sb.append("# ").append(kp.get("title") != null ? kp.get("title") : kp.get("fileName")).append("\n\n");
        sb.append(kp.get("content")).append("\n");
        return sb.toString();
    }

    /**
     * 按分类分组剪藏内容
     *
     * @param clips 剪藏列表
     * @return 按分类分组的 Map
     */
    private Map<String, List<ClipContent>> groupClipsByCategory(List<ClipContent> clips) {
        Map<String, List<ClipContent>> result = new HashMap<>();

        for (ClipContent clip : clips) {
            String category = clip.getCategory() != null ? clip.getCategory() : "default";
            result.computeIfAbsent(category, k -> new ArrayList<>()).add(clip);
        }

        return result;
    }

    /**
     * 组织单个分类的周报内容
     * <p>
     * 生成包含标题、周期、原文、图片、AI 分析、标签的 Markdown 内容。
     * </p>
     *
     * @param category  分类名称
     * @param clips     剪藏列表
     * @param endDate   周期结束日期
     * @param startDate 周期开始日期
     * @return Markdown 格式的内容
     */
    private String organizeCategoryContent(String category, List<ClipContent> clips, LocalDate endDate, LocalDate startDate) {
        StringBuilder contentBuilder = new StringBuilder();
        contentBuilder.append("# ").append(getCategoryName(category)).append(" 周报\n\n");
        contentBuilder.append("报告周期: ").append(startDate.format(DateTimeFormatter.ofPattern("yyyy年MM月dd日")))
                .append(" 至 ").append(endDate.format(DateTimeFormatter.ofPattern("yyyy年MM月dd日"))).append("\n\n");
        contentBuilder.append("---\n\n");

        for (int i = 0; i < clips.size(); i++) {
            ClipContent clip = clips.get(i);
            contentBuilder.append("## ").append(i + 1).append(". ").append(clip.getSummary() != null ? clip.getSummary() : "内容摘要").append("\n\n");

            if (clip.getContent() != null) {
                contentBuilder.append("### 原文\n\n").append(clip.getContent()).append("\n\n");
            }

            if (clip.getImagePaths() != null && !clip.getImagePaths().isEmpty()) {
                contentBuilder.append("### 图片\n\n");
                for (String imagePath : clip.getImagePaths()) {
                    // 注意：图片引用为空，实际图片路径未嵌入，可能需要在整理时修复
                    contentBuilder.append("![图片]()\n");
                }
                contentBuilder.append("\n");
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

        return contentBuilder.toString();
    }

    /**
     * 获取周次后缀
     * <p>
     * 格式：{年份}_W{周数}，如 "2025_W26"。
     * 使用 ISO 周标准（WEEK_OF_WEEK_BASED_YEAR）。
     * </p>
     *
     * @param date 日期
     * @return 周次字符串
     */
    private String getWeekSuffix(LocalDate date) {
        int year = date.getYear();
        int week = date.get(java.time.temporal.IsoFields.WEEK_OF_WEEK_BASED_YEAR);
        return String.format("%d_W%02d", year, week);
    }

    /**
     * 将 category value 映射为文件系统目录路径
     * <p>
     * 例如: "work-company" → "work/公司事务"。
     * </p>
     *
     * @param category 分类值
     * @return 目录路径
     */
    private String getCategoryDir(String category) {
        String cat = (category != null && !category.isEmpty()) ? category : "default";

        for (Map<String, Object> topCat : AiService.CATEGORY_TREE) {
            String topValue = topCat.get("value").toString();

            if (topValue.equals(cat)) {
                return topValue;
            }

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
     * 将 category value 映射为中文名称
     * <p>
     * 例如: "work-company" → "工作项目 > 公司事务"。
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
     * 保存报告文件
     * <p>
     * 如果文件已存在，先创建带时间戳的备份，再写入新内容。
     * </p>
     *
     * @param directory 目标目录
     * @param fileName  文件名
     * @param content   文件内容
     * @throws IOException 文件操作异常
     */
    private void saveReportFile(Path directory, String fileName, String content) throws IOException {
        Path filePath = directory.resolve(fileName);

        // 如果文件已存在，备份旧文件
        if (Files.exists(filePath)) {
            long timestamp = System.currentTimeMillis();
            String baseName = fileName.substring(0, fileName.lastIndexOf('.'));
            String extension = fileName.substring(fileName.lastIndexOf('.'));
            String backupFileName = baseName + "_" + timestamp + extension;
            Path backupPath = directory.resolve(backupFileName);
            Files.move(filePath, backupPath);
        }

        // 写入 UTF-8 编码内容
        Files.write(filePath, content.getBytes("UTF-8"));
    }

    /**
     * 获取上次周报生成状态
     */
    public String getLastReportStatus() {
        return lastReportStatus;
    }

    /**
     * 获取上次周报生成消息
     */
    public String getLastReportMessage() {
        return lastReportMessage;
    }

    /**
     * 获取周报存储路径
     */
    public String getWeeklyReportPath() {
        return weeklyReportPath.toAbsolutePath().toString();
    }

    /**
     * 发送周报邮件通知
     * <p>
     * 构建 HTML 格式的周报邮件，如果邮件未配置则跳过。
     * </p>
     *
     * @param date             周报日期
     * @param reportCount      生成的报告数量
     * @param clipsByCategory  按分类分组的剪藏内容
     */
    private void sendWeeklyReportEmail(LocalDate date, int reportCount, Map<String, List<ClipContent>> clipsByCategory) {
        try {
            if (!emailService.isEmailConfigured()) {
                return;
            }

            String weekSuffix = getWeekSuffix(date);
            String subject = "剪藏周报 - " + weekSuffix;

            StringBuilder html = new StringBuilder();
            html.append("<div style=\"font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto;\">");
            html.append("<h2 style=\"color: #3b82f6;\">剪藏周报</h2>");
            html.append("<p style=\"color: #6b7280;\">").append(weekSuffix).append("</p>");
            html.append("<hr style=\"border: none; border-top: 1px solid #e5e7eb;\">");
            html.append("<p>共生成 <strong>").append(reportCount).append("</strong> 个分类报告，");
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
                    html.append("<p style=\"margin: 4px 0; color: #374151; font-size: 14px;\">• " + summary + "</p>");
                }
                html.append("</div>");
            }

            html.append("<hr style=\"border: none; border-top: 1px solid #e5e7eb;\">");
            html.append("<p style=\"color: #9ca3af; font-size: 12px;\">存储路径: " + weeklyReportPath.toAbsolutePath() + "</p>");
            html.append("</div>");

            emailService.sendOrganizeResult(
                    emailService.getMailFrom(),
                    subject,
                    html.toString()
            );
        } catch (Exception e) {
            log.error("[WeeklyReport] Failed to send email: {}", e.getMessage());
        }
    }
}