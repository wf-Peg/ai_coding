package com.example.clip.core;

import com.example.clip.service.ModelConfigService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.*;
import org.springframework.web.client.RestTemplate;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * OpenAI 兼容接口的 LLM 提供者通用实现。
 * <p>
 * 通过 OpenAI Chat Completions API 格式调用大模型，支持运行时动态指定
 * baseUrl / apiKey / model，适配 DashScope 兼容模式、DeepSeek 以及自定义中转站。
 * </p>
 *
 * <h3>providerKey 映射规则</h3>
 * <ul>
 *   <li>{@code "dashscope"} → 从 {@link ModelConfig} 读取 dashscopeApiKey / dashscopeModel</li>
 *   <li>{@code "deepseek"}  → 从 {@link ModelConfig} 读取 deepseekApiKey / deepseekModel</li>
 *   <li>{@code "custom"}    → 从 {@link ModelConfig} 读取 customApiKey / customModel / customBaseUrl</li>
 * </ul>
 */
public class OpenAiCompatibleLlmProvider implements LlmProvider {

    private static final Logger logger = LoggerFactory.getLogger(OpenAiCompatibleLlmProvider.class);

    /** Chat Completions API 端点路径 */
    private static final String CHAT_ENDPOINT = "/chat/completions";

    /** DashScope 兼容模式预设 baseUrl */
    public static final String DASHSCOPE_COMPAT_BASE = "https://dashscope.aliyuncs.com/compatible-mode/v1";

    /** DeepSeek 预设 baseUrl */
    public static final String DEEPSEEK_BASE = "https://api.deepseek.com/v1";

    private final ModelConfigService modelConfigService;
    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;
    private final ExecutorService streamExecutor = Executors.newCachedThreadPool();

    private final String providerName;
    private final String providerKey;

    /**
     * 构造 OpenAiCompatibleLlmProvider。
     *
     * @param modelConfigService 模型配置服务
     * @param providerName       提供者展示名称（如 "dashscope" / "deepseek" / "custom"）
     * @param providerKey        配置键，决定从 ModelConfig 读取哪个字段
     *                           （"dashscope" / "deepseek" / "custom"）
     */
    public OpenAiCompatibleLlmProvider(ModelConfigService modelConfigService,
                                       String providerName,
                                       String providerKey) {
        this.modelConfigService = modelConfigService;
        this.providerName = providerName;
        this.providerKey = providerKey;
        this.restTemplate = new RestTemplate();
        this.objectMapper = new ObjectMapper();
    }

    // ==================== 接口实现 ====================

