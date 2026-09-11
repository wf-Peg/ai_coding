package com.example.clip.service.wiki;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** WikiLocalRetriever 轻量 BM25 词法检索：拆词、停用词、达标门槛与排序。 */
class WikiLocalRetrieverTest {

    private final WikiLocalRetriever retriever = new WikiLocalRetriever();

    @Test
    @DisplayName("tokenize：过滤中文提问停用词")
    void tokenizeDropsChineseStopwords() {
        List<String> tokens = retriever.tokenize("如何做知识图谱");
        assertFalse(tokens.contains("如何"));
        assertTrue(tokens.contains("知识"));
        assertTrue(tokens.contains("识图"));
        assertTrue(tokens.contains("图谱"));
    }

    @Test
    @DisplayName("tokenize：英文拆词、滤停用词并做轻度复数还原")
    void tokenizeEnglishNormalizes() {
        List<String> tokens = retriever.tokenize("clips and notes");
        assertTrue(tokens.contains("clip"));
        assertTrue(tokens.contains("note"));
        assertFalse(tokens.contains("and"));
    }

    @Test
    @DisplayName("retrieve：全重叠标题命中排名靠前，且 ≥minHits 达标门槛过滤弱匹配")
    void retrieveRanksFullOverlapFirstAndAppliesMinHits() {
        String index = "# Wiki Index\n\n"
                + "- [[RAG]] — 检索增强生成 生成 检索 (updated: 2024-01-01)\n"
                + "- [[图谱生成]] — 图谱生成与检索 (updated: 2024-01-01)\n";

        // query 拆词后为 {检索,索增,增强,强生,生成}；RAG 命中全部 5 个，图谱生成仅命中{生成,检索} 2 个
        List<String> result = retriever.retrieve("检索增强生成", index, 2, 2);

        assertEquals(List.of("RAG", "图谱生成"), result);
    }

    @Test
    @DisplayName("retrieve：未能达到 minHits 时返回空（走 LLM 兜底）")
    void retrieveReturnsEmptyBelowMinHits() {
        String index = "# Wiki Index\n\n"
                + "- [[笔记]] — 日常记录与摘抄 (updated: 2024-01-01)\n";
        List<String> result = retriever.retrieve("图谱 生成", index, 2, 2);
        assertTrue(result.isEmpty());
    }

    @Test
    @DisplayName("retrieveBodyMatches：正文深处命中以 max(1, minHits-1) 为门槛")
    void bodyMatchesUsesRelaxedThreshold() {
        Map<String, String> nameToBody = Map.of("隐藏细节", "图谱的连线与节点关系说明");
        // 图谱（bigram）在正文命中；minHits=2 → 门槛 max(1,1)=1 → 仍应命中
        List<String> result = retriever.retrieveBodyMatches("图谱 连线", nameToBody, 3, 2);
        assertEquals(List.of("隐藏细节"), result);
    }
}