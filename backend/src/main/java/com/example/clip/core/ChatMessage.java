package com.example.clip.core;

/**
 * 发送给 LLM 的标准对话消息。
 */
public record ChatMessage(String role, String content) {
}
