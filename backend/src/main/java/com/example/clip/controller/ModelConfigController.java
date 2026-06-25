package com.example.clip.controller;

import com.alibaba.dashscope.aigc.generation.Generation;
import com.alibaba.dashscope.aigc.generation.GenerationParam;
import com.alibaba.dashscope.aigc.generation.GenerationResult;
import com.alibaba.dashscope.common.Message;
import com.alibaba.dashscope.common.Role;
import com.example.clip.core.ModelConfig;
import com.example.clip.service.ModelConfigService;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;

import java.util.*;

/**
 * 模型配置 REST API
 */
@RestController
@RequestMapping("/api/model-config")
@CrossOrigin(origins = "*")
public class ModelConfigController {

    private final ModelConfigService modelConfigService;
    private final Generation generation;

    public ModelConfigController(ModelConfigService modelConfigService,
                                 Generation generation) {
        this.modelConfigService = modelConfigService;
        this.generation = generation;
    }

    /**
     * 获取当前模型配置
     */
    @GetMapping
    public ResponseEntity<ModelConfig> getConfig() {
        return ResponseEntity.ok(modelConfigService.getConfig());
    }

    /**
     * 保存模型配置
     */
    @PostMapping
    public ResponseEntity<ModelConfig> saveConfig(@RequestBody ModelConfig config) {
        ModelConfig saved = modelConfigService.saveConfig(config);
        return ResponseEntity.ok(saved);
    }

    /**
     * 测试模型连接
     * 直接使用表单传入的 apiKey 和 model，无需提前保存
     */
    @PostMapping("/test")
    public ResponseEntity<Map<String, Object>> testConnection(@RequestBody Map<String, String> body) {
        String provider = body.getOrDefault("provider", "dashscope");
        String apiKey = body.get("apiKey");
        String model = body.get("model");
        Map<String, Object> result = new LinkedHashMap<>();

        try {
            if ("deepseek".equals(provider)) {
                String response = testDeepSeek(apiKey, model);
                result.put("success", true);
                result.put("message", "DeepSeek 连接测试成功");
                result.put("response", response);
            } else {
                String response = testDashScope(apiKey, model);
                result.put("success", true);
                result.put("message", "DashScope 连接测试成功");
                result.put("response", response);
            }
        } catch (Exception e) {
            result.put("success", false);
            result.put("message", provider + " 连接测试失败: " + e.getMessage());
        }

        return ResponseEntity.ok(result);
    }

    private String testDashScope(String apiKey, String model) {
        if (apiKey == null || apiKey.isEmpty()) {
            throw new RuntimeException("请先填写 API Key");
        }
        Message systemMsg = Message.builder().role(Role.SYSTEM.getValue()).content("你是一个测试助手。").build();
        Message userMsg = Message.builder().role(Role.USER.getValue()).content("请回复：连接测试成功！").build();

        GenerationParam param = GenerationParam.builder()
                .apiKey(apiKey)
                .model(model != null && !model.isEmpty() ? model : "qwen-plus")
                .messages(Arrays.asList(systemMsg, userMsg))
                .resultFormat(GenerationParam.ResultFormat.MESSAGE)
                .build();
        try {
            GenerationResult genResult = generation.call(param);
            return genResult.getOutput().getChoices().get(0).getMessage().getContent();
        } catch (Exception e) {
            throw new RuntimeException("DashScope 调用失败: " + e.getMessage(), e);
        }
    }

    private String testDeepSeek(String apiKey, String model) {
        if (apiKey == null || apiKey.isEmpty()) {
            throw new RuntimeException("请先填写 API Key");
        }
        RestTemplate restTemplate = new RestTemplate();
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(apiKey);

        Map<String, Object> requestBody = new LinkedHashMap<>();
        requestBody.put("model", model != null && !model.isEmpty() ? model : "deepseek-chat");
        requestBody.put("stream", false);
        requestBody.put("messages", Arrays.asList(
                Map.of("role", "system", "content", "你是一个测试助手。"),
                Map.of("role", "user", "content", "请回复：连接测试成功！")
        ));

        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(requestBody, headers);
        ResponseEntity<Map> response = restTemplate.exchange(
                "https://api.deepseek.com/v1/chat/completions",
                HttpMethod.POST,
                entity,
                Map.class
        );

        Map<String, Object> respBody = response.getBody();
        List<Map<String, Object>> choices = (List<Map<String, Object>>) respBody.get("choices");
        Map<String, Object> message = (Map<String, Object>) choices.get(0).get("message");
        return (String) message.get("content");
    }
}