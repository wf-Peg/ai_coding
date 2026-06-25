package com.example.clip.core;

import com.example.clip.service.ModelConfigService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.*;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.util.*;

/**
 * DeepSeek LLM 提供者
 * 调用 DeepSeek 的 OpenAI 兼容 API（https://api.deepseek.com/v1/chat/completions）
 */
@Component
public class DeepSeekLlmProvider implements LlmProvider {

    private static final Logger logger = LoggerFactory.getLogger(DeepSeekLlmProvider.class);
    private static final String BASE_URL = "https://api.deepseek.com";
    private static final String CHAT_ENDPOINT = "/v1/chat/completions";

    private final ModelConfigService modelConfigService;
    private final RestTemplate restTemplate;

    public DeepSeekLlmProvider(ModelConfigService modelConfigService) {
        this.modelConfigService = modelConfigService;
        this.restTemplate = new RestTemplate();
    }

    @Override
    public String chat(String systemPrompt, String userMessage) {
        ModelConfig config = modelConfigService.getConfig();
        String apiKey = config.getDeepseekApiKey();
        String model = config.getDeepseekModel();

        if (apiKey == null || apiKey.isEmpty()) {
            throw new RuntimeException("DeepSeek API Key 未配置，请在设置页面中配置");
        }
        if (model == null || model.isEmpty()) {
            model = "deepseek-chat";
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
                    BASE_URL + CHAT_ENDPOINT,
                    HttpMethod.POST,
                    entity,
                    Map.class
            );

            Map<String, Object> body = response.getBody();
            if (body == null) {
                throw new RuntimeException("DeepSeek 返回空响应");
            }

            List<Map<String, Object>> choices = (List<Map<String, Object>>) body.get("choices");
            if (choices == null || choices.isEmpty()) {
                throw new RuntimeException("DeepSeek 返回无 choices: " + body);
            }

            Map<String, Object> message = (Map<String, Object>) choices.get(0).get("message");
            if (message == null) {
                throw new RuntimeException("DeepSeek 返回无 message");
            }

            return (String) message.get("content");
        } catch (Exception e) {
            logger.error("[DeepSeek] chat failed: {}", e.getMessage(), e);
            throw new RuntimeException("DeepSeek 调用失败: " + e.getMessage(), e);
        }
    }

    @Override
    public String getProviderName() {
        return "deepseek";
    }

    @Override
    public boolean isAvailable() {
        ModelConfig config = modelConfigService.getConfig();
        return config.getDeepseekApiKey() != null && !config.getDeepseekApiKey().isEmpty();
    }
}