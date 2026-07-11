package com.example.clip.core;

import com.example.clip.service.ModelConfigService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * 路由 LLM 提供者 —— 实现 {@link LlmProvider} 接口的代理/路由模式。
 * <p>
 * 核心职责：根据 {@link ModelConfig} 配置中的 {@code activeProvider} 字段，
 * 动态选择实际使用的底层 LLM 提供者（DashScope 或 DeepSeek）。
 * 所有对 {@link LlmProvider} 的调用都通过本类进行路由分发。
 * </p>
 *
 * <h3>路由逻辑</h3>
 * <ol>
 *   <li>读取 {@link ModelConfigService} 中的当前配置</li>
 *   <li>如果 {@code activeProvider} 为 "deepseek" 且 DeepSeek API Key 已配置，则使用 DeepSeek</li>
 *   <li>如果 DeepSeek 不可用（API Key 未配置），自动回退到 DashScope</li>
 *   <li>默认使用 DashScope</li>
 * </ol>
 *
 * <h3>设计优势</h3>
 * <ul>
 *   <li>支持运行时热切换：用户修改配置后，下一次请求立即生效，无需重启</li>
 *   <li>自动回退：当前选定的提供者不可用时，自动降级到备用提供者</li>
 *   <li>透明代理：上层 {@link AiService} 无需感知底层切换逻辑</li>
 * </ul>
 *
 * <p>通过 {@code @Component("routingLlmProvider")} 显式命名 Bean，
 * 配合 {@link LlmProviderConfig} 中的 {@code @Primary} 注解，
 * 确保 Spring 注入 {@link LlmProvider} 时优先使用本类实例。</p>
 */
@Component("routingLlmProvider")
public class RoutingLlmProvider implements LlmProvider {

    private static final Logger logger = LoggerFactory.getLogger(RoutingLlmProvider.class);

    /** 模型配置服务，提供运行时配置的读取能力 */
    private final ModelConfigService modelConfigService;

    /** 阿里云 DashScope 提供者（备用/默认提供者） */
    private final DashScopeLlmProvider dashScopeProvider;

    /** DeepSeek 提供者（可选提供者） */
    private final DeepSeekLlmProvider deepSeekProvider;

    /**
     * 构造器注入所有依赖。
     *
     * @param modelConfigService 模型配置服务，用于读取当前激活的提供者
     * @param dashScopeProvider  DashScope 提供者实现
     * @param deepSeekProvider   DeepSeek 提供者实现
     */
    public RoutingLlmProvider(ModelConfigService modelConfigService,
                              DashScopeLlmProvider dashScopeProvider,
                              DeepSeekLlmProvider deepSeekProvider) {
        this.modelConfigService = modelConfigService;
        this.dashScopeProvider = dashScopeProvider;
        this.deepSeekProvider = deepSeekProvider;
    }

    /**
     * 路由聊天请求到当前激活的提供者。
     * <p>
     * 每次调用都会重新获取激活的提供者，确保配置变更后立即生效。
     * 日志记录实际路由到的提供者名称，便于问题排查。
     * </p>
     *
     * @param systemPrompt 系统提示词
     * @param userMessage  用户消息
     * @return 模型回复内容
     */
    @Override
    public String chat(String systemPrompt, String userMessage) {
        LlmProvider provider = getActiveProvider();
        logger.debug("[LLM] Routing to {}", provider.getProviderName());
        try {
            return provider.chat(systemPrompt, userMessage);
        } catch (Exception e) {
            // 运行时失败（额度用尽、网络错误等），尝试降级到备用 provider
            logger.warn("[LLM] {} 调用失败: {}，尝试降级到备用 provider",
                    provider.getProviderName(), e.getMessage());
            LlmProvider fallback = getFallbackProvider(provider);
            if (fallback != null) {
                logger.info("[LLM] 降级到 {}", fallback.getProviderName());
                return fallback.chat(systemPrompt, userMessage);
            }
            throw e;
        }
    }

    /**
     * 获取备用 provider（当主 provider 运行时失败时使用）。
     */
    private LlmProvider getFallbackProvider(LlmProvider failed) {
        if (failed == dashScopeProvider && deepSeekProvider.isAvailable()) {
            return deepSeekProvider;
        }
        if (failed == deepSeekProvider && dashScopeProvider.isAvailable()) {
            return dashScopeProvider;
        }
        return null;
    }

    /**
     * 获取当前激活提供者的名称。
     * <p>
     * 委托给 {@link #getActiveProvider()} 获取实际提供者后再获取名称。
     * </p>
     *
     * @return 当前激活提供者的名称
     */
    @Override
    public String getProviderName() {
        return getActiveProvider().getProviderName();
    }

    /**
     * 判断当前激活的提供者是否可用。
     * <p>
     * 委托给 {@link #getActiveProvider()} 检查可用性。
     * 注意：此方法返回的是当前路由目标提供者的可用性，
     * 而非路由本身是否可用（路由本身始终可用，因为有自动回退机制）。
     * </p>
     *
     * @return true 表示当前激活提供者可用
     */
    @Override
    public boolean isAvailable() {
        return getActiveProvider().isAvailable();
    }

    /**
     * 根据运行时配置获取当前应使用的 LLM 提供者。
     * <p>
     * 核心路由逻辑：</p>
     * <ol>
     *   <li>从 {@link ModelConfigService} 读取当前配置</li>
     *   <li>如果配置为 null（首次启动或配置未初始化），默认使用 dashscope</li>
     *   <li>如果配置为 deepseek，检查其 API Key 是否已配置</li>
     *   <li>DeepSeek 不可用时自动回退到 DashScope，并记录警告日志</li>
     *   <li>其他情况默认使用 DashScope</li>
     * </ol>
     *
     * @return 当前应使用的 LLM 提供者实例
     */
    private LlmProvider getActiveProvider() {
        // 读取运行时配置，若配置尚未初始化则默认为 dashscope
        ModelConfig config = modelConfigService.getConfig();
        String active = config != null ? config.getActiveProvider() : "dashscope";

        if ("deepseek".equals(active)) {
            // 用户选择了 DeepSeek，但需要先确认 API Key 是否已配置
            if (!deepSeekProvider.isAvailable()) {
                // DeepSeek 不可用时自动回退到 DashScope，保证服务不中断
                logger.warn("[LLM] DeepSeek API Key 未配置，回退到 DashScope");
                return dashScopeProvider;
            }
            return deepSeekProvider;
        }

        // 默认使用 DashScope（包括 active 为 "dashscope" 或任何未知值的情况）
        return dashScopeProvider;
    }
}