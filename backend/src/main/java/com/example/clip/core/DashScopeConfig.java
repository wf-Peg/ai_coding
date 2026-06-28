package com.example.clip.core;

import com.alibaba.dashscope.aigc.generation.Generation;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 阿里云 DashScope（百炼）SDK 配置类。
 * <p>
 * 负责从 {@code application.yml} 中读取 DashScope 的默认配置，
 * 并创建 {@link Generation} SDK 实例作为 Spring Bean。
 * </p>
 *
 * <h3>配置项说明</h3>
 * <ul>
 *   <li>{@code spring.ai.dashscope.api-key}：DashScope API 密钥（必填）</li>
 *   <li>{@code spring.ai.dashscope.chat.options.model}：默认模型名称，如 qwen-plus</li>
 * </ul>
 *
 * <p>
 * 注意：这些 yml 配置是默认值，可以被 {@link ModelConfig} 中用户自定义的配置覆盖。
 * 实际调用时，{@link DashScopeLlmProvider} 会优先使用用户配置，
 * 只有用户未配置时才回退到此处的 yml 默认值。
 * </p>
 *
 * <p>
 * {@link Generation} 实例是无状态的，可以在多个请求之间安全复用，
 * 因此注册为单例 Bean 是合适的。
 * </p>
 */
@Configuration
public class DashScopeConfig {

    /**
     * DashScope API 密钥。
     * 从 application.yml 的 spring.ai.dashscope.api-key 读取。
     */
    @Value("${spring.ai.dashscope.api-key}")
    private String apiKey;

    /**
     * DashScope 默认模型名称。
     * 从 application.yml 的 spring.ai.dashscope.chat.options.model 读取。
     */
    @Value("${spring.ai.dashscope.chat.options.model}")
    private String model;

    /**
     * 创建 {@link Generation} SDK 实例并注册为 Spring Bean。
     * <p>
     * {@link Generation} 是 DashScope SDK 的核心调用入口，
     * 封装了与阿里云百炼平台的通信细节。
     * 该实例是无状态的，因此适合作为单例 Bean。
     * </p>
     *
     * @return 新的 Generation 实例
     */
    @Bean
    public Generation generation() {
        return new Generation();
    }

    /**
     * 获取 yml 中配置的默认 API 密钥。
     *
     * @return API 密钥字符串
     */
    public String getApiKey() {
        return apiKey;
    }

    /**
     * 获取 yml 中配置的默认模型名称。
     *
     * @return 模型名称，如 "qwen-plus"
     */
    public String getModel() {
        return model;
    }
}