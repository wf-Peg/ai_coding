package com.example.clip.core;

import java.util.List;

/**
 * LLM（大语言模型）提供者统一接口。
 * <p>
 * 抽象不同大模型厂商（如阿里云 DashScope、DeepSeek）的调用方式，
 * 使得上层业务代码无需关心底层具体是哪个厂商的模型。
 * 支持运行时通过配置切换不同的 LLM 提供者，实现热切换。
 * </p>
 *
 * <p>实现类必须提供以下能力：</p>
 * <ul>
 *   <li>对话（chat）：发送系统提示词和用户消息，获取模型回复</li>
 *   <li>名称标识：返回提供者的唯一名称，用于日志和路由判断</li>
 *   <li>可用性检查：判断当前提供者是否已配置好 API Key 等必要参数</li>
 * </ul>
 *
 * @see RoutingLlmProvider 路由实现，根据配置动态选择底层提供者
 * @see DashScopeLlmProvider 阿里云 DashScope 实现
 * @see DeepSeekLlmProvider DeepSeek 实现
 */
public interface LlmProvider {

    /**
     * 调用 LLM 进行对话。
     * <p>
     * 将系统提示词（system prompt）和用户消息（user message）一起发送给大模型，
     * 返回模型的文本回复。
     * </p>
     *
     * @param systemPrompt 系统提示词，用于设定模型的角色、行为规范和输出格式
     * @param userMessage  用户消息，即需要模型处理的具体内容
     * @return 模型生成的文本回复
     * @throws RuntimeException 当 API 调用失败时抛出
     */
    String chat(String systemPrompt, String userMessage);

    /**
     * 按任务档位调用 LLM。
     * <p>
     * 默认实现忽略档位直接调用 {@link #chat(String, String)}；
     * 路由实现（如 RoutingLlmProvider）根据档位选择对应模型，
     * 用于"简单任务用便宜模型、复杂任务用强模型"的成本分层。
     * </p>
     *
     * @param systemPrompt 系统提示词，用于设定模型的角色、行为规范和输出格式
     * @param userMessage  用户消息，即需要模型处理的具体内容
     * @param tier         任务档位："simple"（便宜模型）或 "strong"（强模型）
     * @return 模型生成的文本回复
     * @throws RuntimeException 当 API 调用失败时抛出
     */
    default String chatForTier(String systemPrompt, String userMessage, String tier) {
        return chat(systemPrompt, userMessage);
    }

    /**
     * 以流式方式调用 LLM。实现类必须在完成、失败或取消时终止回调序列。
     */
    ChatStreamHandle streamChat(List<ChatMessage> messages, ChatStreamListener listener);

    /**
     * 获取当前提供者的唯一名称标识。
     * <p>
     * 用于日志记录、路由决策以及前端展示当前使用的模型厂商。
     * </p>
     *
     * @return 提供者名称，如 "dashscope" 或 "deepseek"
     */
    String getProviderName();

    /**
     * 判断当前提供者是否可用。
     * <p>
     * 通常检查 API Key 是否已配置且非空。
     * 路由提供者会根据此返回值决定是否回退到备用提供者。
     * </p>
     *
     * @return true 表示可用，false 表示不可用（缺少必要配置）
     */
    boolean isAvailable();
}
