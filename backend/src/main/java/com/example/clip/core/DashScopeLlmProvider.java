package com.example.clip.core;

import com.alibaba.dashscope.aigc.generation.Generation;
import com.alibaba.dashscope.aigc.generation.GenerationParam;
import com.alibaba.dashscope.aigc.generation.GenerationResult;
import com.alibaba.dashscope.common.Message;
import com.alibaba.dashscope.common.Role;
import com.example.clip.service.ModelConfigService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.Arrays;

/**
 * 阿里云 DashScope LLM 提供者
 * 封装现有 dashscope-sdk-java 调用逻辑
 */
@Component
public class DashScopeLlmProvider implements LlmProvider {

    private static final Logger logger = LoggerFactory.getLogger(DashScopeLlmProvider.class);

    private final Generation generation;
    private final DashScopeConfig dashScopeConfig;
    private final ModelConfigService modelConfigService;

    public DashScopeLlmProvider(Generation generation, DashScopeConfig dashScopeConfig,
                                ModelConfigService modelConfigService) {
        this.generation = generation;
        this.dashScopeConfig = dashScopeConfig;
        this.modelConfigService = modelConfigService;
    }

    @Override
    public String chat(String systemPrompt, String userMessage) {
        try {
            Message systemMessage = Message.builder()
                    .role(Role.SYSTEM.getValue())
                    .content(systemPrompt)
                    .build();

            Message userMsg = Message.builder()
                    .role(Role.USER.getValue())
                    .content(userMessage)
                    .build();

            GenerationParam param = GenerationParam.builder()
                    .apiKey(getApiKey())
                    .model(getModel())
                    .messages(Arrays.asList(systemMessage, userMsg))
                    .resultFormat(GenerationParam.ResultFormat.MESSAGE)
                    .build();

            GenerationResult result = generation.call(param);
            return result.getOutput().getChoices().get(0).getMessage().getContent();
        } catch (Exception e) {
            logger.error("[DashScope] chat failed: {}", e.getMessage(), e);
            throw new RuntimeException("DashScope 调用失败: " + e.getMessage(), e);
        }
    }

    @Override
    public String getProviderName() {
        return "dashscope";
    }

    @Override
    public boolean isAvailable() {
        return getApiKey() != null && !getApiKey().isEmpty();
    }

    /**
     * 获取 API Key，优先使用用户配置，否则使用 yml 配置
     */
    private String getApiKey() {
        ModelConfig config = modelConfigService.getConfig();
        if (config != null && config.getDashscopeApiKey() != null && !config.getDashscopeApiKey().isEmpty()) {
            return config.getDashscopeApiKey();
        }
        return dashScopeConfig.getApiKey();
    }

    /**
     * 获取模型名称，优先使用用户配置
     */
    private String getModel() {
        ModelConfig config = modelConfigService.getConfig();
        if (config != null && config.getDashscopeModel() != null && !config.getDashscopeModel().isEmpty()) {
            return config.getDashscopeModel();
        }
        return dashScopeConfig.getModel();
    }
}