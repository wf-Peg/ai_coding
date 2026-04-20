package com.example.clip.core;

import com.alibaba.dashscope.aigc.generation.Generation;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * DashScope配置类
 * 配置阿里云DashScope API相关参数
 */
@Configuration
public class DashScopeConfig {

    /**
     * DashScope API密钥
     */
    @Value("${spring.ai.dashscope.api-key}")
    private String apiKey;
    
    /**
     * 模型名称
     */
    @Value("${spring.ai.dashscope.chat.options.model}")
    private String model;

    /**
     * 创建Generation实例
     * @return Generation实例
     */
    @Bean
    public Generation generation() {
        return new Generation();
    }

    /**
     * 获取API密钥
     * @return API密钥
     */
    public String getApiKey() {
        return apiKey;
    }
    
    /**
     * 获取模型名称
     * @return 模型名称
     */
    public String getModel() {
        return model;
    }
}
