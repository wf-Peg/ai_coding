package com.example.clip.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;

/**
 * 剪藏内容分析结果 DTO。
 * <p>
 * 对应 processClipContent() 返回的 JSON 结构。
 * 使用 Jackson 宽松解析（忽略未知字段），兼容 LLM 非标准输出。
 * </p>
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class ClipAnalysisResult {

    private String summary;
    private String analysis;
    private List<String> tags;
    private String category;

    public String getSummary() { return summary; }
    public void setSummary(String v) { this.summary = v; }

    public String getAnalysis() { return analysis; }
    public void setAnalysis(String v) { this.analysis = v; }

    public List<String> getTags() { return tags; }
    public void setTags(List<String> v) { this.tags = v; }

    public String getCategory() { return category; }
    public void setCategory(String v) { this.category = v; }
}