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
 * AI 模型配置 REST 控制器
 * <p>
 * 提供 AI 大模型配置的管理和连接测试接口，支持：
 * <ul>
 *   <li>获取和保存模型配置（Provider、API Key、Model 名称等）</li>
 *   <li>测试模型连接：支持 DashScope（阿里云百炼）和 DeepSeek 两种 Provider</li>
 * </ul>
 * 所有接口均映射到 {@code /api/model-config} 路径下，并允许跨域访问。
 * 测试连接时使用传入的 API Key 和 Model 参数，无需提前保存到配置中。
 * </p>
 *
 * @see ModelConfigService
 */
@RestController
@RequestMapping("/api/model-config")
@CrossOrigin(origins = "*")
public class ModelConfigController {

    /** 模型配置持久化服务 */
    private final ModelConfigService modelConfigService;
    /** DashScope SDK 的 Generation 实例，用于调用阿里云百炼大模型 API */
    private final Generation generation;

    /**
     * 构造函数，通过依赖注入初始化服务组件
     *
     * @param modelConfigService 模型配置服务
     * @param generation         DashScope Generation 实例
     */
    public ModelConfigController(ModelConfigService modelConfigService,
                                 Generation generation) {
        this.modelConfigService = modelConfigService;
        this.generation = generation;
    }

    /**
     * 获取当前模型配置
     * <p>
     * GET /api/model-config
     *
     * @return 当前生效的模型配置对象
     */
    @GetMapping
    public ResponseEntity<ModelConfig> getConfig() {
        return ResponseEntity.ok(modelConfigService.getConfig());
    }

    /**
     * 保存模型配置
     * <p>
     * POST /api/model-config
     * <p>
     * 将前端提交的模型配置持久化到存储中，后续 AI 调用将使用此配置。
     *
     * @param config 新的模型配置对象
     * @return 保存后的配置（可能包含服务端补充的默认值）
     */
    @PostMapping
    public ResponseEntity<ModelConfig> saveConfig(@RequestBody ModelConfig config) {
        ModelConfig saved = modelConfigService.saveConfig(config);
        return ResponseEntity.ok(saved);
    }

    /**
     * 获取内置预设模板列表
     * <p>
     * GET /api/model-config/presets
     *
     * @return 预设模板列表，每个模板包含 id、name、baseUrl、defaultModel 字段
     */
    @GetMapping("/presets")
    public ResponseEntity<List<Map<String, Object>>> getPresets() {
        List<Map<String, Object>> presets = Arrays.asList(
            createPreset("dashscope", "阿里云 DashScope", "https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen-plus"),
            createPreset("deepseek", "DeepSeek", "https://api.deepseek.com/v1", "deepseek-v4-flash"),
            createPreset("openrouter", "OpenRouter", "https://openrouter.ai/api/v1", ""),
            createPreset("siliconflow", "硅基流动", "https://api.siliconflow.cn/v1", ""),
            createPreset("glm", "智谱 GLM", "https://open.bigmodel.cn/api/paas/v4", "glm-4-flash"),
            createPreset("moonshot", "月之暗面 Kimi", "https://api.moonshot.cn/v1", "moonshot-v1-8k"),
            createPreset("ollama", "Ollama 本地", "http://localhost:11434/v1", "llama3"),
            createPreset("custom", "自定义中转站", "", "")
        );
        return ResponseEntity.ok(presets);
    }

    /**
     * 创建一个预设模板条目
     *
     * @param id           预设唯一标识
     * @param name         预设显示名称
     * @param baseUrl      API 基础地址
     * @param defaultModel 默认模型名称
     * @return 包含预设信息的 Map
     */
    private Map<String, Object> createPreset(String id, String name, String baseUrl, String defaultModel) {
        Map<String, Object> preset = new LinkedHashMap<>();
        preset.put("id", id);
        preset.put("name", name);
        preset.put("baseUrl", baseUrl);
        preset.put("defaultModel", defaultModel);
        return preset;
    }

    /**
     * 测试模型连接
     * <p>
     * POST /api/model-config/test
     * <p>
     * 使用请求体中传入的 provider、apiKey、model 参数直接测试连接，
     * 无需提前保存到配置。发送一条简短的测试消息，验证 API 调用是否正常。
     * <p>
     * 支持的 Provider：
     * <ul>
     *   <li>{@code dashscope} — 阿里云百炼大模型平台</li>
     *   <li>{@code deepseek} — DeepSeek 大模型 API</li>
     *   <li>{@code custom} — 自定义 OpenAI 兼容 API</li>
     * </ul>
     *
     * @param body 包含 provider（默认 "dashscope"）、baseUrl、apiKey、model 的请求体
     * @return 测试结果，包含 success、message 和 response 字段
     */
    @PostMapping("/test")
    public ResponseEntity<Map<String, Object>> testConnection(@RequestBody Map<String, String> body) {
        // 提取请求参数，provider 默认为 dashscope
        String provider = body.getOrDefault("provider", "dashscope");
        String apiKey = body.get("apiKey");
        String model = body.get("model");
        // 使用 LinkedHashMap 保持字段顺序，便于前端展示
        Map<String, Object> result = new LinkedHashMap<>();

        try {
            // 根据 provider 类型分发到不同的测试方法
            if ("deepseek".equals(provider)) {
                String response = testDeepSeek(apiKey, model);
                result.put("success", true);
                result.put("message", "DeepSeek 连接测试成功");
                result.put("response", response);
            } else if ("custom".equals(provider)) {
                String baseUrl = body.get("baseUrl");
                String response = testOpenAiCompatible(baseUrl, apiKey, model);
                result.put("success", true);
                result.put("message", "自定义 Provider 连接测试成功");
                result.put("response", response);
            } else {
                // 默认走 DashScope 测试
                String response = testDashScope(apiKey, model);
                result.put("success", true);
                result.put("message", "DashScope 连接测试成功");
                result.put("response", response);
            }
        } catch (Exception e) {
            // 测试失败时返回 success=false，附带错误信息
            result.put("success", false);
            result.put("message", provider + " 连接测试失败: " + e.getMessage());
        }

        return ResponseEntity.ok(result);
    }

