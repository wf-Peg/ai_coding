package com.example.clip;

import com.example.clip.core.ChatMessage;
import com.example.clip.core.ChatStreamHandle;
import com.example.clip.core.ChatStreamListener;
import com.example.clip.core.DashScopeLlmProvider;
import com.example.clip.core.DeepSeekLlmProvider;
import com.example.clip.core.RoutingLlmProvider;
import com.example.clip.service.ModelConfigService;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class RoutingLlmProviderTest {

    @Test
    void fallsBackBeforeFirstDelta() {
        ModelConfigService configService = mock(ModelConfigService.class);
        var config = new com.example.clip.core.ModelConfig();
        config.setActiveProvider("deepseek");
        when(configService.getConfig()).thenReturn(config);

        DashScopeLlmProvider dashScope = mock(DashScopeLlmProvider.class);
        DeepSeekLlmProvider deepSeek = mock(DeepSeekLlmProvider.class);
        ChatStreamHandle failedHandle = mock(ChatStreamHandle.class);
        ChatStreamHandle fallbackHandle = mock(ChatStreamHandle.class);
        when(deepSeek.isAvailable()).thenReturn(true);
        when(dashScope.isAvailable()).thenReturn(true);
        when(deepSeek.streamChat(any(), any())).thenReturn(failedHandle);
        when(dashScope.streamChat(any(), any())).thenReturn(fallbackHandle);

        RoutingLlmProvider routing = new RoutingLlmProvider(configService, dashScope, deepSeek);
        routing.streamChat(List.of(new ChatMessage("user", "hello")), new ChatStreamListener() {
            @Override public void onDelta(String content) { }
            @Override public void onComplete() { }
            @Override public void onError(Throwable error) { }
        });

        var captor = org.mockito.ArgumentCaptor.forClass(ChatStreamListener.class);
        verify(deepSeek).streamChat(any(), captor.capture());
        captor.getValue().onError(new RuntimeException("network"));
        verify(dashScope).streamChat(any(), any());
    }

    @Test
    void doesNotFallbackAfterARealDelta() {
        ModelConfigService configService = mock(ModelConfigService.class);
        var config = new com.example.clip.core.ModelConfig();
        config.setActiveProvider("deepseek");
        when(configService.getConfig()).thenReturn(config);

        DashScopeLlmProvider dashScope = mock(DashScopeLlmProvider.class);
        DeepSeekLlmProvider deepSeek = mock(DeepSeekLlmProvider.class);
        when(deepSeek.isAvailable()).thenReturn(true);
        ChatStreamHandle handle = mock(ChatStreamHandle.class);
        when(deepSeek.streamChat(any(), any())).thenReturn(handle);

        RoutingLlmProvider routing = new RoutingLlmProvider(configService, dashScope, deepSeek);
        routing.streamChat(List.of(new ChatMessage("user", "hello")), new ChatStreamListener() {
            @Override public void onDelta(String content) { }
            @Override public void onComplete() { }
            @Override public void onError(Throwable error) { }
        });

        var captor = org.mockito.ArgumentCaptor.forClass(ChatStreamListener.class);
        verify(deepSeek).streamChat(any(), captor.capture());
        captor.getValue().onDelta("partial");
        captor.getValue().onError(new RuntimeException("network"));
        verify(dashScope, never()).streamChat(any(), any());
    }
}
