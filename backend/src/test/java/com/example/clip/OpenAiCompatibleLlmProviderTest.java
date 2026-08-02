package com.example.clip;

import com.example.clip.core.ChatMessage;
import com.example.clip.core.ChatStreamHandle;
import com.example.clip.core.ChatStreamListener;
import com.example.clip.core.ModelConfig;
import com.example.clip.core.OpenAiCompatibleLlmProvider;
import com.example.clip.service.ModelConfigService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.http.*;
import org.springframework.http.client.ClientHttpResponse;
import org.springframework.util.ReflectionUtils;
import org.springframework.web.client.RequestCallback;
import org.springframework.web.client.ResponseExtractor;
import org.springframework.web.client.RestTemplate;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class OpenAiCompatibleLlmProviderTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    // ==================== helper ====================

    private RestTemplate mockRestTemplate(OpenAiCompatibleLlmProvider provider) {
        RestTemplate mock = mock(RestTemplate.class);
        // 利用反射替换 provider 中的 restTemplate 字段
        Field field = ReflectionUtils.findField(OpenAiCompatibleLlmProvider.class, "restTemplate");
        assertNotNull(field);
        field.setAccessible(true);
        ReflectionUtils.setField(field, provider, mock);
        return mock;
    }

    private ModelConfigService mockConfigService(String apiKey, String model, String baseUrl, String providerKey) {
        ModelConfigService service = mock(ModelConfigService.class);
        ModelConfig config = new ModelConfig();
        switch (providerKey) {
            case "deepseek" -> {
                config.setDeepseekApiKey(apiKey);
                config.setDeepseekModel(model);
            }
            case "custom" -> {
                config.setCustomApiKey(apiKey);
                config.setCustomModel(model);
                config.setCustomBaseUrl(baseUrl);
            }
            default -> { // dashscope
                config.setDashscopeApiKey(apiKey);
                config.setDashscopeModel(model);
            }
        }
        when(service.getConfig()).thenReturn(config);
        return service;
    }

    // ==================== chat() ====================

    @Test
    @SuppressWarnings("unchecked")
    void chat_sendsCorrectRequestAndParsesResponse() {
        // 准备：custom provider，指定 baseUrl
        ModelConfigService configService = mockConfigService("sk-test-key", "gpt-4", "https://api.test.com", "custom");
        OpenAiCompatibleLlmProvider provider = new OpenAiCompatibleLlmProvider(configService, "test-provider", "custom");
        RestTemplate restTemplate = mockRestTemplate(provider);

        // mock 响应
        Map<String, Object> responseBody = Map.of(
            "choices", List.of(
                Map.of("message", Map.of("content", "Hello from AI!"))
            )
        );
        ResponseEntity<Map> responseEntity = new ResponseEntity<>(responseBody, HttpStatus.OK);
        when(restTemplate.exchange(
            anyString(), any(HttpMethod.class), any(HttpEntity.class), eq(Map.class)
        )).thenReturn(responseEntity);

        // 执行
        String result = provider.chat("You are helpful", "Hello");

        // 验证 URL 和方法
        verify(restTemplate).exchange(
            eq("https://api.test.com/chat/completions"),
            eq(HttpMethod.POST),
            any(HttpEntity.class),
            eq(Map.class)
        );

        // 验证请求头
        var captor = org.mockito.ArgumentCaptor.forClass(HttpEntity.class);
        verify(restTemplate).exchange(
            anyString(), any(HttpMethod.class), captor.capture(), eq(Map.class)
        );
        @SuppressWarnings("unchecked")
        HttpEntity<Map<String, Object>> entity = (HttpEntity<Map<String, Object>>) (HttpEntity<?>) captor.getValue();
        assertEquals(MediaType.APPLICATION_JSON, entity.getHeaders().getContentType());
        assertEquals("Bearer sk-test-key", entity.getHeaders().getFirst(HttpHeaders.AUTHORIZATION));

        // 验证请求体
        Map<String, Object> body = entity.getBody();
        assertNotNull(body);
        assertEquals("gpt-4", body.get("model"));
        assertEquals(false, body.get("stream"));

        // 验证响应解析
        assertEquals("Hello from AI!", result);
    }

    @Test
    @SuppressWarnings("unchecked")
    void chat_usesDeepSeekDefaults() {
        // deepseek provider 使用预设 baseUrl
        ModelConfigService configService = mockConfigService("sk-deepseek", "deepseek-v4-flash", null, "deepseek");
        OpenAiCompatibleLlmProvider provider = new OpenAiCompatibleLlmProvider(configService, "deepseek", "deepseek");
        RestTemplate restTemplate = mockRestTemplate(provider);

        Map<String, Object> responseBody = Map.of(
            "choices", List.of(
                Map.of("message", Map.of("content", "ok"))
            )
        );
        ResponseEntity<Map> responseEntity = new ResponseEntity<>(responseBody, HttpStatus.OK);
        when(restTemplate.exchange(
            anyString(), any(HttpMethod.class), any(HttpEntity.class), eq(Map.class)
        )).thenReturn(responseEntity);

        provider.chat("system", "user");

        // 验证使用 DeepSeek 预设 baseUrl
        verify(restTemplate).exchange(
            eq("https://api.deepseek.com/v1/chat/completions"),
            eq(HttpMethod.POST),
            any(HttpEntity.class),
            eq(Map.class)
        );
    }

    @Test
    @SuppressWarnings("unchecked")
    void chat_usesDashScopeDefaults() {
        ModelConfigService configService = mockConfigService("sk-dashscope", "qwen-plus", null, "dashscope");
        OpenAiCompatibleLlmProvider provider = new OpenAiCompatibleLlmProvider(configService, "dashscope", "dashscope");
        RestTemplate restTemplate = mockRestTemplate(provider);

        Map<String, Object> responseBody = Map.of(
            "choices", List.of(
                Map.of("message", Map.of("content", "ok"))
            )
        );
        ResponseEntity<Map> responseEntity = new ResponseEntity<>(responseBody, HttpStatus.OK);
        when(restTemplate.exchange(
            anyString(), any(HttpMethod.class), any(HttpEntity.class), eq(Map.class)
        )).thenReturn(responseEntity);

        provider.chat("system", "user");

        verify(restTemplate).exchange(
            eq("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"),
            eq(HttpMethod.POST),
            any(HttpEntity.class),
            eq(Map.class)
        );
    }

    @Test
    void chat_throwsWhenApiKeyMissing() {
        ModelConfigService configService = mockConfigService("", "gpt-4", "https://api.test.com", "custom");
        OpenAiCompatibleLlmProvider provider = new OpenAiCompatibleLlmProvider(configService, "test", "custom");

        assertThrows(RuntimeException.class, () -> provider.chat("system", "user"));
    }

    @Test
    void chat_throwsWhenConfigIsNull() {
        ModelConfigService configService = mock(ModelConfigService.class);
        when(configService.getConfig()).thenReturn(null);
        OpenAiCompatibleLlmProvider provider = new OpenAiCompatibleLlmProvider(configService, "test", "custom");

        assertThrows(RuntimeException.class, () -> provider.chat("system", "user"));
    }

    // ==================== streamChat() ====================

    @Test
    void streamChat_sendsCorrectRequestAndParsesSse() throws Exception {
        ModelConfigService configService = mockConfigService("sk-stream", "gpt-4", "https://api.stream.com", "custom");
        OpenAiCompatibleLlmProvider provider = new OpenAiCompatibleLlmProvider(configService, "stream", "custom");
        RestTemplate restTemplate = mockRestTemplate(provider);

        // 模拟 SSE 响应数据
        String sseData = "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\n" +
                         "data: {\"choices\":[{\"delta\":{\"content\":\" World\"}}]}\n\n" +
                         "data: [DONE]\n\n";

        doAnswer(invocation -> {
            URI uri = invocation.getArgument(0);
            HttpMethod method = invocation.getArgument(1);
            RequestCallback callback = invocation.getArgument(2);
            ResponseExtractor<?> extractor = invocation.getArgument(3);

            assertEquals("https://api.stream.com/chat/completions", uri.toString());
            assertEquals(HttpMethod.POST, method);

            // 验证请求回调设置正确的 headers
            // 无法直接测试 callback，因为需要 ClientHttpRequest，但可以验证 URL 和方法

            // 执行 ResponseExtractor 模拟响应处理
            ClientHttpResponse mockResponse = mock(ClientHttpResponse.class);
            when(mockResponse.getStatusCode()).thenReturn(HttpStatus.OK);
            InputStream bodyStream = new ByteArrayInputStream(sseData.getBytes(StandardCharsets.UTF_8));
            when(mockResponse.getBody()).thenReturn(bodyStream);

            extractor.extractData(mockResponse);
            return null;
        }).when(restTemplate).execute(any(URI.class), any(HttpMethod.class), any(), any());

        List<String> deltas = new ArrayList<>();
        CountDownLatch latch = new CountDownLatch(1);
        ChatStreamListener listener = new ChatStreamListener() {
            @Override public void onDelta(String content) { deltas.add(content); }
            @Override public void onComplete() { latch.countDown(); }
            @Override public void onError(Throwable error) { latch.countDown(); }
        };

        List<ChatMessage> messages = List.of(new ChatMessage("user", "hello"));
        ChatStreamHandle handle = provider.streamChat(messages, listener);
        assertNotNull(handle);

        // 等待异步任务完成
        assertTrue(latch.await(3, TimeUnit.SECONDS), "streamChat 未在超时内完成");
        assertEquals(List.of("Hello", " World"), deltas);
    }

    @Test
    void streamChat_callsOnErrorWhenApiKeyMissing() {
        ModelConfigService configService = mockConfigService("", "gpt-4", "https://api.test.com", "custom");
        OpenAiCompatibleLlmProvider provider = new OpenAiCompatibleLlmProvider(configService, "test", "custom");

        List<Throwable> errors = new ArrayList<>();
        ChatStreamListener listener = new ChatStreamListener() {
            @Override public void onDelta(String content) { }
            @Override public void onComplete() { }
            @Override public void onError(Throwable error) { errors.add(error); }
        };

        provider.streamChat(List.of(new ChatMessage("user", "hi")), listener);
        assertFalse(errors.isEmpty());
        assertTrue(errors.get(0).getMessage().contains("API Key 未配置"));
    }

    @Test
    void streamChat_usesDeepSeekBaseUrl() throws Exception {
        ModelConfigService configService = mockConfigService("sk-ds", "deepseek-v4-flash", null, "deepseek");
        OpenAiCompatibleLlmProvider provider = new OpenAiCompatibleLlmProvider(configService, "deepseek", "deepseek");
        RestTemplate restTemplate = mockRestTemplate(provider);

        CountDownLatch latch = new CountDownLatch(1);
        doAnswer(invocation -> {
            URI uri = invocation.getArgument(0);
            assertEquals("https://api.deepseek.com/v1/chat/completions", uri.toString());
            latch.countDown();
            return null;
        }).when(restTemplate).execute(any(URI.class), any(HttpMethod.class), any(), any());

        provider.streamChat(List.of(new ChatMessage("user", "hi")), new ChatStreamListener() {
            @Override public void onDelta(String content) { }
            @Override public void onComplete() { }
            @Override public void onError(Throwable error) { }
        });

        // 等待异步调用执行，doAnswer 会验证 URL
        assertTrue(latch.await(3, TimeUnit.SECONDS), "restTemplate.execute 未被调用");
    }

    // ==================== isAvailable() ====================

    @Test
    void isAvailable_returnsFalseWhenApiKeyIsNull() {
        ModelConfigService configService = mockConfigService(null, "gpt-4", "https://api.test.com", "custom");
        OpenAiCompatibleLlmProvider provider = new OpenAiCompatibleLlmProvider(configService, "test", "custom");
        assertFalse(provider.isAvailable());
    }

    @Test
    void isAvailable_returnsFalseWhenApiKeyIsBlank() {
        ModelConfigService configService = mockConfigService("   ", "gpt-4", "https://api.test.com", "custom");
        OpenAiCompatibleLlmProvider provider = new OpenAiCompatibleLlmProvider(configService, "test", "custom");
        assertFalse(provider.isAvailable());
    }

    @Test
    void isAvailable_returnsFalseWhenApiKeyIsPlaceholder() {
        ModelConfigService configService = mockConfigService("your-api-key-here", "gpt-4", "https://api.test.com", "custom");
        OpenAiCompatibleLlmProvider provider = new OpenAiCompatibleLlmProvider(configService, "test", "custom");
        assertFalse(provider.isAvailable());
    }

    @Test
    void isAvailable_returnsFalseWhenApiKeyIsExpression() {
        ModelConfigService configService = mockConfigService("${DEEPSEEK_API_KEY}", "gpt-4", "https://api.test.com", "custom");
        OpenAiCompatibleLlmProvider provider = new OpenAiCompatibleLlmProvider(configService, "test", "custom");
        assertFalse(provider.isAvailable());
    }

    @Test
    void isAvailable_returnsTrueWhenApiKeyIsValid() {
        ModelConfigService configService = mockConfigService("sk-real-key-123", "gpt-4", "https://api.test.com", "custom");
        OpenAiCompatibleLlmProvider provider = new OpenAiCompatibleLlmProvider(configService, "test", "custom");
        assertTrue(provider.isAvailable());
    }

    @Test
    void isAvailable_returnsFalseWhenConfigIsNull() {
        ModelConfigService configService = mock(ModelConfigService.class);
        when(configService.getConfig()).thenReturn(null);
        OpenAiCompatibleLlmProvider provider = new OpenAiCompatibleLlmProvider(configService, "test", "custom");
        assertFalse(provider.isAvailable());
    }

    // ==================== getProviderName() ====================

    @Test
    void getProviderName_returnsConstructedName() {
        ModelConfigService configService = mockConfigService("sk-key", "gpt-4", "https://api.test.com", "custom");
        OpenAiCompatibleLlmProvider provider = new OpenAiCompatibleLlmProvider(configService, "my-custom-name", "custom");
        assertEquals("my-custom-name", provider.getProviderName());
    }

    @Test
    void getProviderName_returnsDashscope() {
        ModelConfigService configService = mockConfigService("sk-key", "qwen-plus", null, "dashscope");
        OpenAiCompatibleLlmProvider provider = new OpenAiCompatibleLlmProvider(configService, "dashscope", "dashscope");
        assertEquals("dashscope", provider.getProviderName());
    }

    @Test
    void getProviderName_returnsDeepseek() {
        ModelConfigService configService = mockConfigService("sk-key", "deepseek-v4-flash", null, "deepseek");
        OpenAiCompatibleLlmProvider provider = new OpenAiCompatibleLlmProvider(configService, "deepseek", "deepseek");
        assertEquals("deepseek", provider.getProviderName());
    }
}