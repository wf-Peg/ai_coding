package com.example.clip.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;

/**
 * Wiki 批量抽取结果 DTO。
 * <p>
 * 对应 batchExtractEntitiesAndConcepts() 返回的 JSON 数组元素结构。
 * 使用 Jackson 宽松解析（忽略未知字段），兼容 LLM 非标准输出。
 * </p>
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class WikiExtractionResult {

    /** 源文档在输入列表中的索引位置 */
    private int index;

    /** 实体列表（人物、产品、技术、组织、地点等） */
    private List<String> entities;

    /** 概念列表（主题、思想、理论、方法等） */
    private List<String> concepts;

    /** 源文档的一行摘要 */
    private String summary;

    public WikiExtractionResult() {
    }

    public int getIndex() { return index; }
    public void setIndex(int v) { this.index = v; }

    public List<String> getEntities() { return entities; }
    public void setEntities(List<String> v) { this.entities = v; }

    public List<String> getConcepts() { return concepts; }
    public void setConcepts(List<String> v) { this.concepts = v; }

    public String getSummary() { return summary; }
    public void setSummary(String v) { this.summary = v; }
}
