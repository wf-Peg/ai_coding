package com.example.clip.core;

import com.example.clip.service.ModelConfigService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 路由 LLM 提供者 —— 实现 {@link LlmProvider} 接口的代理/路由模式。
 * <p>
 * 核心职责：根据 {@link ModelConfig} 配置中的 {@code activeProvider} 字段，
 * 动态选择实际使用的底层 LLM 提供者（DashScope / DeepSeek / Custom）。
 * 所有对 {@link LlmProvider} 的调用都通过本类进行路由分发。
 * </p>
 *
 * <h3>路由逻辑</h3>
 * <ol>
 *   <li>读取 {@link ModelConfigService} 中的当前配置</li>
 *   <li>如果 {@code activeProvider} 为 "custom" 且 Custom API Key 已配置，则使用 Custom Provider</li>
 *   <li>如果 {@code activeProvider} 为 "deepseek" 且 DeepSeek API Key 已配置，则使用 DeepSeek</li>
 *   <li>如果 custom 或 deepseek 不可用，自动回退到 DashScope</li>
 *   <li>默认使用 DashScope</li>
 * </ol>
 *
 * <h3>设计优势</h3>
 * <ul>
 *   <li>支持运行时热切换：用户修改配置后，下一次请求立即生效，无需重启</li>
 *   <li>多级自动降级：custom → deepseek → dashscope，当前选定的提供者不可用时自动降级</li>
 *   <li>透明代理：上层 {@link AiService} 无需感知底层切换逻辑</li>
 * </ul>
 *
 * <p>本类不标注 {@code @Component}，仅通过 {@link LlmProviderConfig} 中的
 * {@code @Bean} 方法创建实例，由 {@code @Primary} 注解确保优先注入。</p>
 */
public class RoutingLlmProvider implements LlmProvider {

    private static final Logger logger = LoggerFactory.getLogger(RoutingLlmProvider.class);

    /** 模型配置服务，提供运行时配置的读取能力 */
    private final ModelConfigService modelConfigService;

    /** 阿里云 DashScope 提供者（备用/默认提供者） */
    private final DashScopeLlmProvider dashScopeProvider;

    /** DeepSeek 提供者（可选提供者） */
    private final DeepSeekLlmProvider deepSeekProvider;

    /** 自定义 OpenAI 兼容提供者（可选提供者） */
    private final OpenAiCompatibleLlmProvider customProvider;

    /**
     * 构造器注入所有依赖（含 custom 提供者）。
     *
     * @param modelConfigService 模型配置服务，用于读取当前激活的提供者
     * @param dashScopeProvider  DashScope 提供者实现
     * @param deepSeekProvider   DeepSeek 提供者实现
     * @param customProvider     自定义 OpenAI 兼容提供者实现
     */
    public RoutingLlmProvider(ModelConfigService modelConfigService,
                              DashScopeLlmProvider dashScopeProvider,
                              DeepSeekLlmProvider deepSeekProvider,
                              OpenAiCompatibleLlmProvider customProvider) {
        this.modelConfigService = modelConfigService;
        this.dashScopeProvider = dashScopeProvider;
        this.deepSeekProvider = deepSeekProvider;
        this.customProvider = customProvider;
    }

    /**
     * 构造器注入（兼容旧版本，无 custom 提供者）。
     *
     * @param modelConfigService 模型配置服务，用于读取当前激活的提供者
     * @param dashScopeProvider  DashScope 提供者实现
     * @param deepSeekProvider   DeepSeek 提供者实现
     */
    public RoutingLlmProvider(ModelConfigService modelConfigService,
                              DashScopeLlmProvider dashScopeProvider,
                              DeepSeekLlmProvider deepSeekProvider) {
        this(modelConfigService, dashScopeProvider, deepSeekProvider, null);
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
        return chatWithFallback(provider, systemPrompt, userMessage);
    }

    /**
     * 递归降级调用：当前 provider 失败时自动尝试备用 provider，
     * 直至所有 provider 均失败为止。
     * 使用 Set 记录已尝试过的 provider，避免循环降级。
     */
    private String chatWithFallback(LlmProvider provider, String systemPrompt, String userMessage) {
        Set<LlmProvider> tried = new HashSet<>();
        LlmProvider current = provider;
        while (true) {
            tried.add(current);
            try {
                return current.chat(systemPrompt, userMessage);
            } catch (Exception e) {
                LlmProvider next = getFallbackProvider(current);
                if (next == null || tried.contains(next)) {
                    throw new RuntimeException(
                        current.getProviderName() + " 调用失败且无可用备用 provider: "
                        + e.getMessage(), e);
                }
                logger.warn("[LLM] {} 调用失败: {}，降级到 {}",
                        current.getProviderName(), e.getMessage(), next.getProviderName());
                current = next;
            }
        }
    }

    @Override
    public ChatStreamHandle streamChat(List<ChatMessage> messages, ChatStreamListener listener) {
        LlmProvider provider = getActiveProvider();
        logger.debug("[LLM] Routing stream to {}", provider.getProviderName());
        java.util.concurrent.atomic.AtomicBoolean emitted = new java.util.concurrent.atomic.AtomicBoolean();
        java.util.concurrent.atomic.AtomicReference<ChatStreamHandle> active = new java.util.concurrent.atomic.AtomicReference<>();

        ChatStreamListener routedListener = new ChatStreamListener() {
            @Override
            public void onDelta(String content) {
                emitted.set(true);
                listener.onDelta(content);
            }

            @Override
            public void onComplete() {
                listener.onComplete();
            }

            @Override
            public void onError(Throwable error) {
                if (emitted.get()) {
                    listener.onError(error);
                    return;
                }
                LlmProvider fallback = getFallbackProvider(provider);
                if (fallback == null) {
                    listener.onError(error);
                    return;
                }
                logger.warn("[LLM] {} 流式调用失败，降级到 {}", provider.getProviderName(), fallback.getProviderName());
                active.set(fallback.streamChat(messages, listener));
            }
        };
        ChatStreamHandle initialHandle = provider.streamChat(messages, routedListener);
        if (!active.compareAndSet(null, initialHandle) && initialHandle != null) {
            initialHandle.cancel();
        }
        return new ChatStreamHandle() {
            @Override
            public void cancel() {
                ChatStreamHandle handle = active.get();
                if (handle != null) handle.cancel();
            }

            @Override
            public boolean isCancelled() {
                ChatStreamHandle handle = active.get();
                return handle != null && handle.isCancelled();
            }
        };
    }

    /**
     * 获取备用 provider（当主 provider 运行时失败时使用）。
     */
    private LlmProvider getFallbackProvider(LlmProvider failed) {
        if (failed == customProvider) {
            if (deepSeekProvider.isAvailable()) return deepSeekProvider;
            if (dashScopeProvider.isAvailable()) return dashScopeProvider;
            return null;
        }
        if (failed == deepSeekProvider) {
            if (dashScopeProvider.isAvailable()) return dashScopeProvider;
            return null;
        }
        if (failed == dashScopeProvider) {
            if (deepSeekProvider.isAvailable()) return deepSeekProvider;
            return null;
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

        if ("custom".equals(active)) {
            if (customProvider == null || !customProvider.isAvailable()) {
                logger.warn("[LLM] Custom Provider API Key 未配置，回退到 DeepSeek");
                if (deepSeekProvider.isAvailable()) {
                    return deepSeekProvider;
                }
                logger.warn("[LLM] DeepSeek 也不可用，回退到 DashScope");
                return dashScopeProvider;
            }
            return customProvider;
        }

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
