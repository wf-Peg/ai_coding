package com.example.clip.core;

import com.example.clip.service.ModelConfigService;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;

/**
 * LLM 提供者 Spring 配置类。
 * <p>
 * 负责注册 {@link LlmProvider} 接口的 Bean 实现。
 * 通过 {@code @Primary} 注解，确保当 Spring 容器中存在多个
 * {@link LlmProvider} 实现（如 {@link RoutingLlmProvider}、
 * {@link DashScopeLlmProvider}、{@link DeepSeekLlmProvider}）时，
 * 优先注入 {@link RoutingLlmProvider} 作为主提供者。
 * </p>
 *
 * <p>
 * 这样设计的好处是：{@link AiService} 等消费者只需注入
 * {@code LlmProvider} 接口，无需关心具体是哪个实现类，
 * 而路由逻辑由 {@link RoutingLlmProvider} 内部处理。
 * </p>
 *
 * <p>
 * 注意：{@link DashScopeLlmProvider} 和 {@link DeepSeekLlmProvider}
 * 也通过 {@code @Component} 注册为 Bean，但它们不标记 {@code @Primary}，
 * 因此不会被自动注入到需要 {@link LlmProvider} 的地方。
 * </p>
 */
@Configuration
public class LlmProviderConfig {

    /**
     * 创建并注册主 LlmProvider Bean。
     * <p>
     * 使用 {@code @Primary} 标记为主 Bean，当有多个同类型候选时优先注入。
     * 返回 {@link RoutingLlmProvider} 实例，它封装了路由逻辑，
     * 可以根据配置动态选择 DashScope 或 DeepSeek。
     * </p>
     *
     * @param modelConfigService 模型配置服务，由 Spring 自动注入
     * @param dashScopeProvider  DashScope 提供者，由 Spring 自动注入
     * @param deepSeekProvider   DeepSeek 提供者，由 Spring 自动注入
     * @return 路由 LLM 提供者实例，作为主 LlmProvider Bean
     */
    @Bean
    @Primary
    public LlmProvider llmProvider(ModelConfigService modelConfigService,
                                   DashScopeLlmProvider dashScopeProvider,
                                   DeepSeekLlmProvider deepSeekProvider) {
        return new RoutingLlmProvider(modelConfigService, dashScopeProvider, deepSeekProvider);
    }
}