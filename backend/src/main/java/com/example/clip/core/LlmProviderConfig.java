package com.example.clip.core;

import com.example.clip.service.ModelConfigService;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;

/**
 * LLM 提供者配置
 * 注册 RoutingLlmProvider 作为主 LlmProvider Bean
 */
@Configuration
public class LlmProviderConfig {

    @Bean
    @Primary
    public LlmProvider llmProvider(ModelConfigService modelConfigService,
                                   DashScopeLlmProvider dashScopeProvider,
                                   DeepSeekLlmProvider deepSeekProvider) {
        return new RoutingLlmProvider(modelConfigService, dashScopeProvider, deepSeekProvider);
    }
}