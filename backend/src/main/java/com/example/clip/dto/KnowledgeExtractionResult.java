package com.example.clip.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;

/**
 * 知识点提取结果 DTO。
 * <p>
 * 对应 extractKnowledgePoints()（周报生成）返回的 JSON 结构。
 * </p>
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class KnowledgeExtractionResult {

    private String mainReport;
    private List<KnowledgePoint> knowledgePoints;

    public String getMainReport() { return mainReport; }
    public void setMainReport(String v) { this.mainReport = v; }

    public List<KnowledgePoint> getKnowledgePoints() { return knowledgePoints; }
    public void setKnowledgePoints(List<KnowledgePoint> v) { this.knowledgePoints = v; }

    /**
     * 单个知识点。
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class KnowledgePoint {
        private String fileName;
        private String title;
        private String content;

        public String getFileName() { return fileName; }
        public void setFileName(String v) { this.fileName = v; }

        public String getTitle() { return title; }
        public void setTitle(String v) { this.title = v; }

        public String getContent() { return content; }
        public void setContent(String v) { this.content = v; }
    }
}