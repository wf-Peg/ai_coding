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
 *
 * <p>
 * 额外注册了一个 {@link OpenAiCompatibleLlmProvider} Bean（dashscopeCompatibleProvider），
 * 用于 DashScope OpenAI 兼容模式调用（{@code https://dashscope.aliyuncs.com/compatible-mode/v1}），
 * 当前作为备用方案预留，为后续从原生 SDK 迁移到兼容模式做准备。
 * 保留 DashScopeLlmProvider 的原生 SDK 调用作为兜底。
 * </p>
 */
@Configuration
public class LlmProviderConfig {

    /**
     * 创建并注册主 LlmProvider Bean。
     * <p>
     * 使用 {@code @Primary} 标记为主 Bean，当有多个同类型候选时优先注入。
     * 返回 {@link RoutingLlmProvider} 实例，它封装了路由逻辑，
     * 可以根据配置动态选择 DashScope、DeepSeek 或 Custom 提供者。
     * </p>
     *
     * @param modelConfigService 模型配置服务，由 Spring 自动注入
     * @param dashScopeProvider  DashScope 提供者，由 Spring 自动注入
     * @param deepSeekProvider   DeepSeek 提供者，由 Spring 自动注入
     * @param customProvider     自定义 OpenAI 兼容提供者，由 Spring 自动注入
     * @return 路由 LLM 提供者实例，作为主 LlmProvider Bean
     */
    @Bean
    @Primary
    public LlmProvider llmProvider(ModelConfigService modelConfigService,
                                   DashScopeLlmProvider dashScopeProvider,
                                   DeepSeekLlmProvider deepSeekProvider,
                                   OpenAiCompatibleLlmProvider customProvider) {
        return new RoutingLlmProvider(modelConfigService, dashScopeProvider, deepSeekProvider, customProvider);
    }

    /**
     * 注册自定义 OpenAI 兼容提供者 Bean。
     * <p>
     * 使用 providerKey "custom"，从 {@link ModelConfig} 中读取
     * customApiKey / customModel / customBaseUrl 配置。
     * </p>
     *
     * @param modelConfigService 模型配置服务，由 Spring 自动注入
     * @return 自定义 OpenAI 兼容提供者实例
     */
    @Bean
    public OpenAiCompatibleLlmProvider customProvider(ModelConfigService modelConfigService) {
        return new OpenAiCompatibleLlmProvider(modelConfigService, "custom", "custom");
    }

    /**
     * 创建 DashScope OpenAI 兼容模式的 LLM 提供者 Bean。
     * <p>
     * 使用 {@link OpenAiCompatibleLlmProvider} 通过 OpenAI 兼容接口
     * （{@code https://dashscope.aliyuncs.com/compatible-mode/v1}）调用 DashScope 模型。
     * 当前作为备用方案注册，不主动使用，为后续从原生 SDK 迁移到兼容模式预留。
     * </p>
     *
     * @param modelConfigService 模型配置服务，由 Spring 自动注入
     * @return DashScope 兼容模式的 LLM 提供者实例
     */
    @Bean
    public OpenAiCompatibleLlmProvider dashscopeCompatibleProvider(ModelConfigService modelConfigService) {
        return new OpenAiCompatibleLlmProvider(modelConfigService, "dashscope", "dashscope");
    }
}