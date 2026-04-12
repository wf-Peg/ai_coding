package com.example.clip.core;

import com.alibaba.dashscope.aigc.generation.Generation;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class DashScopeConfig {

    @Value("${spring.ai.dashscope.api-key}")
    private String apiKey;
    
    @Value("${spring.ai.dashscope.chat.options.model}")
    private String model;

    @Bean
    public Generation generation() {
        return new Generation();
    }

    public String getApiKey() {
        return apiKey;
    }
    
    public String getModel() {
        return model;
    }
}
