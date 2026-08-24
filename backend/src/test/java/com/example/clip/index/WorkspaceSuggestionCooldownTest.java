package com.example.clip.index;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class WorkspaceSuggestionCooldownTest {
    @TempDir Path tempDir;

    private WorkspaceSuggestionService service() {
        return new WorkspaceSuggestionService(tempDir);
    }

    private SuggestionCandidate pending(String id, String workspaceId, String contentId) {
        return new SuggestionCandidate(id, workspaceId, contentId, 0.8,
                List.of("tag-match"), LocalDateTime.now(), null, "pending");
    }

    @Test
    void ignorePutsSuggestionIntoCooldownWindow() {
        WorkspaceSuggestionService service = service();
        service.saveSuggestions("ws", List.of(pending("s1", "ws", "clip:1")));

        SuggestionCandidate ignored = service.ignore("s1");
        assertNotNull(ignored);
        assertEquals(1, service.cooldownSuggestions("ws").size(), "忽略后应进入冷却区");
        assertTrue(service.pendingSuggestions("ws").isEmpty(), "冷却中的建议不再出现在候选");
    }

    @Test
    void restoreBringsIgnoredSuggestionBackToPending() {
        WorkspaceSuggestionService service = service();
        service.saveSuggestions("ws", List.of(pending("s1", "ws", "clip:1")));
        service.ignore("s1");

        SuggestionCandidate restored = service.restore("s1");
        assertNotNull(restored);
        assertEquals("pending", restored.status());
        assertNull(restored.expiresAt());
        assertTrue(service.cooldownSuggestions("ws").isEmpty(), "恢复后冷却区清空");
        assertEquals(1, service.pendingSuggestions("ws").size(), "恢复后回到候选");
    }

    @Test
    void restoreRejectsNonIgnoredSuggestion() {
        WorkspaceSuggestionService service = service();
        service.saveSuggestions("ws", List.of(pending("s1", "ws", "clip:1")));
        assertNull(service.restore("s1"), "非 ignored 状态不可恢复");
    }

    @Test
    void expiredIgnoredIsNoLongerInCooldown() {
        WorkspaceSuggestionService service = service();
        LocalDateTime past = LocalDateTime.now().minusDays(8);
        LocalDateTime expiredEnd = past.plusDays(7); // 冷却截止已过
        service.saveSuggestions("ws", List.of(
                new SuggestionCandidate("s1", "ws", "clip:1", 0.8,
                        List.of("tag-match"), past, expiredEnd, "ignored")));
        assertTrue(service.cooldownSuggestions("ws").isEmpty(), "过期的 ignored 不再处于冷却");
    }

    @Test
    void statsCountsInCooldownSeparately() {
        WorkspaceSuggestionService service = service();
        LocalDateTime now = LocalDateTime.now();
        service.saveSuggestions("ws", List.of(
                new SuggestionCandidate("s1", "ws", "clip:1", 0.8, List.of(),
                        now, now.plusDays(7), "ignored"),
                new SuggestionCandidate("s2", "ws", "clip:2", 0.8, List.of(),
                        now, null, "accepted")));

        var stats = service.suggestionStats("ws");
        assertEquals(2L, stats.get("shown"));
        assertEquals(1L, stats.get("accepted"));
        assertEquals(1L, stats.get("ignored"));
        assertEquals(0L, stats.get("rejected"));
        assertEquals(1L, ((Number) stats.get("inCooldown")).longValue());
        // 采纳率 = 接受 / (接受+忽略+拒绝) = 1/2 = 50%
        assertEquals(50.0, ((Number) stats.get("acceptanceRate")).doubleValue());
    }

    @Test
    void ruleMatchedFeaturesInfluenceScoring() {
        WorkspaceSuggestionService service = service();
        LocalDateTime now = LocalDateTime.now();
        // 候选被规则显式命中（rule-explicit），并与既有规则内容的分类/标签/目录共享特征，应能跨过阈值
        ContentRef candidate = new ContentRef("clip:9", "clip", "9", "Java 学习", "java",
                List.of("spring", "整理", "读书"), "C:/个人知识/Java", now, now, "java 学习笔记");
        ContentRef ruleMatched = new ContentRef("clip:8", "clip", "8", "既有内容", "java",
                List.of("spring", "整理"), "C:/个人知识/Java", now, now, "既有");

        // 无成员画像，仅靠规则特征（显式命中 + 分类/目录/多标签）应能跨过阈值并带 rule 原因
        List<SuggestionCandidate> withRule = service.generateSuggestions("ws",
                List.of(candidate), List.of(), List.of(ruleMatched, candidate), null);
        assertFalse(withRule.isEmpty(), "规则命中应推动候选进入推荐");
        assertEquals(1, withRule.size());
        assertEquals("clip:9", withRule.get(0).contentId());
        var reasons = withRule.get(0).reasons();
        assertTrue(reasons.contains("rule-explicit"), "应带规则显式命中原因");
        assertTrue(reasons.stream().anyMatch(r -> r.startsWith("rule-")), "评分应采纳规则命中特征");

        // 无规则命中、无成员画像时，候选分数不足，不应生成
        List<SuggestionCandidate> noRule = service.generateSuggestions("ws",
                List.of(candidate), List.of(), List.of(), null);
        assertTrue(noRule.isEmpty(), "无任何画像时不应生成建议");
    }
}