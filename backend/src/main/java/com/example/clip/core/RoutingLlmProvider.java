package com.example.clip.core;

import com.example.clip.service.ModelConfigService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * 路由 LLM 提供者
 * 根据配置中的 activeProvider 动态选择 DashScope 或 DeepSeek，支持热切换
 */
@Component("routingLlmProvider")
public class RoutingLlmProvider implements LlmProvider {

    private static final Logger logger = LoggerFactory.getLogger(RoutingLlmProvider.class);

    private final ModelConfigService modelConfigService;
    private final DashScopeLlmProvider dashScopeProvider;
    private final DeepSeekLlmProvider deepSeekProvider;

    public RoutingLlmProvider(ModelConfigService modelConfigService,
                              DashScopeLlmProvider dashScopeProvider,
                              DeepSeekLlmProvider deepSeekProvider) {
        this.modelConfigService = modelConfigService;
        this.dashScopeProvider = dashScopeProvider;
        this.deepSeekProvider = deepSeekProvider;
    }

    @Override
    public String chat(String systemPrompt, String userMessage) {
        LlmProvider provider = getActiveProvider();
        logger.debug("[LLM] Routing to {}", provider.getProviderName());
        return provider.chat(systemPrompt, userMessage);
    }

    @Override
    public String getProviderName() {
        return getActiveProvider().getProviderName();
    }

    @Override
    public boolean isAvailable() {
        return getActiveProvider().isAvailable();
    }

    /**
     * 根据配置获取当前激活的提供者
     */
    private LlmProvider getActiveProvider() {
        ModelConfig config = modelConfigService.getConfig();
        String active = config != null ? config.getActiveProvider() : "dashscope";

        if ("deepseek".equals(active)) {
            if (!deepSeekProvider.isAvailable()) {
                logger.warn("[LLM] DeepSeek API Key 未配置，回退到 DashScope");
                return dashScopeProvider;
            }
            return deepSeekProvider;
        }

        // 默认使用 DashScope
        return dashScopeProvider;
    }
}