package com.example.clip;

import com.example.clip.controller.WorkspaceController;
import com.example.clip.core.AiService;
import com.example.clip.service.AppConfigService;
import com.example.clip.service.FeaturePointsService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * DSH 会话成果自动归档端点 {@code POST /api/workspace/feature-points/iterations/ai-session} 的单元测试。
 *
 * 覆盖：
 *  1) AI 提炼成功 → 200 + 四字段 + source=dsh-session 落库
 *  2) AI 提炼失败（返回 null）→ 200 + 兜底四字段（title=AI 干活记录，outcome=会话截断）
 *  3) conversation 为空 → 400
 */
class WorkspaceControllerAiSessionTest {

    @TempDir
    Path tempDir;

    private WorkspaceController controller(AiService aiService) {
        AppConfigService configService = mock(AppConfigService.class);
        FeaturePointsService fpService = mock(FeaturePointsService.class);
        when(configService.getConfigDirPath()).thenReturn(tempDir.toString());
        return new WorkspaceController(configService, fpService, aiService);
    }

    @Test
    void aiSessionHonorsAiExtractedFourFields() {
        AiService aiService = mock(AiService.class);
        Map<String, Object> extracted = new LinkedHashMap<>();
        extracted.put("title", "修复缓存失效时序问题");
        extracted.put("problem", "缓存刷新存在时序问题");
        extracted.put("solution", "通过加分布式锁解决");
        extracted.put("outcome", "缓存刷新正常，项目更稳定");
        when(aiService.generateSessionArchive(anyString())).thenReturn(extracted);

        ResponseEntity<?> resp = controller(aiService).createAiSessionIteration(
                Map.of("conversation", "用户：查缓存问题。AI：定位到时序问题并加锁解决。", "project", "DSH 集成"));

        assertEquals(HttpStatus.OK, resp.getStatusCode());
        Map<String, Object> body = cast(resp.getBody());
        assertEquals("dsh-session", body.get("source"));
        assertEquals("修复缓存失效时序问题", body.get("title"));
        assertEquals("缓存刷新存在时序问题", body.get("problem"));
        assertEquals("通过加分布式锁解决", body.get("solution"));
        assertEquals("缓存刷新正常，项目更稳定", body.get("outcome"));
        assertTrue(((java.util.List<?>) body.get("tags")).contains("AI会话"));
        assertNotNull(body.get("id"));
    }

    @Test
    void aiSessionFallsBackWhenAiFails() {
        // 模拟后端 AI 提炼失败（返回 null）→ 触发兜底而非阻断
        AiService aiService = mock(AiService.class);
        when(aiService.generateSessionArchive(anyString())).thenReturn(null);
        String longConversation = "x".repeat(1000);

        ResponseEntity<?> resp = controller(aiService).createAiSessionIteration(
                Map.of("conversation", longConversation, "project", ""));

        assertEquals(HttpStatus.OK, resp.getStatusCode());
        Map<String, Object> body = cast(resp.getBody());
        assertEquals("AI 干活记录", body.get("title"));
        assertEquals("", body.get("problem"));
        assertEquals("", body.get("solution"));
        // outcome 为会话文本截断（>500 截取前 500）
        assertEquals(longConversation.substring(0, 500), body.get("outcome"));
        assertEquals("dsh-session", body.get("source"));
    }

    @Test
    void aiSessionRejectsBlankConversation() {
        ResponseEntity<?> resp = controller(mock(AiService.class))
                .createAiSessionIteration(Map.of("conversation", "   ", "project", ""));

        assertEquals(HttpStatus.BAD_REQUEST, resp.getStatusCode());
        Map<String, Object> body = cast(resp.getBody());
        assertTrue(body.containsKey("error"));
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> cast(Object value) {
        return (Map<String, Object>) value;
    }
}