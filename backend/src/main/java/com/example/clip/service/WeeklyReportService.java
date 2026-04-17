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

@Service
public class WeeklyReportService {

    private static final Logger log = LoggerFactory.getLogger(WeeklyReportService.class);

    private final FileStorageService storageService;
    private final AiService aiService;
    private final Path weeklyReportPath;
    private String lastReportStatus;
    private String lastReportMessage;

    @Autowired
    public WeeklyReportService(
            FileStorageService storageService,
            AiService aiService,
            @Value("${clip.weekly-report.path:./weeklyReport}") String weeklyReportPath) {
        this.storageService = storageService;
        this.aiService = aiService;
        this.weeklyReportPath = Paths.get(weeklyReportPath);
        initWeeklyReportStorage();
        this.lastReportStatus = "idle";
        this.lastReportMessage = "";
    }

    private void initWeeklyReportStorage() {
        try {
            if (!Files.exists(weeklyReportPath)) {
                Files.createDirectories(weeklyReportPath);
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    public Map<String, Object> generateWeeklyReport() {
        Map<String, Object> result = new HashMap<>();
        lastReportStatus = "processing";
        lastReportMessage = "正在生成周报...";

        try {
            List<ClipContent> allClips = storageService.getAllClips();
            LocalDate today = LocalDate.now();
            LocalDate weekAgo = today.minusDays(7);

            List<ClipContent> weeklyClips = allClips.stream()
                    .filter(clip -> {
                        if (clip.getCreatedAt() == null) return false;
                        LocalDate clipDate = clip.getCreatedAt().toLocalDate();
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

            Map<String, List<ClipContent>> clipsByCategory = groupClipsByCategory(weeklyClips);
            String weekSuffix = getWeekSuffix(today);

            int reportCount = 0;
            List<String> generatedFiles = new ArrayList<>();

            for (Map.Entry<String, List<ClipContent>> entry : clipsByCategory.entrySet()) {
                String category = entry.getKey();
                List<ClipContent> categoryClips = entry.getValue();

                if (!categoryClips.isEmpty()) {
                    String organizedContent = organizeCategoryContent(category, categoryClips, today, weekAgo);
                    
                    Map<String, Object> extractionResult = aiService.extractKnowledgePoints(organizedContent, category);
                    String mainReport = (String) extractionResult.get("mainReport");
                    @SuppressWarnings("unchecked")
                    List<Map<String, String>> knowledgePoints = (List<Map<String, String>>) extractionResult.get("knowledgePoints");

                    String categoryDir = getCategoryDir(category);
                    Path categoryPath = weeklyReportPath.resolve(categoryDir).resolve(weekSuffix);
                    if (!Files.exists(categoryPath)) {
                        Files.createDirectories(categoryPath);
                    }

                    String mainReportFileName = category + "_周报_" + weekSuffix + ".md";
                    saveReportFile(categoryPath, mainReportFileName, mainReport);
                    generatedFiles.add(categoryPath.resolve(mainReportFileName).toString());

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

        } catch (Exception e) {
            lastReportStatus = "error";
            lastReportMessage = "周报生成失败: " + e.getMessage();
            result.put("status", "error");
            result.put("message", lastReportMessage);
            e.printStackTrace();
        }

        return result;
    }

    private String formatKnowledgePointContent(Map<String, String> kp) {
        StringBuilder sb = new StringBuilder();
        sb.append("# ").append(kp.get("title") != null ? kp.get("title") : kp.get("fileName")).append("\n\n");
        sb.append(kp.get("content")).append("\n");
        return sb.toString();
    }

    private Map<String, List<ClipContent>> groupClipsByCategory(List<ClipContent> clips) {
        Map<String, List<ClipContent>> result = new HashMap<>();
        
        for (ClipContent clip : clips) {
            String category = clip.getCategory() != null ? clip.getCategory() : "default";
            result.computeIfAbsent(category, k -> new ArrayList<>()).add(clip);
        }
        
        return result;
    }

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

    private String getWeekSuffix(LocalDate date) {
        int year = date.getYear();
        int week = date.get(java.time.temporal.IsoFields.WEEK_OF_WEEK_BASED_YEAR);
        return String.format("%d_W%02d", year, week);
    }

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

    private void saveReportFile(Path directory, String fileName, String content) throws IOException {
        Path filePath = directory.resolve(fileName);

        if (Files.exists(filePath)) {
            long timestamp = System.currentTimeMillis();
            String baseName = fileName.substring(0, fileName.lastIndexOf('.'));
            String extension = fileName.substring(fileName.lastIndexOf('.'));
            String backupFileName = baseName + "_" + timestamp + extension;
            Path backupPath = directory.resolve(backupFileName);
            Files.move(filePath, backupPath);
        }

        Files.write(filePath, content.getBytes("UTF-8"));
    }

    public String getLastReportStatus() {
        return lastReportStatus;
    }

    public String getLastReportMessage() {
        return lastReportMessage;
    }

    public String getWeeklyReportPath() {
        return weeklyReportPath.toAbsolutePath().toString();
    }
}