    @Override
    public String chat(String systemPrompt, String userMessage) {
        ModelConfig config = modelConfigService.getConfig();
        if (config == null) {
            throw new RuntimeException(providerName + " 配置未初始化，请先在设置页面中配置 API Key");
        }

        String apiKey = getApiKey(config);
        String model = getModel(config);
        String baseUrl = getBaseUrl(config);

        if (apiKey == null || apiKey.isBlank() || apiKey.startsWith("your-") || apiKey.startsWith("${")) {
            throw new RuntimeException(providerName + " API Key 未配置，请在设置页面中配置");
        }
        if (model == null || model.isEmpty()) {
            model = getDefaultModel();
        }

        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.setBearerAuth(apiKey);

            Map<String, Object> requestBody = new LinkedHashMap<>();
            requestBody.put("model", model);
            requestBody.put("stream", false);
            requestBody.put("messages", Arrays.asList(
                    Map.of("role", "system", "content", systemPrompt),
                    Map.of("role", "user", "content", userMessage)
            ));

            HttpEntity<Map<String, Object>> entity = new HttpEntity<>(requestBody, headers);

            ResponseEntity<Map> response = restTemplate.exchange(
                    baseUrl + CHAT_ENDPOINT,
                    HttpMethod.POST,
                    entity,
                    Map.class
            );

            Map<String, Object> body = response.getBody();
            if (body == null) {
                throw new RuntimeException(providerName + " 返回空响应");
            }

            List<Map<String, Object>> choices = (List<Map<String, Object>>) body.get("choices");
            if (choices == null || choices.isEmpty()) {
                throw new RuntimeException(providerName + " 返回无 choices: " + body);
            }

            Map<String, Object> message = (Map<String, Object>) choices.get(0).get("message");
            if (message == null) {
                throw new RuntimeException(providerName + " 返回无 message");
            }

            return (String) message.get("content");
        } catch (Exception e) {
            logger.error("[{}] chat failed: {}", providerName, e.getMessage(), e);
            throw new RuntimeException(providerName + " 调用失败: " + e.getMessage(), e);
        }
    }

    @Override
    public ChatStreamHandle streamChat(List<ChatMessage> messages, ChatStreamListener listener) {
        ModelConfig config = modelConfigService.getConfig();
        String apiKey = getApiKey(config);
        if (config == null || apiKey == null || apiKey.isBlank()) {
            listener.onError(new IllegalStateException(providerName + " API Key 未配置，请在设置页面中配置"));
            return new ChatStreamHandle() {
                @Override public void cancel() { }
                @Override public boolean isCancelled() { return false; }
            };
        }

        String model = getModel(config);
        if (model == null || model.isBlank()) {
            model = getDefaultModel();
        }
        String baseUrl = getBaseUrl(config);

        final String effectiveModel = model;
        Map<String, Object> requestBody = new LinkedHashMap<>();
        requestBody.put("model", effectiveModel);
        requestBody.put("stream", true);
        requestBody.put("messages", messages.stream()
                .map(msg -> Map.of("role", msg.role(), "content", msg.content()))
                .toList());

        java.util.concurrent.Future<?> future = streamExecutor.submit(() -> {
            try {
                restTemplate.execute(
                        URI.create(baseUrl + CHAT_ENDPOINT),
                        HttpMethod.POST,
                        request -> {
                            request.getHeaders().setContentType(MediaType.APPLICATION_JSON);
                            request.getHeaders().setBearerAuth(apiKey);
                            objectMapper.writeValue(request.getBody(), requestBody);
                        },
                        response -> {
                            if (!response.getStatusCode().is2xxSuccessful()) {
                                throw new RuntimeException(providerName + " 流式请求失败: HTTP "
                                        + response.getStatusCode().value());
                            }
                            OpenAiSseParser parser = new OpenAiSseParser(
                                    objectMapper, listener::onDelta, listener::onComplete);
                            try (BufferedReader reader = new BufferedReader(
                                    new InputStreamReader(response.getBody(), StandardCharsets.UTF_8))) {
                                String line;
                                while ((line = reader.readLine()) != null) {
                                    parser.accept(line + "\n");
                                }
                            }
                            parser.finish();
                            return null;
                        });
            } catch (Exception error) {
                listener.onError(error);
            }
        });
        return new FutureChatStreamHandle(future);
    }

    @Override
    public String getProviderName() {
        return providerName;
    }

    @Override
    public boolean isAvailable() {
        ModelConfig config = modelConfigService.getConfig();
        if (config == null) {
            return false;
        }
        String apiKey = getApiKey(config);
        return apiKey != null && !apiKey.isBlank()
                && !apiKey.startsWith("your-")
                && !apiKey.startsWith("${");
    }

    // ==================== 辅助方法 ====================

    /**
     * 根据 providerKey 从 ModelConfig 获取对应的 baseUrl。
     * dashscope 和 deepseek 有预设值，custom 必须由用户配置。
     */
    private String getBaseUrl(ModelConfig config) {
        if ("custom".equals(providerKey)) {
            String url = config.getCustomBaseUrl();
            if (url != null && !url.isBlank()) return url;
            return ""; // custom 没有默认 baseUrl，返回空字符串将由调用方触发错误
        }
        if ("deepseek".equals(providerKey)) return DEEPSEEK_BASE;
        return DASHSCOPE_COMPAT_BASE;
    }

    /**
     * 根据 providerKey 从 ModelConfig 获取对应的 apiKey。
     */
    private String getApiKey(ModelConfig config) {
        if (config == null) return null;
        return switch (providerKey) {
            case "deepseek" -> config.getDeepseekApiKey();
            case "custom" -> config.getCustomApiKey();
            default -> config.getDashscopeApiKey(); // dashscope 或未知值
        };
    }

    /**
     * 根据 providerKey 从 ModelConfig 获取对应的 model 名称。
     */
    private String getModel(ModelConfig config) {
        if (config == null) return null;
        return switch (providerKey) {
            case "deepseek" -> config.getDeepseekModel();
            case "custom" -> config.getCustomModel();
            default -> config.getDashscopeModel();
        };
    }

    /**
     * 获取默认模型名称（当配置中 model 为空时使用）。
     */
    private String getDefaultModel() {
        return switch (providerKey) {
            case "deepseek" -> "deepseek-v4-flash";
            case "custom" -> "gpt-3.5-turbo";
            default -> "qwen-plus";
        };
    }
}