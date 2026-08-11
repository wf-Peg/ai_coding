package com.example.clip.core;

import com.example.clip.service.ModelConfigService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.*;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.net.URI;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * DeepSeek 大模型提供者实现。
 * <p>
 * 通过 DeepSeek 的 OpenAI 兼容 API 接口进行调用，
 * 使用 Spring 的 {@link RestTemplate} 发送 HTTP POST 请求。
 * API 端点：{@code https://api.deepseek.com/v1/chat/completions}
 * </p>
 *
 * <h3>与 DashScope 的区别</h3>
 * <ul>
 *   <li>不使用专用 SDK，直接通过 HTTP REST API 调用</li>
 *   <li>请求/响应格式兼容 OpenAI Chat Completions API</li>
 *   <li>API Key 和模型名称完全依赖用户配置，没有 yml 默认值</li>
 * </ul>
 *
 * <h3>调用流程</h3>
 * <ol>
 *   <li>从 {@link ModelConfigService} 获取当前配置</li>
 *   <li>校验 API Key 和模型名称是否已配置</li>
 *   <li>构建 HTTP 请求头（Content-Type: application/json + Bearer Token）</li>
 *   <li>构建请求体（model、messages、stream=false）</li>
 *   <li>发送 POST 请求并解析响应</li>
 *   <li>从响应中提取 choices[0].message.content</li>
 * </ol>
 *
 * <p>
 * 注意：此实现使用同步 HTTP 调用，会阻塞当前线程。
 * {@link RestTemplate} 是在构造器中手动创建的，而非通过 Spring 注入，
 * 这样做是为了避免与 Spring Boot 自动配置的 RestTemplate 冲突。
 * </p>
 *
 * <p>
 * <b>【潜在问题】</b> {@link RestTemplate} 在构造器中直接 new 创建，
 * 无法利用 Spring Boot 的自动配置（如连接池、超时设置、拦截器等）。
 * 如果未来需要更复杂的 HTTP 配置，建议改为注入 Spring 管理的 RestTemplate Bean。
 * </p>
 */
@Component
public class DeepSeekLlmProvider implements LlmProvider {

    private static final Logger logger = LoggerFactory.getLogger(DeepSeekLlmProvider.class);

    /** DeepSeek API 基础 URL */
    private static final String BASE_URL = "https://api.deepseek.com";

    /** Chat Completions API 端点路径 */
    private static final String CHAT_ENDPOINT = "/v1/chat/completions";

    /** 模型配置服务，用于获取用户配置的 API Key 和模型名称 */
    private final ModelConfigService modelConfigService;

    /** HTTP 客户端，用于发送 REST API 请求 */
    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;
    private final ExecutorService streamExecutor = Executors.newCachedThreadPool();

    /**
     * 构造器注入 ModelConfigService，并手动创建 RestTemplate。
     *
     * @param modelConfigService 模型配置服务
     */
    public DeepSeekLlmProvider(ModelConfigService modelConfigService) {
        this.modelConfigService = modelConfigService;
        // 手动创建 RestTemplate 实例，避免与 Spring Boot 自动配置冲突
        this.restTemplate = new RestTemplate();
        this.objectMapper = new ObjectMapper();
    }

    /**
     * 调用 DeepSeek API 进行对话。
     * <p>
     * 通过 HTTP POST 请求调用 DeepSeek 的 OpenAI 兼容接口。
     * 请求格式遵循 OpenAI Chat Completions API 规范。
     * </p>
     *
     * @param systemPrompt 系统提示词
     * @param userMessage  用户消息
     * @return 模型生成的文本回复
     * @throws RuntimeException 当 API Key 未配置或 API 调用失败时抛出
     */
    @Override
    public String chat(String systemPrompt, String userMessage) {
        return chat(null, systemPrompt, userMessage);
    }

    /**
     * 使用指定模型名调用 DeepSeek API。
     * <p>
     * 允许上层（如 RoutingLlmProvider）指定模型名（如 "deepseek-v4-flash" / "deepseek-v4-pro"），
     * 用于档位路由场景。当 modelName 为 null 或空时，回退到用户配置的模型名。
     * </p>
     *
     * @param modelName    显式指定的模型名（可为 null，此时使用配置默认值）
     * @param systemPrompt 系统提示词
     * @param userMessage  用户消息
     * @return 模型生成的文本回复
     */
    @Override
    public String chat(String modelName, String systemPrompt, String userMessage) {
        // 获取运行时配置
        ModelConfig config = modelConfigService.getConfig();

        // 【修复】防御性检查：config 可能为 null（首次启动时配置尚未初始化）
        if (config == null) {
            throw new RuntimeException("DeepSeek 配置未初始化，请先在设置页面中配置 API Key");
        }

        String apiKey = config.getDeepseekApiKey();

        // 校验 API Key 是否已配置
        if (apiKey == null || apiKey.isBlank() || apiKey.startsWith("your-") || apiKey.startsWith("${")) {
            throw new RuntimeException("DeepSeek API Key 未配置，请在设置页面中配置");
        }

        // 模型名优先级：显式指定 > 用户配置 > 默认值
        String model = modelName;
        if (model == null || model.isEmpty()) {
            model = config.getDeepseekModel();
        }
        if (model == null || model.isEmpty()) {
            model = "deepseek-v4-flash";
        }

        try {
            // 构建 HTTP 请求头
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);  // 设置内容类型为 JSON
            headers.setBearerAuth(apiKey);                        // 设置 Bearer Token 认证

            // 构建请求体：model + messages + stream=false（非流式）
            Map<String, Object> requestBody = new LinkedHashMap<>();
            requestBody.put("model", model);
            requestBody.put("stream", false);  // 非流式调用，返回完整响应
            requestBody.put("messages", Arrays.asList(
                    // 系统消息：设定 AI 的角色和行为
                    Map.of("role", "system", "content", systemPrompt),
                    // 用户消息：实际要处理的内容
                    Map.of("role", "user", "content", userMessage)
            ));

            // 封装请求实体（请求体 + 请求头）
            HttpEntity<Map<String, Object>> entity = new HttpEntity<>(requestBody, headers);

            // 发送 POST 请求并获取响应
            ResponseEntity<Map> response = restTemplate.exchange(
                    BASE_URL + CHAT_ENDPOINT,  // 完整 URL
                    HttpMethod.POST,            // POST 方法
                    entity,                     // 请求实体
                    Map.class                   // 响应体反序列化为 Map
            );

            // 获取响应体
            Map<String, Object> body = response.getBody();
            if (body == null) {
                throw new RuntimeException("DeepSeek 返回空响应");
            }

            // 提取 choices 数组
            List<Map<String, Object>> choices = (List<Map<String, Object>>) body.get("choices");
            if (choices == null || choices.isEmpty()) {
                throw new RuntimeException("DeepSeek 返回无 choices: " + body);
            }

            // 提取第一个 choice 中的 message 对象
            Map<String, Object> message = (Map<String, Object>) choices.get(0).get("message");
            if (message == null) {
                throw new RuntimeException("DeepSeek 返回无 message");
            }

            // 返回 message 中的 content 字段（即模型的文本回复）
            return (String) message.get("content");
        } catch (Exception e) {
            // 记录完整错误信息，便于排查网络问题或 API 错误
            logger.error("[DeepSeek] chat failed: {}", e.getMessage(), e);
            throw new RuntimeException("DeepSeek 调用失败: " + e.getMessage(), e);
        }
    }

    @Override
    public ChatStreamHandle streamChat(List<ChatMessage> messages, ChatStreamListener listener) {
        ModelConfig config = modelConfigService.getConfig();
        if (config == null || config.getDeepseekApiKey() == null || config.getDeepseekApiKey().isBlank()) {
            listener.onError(new IllegalStateException("DeepSeek API Key 未配置，请在设置页面中配置"));
            return new ChatStreamHandle() {
                @Override public void cancel() { }
                @Override public boolean isCancelled() { return false; }
            };
        }

        String model = config.getDeepseekModel() == null || config.getDeepseekModel().isBlank()
                ? "deepseek-v4-flash" : config.getDeepseekModel();
        Map<String, Object> requestBody = new LinkedHashMap<>();
        requestBody.put("model", model);
        requestBody.put("stream", true);
        requestBody.put("messages", messages.stream()
                .map(message -> Map.of("role", message.role(), "content", message.content()))
                .toList());

        java.util.concurrent.Future<?> future = streamExecutor.submit(() -> {
            try {
                restTemplate.execute(
                        URI.create(BASE_URL + CHAT_ENDPOINT),
                        HttpMethod.POST,
                        request -> {
                            request.getHeaders().setContentType(MediaType.APPLICATION_JSON);
                            request.getHeaders().setBearerAuth(config.getDeepseekApiKey());
                            objectMapper.writeValue(request.getBody(), requestBody);
                        },
                        response -> {
                            if (!response.getStatusCode().is2xxSuccessful()) {
                                throw new RuntimeException("DeepSeek 流式请求失败: HTTP " + response.getStatusCode().value());
                            }
                            OpenAiSseParser parser = new OpenAiSseParser(objectMapper, listener::onDelta, listener::onComplete);
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

    /**
     * 获取提供者名称。
     *
     * @return 固定返回 "deepseek"
     */
    @Override
    public String getProviderName() {
        return "deepseek";
    }

    /**
     * 判断 DeepSeek 是否可用。
     * <p>
     * 检查用户是否在设置页面配置了 DeepSeek API Key。
     * 只有当 API Key 已配置且非空时才返回 true。
     * </p>
     *
     * @return true 表示 API Key 已配置，可以正常调用
     */
    @Override
    public boolean isAvailable() {
        ModelConfig config = modelConfigService.getConfig();
        // 【修复】防御性检查：config 为 null 时视为不可用
        if (config == null) {
            return false;
        }
        String apiKey = config.getDeepseekApiKey();
        return apiKey != null && !apiKey.isBlank()
                && !apiKey.startsWith("your-")
                && !apiKey.startsWith("${");
    }
}
