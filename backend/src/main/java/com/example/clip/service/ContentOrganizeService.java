package com.example.clip.service;

import com.example.clip.core.AiService;
import com.example.clip.model.ClipContent;
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

@Service
public class ContentOrganizeService {

    private final FileStorageService storageService;
    private final AiService aiService;
    private final Path organizedStoragePath;
    private String lastOrganizeStatus;
    private String lastOrganizeMessage;

    @Autowired
    public ContentOrganizeService(
            FileStorageService storageService,
            AiService aiService,
            @Value("${clip.organized-storage.path:./clip-organized}") String organizedStoragePath) {
        this.storageService = storageService;
        this.aiService = aiService;
        this.organizedStoragePath = Paths.get(organizedStoragePath);
        initOrganizedStorage();
        this.lastOrganizeStatus = "idle";
        this.lastOrganizeMessage = "";
    }

    private void initOrganizedStorage() {
        try {
            if (!Files.exists(organizedStoragePath)) {
                Files.createDirectories(organizedStoragePath);
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    public Map<String, Object> organizeContent() {
        Map<String, Object> result = new HashMap<>();
        lastOrganizeStatus = "processing";
        lastOrganizeMessage = "正在整理内容...";

        try {
            List<ClipContent> allClips = storageService.getAllClips();
            LocalDate today = LocalDate.now();
            
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

            Map<String, List<ClipContent>> clipsByCategory = groupClipsByCategory(todayClips);
            String dateSuffix = today.format(DateTimeFormatter.ofPattern("yyMMdd"));

            int organizedCount = 0;

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

            lastOrganizeStatus = "completed";
            lastOrganizeMessage = "内容整理完成，共整理 " + organizedCount + " 个分类";
            result.put("status", "success");
            result.put("message", lastOrganizeMessage);
            result.put("hasContent", true);
            result.put("organizedCount", organizedCount);
            result.put("storagePath", organizedStoragePath.toAbsolutePath().toString());

        } catch (Exception e) {
            lastOrganizeStatus = "error";
            lastOrganizeMessage = "内容整理失败: " + e.getMessage();
            result.put("status", "error");
            result.put("message", lastOrganizeMessage);
            e.printStackTrace();
        }

        return result;
    }

    private Map<String, List<ClipContent>> groupClipsByCategory(List<ClipContent> clips) {
        Map<String, List<ClipContent>> result = new HashMap<>();
        
        for (ClipContent clip : clips) {
            String category = clip.getCategory() != null ? clip.getCategory() : "default";
            result.computeIfAbsent(category, k -> new java.util.ArrayList<>()).add(clip);
        }
        
        return result;
    }

    private String organizeCategoryContent(String category, List<ClipContent> clips) {
        StringBuilder contentBuilder = new StringBuilder();
        contentBuilder.append("# ").append(getCategoryName(category)).append("\n\n");
        contentBuilder.append("整理日期: ").append(LocalDate.now().format(DateTimeFormatter.ofPattern("yyyy年MM月dd日"))).append("\n\n");
        contentBuilder.append("---\n\n");

        for (int i = 0; i < clips.size(); i++) {
            ClipContent clip = clips.get(i);
            contentBuilder.append("## ").append(i + 1).append(". ").append(clip.getSummary() != null ? clip.getSummary() : "内容摘要").append("\n\n");
            
            if (clip.getContent() != null) {
                contentBuilder.append("### 原文\n\n").append(clip.getContent()).append("\n\n");
            }
            
            if (clip.getAnalysis() != null) {
                contentBuilder.append("### AI分析\n\n").append(clip.getAnalysis()).append("\n\n");
            }
            
            if (clip.getTags() != null && !clip.getTags().isEmpty()) {
                contentBuilder.append("### 标签\n\n");
                for (String tag : clip.getTags()) {
                    contentBuilder.append("- ").append(tag).append("\n");
                }
                contentBuilder.append("\n");
            }
            
            contentBuilder.append("---\n\n");
        }

        String rawContent = contentBuilder.toString();
        return aiOrganizeContent(category, rawContent);
    }

    private String aiOrganizeContent(String category, String content) {
        try {
            return aiService.organizeContentForKnowledgeBase(getCategoryName(category), content);
        } catch (Exception e) {
            e.printStackTrace();
            return content;
        }
    }

    private void saveOrganizedContent(String category, String fileName, String content) throws IOException {
        String mappedCategory = getCategoryName(category);
        Path categoryPath = organizedStoragePath.resolve(mappedCategory);
        if (!Files.exists(categoryPath)) {
            Files.createDirectories(categoryPath);
        }

        Path filePath = categoryPath.resolve(fileName);

        if (Files.exists(filePath)) {
            long timestamp = System.currentTimeMillis();
            String baseName = fileName.substring(0, fileName.lastIndexOf('.'));
            String extension = fileName.substring(fileName.lastIndexOf('.'));
            String backupFileName = baseName + "_" + timestamp + extension;
            Path backupPath = categoryPath.resolve(backupFileName);
            Files.move(filePath, backupPath);
        }

        Files.write(filePath, content.getBytes("UTF-8"));
    }

    /**
     * 将 category value 映射为中文名称
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

    public String getLastOrganizeStatus() {
        return lastOrganizeStatus;
    }

    public String getLastOrganizeMessage() {
        return lastOrganizeMessage;
    }

    public String getOrganizedStoragePath() {
        return organizedStoragePath.toAbsolutePath().toString();
    }
}