    /**
     * 测试 DashScope（阿里云百炼）模型连接
     * <p>
     * 使用 DashScope SDK 发送一条测试消息，验证 API Key 和 Model 是否有效。
     *
     * @param apiKey DashScope API Key
     * @param model  模型名称，为空时默认使用 "qwen-plus"
     * @return 模型返回的响应文本
     * @throws RuntimeException 若 API Key 为空或调用失败
     */
    private String testDashScope(String apiKey, String model) {
        if (apiKey == null || apiKey.isEmpty()) {
            throw new RuntimeException("请先填写 API Key");
        }
        // 构建测试对话消息：system 设定角色，user 发送测试指令
        Message systemMsg = Message.builder().role(Role.SYSTEM.getValue()).content("你是一个测试助手。").build();
        Message userMsg = Message.builder().role(Role.USER.getValue()).content("请回复：连接测试成功！").build();

        // 构建 DashScope 调用参数
        GenerationParam param = GenerationParam.builder()
                .apiKey(apiKey)
                .model(model != null && !model.isEmpty() ? model : "qwen-plus")  // 默认模型
                .messages(Arrays.asList(systemMsg, userMsg))
                .resultFormat(GenerationParam.ResultFormat.MESSAGE)  // 返回完整消息格式
                .build();
        try {
            // 调用 DashScope SDK 发送请求
            GenerationResult genResult = generation.call(param);
            // 提取第一个 choice 的 message content 作为响应文本
            return genResult.getOutput().getChoices().get(0).getMessage().getContent();
        } catch (Exception e) {
            throw new RuntimeException("DashScope 调用失败: " + e.getMessage(), e);
        }
    }

    /**
     * 测试 DeepSeek 模型连接
     * <p>
     * 委托给 {@link #testOpenAiCompatible} 使用 DeepSeek 的固定地址进行测试。
     *
     * @param apiKey DeepSeek API Key（Bearer Token 认证）
     * @param model  模型名称，为空时默认使用 "deepseek-v4-flash"
     * @return 模型返回的响应文本
     * @throws RuntimeException 若 API Key 为空或调用失败
     */
    private String testDeepSeek(String apiKey, String model) {
        return testOpenAiCompatible("https://api.deepseek.com/v1", apiKey, model);
    }

    /**
     * 测试 OpenAI 兼容 API 的连接
     * <p>
     * 使用 RestTemplate 调用指定 baseUrl 的 Chat Completions 端点，
     * 发送一条简短的测试消息，验证 API 调用是否正常。
     *
     * @param baseUrl API 基础地址（如 "https://api.deepseek.com/v1"），末尾不要带 /chat/completions
     * @param apiKey  Bearer Token 认证的 API Key
     * @param model   模型名称，为空时默认使用 "gpt-3.5-turbo"
     * @return 模型返回的响应文本
     * @throws RuntimeException 若 API Key 或 baseUrl 为空或调用失败
     */
    private String testOpenAiCompatible(String baseUrl, String apiKey, String model) {
        if (apiKey == null || apiKey.isEmpty()) {
            throw new RuntimeException("请先填写 API Key");
        }
        if (baseUrl == null || baseUrl.isEmpty()) {
            throw new RuntimeException("请先填写 API 地址");
        }
        // 确保 baseUrl 末尾没有多余的 /
        String normalizedUrl = baseUrl.replaceAll("/+$", "") + "/chat/completions";

        RestTemplate restTemplate = new RestTemplate();
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(apiKey);

        Map<String, Object> requestBody = new LinkedHashMap<>();
        requestBody.put("model", model != null && !model.isEmpty() ? model : "gpt-3.5-turbo");
        requestBody.put("stream", false);
        requestBody.put("messages", Arrays.asList(
                Map.of("role", "system", "content", "你是一个测试助手。"),
                Map.of("role", "user", "content", "请回复：连接测试成功！")
        ));

        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(requestBody, headers);
        ResponseEntity<Map> response = restTemplate.exchange(
                normalizedUrl, HttpMethod.POST, entity, Map.class
        );

        Map<String, Object> respBody = response.getBody();
        List<Map<String, Object>> choices = (List<Map<String, Object>>) respBody.get("choices");
        Map<String, Object> message = (Map<String, Object>) choices.get(0).get("message");
        return (String) message.get("content");
    }
}