package com.example.clip;

import com.example.clip.core.*;
import com.example.clip.service.ModelConfigService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class RoutingLlmProviderCustomTest {

    private ModelConfigService mockConfigService(String activeProvider) {
        ModelConfigService configService = mock(ModelConfigService.class);
        var config = new ModelConfig();
        config.setActiveProvider(activeProvider);
        when(configService.getConfig()).thenReturn(config);
        return configService;
    }

    // ==================== 非流式测试 ====================

    @Test
    void routesToCustomWhenActiveProviderIsCustom() {
        ModelConfigService configService = mockConfigService("custom");
        DashScopeLlmProvider dashScope = mock(DashScopeLlmProvider.class);
        DeepSeekLlmProvider deepSeek = mock(DeepSeekLlmProvider.class);
        OpenAiCompatibleLlmProvider custom = mock(OpenAiCompatibleLlmProvider.class);

        when(custom.isAvailable()).thenReturn(true);
        when(custom.chat("sys", "hello")).thenReturn("custom reply");

        RoutingLlmProvider routing = new RoutingLlmProvider(configService, dashScope, deepSeek, custom);
        String result = routing.chat("sys", "hello");

        assertEquals("custom reply", result);
        verify(custom).chat("sys", "hello");
        verify(deepSeek, never()).chat(any(), any());
        verify(dashScope, never()).chat(any(), any());
    }

    @Test
    void fallsBackFromCustomToDeepseek() {
        ModelConfigService configService = mockConfigService("custom");
        DashScopeLlmProvider dashScope = mock(DashScopeLlmProvider.class);
        DeepSeekLlmProvider deepSeek = mock(DeepSeekLlmProvider.class);
        OpenAiCompatibleLlmProvider custom = mock(OpenAiCompatibleLlmProvider.class);

        when(custom.isAvailable()).thenReturn(true);
        when(custom.chat("sys", "hello")).thenThrow(new RuntimeException("custom failed"));
        when(deepSeek.isAvailable()).thenReturn(true);
        when(deepSeek.chat("sys", "hello")).thenReturn("deepseek reply");

        RoutingLlmProvider routing = new RoutingLlmProvider(configService, dashScope, deepSeek, custom);
        String result = routing.chat("sys", "hello");

        assertEquals("deepseek reply", result);
        verify(custom).chat("sys", "hello");
        verify(deepSeek).chat("sys", "hello");
        verify(dashScope, never()).chat(any(), any());
    }

    @Test
    void fallsBackFromCustomToDeepseekToDashscope() {
        ModelConfigService configService = mockConfigService("custom");
        DashScopeLlmProvider dashScope = mock(DashScopeLlmProvider.class);
        DeepSeekLlmProvider deepSeek = mock(DeepSeekLlmProvider.class);
        OpenAiCompatibleLlmProvider custom = mock(OpenAiCompatibleLlmProvider.class);

        when(custom.isAvailable()).thenReturn(true);
        when(custom.chat("sys", "hello")).thenThrow(new RuntimeException("custom failed"));
        when(deepSeek.isAvailable()).thenReturn(true);
        when(deepSeek.chat("sys", "hello")).thenThrow(new RuntimeException("deepseek failed"));
        when(dashScope.isAvailable()).thenReturn(true);
        when(dashScope.chat("sys", "hello")).thenReturn("dashscope reply");

        RoutingLlmProvider routing = new RoutingLlmProvider(configService, dashScope, deepSeek, custom);
        String result = routing.chat("sys", "hello");

        assertEquals("dashscope reply", result);
        verify(custom).chat("sys", "hello");
        verify(deepSeek).chat("sys", "hello");
        verify(dashScope).chat("sys", "hello");
    }

    @Test
    void throwsWhenAllProvidersFail() {
        ModelConfigService configService = mockConfigService("custom");
        DashScopeLlmProvider dashScope = mock(DashScopeLlmProvider.class);
        DeepSeekLlmProvider deepSeek = mock(DeepSeekLlmProvider.class);
        OpenAiCompatibleLlmProvider custom = mock(OpenAiCompatibleLlmProvider.class);

        when(custom.isAvailable()).thenReturn(true);
        when(custom.chat("sys", "hello")).thenThrow(new RuntimeException("custom failed"));
        when(deepSeek.isAvailable()).thenReturn(true);
        when(deepSeek.chat("sys", "hello")).thenThrow(new RuntimeException("deepseek failed"));
        when(dashScope.isAvailable()).thenReturn(true);
        when(dashScope.chat("sys", "hello")).thenThrow(new RuntimeException("dashscope failed"));

        RoutingLlmProvider routing = new RoutingLlmProvider(configService, dashScope, deepSeek, custom);
        RuntimeException ex = assertThrows(RuntimeException.class, () -> routing.chat("sys", "hello"));

        assertTrue(ex.getMessage().contains("custom") || ex.getMessage().contains("deepseek") || ex.getMessage().contains("dashscope"));
        verify(custom).chat("sys", "hello");
        verify(deepSeek).chat("sys", "hello");
        verify(dashScope).chat("sys", "hello");
    }

    // ==================== 流式测试 ====================

    @Test
    void streamFallbackFromCustom() {
        ModelConfigService configService = mockConfigService("custom");
        DashScopeLlmProvider dashScope = mock(DashScopeLlmProvider.class);
        DeepSeekLlmProvider deepSeek = mock(DeepSeekLlmProvider.class);
        OpenAiCompatibleLlmProvider custom = mock(OpenAiCompatibleLlmProvider.class);

        ChatStreamHandle customHandle = mock(ChatStreamHandle.class);
        ChatStreamHandle deepSeekHandle = mock(ChatStreamHandle.class);

        when(custom.isAvailable()).thenReturn(true);
        when(deepSeek.isAvailable()).thenReturn(true);
        when(dashScope.isAvailable()).thenReturn(true);
        when(custom.streamChat(any(), any())).thenReturn(customHandle);
        when(deepSeek.streamChat(any(), any())).thenReturn(deepSeekHandle);

        RoutingLlmProvider routing = new RoutingLlmProvider(configService, dashScope, deepSeek, custom);
        routing.streamChat(List.of(new ChatMessage("user", "hello")), new ChatStreamListener() {
            @Override public void onDelta(String content) { }
            @Override public void onComplete() { }
            @Override public void onError(Throwable error) { }
        });

        ArgumentCaptor<ChatStreamListener> captor = ArgumentCaptor.forClass(ChatStreamListener.class);
        verify(custom).streamChat(any(), captor.capture());
        captor.getValue().onError(new RuntimeException("network"));
        verify(deepSeek).streamChat(any(), any());
    }

    @Test
    void streamNoFallbackAfterDelta() {
        ModelConfigService configService = mockConfigService("custom");
        DashScopeLlmProvider dashScope = mock(DashScopeLlmProvider.class);
        DeepSeekLlmProvider deepSeek = mock(DeepSeekLlmProvider.class);
        OpenAiCompatibleLlmProvider custom = mock(OpenAiCompatibleLlmProvider.class);

        ChatStreamHandle customHandle = mock(ChatStreamHandle.class);

        when(custom.isAvailable()).thenReturn(true);
        when(custom.streamChat(any(), any())).thenReturn(customHandle);

        RoutingLlmProvider routing = new RoutingLlmProvider(configService, dashScope, deepSeek, custom);
        routing.streamChat(List.of(new ChatMessage("user", "hello")), new ChatStreamListener() {
            @Override public void onDelta(String content) { }
            @Override public void onComplete() { }
            @Override public void onError(Throwable error) { }
        });

        ArgumentCaptor<ChatStreamListener> captor = ArgumentCaptor.forClass(ChatStreamListener.class);
        verify(custom).streamChat(any(), captor.capture());
        captor.getValue().onDelta("partial");
        captor.getValue().onError(new RuntimeException("network"));
        verify(deepSeek, never()).streamChat(any(), any());
        verify(dashScope, never()).streamChat(any(), any());
    }
}