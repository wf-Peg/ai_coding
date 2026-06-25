package com.example.clip.core;

/**
 * LLM 提供者接口
 * 抽象不同大模型厂商的调用方式，支持运行时热切换
 */
public interface LlmProvider {

    /**
     * 调用 LLM 进行对话
     * @param systemPrompt 系统提示词
     * @param userMessage 用户消息
     * @return 模型回复内容
     */
    String chat(String systemPrompt, String userMessage);

    /**
     * 获取提供者名称
     * @return "dashscope" 或 "deepseek"
     */
    String getProviderName();

    /**
     * 当前提供者是否可用（API Key 已配置）
     * @return 是否可用
     */
    boolean isAvailable();
}